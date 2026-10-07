import assert from "node:assert/strict";

/** Owner-only engine, enabled only in this disposable QA database. */
export async function verifyUsdCheckout(
  db,
  { login, admin, session, locations, variant, a, b },
) {
  const sql =
    "select (app.create_usd_sale($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb)).*";
  await login(db, admin);
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','app.create_usd_sale(uuid,uuid,jsonb,uuid,bigint,bigint,jsonb,uuid,jsonb,text)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  await db.query("reset role");
  const items = JSON.stringify([{ variant_id: variant, quantity: 1 }]);
  await assert.rejects(
    () =>
      db.query(sql, [
        crypto.randomUUID(),
        session,
        items,
        crypto.randomUUID(),
        500,
        10000,
        "[]",
      ]),
    /USD_CHECKOUT_NOT_ENABLED/,
  );
  await db.query("update app.usd_checkout_gate set enabled=true");
  await db.query("update payment_methods set is_active=true where code='USD'");
  try {
    await login(db, admin);
    await db.query("select update_catalog_variant_price($1,10000)", [variant]);
    const currentStock = Number(
      (
        await db.query(
          "select qty from inventory_by_location where variant_id=$1 and location_id=$2",
          [variant, locations[0]],
        )
      ).rows[0]?.qty ?? 0,
    );
    await db.query(
      "select apply_inventory_adjustment($1,$2,$3,10,'CONTEO_FISICO','QA USD aislado')",
      [variant, locations[0], currentStock],
    );
    const quote = async () =>
      (await db.query("select get_usd_exchange_quote($1) result", [session]))
        .rows[0].result.id;
    const firstQuote = await quote();
    // Owner executes private engine but auth.uid still names the real actor.
    await db.query("reset role");
    const cash = async () =>
      Number(
        (
          await db.query(
            "select coalesce(sum(amount_cents),0) n from cash_movements where session_id=$1",
            [session],
          )
        ).rows[0].n,
      );
    const before = await cash();
    const request = [
      crypto.randomUUID(),
      session,
      items,
      firstQuote,
      550,
      10000,
      "[]",
    ];
    const sale = (await db.query(sql, request)).rows[0];
    assert.equal(Number(sale.total_cents), 10000);
    assert.equal(await cash(), before - 1000);
    const tender = (
      await db.query("select * from usd_sale_tenders where sale_id=$1", [
        sale.id,
      ])
    ).rows[0];
    assert.equal(Number(tender.received_usd_cents), 550);
    assert.equal(Number(tender.equivalent_mxn_cents), 11000);
    assert.equal(tender.refund_currency, "MXN");
    assert.equal(tender.refund_rate, "ORIGINAL_SALE");
    assert.equal(
      Number(
        (
          await db.query(
            "select sum(amount_usd_cents) n from usd_cash_movements where session_id=$1",
            [session],
          )
        ).rows[0].n,
      ),
      550,
    );
    assert.equal((await db.query(sql, request)).rows[0].id, sale.id);
    assert.equal(await cash(), before - 1000);
    await assert.rejects(
      () =>
        db.query(
          sql,
          request.map((value, index) => (index === 4 ? 600 : value)),
        ),
      /IDEMPOTENCY_CONFLICT/,
    );
    await assert.rejects(
      () =>
        db.query(
          sql,
          request.map((value, index) =>
            index === 0 ? crypto.randomUUID() : value,
          ),
        ),
      /FX_QUOTE_ALREADY_USED/,
    );
    await assert.rejects(
      () =>
        db.query(
          "update usd_sale_tenders set rate_million=21000000 where id=$1",
          [tender.id],
        ),
      /FX_DOCUMENT_IMMUTABLE/,
    );
    await assert.rejects(
      () =>
        db.query("delete from usd_cash_movements where tender_id=$1", [
          tender.id,
        ]),
      /FX_DOCUMENT_IMMUTABLE/,
    );
    // Normal engine cannot manufacture a USD payment without its physical book.
    await login(db, admin);
    await assert.rejects(
      () =>
        db.query("select (create_sale($1,$2,$3::jsonb,$4::jsonb)).id", [
          crypto.randomUUID(),
          session,
          items,
          JSON.stringify([{ method_code: "USD", amount_cents: 10000 }]),
        ]),
      /USD_TENDER_REQUIRED/,
    );
    await assert.rejects(
      () =>
        db.query("select close_cash_session($1,0,'QA USD no cierre legacy')", [
          session,
        ]),
      /USD_COUNT_REQUIRED/,
    );
    const secondQuote = await quote();
    await db.query("reset role");
    for (const table of ["usd_sale_tenders", "usd_cash_movements"]) {
      assert.equal(
        (
          await db.query(
            "select relrowsecurity rls from pg_class where oid=$1::regclass",
            [`public.${table}`],
          )
        ).rows[0].rls,
        true,
      );
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(
          (
            await db.query(
              "select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",
              [role, `public.${table}`],
            )
          ).rows[0].allowed,
          false,
        );
      }
    }
    const expiredQuote = (
      await db.query(
        "insert into usd_exchange_quotes(actor_user_id,cash_session_id,location_id,reference_id,rate_million,expires_at) select actor_user_id,cash_session_id,location_id,reference_id,rate_million,clock_timestamp()-interval '1 minute' from usd_exchange_quotes where id=$1 returning id",
        [secondQuote],
      )
    ).rows[0].id;
    await assert.rejects(
      () =>
        db.query(sql, [
          crypto.randomUUID(),
          session,
          items,
          expiredQuote,
          500,
          10000,
          "[]",
        ]),
      /FX_QUOTE_EXPIRED/,
    );
    await assert.rejects(
      () =>
        db.query(sql, [
          crypto.randomUUID(),
          session,
          items,
          crypto.randomUUID(),
          500,
          10000,
          "[]",
        ]),
      /FX_QUOTE_FORBIDDEN/,
    );
    const baselineStock = Number(
      (
        await db.query(
          "select qty from inventory_by_location where variant_id=$1 and location_id=$2",
          [variant, locations[0]],
        )
      ).rows[0].qty,
    );
    await assert.rejects(
      () =>
        db.query(sql, [
          crypto.randomUUID(),
          session,
          items,
          secondQuote,
          500,
          10000,
          JSON.stringify([{ method_code: "CUSTOMER_CREDIT", amount_cents: 1 }]),
        ]),
      /INVALID_USD_PAYMENT/,
    );
    await assert.rejects(
      () =>
        db.query(sql, [
          crypto.randomUUID(),
          session,
          items,
          secondQuote,
          100,
          10000,
          "[]",
        ]),
      /INSUFFICIENT_USD_TENDERED/,
    );
    await assert.rejects(
      () =>
        db.query(sql, [
          crypto.randomUUID(),
          session,
          items,
          secondQuote,
          1000000,
          10000,
          "[]",
        ]),
      /INSUFFICIENT_CASH/,
    );
    await assert.rejects(
      () =>
        db.query(sql, [
          crypto.randomUUID(),
          session,
          items,
          secondQuote,
          500,
          9000,
          "[]",
        ]),
      /PAYMENT_TOTAL_MISMATCH/,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select qty from inventory_by_location where variant_id=$1 and location_id=$2",
            [variant, locations[0]],
          )
        ).rows[0].qty,
      ),
      baselineStock,
    );
    assert.equal(
      (
        await db.query(
          "select count(*) n from usd_sale_tenders where quote_id=$1",
          [secondQuote],
        )
      ).rows[0].n,
      0,
    );
    // Mixed USD/card: physical dollars go only to USD; card adds no MXN cash.
    const mixed = (
      await db.query(sql, [
        crypto.randomUUID(),
        session,
        items,
        secondQuote,
        250,
        5000,
        JSON.stringify([
          { method_code: "CARD", amount_cents: 5000, reference: "QA tarjeta" },
        ]),
      ])
    ).rows[0];
    assert.equal(Number(mixed.total_cents), 10000);
    assert.equal(await cash(), before - 1000);
    // REAL parallel race: enough MXN change for exactly one of two sales.
    await login(db, admin);
    const parallelQuotes = [await quote(), await quote()];
    await db.query("reset role");
    const available = await cash();
    assert.ok(available >= 1000);
    await login(db, admin);
    if (available > 1000)
      await db.query(
        "select record_cash_movement($1,'WITHDRAWAL',$2,'QA USD efectivo para un cambio')",
        [session, available - 1000],
      );
    // Observe PostgreSQL lock diagnostics as the isolated QA owner. The
    // authenticated role cannot see wait events of owner-only test sessions.
    await db.query("reset role");
    await login(a, admin);
    await a.query("reset role");
    await login(b, admin);
    await b.query("reset role");
    await a.query("begin");
    await a.query(sql, [
      crypto.randomUUID(),
      session,
      items,
      parallelQuotes[0],
      550,
      10000,
      "[]",
    ]);
    let settled = false;
    const pending = b
      .query(sql, [
        crypto.randomUUID(),
        session,
        items,
        parallelQuotes[1],
        550,
        10000,
        "[]",
      ])
      .then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      )
      .finally(() => {
        settled = true;
      });
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        waiting = (
          await db.query(
            "select exists(select 1 from pg_stat_activity where application_name='qa-weight-b' and wait_event_type='Lock') yes",
          )
        ).rows[0].yes;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(
        waiting && !settled,
        "second USD checkout must wait for the cash-session lock",
      );
      await a.query("commit");
      const result = await pending;
      assert.equal(result.ok, false);
      assert.match(result.error.message, /INSUFFICIENT_CASH/);
      await db.query("reset role");
      assert.equal(await cash(), 0);
      assert.equal(
        Number(
          (
            await db.query(
              "select count(*) n from usd_sale_tenders where quote_id=any($1::uuid[])",
              [parallelQuotes],
            )
          ).rows[0].n,
        ),
        1,
      );
    } finally {
      await a.query("rollback");
      await pending;
    }
  } finally {
    await db.query("reset role");
    await db.query("update app.usd_checkout_gate set enabled=false");
    await db.query(
      "update payment_methods set is_active=false where code='USD'",
    );
  }
}
