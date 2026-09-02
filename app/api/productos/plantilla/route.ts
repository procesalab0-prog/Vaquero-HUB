import ExcelJS from "exceljs";

import { requirePermission } from "@/lib/auth/authorization";
import { catalogImportHeaders } from "@/lib/catalog-import-shared";

export const runtime = "nodejs";

function attachment(body: BodyInit, type: string, filename: string) {
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  try {
    const { supabase } = await requirePermission("products.create");
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
    if (format === "csv") {
      return attachment(
        `\uFEFF${catalogImportHeaders.join(",")}\r\n`,
        "text/csv; charset=utf-8",
        "plantilla-productos-mi-tienda-sm.csv",
      );
    }

    const [categories, brands, values] = await Promise.all([
      supabase
        .from("categories")
        .select("name")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("brands")
        .select("name")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("attribute_values")
        .select("type_code, value, scale_code")
        .in("type_code", ["COLOR", "TALLA"])
        .order("display_order"),
    ]);
    if (categories.error || brands.error || values.error) {
      throw new Error("CATALOGS_UNAVAILABLE");
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Mi Tienda SM · ProcesaLab";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Importacion", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.addRow([...catalogImportHeaders]);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF9C2F1F" },
    };
    sheet.columns = [
      { width: 30 },
      { width: 22 },
      { width: 20 },
      { width: 34 },
      { width: 18 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 22 },
    ];
    sheet.getColumn(9).numFmt = "@";
    sheet.autoFilter = "A1:I1";

    const catalogs = workbook.addWorksheet("Catalogos");
    catalogs.state = "veryHidden";
    catalogs.addRow(["Categorias", "Marcas", "Colores", "Tallas"]);
    const colorValues = (values.data ?? []).filter(
      (value) => value.type_code === "COLOR",
    );
    const sizeValues = (values.data ?? []).filter(
      (value) => value.type_code === "TALLA",
    );
    const catalogLength = Math.max(
      categories.data?.length ?? 0,
      brands.data?.length ?? 0,
      colorValues.length,
      sizeValues.length,
      1,
    );
    for (let index = 0; index < catalogLength; index += 1) {
      catalogs.addRow([
        categories.data?.[index]?.name ?? "",
        brands.data?.[index]?.name ?? "",
        colorValues[index]?.value ?? "",
        sizeValues[index]?.value ?? "",
      ]);
    }
    for (let row = 2; row <= 501; row += 1) {
      sheet.getCell(`B${row}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`Catalogos!$A$2:$A$${(categories.data?.length ?? 0) + 1}`],
      };
      if ((brands.data?.length ?? 0) > 0) {
        sheet.getCell(`C${row}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`Catalogos!$B$2:$B$${(brands.data?.length ?? 0) + 1}`],
        };
      }
      sheet.getCell(`E${row}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`Catalogos!$C$2:$C$${colorValues.length + 1}`],
      };
      sheet.getCell(`F${row}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`Catalogos!$D$2:$D$${sizeValues.length + 1}`],
      };
      sheet.getCell(`I${row}`).numFmt = "@";
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return attachment(
      new Uint8Array(buffer),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "plantilla-productos-mi-tienda-sm.xlsx",
    );
  } catch (error) {
    const status =
      error instanceof Error && error.message === "NOT_AUTHENTICATED"
        ? 401
        : 403;
    return Response.json(
      { error: "No tienes permiso para descargar esta plantilla." },
      { status },
    );
  }
}
