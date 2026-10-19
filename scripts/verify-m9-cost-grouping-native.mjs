import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import pg from "pg";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !/^\/qa_[a-z0-9_]+$/.test(url.pathname)
)
  throw Error("EMPTY_LOCAL_QA_REQUIRED");
const db = new pg.Client({ connectionString: url.href });
await db.connect();
try {
  assert.equal(
    (
      await db.query(
        "select 1 from pg_tables where schemaname in ('app','public','auth','storage') limit 1",
      )
    ).rowCount,
    0,
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
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations) {
    try {
      await db.query(await readFile(new URL(name, directory), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${name}: ${error.message}`, { cause: error });
    }
  }

  const actor = crypto.randomUUID();
  await db.query(
    "insert into auth.users(id,email) values($1,'qa-group@qa.test')",
    [actor],
  );
  await db.query(
    "insert into app_users(id,employee_code,full_name,role_id) select $1,'QAGROUP','QA grouping',id from roles where code='ADMIN'",
    [actor],
  );
  const loc = (
    await db.query(
      "insert into locations(code,name,type) values('QAGROUP','QA group','STORE') returning id",
    )
  ).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    actor,
  ]);
  const reg = (
    await db.query(
      "select (create_cash_register($1,'QAGROUP','QA group')).id",
      [loc],
    )
  ).rows[0].id;
  await db.query("select open_cash_session($1,100000)", [reg]);
  await db.query(
    "update app.sicar_sync_control set environment_label='STAGING',catalog_writes_enabled=true where singleton",
  );
  const rows = ["000001", "000002"].map((barcode, i) => ({
    barcode,
    description: "QA GROUP " + i,
    product_name: "QA GROUP " + i,
    department: "QA",
    section: "QA grouping",
    family_key: "prov-qa-" + i,
    attributes: {},
    cost_cents: null,
    price_cents: 10000,
    woo_variation_id: null,
  }));
  const sha = "c".repeat(64);
  for (const row of rows)
    await db.query(
      "insert into app.m9_sicar_approved_rows(barcode,source_sha256,payload,reviewer,reason,reviewed_at) values($1,$2,$3,'QA','Synthetic fixture',now())",
      [row.barcode, sha, JSON.stringify(row)],
    );
  const plan = (
    await db.query("select app.m9_sicar_plan($1,$2) p", [
      JSON.stringify(rows),
      sha,
    ])
  ).rows[0].p;
  assert.equal(plan.write_allowed, true, JSON.stringify(plan.errors));
  await db.query("select app.m9_sicar_apply($1,$2,$3)", [
    JSON.stringify(rows),
    sha,
    plan.token,
  ]);
  const evidence = rows.map((r) => ({
    barcode: r.barcode,
    grouping_status: "PROVISIONAL",
    web_release: false,
    fields: {
      "clave1 *": r.barcode,
      "descripción *": r.description,
      departamento: r.department,
      categoria: r.section,
      unidad: "PIEZA",
      "(s/n) inventariable": "s",
      "(s/n) mostrar en ventas": "s",
      precio1: "100.00",
    },
  }));
  await db.query("select app.m9_register_provisionals($1,$2,$3)", [
    JSON.stringify(rows),
    JSON.stringify(evidence),
    sha,
  ]);
  await db.query(
    "update app.m9_rehearsal_control set enabled=true,review_sha256=$1,expires_at=now()+interval '1 hour'",
    [sha],
  );
  // Parent department may be absent on older M9 imports. Reconciled literal
  // variant classification must work for both reports, without rewriting it.
  await db.query("begin");
  const fixtureVariant = (
    await db.query("select variant_id from app.m9_rows where barcode='000001'")
  ).rows[0].variant_id;
  await db.query(
    "update products set department_name=null where id in (select product_id from variants where id in (select variant_id from app.m9_rows))",
  );
  await db.query(
    "select apply_inventory_adjustment($1,$2,0,2,'CONTEO_FISICO','QA report fallback, rollback')",
    [fixtureVariant, loc],
  );
  const inventory = (
    await db.query("select get_inventory_report_v2($1,'',null,'QA') r", [loc])
  ).rows[0].r;
  assert.equal(Number(inventory.summary.variant_count), 1);
  assert.equal(inventory.items[0].department_name, "QA");
  assert.equal(inventory.summary.cost_value_cents, null);
  const classes = (await db.query("select get_report_classifications() r"))
    .rows[0].r;
  assert.equal(classes.departments.includes("QA"), true);
  await db.query(
    "insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row) values($1,'000001',$2,app.m9_rehearsal_current_row($1))",
    [fixtureVariant, sha],
  );
  await db.query("select create_sale($1,$2,$3::jsonb,$4::jsonb)", [
    crypto.randomUUID(),
    (await db.query("select id from cash_sessions where status='OPEN'")).rows[0]
      .id,
    JSON.stringify([{ variant_id: fixtureVariant, quantity: 1 }]),
    JSON.stringify([
      { method_code: "CASH", amount_cents: 10000, tendered_cents: 10000 },
    ]),
  ]);
  const sales = (
    await db.query(
      "select get_sales_report_v2($1,now()-interval '1 day',now()+interval '1 day','day','',null,'QA') r",
      [loc],
    )
  ).rows[0].r;
  assert.equal(Number(sales.summary.net_cents), 10000);
  assert.equal(sales.details[0].department_name, "QA");
  // An explicit operational parent classification still wins over source.
  await db.query(
    "update products set department_name='QA override' where id=(select product_id from variants where id=$1)",
    [fixtureVariant],
  );
  assert.equal(
    Number(
      (
        await db.query("select get_inventory_report_v2($1,'',null,'QA') r", [
          loc,
        ])
      ).rows[0].r.summary.variant_count,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select get_inventory_report_v2($1,'',null,'QA override') r",
          [loc],
        )
      ).rows[0].r.summary.variant_count,
    ),
    1,
  );
  await db.query("rollback");
  console.log(
    JSON.stringify({
      m9_report_literal_department_fallback: true,
      parent_override_preserved: true,
      inventory_and_sales_filters: true,
      classification_list: true,
      rollback: true,
    }),
  );
  const audit = async () =>
    (
      await db.query(
        "select jsonb_build_object('sales',(select count(*) from sales),'stock',(select count(*) from inventory_by_location),'cash',(select md5(string_agg(to_jsonb(c)::text,'' order by id)) from cash_movements c),'events',(select count(*) from app.m9_grouping_events),'allowlist',(select count(*) from app.m9_rehearsal_allowlist),'control',(select to_jsonb(c) from app.m9_rehearsal_control c)) a",
      )
    ).rows[0].a;
  const before = await audit();
  const result = await db.query(
    await readFile(
      new URL("./m9/test-provisional-sale-grouping.sql", import.meta.url),
      "utf8",
    ),
  );
  const checks = result
    .flatMap((r) => r.rows ?? [])
    .find((r) => r.result)?.result;
  assert.equal(checks.positive_sale_tested, true);
  assert.equal(checks.sale_and_refund_history_preserved, true);
  assert.deepEqual(await audit(), before);
  // Even an explicit caller-requested IMMEDIATE mode must stay intact. The
  // helper must never defer unrelated constraints to make a grouping succeed.
  const definitions = (
    await db.query(
      "select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname in ('m9_group_provisionals','m9_undo_provisional_group')",
    )
  ).rows;
  assert.equal(
    definitions.some((r) => /set constraints all/i.test(r.d)),
    false,
  );
  console.log(
    JSON.stringify({
      local_grouping_sale_acceptance: true,
      checks,
      rollback_verified: true,
      migrations: migrations.length,
      auth_postgrest_tested: false,
    }),
  );
} finally {
  await db.end();
}
