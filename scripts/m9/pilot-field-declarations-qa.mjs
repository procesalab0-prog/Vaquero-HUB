import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const u = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  u.protocol !== "postgresql:" ||
  u.hostname !== "127.0.0.1" ||
  u.port !== "59432" ||
  u.pathname !== "/qa_m9_piloto_block5_20261022" ||
  u.search ||
  u.hash
)
  throw Error("DEDICATED_LOCAL_PILOT_CLONE_REQUIRED");
if (!process.argv[2])
  throw Error(
    "Usage: QA_DATABASE_URL=LOCAL_CLONE node pilot-field-declarations-qa.mjs NEW_RESULT.json",
  );
const db = new pg.Client({ connectionString: u.href });
await db.connect();
const one = async (q, args = []) => (await db.query(q, args)).rows[0];
const codes = [
  "2396",
  "12769",
  "11871",
  "606204203409",
  "10000",
  "10010",
  "10",
  "13988",
  "10536",
  "10055",
  "13038",
  "11920",
];
let checks = 0,
  rejected = 0;
try {
  const tables = (
    await db.query(
      "select schemaname||'.'||tablename name from pg_tables where schemaname in('app','public')order by 1",
    )
  ).rows.map((r) => r.name);
  for (const t of tables) assert.match(t, /^(app|public)\.[a-z][a-z0-9_]*$/);
  const sql =
    "select jsonb_object_agg(name,jsonb_build_object('n',n,'h',h))data from(" +
    tables
      .map(
        (t) =>
          `select '${t}'name,count(*)n,md5(coalesce(string_agg(j,'|'order by j),''))h from(select to_jsonb(t)::text j from ${t} t)x`,
      )
      .join(" union all ") +
    ")x";
  const audit = async () => (await one(sql)).data;
  const before = await audit();
  await db.query(
    "begin;set local timezone='UTC';set local statement_timeout='30s';set local lock_timeout='5s'",
  );
  await db.query(
    await readFile(
      new URL("./pilot-field-declarations.sql", import.meta.url),
      "utf8",
    ),
  );
  const actor = (
    await one(
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit 1",
    )
  ).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  const location = (
    await one(
      "select id from public.locations where type='STORE'and is_active order by id limit 1",
    )
  ).id;
  await db.query(
    "insert into public.user_locations(user_id,location_id)values($1,$2)on conflict do nothing",
    [actor, location],
  );
  assert.equal(
    (
      await one(
        "select app.has_perm('inventory.count')p,app.can_access_location($1)a",
        [location],
      )
    ).p,
    true,
  );
  const category = (
    await one(
      "select id from public.categories where is_active order by id limit 1",
    )
  ).id;
  assert.equal(
    (await one("select count(*)::int n from app.m9_pilot_stock_drafts")).n,
    0,
    "Assigned QA clone must not contain human drafts",
  );
  for (const code of codes) {
    let variant = await one(
      "select variant_id id from public.barcodes where code=$1",
      [code],
    );
    if (!variant) {
      const product = (
        await one(
          "insert into public.products(name,category_id,created_by,updated_by)values($1,$2,$3,$3)returning id",
          ["SYNTHETIC PILOT COUNT QA " + code, category, actor],
        )
      ).id;
      variant = await one(
        "with s as(select nextval('app.variant_serial_seq')n)insert into public.variants(product_id,sku,cost_cents,price_cents,created_by,updated_by)select $1,n::text||'-'||app.luhn_check_digit(n::text),null,100,$2,$2 from s returning id",
        [product, actor],
      );
      await db.query(
        "insert into public.barcodes(variant_id,code,symbology,source,is_primary)values($1,$2,'CODE128','SICAR',true)",
        [variant.id, code],
      );
    }
    await db.query(
      "insert into app.m9_pilot_stock_drafts(barcode,variant_id,location_id,catalog_hash,baseline,observed_qty,observed_at,evidence_sha256)values($1,$2,$3,app.m9_pilot_catalog_hash($2,$1),app.m9_pilot_balance_snapshot($2,$3),111,clock_timestamp(),repeat('a',64))",
      [code, variant.id, location],
    );
  }
  const view = async () =>
    (await one("select app.m9_legacy_pilot_api('LIST','{}')v")).v.stock.find(
      (r) => r.barcode === "2396",
    );
  const payload = async (more = {}) => {
    const v = await view();
    return {
      request: randomUUID(),
      barcode: v.barcode,
      revision: String(v.revision),
      physical_qty: v.physical_qty,
      sold_waiting_qty: v.sold_waiting_qty,
      separated_qty: v.separated_qty,
      note: "SYNTHETIC QA DECLARATION NOT SICAR",
      expected_source_sha256: v.field_source_sha256,
      count_evidence: {},
      ...more,
    };
  };
  const call = async (p) =>
    (
      await one(
        "select public.m9_legacy_pilot('SAVE_STOCK_DRAFT',$1::jsonb)r",
        [p],
      )
    ).r;
  async function reject(p, pattern, mutate) {
    await db.query("savepoint negative");
    if (mutate) await mutate();
    await assert.rejects(() => call(p), pattern);
    await db.query("rollback to savepoint negative");
    rejected++;
  }
  let v = await view();
  assert.equal(v.physical_qty, null);
  assert.equal(v.field_evidence.physical_qty.status, "UNKNOWN");
  checks++;
  const legacyNote = await payload();
  delete legacyNote.expected_source_sha256;
  delete legacyNote.count_evidence;
  assert.equal((await call(legacyNote)).declarations_recorded, 0);
  checks++;
  const initial = await payload();
  await reject({ ...initial, physical_qty: 0 }, /FIELD_DECLARATION_REQUIRED/);
  for (const bad of [-1, 0.1, 1000000, "0", true])
    await reject({ ...initial, physical_qty: bad }, /WHOLE_QUANTITY_REQUIRED/);
  await reject(
    {
      ...initial,
      count_evidence: {
        physical_qty: { declared_now: true, source: "SYNTHETIC QA COUNT" },
      },
    },
    /FIELD_QUANTITY_REQUIRED/,
  );
  const first = await payload({
    physical_qty: 4,
    count_evidence: {
      physical_qty: {
        declared_now: true,
        source: "SYNTHETIC QA HUMAN COUNT; NOT REAL",
      },
    },
  });
  const receipt = await call(first);
  assert.equal(receipt.declarations_recorded, 1);
  assert.equal(receipt.count_certified, false);
  assert.equal(receipt.import_allowed, false);
  checks++;
  v = await view();
  const physical = v.field_evidence.physical_qty.declaration;
  assert.equal(physical.actor_user_id, actor);
  assert.equal(physical.quantity, 4);
  assert.equal(physical.source_snapshot_sha256, first.expected_source_sha256);
  assert.ok(Number.isFinite(Date.parse(physical.declared_at)));
  assert.equal(v.field_evidence.physical_qty.status, "DECLARED_CURRENT");
  assert.equal(v.sold_waiting_qty, null);
  checks++;
  const hashAfterFirst = await audit();
  assert.equal((await call(first)).replayed, true);
  assert.deepEqual(await audit(), hashAfterFirst);
  checks++;
  await reject(
    { ...first, note: "SYNTHETIC changed request body" },
    /IDEMPOTENCY_CONFLICT/,
  );
  await reject(
    { ...(await payload()), revision: first.revision },
    /REVISION_CHANGED/,
  );
  for (const extra of [
    { actor_user_id: randomUUID() },
    { declared_at: "2020-01-01T00:00:00Z" },
    { count_certified: true },
  ])
    await reject(
      await payload({
        physical_qty: 2,
        count_evidence: {
          physical_qty: {
            declared_now: true,
            source: "SYNTHETIC QA COUNT",
            ...extra,
          },
        },
      }),
      /FIELD_DECLARATION_REQUIRED/,
    );
  await reject(
    await payload({ physical_qty: 2 }),
    /FIELD_DECLARATION_REQUIRED/,
  );
  const note = await payload({ note: "SYNTHETIC NOTE WITHOUT RECOUNT" });
  await call(note);
  assert.deepEqual(
    (await view()).field_evidence.physical_qty.declaration,
    physical,
  );
  checks++;
  const sold = await payload({
    sold_waiting_qty: 0,
    count_evidence: {
      sold_waiting_qty: {
        declared_now: true,
        source: "SYNTHETIC QA RECORD REVIEW; NOT REAL",
      },
    },
  });
  await call(sold);
  v = await view();
  assert.equal(v.sold_waiting_qty, 0);
  assert.equal(v.separated_qty, null);
  assert.deepEqual(v.field_evidence.physical_qty.declaration, physical);
  checks++;
  await reject(
    await payload({
      sold_waiting_qty: 5,
      count_evidence: {
        sold_waiting_qty: {
          declared_now: true,
          source: "SYNTHETIC QA RECORDS",
        },
      },
    }),
    /COMMITMENTS_EXCEED_PHYSICAL/,
  );
  const stale = await payload();
  await reject(stale, /FIELD_SOURCE_CHANGED/, () =>
    db.query(
      "update app.m9_pilot_stock_drafts set observed_qty=observed_qty+1 where barcode='2396'",
    ),
  );
  await db.query("savepoint changed_source");
  await db.query(
    "update app.m9_pilot_stock_drafts set evidence_sha256=repeat('b',64)where barcode='2396'",
  );
  assert.equal(
    (await view()).field_evidence.physical_qty.status,
    "HELD_SOURCE_OR_BASELINE_CHANGED",
  );
  checks++;
  await db.query("rollback to savepoint changed_source");
  await reject(stale, /BASELINE_CHANGED/, () =>
    db.query(
      "update app.m9_pilot_stock_drafts set baseline='{}'where barcode='2396'",
    ),
  );
  await reject(stale, /BASELINE_CHANGED/, () =>
    db.query(
      "update public.variants set price_cents=price_cents+1 where id=(select variant_id from app.m9_pilot_stock_drafts where barcode='2396')",
    ),
  );
  await reject(await payload(), /NOT_AUTHORIZED/, () =>
    db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      randomUUID(),
    ]),
  );
  await reject(first, /NOT_AUTHORIZED/, async () => {
    await db.query(
      "delete from public.user_locations where user_id=$1 and location_id=$2",
      [actor, location],
    );
    await db.query("update public.locations set is_active=false where id=$1", [
      location,
    ]);
  });
  await reject(await payload(), /NOT_AUTHORIZED/, () =>
    db.query(
      "delete from public.role_permissions where role_id=(select role_id from public.app_users where id=$1)and permission_code='inventory.count'",
      [actor],
    ),
  );
  const clear = await payload({
    physical_qty: null,
    note: "SYNTHETIC QA RETIRE PREVIOUS COUNT, NOT REAL",
  });
  const retired = await call(clear);
  assert.equal(retired.declarations_retired, 1);
  assert.deepEqual(retired.before.field_evidence.physical_qty, physical);
  assert.equal(retired.after.physical_qty, null);
  assert.equal((await view()).field_evidence.physical_qty.status, "UNKNOWN");
  checks++;
  const event = await one(
    "select receipt from app.m9_legacy_pilot_events where request_id=$1",
    [first.request],
  );
  assert.deepEqual(event.receipt.after.field_evidence.physical_qty, physical);
  checks++;
  assert.equal((await call(first)).historical_receipt, true);
  assert.equal((await view()).physical_qty, null);
  checks++;
  await db.query(
    "create function pg_temp.pilot_fail()returns trigger language plpgsql as $$begin raise exception 'QA_FAILURE_AFTER_DRAFT';end$$;create trigger qa_pilot_fail before insert on app.m9_legacy_pilot_events for each row execute function pg_temp.pilot_fail()",
  );
  const baselineFail = await view();
  await reject(
    await payload({ note: "SYNTHETIC QA FAILURE EXPECTED" }),
    /QA_FAILURE_AFTER_DRAFT/,
  );
  assert.deepEqual(await view(), baselineFail);
  checks++;
  await db.query("drop trigger qa_pilot_fail on app.m9_legacy_pilot_events");
  for (const role of ["anon", "authenticated", "service_role"]) {
    const rights = await one(
      "select has_table_privilege($1,'app.m9_pilot_stock_drafts','UPDATE')t,has_function_privilege($1,'app.m9_pilot_field_source_hash(app.m9_pilot_stock_drafts)','EXECUTE')s,has_function_privilege($1,'app.m9_pilot_field_views(app.m9_pilot_stock_drafts)','EXECUTE')v",
      [role],
    );
    assert.deepEqual(rights, { t: false, s: false, v: false });
    checks++;
  }
  const current = await audit();
  for (const t of [
    "public.inventory_by_location",
    "public.inventory_movements",
    "public.inventory_reservation_movements",
    "public.sales",
    "public.cash_movements",
    "public.customer_credit_ledger",
  ])
    assert.deepEqual(current[t], before[t], t);
  checks++;
  await db.query("rollback");
  assert.deepEqual(await audit(), before);
  checks++;
  const result = {
    protocol: "m9-pilot-field-declaration-local-1",
    scope: "SYNTHETIC_LOCAL_QA_NOT_REAL_COUNTS",
    checks,
    negative_rejections: rejected,
    rollback_tables: tables.length,
    rollback_exact: true,
    same_sheet_and_event_ledger: true,
    unknown_and_zero_distinct: true,
    per_field_actor_server_time_source: true,
    unchanged_metadata_preserved: true,
    withdrawal_history_preserved: true,
    native_inventory_cash_debt_writes: 0,
    remote_writes: 0,
    auth_postgrest_acceptance: false,
  };
  await writeFile(process.argv[2], JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} finally {
  await db.query("rollback");
  await db.end();
}
