import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { createCustomerInline } from "@/app/(workspace)/clientes/actions";
import { createCatalogCategory } from "@/app/(workspace)/productos/actions";
import {
  addManualStock,
  saveInlineInventoryQuantity,
} from "@/app/(workspace)/inventario/actions";
import {
  loadLocationCut,
  confirmLocationCut,
} from "@/app/(workspace)/caja/location-cut-actions";
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request))
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 100000)
    return NextResponse.json(
      { error: "Solicitud demasiado grande" },
      { status: 413 },
    );
  try {
    const { operation, input } = await request.json();
    let result: unknown;
    switch (operation) {
      case "customer.create": {
        const data = new FormData();
        for (const [key, value] of Object.entries(input))
          if (typeof value === "string") data.set(key, value);
        result = await createCustomerInline(data);
        break;
      }
      case "category.create":
        result = await createCatalogCategory(input.name, input.scale);
        break;
      case "inventory.quantity":
        result = await saveInlineInventoryQuantity(input);
        break;
      case "inventory.add":
        result = await addManualStock(input);
        break;
      case "cash.cut.preview":
        result = await loadLocationCut(input.locationId);
        break;
      case "cash.cut.confirm":
        result = await confirmLocationCut(
          input.locationId,
          input.id,
          input.sessionIds,
        );
        break;
      default:
        return NextResponse.json(
          { error: "Operación desconocida" },
          { status: 400 },
        );
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Solicitud inválida o sin sesión" },
      { status: 400 },
    );
  }
}
