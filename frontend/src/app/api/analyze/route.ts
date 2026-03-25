import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy: forwards multipart frame to FastAPI inside Docker (backend:8000)
 * or any base URL from NEXT_PUBLIC_BACKEND_URL.
 */
function backendAnalyzeUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://backend:8000";
  const base = raw.replace(/\/$/, "");
  return `${base}/analyze`;
}

export async function POST(req: NextRequest) {
  // Preserve multipart field names expected by FastAPI (file=...).
  const formData = await req.formData();

  const response = await fetch(backendAnalyzeUrl(), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    return NextResponse.json(
      { status: "error", label: `Backend ${response.status}`, detections: [] },
      { status: response.status },
    );
  }

  // Pass JSON through unchanged so the client keeps a single response shape.
  const data = await response.json();
  return NextResponse.json(data);
}
