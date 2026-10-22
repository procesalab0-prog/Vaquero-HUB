// Synthetic SQL acceptance only. Never accepts a remote/application database.
import pg from "pg";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !/^\/qa_[a-z0-9_]+$/i.test(url.pathname)
)
  throw Error("LOCAL_QA_DATABASE_REQUIRED");
const clients = Array.from(
  { length: 3 },
  (_, i) =>
    new pg.Client({
      connectionString: url.href,
      application_name: "m9-synthetic-race-" + i,
    }),
);
const [db, a, b] = clients,
  results = [];
const origin = "https://salmon-nightingale-251188.hostingersite.com",
  hash = "a".repeat(64);
const query = async (c, sql, args = []) => (await c.query(sql, args)).rows;
const actor = async (c, id) => {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
};
let admin,
  posActor,
  location,
  webSession,
  posSession,
  index = 0;
const stock = async (v) =>
  query(
    db,
    "select variant_id,qty::text,reserved_qty::text from public.inventory_by_location where variant_id=any($1::uuid[]) and location_id=$2 order by variant_id",
    [v, location],
  );
const assertStock = async (v, qty, reserved) => {
  const rows = await stock(v);
  assert.equal(rows.length, v.length);
  for (const row of rows) {
    assert.equal(Number(row.qty), qty);
    assert.equal(Number(row.reserved_qty), reserved);
  }
};
const begin = async (c, id) => {
  await c.query("begin");
  await c.query("set local statement_timeout='15s'");
  await actor(c, id);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function overlap(
  name,
  holder,
  contender,
  release = "commit",
  expectedError = null,
) {
  const hp = (await query(a, "select pg_backend_pid()pid"))[0].pid,
    bp = (await query(b, "select pg_backend_pid()pid"))[0].pid;
  assert.notEqual(hp, bp);
  await begin(a, holder.actor);
  await begin(b, contender.actor);
  let first, waiting, contenderOutcome;
  try {
    first = await holder.run(a);
    const started = performance.now();
    waiting = contender
      .run(b)
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      )
      .then((x) => (contenderOutcome = x));
    let observed = false,
      blockers = [];
    for (let i = 0; i < 100; i++) {
      const row = (
        await query(db, "select pg_blocking_pids($1) blockers", [bp])
      )[0];
      blockers = row.blockers;
      if (blockers.includes(hp)) {
        observed = true;
        break;
      }
      await delay(20);
    }
    assert.equal(
      observed,
      true,
      name +
        ": CONTENTION_NOT_OBSERVED " +
        (contenderOutcome?.error?.message ?? "no early error"),
    );
    // Keep the verified blocking interval distinct from mere request dispatch.
    await delay(60);
    await a.query(release);
    const second = await waiting;
    if (expectedError) {
      assert.equal(second.error?.message, expectedError, name);
      await b.query("rollback");
    } else {
      if (second.error) throw second.error;
      await b.query("commit");
    }
    const proof = {
      name,
      holder_pid: hp,
      contender_pid: bp,
      blockers,
      blocking_observed: true,
      wait_ms: Math.round(performance.now() - started),
      holder_release: release,
      contender_error: second.error?.message ?? null,
    };
    results.push(proof);
    return { first, second: second.value, proof };
  } catch (e) {
    await Promise.allSettled([a.query("rollback"), b.query("rollback")]);
    if (waiting) await waiting;
    throw e;
  }
}
async function fixture(count = 1) {
  index++;
  const rows = [];
  await actor(db, admin);
  for (let j = 0; j < count; j++) {
    const code = "QA-RACE-" + index + "-" + j;
    const cat = (
      await query(
        db,
        "select id from public.categories where name='SYNTHETIC QA race'",
      )
    )[0].id;
    const product = (
      await query(
        db,
        "insert into public.products(name,category_id,description)values($1,$2,$3)returning id",
        [
          "SYNTHETIC QA " + code,
          cat,
          "Fictitious concurrency fixture; no SICAR export",
        ],
      )
    )[0].id;
    const variant = (
      await query(
        db,
        "with n as(select nextval('app.variant_serial_seq') serial)insert into public.variants(product_id,sku,cost_cents,price_cents)select $1,serial::text||'-'||app.luhn_check_digit(serial::text),null,10000 from n returning id",
        [product],
      )
    )[0].id;
    await db.query(
      "insert into public.barcodes(variant_id,code,symbology,source,is_primary)values($1,$2,'LEGACY','SICAR',true)",
      [variant, code],
    );
    await db.query(
      "insert into public.m9_variant_details(variant_id,department,section,source_description)values($1,'SYNTHETIC QA','SYNTHETIC QA race','SYNTHETIC fixture')",
      [variant],
    );
    const current = (
      await query(db, "select app.m9_current_row($1)r", [variant])
    )[0].r;
    assert.ok(current);
    await db.query(
      "insert into app.m9_rows(barcode,variant_id,source_row,source_sha256)values($1,$2,$3,$4)",
      [code, variant, current, hash],
    );
    await db.query(
      "insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row)values($1,$2,$3,$4)",
      [variant, code, hash, current],
    );
    const productId = 9100000000 + index * 10 + j;
    await db.query(
      "insert into app.m9_woo_pilot_links(origin,woo_product_id,woo_variation_id,variant_id,barcode,evidence_sha256)values($1,$2,0,$3,$4,$5)",
      [origin, productId, variant, code, hash],
    );
    await db.query(
      "select app.apply_movement($1,$2,'INITIAL_IMPORT',1,'SYNTHETIC_LOCAL_RACE',$3,'{\"synthetic\":true}')",
      [variant, location, code],
    );
    rows.push({ variant, code, productId });
  }
  const lines = rows.map((r, j) => ({
    line_id: j + 1,
    product_id: r.productId,
    variation_id: 0,
    barcode: r.code,
    quantity: 1,
  }));
  return {
    rows,
    lines,
    ids: rows.map((r) => r.variant),
    oid: 9200000000 + index,
  };
}
const packet = (f, action = "RESERVE", version = 0, operation = "reserve") => ({
  store_origin: origin,
  order_id: f.oid,
  operation_id: operation,
  expected_version: version,
  action,
  evidence_sha256: hash,
  reason: "SYNTHETIC LOCAL QA ONLY",
  lines: f.lines,
});
const reserve = (f, c) =>
  query(c, "select app.m9_woo_pilot_command($1::jsonb)r", [packet(f)]).then(
    (r) => r[0].r,
  );
const pos = (f, c) =>
  query(c, "select to_jsonb(public.create_sale($1,$2,$3::jsonb,$4::jsonb))r", [
    f.posKey ?? (f.posKey = randomUUID()),
    posSession,
    JSON.stringify(f.rows.map((r) => ({ variant_id: r.variant, quantity: 1 }))),
    JSON.stringify([
      {
        method_code: "M9_WEB_TEST",
        amount_cents: 10000 * f.rows.length,
        reference: "SYNTHETIC-POS-" + f.oid,
      },
    ]),
  ]).then((r) => r[0].r);
const finance = (p, c) =>
  query(c, "select app.m9_woo_native_finance($1::jsonb)r", [p]).then(
    (r) => r[0].r,
  );
async function evidence(f, kind = "PAYMENT", original = null) {
  await actor(db, admin);
  const eid = (
    await query(
      db,
      "select app.m9_woo_rehearsal_evidence($1,$2::jsonb,$3,$4)id",
      [f.oid, JSON.stringify(f.lines), kind, original],
    )
  )[0].id;
  return (
    await query(db, "select app.m9_woo_rehearsal_packet($1,$2,$3,$4)p", [
      eid,
      kind === "PAYMENT" ? "post" : "cancel",
      kind === "PAYMENT" ? 1 : 2,
      kind === "PAYMENT" ? "POST" : "FULL_CANCEL",
    ])
  )[0].p;
}
async function cancelWoo(f, p) {
  const refund = await evidence(f, "FULL_CANCEL", p.evidence_id);
  await finance(refund, db);
  await assertStock(f.ids, 1, 0);
}
async function cancelPos(f, sale) {
  await actor(db, posActor);
  await db.query("select public.cancel_sale($1,$2)", [
    sale.id,
    "SYNTHETIC QA compensation; no real payment",
  ]);
  await assertStock(f.ids, 1, 0);
}
async function settleWoo(f) {
  const p = await evidence(f);
  const sale = await finance(p, db);
  await assertStock(f.ids, 0, 0);
  await cancelWoo(f, p);
  return sale;
}
try {
  await Promise.all(clients.map((c) => c.connect()));
  assert.equal(
    (
      await query(
        db,
        "select configured_by from app.sicar_sync_control where singleton",
      )
    )[0]?.configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  assert.equal(
    (await query(db, "select count(*)::int n from public.sales"))[0].n,
    0,
    "Fresh fixture DB required",
  );
  index = (await query(db, "select count(*)::int n from app.m9_rows"))[0].n;
  admin = randomUUID();
  posActor = randomUUID();
  for (const [id, code] of [
    [admin, "QAWEB"],
    [posActor, "QAPOS"],
  ]) {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())",
      [id, code + "@synthetic.invalid"],
    );
    await db.query(
      "insert into public.app_users(id,employee_code,full_name,role_id)select $1,$2,$3,id from public.roles where code='ADMIN'",
      [id, code + id.slice(0, 8).toUpperCase(), "SYNTHETIC " + code],
    );
  }
  location = (
    await query(
      db,
      "insert into public.locations(code,name,type)values($1,'SYNTHETIC QA race','STORE')returning id",
      ["QARACE" + randomUUID().slice(0, 8).toUpperCase()],
    )
  )[0].id;
  await db.query(
    "insert into public.user_locations(user_id,location_id)values($1,$3),($2,$3)",
    [admin, posActor, location],
  );
  const sessions = [];
  for (const [id, code] of [
    [admin, "WEBQA"],
    [posActor, "POSQA"],
  ]) {
    const reg = (
      await query(
        db,
        "insert into public.cash_registers(location_id,code,name)values($1,$2,$3)returning id",
        [location, code, "SYNTHETIC " + code],
      )
    )[0].id;
    await actor(db, id);
    sessions.push(
      (await query(db, "select (public.open_cash_session($1,0)).id", [reg]))[0]
        .id,
    );
  }
  [webSession, posSession] = sessions;
  await db.query(
    "insert into public.categories(name)values('SYNTHETIC QA race')on conflict do nothing",
  );
  await db.query(
    "insert into public.payment_methods(code,name,kind,requires_reference)values('M9_WEB_TEST','SYNTHETIC QA noncash','OTHER',true)on conflict do nothing",
  );
  await db.query(
    "update app.m9_rehearsal_control set enabled=true,review_sha256=$1,expires_at=clock_timestamp()+interval '1 hour'where singleton",
    [hash],
  );
  await db.query(
    "update app.m9_woo_pilot_control set enabled=true,actor_id=$1,location_id=$2,expires_at=clock_timestamp()+interval '10 minutes'where singleton",
    [admin, location],
  );
  await db.query(
    "update app.m9_woo_finance_pilot_control set enabled=true,actor_id=$1,location_id=$2,cash_session_id=$3,expires_at=clock_timestamp()+interval '10 minutes'where singleton",
    [admin, location, webSession],
  );

  let f = await fixture();
  await overlap(
    "WOO_RESERVE_WINS_POS_REJECTS",
    { actor: admin, run: (c) => reserve(f, c) },
    { actor: posActor, run: (c) => pos(f, c) },
    "commit",
    "INSUFFICIENT_STOCK",
  );
  await assertStock(f.ids, 1, 1);
  await settleWoo(f);

  f = await fixture();
  const sold = await overlap(
    "POS_WINS_WOO_RESERVE_REJECTS",
    { actor: posActor, run: (c) => pos(f, c) },
    { actor: admin, run: (c) => reserve(f, c) },
    "commit",
    "INSUFFICIENT_STOCK",
  );
  await assertStock(f.ids, 0, 0);
  await cancelPos(f, sold.first);
  await actor(db, admin);
  await reserve(f, db);
  await settleWoo(f);

  f = await fixture();
  await reserve(f, db);
  let p = await evidence(f);
  await overlap(
    "WOO_NATIVE_POST_WINS_POS_REJECTS",
    { actor: admin, run: (c) => finance(p, c) },
    { actor: posActor, run: (c) => pos(f, c) },
    "commit",
    "INSUFFICIENT_STOCK",
  );
  await assertStock(f.ids, 0, 0);
  await cancelWoo(f, p);

  f = await fixture();
  await reserve(f, db);
  p = await evidence(f);
  const duplicate = await overlap(
    "TWO_FINANCIAL_POSTS_SAME_RECEIPT",
    { actor: admin, run: (c) => finance(p, c) },
    { actor: admin, run: (c) => finance(p, c) },
  );
  assert.equal(duplicate.first.receipt_id, duplicate.second.receipt_id);
  assert.equal(duplicate.second.replayed, true);
  await assertStock(f.ids, 0, 0);
  const refund = await evidence(f, "FULL_CANCEL", p.evidence_id);
  const cancelled = await overlap(
    "TWO_FULL_CANCELS_SAME_RECEIPT",
    { actor: admin, run: (c) => finance(refund, c) },
    { actor: admin, run: (c) => finance(refund, c) },
  );
  assert.equal(cancelled.first.receipt_id, cancelled.second.receipt_id);
  assert.equal(cancelled.second.replayed, true);
  await assertStock(f.ids, 1, 0);

  f = await fixture();
  await overlap(
    "POS_ROLLBACK_WOO_CAN_RESERVE",
    { actor: posActor, run: (c) => pos(f, c) },
    { actor: admin, run: (c) => reserve(f, c) },
    "rollback",
  );
  await assertStock(f.ids, 1, 1);
  await settleWoo(f);

  f = await fixture();
  const posAfterRollback = await overlap(
    "WOO_ROLLBACK_POS_CAN_SELL",
    { actor: admin, run: (c) => reserve(f, c) },
    { actor: posActor, run: (c) => pos(f, c) },
    "rollback",
  );
  await assertStock(f.ids, 0, 0);
  await cancelPos(f, posAfterRollback.second);

  f = await fixture(2);
  f.lines.reverse();
  await overlap(
    "OPPOSITE_LINE_ORDER_NO_DEADLOCK",
    { actor: admin, run: (c) => reserve(f, c) },
    { actor: posActor, run: (c) => pos(f, c) },
    "commit",
    "INSUFFICIENT_STOCK",
  );
  await settleWoo(f);

  await actor(db, admin);
  const check = (
    await query(
      db,
      `select jsonb_build_object('sales',(select count(*)from public.sales),'completed_sales',(select count(*)from public.sales where status<>'CANCELLED'),'payments',(select count(*)from public.sale_payments),'sale_stock_moves',(select count(*)from public.inventory_movements where reference_type='SALE'),'cancel_stock_moves',(select count(*)from public.inventory_movements where reference_type='SALE_CANCELLATION'),'cash_movements',(select count(*)from public.cash_movements where amount_cents<>0),'zero_opening_entries',(select count(*)from public.cash_movements where amount_cents=0 and movement_type='OPENING'),'known_cost_items',(select count(*)from public.sale_items where unit_cost_cents is not null),'negative_stock',(select count(*)from public.inventory_by_location where qty<0 or reserved_qty<0 or reserved_qty>qty),'reservation_sum',(select coalesce(sum(reserved_qty),0)from public.inventory_by_location),'native_paid_orders',(select count(*)from app.m9_woo_finance_postings),'financial_receipts',(select count(*)from app.m9_woo_finance_receipts))r`,
    )
  )[0].r;
  for (const n of [
    "completed_sales",
    "cash_movements",
    "known_cost_items",
    "negative_stock",
    "reservation_sum",
  ])
    assert.equal(check[n], 0, n);
  assert.equal(check.sales, 8);
  assert.equal(check.payments, 8);
  assert.equal(check.native_paid_orders, 6);
  assert.equal(check.financial_receipts, 12);
  assert.equal(check.sale_stock_moves, 9);
  assert.equal(check.cancel_stock_moves, 9);
  await db.query(
    "update app.m9_woo_finance_pilot_control set enabled=false,actor_id=null,location_id=null,cash_session_id=null,expires_at=null where singleton",
  );
  await db.query(
    "update app.m9_woo_pilot_control set enabled=false,actor_id=null,location_id=null,expires_at=null where singleton",
  );
  await db.query(
    "update app.m9_rehearsal_control set enabled=false,review_sha256=null,expires_at=null where singleton",
  );
  const signatures = [
    "app.create_sale_engine(uuid,uuid,jsonb,jsonb,uuid,jsonb,text,uuid)",
    "app.apply_movement(uuid,uuid,text,numeric,text,text,jsonb)",
    "app.m9_woo_pilot_command(jsonb)",
    "app.m9_woo_native_finance(jsonb)",
    "app.cancel_sale_base(uuid,text)",
  ];
  const definitions = [];
  for (const signature of signatures) {
    const definition = (
      await query(db, "select pg_get_functiondef($1::regprocedure)definition", [
        signature,
      ])
    )[0].definition;
    definitions.push({
      signature,
      sha256: createHash("sha256").update(definition).digest("hex"),
      definition,
    });
  }
  const report = {
    status: "PASS",
    scope: "LOCAL_SYNTHETIC_SQL_ONLY",
    database: url.pathname.slice(1),
    postgres: (await query(db, "select version()v"))[0].v,
    scenarios: results,
    checks: check,
    all_controls_disabled: true,
    real_gateway: false,
    remote_woo_order_created: false,
    staging_written: false,
    production_written: false,
  };
  if (process.env.QA_OUTPUT_DIR) {
    await writeFile(
      process.env.QA_OUTPUT_DIR + "/concurrency.json",
      JSON.stringify(report, null, 2),
    );
    await writeFile(
      process.env.QA_OUTPUT_DIR + "/definitions-local.json",
      JSON.stringify(definitions, null, 2),
    );
  }
  console.log(JSON.stringify(report));
} finally {
  await Promise.allSettled(clients.map((c) => c.end()));
}
