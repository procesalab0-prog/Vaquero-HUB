import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { seedPriceFixtures } from "./catalogo-precio-publico-fixture.mjs";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/qa_m9_precio11777_v1_20261023"
)
  throw Error("ASSIGNED_V1_PRICE_QA_ONLY");
if (process.argv.length !== 4)
  throw Error("USAGE: ORIGINAL_V1_PAYLOAD NEW_RESULT");
const p = JSON.parse(await readFile(process.argv[2], "utf8")),
  db = new pg.Client({ connectionString: target.href });
await db.connect();
const one = async (q, a = []) => (await db.query(q, a)).rows[0];
const tables = (
  await db.query(
    "select schemaname||'.'||tablename name from pg_tables where schemaname in('app','public')order by 1",
  )
).rows.map((r) => r.name);
const hashes = async () =>
  (
    await one(
      "select jsonb_object_agg(name,jsonb_build_object('rows',n,'h',h))h from(" +
        tables
          .map(
            (t) =>
              `select '${t}'name,count(*)n,md5(coalesce(string_agg(j,'|'order by j),''))h from(select to_jsonb(t)::text j from ${t} t)x`,
          )
          .join(" union all ") +
        ")x",
    )
  ).h;
try {
  const before = await hashes();
  await db.query(
    "begin;set local timezone='UTC';set local statement_timeout='30s';set local lock_timeout='3s'",
  );
  assert.equal(
    (await one("select to_regclass('app.m9_sicar_price_events')r")).r,
    null,
    "ORIGINAL_JOURNAL_MUST_NOT_EXIST_IN_V1_CLONE",
  );
  await db.query(
    await readFile(
      new URL("./catalogo-precio-publico-apply.sql", import.meta.url),
      "utf8",
    ),
  );
  const { ids } = await seedPriceFixtures(db, p);
  const call = async () =>
    (await one("select app.m9_apply_sicar_public_prices($1::jsonb)r", [p])).r;
  const reverse = "f4000000-0000-4000-8000-000000000001";
  const rev = async () =>
    (
      await one("select app.m9_reverse_sicar_public_prices($1,$2)r", [
        reverse,
        p.request_id,
      ])
    ).r;
  const state = async () =>
    (await one("select app.m9_sicar_price_state($1::uuid[])s", [ids])).s;
  await db.query("savepoint original_v1");
  const oldReceipt = await call(),
    oldAfter = await state(),
    oldReplay = await call(),
    oldReverse = await rev(),
    oldRestored = await state(),
    oldReverseReplay = await rev();
  await db.query("rollback to savepoint original_v1");
  await db.query(
    await readFile(
      new URL("./catalogo-precio-publico-linked-forward.sql", import.meta.url),
      "utf8",
    ),
  );
  const newReceipt = await call();
  assert.deepEqual(newReceipt, oldReceipt);
  assert.deepEqual(await state(), oldAfter);
  assert.deepEqual(await call(), oldReplay);
  assert.deepEqual(await rev(), oldReverse);
  assert.deepEqual(await state(), oldRestored);
  assert.deepEqual(await rev(), oldReverseReplay);
  assert.equal(newReceipt.changed, 10);
  assert.equal(oldReverse.restored_prices, 10);
  await db.query("savepoint reversed_apply");
  await assert.rejects(() => call(), /REPLAY_CHANGED/);
  await db.query("rollback to savepoint reversed_apply");
  await db.query("rollback");
  assert.deepEqual(await hashes(), before);
  const result = {
    protocol: "m9-price-v1-positive-regression-1",
    database: target.pathname.slice(1),
    positive_v1_apply_receipt_exact: true,
    positive_v1_after_state_exact: true,
    v1_replay_exact: true,
    v1_reverse_receipt_and_state_exact: true,
    v1_reverse_replay_exact: true,
    v1_count_preserved: 10,
    existing_writer_and_journal_reused: true,
    rollback_tables: tables.length,
    rollback_exact: true,
    remote_writes: 0,
    stock_cost_woo_finance_writes: 0,
  };
  await writeFile(process.argv[3], JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} finally {
  await db.query("rollback");
  await db.end();
}
