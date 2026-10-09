// Exact migration-name baseline rehearsal for hosted M9, with local synthetic data.
// Requires an EMPTY local qa_* database. No remote connection, reset or real data.
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import pg from "pg";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !/^\/qa_[a-z0-9_]+$/.test(target.pathname)
)
  throw Error("EMPTY_LOCAL_QA_DATABASE_REQUIRED");
const db = new pg.Client({ connectionString: target.href });
await db.connect();
const migrationDir = new URL("../supabase/migrations/", import.meta.url);
const names = (await readdir(migrationDir))
  .filter((n) => n.endsWith(".sql"))
  .sort();
const inventoryPath = process.env.QA_MIGRATION_INVENTORY;
const legacyPath = process.env.QA_LEGACY_EXCHANGE_SQL;
if (!inventoryPath || !legacyPath)
  throw Error("HOSTED_INVENTORY_AND_LEGACY_DEFINITION_REQUIRED");
const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
const remoteNames = new Set(
  inventory.filter((m) => m.name !== "remote_schema").map((m) => m.name),
);
assert.equal(inventory.filter((m) => m.name === "remote_schema").length, 1);
const migrationName = (n) => n.replace(/^\d+_/, "").replace(/\.sql$/, "");
assert.equal(inventory.length, 132);
assert.equal(names.length, 158);
for (const n of remoteNames)
  assert.ok(
    names.some((f) => migrationName(f) === n),
    `Unmatched hosted migration: ${n}`,
  );
try {
  assert.equal(
    (
      await db.query(
        "select 1 from pg_tables where schemaname in ('public','auth','app','storage') limit 1",
      )
    ).rowCount,
    0,
    "EMPTY_DATABASE_REQUIRED",
  );
  await db.query(`do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin; end if;
  end$$;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
  create function auth.role() returns text language sql stable as $$select coalesce(auth.jwt()->>'role',current_user)$$;
  grant usage on schema auth to anon,authenticated,service_role;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
  alter table storage.objects enable row level security;`);

  const baseline = names.filter((n) => remoteNames.has(migrationName(n)));
  assert.equal(baseline.length, 131);
  for (const name of baseline)
    await db.query(await readFile(new URL(name, migrationDir), "utf8"));
  await db.query(await readFile(legacyPath, "utf8"));
  assert.equal(
    (
      await db.query(
        "select md5(pg_get_functiondef('public.search_equal_exchange_variants(bigint,uuid,text,integer)'::regprocedure)) hash",
      )
    ).rows[0].hash,
    "86652b6fb53e25045b550d4a4982bf40",
  );
  const row = [
    {
      barcode: "000123",
      product_name: "QA camisa M9",
      description: "QAM9T.S",
      department: "CABALLERO",
      section: "QA CAMISAS",
      attributes: { TALLA: "S" },
      price_cents: 74000,
      cost_cents: null,
      woo_product_id: 990001,
      woo_variation_id: 990002,
    },
  ];
  await db.query(
    "update app.sicar_sync_control set environment_label='STAGING',catalog_writes_enabled=true where singleton",
  );
  const sha = "a".repeat(64);
  const plan = (
    await db.query("select app.m9_catalog_plan($1::jsonb,$2) p", [
      JSON.stringify(row),
      sha,
    ])
  ).rows[0].p;
  assert.equal(plan.write_allowed, true);
  await db.query("select app.m9_catalog_apply($1::jsonb,$2,$3)", [
    JSON.stringify(row),
    sha,
    plan.token,
  ]);
  const identity = (
    await db.query(
      "select variant_id,app.m9_current_row(variant_id) as current from app.m9_rows where barcode='000123'",
    )
  ).rows[0];
  const actor = crypto.randomUUID();
  await db.query(
    "insert into auth.users(id,email) values($1,'m9-combined@qa.test')",
    [actor],
  );
  await db.query(
    "insert into public.app_users(id,employee_code,full_name,role_id) select $1,'QAMERGE','QA merge',id from public.roles where code='ADMIN'",
    [actor],
  );
  const pid = (
    await db.query("select product_id from public.variants where id=$1", [
      identity.variant_id,
    ])
  ).rows[0].product_id;
  const content = {
    name: "QA camisa M9",
    short_description: "QAM9",
    description: "Descripción de ensayo",
    images: [],
    categories: [],
    publish_requested: false,
  };
  await db.query(
    "insert into app.web_content_sources(product_id,source_sha256,snapshot,suggested_content) values($1,$2,$3,$4)",
    [
      pid,
      sha,
      JSON.stringify({ woo_product_id: 990001, source_status: "publish" }),
      JSON.stringify(content),
    ],
  );
  await db.query(
    "insert into app.web_product_drafts(product_id,content,revision,updated_by) values($1,$2,1,$3)",
    [pid, JSON.stringify(content), actor],
  );
  await db.query(
    "insert into app.web_variant_photo_evidence(variant_id,product_id,barcode,woo_product_id,woo_variation_id,export_sha256,source_variant,photos,supplemental,catalog_fingerprint,source_fingerprint) values($1,$2,'000123',990001,990002,$3,'{}',$4,false,'qa-catalog','qa-source')",
    [
      identity.variant_id,
      pid,
      sha,
      JSON.stringify([
        {
          url: "https://vaquerosm.com/wp-content/uploads/qa-fixture.jpg",
          sha256: "b".repeat(64),
          bytes: 100,
          mime: "image/jpeg",
          alt: "QA",
        },
      ]),
    ],
  );
  const evidence = async () =>
    (
      await db.query(`select jsonb_build_object(
    'rows',(select jsonb_agg(to_jsonb(x) order by barcode) from app.m9_rows x),
    'codes',(select jsonb_agg(to_jsonb(x) order by id) from public.barcodes x),
    'sources',(select jsonb_agg(to_jsonb(x) order by product_id) from app.web_content_sources x),
    'drafts',(select jsonb_agg(to_jsonb(x) order by product_id) from app.web_product_drafts x),
    'photos',(select jsonb_agg(to_jsonb(x) order by variant_id) from app.web_variant_photo_evidence x),
    'stock',(select count(*) from public.inventory_by_location),
    'movements',(select count(*) from public.inventory_movements)) as evidence`)
    ).rows[0].evidence;
  const before = await evidence();
  const funcs = async () =>
    (
      await db.query(
        "select p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and (p.proname like 'm9_%' or p.proname like 'web_%' or p.proname like 'remote_%' or p.proname like 'import_variant_photo%') order by name",
      )
    ).rows;
  const functions = await funcs();
  const pending = names.filter((n) => !remoteNames.has(migrationName(n)));
  const compatibility =
    "20261007232704_quick_product_source_layout_compatibility.sql";
  pending.splice(pending.indexOf(compatibility), 1);
  pending.splice(
    pending.indexOf("20261002013734_pos_quick_product.sql"),
    0,
    compatibility,
  );
  assert.equal(pending.length, 27);
  for (const name of pending)
    await db.query(
      await readFile(
        new URL("../supabase/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  assert.deepEqual(
    await evidence(),
    before,
    "M9 codes, sources, drafts and photos must survive",
  );
  assert.deepEqual(
    await funcs(),
    functions,
    "Existing M9 functions must stay identical",
  );
  assert.deepEqual(
    (
      await db.query(
        "select variant_id,app.m9_current_row(variant_id) as current from app.m9_rows where barcode='000123'",
      )
    ).rows[0],
    identity,
  );
  assert.equal(before.stock, 0);
  assert.equal(before.movements, 0);
  assert.equal(
    (
      await db.query(
        "select measure_unit_code from public.products where id=$1",
        [pid],
      )
    ).rows[0].measure_unit_code,
    "PIECE",
  );
  const afterPlan = (
    await db.query("select app.m9_catalog_plan($1::jsonb,$2) p", [
      JSON.stringify(row),
      sha,
    ])
  ).rows[0].p;
  assert.equal(afterPlan.write_allowed, true);
  const repeat = (
    await db.query("select app.m9_catalog_apply($1::jsonb,$2,$3) r", [
      JSON.stringify(row),
      sha,
      afterPlan.token,
    ])
  ).rows[0].r;
  assert.equal(repeat.created, 0);
  assert.deepEqual(
    await evidence(),
    before,
    "Importer repeat after upgrade must not modify M9 evidence",
  );
  await db.query(
    "update app.sicar_sync_control set catalog_writes_enabled=false where singleton",
  );
  await assert.rejects(
    db.query("select app.m9_catalog_apply($1::jsonb,$2,$3)", [
      JSON.stringify(row),
      sha,
      afterPlan.token,
    ]),
    /SICAR_CATALOG_SYNC_DISABLED/,
  );
  console.log(
    JSON.stringify(
      {
        matched_application_migration_names: true,
        hosted_history_entries: inventory.length,
        hosted_remote_schema_entry_excluded: true,
        legacy_exchange_layout_verified: true,
        compatibility_before_quick_product: true,
        baseline_migrations: baseline.length,
        added_migrations: pending.length,
        total_migrations: baseline.length + pending.length,
        barcode: "000123",
        identity_preserved: true,
        source_draft_photo_preserved: true,
        m9_functions_preserved: functions.length,
        inventory_balances: 0,
        inventory_movements: 0,
        repeat,
        disabled_gate_blocks: true,
        local_only: true,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
}
