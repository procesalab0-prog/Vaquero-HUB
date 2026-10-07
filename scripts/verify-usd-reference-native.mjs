import assert from "node:assert/strict";

export async function verifyUsdReference(
  db,
  { login, admin, cashier, session, locations, a, b },
) {
  await login(db, admin);
  await assert.rejects(
    () => db.query("select get_usd_exchange_quote($1)", [session]),
    /FX_REFERENCE_UNAVAILABLE/,
  );
  await assert.rejects(
    () => db.query("select record_banxico_fix(current_date,20000000)"),
    /permission denied/,
  );
  await db.query("reset role");
  const today = (
    await db.query(
      "select ((clock_timestamp() at time zone 'America/Mexico_City')::date)::text as qa_date",
    )
  ).rows[0].qa_date;
  await db.query("set role service_role");
  const record = "select record_banxico_fix($1,20000000) id";
  const reference = (await db.query(record, [today])).rows[0].id;
  assert.equal((await db.query(record, [today])).rows[0].id, reference);
  await assert.rejects(
    () => db.query("select record_banxico_fix($1,21000000)", [today]),
    /BANXICO_REFERENCE_CONFLICT/,
  );
  await assert.rejects(
    () => db.query("select record_banxico_fix(($1::date+1),21000000)", [today]),
    /INVALID_BANXICO_REFERENCE/,
  );
  await assert.rejects(
    () => db.query("select * from fx_rate_observations"),
    /permission denied/,
  );
  await login(db, cashier);
  await assert.rejects(
    () =>
      db.query("select set_usd_exchange_adjustment($1,500000,'QA ajuste')", [
        locations[0],
      ]),
    /NOT_AUTHORIZED/,
  );
  await assert.rejects(
    () => db.query("select get_usd_exchange_quote($1)", [session]),
    /CASH_SESSION_FORBIDDEN/,
  );
  await login(db, admin);
  await db.query(
    "select set_usd_exchange_adjustment($1,500000,'QA ajuste autorizado')",
    [locations[0]],
  );
  const quote = (
    await db.query("select get_usd_exchange_quote($1) result", [session])
  ).rows[0].result;
  assert.equal(Number(quote.rate_million), 20500000);
  assert.equal(quote.refund_currency, "MXN");
  assert.equal(quote.refund_rate, "ORIGINAL_SALE");
  await db.query(
    "select set_usd_exchange_adjustment($1,0,'QA volver a referencia')",
    [locations[0]],
  );
  const next = (
    await db.query("select get_usd_exchange_quote($1) result", [session])
  ).rows[0].result;
  assert.equal(Number(next.rate_million), 20000000);
  await assert.rejects(
    () => db.query("select get_usd_exchange_quote($1)", [crypto.randomUUID()]),
    /CASH_SESSION_FORBIDDEN/,
  );
  await db.query("reset role");
  assert.equal(
    Number(
      (
        await db.query(
          "select rate_million from usd_exchange_quotes where id=$1",
          [quote.id],
        )
      ).rows[0].rate_million,
    ),
    20500000,
  );
  for (const table of [
    "fx_rate_observations",
    "fx_rate_adjustments",
    "usd_exchange_quotes",
  ]) {
    assert.equal(
      (
        await db.query(
          "select has_table_privilege('authenticated',$1,'SELECT') allowed",
          [table],
        )
      ).rows[0].allowed,
      false,
    );
    await assert.rejects(
      () => db.query(`delete from public.${table}`),
      /FX_DOCUMENT_IMMUTABLE/,
    );
  }
  assert.equal(
    (
      await db.query(
        "select count(*) n from payment_methods where code='USD' and is_active",
      )
    ).rows[0].n,
    0,
  );
  // Real parallel conflict: B must wait for A's uncommitted reference, then
  // reuse it. This is not two sequential RPC calls pretending to test a race.
  await a.query("set role service_role");
  await b.query("set role service_role");
  await a.query("begin");
  const concurrentSql = "select record_banxico_fix(($1::date-3),19900000) id";
  const first = (await a.query(concurrentSql, [today])).rows[0].id;
  let settled = false;
  const parallel = b.query(concurrentSql, [today]).finally(() => {
    settled = true;
  });
  let waiting = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = (
      await db.query(
        "select wait_event_type from pg_stat_activity where application_name='qa-weight-b'",
      )
    ).rows[0];
    if (state?.wait_event_type === "Lock") {
      waiting = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  try {
    assert.equal(waiting, true);
    assert.equal(settled, false);
  } finally {
    await a.query("commit");
  }
  assert.equal((await parallel).rows[0].id, first);
  await a.query("reset role");
  await b.query("reset role");
}
