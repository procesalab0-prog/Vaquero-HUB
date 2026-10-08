import assert from "node:assert/strict";

export async function verifyUsdClose(
  db,
  { login, admin, cashier, session, a, b },
) {
  const sql = "select app.close_cash_session_with_usd($1,$2,$3,$4) result";
  await login(db, admin);
  await db.query("reset role");
  const expected = Number(
    (
      await db.query(
        "select sum(amount_usd_cents) n from usd_cash_movements where session_id=$1",
        [session],
      )
    ).rows[0].n,
  );
  assert.ok(expected > 100);
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','app.close_cash_session_with_usd(uuid,bigint,bigint,text)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal(
      (
        await db.query(
          "select has_table_privilege($1,'public.usd_cash_closes','SELECT,INSERT,UPDATE,DELETE') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  }
  for (const count of [null, -1, 100000001]) {
    await assert.rejects(
      () => db.query(sql, [session, 0, count, null]),
      /INVALID_COUNTED_AMOUNT/,
    );
  }
  await assert.rejects(
    () => db.query(sql, [session, 0, expected - 100, null]),
    /DIFFERENCE_REASON_REQUIRED/,
  );
  // A failure in the original MXN closer rolls back the USD document as well.
  await assert.rejects(
    () => db.query(sql, [session, 100, expected, null]),
    /DIFFERENCE_REASON_REQUIRED/,
  );
  assert.equal(
    (
      await db.query(
        "select count(*) n from usd_cash_closes where session_id=$1",
        [session],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("select status from cash_sessions where id=$1", [session]))
      .rows[0].status,
    "OPEN",
  );
  await login(db, cashier);
  await db.query("reset role");
  await assert.rejects(
    () => db.query(sql, [session, 0, expected, null]),
    /SESSION_FORBIDDEN/,
  );
  await login(db, admin);
  await db.query("reset role");
  // Even the isolated QA owner cannot persist a close document for an OPEN
  // session to unlock a legacy close in a subsequent transaction.
  await assert.rejects(
    () =>
      db.query(
        "insert into usd_cash_closes(session_id,counted_usd_cents,expected_usd_cents,difference_usd_cents,actor_user_id) values($1,$2,$2,0,$3)",
        [session, expected, admin],
      ),
    /USD_CLOSE_MISMATCH/,
  );
  assert.equal(
    (
      await db.query(
        "select count(*) n from usd_cash_closes where session_id=$1",
        [session],
      )
    ).rows[0].n,
    0,
  );
  await login(a, admin);
  await a.query("reset role");
  await login(b, admin);
  await b.query("reset role");
  await a.query("begin");
  const args = [
    session,
    0,
    expected - 100,
    "QA USD faltante físico de un dólar",
  ];
  const result = (await a.query(sql, args)).rows[0].result;
  assert.deepEqual(result.usd, {
    currency: "USD",
    expected_cents: expected,
    counted_cents: expected - 100,
    difference_cents: -100,
  });
  assert.equal(Number(result.difference_cents), 0);
  let settled = false;
  const pending = b
    .query(sql, args)
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
      "parallel closer must wait, not use an old balance",
    );
    await a.query("commit");
    const second = await pending;
    assert.equal(second.ok, false);
    assert.match(second.error.message, /SESSION_FORBIDDEN/);
  } finally {
    await a.query("rollback");
    await pending;
  }
  const close = (
    await db.query("select * from usd_cash_closes where session_id=$1", [
      session,
    ])
  ).rows[0];
  assert.equal(Number(close.difference_usd_cents), -100);
  const tender = (
    await db.query(
      "select id,received_usd_cents from usd_sale_tenders where cash_session_id=$1 limit 1",
      [session],
    )
  ).rows[0];
  await assert.rejects(
    () =>
      db.query(
        "insert into usd_cash_movements(tender_id,session_id,amount_usd_cents,user_id) values($1,$2,$3,$4)",
        [tender.id, session, tender.received_usd_cents, admin],
      ),
    /SESSION_FORBIDDEN/,
  );
  assert.equal(close.actor_user_id, admin);
  assert.equal(
    (await db.query("select status from cash_sessions where id=$1", [session]))
      .rows[0].status,
    "CLOSED",
  );
  await assert.rejects(
    () =>
      db.query("delete from usd_cash_closes where session_id=$1", [session]),
    /FX_DOCUMENT_IMMUTABLE/,
  );
  await assert.rejects(
    () =>
      db.query(
        "update usd_cash_closes set counted_usd_cents=expected_usd_cents where session_id=$1",
        [session],
      ),
    /FX_DOCUMENT_IMMUTABLE/,
  );
  await assert.rejects(
    () => db.query(sql, [session, 0, expected, null]),
    /SESSION_FORBIDDEN/,
  );
}
