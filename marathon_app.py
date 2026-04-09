import modal
import os

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0", "build-essential", "cmake")
    .pip_install(
        "face-recognition",
        "opencv-python-headless",
        "numpy",
        "torch",
        "torchvision",
        "easyocr",
    )
    .pip_install("inference-sdk", "fastapi[standard]")
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
        # gpu=False for Modal CPU containers
        self.reader = easyocr.Reader(["en"], gpu=False)

    def _read_bib_number(self, bib_crop):
        """
        Run multiple preprocessing pipelines on the bib crop and return the
        digit string with the highest average OCR confidence.

        Key improvements over the original:
        - allowlist='0123456789'  → eliminates letter/number confusion (7 vs 1)
        - 10% padding already applied before calling this method
        - 3× upscale with cubic interpolation
        - Denoising before thresholding
        - Four preprocessing variants: plain, OTSU, OTSU-inverted, adaptive
        - Confidence threshold 0.35 to drop weak guesses
        """
        import cv2

        gray = cv2.cvtColor(bib_crop, cv2.COLOR_BGR2GRAY)
        denoised = cv2.fastNlMeansDenoising(gray, h=10)

        def upscale(img, scale=3):
            return cv2.resize(
                img, (0, 0), fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC
            )

        up = upscale(denoised, 3)

        pipelines = {
            "plain":        upscale(gray, 3),
            "otsu":         cv2.threshold(up, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1],
            "otsu_inv":     cv2.threshold(up, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1],
            "adaptive":     cv2.adaptiveThreshold(up, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2),
        }

        best_text = ""
        best_conf = 0.0

        for name, processed in pipelines.items():
            try:
                ocr_result = self.reader.readtext(
                    processed,
                    allowlist="0123456789",  # digits only — fixes 7/1 confusion
                    detail=1,
                    paragraph=False,
                )
                hits = [(t, c) for _, t, c in ocr_result if c > 0.35 and t.strip()]
                if not hits:
                    continue
                text = "".join(t for t, _ in hits)
                conf = sum(c for _, c in hits) / len(hits)
                print(f"DEBUG OCR [{name}]: '{text}'  conf={conf:.2f}")
                if conf > best_conf and text:
                    best_conf = conf
                    best_text = text
            except Exception as e:
                print(f"DEBUG OCR [{name}] error: {e}")

        return best_text if best_text else "Unknown"

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
            # Best detections first
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
                # 10% padding so digits aren't clipped at the edges
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
        # "hog" is faster and good enough for upright race photos
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
            "face_locations": face_locations,  # [(top, right, bottom, left), ...]
        }

    @modal.fastapi_endpoint(method="POST")
    def process_image_web(self, image_data: dict):
        """
        Web endpoint called by the Next.js frontend.
        Expects: {"image_base64": "..."}
        """
        import base64

        image_bytes = base64.b64decode(image_data["image_base64"])
        return self.process_image.local(image_bytes)


@app.local_entrypoint()
def main(image_path: str = None):
    """
    Test locally:
      python -m modal run marathon_app.py --image-path my_img.jpg
    """
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
