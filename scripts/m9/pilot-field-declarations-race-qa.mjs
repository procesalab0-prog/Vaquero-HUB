// Assigned local clone only. Own synthetic catalog fixtures are retained inactive;
// native inventory calls run only on own fixtures and are always rolled back.
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
    "Usage: LOCAL_QA_URL node pilot-field-declarations-race-qa.mjs NEW_RESULT.json",
  );
const db = new pg.Client({ connectionString: u.href }),
  writer = new pg.Client({ connectionString: u.href }),
  saver = new pg.Client({ connectionString: u.href });
await Promise.all([db.connect(), writer.connect(), saver.connect()]);
const one = async (c, q, a = []) => (await c.query(q, a)).rows[0];
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
const products = [],
  variants = [];
const nativeTables = [
  "public.inventory_by_location",
  "public.inventory_movements",
  "public.inventory_reservation_movements",
  "public.sales",
  "public.cash_movements",
  "public.customer_credit_ledger",
];
const nativeSQL =
  "select jsonb_object_agg(name,jsonb_build_object('n',n,'h',h))v from(" +
  nativeTables
    .map(
      (t) =>
        `select '${t}'name,count(*)n,md5(coalesce(string_agg(j,'|'order by j),''))h from(select to_jsonb(t)::text j from ${t} t)x`,
    )
    .join(" union all ") +
  ")x";
try {
  const nativeBefore = (await one(db, nativeSQL)).v;
  assert.equal(
    (await one(db, "select count(*)::int n from app.m9_pilot_stock_drafts")).n,
    0,
    "Never replace an existing pilot sheet, even in QA",
  );
  assert.equal(
    (
      await one(
        db,
        "select count(*)::int n from public.barcodes where code=any($1::text[])",
        [codes],
      )
    ).n,
    0,
    "Race requires wholly own synthetic fixtures",
  );
  await db.query("begin;set local timezone='UTC'");
  await db.query(
    await readFile(
      new URL("./pilot-field-declarations.sql", import.meta.url),
      "utf8",
    ),
  );
  const actor = (
    await one(
      db,
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit 1",
    )
  ).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  const location = (
    await one(
      db,
      "select id from public.locations where type='STORE'and is_active order by id limit 1",
    )
  ).id;
  const category = (
    await one(
      db,
      "select id from public.categories where is_active order by id limit 1",
    )
  ).id;
  for (const code of codes) {
    const product = (
      await one(
        db,
        "insert into public.products(name,category_id,created_by,updated_by)values($1,$2,$3,$3)returning id",
        ["SYNTHETIC PILOT RACE QA NOT SICAR " + code, category, actor],
      )
    ).id;
    products.push(product);
    const variant = (
      await one(
        db,
        "with s as(select nextval('app.variant_serial_seq')n)insert into public.variants(product_id,sku,cost_cents,price_cents,created_by,updated_by)select $1,n::text||'-'||app.luhn_check_digit(n::text),null,100,$2,$2 from s returning id",
        [product, actor],
      )
    ).id;
    variants.push(variant);
    await db.query(
      "insert into public.barcodes(variant_id,code,symbology,source,is_primary)values($1,$2,'CODE128','SICAR',true)",
      [variant, code],
    );
    await db.query(
      "insert into app.m9_pilot_stock_drafts(barcode,variant_id,location_id,catalog_hash,baseline,observed_qty,observed_at,evidence_sha256)values($1,$2,$3,app.m9_pilot_catalog_hash($2,$1),app.m9_pilot_balance_snapshot($2,$3),111,clock_timestamp(),repeat('a',64))",
      [code, variant, location],
    );
  }
  await db.query("commit");
  for (const c of [db, writer, saver]) {
    await c.query(
      "set statement_timeout='15s';set lock_timeout='10s';set timezone='UTC'",
    );
    await c.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
  }
  const wp = (await one(writer, "select pg_backend_pid()pid")).pid,
    sp = (await one(saver, "select pg_backend_pid()pid")).pid;
  async function blocked(waiting, holder) {
    for (let n = 0; n < 200; n++) {
      if (
        (
          await one(db, "select pg_blocking_pids($1)pids", [waiting])
        ).pids.includes(holder)
      )
        return;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw Error("REAL_BLOCKING_PID_NOT_OBSERVED");
  }
  async function payload() {
    const v = (
      await one(db, "select app.m9_legacy_pilot_api('LIST','{}')v")
    ).v.stock.find((r) => r.barcode === "2396");
    return {
      request: randomUUID(),
      barcode: "2396",
      revision: String(v.revision),
      physical_qty: null,
      sold_waiting_qty: null,
      separated_qty: null,
      note: "SYNTHETIC QA NOTE ONLY; NO PHYSICAL COUNTS",
      expected_source_sha256: v.field_source_sha256,
      count_evidence: {},
    };
  }
  const call = (p) =>
    saver
      .query("select public.m9_legacy_pilot('SAVE_STOCK_DRAFT',$1::jsonb)", [p])
      .then(
        (v) => ({ v }),
        (e) => ({ e }),
      );
  let observed = 0;
  const rejected = [];
  async function busy(p) {
    await saver.query("begin;savepoint caller_can_recover");
    const result = await call(p);
    assert.equal(result.e?.code, "55P03");
    assert.match(result.e?.message ?? "", /M9_PILOT_BUSY_RETRY/);
    await saver.query("rollback to caller_can_recover");
    // Exception subtransaction must release barriers and nonce before caller ends.
    const locks = (
      await one(
        db,
        `select count(*)::int n from pg_locks where pid=$1
      and granted and (locktype='advisory' or relation in(
       'public.products'::regclass,'public.variants'::regclass,
       'public.inventory_by_location'::regclass,'app.m9_pilot_stock_drafts'::regclass))`,
        [sp],
      )
    ).n;
    assert.equal(locks, 0, "No partial barrier survives failed NOWAIT save");
    await saver.query("rollback");
  }
  async function rejectedAfterCommit(p, message) {
    await saver.query("begin");
    const result = await call(p);
    assert.match(result.e?.message ?? "", message);
    await saver.query("rollback");
    rejected.push(message.source);
  }
  // Exact previously deadlocking order: native writer owns inventory first.
  // The real public operational function then invokes cost-basis trigger/variant lock.
  const nativePayload = await payload();
  await writer.query(
    "begin;lock table public.inventory_by_location in row exclusive mode",
  );
  await busy(nativePayload);
  const native1 = (
    await one(
      writer,
      "select public.apply_inventory_adjustment($1,$2,0,1,'ERROR_CAPTURA','SYNTHETIC QA ONLY; ROLLBACK')v",
      [variants[0], location],
    )
  ).v;
  assert.equal(native1.status, "UPDATED");
  assert.equal(Number(native1.new_qty), 1);
  await writer.query("rollback");
  assert.deepEqual((await one(db, nativeSQL)).v, nativeBefore);
  observed++;

  // Reverse order: pilot barriers acquired first, native writer waits safely;
  // pilot rollback releases them, then actual adjustment/trigger completes.
  await saver.query("begin");
  const saved = await call(await payload());
  if (saved.e) throw saved.e;
  await writer.query("begin");
  const nativeWaiting = writer
    .query(
      "select public.apply_inventory_adjustment($1,$2,0,1,'ERROR_CAPTURA','SYNTHETIC QA ONLY; ROLLBACK')v",
      [variants[0], location],
    )
    .then(
      (v) => ({ v: v.rows[0].v }),
      (e) => ({ e }),
    );
  await blocked(wp, sp);
  await saver.query("rollback");
  const native2 = await nativeWaiting;
  if (native2.e) throw native2.e;
  assert.equal(native2.v.status, "UPDATED");
  await writer.query("rollback");
  assert.deepEqual((await one(db, nativeSQL)).v, nativeBefore);
  observed++;

  // Catalog/source changes cannot be certified by retrying stale form values.
  const beforeCatalog = await payload();
  await writer.query("begin");
  await writer.query(
    "update public.variants set price_cents=price_cents+1 where id=$1",
    [variants[0]],
  );
  await busy(beforeCatalog);
  await writer.query("commit");
  await rejectedAfterCommit(beforeCatalog, /BASELINE_CHANGED/);
  await db.query(
    "update app.m9_pilot_stock_drafts set catalog_hash=app.m9_pilot_catalog_hash(variant_id,barcode)where barcode='2396'",
  );
  observed++;
  const beforeSource = await payload();
  await writer.query(
    "begin;update app.m9_pilot_stock_drafts set observed_qty=observed_qty+1 where barcode='2396'",
  );
  await busy(beforeSource);
  await writer.query("commit");
  await rejectedAfterCommit(beforeSource, /FIELD_SOURCE_CHANGED/);
  observed++;

  const sameRequest = await payload();
  await writer.query("begin");
  await writer.query(
    "select pg_advisory_xact_lock(hashtextextended('m9-pilot-request:'||$1::text,0))",
    [sameRequest.request],
  );
  await busy(sameRequest);
  await writer.query("rollback");
  observed++;
  const drafts = (
    await one(
      db,
      "select count(*)::int rows,count(physical_qty)+count(sold_waiting_qty)+count(separated_qty)fields,count(*)filter(where field_evidence<>'{}')::int attributed from app.m9_pilot_stock_drafts",
    )
  ).rows;
  assert.equal(drafts, 12);
  assert.equal(
    (
      await one(
        db,
        "select count(physical_qty)+count(sold_waiting_qty)+count(separated_qty)fields from app.m9_pilot_stock_drafts",
      )
    ).fields,
    "0",
  );
  assert.equal(
    (
      await one(
        db,
        "select count(*)::int n from app.m9_legacy_pilot_events where action='STOCK_DRAFT'",
      )
    ).n,
    0,
  );
  await db.query(
    "update public.variants set is_active=false where id=any($1::uuid[])",
    [variants],
  );
  await db.query(
    "update public.products set is_active=false where id=any($1::uuid[])",
    [products],
  );
  assert.deepEqual((await one(db, nativeSQL)).v, nativeBefore);
  const report = {
    protocol: "m9-pilot-field-declaration-race-1",
    local_database: u.pathname.slice(1),
    own_synthetic_catalog_fixtures_retained_inactive: 12,
    concurrency_scenarios: observed,
    real_native_writer_first_nowait_no_deadlock: true,
    real_native_writer_after_pilot_rollback_completed: true,
    rejected_save_releases_all_partial_barriers_before_caller_ends: true,
    catalog_and_source_contention_rejected_then_stale_form_held: rejected,
    same_nonce_in_flight_rejected_without_wait: true,
    actual_local_native_adjustments_rolled_back: 2,
    physical_fields_nonnull: 0,
    stock_draft_events_retained: 0,
    native_inventory_cash_debt_tables_unchanged: nativeTables.length,
    deadlocks: 0,
    remote_writes: 0,
    real_counts_entered: 0,
    auth_postgrest_acceptance: false,
    note: "Committed own local catalog/source drift history is retained. Two real native adjustments used synthetic own fixtures and were completely rolled back. All 36 pilot fields remain NULL; no real human count was fabricated.",
  };
  await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
} finally {
  await Promise.allSettled([
    db.query("rollback"),
    writer.query("rollback"),
    saver.query("rollback"),
  ]);
  await Promise.all([db.end(), writer.end(), saver.end()]);
}
