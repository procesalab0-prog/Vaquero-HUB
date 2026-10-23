import pg from "pg";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/qa_m9_categorias_block3_20261023"
)
  throw Error("DEDICATED_LOCAL_CATEGORY_QA_REQUIRED");
if (process.argv.length !== 5)
  throw Error("USAGE: CONTEXT PAYLOAD NEW_RESULT_FILE");
const context = JSON.parse(await readFile(process.argv[2], "utf8")),
  payload = JSON.parse(await readFile(process.argv[3], "utf8"));
const db = new pg.Client({
    connectionString: target.href,
    application_name: "m9-photo-category-rollback-qa",
  }),
  other = new pg.Client({
    connectionString: target.href,
    application_name: "m9-photo-category-competing-reader",
  });
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let checks = 0,
  waiting;
await db.connect();
await other.connect();
try {
  const tableNames = (
    await db.query(
      "select schemaname||'.'||tablename name from pg_tables where schemaname in('app','public') union all select 'storage.objects' order by name",
    )
  ).rows.map((x) => x.name);
  const hashQuery =
    "select jsonb_object_agg(name,jsonb_build_object('rows',rows,'hash',hash))hashes from(" +
    tableNames
      .map(
        (t) =>
          `select '${t}' name,count(*)::int rows,md5(coalesce(string_agg(j,'|'order by j),''))hash from(select to_jsonb(t)::text j from ${t} t)t`,
      )
      .join(" union all ") +
    ")h";
  const hashes = async () => (await one(hashQuery)).hashes,
    original = await hashes();
  await db.query(
    "begin;set local statement_timeout='30s';set local lock_timeout='5s';set local timezone='UTC'",
  );
  const initialDefinition = await one(
    "select to_regclass('app.m9_variant_photo_refreshes')table_name,(select count(*)from public.products)::int products",
  );
  assert.equal(
    (
      await one(
        "select count(*)::int n from public.products where id=any($1::uuid[])",
        [context.current.map((f) => f.product_id)],
      )
    ).n,
    0,
    "OWN_CATEGORY_FIXTURES_MUST_BE_ABSENT",
  );
  if (!initialDefinition.table_name)
    await db.query(
      await readFile(
        new URL("./catalogo-fotos-refresh-apply.sql", import.meta.url),
        "utf8",
      ),
    );
  else {
    const definition = (
      await one(
        "select pg_get_functiondef('app.m9_apply_variant_photo_refresh(jsonb)'::regprocedure)body",
      )
    ).body;
    assert.ok(
      definition.includes("lock table public.products in exclusive mode") &&
        definition.includes("PREVIOUS_CATALOG_CHANGED"),
      "PRIOR_PHOTO_GUARDS_REQUIRED",
    );
  }
  await db.query(
    await readFile(
      new URL("./catalogo-categorias-review.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query(
    "alter table storage.objects add column if not exists metadata jsonb",
  );
  const actors = [
    ...new Set(
      context.current.flatMap((f) => [
        f.draft.updated_by,
        ...f.copies.map((c) => c.created_by),
      ]),
    ),
  ];
  for (const id of actors) {
    await db.query(
      "insert into auth.users(id)values($1)on conflict(id)do nothing",
      [id],
    );
    await db.query(
      "insert into public.app_users(id,employee_code,full_name,role_id)select $1::uuid,'CATQA-'||upper(substr($1::text,1,8)),'SYNTHETIC CATEGORY QA',id from public.roles where code='ADMIN' on conflict(id)do nothing",
      [id],
    );
  }
  for (const f of context.current) {
    const section = f.catalog.variants[0].section;
    await db.query(
      "insert into public.categories(id,name)values($1,$2)on conflict(id)do nothing",
      [f.product.category_id, section],
    );
    await db.query(
      "insert into public.products(id,name,brand_id,category_id,description,is_active,created_by,updated_by,created_at,updated_at,image_path,department_name,measure_unit_code)select id,name,brand_id,category_id,description,is_active,created_by,updated_by,created_at,updated_at,image_path,department_name,measure_unit_code from jsonb_populate_record(null::public.products,$1::jsonb)",
      [f.product],
    );
    for (const v of f.variants) {
      await db.query(
        "insert into public.variants select * from jsonb_populate_record(null::public.variants,$1::jsonb)",
        [v],
      );
      const r = f.managed.find((r) => r.variant_id === v.id),
        attrs = f.catalog.variants.find((x) => x.id === v.id).attributes;
      await db.query(
        "insert into public.m9_variant_details(variant_id,department,section,source_description)values($1,$2,$3,$4)",
        [
          v.id,
          r.source_row.department,
          r.source_row.section,
          r.source_row.description,
        ],
      );
      await db.query(
        "insert into public.barcodes(variant_id,code,symbology,source,is_primary)values($1,$2,'LEGACY','SICAR',true)",
        [v.id, r.barcode],
      );
      for (const [type, value] of Object.entries(attrs)) {
        await db.query(
          "insert into public.attribute_types(code,name)values($1,$2)on conflict(code)do nothing",
          [type, "SYNTHETIC CAT QA " + type],
        );
        let a = await one(
          "select id from public.attribute_values where type_code=$1 and value=$2 and scale_code is null",
          [type, value],
        );
        if (!a)
          a = await one(
            "insert into public.attribute_values(type_code,value)values($1,$2)returning id",
            [type, value],
          );
        await db.query(
          "insert into public.variant_attributes(variant_id,type_code,value_id)values($1,$2,$3)",
          [v.id, type, a.id],
        );
      }
      await db.query(
        "insert into app.m9_rows select * from jsonb_populate_record(null::app.m9_rows,$1::jsonb)",
        [r],
      );
    }
    await db.query(
      "insert into app.m9_products(woo_id,product_id,section,source_name)values($1,$2,$3,$4)",
      [f.source.snapshot.woo_product_id, f.product_id, section, f.product.name],
    );
    for (const [table, row] of [
      ["app.web_content_sources", f.source],
      ["app.web_product_drafts", f.draft],
      ["app.web_category_bindings", f.category_binding],
    ])
      await db.query(
        `insert into ${table} select * from jsonb_populate_record(null::${table},$1::jsonb)`,
        [row],
      );
    for (const row of f.evidence)
      await db.query(
        "insert into app.web_variant_photo_evidence select * from jsonb_populate_record(null::app.web_variant_photo_evidence,$1::jsonb)",
        [row],
      );
    for (const row of f.copies)
      await db.query(
        "insert into app.web_variant_photo_storage select * from jsonb_populate_record(null::app.web_variant_photo_storage,$1::jsonb)",
        [row],
      );
    for (const row of f.objects)
      if (!(await one("select 1 from storage.objects where id=$1", [row.id])))
        await db.query(
          "insert into storage.objects select * from jsonb_populate_record(null::storage.objects,$1::jsonb)",
          [row],
        );
  }
  await db.query(
    "insert into app.m9_variant_photo_refreshes select * from jsonb_populate_record(null::app.m9_variant_photo_refreshes,$1::jsonb)",
    [context.receipt],
  );
  const p = structuredClone(payload),
    ids = p.expected_current.map((f) => f.product_id);
  // Local Storage is a stub: only its record shape differs from production.
  p.expected_current = (
    await one("select app.m9_variant_photo_refresh_state($1::uuid[])s", [ids])
  ).s;
  const receiptHash = (
    await one(
      "select encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex')hash from app.m9_variant_photo_refreshes r where request_id=$1",
      [p.refresh_id],
    )
  ).hash;
  assert.equal(
    receiptHash,
    p.expected_receipt_sha256,
    "REAL_RECEIPT_UNMODIFIED_IN_QA",
  );
  const initial = await hashes(),
    call = async (x) =>
      (
        await one(
          "select app.m9_review_categories_after_photo_refresh($1::jsonb)result",
          [x],
        )
      ).result;
  async function reject(mutate, wanted, edit) {
    await db.query("savepoint category_bad");
    const x = structuredClone(p);
    mutate?.(x);
    if (edit) await edit(x);
    let msg;
    try {
      await call(x);
    } catch (e) {
      msg = e.message;
      if (!msg.includes(wanted))
        console.error(e.where ?? e.detail ?? e.message);
    }
    await db.query("rollback to savepoint category_bad");
    assert.ok(msg?.includes(wanted), `expected ${wanted}, got ${msg}`);
    assert.deepEqual(await hashes(), initial);
    checks++;
  }
  await reject(
    (x) => (x.refresh_id = "00000000-0000-4000-8000-000000000001"),
    "EXACT_PACKET_REQUIRED",
  );
  await reject(
    (x) => (x.expected_receipt_sha256 = "a".repeat(64)),
    "REFRESH_RECEIPT_CHANGED",
  );
  await reject(
    (x) => (x.capture.captured_at = "2000-01-01T00:00:00Z"),
    "STALE_OR_INCOMPLETE_CAPTURE",
  );
  await reject(
    (x) => (x.capture.captured_at = "2099-01-01T00:00:00Z"),
    "STALE_OR_INCOMPLETE_CAPTURE",
  );
  await reject((x) => x.capture.products.pop(), "STALE_OR_INCOMPLETE_CAPTURE");
  await reject(
    (x) => (x.capture.products[0].raw_json += " "),
    "RAW_CAPTURE_CHANGED",
  );
  const wireChangedResponse = (prod) => {
    prod.raw_json = JSON.stringify(prod.data);
    prod.raw_sha256 = createHash("sha256").update(prod.raw_json).digest("hex");
  };
  await reject((x) => {
    x.capture.products[0].data.categories.pop();
    wireChangedResponse(x.capture.products[0]);
  }, "CURRENT_MEMBERSHIP_CHANGED");
  await reject((x) => {
    for (const prod of x.capture.products)
      for (const c of prod.data.categories)
        if (c.id === 268) c.name = "Changed Bota";
    for (const prod of x.capture.products) wireChangedResponse(prod);
  }, "CURRENT_MEMBERSHIP_CHANGED");
  await reject(
    (x) => (x.mappings[0].mappings[0].path = "Wrong"),
    "CURRENT_MEMBERSHIP_CHANGED",
  );
  const pid = ids[0];
  const recapture = async (x) =>
    (x.expected_current = (
      await one("select app.m9_variant_photo_refresh_state($1::uuid[])s", [ids])
    ).s);
  await reject(null, "INVALIDATION_NOT_FROM_REFRESH", async (x) => {
    await db.query(
      "update app.web_category_bindings set invalidation_reason='DRAFT_CATEGORIES_CHANGED' where product_id=$1",
      [pid],
    );
    await recapture(x);
  });
  await reject(null, "NOT_ONLY_EXPECTED_PHOTO_REFRESH", async (x) => {
    await db.query(
      "update app.web_product_drafts set content=jsonb_set(content,'{categories}','[\"Other\"]')where product_id=$1",
      [pid],
    );
    await recapture(x);
  });
  await reject(null, "NEW_PHOTO_LINK_NOT_EXACT", async (x) => {
    await db.query(
      "update app.web_variant_photo_storage set photos=jsonb_set(photos,'{0,alt}','\"manual\"')where variant_id=(select variant_id from app.web_variant_photo_evidence where product_id=$1 limit 1)",
      [pid],
    );
    await recapture(x);
  });
  await reject(null, "NEW_PHOTO_LINK_NOT_EXACT", async (x) => {
    await db.query(
      "update storage.objects set metadata=jsonb_set(metadata,'{size}','1')where name like $1",
      [pid + "/%"],
    );
    await recapture(x);
  });
  await db.query(
    "create function pg_temp.fail_category_receipt()returns trigger language plpgsql as $$begin raise exception 'FAIL_AFTER_SEVEN_CATEGORY_UPDATES';end$$;create trigger fail_category_receipt before insert on app.m9_photo_category_reviews for each row execute function pg_temp.fail_category_receipt()",
  );
  await reject(null, "FAIL_AFTER_SEVEN_CATEGORY_UPDATES");
  await db.query(
    "drop trigger fail_category_receipt on app.m9_photo_category_reviews",
  );
  const first = await call(p);
  assert.equal(first.reverified, 7);
  const after = await hashes();
  for (const table of tableNames.filter(
    (t) => !["app.web_category_bindings", "public.audit_log"].includes(t),
  ))
    assert.deepEqual(after[table], initial[table]);
  checks++;
  const repeated = await call(p);
  assert.equal(repeated.replayed, true);
  assert.deepEqual(await hashes(), after);
  checks++;
  assert.equal(
    (
      await one(
        "select count(*)::int n from app.web_category_bindings where product_id=any($1::uuid[])and(app.web_category_binding_state(product_id)->>'valid')::boolean",
        [ids],
      )
    ).n,
    7,
  );
  checks++;
  await db.query("savepoint category_reverse_bad");
  await db.query(
    "update storage.objects set metadata=jsonb_set(metadata,'{size}','1')where name like $1",
    [pid + "/%"],
  );
  await assert.rejects(
    () =>
      db.query("select app.m9_reverse_photo_category_review($1)", [
        p.request_id,
      ]),
    /REVERSAL_CHANGED/,
  );
  await db.query("rollback to savepoint category_reverse_bad");
  checks++;
  for (const role of ["anon", "authenticated", "service_role"]) {
    const acl = await one(
      "select has_function_privilege($1,'app.m9_review_categories_after_photo_refresh(jsonb)','EXECUTE')apply,has_function_privilege($1,'app.m9_reverse_photo_category_review(uuid)','EXECUTE')reverse,has_table_privilege($1,'app.m9_photo_category_reviews','SELECT')read",
      [role],
    );
    assert.deepEqual(acl, { apply: false, reverse: false, read: false });
    checks++;
  }
  await other.query("set statement_timeout='10s';set lock_timeout='8s'");
  const otherPid = (await other.query("select pg_backend_pid()pid")).rows[0]
    .pid;
  waiting = other.query(
    "select id from public.products where id=$1 for update",
    [pid],
  );
  let observed = false;
  for (let n = 0; n < 100; n++) {
    if ((await one("select pg_blocking_pids($1)b", [otherPid])).b.length) {
      observed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(observed, true, "CATEGORY_LOCK_CONTENTION_NOT_OBSERVED");
  checks++;
  const reversed = (
    await one("select app.m9_reverse_photo_category_review($1)result", [
      p.request_id,
    ])
  ).result;
  assert.equal(reversed.held_restored, 7);
  const restored = await hashes();
  for (const t of tableNames.filter((t) => t !== "public.audit_log"))
    assert.deepEqual(restored[t], initial[t]);
  checks++;
  await db.query("rollback");
  assert.equal((await waiting).rowCount, 0);
  assert.deepEqual(await hashes(), original);
  const result = {
    local: true,
    synthetic_fixtures: true,
    checks,
    reverified: 7,
    replays: 1,
    compensation_restored_holds: 7,
    public_capture_at: p.capture.captured_at,
    source_draft_catalog_photos_unchanged: true,
    transaction_failure_rolled_back: true,
    competing_row_share_observed: true,
    outer_rollback_verified: true,
    audited_existing_tables: tableNames.length,
    staging_writes: 0,
    woo_writes: 0,
  };
  await writeFile(process.argv[4], JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} catch (e) {
  await db.query("rollback");
  if (waiting) await waiting.catch(() => {});
  throw e;
} finally {
  await db.end();
  await other.end();
}
