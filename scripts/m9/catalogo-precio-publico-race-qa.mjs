// Committed local-only catalog history, never a remote or operating-cut writer.
import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { seedPriceFixtures } from "./catalogo-precio-publico-fixture.mjs";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/qa_m9_precios_block4_20261022"
)
  throw Error("DEDICATED_LOCAL_PRICE_QA_REQUIRED");
const p = JSON.parse(await readFile(process.argv[2], "utf8")),
  db = new pg.Client({ connectionString: target.href }),
  writer = new pg.Client({ connectionString: target.href }),
  binder = new pg.Client({ connectionString: target.href });
await Promise.all([db.connect(), writer.connect(), binder.connect()]);
const one = async (c, q, a = []) => (await c.query(q, a)).rows[0];
let cleanup;
try {
  const ddl = await readFile(
    new URL("./catalogo-precio-publico-apply.sql", import.meta.url),
    "utf8",
  );
  if (!(await one(db, "select to_regclass('app.m9_sicar_price_events')t")).t)
    await db.query(ddl);
  else
    for (const sql of ddl.matchAll(/create function app\.[\s\S]+?\$\$;/g))
      await db.query(
        sql[0].replace("create function", "create or replace function"),
      );
  await db.query("begin");
  const { actor, ids } = await seedPriceFixtures(db, p);
  await db.query("commit");
  cleanup = async () => {
    await db.query("begin");
    await db.query(
      "update public.variants set is_active=false where id=any($1::uuid[])",
      [ids],
    );
    await db.query(
      "update public.products set is_active=false where id=any($1::uuid[])",
      [p.expected_state.map((f) => f.product.id)],
    );
    await db.query("commit");
  };
  for (const c of [db, writer, binder]) {
    await c.query("set statement_timeout='15s'");
    await c.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
  }
  const bp = (await one(binder, "select pg_backend_pid()pid")).pid,
    wp = (await one(writer, "select pg_backend_pid()pid")).pid;
  const wait = async (w, h) => {
    for (let i = 0; i < 100; i++) {
      if ((await one(db, "select pg_blocking_pids($1)b", [w])).b.includes(h))
        return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("ROW_LOCK_NOT_OBSERVED");
  };
  const first = ids[0];
  await writer.query("begin");
  assert.equal(
    (
      await writer.query(
        "select id from public.variants where id=$1 for update",
        [first],
      )
    ).rowCount,
    1,
  );
  await binder.query("begin");
  const held = binder
    .query("select app.m9_apply_sicar_public_prices($1::jsonb)", [p])
    .then(
      (v) => ({ v }),
      (e) => ({ e }),
    );
  await wait(bp, wp);
  await writer.query(
    "update public.variants set price_cents=price_cents+1 where id=$1",
    [first],
  );
  await writer.query("commit");
  assert.match((await held).e?.message ?? "", /CONTEXT_CHANGED/);
  await binder.query("rollback");
  assert.equal(
    (await one(db, "select count(*)::int n from app.m9_sicar_price_events")).n,
    0,
  );
  await db.query("update public.variants set price_cents=98000 where id=$1", [
    first,
  ]);
  const fresh = structuredClone(p);
  fresh.request_id = randomUUID();
  fresh.expected_state = (
    await one(db, "select app.m9_sicar_price_state($1::uuid[])s", [ids])
  ).s;
  fresh.observed_at = new Date().toISOString();
  await binder.query("begin");
  assert.equal(
    (
      await one(binder, "select app.m9_apply_sicar_public_prices($1::jsonb)r", [
        fresh,
      ])
    ).r.changed,
    10,
  );
  await writer.query("begin");
  const waiting = writer
    .query("select id from public.variants where id=$1 for update", [first])
    .then(
      (v) => ({ v }),
      (e) => ({ e }),
    );
  await wait(wp, bp);
  await binder.query("commit");
  const locked = await waiting;
  if (locked.e) throw locked.e;
  assert.equal(locked.v.rowCount, 1);
  await writer.query(
    "update public.variants set price_cents=price_cents+1 where id=$1",
    [first],
  );
  await writer.query("commit");
  await assert.rejects(
    () =>
      db.query("select app.m9_reverse_sicar_public_prices($1,$2)", [
        randomUUID(),
        fresh.request_id,
      ]),
    /REVERSE_CONTEXT_CHANGED/,
  );
  assert.equal(
    (await one(db, "select count(*)::int n from app.m9_sicar_price_events")).n,
    1,
  );
  const current = (
    await one(db, "select app.m9_sicar_price_state($1::uuid[])s", [ids])
  ).s;
  for (let i = 0; i < current.length; i++) {
    assert.deepEqual(current[i].provisional, p.expected_state[i].provisional);
    assert.equal(
      current[i].managed.source_sha256,
      p.expected_state[i].managed.source_sha256,
    );
    assert.equal(current[i].provisional.web_release, false);
  }
  await cleanup();
  cleanup = null;
  const result = {
    protocol: "m9-sicar-public-price-race-qa-1",
    local_database: target.pathname.slice(1),
    local_only: true,
    writer_first: {
      exact_for_update_row: true,
      blocking_observed: true,
      update_committed: true,
      stale_packet_rejected: true,
      no_events_created: true,
    },
    price_first: {
      blocking_observed: true,
      writer_update_after_commit: true,
      compensation_of_manual_price_rejected: true,
    },
    deadlocks: 0,
    fixtures_deactivated: true,
    history_preserved: true,
    source_sha_and_provisional_unchanged: true,
    woo_stock_cost_finance_writes: 0,
    scope_note:
      "Local committed catalog QA history retained; no remote operations. A subsequent manual price is preserved and compensation is held.",
  };
  await writeFile(process.argv[3], JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} finally {
  await Promise.allSettled([
    db.query("rollback"),
    writer.query("rollback"),
    binder.query("rollback"),
  ]);
  if (cleanup) await cleanup().catch(() => {});
  await Promise.all([db.end(), writer.end(), binder.end()]);
}
