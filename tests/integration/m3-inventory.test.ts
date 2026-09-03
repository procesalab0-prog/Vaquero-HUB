import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M3-2026!";
const runCode = Date.now().toString().slice(-8);

type Fixture = { id: string; client: SupabaseClient };

const state = {
  server: null as SupabaseClient | null,
  admin: null as Fixture | null,
  manager: null as Fixture | null,
  cashier: null as Fixture | null,
  warehouse: null as Fixture | null,
  locationId: "",
  otherLocationId: "",
  variantId: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe.sequential("M3.1: libro y saldos de inventario", () => {
  beforeAll(async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    state.server = server;
    const { data: roles, error: rolesError } = await server
      .from("roles")
      .select("id, code");
    expect(rolesError).toBeNull();
    const roleIds = Object.fromEntries(
      (roles ?? []).map((role) => [role.code, role.id]),
    );

    const { data: locations, error: locationsError } = await server
      .from("locations")
      .insert([
        { code: `M3${runCode}A`, name: "M3 Sucursal A", type: "STORE" },
        { code: `M3${runCode}B`, name: "M3 Sucursal B", type: "STORE" },
      ])
      .select("id");
    expect(locationsError).toBeNull();
    state.locationId = locations![0].id;
    state.otherLocationId = locations![1].id;

    for (const definition of [
      { key: "admin", role: "ADMIN" },
      { key: "manager", role: "MANAGER" },
      { key: "cashier", role: "CASHIER" },
      { key: "warehouse", role: "WAREHOUSE" },
    ] as const) {
      const email = `m3-${definition.key}-${runCode}@vaquero.test`;
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
        employee_code: `M3${definition.key.toUpperCase()}${runCode}`,
        full_name: `M3 ${definition.key}`,
        email,
        role_id: roleIds[definition.role],
      });
      expect(profileError).toBeNull();
      const { error: assignmentError } = await server
        .from("user_locations")
        .insert({ user_id: id, location_id: state.locationId });
      expect(assignmentError).toBeNull();

      const client = publicClient();
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      expect(signInError).toBeNull();
      state[definition.key] = { id, client };
    }

    const { error: adminDestinationAssignmentError } = await server
      .from("user_locations")
      .insert({
        user_id: state.admin!.id,
        location_id: state.otherLocationId,
      });
    expect(adminDestinationAssignmentError).toBeNull();

    const { data: category, error: categoryError } = await server
      .from("categories")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    expect(categoryError).toBeNull();
    const created = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Producto inventario ${runCode}`,
        p_category_id: category!.id,
        p_variants: [{ cost_cents: 10000, price_cents: 20000, attributes: {} }],
      },
    );
    expect(created.error).toBeNull();
    const catalog = await state.admin!.client.rpc("search_catalog", {
      p_query: `Producto inventario ${runCode}`,
      p_limit: 5,
    });
    expect(catalog.error).toBeNull();
    state.variantId = catalog.data[0].variant_id;
  }, 30_000);

  it("inicia una variante nueva en cero sin inventar existencias", async () => {
    const { data, error } = await state.manager!.client.rpc(
      "get_inventory_snapshot",
      { p_location_id: state.locationId, p_query: runCode, p_limit: 10 },
    );
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Number(data[0].qty)).toBe(0);
    expect(Number(data[0].available_qty)).toBe(0);
  });

  it("no permite consultar una sucursal no asignada", async () => {
    const { error } = await state.cashier!.client.rpc(
      "get_inventory_snapshot",
      {
        p_location_id: state.otherLocationId,
        p_query: "",
        p_limit: 10,
      },
    );
    expect(error?.message).toContain("LOCATION_FORBIDDEN");
  });

  it("un cajero puede consultar pero no ajustar", async () => {
    const read = await state.cashier!.client.rpc("get_inventory_snapshot", {
      p_location_id: state.locationId,
      p_query: runCode,
      p_limit: 10,
    });
    expect(read.error).toBeNull();

    const adjustment = await state.cashier!.client.rpc(
      "apply_inventory_adjustment",
      {
        p_variant_id: state.variantId,
        p_location_id: state.locationId,
        p_expected_qty: 0,
        p_counted_qty: 2,
        p_reason: "CONTEO_FISICO",
        p_note: null,
      },
    );
    expect(adjustment.error?.message).toContain("NOT_AUTHORIZED");
  });

  it("registra el ajuste, el responsable y los saldos anterior y nuevo", async () => {
    const adjustment = await state.manager!.client.rpc(
      "apply_inventory_adjustment",
      {
        p_variant_id: state.variantId,
        p_location_id: state.locationId,
        p_expected_qty: 0,
        p_counted_qty: 3,
        p_reason: "CONTEO_FISICO",
        p_note: "Conteo de apertura",
      },
    );
    expect(adjustment.error).toBeNull();
    expect(adjustment.data).toMatchObject({
      status: "UPDATED",
      previous_qty: 0,
      new_qty: 3,
      difference: 3,
    });

    const history = await state.manager!.client.rpc(
      "list_inventory_movements",
      { p_location_id: state.locationId, p_limit: 10 },
    );
    expect(history.error).toBeNull();
    expect(history.data[0]).toMatchObject({
      variant_id: state.variantId,
      movement_type: "ADJUSTMENT",
      reference_type: "INVENTORY_ADJUSTMENT",
      user_name: "M3 manager",
    });
    expect(Number(history.data[0].previous_qty)).toBe(0);
    expect(Number(history.data[0].new_qty)).toBe(3);
  });

  it("rechaza motivos libres y no crea movimientos", async () => {
    const before = await state.manager!.client.rpc("list_inventory_movements", {
      p_location_id: state.locationId,
      p_limit: 100,
    });
    const result = await state.manager!.client.rpc(
      "apply_inventory_adjustment",
      {
        p_variant_id: state.variantId,
        p_location_id: state.locationId,
        p_expected_qty: 3,
        p_counted_qty: 4,
        p_reason: "porque sí",
        p_note: null,
      },
    );
    expect(result.error?.message).toContain("INVALID_ADJUSTMENT");
    const after = await state.manager!.client.rpc("list_inventory_movements", {
      p_location_id: state.locationId,
      p_limit: 100,
    });
    expect(after.data).toHaveLength(before.data.length);
  });

  it("dos conteos paralelos sobre el mismo saldo no se pisan", async () => {
    const calls = await Promise.all([
      state.manager!.client.rpc("apply_inventory_adjustment", {
        p_variant_id: state.variantId,
        p_location_id: state.locationId,
        p_expected_qty: 3,
        p_counted_qty: 5,
        p_reason: "CONTEO_FISICO",
        p_note: "Conteo paralelo A",
      }),
      state.manager!.client.rpc("apply_inventory_adjustment", {
        p_variant_id: state.variantId,
        p_location_id: state.locationId,
        p_expected_qty: 3,
        p_counted_qty: 6,
        p_reason: "CONTEO_FISICO",
        p_note: "Conteo paralelo B",
      }),
    ]);
    expect(calls.filter((result) => result.error === null)).toHaveLength(1);
    expect(
      calls.filter((result) =>
        result.error?.message.includes("STALE_INVENTORY"),
      ),
    ).toHaveLength(1);

    const snapshot = await state.manager!.client.rpc("get_inventory_snapshot", {
      p_location_id: state.locationId,
      p_query: runCode,
      p_limit: 10,
    });
    expect([5, 6]).toContain(Number(snapshot.data[0].qty));
  });

  it("ni la clave de servidor puede alterar o borrar el libro", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await server
      .from("inventory_movements")
      .select("id")
      .eq("variant_id", state.variantId)
      .limit(1)
      .single();
    expect(data?.id).toBeTruthy();

    const update = await server
      .from("inventory_movements")
      .update({ quantity: 999 })
      .eq("id", data!.id);
    const deletion = await server
      .from("inventory_movements")
      .delete()
      .eq("id", data!.id);
    expect(update.error).not.toBeNull();
    expect(deletion.error).not.toBeNull();
  });

  it("la suma del libro coincide con el saldo materializado", async () => {
    const { data, error } = await state.admin!.client.rpc(
      "check_inventory_invariant",
    );
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cierra un conteo contra el saldo vigente y señala movimientos posteriores", async () => {
    const snapshot = await state.manager!.client.rpc("get_inventory_snapshot", {
      p_location_id: state.locationId,
      p_query: runCode,
      p_limit: 10,
    });
    const initial = Number(snapshot.data[0].qty);
    const created = await state.manager!.client.rpc("create_inventory_count", {
      p_location_id: state.locationId,
      p_scope: { type: "SELECTED" },
    });
    expect(created.error).toBeNull();
    const countId = created.data.id as string;

    const recorded = await state.manager!.client.rpc(
      "record_inventory_count_item",
      {
        p_count_id: countId,
        p_variant_id: state.variantId,
        p_counted_qty: initial + 1,
      },
    );
    expect(recorded.error).toBeNull();

    const movementAfterCount = await state.manager!.client.rpc(
      "apply_inventory_adjustment",
      {
        p_variant_id: state.variantId,
        p_location_id: state.locationId,
        p_expected_qty: initial,
        p_counted_qty: initial + 2,
        p_reason: "CONTEO_FISICO",
        p_note: "Movimiento posterior a captura",
      },
    );
    expect(movementAfterCount.error).toBeNull();

    const closed = await state.manager!.client.rpc("close_inventory_count", {
      p_count_id: countId,
    });
    expect(closed.error).toBeNull();
    expect(closed.data).toMatchObject({
      status: "CLOSED",
      adjusted_items: 1,
      warnings: 1,
    });

    const { data: items, error: itemsError } = await state
      .manager!.client.from("inventory_count_items")
      .select(
        "system_qty, counted_qty, difference, had_movement_after_count, movement_id",
      )
      .eq("count_id", countId);
    expect(itemsError).toBeNull();
    expect(items).toHaveLength(1);
    expect(Number(items![0].system_qty)).toBe(initial + 2);
    expect(Number(items![0].counted_qty)).toBe(initial + 1);
    expect(Number(items![0].difference)).toBe(-1);
    expect(items![0].had_movement_after_count).toBe(true);
    expect(items![0].movement_id).toBeTruthy();
  });

  it("serializa el cierre de conteo contra otro ajuste de la misma variante", async () => {
    const snapshot = await state.manager!.client.rpc("get_inventory_snapshot", {
      p_location_id: state.locationId,
      p_query: runCode,
      p_limit: 10,
    });
    const initial = Number(snapshot.data[0].qty);
    const created = await state.manager!.client.rpc("create_inventory_count", {
      p_location_id: state.locationId,
      p_scope: { type: "SELECTED" },
    });
    const countId = created.data.id as string;
    await state.manager!.client.rpc("record_inventory_count_item", {
      p_count_id: countId,
      p_variant_id: state.variantId,
      p_counted_qty: initial + 1,
    });

    const [closed, adjusted] = await Promise.all([
      state.manager!.client.rpc("close_inventory_count", {
        p_count_id: countId,
      }),
      state.manager!.client.rpc("apply_inventory_adjustment", {
        p_variant_id: state.variantId,
        p_location_id: state.locationId,
        p_expected_qty: initial,
        p_counted_qty: initial + 2,
        p_reason: "CONTEO_FISICO",
        p_note: "Competidor concurrente",
      }),
    ]);
    expect(closed.error).toBeNull();
    if (adjusted.error) {
      expect(adjusted.error.message).toContain("STALE_INVENTORY");
    }

    const invariant = await state.admin!.client.rpc(
      "check_inventory_invariant",
    );
    expect(invariant.error).toBeNull();
    expect(invariant.data).toEqual([]);
  });

  it("mantiene el total global y la mercancía fuera de ambos extremos durante el tránsito", async () => {
    const current = await state.manager!.client.rpc("get_inventory_snapshot", {
      p_location_id: state.locationId,
      p_query: runCode,
      p_limit: 10,
    });
    const sourceBeforeLoad = Number(current.data[0].qty);
    const load = await state.manager!.client.rpc("apply_inventory_adjustment", {
      p_variant_id: state.variantId,
      p_location_id: state.locationId,
      p_expected_qty: sourceBeforeLoad,
      p_counted_qty: 20,
      p_reason: "CONTEO_FISICO",
      p_note: "Existencia para prueba de traspaso",
    });
    expect(load.error).toBeNull();

    const destinationBefore = await state.admin!.client.rpc(
      "get_inventory_snapshot",
      {
        p_location_id: state.otherLocationId,
        p_query: runCode,
        p_limit: 10,
      },
    );
    const destinationInitial = Number(destinationBefore.data[0].qty);
    const { data: transitLocation } = await state
      .server!.from("locations")
      .select("id")
      .eq("type", "TRANSIT")
      .single();

    const created = await state.warehouse!.client.rpc("create_transfer", {
      p_from_location_id: state.locationId,
      p_to_location_id: state.otherLocationId,
      p_items: [{ variant_id: state.variantId, qty: 5 }],
      p_note: "Prueba bandera M3",
    });
    expect(created.error).toBeNull();
    const transferId = created.data.id as string;
    expect(
      (
        await state.manager!.client.rpc("approve_transfer", {
          p_transfer_id: transferId,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await state.warehouse!.client.rpc("prepare_transfer", {
          p_transfer_id: transferId,
          p_items: [{ variant_id: state.variantId, qty: 5 }],
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await state.warehouse!.client.rpc("dispatch_transfer", {
          p_transfer_id: transferId,
        })
      ).error,
    ).toBeNull();

    const [sourceInTransit, destinationInTransit, transitBalance] =
      await Promise.all([
        state.manager!.client.rpc("get_inventory_snapshot", {
          p_location_id: state.locationId,
          p_query: runCode,
          p_limit: 10,
        }),
        state.admin!.client.rpc("get_inventory_snapshot", {
          p_location_id: state.otherLocationId,
          p_query: runCode,
          p_limit: 10,
        }),
        state
          .server!.from("inventory_by_location")
          .select("qty")
          .eq("variant_id", state.variantId)
          .eq("location_id", transitLocation!.id)
          .single(),
      ]);
    expect(Number(sourceInTransit.data[0].qty)).toBe(15);
    expect(Number(destinationInTransit.data[0].qty)).toBe(destinationInitial);
    expect(Number(transitBalance.data!.qty)).toBe(5);
    expect(
      Number(sourceInTransit.data[0].qty) +
        Number(destinationInTransit.data[0].qty) +
        Number(transitBalance.data!.qty),
    ).toBe(20 + destinationInitial);

    const cancelInTransit = await state.warehouse!.client.rpc(
      "cancel_transfer",
      { p_transfer_id: transferId },
    );
    expect(cancelInTransit.error?.message).toContain(
      "TRANSFER_NOT_CANCELLABLE",
    );
    const sameApproverReceives = await state.manager!.client.rpc(
      "receive_transfer",
      {
        p_transfer_id: transferId,
        p_items: [{ variant_id: state.variantId, qty: 4 }],
      },
    );
    expect(sameApproverReceives.error?.message).toContain(
      "SEPARATION_OF_DUTIES",
    );

    const received = await state.admin!.client.rpc("receive_transfer", {
      p_transfer_id: transferId,
      p_items: [{ variant_id: state.variantId, qty: 4 }],
    });
    expect(received.error).toBeNull();
    expect(Number(received.data.remaining_in_transit)).toBe(1);

    const [destinationAfter, transitAfter] = await Promise.all([
      state.admin!.client.rpc("get_inventory_snapshot", {
        p_location_id: state.otherLocationId,
        p_query: runCode,
        p_limit: 10,
      }),
      state
        .server!.from("inventory_by_location")
        .select("qty")
        .eq("variant_id", state.variantId)
        .eq("location_id", transitLocation!.id)
        .single(),
    ]);
    expect(Number(destinationAfter.data[0].qty)).toBe(destinationInitial + 4);
    expect(Number(transitAfter.data!.qty)).toBe(1);
  });

  it("serializa dos traspasos simultáneos sin cambiar el total global", async () => {
    const createPrepared = async () => {
      const created = await state.warehouse!.client.rpc("create_transfer", {
        p_from_location_id: state.locationId,
        p_to_location_id: state.otherLocationId,
        p_items: [{ variant_id: state.variantId, qty: 2 }],
        p_note: "Traspaso concurrente",
      });
      const id = created.data.id as string;
      await state.manager!.client.rpc("approve_transfer", {
        p_transfer_id: id,
      });
      await state.warehouse!.client.rpc("prepare_transfer", {
        p_transfer_id: id,
        p_items: [{ variant_id: state.variantId, qty: 2 }],
      });
      return id;
    };
    const [firstId, secondId] = await Promise.all([
      createPrepared(),
      createPrepared(),
    ]);

    const before = await state
      .server!.from("inventory_by_location")
      .select("qty")
      .eq("variant_id", state.variantId);
    const totalBefore = (before.data ?? []).reduce(
      (sum, row) => sum + Number(row.qty),
      0,
    );
    const results = await Promise.all([
      state.warehouse!.client.rpc("dispatch_transfer", {
        p_transfer_id: firstId,
      }),
      state.warehouse!.client.rpc("dispatch_transfer", {
        p_transfer_id: secondId,
      }),
    ]);
    expect(results.every((result) => result.error === null)).toBe(true);

    const after = await state
      .server!.from("inventory_by_location")
      .select("qty")
      .eq("variant_id", state.variantId);
    const totalAfter = (after.data ?? []).reduce(
      (sum, row) => sum + Number(row.qty),
      0,
    );
    expect(totalAfter).toBe(totalBefore);
    const invariant = await state.admin!.client.rpc(
      "check_inventory_invariant",
    );
    expect(invariant.data).toEqual([]);
  });
});
