# Jetson AI Dashboard

## What this project does

**Live webcam** in the browser, a frame snapshot about **every 2 seconds**, **YOLOv8n** (Ultralytics) inference in **FastAPI**, and a **Next.js** UI with **bounding boxes**, labels, status, and **history**. Runs with **Docker Compose**.

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
| `backend/` | FastAPI, YOLOv8n — `POST /analyze`, `POST /detect`, `GET /health` |
| `docker-compose.yml` | Services `backend`, `frontend`; optional `.env`; memory `deploy` limits |

---

## Stack (as in the repo)

| Layer | Details |
|-------|---------|
| **Frontend container** | `node:20-alpine`, multi-stage build, Next **`output: 'standalone'`** |
| **Backend container** | `python:3.11-slim`, `libgl1` + `libglib2.0-0` for OpenCV/Ultralytics |
| **Python deps** | `fastapi`, `uvicorn`, `pillow`, `python-multipart`, `ultralytics` |

---

## Backend API

| Method | Path | Request | Success response |
|--------|------|---------|------------------|
| `POST` | `/analyze` | `multipart/form-data`, field **`file`** (image bytes) | JSON: `status`, `label`, `detected` (names), `confidence` (average), `detections` — each item: `label`, `confidence`, `bbox` `{ x, y, width, height }` in **image pixels** |
| `POST` | `/detect` | JSON `{ "image": "<base64>" }` (optional `data:image/...;base64,` prefix) | `{ "objects": [ { "label", "confidence" } ] }` |
| `GET` | `/health` | — | `{ "status": "alive" }` |

Invalid image data → **400** with a short `detail` message.

Weights **`yolov8n.pt`** (COCO, 80 classes) load at app startup. The **first run** may **download** the file (slower startup / first inference).

Docs (with Compose running): [http://localhost:8001/docs](http://localhost:8001/docs)

---

## Run with Docker

**Prerequisites:** Docker with Compose (e.g. Docker Desktop).

```bash
docker compose up --build
```

First **backend** build is **slow** and the image is **large** (PyTorch + Ultralytics).

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

## Memory limits (`docker-compose.yml`)

| Service | `deploy.resources.limits.memory` |
|---------|----------------------------------|
| `backend` | `1g` |
| `frontend` | `768M` |

Those are **per-container** caps in the file. Whether they are **strictly enforced** depends on your Docker setup (e.g. Swarm vs Compose alone); use **`docker stats`** to see real usage.

---

## Local run without Docker

**Backend** (Python **3.11+** recommended to match the image):

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

Set **`NEXT_PUBLIC_BACKEND_URL`** in **`frontend/.env.local`** to the FastAPI base (no trailing slash), e.g. `http://127.0.0.1:8000` or `http://localhost:8001` if you use the published Docker port only for the API.

---

## Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_BACKEND_URL` | Compose (frontend build + runtime), local Next | FastAPI base URL for the server-side proxy to **`/analyze`**. |

---

## Notes

- **Webcam:** `getUserMedia` needs **localhost or HTTPS** and user permission.
- **Snapshot size:** The UI captures **640×360**; boxes from YOLO are in that image’s pixel space.
- **Confidence:** Model confidence scores, not calibrated “real-world accuracy.”

---

## GitHub (repo already exists)

Push updates from the project root:

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

After `docker compose build`, images are usually named like **`jetson-ai-dashboard-backend`** and **`jetson-ai-dashboard-frontend`** (see `docker images`; the Compose **`name:`** sets the project prefix).

```bash
docker login
docker compose build

docker tag jetson-ai-dashboard-backend:latest  YOUR_USER/jetson-ai-dashboard-backend:1.2.0
docker tag jetson-ai-dashboard-frontend:latest YOUR_USER/jetson-ai-dashboard-frontend:1.2.0

docker push YOUR_USER/jetson-ai-dashboard-backend:1.2.0
docker push YOUR_USER/jetson-ai-dashboard-frontend:1.2.0
```

To bake a different API URL into the **browser bundle**, build the frontend with a build-arg (matches **`frontend/Dockerfile`**):

```bash
docker build -t YOUR_USER/jetson-ai-dashboard-frontend:1.2.0 \
  --build-arg NEXT_PUBLIC_BACKEND_URL=http://backend:8000 \
  ./frontend
```

---

## LAN / ports

- Other devices: `http://<host-LAN-IP>:3000` (firewall permitting).
- **8001** = host → backend container **8000**; **`backend:8000`** = hostname on the Compose network.
