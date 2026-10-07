import assert from "node:assert/strict";

/** Backend groundwork only. The caller rejects remote/non-empty QA databases.
 * The new KILO product is seeded by the QA owner with the assignment gate
 * temporarily disabled inside one transaction. This is NOT a production API
 * and does not demonstrate that the unfinished fractional UI is enabled.
 */
export async function verifyMeasureInventory(
  db,
  { login, admin, locations, category, supplier },
) {
  await login(db, admin);
  const product = (
    await db.query(
      "select create_catalog_product('QA Fractional Inventory',$1,$2::jsonb) result",
      [
        category,
        JSON.stringify([{ cost_cents: 0, price_cents: 20000, attributes: {} }]),
      ],
    )
  ).rows[0].result;
  const variant = (
    await db.query(
      "select variant_id from search_catalog('QA Fractional Inventory',5)",
    )
  ).rows[0].variant_id;
  await assert.rejects(
    () =>
      db.query("select set_product_measure_unit($1,'KILO','PIECE')", [
        product.product_id,
      ]),
    /UNIT_FRACTIONAL_FLOW_PENDING/,
  );
  await db.query("reset role");
  await db.query("begin");
  try {
    await db.query(
      "alter table products disable trigger products_measure_unit_guard",
    );
    await db.query("update products set measure_unit_code='KILO' where id=$1", [
      product.product_id,
    ]);
    await db.query(
      "alter table products enable trigger products_measure_unit_guard",
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
  await login(db, admin);
  const order = (
    await db.query("select create_purchase_order($1,$2,$3::jsonb) result", [
      supplier,
      locations[0],
      JSON.stringify([
        { variant_id: variant, qty: 1.25, unit_cost_cents: 12345 },
      ]),
    ])
  ).rows[0].result;
  await db.query("reset role");
  const item = (
    await db.query("select id from purchase_items where purchase_order_id=$1", [
      order.id,
    ])
  ).rows[0].id;
  await login(db, admin);
  const receiveSql = "select receive_purchase_order($1,$2::jsonb,$3) result";
  const firstArgs = [
    order.id,
    JSON.stringify([{ purchase_item_id: item, qty: 0.625 }]),
    crypto.randomUUID(),
  ];
  const first = (await db.query(receiveSql, firstArgs)).rows[0].result;
  assert.equal(first.order_status, "PARTIALLY_RECEIVED");
  assert.equal(
    (await db.query(receiveSql, firstArgs)).rows[0].result.replayed,
    true,
  );
  await assert.rejects(
    () =>
      db.query(receiveSql, [
        order.id,
        JSON.stringify([{ purchase_item_id: item, qty: 0.626 }]),
        crypto.randomUUID(),
      ]),
    /RECEIPT_EXCEEDS_ORDER/,
  );
  await assert.rejects(
    () =>
      db.query(receiveSql, [
        order.id,
        JSON.stringify([{ purchase_item_id: item, qty: 0.0001 }]),
        crypto.randomUUID(),
      ]),
    /INVALID_RECEIPT_ITEMS/,
  );
  const second = (
    await db.query(receiveSql, [
      order.id,
      JSON.stringify([{ purchase_item_id: item, qty: 0.625 }]),
      crypto.randomUUID(),
    ])
  ).rows[0].result;
  assert.equal(second.order_status, "RECEIVED");
  const listed = (
    await db.query("select * from list_purchase_orders_v2($1)", [locations[0]])
  ).rows.find((row) => row.order_id === order.id);
  assert.equal(Number(listed.ordered_qty), 1.25);
  assert.equal(Number(listed.received_qty), 1.25);
  assert.equal(Number(listed.total_cents), 15431);
  assert.equal(listed.items[0].measure_unit_code, "KILO");
  assert.deepEqual(listed.items[0].measure_unit, {
    code: "KILO",
    name: "Kilo",
    decimal_places: 3,
  });
  const receipts = (
    await db.query("select * from list_purchase_receipts_v2($1)", [
      locations[0],
    ])
  ).rows.filter((row) => row.order_id === order.id);
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts[0].items[0].measure_unit, {
    code: "KILO",
    name: "Kilo",
    decimal_places: 3,
  });
  assert.equal(Number(receipts[0].items[0].qty), 0.625);
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('anon','list_purchase_receipts_v2(uuid,integer)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  const snapshot = (
    await db.query("select get_inventory_snapshot_v2($1,'',500) result", [
      locations[0],
    ])
  ).rows[0].result;
  const snapshotItem = snapshot.find((row) => row.variant_id === variant);
  assert.equal(Number(snapshotItem.qty), 1.25);
  assert.deepEqual(snapshotItem.measure_unit, {
    code: "KILO",
    name: "Kilo",
    decimal_places: 3,
  });
  assert.equal("cost_cents" in snapshotItem, false);
  await assert.rejects(
    () => db.query("select * from list_purchase_orders($1)", [locations[0]]),
    /FRACTIONAL_PURCHASE_REQUIRES_V2/,
  );
  await assert.rejects(
    () =>
      db.query(
        "select apply_inventory_adjustment($1,$2,1.25,1.2345,'CONTEO_FISICO','QA precisión')",
        [variant, locations[0]],
      ),
    /INVALID_MEASURE_QUANTITY/,
  );
  const count = (
    await db.query("select create_inventory_count($1) result", [locations[0]])
  ).rows[0].result;
  await db.query("select record_inventory_count_item($1,$2,1.125)", [
    count.id,
    variant,
  ]);
  await db.query("select close_inventory_count($1)", [count.id]);
  await db.query("reset role");
  const captured = (
    await db.query(
      "select system_qty,counted_qty,difference from inventory_count_items where count_id=$1 and variant_id=$2",
      [count.id, variant],
    )
  ).rows[0];
  assert.equal(Number(captured.system_qty), 1.25);
  assert.equal(Number(captured.counted_qty), 1.125);
  assert.equal(Number(captured.difference), -0.125);
  const receiver = crypto.randomUUID();
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
    [receiver, `${receiver}@qa.test`],
  );
  await db.query(
    "insert into app_users(id,employee_code,full_name,role_id) select $1,$2,'QA Fractional Receiver',id from roles where code='ADMIN'",
    [receiver, `QA${receiver.slice(0, 8).toUpperCase()}`],
  );
  await login(db, admin);
  const transfer = (
    await db.query("select create_transfer($1,$2,$3::jsonb) result", [
      locations[0],
      locations[1],
      JSON.stringify([{ variant_id: variant, qty: 0.5 }]),
    ])
  ).rows[0].result;
  await db.query("select approve_transfer($1)", [transfer.id]);
  await db.query("select prepare_transfer($1,$2::jsonb)", [
    transfer.id,
    JSON.stringify([{ variant_id: variant, qty: 0.5 }]),
  ]);
  await db.query("select dispatch_transfer($1)", [transfer.id]);
  await db.query("reset role");
  const stock = async () =>
    (
      await db.query(
        "select i.location_id,l.type,i.qty,i.reserved_qty from inventory_by_location i join locations l on l.id=i.location_id where variant_id=$1",
        [variant],
      )
    ).rows;
  const inTransit = await stock();
  assert.equal(
    Number(inTransit.find((row) => row.location_id === locations[0]).qty),
    0.625,
  );
  // A destination with no previous movement legitimately has no balance row.
  assert.equal(
    Number(inTransit.find((row) => row.location_id === locations[1])?.qty ?? 0),
    0,
  );
  assert.equal(
    Number(inTransit.find((row) => row.type === "TRANSIT").qty),
    0.5,
  );
  await login(db, receiver);
  const received = (
    await db.query("select receive_transfer($1,$2::jsonb) result", [
      transfer.id,
      JSON.stringify([{ variant_id: variant, qty: 0.375 }]),
    ])
  ).rows[0].result;
  assert.equal(Number(received.remaining_in_transit), 0.125);
  const transferList = (
    await db.query("select list_inventory_transfers_v2($1) result", [
      locations[1],
    ])
  ).rows[0].result;
  assert.equal(
    transferList.find((row) => row.transfer_id === transfer.id).measure_unit
      .code,
    "KILO",
  );
  await assert.rejects(
    () =>
      db.query("select receive_transfer($1,$2::jsonb)", [
        transfer.id,
        JSON.stringify([{ variant_id: variant, qty: 0.375 }]),
      ]),
    /INVALID_TRANSFER_STATE/,
  );
  await db.query("reset role");
  const after = await stock();
  assert.equal(
    Number(after.find((row) => row.location_id === locations[1]).qty),
    0.375,
  );
  assert.equal(Number(after.find((row) => row.type === "TRANSIT").qty), 0.125);
  assert.equal(
    after.reduce((sum, row) => sum + Number(row.qty), 0),
    1.125,
  );
  const ledger = (
    await db.query(
      "select sum(quantity) qty from inventory_movements where variant_id=$1",
      [variant],
    )
  ).rows[0];
  assert.equal(Number(ledger.qty), 1.125);
  // Even privileged writes cannot round at the column or evade unit precision.
  await db.query("begin");
  try {
    await db.query("select set_config('app.inventory_write','on',true)");
    await assert.rejects(
      () =>
        db.query(
          "update inventory_by_location set qty=qty+0.0001 where variant_id=$1",
          [variant],
        ),
      /INVALID_MEASURE_QUANTITY/,
    );
  } finally {
    await db.query("rollback");
  }
  assert.equal(
    (await stock()).reduce((sum, row) => sum + Number(row.qty), 0),
    1.125,
  );
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','inventory_by_location','UPDATE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','app.inventory_report_lines','SELECT') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('anon','get_inventory_snapshot_v2(uuid,text,integer)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  return { variant, unit: "KILO", quantity: 1.125 };
}
