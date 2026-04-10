import modal
import os

# ── Images ────────────────────────────────────────────────────────────────────

# Lightweight: just for the gateway endpoint (cold start ~2s)
light_image = (
    modal.Image.debian_slim(python_version="3.10")
    .pip_install("fastapi[standard]")
)

# Heavy: full ML pipeline (cold start ~90s, but runs async — no timeout)
heavy_image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0", "build-essential", "cmake", "libgomp1")
    .pip_install(
        "face-recognition",
        "opencv-python-headless",
        "numpy",
        "easyocr",
        "requests",
        "inference-sdk",
        "fastapi[standard]",
    )
)

app = modal.App("marathon-runner-recognition")

ROBOFLOW_API_KEY = "jQkXK98EN0QpdYwAKaYF"
ROBOFLOW_MODEL_ID = "bib-detection/5"


# ── Heavy ML pipeline ─────────────────────────────────────────────────────────

@app.cls(image=heavy_image)
class MarathonPipeline:
    @modal.enter()
    def setup(self):
        from inference_sdk import InferenceHTTPClient
        import easyocr

        self.rf_client = InferenceHTTPClient(
            api_url="https://serverless.roboflow.com",
            api_key=ROBOFLOW_API_KEY,
        )
        self.easy = easyocr.Reader(["en"], gpu=False)

    def _preprocess(self, bib_crop):
        import cv2
        h, w = bib_crop.shape[:2]
        scale = max(2, 300 // max(h, w, 1))
        up = cv2.resize(bib_crop, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
        denoised = cv2.fastNlMeansDenoising(gray, h=10)
        _, contrast = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return up, cv2.cvtColor(contrast, cv2.COLOR_GRAY2BGR)

    def _easy_read(self, img):
        try:
            result = self.easy.readtext(img, allowlist="0123456789", detail=1, paragraph=False)
            hits = [(t, c) for _, t, c in result if c > 0.3 and t.strip()]
            if not hits:
                return "", 0.0
            return "".join(t for t, _ in hits), sum(c for _, c in hits) / len(hits)
        except Exception as e:
            print(f"EasyOCR error: {e}")
            return "", 0.0

    def _read_bib_number(self, bib_crop):
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

        try:
            workflow_result = self.rf_client.infer(img, model_id=ROBOFLOW_MODEL_ID)
        except Exception as e:
            workflow_result = {"error": str(e)}

        if "predictions" in workflow_result:
            workflow_result["predictions"].sort(key=lambda p: p.get("confidence", 0), reverse=True)
            for pred in workflow_result["predictions"]:
                if pred["class"].lower() != "bib":
                    continue
                x, y, w, h = int(pred["x"]), int(pred["y"]), int(pred["width"]), int(pred["height"])
                pad_x, pad_y = int(w * 0.10), int(h * 0.10)
                x1 = max(0, x - w // 2 - pad_x)
                y1 = max(0, y - h // 2 - pad_y)
                x2 = min(img.shape[1], x + w // 2 + pad_x)
                y2 = min(img.shape[0], y + h // 2 + pad_y)
                bib_crop = img[y1:y2, x1:x2]
                pred["bib_text"] = self._read_bib_number(bib_crop) if bib_crop.size > 0 else "Unknown"

        person_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        face_locations = face_recognition.face_locations(person_rgb, model="hog")
        encodings = []
        if face_locations:
            face_encodings = face_recognition.face_encodings(person_rgb, face_locations, num_jitters=1)
            encodings = [enc.tolist() for enc in face_encodings]

        return {
            "roboflow_results": workflow_result,
            "faces_detected": len(face_locations),
            "face_encodings": encodings,
            "face_locations": face_locations,
        }

    @modal.method()
    def do_ocr_and_save(self, storage_key: str, photo_id: str, supabase_url: str, service_key: str):
        """
        Full async pipeline: download → OCR → write bib to DB.
        Called via .spawn() so it runs with no timeout constraints.
        """
        import requests
        import re

        print(f"[OCR] Starting photo {photo_id} key={storage_key}")

        auth_headers = {
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }

        # 1. Download photo from Supabase Storage
        download_url = f"{supabase_url}/storage/v1/object/photos/{storage_key}"
        try:
            img_resp = requests.get(download_url, headers=auth_headers, timeout=30)
            img_resp.raise_for_status()
            image_bytes = img_resp.content
            print(f"[OCR] Downloaded {len(image_bytes)} bytes for {photo_id}")
        except Exception as e:
            print(f"[OCR] Download failed for {photo_id}: {e}")
            return {"error": str(e)}

        # 2. Run Roboflow + OCR
        result = self.process_image.local(image_bytes)
        preds = result.get("roboflow_results", {}).get("predictions", [])
        sorted_preds = sorted(preds, key=lambda p: p.get("confidence", 0), reverse=True)

        bib_number = None
        for pred in sorted_preds:
            if pred.get("class", "").lower() != "bib":
                continue
            text = (pred.get("bib_text") or "").strip()
            if text and text != "Unknown" and re.match(r"^\d+$", text):
                bib_number = text
                break

        print(f"[OCR] Photo {photo_id}: bib={bib_number}")

        # 3. Write bib to Supabase DB via PostgREST
        if bib_number:
            try:
                db_resp = requests.patch(
                    f"{supabase_url}/rest/v1/Photo",
                    params={"id": f"eq.{photo_id}"},
                    headers={
                        **auth_headers,
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    json={"bibNumber": bib_number},
                    timeout=15,
                )
                db_resp.raise_for_status()
                print(f"[OCR] Saved bib={bib_number} for photo {photo_id}")
            except Exception as e:
                print(f"[OCR] DB write failed for {photo_id}: {e}")
                return {"error": str(e), "bib": bib_number}

        return {"bib": bib_number, "photo_id": photo_id}

    @modal.fastapi_endpoint(method="POST")
    def process_image_web(self, image_data: dict):
        """Original web endpoint — accepts base64 image, returns full pipeline result."""
        import base64
        image_bytes = base64.b64decode(image_data["image_base64"])
        return self.process_image.local(image_bytes)


# ── Lightweight gateway — spawns ML work, returns instantly ───────────────────

@app.cls(image=light_image)
class OCRGateway:
    """
    Cold start: ~2s (no ML libs).
    Receives trigger from Vercel, spawns MarathonPipeline.do_ocr_and_save,
    returns immediately. The ML pipeline runs async with no timeout.
    """

    @modal.fastapi_endpoint(method="POST")
    def trigger(self, payload: dict):
        storage_key = payload.get("storage_key", "")
        photo_id = payload.get("photo_id", "")
        supabase_url = payload.get("supabase_url", "")
        service_key = payload.get("supabase_service_key", "")

        if not all([storage_key, photo_id, supabase_url, service_key]):
            return {"error": "Missing required fields"}

        # Spawn the heavy pipeline — this returns immediately
        pipeline = MarathonPipeline()
        pipeline.do_ocr_and_save.spawn(storage_key, photo_id, supabase_url, service_key)

        print(f"[Gateway] Spawned OCR for photo {photo_id}")
        return {"status": "accepted", "photo_id": photo_id}


# ── Local entrypoint ──────────────────────────────────────────────────────────

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
