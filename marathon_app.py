import modal
import os
import sys

# Define the Modal image
image = (
    modal.Image.debian_slim(python_version="3.10")
    # Install cv2 requirements and C++ build tools for dlib/face-recognition
    .apt_install("libgl1-mesa-glx", "libglib2.0-0", "build-essential", "cmake")
    # Install standard workflow libraries plus our new Roboflow integration
    # Install computer vision libraries first
    .pip_install(
        "face-recognition",
        "opencv-python-headless",
        "numpy",
        "torch",
        "torchvision",
        "easyocr"
    )
    # Then install Roboflow SDK and FastAPI in a separate layer
    .pip_install("inference-sdk", "fastapi[standard]")
)

app = modal.App("marathon-runner-recognition", image=image)

# ========================================================
# RELLENAR ESTOS DATOS DE ROBOFLOW PARA QUE EL CODIGO FUNCIONE
# ========================================================
ROBOFLOW_API_KEY = "jQkXK98EN0QpdYwAKaYF"
ROBOFLOW_MODEL_ID = "bib-detection/5"
# ========================================================

@app.cls()
class MarathonPipeline:
    @modal.enter()
    def setup(self):
        """
        Runs once per container. Initializes the HTTP client and OCR reader.
        """
        from inference_sdk import InferenceHTTPClient
        import easyocr

        self.rf_client = InferenceHTTPClient(
            api_url="https://serverless.roboflow.com",
            api_key=ROBOFLOW_API_KEY
        )
        # Initialize OCR once (English + Numbers)
        self.reader = easyocr.Reader(['en'], gpu=False) 


    @modal.method()
    def process_image(self, image_bytes: bytes):
        import cv2
        import numpy as np
        import face_recognition

        # 1. Decode the input image for Face Recognition
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return {"error": "Failed to decode image. Ensure valid image bytes."}

        # 2. Extract Data from Roboflow Workflow (Bibs & Runners)
        try:
            workflow_result = self.rf_client.infer(img, model_id=ROBOFLOW_MODEL_ID)
        except Exception as e:
            workflow_result = {"error": f"Roboflow API call failed. Did you fill out the credentials? ({e})"}

        # 3. Process Roboflow Detections for OCR
        # We look for "Bib" class and crop for OCR
        def get_digits(text):
            return "".join([c for c in text if c.isdigit()])

        if "predictions" in workflow_result:
            for pred in workflow_result["predictions"]:
                if pred["class"].lower() == "bib":
                    # Extract crop coordinates
                    x, y, w, h = int(pred["x"]), int(pred["y"]), int(pred["width"]), int(pred["height"])
                    # Roboflow (x,y) is center
                    x1, y1 = max(0, x - w//2), max(0, y - h//2)
                    x2, y2 = min(img.shape[1], x + w//2), min(img.shape[0], y + h//2)
                    
                    bib_crop = img[y1:y2, x1:x2]
                    print(f"DEBUG: Bib Crop shape: {bib_crop.shape}")
                    if bib_crop.size > 0:
                        # Pre-process for better OCR
                        # 1. Resize 2x to help with small thumbnails
                        # 2. Grayscale 
                        gray_crop = cv2.cvtColor(bib_crop, cv2.COLOR_BGR2GRAY)
                        resized_crop = cv2.resize(gray_crop, (0,0), fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
                        
                        ocr_result = self.reader.readtext(resized_crop)
                        print(f"DEBUG: Raw OCR Result: {ocr_result}")
                        # Join all detected text pieces and keep only digits
                        full_text = " ".join([res[1] for res in ocr_result])
                        digits = get_digits(full_text)
                        pred["bib_text"] = digits if digits else "Unknown"
                    else:
                        pred["bib_text"] = "Unknown"

        # 4. Global Face Extraction
        person_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        face_locations = face_recognition.face_locations(person_rgb)
        encodings = []
        if face_locations:
            face_encodings = face_recognition.face_encodings(person_rgb, face_locations)
            encodings = [enc.tolist() for enc in face_encodings]

        # Combine your Roboflow results with our Face features
        return {
            "roboflow_results": workflow_result,
            "faces_detected": len(face_locations),
            "face_encodings": encodings,
            "face_locations": face_locations # [ (top, right, bottom, left), ... ]
        }

    @modal.fastapi_endpoint(method="POST")
    def process_image_web(self, image_data: dict):
        """
        Web endpoint for the T3 frontend.
        Expects a JSON with {"image_base64": "..."}.
        """
        import base64
        image_bytes = base64.b64decode(image_data["image_base64"])
        return self.process_image.local(image_bytes)

@app.local_entrypoint()
def main(image_path: str = None):
    """
    To run this use: python -m modal run marathon_app.py --image-path=/path/to/test.jpg
    """
    if not image_path:
        print("Please provide an image path to test the pipeline:")
        print("  python -m modal run marathon_app.py --image-path my_img.jpg")
        return
        
    if not os.path.exists(image_path):
        print(f"Error: Image {image_path} not found.")
        return

    print(f"Reading image {image_path}...")
    with open(image_path, "rb") as f:
        image_bytes = f.read()

    print("Sending to Modal...")
    model = MarathonPipeline()
    results = model.process_image.remote(image_bytes)
    
    print("\n========== RESULTS ==========")
    import json
    
    # Truncate face encodings for print
    if "face_encodings" in results and results["face_encodings"]:
        results["face_encodings"] = f"[{len(results['face_encodings'])} encoding(s) with 128 elements each]"
        
    print(json.dumps(results, indent=2))
