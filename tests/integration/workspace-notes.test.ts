import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const run = Date.now().toString().slice(-8);
const password = "Notes-QA-2026!";
let author: SupabaseClient;
let colleague: SupabaseClient;
let admin: SupabaseClient;
let storeId: string;
let otherStoreId: string;
let privateId: string;
let sharedId: string;

describe.sequential("notas personales y compartidas", () => {
  beforeAll(async () => {
    const server = createClient(url, secret, {
      auth: { persistSession: false },
    });
    const stores = await server
      .from("locations")
      .insert([
        { code: `NA${run}`, name: "Notas A", type: "STORE" },
        { code: `NB${run}`, name: "Notas B", type: "STORE" },
      ])
      .select("id");
    expect(stores.error).toBeNull();
    [storeId, otherStoreId] = stores.data!.map((store) => store.id);
    const users: SupabaseClient[] = [];
    for (const [index, roleCode] of ["CASHIER", "CASHIER", "ADMIN"].entries()) {
      const role = await server
        .from("roles")
        .select("id")
        .eq("code", roleCode)
        .single();
      expect(role.error).toBeNull();
      const email = `notes-${run}-${index}@vaquero.test`;
      const auth = await server.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(auth.error).toBeNull();
      const userId = auth.data.user!.id;
      const employee = await server.from("app_users").insert({
        id: userId,
        employee_code: `N${index}${run}`,
        full_name: `Notas ${index}`,
        email,
        role_id: role.data!.id,
      });
      expect(employee.error).toBeNull();
      expect(
        (
          await server
            .from("user_locations")
            .insert({ user_id: userId, location_id: storeId })
        ).error,
      ).toBeNull();
      const client = createClient(url, key, {
        auth: { persistSession: false },
      });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      users.push(client);
    }
    [author, colleague, admin] = users;
  }, 30_000);

  it("guarda una nota personal y una compartida con el autor de la sesión", async () => {
    const personal = await author.rpc("save_workspace_note", {
      p_body: "Privada",
    });
    const shared = await author.rpc("save_workspace_note", {
      p_body: "Equipo",
      p_location_id: storeId,
    });
    expect(personal.error).toBeNull();
    expect(shared.error).toBeNull();
    privateId = personal.data.id;
    sharedId = shared.data.id;
    expect(personal.data.location_id).toBeNull();
    expect(shared.data.revision).toBe(1);
  });

  it("otro empleado y administración ven sólo la compartida", async () => {
    for (const client of [colleague, admin]) {
      const notes = await client.rpc("list_workspace_notes", {
        p_location_id: storeId,
      });
      expect(notes.error).toBeNull();
      expect(notes.data.map((note: { id: string }) => note.id)).toEqual([
        sharedId,
      ]);
      for (const id of [privateId, sharedId]) {
        const update = await client.rpc("save_workspace_note", {
          p_body: "Ajena",
          p_id: id,
          p_location_id: id === sharedId ? storeId : null,
          p_expected_revision: 1,
        });
        expect(update.error?.message).toContain("NOTE_NOT_EDITABLE");
      }
    }
  });

  it("rechaza sucursales sin acceso y escrituras o lecturas directas", async () => {
    expect(
      (
        await colleague.rpc("list_workspace_notes", {
          p_location_id: otherStoreId,
        })
      ).error?.message,
    ).toContain("LOCATION_NOT_ALLOWED");
    expect(
      (
        await colleague.rpc("save_workspace_note", {
          p_body: "Ajena",
          p_location_id: otherStoreId,
        })
      ).error?.message,
    ).toContain("LOCATION_NOT_ALLOWED");
    expect(
      (await author.from("workspace_notes").select("*")).error,
    ).not.toBeNull();
    expect(
      (await author.from("workspace_notes").delete().eq("id", privateId)).error,
    ).not.toBeNull();
  });

  it("conserva privacidad y rechaza una edición basada en una revisión vieja", async () => {
    expect(
      (
        await author.rpc("save_workspace_note", {
          p_body: "Publicar",
          p_id: privateId,
          p_location_id: storeId,
          p_expected_revision: 1,
        })
      ).error?.message,
    ).toContain("NOTE_SCOPE_IMMUTABLE");
    const update = await author.rpc("save_workspace_note", {
      p_body: "Nuevo",
      p_id: sharedId,
      p_location_id: storeId,
      p_expected_revision: 1,
    });
    expect(update.error).toBeNull();
    expect(update.data.revision).toBe(2);
    const stale = await author.rpc("save_workspace_note", {
      p_body: "Viejo",
      p_id: sharedId,
      p_location_id: storeId,
      p_expected_revision: 1,
    });
    expect(stale.error?.message).toContain("NOTE_CHANGED");
  });

  it("rechaza notas vacías y el acceso anónimo", async () => {
    expect(
      (await author.rpc("save_workspace_note", { p_body: " " })).error?.message,
    ).toContain("INVALID_NOTE");
    const anonymous = createClient(url, key, {
      auth: { persistSession: false },
    });
    expect((await anonymous.rpc("list_workspace_notes")).error).not.toBeNull();
    expect(
      (await anonymous.rpc("save_workspace_note", { p_body: "Anónima" })).error,
    ).not.toBeNull();
  });
});
