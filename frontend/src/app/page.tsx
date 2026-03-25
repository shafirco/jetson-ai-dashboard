"use client";
/**
 * Dashboard: live webcam (getUserMedia), detection overlays on a transparent canvas,
 * hidden snapshot canvas for PNG uploads to /api/analyze, same shell UI as before.
 */
import { useCallback, useEffect, useRef, useState } from "react";

// Snapshot + overlay resolution; backend bboxes are defined in this coordinate space.
const W = 640;
const H = 360;

const GREEN_LABELS = new Set(["person", "dog", "cat"]);

type Bbox = { x: number; y: number; width: number; height: number };

type Detection = {
  label: string;
  confidence: number;
  bbox: Bbox;
};

type HistoryEntry = {
  id: string;
  time: number;
  summary: string;
  detections: Detection[];
};

/** Draw label chip + rectangle for each detection (coordinates match 640×360 mock layout). */
function drawDetectionOverlays(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
) {
  ctx.clearRect(0, 0, W, H);
  for (const d of detections) {
    const { x, y, width, height } = d.bbox;
    const color = GREEN_LABELS.has(d.label) ? "#22c55e" : "#3b82f6";
    const labelText = `${d.label} ${(d.confidence * 100).toFixed(0)}%`;

    ctx.font = "bold 12px monospace";
    const tw = Math.ceil(ctx.measureText(labelText).width);
    const pad = 4;
    const labelH = 16;
    const labelY = Math.max(2, y - labelH - 4);

    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(x, labelY, tw + pad * 2, labelH + 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, labelY, tw + pad * 2, labelH + 4);

    ctx.fillStyle = color;
    ctx.fillText(labelText, x + pad, labelY + 13);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    ctx.lineWidth = 1;
  }
}

export default function Dashboard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const detectionsRef = useRef<Detection[]>([]);
  const frameCountRef = useRef(0);
  const lastFpsSampleRef = useRef(performance.now());

  const [result, setResult] = useState<string>("Waiting...");
  const [status, setStatus] = useState<"ok" | "error" | "loading">("loading");
  const [footerTime, setFooterTime] = useState(() => Date.now());
  const [fps, setFps] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const pushHistory = useCallback((summary: string, detections: Detection[]) => {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      time: Date.now(),
      summary,
      detections,
    };
    setHistory((prev) => [entry, ...prev].slice(0, 5));
  }, []);

  // Open default webcam; user must grant permission (HTTPS or localhost).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setCameraError(null);
        setCameraReady(true);
        setStatus("loading");
      } catch {
        if (!cancelled) {
          setCameraError(
            "Camera permission denied or no camera found. Allow access in the browser bar and reload.",
          );
          setStatus("error");
          setResult("Camera unavailable");
          setCameraReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const v = videoRef.current;
      if (v) v.srcObject = null;
      setCameraReady(false);
    };
  }, []);

  // Redraw detection boxes on top of the video (~30 FPS).
  useEffect(() => {
    if (!cameraReady) return;

    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const targetFps = 30;
    const drawId = window.setInterval(() => {
      const now = performance.now();
      frameCountRef.current += 1;
      const elapsed = now - lastFpsSampleRef.current;
      if (elapsed >= 500) {
        const f = Math.round((frameCountRef.current / elapsed) * 1000);
        setFps(f);
        frameCountRef.current = 0;
        lastFpsSampleRef.current = now;
      }

      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        drawDetectionOverlays(ctx, detectionsRef.current);
      }
    }, 1000 / targetFps);

    return () => clearInterval(drawId);
  }, [cameraReady]);

  useEffect(() => {
    const t = window.setInterval(() => setFooterTime(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Copy current video frame to off-screen canvas and POST as PNG (mock AI unchanged).
  useEffect(() => {
    if (!cameraReady) return;

    const runAnalyze = () => {
      const video = videoRef.current;
      const cap = captureCanvasRef.current;
      if (!video || !cap || video.readyState < 2) return;

      const cctx = cap.getContext("2d");
      if (!cctx) return;

      cctx.drawImage(video, 0, 0, W, H);

      cap.toBlob(async (blob) => {
        if (!blob) return;
        const form = new FormData();
        form.append("file", blob, "frame.png");

        try {
          const res = await fetch("/api/analyze", {
            method: "POST",
            body: form,
          });
          const data = await res.json();
          const list: Detection[] = Array.isArray(data.detections)
            ? data.detections
            : [];
          detectionsRef.current = list;
          const labelText =
            typeof data.label === "string" ? data.label : "No label";
          setResult(labelText);
          setStatus("ok");
          if (list.length) {
            pushHistory(labelText, list);
          }
        } catch {
          detectionsRef.current = [];
          setResult("Backend unreachable");
          setStatus("error");
        }
      }, "image/png");
    };

    const interval = setInterval(runAnalyze, 2000);
    runAnalyze();
    return () => clearInterval(interval);
  }, [cameraReady, pushHistory]);

  const timeStr = new Date(footerTime).toLocaleTimeString("en-GB", {
    hour12: false,
  });

  return (
    <main className="min-h-screen bg-gray-950 p-4 text-white sm:p-6">
      <h1 className="mb-6 text-center text-xl font-bold text-green-400 sm:text-2xl">
        🛰️ Jetson AI Dashboard
      </h1>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 lg:flex-row lg:items-start lg:justify-center">
        <div className="mx-auto flex w-full min-w-0 max-w-[640px] flex-1 flex-col">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border-2 border-green-500 bg-black shadow-lg shadow-green-900">
            <video
              ref={videoRef}
              className="absolute inset-0 block h-full w-full object-cover"
              playsInline
              muted
              autoPlay
            />
            <canvas
              ref={overlayCanvasRef}
              width={W}
              height={H}
              className="pointer-events-none absolute inset-0 block h-full w-full"
            />
            {/* Off-DOM-sized canvas for snapshots only (no overlays in the upload). */}
            <canvas
              ref={captureCanvasRef}
              width={W}
              height={H}
              className="pointer-events-none fixed top-0 left-[-10000px] opacity-0"
              aria-hidden
            />

            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-4 text-center">
                <p className="max-w-sm font-mono text-sm text-red-300">
                  {cameraError}
                </p>
              </div>
            )}

            <div
              className={`absolute top-3 right-3 rounded px-2 py-1 font-mono text-xs font-bold ${
                status === "ok"
                  ? "bg-green-600"
                  : status === "error"
                    ? "bg-red-600"
                    : "bg-yellow-600"
              }`}
            >
              {status.toUpperCase()}
            </div>
          </div>

          <div className="mt-0 rounded-b-lg border border-t border-gray-700/80 border-t-gray-600 bg-[#0d1117] px-4 py-3 font-mono text-sm text-green-300 shadow-inner">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-green-400">🤖 {result}</span>
              <span className="text-xs text-gray-500">
                ~{fps} FPS · AI 2s · UI {timeStr}
              </span>
            </div>
          </div>
        </div>

        <aside className="mx-auto w-full shrink-0 rounded-lg border border-gray-700 bg-[#111827] p-4 lg:mx-0 lg:w-72">
          <h2 className="mb-3 border-b border-gray-600 pb-2 font-mono text-sm font-bold uppercase tracking-wide text-gray-300">
            Detection history
          </h2>
          {history.length === 0 ? (
            <p className="font-mono text-xs text-gray-500">
              No runs yet — waiting for AI…
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="rounded border border-gray-700/80 bg-black/30 p-2 font-mono text-xs text-gray-300"
                >
                  <div className="mb-1 text-[10px] uppercase text-gray-500">
                    {new Date(h.time).toLocaleTimeString("en-GB", {
                      hour12: false,
                      fractionalSecondDigits: 3,
                    })}
                  </div>
                  <div className="text-green-400/90">{h.summary}</div>
                  <ul className="mt-1 space-y-0.5 text-gray-400">
                    {h.detections.map((d, i) => (
                      <li key={`${h.id}-${i}`}>
                        {d.label}{" "}
                        <span className="text-gray-500">
                          ({(d.confidence * 100).toFixed(0)}%)
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}
