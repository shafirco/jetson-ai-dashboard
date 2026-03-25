"""Mock AI service: accepts a frame upload, returns random detections + bboxes (640x360 space)."""
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import random

app = FastAPI()

# Broad CORS — useful if anything calls this API from a browser origin directly (e.g. local dev).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OBJECTS = ["person", "car", "dog", "bicycle", "truck", "cat", "bus"]


def bbox_for_label(label: str) -> dict:
    """Pixel bbox for 640x360 canvas; presets match frontend drawScene placeholders (walk=0, carX=280)."""
    # Tiny jitter so responses look less identical between calls.
    j = lambda: random.randint(-2, 2)
    if label == "person":
        b = {"x": 80, "y": 30, "width": 80, "height": 200}
    elif label in ("dog", "cat"):
        b = {"x": 95, "y": 125, "width": 52, "height": 68}
    elif label == "bicycle":
        b = {"x": 420, "y": 195, "width": 75, "height": 95}
    elif label in ("car", "truck", "bus"):
        b = {"x": 280, "y": 168, "width": 180, "height": 112}
    else:
        b = {"x": 200, "y": 100, "width": 100, "height": 100}
    return {
        "x": b["x"] + j(),
        "y": b["y"] + j(),
        "width": b["width"] + j(),
        "height": b["height"] + j(),
    }


@app.post("/analyze")
async def analyze_frame(file: UploadFile = File(...)):
    # Consume upload body (real pipeline would decode image here).
    _ = await file.read()

    # Simulate 1–3 detected class names and build per-object scores + boxes.
    k = random.randint(1, 3)
    detected = random.sample(OBJECTS, k=k)
    detections = []
    for label in detected:
        conf = round(random.uniform(0.75, 0.99), 2)
        detections.append(
            {
                "label": label,
                "confidence": conf,
                "bbox": bbox_for_label(label),
            }
        )
    avg_conf = round(
        sum(d["confidence"] for d in detections) / len(detections), 2
    ) if detections else 0.0
    names = ", ".join(detected)
    return {
        "status": "ok",
        "detected": detected,
        "confidence": avg_conf,
        "label": f"Detected: {names} ({avg_conf})",
        "detections": detections,
    }


@app.get("/health")
def health():
    return {"status": "alive"}
