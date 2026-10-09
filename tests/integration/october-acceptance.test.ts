import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const run = crypto.randomUUID().slice(0, 8).toUpperCase();
let server: SupabaseClient,
  admin: SupabaseClient,
  cashier: SupabaseClient,
  other: SupabaseClient;
let loc: string,
  elsewhere: string,
  variant: string,
  session: string,
  register: string,
  cashierSession: string;
const employee = "OA" + run;
async function rpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const r = await client.rpc(name, args);
  expect(r.error, `${name}: ${r.error?.message}`).toBeNull();
  return r.data;
}
async function stock() {
  const r = await server
    .from("inventory_by_location")
    .select("qty")
    .eq("variant_id", variant)
    .eq("location_id", loc)
    .single();
  expect(r.error).toBeNull();
  return Number(r.data!.qty);
}
async function authorization() {
  const r = await rpc(admin, "verify_supervisor_pin", {
    p_employee_code: employee,
    p_pin: "6743",
    p_permission: "returns.authorize",
  });
  expect(r.status).toBe("AUTHORIZED");
  return r.authorization_token;
}
describe.sequential("October acceptance with real Auth/PostgREST", () => {
  beforeAll(async () => {
    server = createClient(url, secret, { auth: { persistSession: false } });
    const locations = await server
      .from("locations")
      .insert([
        { code: "OA" + run, name: "October QA", type: "STORE" },
        { code: "OB" + run, name: "Other QA", type: "STORE" },
      ])
      .select("id,code");
    expect(locations.error).toBeNull();
    loc = locations.data!.find((x) => x.code === "OA" + run)!.id;
    elsewhere = locations.data!.find((x) => x.code === "OB" + run)!.id;
    const clients: SupabaseClient[] = [];
    for (const [i, roleCode] of ["ADMIN", "CASHIER", "MANAGER"].entries()) {
      const role = await server
        .from("roles")
        .select("id")
        .eq("code", roleCode)
        .single();
      expect(role.error).toBeNull();
      const email = `oct-${run}-${i}@vaquero.test`,
        password = "Only-local-QA-October-2026!";
      const u = await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(u.error).toBeNull();
      expect(
        (
          await server.from("app_users").insert({
            id: u.data.user!.id,
            email,
            employee_code: i === 0 ? employee : "O" + i + run,
            full_name: "QA " + roleCode,
            role_id: role.data!.id,
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await server.from("user_locations").insert({
            user_id: u.data.user!.id,
            location_id: i === 2 ? elsewhere : loc,
          })
        ).error,
      ).toBeNull();
      const c = createClient(url, key, { auth: { persistSession: false } });
      expect(
        (await c.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      clients.push(c);
    }
    [admin, cashier, other] = clients;
    await rpc(admin, "update_my_profile", {
      p_full_name: null,
      p_new_pin: "6743",
    });
    const category = await rpc(admin, "create_catalog_category", {
      p_name: "October " + run,
      p_size_scale_code: null,
    });
    const product = await rpc(admin, "create_catalog_product", {
      p_name: "October acceptance " + run,
      p_category_id: category.id,
      p_variants: [{ cost_cents: 10000, price_cents: 25000, attributes: {} }],
    });
    const v = await server
      .from("variants")
      .select("id")
      .eq("product_id", product.product_id)
      .single();
    expect(v.error).toBeNull();
    variant = v.data!.id;
    register = (
      await rpc(admin, "create_cash_register", {
        p_location_id: loc,
        p_code: "OA",
        p_name: "QA first",
      })
    ).id;
    session = (
      await rpc(admin, "open_cash_session", {
        p_register_id: register,
        p_opening_amount_cents: 100000,
      })
    ).id;
    const second = (
      await rpc(admin, "create_cash_register", {
        p_location_id: loc,
        p_code: "OB",
        p_name: "QA second",
      })
    ).id;
    cashierSession = (
      await rpc(cashier, "open_cash_session", {
        p_register_id: second,
        p_opening_amount_cents: 20000,
      })
    ).id;
  }, 30000);
  it("creates customers without granting credit and enforces category roles", async () => {
    const result = await rpc(admin, "create_customer", {
      p_full_name: "QA customer " + run,
      p_phone: "352" + String(Date.now()).slice(-7),
      p_email: null,
      p_birthdate: null,
      p_location_id: loc,
      p_privacy_notice_version: "qa-v1",
      p_marketing_consent: false,
    });
    expect(result).toBeTruthy();
    expect(
      (
        await cashier.rpc("create_catalog_category", {
          p_name: "Forbidden " + run,
          p_size_scale_code: null,
        })
      ).error?.message,
    ).toContain("NOT_AUTHORIZED");
  });
  it("adds stock exactly once, rejects stale snapshots and concurrent overwrites", async () => {
    const args = {
      p_id: crypto.randomUUID(),
      p_location_id: loc,
      p_items: [{ variant_id: variant, expected_qty: 0, qty: 5 }],
      p_note: "QA stock",
    };
    const first = await rpc(admin, "add_manual_stock", args);
    expect(first.repeated).toBe(false);
    expect((await rpc(admin, "add_manual_stock", args)).repeated).toBe(true);
    expect(await stock()).toBe(5);
    expect(
      (
        await admin.rpc("add_manual_stock", {
          ...args,
          p_id: crypto.randomUUID(),
        })
      ).error?.message,
    ).toContain("STALE_INVENTORY");
    const result = await Promise.all(
      [0, 1].map(() =>
        admin.rpc("add_manual_stock", {
          ...args,
          p_id: crypto.randomUUID(),
          p_items: [{ variant_id: variant, expected_qty: 5, qty: 1 }],
        }),
      ),
    );
    expect(result.filter((r) => !r.error)).toHaveLength(1);
    expect(result.find((r) => r.error)?.error?.message).toContain(
      "STALE_INVENTORY",
    );
    expect(await stock()).toBe(6);
  });
  it("blocks cross-location reads, writes and direct ledger access", async () => {
    for (const c of [cashier, other]) {
      expect(
        (
          await c.rpc("add_manual_stock", {
            p_id: crypto.randomUUID(),
            p_location_id: loc,
            p_items: [{ variant_id: variant, expected_qty: 6, qty: 1 }],
            p_note: "Forbidden",
          })
        ).error,
      ).not.toBeNull();
      expect(
        (await c.rpc("location_cash_cut", { p_location_id: loc })).error,
      ).not.toBeNull();
      expect(
        (
          await c.rpc("report_operational_costs", {
            p_location_id: loc,
            p_from: "2026-01-01",
            p_to: "2026-12-31",
          })
        ).error,
      ).not.toBeNull();
    }
    for (const table of [
      "manual_stock_entries",
      "location_cash_cuts",
      "operational_notifications",
    ])
      expect((await cashier.from(table).select("*")).error).not.toBeNull();
    expect(
      (
        await other.rpc("list_operational_notifications", {
          p_location_id: loc,
        })
      ).error,
    ).not.toBeNull();
  });
  it("sells credit plus debit once and refunds two partial returns without overpayment", async () => {
    const input = {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: session,
      p_items: [{ variant_id: variant, quantity: 2 }],
      p_payments: [
        {
          method_code: "CARD",
          card_kind: "CREDIT",
          amount_cents: 20000,
          reference: "QA-CREDIT",
        },
        {
          method_code: "CARD",
          card_kind: "DEBIT",
          amount_cents: 30000,
          reference: "QA-DEBIT",
        },
      ],
    };
    const sale = await rpc(admin, "create_sale", input);
    expect((await rpc(admin, "create_sale", input)).id).toBe(sale.id);
    expect(await stock()).toBe(4);
    const original = await rpc(admin, "get_sale_receipt", {
      p_sale_id: sale.id,
    });
    expect(
      original.payments.map((p: { card_kind: string }) => p.card_kind).sort(),
    ).toEqual(["CREDIT", "DEBIT"]);
    await rpc(admin, "request_sale_print", {
      p_sale_id: sale.id,
      p_document_type: "GIFT_RECEIPT",
    });
    const line = await server
      .from("sale_items")
      .select("id")
      .eq("sale_id", sale.id)
      .single();
    expect(line.error).toBeNull();
    for (let i = 0; i < 2; i++) {
      const args = {
        p_idempotency_key: crypto.randomUUID(),
        p_cash_session_id: session,
        p_original_sale_id: sale.id,
        p_items_in: [
          { sale_item_id: line.data!.id, quantity: 1, condition: "RESELLABLE" },
        ],
        p_items_out: [],
        p_charge_payments: [],
        p_refund_references: [
          { method_code: "CARD", reference: "QA-REFUND-" + i },
        ],
        p_authorization_token: await authorization(),
        p_reason: "QA partial refund",
      };
      const ret = await rpc(admin, "create_return_exchange", args);
      expect((await rpc(admin, "create_return_exchange", args)).id).toBe(
        ret.id,
      );
      const payments = await server
        .from("return_payments")
        .select("method_code,amount_cents")
        .eq("return_id", ret.id);
      expect(payments.error).toBeNull();
      expect(
        payments.data!.reduce((n, p) => n + Number(p.amount_cents), 0),
      ).toBe(25000);
      expect(payments.data!.every((p) => p.method_code === "CARD")).toBe(true);
    }
    expect(await stock()).toBe(6);
    expect(
      await rpc(admin, "get_sale_receipt", { p_sale_id: sale.id }),
    ).toEqual(original);
    const excess = await admin.rpc("create_return_exchange", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: session,
      p_original_sale_id: sale.id,
      p_items_in: [
        { sale_item_id: line.data!.id, quantity: 1, condition: "RESELLABLE" },
      ],
      p_items_out: [],
      p_charge_payments: [],
      p_refund_references: [{ method_code: "CARD", reference: "QA-EXCESS" }],
      p_authorization_token: await authorization(),
      p_reason: "QA over-return",
    });
    expect(excess.error).not.toBeNull();
  });
  it("cancels a combined-card sale without double-restoring inventory", async () => {
    const sale = await rpc(admin, "create_sale", {
      p_idempotency_key: crypto.randomUUID(),
      p_cash_session_id: session,
      p_items: [{ variant_id: variant, quantity: 1 }],
      p_payments: [
        {
          method_code: "CARD",
          card_kind: "CREDIT",
          amount_cents: 10000,
          reference: "QA-CANCEL-C",
        },
        {
          method_code: "CARD",
          card_kind: "DEBIT",
          amount_cents: 15000,
          reference: "QA-CANCEL-D",
        },
      ],
    });
    expect(await stock()).toBe(5);
    await rpc(admin, "cancel_sale", {
      p_sale_id: sale.id,
      p_reason: "QA combined cancellation",
    });
    expect(await stock()).toBe(6);
    const repeated = await admin.rpc("cancel_sale", {
      p_sale_id: sale.id,
      p_reason: "QA repeated cancellation",
    });
    expect(repeated.error?.message).toContain("SALE_NOT_CANCELLABLE");
    expect(await stock()).toBe(6);
  });
  it("consolidates two closed cash sessions with a shortage, stable replay and no duplicate cuts", async () => {
    const id = crypto.randomUUID();
    expect(
      (
        await admin.rpc("location_cash_cut", {
          p_location_id: loc,
          p_id: id,
          p_session_ids: [session, cashierSession],
        })
      ).error?.message,
    ).toContain("LOCATION_HAS_OPEN_SESSIONS");
    await rpc(admin, "close_cash_session", {
      p_session_id: session,
      p_counted_amount_cents: 99900,
      p_difference_reason: "QA shortage",
    });
    await rpc(cashier, "close_cash_session", {
      p_session_id: cashierSession,
      p_counted_amount_cents: 20000,
      p_difference_reason: null,
    });
    const preview = await rpc(admin, "location_cash_cut", {
      p_location_id: loc,
    });
    expect(preview).toMatchObject({
      open_sessions: 0,
      counted_cents: 119900,
      expected_cents: 120000,
      difference_cents: -100,
    });
    expect(preview.sessions).toHaveLength(2);
    const args = {
      p_location_id: loc,
      p_id: id,
      p_session_ids: [session, cashierSession],
    };
    const cut = await rpc(admin, "location_cash_cut", args);
    expect((await rpc(admin, "location_cash_cut", args)).id).toBe(cut.id);
    expect(
      (
        await admin.rpc("location_cash_cut", {
          ...args,
          p_id: crypto.randomUUID(),
        })
      ).error?.message,
    ).toContain("CUT_EMPTY");
  });
  it("acknowledges notifications per user and keeps operational switches off", async () => {
    const notices = await rpc(admin, "list_operational_notifications", {
      p_location_id: loc,
    });
    expect(notices.length).toBeGreaterThan(0);
    await rpc(admin, "ack_operational_notifications", {
      p_location_id: loc,
      p_ids: notices.map((n: { id: number }) => n.id),
    });
    expect(
      await rpc(admin, "list_operational_notifications", {
        p_location_id: loc,
      }),
    ).toEqual([]);
    expect(await rpc(cashier, "usd_checkout_available")).toBe(false);
    const costs = await rpc(admin, "report_operational_costs", {
      p_location_id: loc,
      p_from: new Date(Date.now() - 86400000).toISOString(),
      p_to: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(
      costs.entries.reduce(
        (n: number, e: { value_cents: number }) => n + Number(e.value_cents),
        0,
      ),
    ).toBe(60000);
  });
});
