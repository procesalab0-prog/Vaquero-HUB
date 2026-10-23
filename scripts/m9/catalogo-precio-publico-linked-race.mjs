import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { seedLinkedPriceFixtures } from "./catalogo-precio-publico-linked-fixture.mjs";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/qa_m9_precio11777_race2_20261023"
)
  throw Error("ASSIGNED_LINKED_PRICE_QA_ONLY");
if (process.argv.length !== 4) throw Error("USAGE: PAYLOAD NEW_RESULT");
const p = JSON.parse(await readFile(process.argv[2], "utf8")),
  db = new pg.Client({ connectionString: target.href }),
  writer = new pg.Client({ connectionString: target.href }),
  binder = new pg.Client({ connectionString: target.href });
await Promise.all([db.connect(), writer.connect(), binder.connect()]);
const one = async (c, q, a = []) => (await c.query(q, a)).rows[0];
let cleanup;
try {
  assert.equal(
    (
      await one(
        db,
        "select to_regprocedure('app.m9_sicar_linked_price_state(uuid[])')r",
      )
    ).r,
    null,
    "FRESH_RACE_FIXTURES_REQUIRED",
  );
  await db.query(
    await readFile(
      new URL("./catalogo-precio-publico-linked-forward.sql", import.meta.url),
      "utf8",
    ),
  );
  const financialTables = [
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
          financialTables
            .map(
              (t) =>
                `select '${t}'name,md5(coalesce(string_agg(j,'|'order by j),''))h from(select to_jsonb(t)::text j from ${t} t)x`,
            )
            .join(" union all ") +
          ")x",
      )
    ).h;
  const financialBefore = await financial(),
    eventBefore = (
      await one(db, "select count(*)::int n from app.m9_sicar_price_events")
    ).n;
  await db.query("begin;set local timezone='UTC'");
  const { actor, ids, members, product_id } = await seedLinkedPriceFixtures(
    db,
    p,
  );
  await db.query("commit");
  cleanup = async () => {
    await db.query("begin");
    await db.query(
      "update public.variants set is_active=false where id=any($1::uuid[])",
      [members],
    );
    await db.query("update public.products set is_active=false where id=$1", [
      product_id,
    ]);
    await db.query("commit");
  };
  for (const c of [db, writer, binder]) {
    await c.query(
      "set statement_timeout='15s';set lock_timeout='8s';set timezone='UTC'",
    );
    await c.query("select set_config('request.jwt.claim.sub',$1,false)", [
      actor,
    ]);
  }
  await binder.query(
    "create function pg_temp.catch_linked_price(p jsonb)returns text language plpgsql as $$begin perform app.m9_apply_sicar_public_prices(p);return 'APPLIED';exception when lock_not_available then return SQLSTATE;end$$",
  );
  const wp = (await one(writer, "select pg_backend_pid()p")).p,
    bp = (await one(binder, "select pg_backend_pid()p")).p;
  await writer.query("begin");
  assert.equal(
    (
      await writer.query(
        "select id from public.variants where id=$1 for update",
        [ids[0]],
      )
    ).rowCount,
    1,
  );
  await binder.query("begin");
  assert.equal(
    (await one(binder, "select pg_temp.catch_linked_price($1::jsonb)r", [p])).r,
    "55P03",
  );
  assert.equal(
    (
      await one(
        binder,
        "select count(*)::int n from pg_locks where pid=pg_backend_pid()and granted and(locktype='advisory'or relation in('public.products'::regclass,'public.variants'::regclass))",
      )
    ).n,
    0,
  );
  await writer.query(
    "update public.products set description=description where id=$1",
    [product_id],
  );
  await writer.query(
    "update public.variants set price_cents=price_cents+1 where id=$1",
    [ids[0]],
  );
  await writer.query("commit");
  await assert.rejects(
    () =>
      binder.query("select app.m9_apply_sicar_public_prices($1::jsonb)", [p]),
    /CONTEXT_CHANGED/,
  );
  await binder.query("rollback");
  assert.equal(
    (await one(db, "select count(*)::int n from app.m9_sicar_price_events")).n,
    eventBefore,
  );
  await db.query("update public.variants set price_cents=810000 where id=$1", [
    ids[0],
  ]);
  const fresh = structuredClone(p);
  fresh.request_id = randomUUID();
  fresh.observed_at = new Date().toISOString();
  fresh.expected_state = (
    await one(db, "select app.m9_sicar_linked_price_state($1::uuid[])s", [ids])
  ).s;
  await binder.query("begin");
  assert.equal(
    (
      await one(binder, "select app.m9_apply_sicar_public_prices($1::jsonb)r", [
        fresh,
      ])
    ).r.changed,
    1,
  );
  await writer.query("begin");
  const waiting = writer
    .query("select id from public.variants where id=$1 for update", [ids[0]])
    .then(
      (v) => ({ v }),
      (e) => ({ e }),
    );
  let blocked = false;
  for (let i = 0; i < 100; i++) {
    if ((await one(db, "select pg_blocking_pids($1)p", [wp])).p.includes(bp)) {
      blocked = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(blocked, true);
  await binder.query("commit");
  const locked = await waiting;
  if (locked.e) throw locked.e;
  assert.equal(locked.v.rowCount, 1);
  await writer.query(
    "update app.web_product_drafts set revision=revision+1 where product_id=$1",
    [product_id],
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
  const state = (
    await one(db, "select app.m9_sicar_linked_price_state($1::uuid[])s", [ids])
  ).s[0];
  assert.deepEqual(state.web.source, p.expected_state[0].web.source);
  assert.deepEqual(
    state.linked_context.evidence,
    p.expected_state[0].linked_context.evidence,
  );
  assert.deepEqual(
    state.linked_context.copies,
    p.expected_state[0].linked_context.copies,
  );
  assert.equal(
    state.managed.source_sha256,
    p.expected_state[0].managed.source_sha256,
  );
  assert.equal(state.linked_context.category_guard.valid, true);
  await cleanup();
  cleanup = null;
  assert.deepEqual(await financial(), financialBefore);
  const result = {
    protocol: "m9-linked-price-race-qa-1",
    database: target.pathname.slice(1),
    local_only: true,
    writer_first: {
      exact_for_update_row: true,
      nowait_55P03: true,
      partial_barriers_and_advisory_released_in_recovered_transaction: true,
      writer_finished_before_retry: true,
      stale_retry_rejected: true,
    },
    price_first: {
      blocking_observed_pg_blocking_pids: true,
      writer_manual_draft_completed_after_commit: true,
      compensation_held: true,
      category_guard_unchanged_on_revision_only: true,
    },
    financial_inventory_tables_exact: 6,
    deadlocks: 0,
    fixtures_inactive: true,
    history_retained: true,
    source_SHA_snapshot_photos_copies_preserved: true,
    remote_writes: 0,
    note: "Synthetic committed local history retained; no Auth/Storage bytes or production acceptance. The manual draft revision is preserved. Revision alone does not invalidate the native category guard.",
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
