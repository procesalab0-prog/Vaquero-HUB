// Incremental acceptance on the dedicated local main-baseline runtime only.
// Never connect to shared staging, production, or an arbitrary database URL.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const base = "e45ef5bc46f0d5a2016e6f17f327ad8976df3fff";
const runtime = new URL("../../qa-upgrade-runtime", import.meta.url).pathname;
const config = await readFile(`${runtime}/supabase/config.toml`, "utf8");
assert.match(config, /project_id = "mi-tienda-upgrade-20261007"/);
const env = JSON.parse(
  execFileSync(
    "pnpm",
    ["exec", "supabase", "status", "--workdir", runtime, "-o", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.equal(env.API_URL, "http://127.0.0.1:57321");
assert.equal(new URL(env.DB_URL).hostname, "127.0.0.1");
assert.equal(new URL(env.DB_URL).port, "57322");
const db = new pg.Client({ connectionString: env.DB_URL });
await db.connect();
try {
  const baseline = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", base, "supabase/migrations"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .map((f) => f.split("/").at(-1));
  const actual = (
    await db.query(
      "select version from supabase_migrations.schema_migrations order by version",
    )
  ).rows.map((r) => r.version);
  assert.deepEqual(
    actual,
    baseline.map((f) => f.split("_")[0]).sort(),
    "Requires exact main baseline; no repeat or foreign schema",
  );
  const server = createClient(
    env.API_URL,
    env.SECRET_KEY ?? env.SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const email = `upgrade-${crypto.randomUUID()}@vaquero.test`;
  const password = crypto.randomUUID();
  const auth = await server.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(auth.error, null);
  const actor = auth.data.user.id;
  const role = await server
    .from("roles")
    .select("id")
    .eq("code", "ADMIN")
    .single();
  assert.equal(role.error, null);
  assert.equal(
    (
      await server.from("app_users").insert({
        id: actor,
        email,
        employee_code: "QAUPGRADE20261007",
        full_name: "QA incremental",
        role_id: role.data.id,
      })
    ).error,
    null,
  );
  const client = createClient(
    env.API_URL,
    env.PUBLISHABLE_KEY ?? env.ANON_KEY,
    { auth: { persistSession: false } },
  );
  assert.equal(
    (await client.auth.signInWithPassword({ email, password })).error,
    null,
  );
  const store = await client.rpc("upsert_location", {
    p_id: null,
    p_code: "QAUPGRADE",
    p_name: "QA incremental",
    p_type: "STORE",
    p_address: null,
    p_phone: null,
    p_is_active: true,
  });
  assert.equal(store.error, null);
  const location = await server
    .from("locations")
    .select("id")
    .eq("code", "QAUPGRADE")
    .single();
  assert.equal(location.error, null);
  const category = await server
    .from("categories")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .single();
  assert.equal(category.error, null);
  const product = await client.rpc("create_catalog_product", {
    p_name: "QA previo a actualización",
    p_category_id: category.data.id,
    p_variants: [{ cost_cents: 10000, price_cents: 25000, attributes: {} }],
  });
  assert.equal(product.error, null);
  const variant = await server
    .from("variants")
    .select("id")
    .eq("product_id", product.data.product_id)
    .single();
  assert.equal(variant.error, null);
  assert.equal(
    (
      await client.rpc("apply_inventory_adjustment", {
        p_variant_id: variant.data.id,
        p_location_id: location.data.id,
        p_expected_qty: 0,
        p_counted_qty: 3,
        p_reason: "CONTEO_FISICO",
        p_note: "QA incremental",
      })
    ).error,
    null,
  );
  const cut = "a".repeat(64),
    questionId = "b".repeat(64);
  const evidence = {
    department: "QA",
    help: "Ejemplo sintético",
    members: [
      {
        barcode: "QA-SYNTHETIC",
        size: "S",
        source_evidence: {
          description: "QA MODELOT.S",
          department: "QA",
          section: "QA",
        },
      },
    ],
    previously_consulted: false,
    priority: false,
    question: "¿Mismo modelo?",
    question_id: questionId,
    section: "QA",
    source_case_sha: "c".repeat(64),
    title: "QA MODELO",
  };
  await db.query(
    "insert into app.main_m9_review_cuts(cut_sha,ready) values($1,true)",
    [cut],
  );
  await db.query("select app.load_main_m9_owner_questions($1,$2::jsonb)", [
    cut,
    JSON.stringify([evidence]),
  ]);
  await db.query("select app.release_main_m9_question_batch($1,$2::text[])", [
    cut,
    [questionId],
  ]);
  const answer = await client.rpc("main_m9_save_owner_answer", {
    p_cut: cut,
    p_question: questionId,
    p_revision: 0,
    p_request: crypto.randomUUID(),
    p_choice: "SAME_MODEL",
    p_note: "Respuesta sintética previa",
    p_name: "QA",
  });
  assert.equal(answer.error, null);
  const snapshot = async () =>
    (
      await db.query(`select jsonb_build_object(
    'variants',(select jsonb_agg(to_jsonb(v) order by id) from public.variants v),
    'barcodes',(select jsonb_agg(to_jsonb(b) order by code) from public.barcodes b),
    'balances',(select jsonb_agg(to_jsonb(i) order by variant_id,location_id) from public.inventory_by_location i),
    'movements',(select jsonb_agg(to_jsonb(m) order by id) from public.inventory_movements m),
    'questions',(select jsonb_agg(to_jsonb(q) order by question_id) from app.main_m9_owner_questions q),
    'answers',(select jsonb_agg(to_jsonb(a) order by request_id) from app.main_m9_owner_answers a)
  ) as value`)
    ).rows[0].value;
  const before = await snapshot();
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const pending = (await readdir(directory))
    .filter((f) => f.endsWith(".sql") && !baseline.includes(f))
    .sort();
  assert.equal(pending.length, 22);
  for (const file of pending) {
    const sql = await readFile(new URL(file, directory), "utf8");
    await db.query(sql);
    await db.query(
      "insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)",
      [file.split("_")[0], file.slice(15, -4), [sql]],
    );
  }
  assert.deepEqual(
    await snapshot(),
    before,
    "Existing identities, stock, ledger and M9 answers must remain byte-equivalent",
  );
  await db.query("notify pgrst, 'reload schema'");
  let available;
  for (let i = 0; i < 20; i++) {
    available = await client.rpc("usd_checkout_available");
    if (!available.error) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(available.error, null);
  assert.equal(available.data, false);
  const notes = await client.rpc("save_workspace_note", {
    p_body: "Nota nueva tras actualización",
  });
  assert.equal(notes.error, null);
  const inbox = await client.rpc("main_m9_owner_inbox", {
    p_state: "answered",
    p_priority: false,
  });
  assert.equal(inbox.error, null);
  assert.equal(inbox.data.total, 1);
  console.log(
    "PASS: main 101 → 123 migrations; existing barcode/stock/ledger/M9 answer preserved; new notes work through Auth/PostgREST; USD remains off. Synthetic local QA only.",
  );
} finally {
  await db.end();
}
