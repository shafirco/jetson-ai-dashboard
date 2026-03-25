# Jetson AI Dashboard

## What this project does

A small **web dashboard** for an **edge-AI** scenario: **live webcam** in the browser, periodic frame capture, inference with **YOLOv8n** (Ultralytics) in a **FastAPI** backend, and **detection overlays** (labels, bounding boxes), a **status bar**, and **run history**. Everything runs in **Docker** via Docker Compose.

---

## Architecture (short)

```
Browser  →  Next.js (port 3000)  →  POST /api/analyze (Route Handler)
                                         ↓
                              FastAPI backend (service: backend, port 8000 in the network)
```

- The **browser** talks only to **Next.js** (same origin).
- The **Next.js API route** (`/api/analyze`) forwards **multipart** `file` to FastAPI **`POST /analyze`** using **`NEXT_PUBLIC_BACKEND_URL`** (default `http://backend:8000` between containers).
- **Host access** to FastAPI: **port 8001** → container **8000** (`8001:8000`).

| Path | Role |
|------|------|
| `frontend/` | Next.js (App Router), React, TypeScript, Tailwind — UI, `<video>` + overlay canvas, API route |
| `backend/` | FastAPI — **YOLOv8n** inference, `POST /analyze`, `POST /detect` |
| `docker-compose.yml` | Builds and runs both services, optional env, memory limits |

---

## Technologies

| Layer | Stack |
|-------|--------|
| **UI** | Next.js, React 19, TypeScript, Tailwind CSS |
| **Vision API** | Python 3.11, FastAPI, Uvicorn, **Ultralytics (YOLOv8n)**, Pillow |
| **Containers** | Docker, Docker Compose |
| **Frontend image** | Multi-stage build, Next.js **standalone** output |

---

## Backend API (FastAPI)

| Method | Path | Body | Response (summary) |
|--------|------|------|----------------------|
| `POST` | `/analyze` | `multipart/form-data`, field **`file`** (image) | `detections[]` with `label`, `confidence`, `bbox` `{x,y,width,height}`; plus `label`, `detected`, `confidence` for the UI |
| `POST` | `/detect` | JSON `{ "image": "<base64>" }` (optional `data:image/...;base64,` prefix) | `{ "objects": [ { "label", "confidence" } ] }` |
| `GET` | `/health` | — | `{ "status": "alive" }` |

Pretrained **`yolov8n.pt`** uses **COCO** classes (~80 object types). **First container start** may download weights (slower first request).

Interactive docs: [http://localhost:8001/docs](http://localhost:8001/docs) when Compose is up.

---

## How to run

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) and Docker Compose (e.g. Docker Desktop).

From the **project root**:

```bash
docker compose up --build
```

First build can take **several minutes** (PyTorch + dependencies). The backend image is large.

| Service | URL (from your machine) |
|---------|-------------------------|
| Dashboard | [http://localhost:3000](http://localhost:3000) |
| FastAPI | [http://localhost:8001/docs](http://localhost:8001/docs), `/health` |

**Optional env:** Copy **`.env.example`** → **`.env`** in the project root for Compose. For local Next dev (no Docker), use **`frontend/.env.example`** → **`frontend/.env.local`**.

---

## How to stop

```bash
docker compose down
```

Or `Ctrl+C` in the terminal.

---

## Memory limits (Compose)

In **`docker-compose.yml`**, under `deploy.resources.limits.memory`:

- **backend:** `1g` (YOLO + PyTorch need headroom)
- **frontend:** `768M`

**Note:** With plain `docker compose up`, cgroup limits from `deploy` may behave differently than under Docker Swarm; use **`docker stats`** to see real usage.

---

## Local run without Docker (optional)

**Backend:**

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

Set `NEXT_PUBLIC_BACKEND_URL` in `frontend/.env.local` (see `frontend/.env.example`), e.g. `http://127.0.0.1:8000`, then open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_BACKEND_URL` | FastAPI **base URL** (no trailing slash). Default in Compose: `http://backend:8000`. On host against published port: `http://localhost:8001`. |

---

## Assumptions

- **Webcam:** needs **HTTPS or localhost** and user permission.
- **Confidence scores** are **model scores**, not guaranteed real-world accuracy; useful for ranking and thresholds.
- **Bounding boxes** are in **image pixel space** (snapshot is **640×360** in the current UI).

---

## Publish to GitHub

```bash
cd /path/to/jetson-ai-dashboard
git init
git branch -M main
git add -A
git status
git commit -m "Initial commit: Jetson AI dashboard with YOLOv8n"
git remote add origin https://github.com/YOUR_USER/jetson-ai-dashboard.git
git push -u origin main
```

Create the empty repo on GitHub first, then use its URL. Do **not** commit `.env` / `.env.local` (see `.gitignore`). Commit **`.env.example`** and **`frontend/.env.example`**.

---

## Publish images to Docker Hub

Replace `YOUR_DOCKERHUB_USER` with your Docker Hub username and pick a tag (e.g. `1.0.0`).

```bash
docker login
docker compose build

docker tag jetson-ai-dashboard-backend:latest  YOUR_DOCKERHUB_USER/jetson-ai-dashboard-backend:1.0.0
docker tag jetson-ai-dashboard-frontend:latest YOUR_DOCKERHUB_USER/jetson-ai-dashboard-frontend:1.0.0

docker push YOUR_DOCKERHUB_USER/jetson-ai-dashboard-backend:1.0.0
docker push YOUR_DOCKERHUB_USER/jetson-ai-dashboard-frontend:1.0.0
```

**Frontend build-arg:** If something other than `http://backend:8000` must be baked into the client, build the frontend image explicitly, e.g.:

```bash
docker build -t YOUR_DOCKERHUB_USER/jetson-ai-dashboard-frontend:1.0.0 \
  --build-arg NEXT_PUBLIC_BACKEND_URL=http://backend:8000 \
  ./frontend
```

Verify local image names with `docker images` if tags differ.

---

## Extra notes

- **LAN:** Other devices can open `http://<host-ip>:3000` if the firewall allows it.
- **Ports:** **8001** is the host mapping; **8000** is the port inside the backend container (`backend:8000` on the Compose network).
