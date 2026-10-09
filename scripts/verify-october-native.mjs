/** Only runs after verify-operational-native on its isolated qa_* database. */
import pg from "pg";
import assert from "node:assert/strict";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  !/^\/qa_[a-z0-9_]+$/.test(target.pathname)
)
  throw Error("Use an isolated local qa_* database");
const db = new pg.Client({ connectionString: target.href });
const a = new pg.Client({ connectionString: target.href });
const b = new pg.Client({ connectionString: target.href });
await Promise.all([db.connect(), a.connect(), b.connect()]);
pg.types.setTypeParser(20, Number);
const login = async (client, id) => {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id,
  ]);
  await client.query("set role authenticated");
};
try {
  const admin = crypto.randomUUID(),
    cashier = crypto.randomUUID();
  for (const [id, role] of [
    [admin, "ADMIN"],
    [cashier, "CASHIER"],
  ]) {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, `${id}@qa.test`],
    );
    await db.query(
      "insert into app_users(id,employee_code,full_name,role_id) select $1,$2,$3,id from roles where code=$3",
      [id, `OCT${id.slice(0, 8).toUpperCase()}`, role],
    );
  }
  const loc = (
    await db.query(
      "insert into locations(code,name,type) values($1,'QA October','STORE') returning id",
      [`OCT${crypto.randomUUID().slice(0, 5).toUpperCase()}`],
    )
  ).rows[0].id;
  await db.query(
    "insert into user_locations(user_id,location_id) values($1,$3),($2,$3)",
    [admin, cashier, loc],
  );
  await login(db, admin);
  const category = (
    await db.query(
      "select create_catalog_category('QA October Category '||$1,null) result",
      [crypto.randomUUID()],
    )
  ).rows[0].result;
  await assert.rejects(
    () => db.query("select create_catalog_category($1,null)", [category.name]),
    /duplicate key/,
  );
  const productName = `QA October Item ${crypto.randomUUID()}`;
  await db.query("select create_catalog_product($1,$2,$3::jsonb)", [
    productName,
    category.id,
    JSON.stringify([{ cost_cents: 10000, price_cents: 25000, attributes: {} }]),
  ]);
  const variant = (
    await db.query("select variant_id from search_catalog($1,5)", [productName])
  ).rows[0].variant_id;
  const entryId = crypto.randomUUID(),
    entries = JSON.stringify([
      { variant_id: variant, expected_qty: 0, qty: 5 },
    ]);
  const add = "select add_manual_stock($1,$2,$3::jsonb,$4) result";
  await db.query(add, [entryId, loc, entries, "QA initial entry"]);
  assert.equal(
    (await db.query(add, [entryId, loc, entries, "QA initial entry"])).rows[0]
      .result.repeated,
    true,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select qty from inventory_by_location where variant_id=$1 and location_id=$2",
          [variant, loc],
        )
      ).rows[0].qty,
    ),
    5,
  );
  await assert.rejects(
    () => db.query(add, [entryId, loc, entries, "QA changed entry"]),
    /IDEMPOTENCY_CONFLICT/,
  );
  await assert.rejects(
    () =>
      db.query(add, [
        crypto.randomUUID(),
        loc,
        JSON.stringify([{ variant_id: variant, expected_qty: 0, qty: 1 }]),
        "QA stale entry",
      ]),
    /STALE_INVENTORY/,
  );
  const register = (
    await db.query(
      "select (create_cash_register($1,'OCT01','October 01')).id",
      [loc],
    )
  ).rows[0].id;
  const session = (
    await db.query("select (open_cash_session($1,100000)).id", [register])
  ).rows[0].id;
  const items = JSON.stringify([
    { variant_id: variant, quantity: 1, gift_receipt: false },
  ]);
  const payments = JSON.stringify([
    {
      method_code: "CARD",
      card_kind: "CREDIT",
      amount_cents: 15000,
      reference: "QA credit",
    },
    {
      method_code: "CARD",
      card_kind: "DEBIT",
      amount_cents: 10000,
      reference: "QA debit",
    },
  ]);
  const sale = (
    await db.query("select (create_sale($1,$2,$3::jsonb,$4::jsonb)).*", [
      crypto.randomUUID(),
      session,
      items,
      payments,
    ])
  ).rows[0];
  const receipt = (
    await db.query("select get_sale_receipt($1) result", [sale.id])
  ).rows[0].result;
  assert.deepEqual(receipt.payments.map((p) => p.card_kind).sort(), [
    "CREDIT",
    "DEBIT",
  ]);
  assert(receipt.payments.every((p) => p.method_name.includes("Tarjeta de")));
  await assert.rejects(
    () =>
      db.query("select create_sale($1,$2,$3::jsonb,$4::jsonb)", [
        crypto.randomUUID(),
        session,
        items,
        JSON.stringify([
          {
            method_code: "CARD",
            card_kind: "DEBIT",
            amount_cents: 10000,
            reference: "QA1",
          },
          {
            method_code: "CARD",
            card_kind: "DEBIT",
            amount_cents: 15000,
            reference: "QA2",
          },
        ]),
      ]),
    /DUPLICATE_PAYMENT_METHOD/,
  );
  await db.query("select request_sale_print($1,'GIFT_RECEIPT')", [sale.id]);
  await db.query(
    "select record_sale_ticket_delivery($1,'DOWNLOAD','DOWNLOADED','GIFT')",
    [sale.id],
  );
  const preview = (await db.query("select location_cash_cut($1) result", [loc]))
    .rows[0].result;
  assert.equal(preview.open_sessions, 1);
  await assert.rejects(
    () =>
      db.query("select location_cash_cut($1,$2,$3)", [
        loc,
        crypto.randomUUID(),
        [],
      ]),
    /LOCATION_HAS_OPEN_SESSIONS/,
  );
  await db.query("select close_cash_session($1,100000,null)", [session]);
  const closed = (await db.query("select location_cash_cut($1) result", [loc]))
    .rows[0].result;
  assert.equal(closed.counted_cents, 100000);
  assert.equal(closed.difference_cents, 0);
  const cutId = crypto.randomUUID();
  await assert.rejects(
    () =>
      db.query("select location_cash_cut($1,$2,$3)", [
        loc,
        cutId,
        [crypto.randomUUID()],
      ]),
    /CUT_SESSIONS_CHANGED/,
  );
  const cut = (
    await db.query("select location_cash_cut($1,$2,$3) result", [
      loc,
      cutId,
      [session],
    ])
  ).rows[0].result;
  assert.equal(cut.saved, true);
  assert.equal(
    (
      await db.query("select location_cash_cut($1,$2,$3) result", [
        loc,
        cutId,
        [session],
      ])
    ).rows[0].result.id,
    cutId,
  );
  await assert.rejects(
    () =>
      db.query("select location_cash_cut($1,$2,$3)", [
        loc,
        crypto.randomUUID(),
        [session],
      ]),
    /CUT_EMPTY/,
  );
  const secondRegister = (
    await db.query(
      "select (create_cash_register($1,'OCT02','October 02')).id",
      [loc],
    )
  ).rows[0].id;
  const nextSession = (
    await db.query("select (open_cash_session($1,10000)).id", [register])
  ).rows[0].id;
  await db.query("select close_cash_session($1,9900,'QA faltante simulado')", [
    nextSession,
  ]);
  const secondSession = (
    await db.query("select (open_cash_session($1,20000)).id", [secondRegister])
  ).rows[0].id;
  await db.query("select close_cash_session($1,20000,null)", [secondSession]);
  const combined = (
    await db.query("select location_cash_cut($1) result", [loc])
  ).rows[0].result;
  assert.equal(combined.sessions.length, 2);
  assert.equal(combined.counted_cents, 29900);
  assert.equal(combined.expected_cents, 30000);
  assert.equal(combined.difference_cents, -100);
  await db.query("select location_cash_cut($1,$2,$3)", [
    loc,
    crypto.randomUUID(),
    [nextSession, secondSession],
  ]);
  const costs = (
    await db.query(
      "select report_operational_costs($1,now()-interval '1 day',now()+interval '1 day') result",
      [loc],
    )
  ).rows[0].result;
  assert.equal(costs.entries[0].value_cents, 50000);
  const notices = (
    await db.query("select list_operational_notifications($1,null) result", [
      loc,
    ])
  ).rows[0].result;
  assert(notices.length > 0);
  await db.query("select ack_operational_notifications($1,$2)", [
    loc,
    notices.map((n) => n.id),
  ]);
  assert.equal(
    (
      await db.query("select list_operational_notifications($1,null) result", [
        loc,
      ])
    ).rows[0].result.length,
    0,
  );
  assert.deepEqual(
    (await db.query("select list_customer_layaway_accounts($1) result", [loc]))
      .rows[0].result,
    [],
  );
  await login(db, cashier);
  await assert.rejects(
    () => db.query("select location_cash_cut($1)", [loc]),
    /NOT_AUTHORIZED/,
  );
  await assert.rejects(
    () =>
      db.query(
        "select report_operational_costs($1,now()-interval '1 day',now())",
        [loc],
      ),
    /NOT_AUTHORIZED/,
  );
  await assert.rejects(
    () => db.query("select create_catalog_category('Unauthorized',null)"),
    /NOT_AUTHORIZED/,
  );
  await assert.rejects(
    () => db.query(add, [crypto.randomUUID(), loc, entries, "QA forbidden"]),
    /NOT_AUTHORIZED/,
  );
  await db.query("reset role");
  await assert.rejects(
    () => db.query("delete from manual_stock_entries where id=$1", [entryId]),
    /IMMUTABLE_OPERATIONAL_DOCUMENT/,
  );
  await assert.rejects(
    () => db.query("delete from location_cash_cuts where id=$1", [cutId]),
    /IMMUTABLE_OPERATIONAL_DOCUMENT/,
  );
  await login(a, admin);
  await login(b, admin);
  const parallelEntries = JSON.stringify([
    { variant_id: variant, expected_qty: 4, qty: 1 },
  ]);
  const results = await Promise.allSettled([
    a.query(add, [
      crypto.randomUUID(),
      loc,
      parallelEntries,
      "QA concurrent A",
    ]),
    b.query(add, [
      crypto.randomUUID(),
      loc,
      parallelEntries,
      "QA concurrent B",
    ]),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /STALE_INVENTORY/,
  );
  console.log(
    "October category, stock idempotency/stale/concurrency, debit+credit, post-sale gift, branch cut, notices/ack, cost valuation, role checks and immutable documents: PASS (local SQL; not real Auth/PostgREST).",
  );
} finally {
  await Promise.allSettled([db.end(), a.end(), b.end()]);
}
