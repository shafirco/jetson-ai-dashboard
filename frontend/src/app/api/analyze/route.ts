import { NextRequest, NextResponse } from "next/server";

function backendAnalyzeUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://backend:8000";
  const base = raw.replace(/\/$/, "");
  return `${base}/analyze`;
}

export async function POST(req: NextRequest) {
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

  const data = await response.json();
  return NextResponse.json(data);
}
