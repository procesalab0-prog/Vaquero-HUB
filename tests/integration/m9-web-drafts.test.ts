import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, it, expect } from "vitest";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const server = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const anon = client();
let admin: SupabaseClient;
let cashier: SupabaseClient;
let category = "";
let pid = "";
const content = {
  name: "Ficha de prueba",
  base_code: "BASE000",
  description: "Texto <script>literal</script>",
  short_description: "BASE000",
  images: [],
  categories: [],
};
const createId = crypto.randomUUID();
let creation: Record<string, unknown>;
describe.sequential(
  "M9 fichas web: autorización, atomicidad y concurrencia",
  () => {
    beforeAll(async () => {
      expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
      const { data: roles } = await server.from("roles").select("id,code");
      for (const role of ["ADMIN", "CASHIER"]) {
        const suffix = crypto.randomUUID().slice(0, 8),
          email = `web-${suffix}@vaquero.test`,
          password = "Web-Prueba-2026!";
        const auth = await server.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        expect(auth.error).toBeNull();
        expect(
          (
            await server.from("app_users").insert({
              id: auth.data.user!.id,
              email,
              employee_code: `WEB${suffix.toUpperCase()}`,
              full_name: `Prueba ${role}`,
              role_id: roles!.find((r) => r.code === role)!.id,
            })
          ).error,
        ).toBeNull();
        const c = client();
        expect(
          (await c.auth.signInWithPassword({ email, password })).error,
        ).toBeNull();
        if (role === "ADMIN") admin = c;
        else cashier = c;
      }
      expect(
        (
          await server.rpc("configure_sicar_staging", {
            p_environment: "STAGING",
            p_enabled: true,
            p_confirmation: "STAGING CATALOG ONLY",
          })
        ).error,
      ).toBeNull();
      const c = await server
        .from("categories")
        .select("id")
        .eq("name", "Botas")
        .single();
      category = c.data!.id;
      creation = {
        p_name: `Web test ${createId}`,
        p_category_id: category,
        p_variants: [{ cost_cents: 100, price_cents: 200, attributes: {} }],
        p_brand_name: null,
        p_content: content,
        p_request_id: createId,
      };
    });
    it("niega anónimo, service role sin empleado y cajero", async () => {
      for (const c of [anon, server, cashier])
        expect(
          (await c.rpc("create_product_with_web_draft", creation)).error,
        ).not.toBeNull();
    });
    it("alta con ficha es atómica e idempotente aun con solicitudes simultáneas", async () => {
      const [a, b] = await Promise.all([
        admin.rpc("create_product_with_web_draft", creation),
        admin.rpc("create_product_with_web_draft", creation),
      ]);
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      expect(a.data).toEqual(b.data);
      pid = a.data.product_id;
      const r = await admin.rpc("read_web_draft", { p_product_id: pid });
      expect(r.error).toBeNull();
      expect(r.data.revision).toBe(1);
      expect(r.data.content).toEqual(content);
      expect(r.data.catalog.variants).toHaveLength(1);
      expect(
        (
          await server
            .from("inventory_by_location")
            .select("*")
            .in(
              "variant_id",
              r.data.catalog.variants.map((v: { id: string }) => v.id),
            )
        ).data,
      ).toEqual([]);
    });
    it("rechaza reutilizar una solicitud para otro contenido", async () =>
      expect(
        (
          await admin.rpc("create_product_with_web_draft", {
            ...creation,
            p_name: "Otro",
          })
        ).error?.message,
      ).toContain("WEB_REQUEST_REUSED"));
    it("rechaza payload ajeno sin dejar producto", async () => {
      const name = `INVALID ${crypto.randomUUID()}`;
      expect(
        (
          await admin.rpc("create_product_with_web_draft", {
            ...creation,
            p_name: name,
            p_request_id: crypto.randomUUID(),
            p_content: { ...content, stock: 10 },
          })
        ).error,
      ).not.toBeNull();
      expect(
        (await server.from("products").select("id").eq("name", name)).data,
      ).toEqual([]);
    });
    it("un cajero puede leer sin costos ni editar la ficha", async () => {
      const r = await cashier.rpc("read_web_draft", { p_product_id: pid });
      expect(r.error).toBeNull();
      expect(r.data.can_edit).toBe(false);
      expect(JSON.stringify(r.data)).not.toContain("cost_cents");
      expect(
        (
          await cashier.rpc("save_web_draft", {
            p_product_id: pid,
            p_content: content,
            p_revision: 1,
            p_fingerprint: r.data.fingerprint,
            p_request_id: crypto.randomUUID(),
          })
        ).error,
      ).not.toBeNull();
    });
    it("guardado repetido no duplica revisión ni modifica identidad y precio; detecta versión vieja", async () => {
      const before = (await admin.rpc("read_web_draft", { p_product_id: pid }))
        .data;
      const args = {
        p_product_id: pid,
        p_content: { ...content, description: "Actualizado" },
        p_revision: before.revision,
        p_fingerprint: before.fingerprint,
        p_request_id: crypto.randomUUID(),
      };
      const first = await admin.rpc("save_web_draft", args);
      expect(first.error).toBeNull();
      expect(first.data.revision).toBe(2);
      expect((await admin.rpc("save_web_draft", args)).data).toEqual(
        first.data,
      );
      expect(
        (
          await admin.rpc("save_web_draft", {
            ...args,
            p_request_id: crypto.randomUUID(),
            p_content: content,
          })
        ).error?.message,
      ).toContain("WEB_DRAFT_CHANGED");
      const after = (await admin.rpc("read_web_draft", { p_product_id: pid }))
        .data;
      expect(after.catalog).toEqual(before.catalog);
    });
    it("detecta cambios de precio posteriores a la revisión", async () => {
      const before = (await admin.rpc("read_web_draft", { p_product_id: pid }))
        .data;
      expect(
        (
          await server
            .from("variants")
            .update({ price_cents: 201 })
            .eq("id", before.catalog.variants[0].id)
        ).error,
      ).toBeNull();
      expect(
        (
          await admin.rpc("save_web_draft", {
            p_product_id: pid,
            p_content: content,
            p_revision: before.revision,
            p_fingerprint: before.fingerprint,
            p_request_id: crypto.randomUUID(),
          })
        ).error?.message,
      ).toContain("WEB_CATALOG_CHANGED");
    });
  },
);
