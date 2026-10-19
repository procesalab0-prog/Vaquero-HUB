import assert from "node:assert/strict";

// Synthetic local SQL acceptance. Caller already enforces localhost + qa_*.
export async function verifyUnknownCosts(
  db,
  { login, admin, cashier, locations },
) {
  await login(db, admin);
  const loc = locations[0];
  const register = (
    await db.query(
      "select (create_cash_register($1,'QACOST','QA unknown costs')).id",
      [loc],
    )
  ).rows[0].id;
  const session = (
    await db.query("select (open_cash_session($1,1000000)).id", [register])
  ).rows[0].id;
  const category = (
    await db.query("select id from categories where is_active limit 1")
  ).rows[0].id;
  const fixture = async (name, cost, stock = 0) => {
    await login(db, admin);
    const p = (
      await db.query("select create_catalog_product($1,$2,$3::jsonb) r", [
        name,
        category,
        JSON.stringify([
          { cost_cents: cost ?? 1, price_cents: 10000, attributes: {} },
        ]),
      ])
    ).rows[0].r;
    await db.query("reset role");
    const vid = (
      await db.query("select id from variants where product_id=$1", [
        p.product_id,
      ])
    ).rows[0].id;
    await db.query("update variants set cost_cents=$2 where id=$1", [
      vid,
      cost,
    ]);
    await login(db, admin);
    if (stock)
      await db.query(
        "select apply_inventory_adjustment($1,$2,0,$3,'CONTEO_FISICO','QA synthetic cost fixture')",
        [vid, loc, stock],
      );
    return vid;
  };
  const unknown = await fixture("QA COST unknown", null, 10);
  const zero = await fixture("QA COST known zero", 0, 2);
  const known = await fixture("QA COST known", 2500, 2);
  const snapshot = async (sale) => {
    await db.query("reset role");
    const rows = (
      await db.query(
        "select variant_id,unit_cost_cents,quick_cost_recorded from sale_items where sale_id=$1 order by line_number",
        [sale],
      )
    ).rows;
    await login(db, admin);
    return rows;
  };
  const saleSql = "select (create_sale($1,$2,$3::jsonb,$4::jsonb)).id";
  const mixed = [unknown, zero, known].map((variant_id) => ({
    variant_id,
    quantity: 1,
    gift_receipt: false,
  }));
  const args = [
    crypto.randomUUID(),
    session,
    JSON.stringify(mixed),
    JSON.stringify([
      { method_code: "CASH", amount_cents: 30000, tendered_cents: 30000 },
    ]),
  ];
  const sale = (await db.query(saleSql, args)).rows[0].id;
  assert.equal((await db.query(saleSql, args)).rows[0].id, sale);
  assert.deepEqual(
    (await snapshot(sale)).map((x) => x.unit_cost_cents),
    [null, 0, 2500],
  );
  const report = (
    await db.query("select get_inventory_report_v2($1,'QA COST') r", [loc])
  ).rows[0].r;
  assert.equal(report.summary.cost_value_cents, null);
  assert.equal(Number(report.summary.known_cost_value_cents), 2500);
  assert.equal(report.summary.cost_valuation_complete, false);
  assert.equal(Number(report.summary.unvalued_stock_variant_count), 1);
  assert.equal(report.categories[0].cost_value_cents, null);
  const saleReport = (
    await db.query(
      "select get_sales_report_v2($1,now()-interval '1 day',now()+interval '1 day','day','QA COST') r",
      [loc],
    )
  ).rows[0].r;
  assert.equal(Number(saleReport.summary.net_cents), 30000);
  assert.equal("profit_cents" in saleReport.summary, false);
  const receipt = (await db.query("select get_sale_receipt($1) r", [sale]))
    .rows[0].r;
  assert.equal("unit_cost_cents" in receipt.items[0], false);
  await db.query("reset role");
  await db.query("update variants set cost_cents=7777 where id=$1", [unknown]);
  assert.deepEqual(
    (await snapshot(sale)).map((x) => x.unit_cost_cents),
    [null, 0, 2500],
  );
  const returnable = (
    await db.query("select get_returnable_sale($1) r", [sale])
  ).rows[0].r;
  await db.query("reset role");
  const token = (
    await db.query(
      "insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at) values($1,$1,'returns.authorize',now()+interval '5 minutes') returning id",
      [admin],
    )
  ).rows[0].id;
  await login(db, admin);
  const retArgs = [
    crypto.randomUUID(),
    session,
    sale,
    JSON.stringify([
      {
        sale_item_id: returnable.items[0].sale_item_id,
        quantity: 1,
        condition: "RESELLABLE",
      },
    ]),
    token,
  ];
  const retSql =
    "select create_return_exchange($1,$2,$3,$4::jsonb,'[]','[]','[]',$5,'QA unknown cost refund') r";
  const ret = (await db.query(retSql, retArgs)).rows[0].r;
  assert.equal(Number(ret.returned_cents), 10000);
  assert.equal((await db.query(retSql, retArgs)).rows[0].r.id, ret.id);
  assert.equal((await snapshot(sale))[0].unit_cost_cents, null);
  await db.query("reset role");
  await db.query("update variants set cost_cents=null where id=$1", [unknown]);
  await login(db, admin);
  const cancelArgs = [
    crypto.randomUUID(),
    session,
    JSON.stringify([{ variant_id: unknown, quantity: 1 }]),
    JSON.stringify([
      { method_code: "CASH", amount_cents: 10000, tendered_cents: 10000 },
    ]),
  ];
  const cancelled = (await db.query(saleSql, cancelArgs)).rows[0].id;
  await db.query("select cancel_sale($1,'QA unknown cost cancel')", [
    cancelled,
  ]);
  assert.equal((await snapshot(cancelled))[0].unit_cost_cents, null);
  await db.query("reset role");
  assert.equal(
    (await db.query("select status from sales where id=$1", [cancelled]))
      .rows[0].status,
    "CANCELLED",
  );
  const customer = (
    await db.query(
      "insert into customers(full_name,phone_e164,privacy_consent_at,privacy_notice_version) values('QA unknown cost','+523521234568',now(),'QA') returning id",
    )
  ).rows[0].id;
  await login(db, admin);
  const lay = (
    await db.query(
      "select create_layaway($1,$2,$3,current_date+30,$4::jsonb) r",
      [
        crypto.randomUUID(),
        session,
        customer,
        JSON.stringify([
          { variant_id: unknown, quantity: 1, gift_receipt: false },
        ]),
      ],
    )
  ).rows[0].r;
  await db.query("select record_layaway_payment($1,$2,$3,$4::jsonb)", [
    crypto.randomUUID(),
    session,
    lay.id,
    JSON.stringify([
      { method_code: "CASH", amount_cents: 10000, tendered_cents: 10000 },
    ]),
  ]);
  const fulfillKey = crypto.randomUUID();
  const delivered = (
    await db.query("select fulfill_layaway($1,$2,$3) r", [
      fulfillKey,
      session,
      lay.id,
    ])
  ).rows[0].r;
  assert.equal(
    (
      await db.query("select fulfill_layaway($1,$2,$3) r", [
        fulfillKey,
        session,
        lay.id,
      ])
    ).rows[0].r.sale_id,
    delivered.sale_id,
  );
  assert.equal((await snapshot(delivered.sale_id))[0].unit_cost_cents, null);
  const first = await fixture("QA COST first receipt", null);
  const opening = await fixture("QA COST unknown opening", null, 3);
  const supplier = (
    await db.query(
      "select upsert_supplier(null,'QACOST','QA cost supplier') id",
    )
  ).rows[0].id;
  const purchase = async (vid, cost) => {
    const order = (
      await db.query("select create_purchase_order($1,$2,$3::jsonb) r", [
        supplier,
        loc,
        JSON.stringify([{ variant_id: vid, qty: 2, unit_cost_cents: cost }]),
      ])
    ).rows[0].r;
    const item = (
      await db.query(
        "select id from purchase_items where purchase_order_id=$1",
        [order.id],
      )
    ).rows[0].id;
    const key = crypto.randomUUID();
    const params = [
      order.id,
      JSON.stringify([{ purchase_item_id: item, qty: 2 }]),
      key,
    ];
    await db.query("select receive_purchase_order($1,$2::jsonb,$3)", params);
    await db.query("select receive_purchase_order($1,$2::jsonb,$3)", params);
    await db.query("reset role");
    const costAfter = (
      await db.query("select cost_cents from variants where id=$1", [vid])
    ).rows[0].cost_cents;
    const movements = (
      await db.query(
        "select metadata from inventory_movements where variant_id=$1 and movement_type='PURCHASE'",
        [vid],
      )
    ).rows;
    await login(db, admin);
    return { costAfter, movements };
  };
  const firstResult = await purchase(first, 1800);
  assert.equal(firstResult.costAfter, 1800);
  assert.equal(firstResult.movements.length, 1);
  assert.equal(firstResult.movements[0].metadata.cost_method, "FIRST_RECEIPT");
  const openingResult = await purchase(opening, 1800);
  assert.equal(openingResult.costAfter, null);
  assert.equal(
    openingResult.movements[0].metadata.cost_method,
    "UNKNOWN_OPENING_BALANCE",
  );
  const zeroReceipt = await fixture("QA COST first zero receipt", null);
  assert.equal((await purchase(zeroReceipt, 0)).costAfter, 0);
  await fixture("QA COST empty unknown", null);
  const emptyReport = (
    await db.query("select get_inventory_report_v2($1,'QA COST empty') r", [
      loc,
    ])
  ).rows[0].r;
  assert.equal(Number(emptyReport.summary.cost_value_cents), 0);
  assert.equal(emptyReport.summary.cost_valuation_complete, true);
  await login(db, cashier);
  await assert.rejects(
    () => db.query("select get_inventory_report_v2($1) r", [loc]),
    /NOT_AUTHORIZED/,
  );
  await db.query("reset role");
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','sale_items','UPDATE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  console.log(
    JSON.stringify({
      unknown_cost_acceptance: true,
      catalog_null_snapshot: true,
      known_zero_preserved: true,
      mixed_checkout_idempotent: true,
      refund_idempotent: true,
      cancel_null_snapshot: true,
      layaway_delivery_null_snapshot: true,
      late_cost_does_not_rewrite_sale: true,
      incomplete_inventory_valuation: true,
      first_receipt_initializes_cost: true,
      unknown_opening_not_averaged: true,
      receipt_idempotent: true,
      cost_permissions_preserved: true,
      local_only: true,
    }),
  );
}
