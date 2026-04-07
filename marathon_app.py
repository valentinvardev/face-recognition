import modal
import os
import sys

# Define the Modal image
image = (
    modal.Image.debian_slim()
    # Install cv2 requirements
    .apt_install("libgl1-mesa-glx", "libglib2.0-0")
    # Install standard workflow libraries plus our new Roboflow integration
    .pip_install(
        "inference-sdk",
        "face-recognition",
        "opencv-python-headless",
        "numpy"
    )
)

app = modal.App("marathon-runner-recognition", image=image)

# ========================================================
# RELLENAR ESTOS DATOS DE ROBOFLOW PARA QUE EL CODIGO FUNCIONE
# ========================================================
ROBOFLOW_API_KEY = "API_KEY"
ROBOFLOW_MODEL_ID = "bib-detection/5"
# ========================================================

@app.cls()
class MarathonPipeline:
    @modal.enter()
    def setup(self):
        """
        Runs once per container. Initializes the HTTP client.
        """
        from inference_sdk import InferenceHTTPClient
        self.rf_client = InferenceHTTPClient(
            api_url="https://serverless.roboflow.com",
            api_key=ROBOFLOW_API_KEY
        )

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

        # 3. Global Face Extraction
        # Because we don't know the exact bounding box output structure of your Roboflow Workflow,
        # we extract faces from the whole image and bundle it with the workflow result.
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
            "face_encodings": encodings
        }

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
