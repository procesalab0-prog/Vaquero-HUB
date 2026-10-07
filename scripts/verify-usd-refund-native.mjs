import assert from "node:assert/strict";

export async function verifyUsdRefund(
  db,
  { login, admin, locations, variant },
) {
  await login(db, admin);
  const register = (
    await db.query(
      "select (create_cash_register($1,'QAUSD','QA USD refund')).id",
      [locations[0]],
    )
  ).rows[0].id;
  const session = (
    await db.query("select (open_cash_session($1,20000)).id", [register])
  ).rows[0].id;
  await db.query("reset role");
  await db.query("update app.usd_checkout_gate set enabled=true");
  await db.query("update payment_methods set is_active=true where code='USD'");
  const cash = async () =>
    Number(
      (
        await db.query(
          "select coalesce(sum(amount_cents),0) n from cash_movements where session_id=$1",
          [session],
        )
      ).rows[0].n,
    );
  const token = async () => {
    await db.query("reset role");
    const id = (
      await db.query(
        "insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at) values($1,$1,'returns.authorize',now()+interval '5 minutes') returning id",
        [admin],
      )
    ).rows[0].id;
    await login(db, admin);
    return id;
  };
  try {
    await login(db, admin);
    const quote = (
      await db.query("select get_usd_exchange_quote($1) result", [session])
    ).rows[0].result;
    const params = [
      crypto.randomUUID(),
      session,
      JSON.stringify([{ variant_id: variant, quantity: 2 }]),
      quote.id,
      1000,
      20000,
    ];
    const sale = (
      await db.query(
        "select (create_usd_sale($1,$2,$3::jsonb,$4,$5,$6)).id",
        params,
      )
    ).rows[0];
    const original = (
      await db.query("select get_returnable_sale($1) result", [sale.id])
    ).rows[0].result;
    const usd = (
      await db.query("select get_sale_usd_tender($1) result", [sale.id])
    ).rows[0].result;
    assert.equal(Number(usd.rate_million), 20000000);
    await db.query(
      "select set_usd_exchange_adjustment($1,1000000,'QA tasa nueva no altera devolución')",
      [locations[0]],
    );
    const returnSql =
      "select create_return_exchange($1,$2,$3,$4::jsonb,'[]','[]','[]',$5,$6) result";
    const item = JSON.stringify([
      {
        sale_item_id: original.items[0].sale_item_id,
        quantity: 1,
        condition: "RESELLABLE",
      },
    ]);
    await assert.rejects(
      () =>
        db.query(returnSql, [
          crypto.randomUUID(),
          session,
          sale.id,
          item,
          null,
          "QA sin autorización",
        ]),
      /AUTHORIZATION/,
    );
    const firstAuth = await token();
    const firstArgs = [
      crypto.randomUUID(),
      session,
      sale.id,
      item,
      firstAuth,
      "QA devolución USD en pesos",
    ];
    await db.query(
      "select record_cash_movement($1,'WITHDRAWAL',15000,'QA insuficiente para reembolso USD')",
      [session],
    );
    await assert.rejects(
      () => db.query(returnSql, firstArgs),
      /INSUFFICIENT_CASH/,
    );
    await db.query(
      "select record_cash_movement($1,'DEPOSIT',15000,'QA restituir efectivo USD')",
      [session],
    );
    const first = (await db.query(returnSql, firstArgs)).rows[0].result;
    assert.equal(Number(first.returned_cents), 10000);
    assert.equal(
      (await db.query(returnSql, firstArgs)).rows[0].result.id,
      first.id,
    );
    await db.query("reset role");
    assert.equal(await cash(), 10000);
    await login(db, admin);
    await assert.rejects(
      () =>
        db.query(returnSql, [
          crypto.randomUUID(),
          session,
          sale.id,
          item,
          firstAuth,
          "QA token usado",
        ]),
      /AUTHORIZATION/,
    );
    const second = (
      await db.query(returnSql, [
        crypto.randomUUID(),
        session,
        sale.id,
        item,
        await token(),
        "QA segunda devolución USD",
      ])
    ).rows[0].result;
    assert.equal(Number(second.returned_cents), 10000);
    await db.query("reset role");
    assert.equal(await cash(), 0);
    assert.equal(
      Number(
        (
          await db.query(
            "select sum(amount_usd_cents) n from usd_cash_movements where session_id=$1",
            [session],
          )
        ).rows[0].n,
      ),
      1000,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select sum(amount_cents) n from cash_movements where session_id=$1 and reference_type='USD_RETURN_PAYMENT'",
            [session],
          )
        ).rows[0].n,
      ),
      -20000,
    );
    await login(db, admin);
    await assert.rejects(
      async () =>
        db.query(returnSql, [
          crypto.randomUUID(),
          session,
          sale.id,
          item,
          await token(),
          "QA tercera pieza",
        ]),
      /RETURN_EXCEEDS_SOLD/,
    );
    await db.query(
      "select record_cash_movement($1,'DEPOSIT',30000,'QA efectivo para cancelación USD')",
      [session],
    );
    const nextQuote = (
      await db.query("select get_usd_exchange_quote($1) result", [session])
    ).rows[0].result;
    const cancelled = (
      await db.query(
        "select (create_usd_sale($1,$2,$3::jsonb,$4,500,10000)).id",
        [
          crypto.randomUUID(),
          session,
          JSON.stringify([{ variant_id: variant, quantity: 1 }]),
          nextQuote.id,
        ],
      )
    ).rows[0].id;
    await db.query(
      "select cancel_sale($1,'QA cancelar USD y devolver pesos')",
      [cancelled],
    );
    await db.query("reset role");
    assert.equal(await cash(), 19500);
    assert.equal(
      Number(
        (
          await db.query(
            "select amount_cents from cash_movements where reference_type='USD_CANCELLATION' and reference_id=$1",
            [cancelled],
          )
        ).rows[0].amount_cents,
      ),
      -10000,
    );
    await login(db, admin);
    await assert.rejects(
      () =>
        db.query("select cancel_sale($1,'QA repetir cancelación')", [
          cancelled,
        ]),
      /SALE_NOT_CANCELLABLE/,
    );
    const preview =
      // Foreign cash stays in the drawer after every sale is returned/cancelled.
      (
        await db.query(
          "select preview_cash_close_with_usd($1,19500,1400) result",
          [session],
        )
      ).rows[0].result;
    assert.equal(preview.usd.difference_cents, -100);
    assert.equal(
      (await db.query("select get_my_cash_session() result")).rows[0].result
        .has_usd,
      true,
    );
    await assert.rejects(
      () =>
        db.query("select close_cash_session_with_usd($1,19500,1400,null)", [
          session,
        ]),
      /DIFFERENCE_REASON_REQUIRED/,
    );
    const closed = (
      await db.query(
        "select close_cash_session_with_usd($1,19500,1500,null) result",
        [session],
      )
    ).rows[0].result;
    assert.equal(closed.usd.difference_cents, 0);
    assert.equal(closed.difference_cents, 0);
  } finally {
    await db.query("reset role");
    await db.query("update app.usd_checkout_gate set enabled=false");
    await db.query(
      "update payment_methods set is_active=false where code='USD'",
    );
  }
}
