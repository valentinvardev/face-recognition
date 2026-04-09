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
        "google-cloud-vision",
        "easyocr",
    )
    .pip_install("inference-sdk", "fastapi[standard]")
)

app = modal.App("marathon-runner-recognition", image=image)

ROBOFLOW_API_KEY = "jQkXK98EN0QpdYwAKaYF"
ROBOFLOW_MODEL_ID = "bib-detection/5"


@app.cls(secrets=[modal.Secret.from_name("google-vision")])
class MarathonPipeline:
    @modal.enter()
    def setup(self):
        import json
        from inference_sdk import InferenceHTTPClient
        from google.cloud import vision
        from google.oauth2 import service_account

        self.rf_client = InferenceHTTPClient(
            api_url="https://serverless.roboflow.com",
            api_key=ROBOFLOW_API_KEY,
        )

        # Load Google credentials from Modal secret
        creds_info = json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"])
        credentials = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        self.vision_client = vision.ImageAnnotatorClient(credentials=credentials)

        # EasyOCR as fallback if Google Vision billing isn't enabled
        import easyocr
        self.fallback_reader = easyocr.Reader(["en"], gpu=False)

    def _read_bib_number(self, bib_crop):
        """
        Use Google Cloud Vision DOCUMENT_TEXT_DETECTION on the bib crop.
        Tries original + high-contrast version, returns digits with best confidence.
        """
        import cv2
        import re
        from google.cloud import vision

        h, w = bib_crop.shape[:2]
        # Upscale small crops — Vision API works better with ≥200px
        scale = max(2, 300 // max(h, w, 1))
        upscaled = cv2.resize(
            bib_crop, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC
        )

        # High-contrast grayscale version
        gray = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)
        _, contrast = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        contrast_bgr = cv2.cvtColor(contrast, cv2.COLOR_GRAY2BGR)

        best_digits = ""
        best_conf = 0.0
        vision_failed = False

        for label, img in [("color", upscaled), ("contrast", contrast_bgr)]:
            try:
                _, buf = cv2.imencode(".jpg", img)
                image = vision.Image(content=buf.tobytes())
                response = self.vision_client.document_text_detection(image=image)

                if response.error.message:
                    print(f"DEBUG Vision [{label}] error: {response.error.message}")
                    vision_failed = True
                    continue

                raw_text = response.full_text_annotation.text if response.full_text_annotation else ""
                digits = re.sub(r"[^0-9]", "", raw_text)

                conf = 0.0
                symbol_count = 0
                for page in response.full_text_annotation.pages:
                    for block in page.blocks:
                        for para in block.paragraphs:
                            for word in para.words:
                                for symbol in word.symbols:
                                    conf += symbol.confidence
                                    symbol_count += 1
                avg_conf = conf / symbol_count if symbol_count else 0.0

                print(f"DEBUG Vision [{label}]: raw='{raw_text.strip()}' → digits='{digits}' conf={avg_conf:.2f}")

                if digits and avg_conf > best_conf:
                    best_conf = avg_conf
                    best_digits = digits

            except Exception as e:
                print(f"DEBUG Vision [{label}] exception: {e}")
                vision_failed = True

        if best_digits and best_conf > 0.4:
            return best_digits

        # --- Fallback: EasyOCR (used when Google Vision billing isn't active) ---
        if vision_failed or not best_digits:
            print("DEBUG: Falling back to EasyOCR")
            try:
                for label, img in [("color", upscaled), ("contrast", contrast_bgr)]:
                    ocr_result = self.fallback_reader.readtext(
                        img, allowlist="0123456789", detail=1, paragraph=False
                    )
                    hits = [(t, c) for _, t, c in ocr_result if c > 0.35 and t.strip()]
                    if not hits:
                        continue
                    text = "".join(t for t, _ in hits)
                    conf = sum(c for _, c in hits) / len(hits)
                    print(f"DEBUG EasyOCR [{label}]: '{text}' conf={conf:.2f}")
                    if text and conf > best_conf:
                        best_conf = conf
                        best_digits = text
            except Exception as e:
                print(f"DEBUG EasyOCR fallback error: {e}")

        return best_digits if best_digits else "Unknown"

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
