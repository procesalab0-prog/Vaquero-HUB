// Actual committed fixtures, bounded to the assigned local clone; retain QA history.
import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { seedPriceFixtures } from "./catalogo-precio-publico-fixture.mjs";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/qa_m9_retenidos_block5_20261022"
)
  throw Error("DEDICATED_LOCAL_DESCRIPTION_QA_REQUIRED");
if (process.argv.length !== 4) throw Error("USAGE: PAYLOAD NEW_RESULT");
const p = JSON.parse(await readFile(process.argv[2], "utf8")),
  db = new pg.Client({ connectionString: target.href }),
  writer = new pg.Client({ connectionString: target.href }),
  binder = new pg.Client({ connectionString: target.href });
await Promise.all([db.connect(), writer.connect(), binder.connect()]);
const one = async (c, q, a = []) => (await c.query(q, a)).rows[0];
let cleanup;
try {
  if (
    !(
      await one(
        db,
        "select to_regprocedure('app.m9_sicar_price_state(uuid[])')r",
      )
    ).r
  ) {
    const text = await readFile(
      new URL("./catalogo-precio-publico-apply.sql", import.meta.url),
      "utf8",
    );
    await db.query(
      text.match(
        /create function app\.m9_sicar_price_state\(ids uuid\[\]\)[\s\S]+?\$\$;/,
      )[0] +
        "revoke all on function app.m9_sicar_price_state(uuid[])from public,anon,authenticated,service_role",
    );
  }
  assert.equal(
    (await one(db, "select to_regclass('app.m9_sicar_description_events')r")).r,
    null,
    "RACE_QA_MUST_USE_FRESH_FIXTURES",
  );
  await db.query(
    await readFile(
      new URL("./catalogo-descripciones-siete-apply.sql", import.meta.url),
      "utf8",
    ),
  );
  const financeTables = [
    "public.inventory_by_location",
    "public.inventory_movements",
    "public.cash_movements",
    "public.sales",
    "public.customer_credit_ledger",
    "app.m9_legacy_finance_ledger",
  ];
  const financial = async () =>
    (
      await one(
        db,
        "select jsonb_object_agg(name,h)h from(" +
          financeTables
            .map(
              (t) =>
                `select '${t}' name,md5(coalesce(string_agg(j,'|'order by j),''))h from(select to_jsonb(t)::text j from ${t} t)x`,
            )
            .join(" union all ") +
          ")x",
      )
    ).h;
  const financialBefore = await financial();
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
    await c.query("set statement_timeout='15s';set lock_timeout='8s'");
    await c.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
  }
  await binder.query(
    "create function pg_temp.catch_description_busy(p jsonb)returns text language plpgsql as $$begin perform app.m9_apply_sicar_descriptions(p);return 'APPLIED';exception when lock_not_available then return SQLSTATE;end$$",
  );
  const wp = (await one(writer, "select pg_backend_pid()p")).p,
    bp = (await one(binder, "select pg_backend_pid()p")).p;
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
  assert.equal(
    (
      await one(binder, "select pg_temp.catch_description_busy($1::jsonb)r", [
        p,
      ])
    ).r,
    "55P03",
  );
  const partialLocks = (
    await one(
      binder,
      "select count(*)::int n from pg_locks where pid=pg_backend_pid()and granted and(locktype='advisory'or relation in('public.products'::regclass,'public.variants'::regclass))",
    )
  ).n;
  assert.equal(partialLocks, 0, "ADVISORY_OR_PARTIAL_BARRIER_LEAKED");
  // The writer can finish its product/variant update while binder is still open.
  await writer.query(
    "update public.products set description=description where id=$1",
    [p.expected_state[0].product.id],
  );
  await writer.query(
    "update public.variants set price_cents=price_cents+1 where id=$1",
    [first],
  );
  await writer.query("commit");
  await assert.rejects(
    () =>
      binder.query("select app.m9_apply_sicar_descriptions($1::jsonb)", [p]),
    /CONTEXT_CHANGED/,
  );
  await binder.query("rollback");
  assert.equal(
    (
      await one(
        db,
        "select count(*)::int n from app.m9_sicar_description_events",
      )
    ).n,
    0,
  );
  await db.query("update public.variants set price_cents=650000 where id=$1", [
    first,
  ]);
  const fresh = structuredClone(p);
  fresh.request_id = randomUUID();
  fresh.observed_at = new Date().toISOString();
  fresh.expected_state = (
    await one(db, "select app.m9_sicar_price_state($1::uuid[])s", [ids])
  ).s;
  await binder.query("begin");
  assert.equal(
    (
      await one(binder, "select app.m9_apply_sicar_descriptions($1::jsonb)r", [
        fresh,
      ])
    ).r.changed_descriptions,
    7,
  );
  await writer.query("begin");
  const waiting = writer
    .query("select id from public.variants where id=$1 for update", [first])
    .then(
      (v) => ({ v }),
      (e) => ({ e }),
    );
  let blocking = false;
  for (let i = 0; i < 100; i++) {
    if ((await one(db, "select pg_blocking_pids($1)p", [wp])).p.includes(bp)) {
      blocking = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(blocking, true, "REFRESH_FIRST_ROW_WAIT_NOT_OBSERVED");
  await binder.query("commit");
  const locked = await waiting;
  if (locked.e) throw locked.e;
  assert.equal(locked.v.rowCount, 1);
  await writer.query(
    "update public.products set description='LOCAL QA MANUAL CHANGE'where id=$1",
    [fresh.expected_state[0].product.id],
  );
  await writer.query("commit");
  await assert.rejects(
    () =>
      db.query("select app.m9_reverse_sicar_descriptions($1,$2)", [
        randomUUID(),
        fresh.request_id,
      ]),
    /REVERSE_CONTEXT_CHANGED/,
  );
  const state = (
    await one(db, "select app.m9_sicar_price_state($1::uuid[])s", [ids])
  ).s;
  for (let i = 0; i < state.length; i++) {
    assert.deepEqual(state[i].provisional, p.expected_state[i].provisional);
    assert.equal(
      state[i].managed.source_sha256,
      p.expected_state[i].managed.source_sha256,
    );
    assert.equal(state[i].product.name, p.expected_state[i].product.name);
    assert.deepEqual(state[i].barcodes, p.expected_state[i].barcodes);
  }
  await cleanup();
  cleanup = null;
  assert.deepEqual(await financial(), financialBefore);
  const result = {
    protocol: "m9-description-seven-race-qa-1",
    database: target.pathname.slice(1),
    local_only: true,
    writer_first: {
      exact_for_update_row: true,
      nowait_55P03: true,
      advisory_and_partial_barriers_released_before_outer_rollback: true,
      writer_product_and_variant_committed_without_wait_cycle: true,
      stale_retry_context_rejected: true,
      no_events_created: true,
    },
    refresh_first: {
      exact_for_update_row: true,
      blocking_observed_pg_blocking_pids: true,
      writer_completed_after_refresh_commit: true,
      compensation_refused_after_manual_change: true,
    },
    deadlocks: 0,
    financial_inventory_tables_exact: 6,
    fixtures_deactivated: true,
    local_history_preserved: true,
    original_source_evidence_UUIDs_names_barcodes_preserved: true,
    remote_stock_cost_price_woo_finance_operations: 0,
    note: "Seven local synthetic fixtures retained inactive with their QA refresh receipt and manual edit history. Normal transaction suite independently rolls back all tables.",
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
  if (cleanup) await cleanup();
  await Promise.all([db.end(), writer.end(), binder.end()]);
}
