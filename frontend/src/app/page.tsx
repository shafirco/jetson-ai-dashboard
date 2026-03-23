"use client";
import { useCallback, useEffect, useRef, useState } from "react";

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

function drawScene(ctx: CanvasRenderingContext2D) {
  const now = performance.now();
  const t = now * 0.001;

  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "#ffffff11";
  for (let i = 0; i < W; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, H);
    ctx.stroke();
  }
  for (let i = 0; i < H; i += 40) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(W, i);
    ctx.stroke();
  }

  ctx.fillStyle = "#00ff88";
  ctx.font = "bold 18px monospace";
  ctx.fillText("● JETSON LIVE FEED", 20, 36);

  if (Math.floor(now / 500) % 2 === 0) {
    ctx.fillStyle = "#ff4444";
    ctx.font = "bold 14px monospace";
    ctx.fillText("● REC", 220, 36);
  }

  ctx.fillStyle = "#88ffcc";
  ctx.font = "14px monospace";
  const wall = Date.now();
  const ms = String(Math.floor((wall % 1000) / 10)).padStart(2, "0");
  const clock = new Date(wall).toLocaleTimeString("en-GB", {
    hour12: false,
  });
  ctx.fillText(`${clock}.${ms}`, W - 210, 36);

  const walk = Math.sin(t * 1.4) * 45;
  ctx.fillStyle = "#ffffff33";
  ctx.fillRect(80 + walk, 80, 80, 150);
  ctx.fillStyle = "#ffffff44";
  ctx.beginPath();
  ctx.arc(120 + walk, 60, 30, 0, Math.PI * 2);
  ctx.fill();

  const carX = 280 + Math.sin(t * 0.9) * 100;
  ctx.fillStyle = "#4444ff55";
  ctx.fillRect(carX, 200, 180, 80);
  ctx.fillRect(carX + 40, 170, 100, 40);

  const scanY = ((now / 12) % (H - 40)) + 20;
  ctx.strokeStyle = "#00ff8833";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, scanY);
  ctx.lineTo(W, scanY);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function adjustBboxForMotion(d: Detection, now: number): Bbox {
  const t = now * 0.001;
  const walk = Math.sin(t * 1.4) * 45;
  const carShift = Math.sin(t * 0.9) * 100;
  const { bbox, label } = d;
  if (label === "person") {
    return { ...bbox, x: bbox.x + walk };
  }
  if (label === "car" || label === "truck" || label === "bus") {
    return { ...bbox, x: bbox.x + carShift };
  }
  return { ...bbox };
}

function drawDetectionOverlays(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  now: number,
) {
  for (const d of detections) {
    const box = adjustBboxForMotion(d, now);
    const { x, y, width, height } = box;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectionsRef = useRef<Detection[]>([]);
  const frameCountRef = useRef(0);
  const lastFpsSampleRef = useRef(performance.now());

  const [result, setResult] = useState<string>("Waiting...");
  const [status, setStatus] = useState<"ok" | "error" | "loading">("loading");
  const [footerTime, setFooterTime] = useState(() => Date.now());
  const [fps, setFps] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const pushHistory = useCallback((summary: string, detections: Detection[]) => {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      time: Date.now(),
      summary,
      detections,
    };
    setHistory((prev) => [entry, ...prev].slice(0, 5));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });
    if (!ctx) return;

    const fps = 30;
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

      drawScene(ctx);
      drawDetectionOverlays(ctx, detectionsRef.current, now);
    }, 1000 / fps);

    return () => clearInterval(drawId);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setFooterTime(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const runAnalyze = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.toBlob(async (blob) => {
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
  }, [pushHistory]);

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
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border-2 border-green-500 shadow-lg shadow-green-900">
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="absolute inset-0 block h-full w-full"
            />

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
