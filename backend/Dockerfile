# Stage 1: export YOLOv8n → ONNX (needs PyTorch + ultralytics only here)
FROM python:3.11-slim AS exporter
WORKDIR /export
ENV PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir ultralytics \
    && pip uninstall -y opencv-python \
    && pip install --no-cache-dir opencv-python-headless
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx', imgsz=640, simplify=True, opset=12)"

# Stage 2: runtime — no PyTorch; ONNXRuntime + OpenCV headless only
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*
ENV PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    pillow \
    python-multipart \
    onnxruntime \
    numpy \
    opencv-python-headless
COPY . .
COPY --from=exporter /export/yolov8n.onnx /app/yolov8n.onnx
ENV YOLO_ONNX_PATH=/app/yolov8n.onnx
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
