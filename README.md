# Jetson AI Dashboard

## What this project does

**Live webcam** in the browser, a frame snapshot about **every 2 seconds**, **YOLOv8n** object detection (COCO) in **FastAPI**, and a **Next.js** UI with **bounding boxes**, labels, status, and **history**. Runs with **Docker Compose**.

- **In Docker:** the backend runs **ONNXRuntime** on a baked-in **`yolov8n.onnx`** (small image, no PyTorch at runtime).
- **Local dev (default):** the backend can use **Ultralytics** with **`yolov8n.pt`** instead — same HTTP API.

---

## Architecture

```
Browser  →  Next.js :3000  →  POST /api/analyze (multipart PNG)
                                    ↓
                         FastAPI `backend:8000`  →  POST /analyze
```

- The browser calls only **Next.js** (same origin). It does **not** call FastAPI directly.
- **`NEXT_PUBLIC_BACKEND_URL`** (Compose default: `http://backend:8000`) is the FastAPI base URL used by the Next.js server when proxying to `/analyze`.
- From the **host machine**, FastAPI is exposed as **http://localhost:8001** (`8001:8000`).

| Path | Role |
|------|------|
| `frontend/` | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4 |
| `backend/main.py` | FastAPI app; **`YOLO_ONNX_PATH` set → ONNX** via `onnx_infer.py`, **unset → Ultralytics `.pt`** |
| `backend/onnx_infer.py` | ONNXRuntime inference + NMS (COCO80 labels); used in Docker |
| `backend/Dockerfile` | **Multi-stage:** export ONNX (CPU PyTorch + Ultralytics), then slim runtime |
| `backend/.dockerignore` | Keeps build context small (e.g. no local `.pt` / `__pycache__`) |
| `docker-compose.yml` | Services `backend`, `frontend`; optional `.env`; `deploy` limits |

---

## Stack (as in the repo)

| Layer | Details |
|-------|---------|
| **Frontend container** | `node:20-alpine`, multi-stage build, Next **`output: 'standalone'`** |
| **Backend — build stage (`exporter`)** | `python:3.11-slim`, **CPU** `torch` + `torchvision` from [PyTorch CPU wheels](https://download.pytorch.org/whl/cpu), **Ultralytics**, then **`opencv-python` replaced with `opencv-python-headless`** (avoids X11 / `libxcb` in slim). Runs one-shot export: **`yolov8n.pt` → `yolov8n.onnx`** (opset 12, simplify). |
| **Backend — runtime stage** | `python:3.11-slim`, **`libglib2.0-0`**, **`libgomp1`**, **`onnxruntime`**, NumPy, **OpenCV headless**, FastAPI, Uvicorn, Pillow, `python-multipart`. **`ENV YOLO_ONNX_PATH=/app/yolov8n.onnx`**. **No PyTorch** in the final image — typically **~0.5–0.6 GB** image size vs multi‑GB full-Torch stacks. |
| **Python (local dev)** | `backend/requirements.txt`: Ultralytics (+ PyTorch via pip). Comment in file explains Docker vs local. Same REST API as the container. |

---

## Backend API

| Method | Path | Request | Success response |
|--------|------|---------|------------------|
| `POST` | `/analyze` | `multipart/form-data`, field **`file`** (image bytes) | JSON: `status`, `label`, `detected` (names), `confidence` (average), `detections` — each item: `label`, `confidence`, `bbox` `{ x, y, width, height }` in **image pixels** |
| `POST` | `/detect` | JSON `{ "image": "<base64>" }` (optional `data:image/...;base64,` prefix) | `{ "objects": [ { "label", "confidence" } ] }` |
| `GET` | `/health` | — | `{ "status": "alive" }` |

Invalid image data → **400** with a short `detail` message.

Docs (with Compose running): [http://localhost:8001/docs](http://localhost:8001/docs)

---

## Inference: Docker vs local

| Mode | How it is selected | Model | Notes |
|------|-------------------|-------|--------|
| **Docker (Compose)** | `YOLO_ONNX_PATH=/app/yolov8n.onnx` set in **Dockerfile** | `yolov8n.onnx` copied from the **exporter** stage | No weight download at container startup; startup loads ONNX only. |
| **Local** | Do **not** set `YOLO_ONNX_PATH` (or leave empty) | **`yolov8n.pt`** via Ultralytics | First run may download `yolov8n.pt`. |

To run **ONNX locally** (optional): install `onnxruntime`, `numpy`, `opencv-python-headless`, point **`YOLO_ONNX_PATH`** at your `.onnx` file, and start Uvicorn (Ultralytics not required for that path).

---

## Run with Docker

**Prerequisites:** Docker with Compose (e.g. Docker Desktop).

```bash
docker compose up --build
```

The **first backend build** is **slow** (exporter installs CPU PyTorch + Ultralytics and exports ONNX). **Subsequent builds** can cache the exporter layer if dependencies unchanged. The **pushed/runtime image** stays **small** (ONNX + ONNXRuntime only).

| What | URL |
|------|-----|
| Dashboard | [http://localhost:3000](http://localhost:3000) |
| FastAPI | [http://localhost:8001/docs](http://localhost:8001/docs), [http://localhost:8001/health](http://localhost:8001/health) |

**Env:** Optional root **`.env`** from **`.env.example`** (Compose reads it). For Next on the host: **`frontend/.env.local`** from **`frontend/.env.example`** (e.g. `NEXT_PUBLIC_BACKEND_URL=http://localhost:8001` when the API is on the mapped port).

**Stop:**

```bash
docker compose down
```

---

## Resource limits (`docker-compose.yml`)

Under **`deploy.resources.limits`** (enforcement depends on Docker/Swarm setup; use **`docker stats`** for real usage):

| Service | `memory` | `cpus` |
|---------|----------|--------|
| `backend` | `700M` | `4` |
| `frontend` | `300M` | — |

---

## Local run without Docker

**Backend** (Python **3.11+** recommended):

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend:**

```bash
cd frontend
npm ci
npm run dev
```

Set **`NEXT_PUBLIC_BACKEND_URL`** in **`frontend/.env.local`** to the FastAPI base (no trailing slash), e.g. `http://127.0.0.1:8000` or `http://localhost:8001` if only the published Docker API port is used.

---

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_BACKEND_URL` | Compose (frontend build + runtime), local Next | FastAPI base URL for the server-side proxy to **`/analyze`**. |
| `YOLO_ONNX_PATH` | Backend (set in **Dockerfile** for production) | Path to **`yolov8n.onnx`**. When set, **`onnx_infer.OnnxYoloRunner`** is used; when unset, **Ultralytics** loads **`yolov8n.pt`**. |

---

## Notes

- **Webcam:** `getUserMedia` needs **localhost or HTTPS** and user permission.
- **Snapshot size:** The UI captures **640×360**; boxes are in that image’s **pixel space**.
- **Confidence:** Scores are model outputs, not guaranteed calibrated accuracy.
- **ONNX postprocess** in `onnx_infer.py` follows the same idea as the [Ultralytics ONNXRuntime example](https://github.com/ultralytics/ultralytics/tree/main/examples/YOLOv8-ONNXRuntime) (check Ultralytics **AGPL-3.0** if you redistribute the service).

---

## GitHub (repo already exists)

```bash
git add -A
git status
git commit -m "Your message"
git push origin main
```

Tags (example):

```bash
git tag -a v1.2.1 -m "Release notes"
git push origin v1.2.1
```

Do **not** commit **`.env`**, **`frontend/.env.local`**, or secrets. Keep **`.env.example`** and **`frontend/.env.example`** in the repo.

---

## Docker Hub

After `docker compose build`, images are usually **`jetson-ai-dashboard-backend`** and **`jetson-ai-dashboard-frontend`** (see `docker images`; Compose **`name:`** sets the prefix).

```bash
docker login
docker compose build

docker tag jetson-ai-dashboard-backend:latest  YOUR_USER/jetson-ai-dashboard-backend:1.2.0
docker tag jetson-ai-dashboard-frontend:latest YOUR_USER/jetson-ai-dashboard-frontend:1.2.0

docker push YOUR_USER/jetson-ai-dashboard-backend:1.2.0
docker push YOUR_USER/jetson-ai-dashboard-frontend:1.2.0
```

Frontend build-arg (matches **`frontend/Dockerfile`**):

```bash
docker build -t YOUR_USER/jetson-ai-dashboard-frontend:1.2.0 \
  --build-arg NEXT_PUBLIC_BACKEND_URL=http://backend:8000 \
  ./frontend
```

---

## LAN / ports

- Other devices: `http://<host-LAN-IP>:3000` (firewall permitting).
- **8001** = host → backend container **8000**; **`backend:8000`** on the Compose network.
