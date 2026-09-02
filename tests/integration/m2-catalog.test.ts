import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M2-2026!";
const runCode = Date.now().toString().slice(-8);

type Fixture = { id: string; client: SupabaseClient };
const state = {
  admin: null as Fixture | null,
  cashier: null as Fixture | null,
  warehouse: null as Fixture | null,
  categoryId: "",
  colorIds: {} as Record<string, string>,
  sizeIds: [] as Array<{ id: string; value: string; display_order: number }>,
  productId: "",
  variantIds: [] as string[],
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.sequential("M2: catálogo, variantes, códigos y RLS", () => {
  beforeAll(async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: roles } = await server.from("roles").select("id, code");
    const roleIds = Object.fromEntries(
      (roles ?? []).map((role) => [role.code, role.id]),
    );

    for (const definition of [
      { key: "admin", role: "ADMIN" },
      { key: "cashier", role: "CASHIER" },
      { key: "warehouse", role: "WAREHOUSE" },
    ] as const) {
      const email = `m2-${definition.key}-${runCode}@vaquero.test`;
      const { data: authData, error: authError } =
        await server.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
      expect(authError).toBeNull();
      const id = authData.user!.id;
      const { error: profileError } = await server.from("app_users").insert({
        id,
        employee_code: `M2${definition.key.toUpperCase()}${runCode}`,
        full_name: `M2 ${definition.key}`,
        email,
        role_id: roleIds[definition.role],
      });
      expect(profileError).toBeNull();
      const client = publicClient();
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      expect(signInError).toBeNull();
      state[definition.key] = { id, client };
    }

    const { data: category, error: categoryError } = await server
      .from("categories")
      .select("id")
      .eq("name", "Botas")
      .single();
    expect(categoryError).toBeNull();
    state.categoryId = category!.id;

    const { data: colors, error: colorError } = await server
      .from("attribute_values")
      .insert([
        { type_code: "COLOR", value: `Negro ${runCode}`, display_order: 10 },
        { type_code: "COLOR", value: `Café ${runCode}`, display_order: 20 },
      ])
      .select("id, value");
    expect(colorError).toBeNull();
    state.colorIds = Object.fromEntries(
      (colors ?? []).map((color) => [color.value, color.id]),
    );

    const { data: sizes, error: sizeError } = await server
      .from("attribute_values")
      .select("id, value, display_order")
      .eq("type_code", "TALLA")
      .eq("scale_code", "CALZADO_MX")
      .gte("display_order", 25)
      .lte("display_order", 28.5)
      .order("display_order")
      .limit(8);
    expect(sizeError).toBeNull();
    state.sizeIds = (sizes ?? []) as typeof state.sizeIds;
    expect(state.sizeIds).toHaveLength(8);
  }, 30_000);

  it("ordena las tallas por display_order y no alfabéticamente", () => {
    expect(state.sizeIds.map((size) => size.value)).toEqual([
      "25",
      "25.5",
      "26",
      "26.5",
      "27",
      "27.5",
      "28",
      "28.5",
    ]);
  });

  it("genera atómicamente 2 colores por 8 tallas con un código por variante", async () => {
    const variants = Object.entries(state.colorIds).flatMap(
      ([color, colorId], colorIndex) =>
        state.sizeIds.map((size, sizeIndex) => ({
          sku: `M2-${runCode}-${colorIndex}-${sizeIndex}`,
          cost_cents: 120000,
          price_cents: 219900,
          legacy_sicar_code: `SICAR-${runCode}-${colorIndex}-${sizeIndex}`,
          barcode: `${runCode}${colorIndex}${String(sizeIndex).padStart(2, "0")}`,
          barcode_symbology: "CODE128",
          barcode_source: "SICAR",
          attributes: { COLOR: colorId, TALLA: size.id },
          color,
        })),
    );
    const { data, error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Bota matriz ${runCode}`,
        p_category_id: state.categoryId,
        p_variants: variants,
      },
    );
    expect(error).toBeNull();
    expect(data.variant_count).toBe(16);
    state.productId = data.product_id;

    const result = await state.admin!.client.rpc("search_catalog", {
      p_query: `Bota matriz ${runCode}`,
      p_limit: 30,
    });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(16);
    expect(
      result.data.every((variant: { primary_barcode: string }) =>
        Boolean(variant.primary_barcode),
      ),
    ).toBe(true);
    state.variantIds = result.data.map(
      (variant: { variant_id: string }) => variant.variant_id,
    );
  });

  it("encuentra la misma variante por código físico", async () => {
    const code = `${runCode}000`;
    const { data, error } = await state.cashier!.client.rpc("search_catalog", {
      p_query: code,
      p_limit: 10,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].primary_barcode).toBe(code);
  });

  it("oculta costos al cajero pero permite leer precio y atributos", async () => {
    const { data, error } = await state.cashier!.client.rpc("search_catalog", {
      p_query: `Bota matriz ${runCode}`,
      p_limit: 30,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(16);
    expect(
      data.every(
        (variant: { cost_cents: number | null }) => variant.cost_cents === null,
      ),
    ).toBe(true);
    expect(data[0].price_cents).toBe(219900);
    expect(data[0].attributes.TALLA).toBeTruthy();

    const direct = await state
      .cashier!.client.from("variants")
      .select("cost_cents");
    expect(direct.error).not.toBeNull();
  });

  it("rechaza un código duplicado y revierte el producto completo", async () => {
    const duplicateName = `Producto duplicado ${runCode}`;
    const { error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: duplicateName,
        p_category_id: state.categoryId,
        p_variants: [
          {
            sku: `M2-DUP-${runCode}`,
            cost_cents: 100,
            price_cents: 200,
            barcode: `${runCode}000`,
            attributes: { TALLA: state.sizeIds[0].id },
          },
        ],
      },
    );
    expect(error?.message).toContain("CATALOG_DUPLICATE_VALUE");

    const { data: products } = await state
      .admin!.client.from("products")
      .select("id")
      .eq("name", duplicateName);
    expect(products).toEqual([]);
  });

  it("impide cambiar códigos SICAR incluso con la clave de servidor", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const legacy = await server
      .from("variants")
      .update({ legacy_sicar_code: `CAMBIADO-${runCode}` })
      .eq("id", state.variantIds[0]);
    expect(legacy.error?.message).toContain("LEGACY_CODE_IMMUTABLE");

    const barcode = await server
      .from("barcodes")
      .update({ code: `CAMBIADO-${runCode}` })
      .eq("variant_id", state.variantIds[0]);
    expect(barcode.error?.message).toContain("SICAR_BARCODE_IMMUTABLE");
  });

  it("el cajero no puede crear productos ni cambiar precios", async () => {
    const create = await state.cashier!.client.rpc("create_catalog_product", {
      p_name: "No autorizado",
      p_category_id: state.categoryId,
      p_variants: [
        {
          sku: `NO-${runCode}`,
          cost_cents: 0,
          price_cents: 1,
          barcode: `NO-${runCode}`,
        },
      ],
    });
    expect(create.error).not.toBeNull();

    const update = await state
      .cashier!.client.from("variants")
      .update({ price_cents: 1 })
      .eq("id", state.variantIds[0]);
    expect(update.error).not.toBeNull();
  });

  // Los campos de aterrizaje de la migración sólo los escribe el importador
  // de M9. Escritos desde el alta manual quedaban permanentes —son
  // inmutables por diseño— y podían tumbar la migración real con una
  // violación de unicidad imposible de corregir.
  it("no deja reservar un código heredado de SICAR desde el alta manual", async () => {
    const { error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Intento legacy ${runCode}`,
        p_category_id: state.categoryId,
        p_variants: [
          {
            sku: `LEG-${runCode}`,
            barcode: `LEG-${runCode}`,
            cost_cents: 100,
            price_cents: 200,
            legacy_sicar_code: `SIC-${runCode}`,
          },
        ],
      },
    );
    expect(error?.message).toContain("LEGACY_FIELDS_NOT_ALLOWED");
  });

  it("no deja fijar identificadores de WooCommerce desde el alta manual", async () => {
    const { error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Intento woo ${runCode}`,
        p_category_id: state.categoryId,
        p_variants: [
          {
            sku: `WOO-${runCode}`,
            barcode: `WOO-${runCode}`,
            cost_cents: 100,
            price_cents: 200,
            woocommerce_product_id: 99,
          },
        ],
      },
    );
    expect(error?.message).toContain("LEGACY_FIELDS_NOT_ALLOWED");
  });

  it("no deja marcar un código de barras como de SICAR", async () => {
    const { error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Intento origen ${runCode}`,
        p_category_id: state.categoryId,
        p_variants: [
          {
            sku: `SRC-${runCode}`,
            barcode: `SRC-${runCode}`,
            cost_cents: 100,
            price_cents: 200,
            barcode_source: "SICAR",
          },
        ],
      },
    );
    expect(error?.message).toContain("INVALID_BARCODE_SOURCE");
  });

  it("encuentra un producto acentuado se escriba con acento o sin él", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await server
      .from("products")
      .update({ name: `Botín Acentuado ${runCode}` })
      .eq("id", state.productId);

    const conAcento = await state.admin!.client.rpc("search_catalog", {
      p_query: "botín acentuado",
    });
    const sinAcento = await state.admin!.client.rpc("search_catalog", {
      p_query: "botin acentuado",
    });

    expect(conAcento.error).toBeNull();
    expect((conAcento.data ?? []).length).toBeGreaterThan(0);
    expect((sinAcento.data ?? []).length).toBe((conAcento.data ?? []).length);
  });

  it("no trata los comodines del buscador como comodines", async () => {
    const { data, error } = await state.admin!.client.rpc("search_catalog", {
      p_query: "%",
    });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
