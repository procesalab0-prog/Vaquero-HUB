import { seedPriceFixtures } from "./catalogo-precio-publico-fixture.mjs";
import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/qa_m9_precios_block4_20261022"
)
  throw Error("DEDICATED_LOCAL_PRICE_QA_REQUIRED");
if (process.argv.length !== 4) throw Error("USAGE: PAYLOAD NEW_RESULT");
const payload = JSON.parse(await readFile(process.argv[2], "utf8"));
const db = new pg.Client({ connectionString: target.href }),
  other = new pg.Client({ connectionString: target.href });
await db.connect();
await other.connect();
let checks = 0,
  waiting;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
try {
  const tables = (
    await db.query(
      "select schemaname||'.'||tablename name from pg_tables where schemaname in('app','public')order by 1",
    )
  ).rows.map((r) => r.name);
  const hashSQL =
    "select jsonb_object_agg(name,jsonb_build_object('rows',n,'hash',hash))h from(" +
    tables
      .map(
        (t) =>
          `select '${t}' name,count(*)n,md5(coalesce(string_agg(j,'|'order by j),''))hash from(select to_jsonb(t)::text j from ${t} t)x`,
      )
      .join(" union all ") +
    ")x";
  const hashes = async () => (await one(hashSQL)).h,
    before = await hashes();
  await db.query(
    "begin;set local statement_timeout='30s';set local lock_timeout='5s';set local timezone='UTC'",
  );
  await db.query(
    await readFile(
      new URL("./catalogo-precio-publico-apply.sql", import.meta.url),
      "utf8",
    ),
  );
  const { ids } = await seedPriceFixtures(db, payload);
  const call = async (p) =>
    (await one("select app.m9_apply_sicar_public_prices($1::jsonb)r", [p])).r;
  assert.deepEqual(
    (await one("select app.m9_sicar_price_state($1::uuid[])s", [ids])).s,
    payload.expected_state,
  );
  const initial = await hashes(),
    p = structuredClone(payload);
  async function reject(mutate, expected, edit) {
    await db.query("savepoint bad_price");
    const x = structuredClone(p);
    mutate?.(x);
    if (edit) await edit(x);
    let error;
    try {
      await call(x);
    } catch (e) {
      error = e;
    }
    await db.query("rollback to savepoint bad_price");
    if (error && !expected.test(error.message))
      console.error(error.where ?? error.detail ?? error.message);
    assert.match(error?.message ?? "", expected);
    assert.deepEqual(await hashes(), initial);
    checks++;
  }
  await reject((x) => (x.project_id = "drubkjlmfbdeglucakmg"), /EXACT_PACKET/);
  await reject((x) => (x.source_after_sha256 = "a".repeat(64)), /EXACT_PACKET/);
  await reject((x) => x.changes.pop(), /EXACT_PACKET/);
  await reject((x) => (x.changes[0].barcode = "11425 "), /FIXED_TEN/);
  await reject((x) => (x.changes[0].new_cents = 115001), /IDENTITY_OR_WEB/);
  await reject((x) => (x.source_rows_json += " "), /EXACT_PACKET/);
  await reject(
    (x) => (x.observed_at = "2000-01-01T00:00:00Z"),
    /CONTEXT_EXPIRED/,
  );
  await reject(
    (x) => (x.expected_state[0].variant.cost_cents = 0),
    /CONTEXT_CHANGED/,
  );
  await reject(null, /CONTEXT_CHANGED/, async () => {
    await db.query(
      "update public.variants set price_cents=price_cents+1 where id=$1",
      [ids[0]],
    );
  });
  await reject(null, /CONTEXT_CHANGED/, async () => {
    await db.query(
      "update public.m9_variant_details set source_description=source_description||' CHANGED'where variant_id=$1",
      [ids[0]],
    );
  });
  await reject(null, /CONTEXT_CHANGED/, async () => {
    await db.query(
      "update app.m9_provisional_variants set web_release=true where variant_id=$1",
      [ids[0]],
    );
  });
  await reject(null, /CONTEXT_CHANGED/, async () => {
    await db.query(
      "update app.m9_rows set source_sha256=repeat('a',64)where variant_id=$1",
      [ids[0]],
    );
  });
  await db.query(
    "create function pg_temp.price_fail_receipt()returns trigger language plpgsql as $$begin raise exception 'PRICE_FAIL_AFTER_UPDATES';end$$;create trigger price_fail_receipt before insert on app.m9_sicar_price_events for each row execute function pg_temp.price_fail_receipt()",
  );
  await reject(null, /PRICE_FAIL_AFTER_UPDATES/);
  await db.query(
    "drop trigger price_fail_receipt on app.m9_sicar_price_events",
  );
  const first = await call(p);
  assert.equal(first.changed, 10);
  checks++;
  const after = await hashes();
  for (const t of tables.filter(
    (t) => !["public.variants", "app.m9_rows", "public.audit_log"].includes(t),
  ))
    assert.deepEqual(after[t], initial[t], t);
  checks++;
  assert.equal((await call(p)).replayed, true);
  assert.deepEqual(await hashes(), after);
  checks++;
  await db.query("savepoint bad_replay");
  await db.query(
    "update public.variants set price_cents=price_cents+1 where id=$1",
    [ids[0]],
  );
  await assert.rejects(() => call(p), /REPLAY_CHANGED/);
  await db.query("rollback to savepoint bad_replay");
  checks++;
  const reverse = "f1000000-0000-4000-8000-000000000001";
  await db.query("savepoint bad_reverse");
  await db.query(
    "update public.products set description='manual description change'where id=$1",
    [p.expected_state[0].product.id],
  );
  await assert.rejects(
    () =>
      db.query("select app.m9_reverse_sicar_public_prices($1,$2)", [
        reverse,
        p.request_id,
      ]),
    /REVERSE_CONTEXT_CHANGED/,
  );
  await db.query("rollback to savepoint bad_reverse");
  checks++;
  for (const role of ["anon", "authenticated", "service_role"]) {
    const acl = await one(
      "select has_function_privilege($1,'app.m9_apply_sicar_public_prices(jsonb)','EXECUTE')a,has_function_privilege($1,'app.m9_reverse_sicar_public_prices(uuid,uuid)','EXECUTE')r,has_table_privilege($1,'app.m9_sicar_price_events','SELECT')t",
      [role],
    );
    assert.deepEqual(acl, { a: false, r: false, t: false });
    checks++;
  }
  await other.query("set statement_timeout='10s';set lock_timeout='8s'");
  const opid = (await other.query("select pg_backend_pid()pid")).rows[0].pid;
  waiting = other.query(
    "select id from public.variants where id=$1 for update",
    [ids[0]],
  );
  let observed = false;
  for (let i = 0; i < 100; i++) {
    if ((await one("select pg_blocking_pids($1)b", [opid])).b.length) {
      observed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(observed, true);
  checks++;
  assert.equal(
    (
      await one("select app.m9_reverse_sicar_public_prices($1,$2)r", [
        reverse,
        p.request_id,
      ])
    ).r.restored_prices,
    10,
  );
  checks++;
  assert.equal(
    (
      await one("select app.m9_reverse_sicar_public_prices($1,$2)r", [
        reverse,
        p.request_id,
      ])
    ).r.replayed,
    true,
  );
  checks++;
  await assert.rejects(() => call(p), /REPLAY_CHANGED/);
  await db.query("rollback");
  await waiting;
  assert.deepEqual(await hashes(), before);
  const result = {
    protocol: "m9-sicar-public-price-local-qa-1",
    local_database: target.pathname.slice(1),
    checks,
    prices_updated: 10,
    compensated: 10,
    other_changes_held: 11,
    replay_pass: true,
    manual_edit_reversal_rejected: true,
    rollback_tables: tables.length,
    rollback_exact: true,
    competing_for_update_observed: true,
    raw_provisional_source_unchanged: true,
    web_release: false,
    remote_writes: 0,
    woo_writes: 0,
    stock_cost_finance_writes: 0,
  };
  await writeFile(process.argv[3], JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} catch (e) {
  await db.query("rollback");
  if (waiting) await waiting.catch(() => {});
  throw e;
} finally {
  await db.end();
  await other.end();
}
