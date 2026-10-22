import { NextResponse } from "next/server";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import {
  workerAuthorized,
  workerError,
} from "@/scripts/m9/woo-remote/trial-worker.mjs";
import { runWooTrialQueue } from "@/lib/m9-woo-worker-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL
  ) {
    return new NextResponse(null, { status: 404, headers });
  }
  if (
    !workerAuthorized(
      request.headers.get("authorization"),
      process.env.M9_WORKER_TOKEN_SHA256,
    )
  ) {
    return new NextResponse(null, { status: 401, headers });
  }
  // The caller cannot choose an actor, destination, request, window or operation.
  if (
    request.headers.get("content-length") &&
    Number(request.headers.get("content-length")) > 2
  ) {
    return new NextResponse(null, { status: 400, headers });
  }
  try {
    const reader = request.body?.getReader();
    if (!reader) return new NextResponse(null, { status: 400, headers });
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2) {
        await reader.cancel();
        return new NextResponse(null, { status: 400, headers });
      }
      chunks.push(part.value);
    }
    if (Buffer.concat(chunks).toString("utf8") !== "{}")
      return new NextResponse(null, { status: 400, headers });
    const result = await runWooTrialQueue();
    return NextResponse.json({ state: result.state }, { headers });
  } catch (error) {
    const code = workerError(error);
    console.error("M9_WOO_WORKER", code);
    return NextResponse.json(
      { code },
      { status: code === "WORKER_WINDOW_REQUIRED" ? 409 : 503, headers },
    );
  }
}
