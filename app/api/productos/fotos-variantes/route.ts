import { NextResponse } from "next/server";
import { copyVariantPhotos } from "@/app/(workspace)/productos/fotos-migracion/actions";
export const maxDuration = 120;
export async function POST(request: Request) {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return NextResponse.json(
      { ok: false, message: "Solicitud no permitida." },
      { status: 403 },
    );
  const length = Number(request.headers.get("content-length"));
  if (length > 1024)
    return NextResponse.json(
      { ok: false, message: "Solicitud demasiado grande." },
      { status: 413 },
    );
  try {
    const body = await request.text();
    if (body.length > 1024) throw Error("BODY_LIMIT");
    const data = JSON.parse(body);
    if (
      Object.keys(data).length !== 1 ||
      typeof data.productId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        data.productId,
      )
    )
      throw Error("INVALID_ID");
    return NextResponse.json(await copyVariantPhotos(data.productId));
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "No se confirmó la copia. Revisa el resultado antes de reintentar.",
      },
      { status: 400 },
    );
  }
}
