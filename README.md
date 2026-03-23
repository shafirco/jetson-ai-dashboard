# Jetson AI Dashboard

## What this project does

A small **web dashboard** for a **Jetson-style** edge-AI scenario. It shows a **live-style canvas feed** (animated placeholder, not a real camera), periodically captures a frame, sends it to a **local Python service** that **simulates** an AI agent, and displays **detection results**: labels, **bounding boxes** drawn on the canvas, a **status bar**, and a **history** of the last few runs. Everything runs in **Docker** via Docker Compose.

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
| `frontend/` | Next.js (App Router), React, TypeScript, Tailwind — UI, canvas, overlays |
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
| **1. UI — live video + data overlay** | Animated **canvas** placeholder (moving shapes, clock, scan line) as the “feed”; **HUD-style overlays** (status badge); **bounding boxes** (green for person-like classes, blue for vehicles) with labels; **bottom status bar** with latest AI summary, FPS hint, and clock. Layout is **responsive** (video area scales with viewport width). |
| **2. AI integration** | Client sends a **PNG frame** every ~2s to **`/api/analyze`**; Next forwards to **FastAPI** `POST /analyze`. Backend returns **mock** object names, per-detection **confidence**, **`detections`** with **`bbox`** `{ x, y, width, height }` in 640×360 space; frontend syncs boxes for animated **person** / **vehicle** placeholders. |
| **3. Optimization (~1 GB RAM)** | `docker-compose.yml` sets **`deploy.resources.limits.memory`**: **256M** (backend) + **768M** (frontend) = **1024M total** across the stack. Frontend uses **Alpine** images and **standalone** Next build to keep the image lean. |

---

## Assumptions

- **No real camera / Jetson hardware** — the feed is a **drawn placeholder** that updates in real time; this matches “placeholder or simple stream” style briefs.
- **AI is simulated** — detections and boxes are **rule-based / random** in Python, not a trained vision model.
- **Bounding boxes** are aligned with the **placeholder layout** (person + car regions); other classes use fixed preset regions on the canvas.
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
