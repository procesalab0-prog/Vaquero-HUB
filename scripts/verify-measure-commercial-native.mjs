import assert from "node:assert/strict";

/** Uses only the isolated fixture seeded by verifyMeasureInventory. Does not
 * bypass the product gate itself or authorize activation in production. */
export async function verifyMeasureCommercial(
  db,
  { login, admin, locations, session, variant, pieceVariant },
) {
  await login(db, admin);
  await db.query(
    "select apply_inventory_adjustment($1,$2,0.375,5,'CONTEO_FISICO','QA fracciones comerciales')",
    [variant, locations[0]],
  );
  await db.query("select update_catalog_variant_price($1,12345)", [variant]);
  const items = JSON.stringify([
    { variant_id: variant, quantity: 1.25, gift_receipt: false },
  ]);
  const metadata = (
    await db.query("select get_pos_variants($1,$2::uuid[]) result", [
      session,
      [variant],
    ])
  ).rows[0].result;
  assert.deepEqual(metadata[0].measureUnit, {
    code: "KILO",
    name: "Kilo",
    decimal_places: 3,
  });
  const held = (
    await db.query("select hold_pos_draft($1,$2::jsonb,null,0,$3) id", [
      session,
      items,
      "QA fracciones",
    ])
  ).rows[0].id;
  assert.equal(
    (await db.query("select resume_pos_draft($1) result", [held])).rows[0]
      .result.items[0].quantity,
    1.25,
  );
  const quote = (
    await db.query(
      "select (create_quote_v2($1,$2::jsonb,null,null,null,$3)).*",
      [
        locations[0],
        JSON.stringify([
          {
            variant_id: variant,
            quantity: 1.25,
            unit_price_cents: 12345,
            discount_cents: 31,
          },
        ]),
        "Empresa fracciones QA",
      ],
    )
  ).rows[0];
  assert.equal(Number(quote.subtotal_cents), 15431);
  assert.equal(Number(quote.total_cents), 15400);
  const conversion = [
    quote.id,
    crypto.randomUUID(),
    session,
    JSON.stringify([
      { method_code: "CASH", amount_cents: 15400, tendered_cents: 15400 },
    ]),
  ];
  const converted = (
    await db.query(
      "select (convert_quote_to_sale($1,$2,$3,$4::jsonb)).*",
      conversion,
    )
  ).rows[0];
  assert.equal(Number(converted.total_cents), 15400);
  assert.equal(
    (
      await db.query(
        "select (convert_quote_to_sale($1,$2,$3,$4::jsonb)).*",
        conversion,
      )
    ).rows[0].id,
    converted.id,
  );
  await db.query("select cancel_sale($1,$2)", [
    converted.id,
    "QA cancelar fracciones",
  ]);
  const saleSql = "select (create_sale($1,$2,$3::jsonb,$4::jsonb)).*";
  const args = [
    crypto.randomUUID(),
    session,
    items,
    JSON.stringify([
      { method_code: "CASH", amount_cents: 15431, tendered_cents: 15431 },
    ]),
  ];
  const sale = (await db.query(saleSql, args)).rows[0];
  assert.equal(Number(sale.total_cents), 15431);
  assert.equal((await db.query(saleSql, args)).rows[0].id, sale.id);
  const original = (
    await db.query("select get_returnable_sale($1) result", [sale.id])
  ).rows[0].result;
  assert.equal(Number(original.items[0].remaining_quantity), 1.25);
  assert.deepEqual(original.items[0].measureUnit, {
    code: "KILO",
    name: "Kilo",
    decimal_places: 3,
  });
  const returnSql =
    "select create_return_exchange($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9) result";
  const token = async () => {
    await db.query("reset role");
    const result = (
      await db.query(
        "insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at) values($1,$1,'returns.authorize',now()+interval '5 minutes') returning id",
        [admin],
      )
    ).rows[0].id;
    await login(db, admin);
    return result;
  };
  const back = async (quantity) => {
    const auth = await token();
    const params = [
      crypto.randomUUID(),
      session,
      sale.id,
      JSON.stringify([
        {
          sale_item_id: original.items[0].sale_item_id,
          quantity,
          condition: "RESELLABLE",
        },
      ]),
      "[]",
      "[]",
      "[]",
      auth,
      "QA devolver fracción",
    ];
    const result = (await db.query(returnSql, params)).rows[0].result;
    assert.equal(
      (await db.query(returnSql, params)).rows[0].result.id,
      result.id,
    );
    return result;
  };
  const first = await back(0.333),
    second = await back(0.333),
    last = await back(0.584);
  assert.equal(first.difference_cents, -4110);
  assert.equal(second.difference_cents, -4110);
  assert.equal(last.difference_cents, -7211); // Last fraction receives all remaining cents.
  assert.equal(
    first.difference_cents + second.difference_cents + last.difference_cents,
    -15431,
  );
  await assert.rejects(() => back(0.001), /RETURN_EXCEEDS_SOLD/);
  await assert.rejects(
    () =>
      db.query(saleSql, [
        crypto.randomUUID(),
        session,
        JSON.stringify([{ variant_id: variant, quantity: 1.2501 }]),
        args[3],
      ]),
    /INVALID_MEASURE_QUANTITY/,
  );
  await assert.rejects(
    () =>
      db.query("select hold_pos_draft($1,$2::jsonb)", [
        session,
        JSON.stringify([
          { variant_id: pieceVariant, quantity: 0.5, gift_receipt: false },
        ]),
      ]),
    /INVALID_MEASURE_QUANTITY/,
  );
  await db.query("reset role");
  const customer = (
    await db.query(
      "insert into customers(full_name,phone_e164,privacy_consent_at,privacy_notice_version) values('QA Fracciones','+523521234567',now(),'QA') returning id",
    )
  ).rows[0].id;
  await login(db, admin);
  const layaway = (
    await db.query(
      "select create_layaway($1,$2,$3,current_date+30,$4::jsonb) result",
      [crypto.randomUUID(), session, customer, items],
    )
  ).rows[0].result;
  assert.equal(Number(layaway.total_cents), 15431);
  await assert.rejects(
    () =>
      db.query("select fulfill_layaway($1,$2,$3)", [
        crypto.randomUUID(),
        session,
        layaway.id,
      ]),
    /LAYAWAY_NOT_READY/,
  );
  const cash = async () => {
    await db.query("reset role");
    const amount = Number(
      (
        await db.query(
          "select sum(amount_cents) amount from cash_movements where session_id=$1",
          [session],
        )
      ).rows[0].amount,
    );
    await login(db, admin);
    return amount;
  };
  const before = await cash();
  await db.query("select record_layaway_payment($1,$2,$3,$4::jsonb)", [
    crypto.randomUUID(),
    session,
    layaway.id,
    JSON.stringify([
      { method_code: "CASH", amount_cents: 15431, tendered_cents: 15431 },
    ]),
  ]);
  const paid = await cash();
  const delivered = (
    await db.query("select fulfill_layaway($1,$2,$3) result", [
      crypto.randomUUID(),
      session,
      layaway.id,
    ])
  ).rows[0].result;
  const after = await cash();
  assert.equal(paid - before, 15431);
  assert.equal(after, paid);
  const receipt = (
    await db.query("select get_sale_receipt($1) result", [delivered.sale_id])
  ).rows[0].result;
  assert.equal(Number(receipt.items[0].quantity), 1.25);
  assert.deepEqual(receipt.items[0].measureUnit, {
    code: "KILO",
    name: "Kilo",
    decimal_places: 3,
  });
  const exactTicket = (
    await db.query("select get_sale_ticket_by_folio($1,$2) result", [
      locations[0],
      receipt.folio,
    ])
  ).rows[0].result;
  assert.deepEqual(
    exactTicket.items[0].measureUnit,
    receipt.items[0].measureUnit,
  );
  const history = (
    await db.query("select list_sale_tickets($1) result", [locations[0]])
  ).rows[0].result;
  assert.deepEqual(
    history.find((ticket) => ticket.id === delivered.sale_id).items[0]
      .measureUnit,
    receipt.items[0].measureUnit,
  );
  await db.query("reset role");
  const stock = (
    await db.query(
      "select qty,reserved_qty from inventory_by_location where variant_id=$1 and location_id=$2",
      [variant, locations[0]],
    )
  ).rows[0];
  assert.equal(Number(stock.qty), 3.75);
  assert.equal(Number(stock.reserved_qty), 0);
  const returned = (
    await db.query(
      "select sum(amount_cents) amount from return_payments where return_id=any($1::uuid[])",
      [[first.id, second.id, last.id]],
    )
  ).rows[0];
  assert.equal(Number(returned.amount), 15431);
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','app.sales_report_lines','SELECT') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  await login(db, admin);
  const inventoryReport = (
    await db.query("select get_inventory_report_v2($1) result", [locations[0]])
  ).rows[0].result;
  assert.equal(inventoryReport.summary.qty, null);
  assert.equal(
    Number(
      inventoryReport.summary.unit_quantities.find(
        (unit) => unit.code === "KILO",
      ).qty,
    ),
    3.75,
  );
  assert.equal(
    inventoryReport.items.find((item) => item.variant_id === variant)
      .measureUnit.code,
    "KILO",
  );
  const salesReport = (
    await db.query(
      "select get_sales_report_v2($1,now()-interval '1 day',now()+interval '1 day') result",
      [locations[0]],
    )
  ).rows[0].result;
  assert.equal(salesReport.summary.item_count, null);
  assert.equal(
    Number(
      salesReport.summary.unit_quantities.find((unit) => unit.code === "KILO")
        .quantity,
    ),
    2.5,
  );
  assert.equal(
    salesReport.periods[0].unit_quantities.some((unit) => unit.code === "KILO"),
    true,
  );
  assert.equal(
    salesReport.details.find((item) => item.sale_id === sale.id).measureUnit
      .code,
    "KILO",
  );
  // Measured credit still uses the same engine: money never enters cash until
  // an actual payment. A partial return cancels debt before refunding payments.
  await db.query(
    "select set_customer_credit($1,true,100000,'QA crédito fraccionario')",
    [customer],
  );
  const creditCash = await cash();
  const creditArgs = [
    crypto.randomUUID(),
    session,
    JSON.stringify([{ variant_id: variant, quantity: 0.5 }]),
    JSON.stringify([{ method_code: "CREDIT", amount_cents: 6173 }]),
    customer,
  ];
  const credit = (
    await db.query(
      "select (create_credit_sale($1,$2,$3::jsonb,$4::jsonb,$5,current_date+30)).*",
      creditArgs,
    )
  ).rows[0];
  assert.equal(Number(credit.total_cents), 6173);
  assert.equal(await cash(), creditCash);
  await db.query("select record_customer_credit_payment($1,$2,$3,$4::jsonb)", [
    crypto.randomUUID(),
    session,
    customer,
    JSON.stringify([
      { method_code: "CASH", amount_cents: 1000, tendered_cents: 1000 },
    ]),
  ]);
  assert.equal(await cash(), creditCash + 1000);
  const creditItems = (
    await db.query("select get_returnable_sale($1) result", [credit.id])
  ).rows[0].result.items;
  const creditBalance = async () => {
    await db.query("reset role");
    const amount = Number(
      (await db.query("select app.credit_balance($1) amount", [customer]))
        .rows[0].amount,
    );
    await login(db, admin);
    return amount;
  };
  assert.equal(await creditBalance(), 5173);
  for (const [expectedDebt, expectedCash] of [
    [2087, creditCash + 1000],
    [0, creditCash],
  ]) {
    const auth = await token();
    await db.query(returnSql, [
      crypto.randomUUID(),
      session,
      credit.id,
      JSON.stringify([
        {
          sale_item_id: creditItems[0].sale_item_id,
          quantity: 0.25,
          condition: "RESELLABLE",
        },
      ]),
      "[]",
      "[]",
      "[]",
      auth,
      "QA crédito fraccionario",
    ]);
    assert.equal(await creditBalance(), expectedDebt);
    assert.equal(await cash(), expectedCash);
  }
  await db.query("reset role");
}
