# Jetson AI Dashboard

## What this project does

A small **web dashboard** for a **Jetson-style** edge-AI scenario. It shows a **live webcam feed** (`getUserMedia` in the browser), periodically captures a frame, sends it to a **local Python service** that **simulates** an AI agent, and displays **detection results**: labels, **bounding boxes** on an overlay canvas, a **status bar**, and a **history** of the last few runs. Everything runs in **Docker** via Docker Compose.

---

## Architecture (short)

```
Browser  →  Next.js (port 3000)  →  POST /api/analyze (Route Handler)
                                         ↓
                              FastAPI backend (service name: backend, port 8000 inside the network)
```

- The **browser** only talks to **Next.js** (same origin).
- The **Next.js API route** (`/api/analyze`) forwards the multipart form to FastAPI using **`NEXT_PUBLIC_BACKEND_URL`** (default `http://backend:8000` between containers).
- **Host access** to FastAPI uses **port 8001** mapped to container **8000** (`8001:8000`), so another app on the host can keep using port 8000.

| Path | Role |
|------|------|
| `frontend/` | Next.js (App Router), React, TypeScript, Tailwind — UI, `<video>` + overlay canvas, API route |
| `backend/` | FastAPI — `POST /analyze` returns mock detections + bounding boxes |
| `docker-compose.yml` | Builds and runs both services, optional env, memory limits |

---

## Technologies

| Layer | Stack |
|-------|--------|
| **UI** | Next.js, React 19, TypeScript, Tailwind CSS |
| **Mock AI API** | Python 3.11, FastAPI, Uvicorn |
| **Containers** | Docker, Docker Compose |
| **Frontend image** | Multi-stage build, Next.js **standalone** output (smaller runtime image) |

---

## How to run

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) and Docker Compose (e.g. Docker Desktop).

From the **project root**:

```bash
docker compose up --build
```

First build may take several minutes.

| Service | URL (from your machine) |
|---------|-------------------------|
| Dashboard | [http://localhost:3000](http://localhost:3000) |
| FastAPI docs / health | [http://localhost:8001/docs](http://localhost:8001/docs), `/health` |

**Optional env:** Copy `.env.example` → `.env` in the project root to override `NEXT_PUBLIC_BACKEND_URL`. For local Next dev (no Docker), use `frontend/.env.example` → `frontend/.env.local`.

---

## How to stop

```bash
docker compose down
```

Or stop the terminal process with `Ctrl+C`.

---

## What was implemented (assignment mapping)

| Requirement | Implementation |
|-------------|----------------|
| **1. UI — live video + data overlay** | **Webcam** via `getUserMedia` in a `<video>` element; **transparent canvas** overlays **bounding boxes** (green person-like / blue vehicle classes) and labels; **HUD** status badge; **bottom status bar** (AI summary, FPS, clock). Layout is **responsive**. |
| **2. AI integration** | Client snapshots the video to **PNG** every ~2s → **`/api/analyze`** → **FastAPI** `POST /analyze`. Backend returns **mock** labels, **confidence**, **`detections`** with **`bbox`** in 640×360 space (boxes are illustrative vs real camera geometry). |
| **3. Optimization (~1 GB RAM)** | `docker-compose.yml` sets **`deploy.resources.limits.memory`**: **256M** (backend) + **768M** (frontend) = **1024M total** across the stack. Frontend uses **Alpine** images and **standalone** Next build to keep the image lean. |

---

## Assumptions

- **Browser webcam** — requires **HTTPS or localhost** and user permission; if denied, an on-screen message is shown.
- **No Jetson / real vision model** — **AI is simulated** in Python (random classes + preset bbox regions), not inference on the actual frame content.
- **Bounding boxes** use **preset 640×360 regions** from the backend; they do not track real objects in the webcam image.
- **Memory limits** in Compose `deploy` are **fully enforced in Docker Swarm**; with plain `docker compose up`, enforcement can vary by Docker version — use **`docker stats`** to observe real usage if graders require proof.

---

## Memory limit — how it is applied

- **Where:** `docker-compose.yml`, under each service:

  - **backend:** `deploy.resources.limits.memory: 256M`
  - **frontend:** `deploy.resources.limits.memory: 768M`

- **Total cap target:** **256M + 768M = 1 GB** for the two application containers combined.

- **Supporting choices:** Backend image based on `python:3.11-slim`; frontend **multi-stage** Dockerfile with `output: 'standalone'` in Next config so the runtime container ships a minimal Node bundle instead of full `node_modules`.

---

## Local run without Docker (optional)

**Backend:**

```bash
cd backend
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
| `NEXT_PUBLIC_BACKEND_URL` | FastAPI **base URL** (no trailing slash). Default in Compose: `http://backend:8000`. For host-only dev: `http://127.0.0.1:8000` or `http://localhost:8001` depending on where Uvicorn is exposed. |

---

## Extra notes

- **LAN access:** From another device on the same Wi‑Fi, use the host’s IP and port **3000**; the host firewall may need an inbound rule.
- **Port 8001 vs 8000:** **8001** is only the **published** host port for FastAPI; **8000** is the port **inside** the backend container and what **`backend:8000`** uses on the Docker network.

---

## Git & Docker image catalog

Use this as a **naming checklist** when you publish the repo and optional images to a registry (Docker Hub, GHCR, etc.).

| Artifact | Suggested name / tag | Notes |
|----------|----------------------|--------|
| **Git remote** | `github.com/<you>/jetson-ai-dashboard` | Or GitLab / other; keep repo root = this folder. |
| **Backend image** | `<registry>/<you>/jetson-ai-dashboard-backend:1.0.0` | Built from `./backend/Dockerfile`. |
| **Frontend image** | `<registry>/<you>/jetson-ai-dashboard-frontend:1.0.0` | Built from `./frontend/Dockerfile`; pass build-arg `NEXT_PUBLIC_BACKEND_URL` if not using Compose defaults. |
| **Compose (local)** | `docker compose build` | Service names: `backend`, `frontend` (no registry unless you add `image:` keys). |

**Tag and push manually** (after `docker login <registry>`):

```bash
# From project root, after: docker compose build
docker tag jetson-ai-dashboard-backend:latest  <registry>/<you>/jetson-ai-dashboard-backend:1.0.0
docker tag jetson-ai-dashboard-frontend:latest <registry>/<you>/jetson-ai-dashboard-frontend:1.0.0
docker push <registry>/<you>/jetson-ai-dashboard-backend:1.0.0
docker push <registry>/<you>/jetson-ai-dashboard-frontend:1.0.0
```

Replace `<registry>/<you>` (e.g. `docker.io/janedoe`). Compose **`name: jetson-ai-dashboard`** keeps project/image names stable; after `docker compose build`, local images are typically `jetson-ai-dashboard-backend` and `jetson-ai-dashboard-frontend` (verify with `docker images`).

**Git workflow (short):**

```bash
git add -A
git status   # confirm .env and node_modules are not listed
git commit -m "Describe your change"
git push origin main
```

Do **not** commit `.env` (it is gitignored). Commit **`.env.example`** and **`frontend/.env.example`** for others to copy.
