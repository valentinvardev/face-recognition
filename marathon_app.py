import modal
import os

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0", "build-essential", "cmake", "libgomp1")
    .pip_install(
        "face-recognition",
        "opencv-python-headless",
        "numpy",
        # EasyOCR brings its own torch — don't install torch separately to avoid conflicts
        "easyocr",
        "inference-sdk",
        "fastapi[standard]",
    )
)

app = modal.App("marathon-runner-recognition", image=image)

ROBOFLOW_API_KEY = "jQkXK98EN0QpdYwAKaYF"
ROBOFLOW_MODEL_ID = "bib-detection/5"


@app.cls()
class MarathonPipeline:
    @modal.enter()
    def setup(self):
        from inference_sdk import InferenceHTTPClient
        import easyocr

        self.rf_client = InferenceHTTPClient(
            api_url="https://serverless.roboflow.com",
            api_key=ROBOFLOW_API_KEY,
        )

        # EasyOCR — digit-optimised reader
        self.easy = easyocr.Reader(["en"], gpu=False)

    def _preprocess(self, bib_crop):
        """Upscale + generate high-contrast variant."""
        import cv2

        h, w = bib_crop.shape[:2]
        scale = max(2, 300 // max(h, w, 1))
        up = cv2.resize(bib_crop, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)

        gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
        denoised = cv2.fastNlMeansDenoising(gray, h=10)
        _, contrast = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        contrast_bgr = cv2.cvtColor(contrast, cv2.COLOR_GRAY2BGR)

        return up, contrast_bgr

    def _easy_read(self, img):
        """Read digits with EasyOCR. Returns (digits, confidence)."""
        try:
            result = self.easy.readtext(
                img, allowlist="0123456789", detail=1, paragraph=False
            )
            hits = [(t, c) for _, t, c in result if c > 0.3 and t.strip()]
            if not hits:
                return "", 0.0
            text = "".join(t for t, _ in hits)
            conf = sum(c for _, c in hits) / len(hits)
            return text, conf
        except Exception as e:
            print(f"EasyOCR error: {e}")
            return "", 0.0

    def _read_bib_number(self, bib_crop):
        """Run EasyOCR on color + contrast variants, return best digit string."""
        color, contrast = self._preprocess(bib_crop)

        best_digits, best_conf = "", 0.0

        for label, img in [("color", color), ("contrast", contrast)]:
            digits, conf = self._easy_read(img)
            print(f"EasyOCR [{label}]: '{digits}' conf={conf:.2f}")
            if digits and conf > best_conf:
                best_conf, best_digits = conf, digits

        result = best_digits if best_digits else "Unknown"
        print(f"Bib result: '{result}' (conf={best_conf:.2f})")
        return result

    @modal.method()
    def process_image(self, image_bytes: bytes):
        import cv2
        import numpy as np
        import face_recognition

        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return {"error": "Failed to decode image."}

        # --- 1. Roboflow bib detection ---
        try:
            workflow_result = self.rf_client.infer(img, model_id=ROBOFLOW_MODEL_ID)
        except Exception as e:
            workflow_result = {"error": str(e)}

        if "predictions" in workflow_result:
            workflow_result["predictions"].sort(
                key=lambda p: p.get("confidence", 0), reverse=True
            )
            for pred in workflow_result["predictions"]:
                if pred["class"].lower() != "bib":
                    continue

                x, y, w, h = (
                    int(pred["x"]), int(pred["y"]),
                    int(pred["width"]), int(pred["height"]),
                )
                # 10% padding so edge digits aren't clipped
                pad_x, pad_y = int(w * 0.10), int(h * 0.10)
                x1 = max(0, x - w // 2 - pad_x)
                y1 = max(0, y - h // 2 - pad_y)
                x2 = min(img.shape[1], x + w // 2 + pad_x)
                y2 = min(img.shape[0], y + h // 2 + pad_y)

                bib_crop = img[y1:y2, x1:x2]
                pred["bib_text"] = (
                    self._read_bib_number(bib_crop) if bib_crop.size > 0 else "Unknown"
                )

        # --- 2. Face recognition ---
        person_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        face_locations = face_recognition.face_locations(person_rgb, model="hog")
        encodings = []
        if face_locations:
            face_encodings = face_recognition.face_encodings(
                person_rgb, face_locations, num_jitters=1
            )
            encodings = [enc.tolist() for enc in face_encodings]

        return {
            "roboflow_results": workflow_result,
            "faces_detected": len(face_locations),
            "face_encodings": encodings,
            "face_locations": face_locations,
        }

    @modal.fastapi_endpoint(method="POST")
    def process_image_web(self, image_data: dict):
        import base64
        image_bytes = base64.b64decode(image_data["image_base64"])
        return self.process_image.local(image_bytes)


@app.local_entrypoint()
def main(image_path: str = None):
    if not image_path:
        print("Usage: python -m modal run marathon_app.py --image-path my_img.jpg")
        return
    if not os.path.exists(image_path):
        print(f"Error: {image_path} not found.")
        return

    with open(image_path, "rb") as f:
        image_bytes = f.read()

    model = MarathonPipeline()
    results = model.process_image.remote(image_bytes)

    import json
    if "face_encodings" in results and results["face_encodings"]:
        results["face_encodings"] = f"[{len(results['face_encodings'])} encoding(s)]"
    print(json.dumps(results, indent=2))
