import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M2-2026!";
const runCode = Date.now().toString().slice(-8);

// Columnas legibles por `authenticated`: cost_cents queda fuera a
// propósito, y por eso nunca se pide `*` sobre variants.
const VARIANT_COLUMNS = "id, product_id, sku, price_cents, legacy_sicar_code";

type Fixture = { id: string; client: SupabaseClient };
const state = {
  cashier: null as Fixture | null,
  categoryId: "",
  productId: "",
  variantId: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function serverClient() {
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.sequential("M2: catálogo, variantes y códigos", () => {
  beforeAll(async () => {
    const server = serverClient();

    const { data: roles } = await server.from("roles").select("id, code");
    const cashierRoleId = (roles ?? []).find((r) => r.code === "CASHIER")!.id;

    const { data: location } = await server
      .from("locations")
      .insert({ code: `M2${runCode}`, name: "Catálogo prueba", type: "STORE" })
      .select("id")
      .single();

    const email = `m2-cashier-${runCode}@vaquero.test`;
    const { data: authData, error: authError } =
      await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    expect(authError).toBeNull();
    const cashierId = authData.user!.id;

    await server.from("app_users").insert({
      id: cashierId,
      employee_code: `M2C${runCode}`,
      full_name: "Cajera de prueba M2",
      email,
      role_id: cashierRoleId,
    });
    await server
      .from("user_locations")
      .insert({ user_id: cashierId, location_id: location!.id });

    const cashierClient = publicClient();
    const { error: signInError } = await cashierClient.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();
    state.cashier = { id: cashierId, client: cashierClient };

    const { data: category } = await server
      .from("categories")
      .insert({
        name: `Botas ${runCode}`,
        default_size_scale_code: "CALZADO_MX",
      })
      .select("id")
      .single();
    state.categoryId = category!.id;

    const { data: product } = await server
      .from("products")
      .insert({ name: `Bota Cuadra ${runCode}`, category_id: state.categoryId })
      .select("id")
      .single();
    state.productId = product!.id;

    const { data: variant } = await server
      .from("variants")
      .insert({
        product_id: state.productId,
        sku: `BC-${runCode}-26`,
        price_cents: 189900,
        cost_cents: 95000,
        legacy_sicar_code: `SIC-${runCode}`,
      })
      .select("id")
      .single();
    state.variantId = variant!.id;
  });

  it("ordena las tallas de calzado por su orden real, no alfabético", async () => {
    const { data, error } = await serverClient()
      .from("attribute_values")
      .select("value")
      .eq("scale_code", "CALZADO_MX")
      .gte("display_order", 25)
      .lte("display_order", 26)
      .order("display_order");

    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.value)).toEqual([
      "25.0",
      "25.5",
      "26.0",
    ]);
  });

  it("rechaza un valor de atributo repetido aunque no tenga escala", async () => {
    const server = serverClient();
    const color = { type_code: "COLOR", value: `Negro ${runCode}` };

    const { error: first } = await server
      .from("attribute_values")
      .insert(color);
    expect(first).toBeNull();

    const { error: second } = await server
      .from("attribute_values")
      .insert(color);
    expect(second).not.toBeNull();
  });

  it("impide modificar un código heredado de SICAR", async () => {
    const { error } = await serverClient()
      .from("variants")
      .update({ legacy_sicar_code: "OTRO" })
      .eq("id", state.variantId);

    expect(error?.message).toContain("LEGACY_CODE_IMMUTABLE");
  });

  it("permite cambiar el precio y lo registra en la bitácora", async () => {
    const server = serverClient();
    const { error } = await server
      .from("variants")
      .update({ price_cents: 169900 })
      .eq("id", state.variantId);
    expect(error).toBeNull();

    const { data } = await server
      .from("audit_log")
      .select("before_data, after_data")
      .eq("entity_type", "variants")
      .eq("entity_id", state.variantId)
      .not("before_data", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(1);

    const entry = (data ?? [])[0] as
      | {
          before_data: Record<string, unknown>;
          after_data: Record<string, unknown>;
        }
      | undefined;
    expect(entry?.before_data.price_cents).toBe(189900);
    expect(entry?.after_data.price_cents).toBe(169900);
  });

  it("rechaza dos variantes con el mismo código de barras", async () => {
    const server = serverClient();
    const { data: other } = await server
      .from("variants")
      .insert({
        product_id: state.productId,
        sku: `BC-${runCode}-27`,
        price_cents: 189900,
      })
      .select("id")
      .single();

    const code = `750${runCode}90`;
    const { error: first } = await server.from("barcodes").insert({
      variant_id: state.variantId,
      code,
      symbology: "EAN13",
      source: "GENERATED",
    });
    expect(first).toBeNull();

    const { error: second } = await server.from("barcodes").insert({
      variant_id: other!.id,
      code,
      symbology: "EAN13",
      source: "GENERATED",
    });
    expect(second).not.toBeNull();
  });

  it("impide borrar un código de barras heredado de SICAR", async () => {
    const server = serverClient();
    const code = `SIC-BC-${runCode}`;
    await server.from("barcodes").insert({
      variant_id: state.variantId,
      code,
      symbology: "LEGACY",
      source: "SICAR",
    });

    const { error } = await server.from("barcodes").delete().eq("code", code);
    expect(error?.message).toContain("LEGACY_BARCODE_IMMUTABLE");
  });

  it("deja que la cajera lea el catálogo", async () => {
    const { data, error } = await state
      .cashier!.client.from("variants")
      .select(VARIANT_COLUMNS)
      .eq("id", state.variantId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("no deja que la cajera vea el costo", async () => {
    const { error } = await state
      .cashier!.client.from("variants")
      .select("id, cost_cents")
      .eq("id", state.variantId);

    expect(error).not.toBeNull();
  });

  it("no deja que la cajera dé de alta ni edite productos", async () => {
    const cashier = state.cashier!.client;

    const { error: insertError } = await cashier
      .from("products")
      .insert({ name: "No debería entrar", category_id: state.categoryId });
    expect(insertError).not.toBeNull();

    const { error: updateError } = await cashier
      .from("variants")
      .update({ price_cents: 1 })
      .eq("id", state.variantId);
    expect(updateError).not.toBeNull();

    const { data } = await serverClient()
      .from("variants")
      .select("price_cents")
      .eq("id", state.variantId)
      .single();
    expect(data!.price_cents).toBe(169900);
  });

  it("niega el catálogo al rol anónimo", async () => {
    const anon = publicClient();
    const { data, error } = await anon
      .from("products")
      .select("id")
      .eq("id", state.productId);

    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});
