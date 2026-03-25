"""FastAPI service: YOLOv8n object detection on uploaded frames or base64 JSON."""
import base64
import io
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

yolo_model: Any = None
onnx_runner: Any = None


def _pil_from_upload(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def _pil_from_base64(s: str) -> Image.Image:
    if "," in s and s.strip().startswith("data:"):
        s = s.split(",", 1)[1]
    raw = base64.b64decode(s, validate=True)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _run_detection(image: Image.Image) -> list[dict]:
    if onnx_runner is not None:
        return onnx_runner.predict_pil(image)

    assert yolo_model is not None
    results = yolo_model.predict(image, verbose=False)
    if not results:
        return []
    r = results[0]
    names = r.names or {}
    out: list[dict] = []
    if r.boxes is None or len(r.boxes) == 0:
        return out
    for box in r.boxes:
        cls_id = int(box.cls.item())
        conf = float(box.conf.item())
        label = names.get(cls_id, str(cls_id))
        xyxy = box.xyxy[0].tolist()
        x1, y1, x2, y2 = xyxy
        out.append(
            {
                "label": label,
                "confidence": round(conf, 2),
                "bbox": {
                    "x": int(x1),
                    "y": int(y1),
                    "width": int(x2 - x1),
                    "height": int(y2 - y1),
                },
            }
        )
    return out


@asynccontextmanager
async def lifespan(app: FastAPI):
    global yolo_model, onnx_runner
    onnx_path = os.environ.get("YOLO_ONNX_PATH", "").strip()
    if onnx_path:
        from onnx_infer import OnnxYoloRunner

        onnx_runner = OnnxYoloRunner(onnx_path)
        yolo_model = None
    else:
        from ultralytics import YOLO

        yolo_model = YOLO("yolov8n.pt")
        onnx_runner = None
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class DetectRequest(BaseModel):
    image: str = Field(..., description="Base64-encoded image (optional data: URL prefix)")


@app.post("/detect")
async def detect_json(body: DetectRequest):
    try:
        pil = _pil_from_base64(body.image)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 image") from exc
    dets = _run_detection(pil)
    return {
        "objects": [
            {"label": d["label"], "confidence": d["confidence"]} for d in dets
        ]
    }


@app.post("/analyze")
async def analyze_frame(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        pil = _pil_from_upload(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc

    detections = _run_detection(pil)
    detected = [d["label"] for d in detections]
    avg_conf = (
        round(sum(d["confidence"] for d in detections) / len(detections), 2)
        if detections
        else 0.0
    )
    if detected:
        names = ", ".join(detected)
        label = f"Detected: {names} ({avg_conf})"
    else:
        label = "No objects detected"
    return {
        "status": "ok",
        "detected": detected,
        "confidence": avg_conf,
        "label": label,
        "detections": detections,
    }


@app.get("/health")
def health():
    return {"status": "alive"}
