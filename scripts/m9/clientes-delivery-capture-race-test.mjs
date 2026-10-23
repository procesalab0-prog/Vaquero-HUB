// Committed SYNTHETIC history in our dedicated LOCAL clone; no remote DB.
import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { digest } from "./acceleration.mjs";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/qa_m9_docresponses_block5_20261022"
)
  throw Error("OWN_LOCAL_CAPTURE_DB_REQUIRED");
const db = new pg.Client({ connectionString: url.href }),
  a = new pg.Client({ connectionString: url.href }),
  b = new pg.Client({ connectionString: url.href });
await Promise.all([db.connect(), a.connect(), b.connect()]);
const query = async (c, sql, args = []) => (await c.query(sql, args)).rows;
async function audit() {
  const ts = await query(
      db,
      "select schemaname,tablename from pg_tables where schemaname in('app','public')order by schemaname,tablename",
    ),
    rows = [];
  for (const t of ts) {
    const id = [t.schemaname, t.tablename]
      .map((x) => '"' + x.replaceAll('"', '""') + '"')
      .join(".");
    rows.push({
      name: t.schemaname + "." + t.tablename,
      ...(
        await query(
          db,
          `select count(*)::int rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))md5 from ${id}t`,
        )
      )[0],
    });
  }
  return rows;
}
async function blocked(waiter, holder) {
  for (let i = 0; i < 100; i++) {
    if (
      (await query(db, "select pg_blocking_pids($1)p", [waiter]))[0].p.includes(
        holder,
      )
    )
      return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("DOCUMENT_ADVISORY_CONTENTION_NOT_OBSERVED");
}
let final;
try {
  assert.equal(
    (
      await query(
        db,
        "select configured_by from app.sicar_sync_control where singleton",
      )
    )[0].configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  await db.query(
    readFileSync(
      new URL("./clientes-delivery-capture.sql", import.meta.url),
      "utf8",
    ).replaceAll("create function ", "create or replace function "),
  );
  const admin = (
    await query(
      db,
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit 1",
    )
  )[0].id;
  for (const c of [db, a, b]) {
    await c.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await c.query("set statement_timeout='12s'");
  }
  const apid = (await query(a, "select pg_backend_pid()p"))[0].p,
    bpid = (await query(b, "select pg_backend_pid()p"))[0].p;
  const run = randomUUID(),
    src = digest({ run, synthetic: "documentary-capture" }),
    ref = randomUUID(),
    stamp = new Date(Date.now() - 1000).toISOString(),
    folio = "SYNTHETIC CAPTURE RACE " + run;
  const doc = {
    key: digest({ tenant: "VSM", client_ref: ref, folio }),
    folio,
    source_id: digest({ run }).slice(0, 24),
    source_at: stamp,
    historical_name: "SYNTHETIC LOCAL DOCUMENTARY ONLY",
    total_cents: 10000,
    balance_cents: 10000,
    paid_cents: 0,
    due_date: "2026-11-22",
    holds: [],
    linked_history_complete: false,
    evidence_sha256: digest({ run, evidence: "synthetic" }),
    payments: [],
    lines: [
      {
        index: 0,
        barcode: "QA-UNKNOWN-" + run,
        quantity: "1",
        description: "SYNTHETIC LOCAL ONLY; NOT REAL STOCK",
        variant_id: null,
        holds: ["DELIVERY_NOT_OBSERVED", "BARCODE_NOT_IN_STAGING"],
        delivery_status: "UNKNOWN",
        reserved_qty: null,
        stock_deduction: null,
      },
    ],
  };
  const archive = {
    protocol: "m9-credit-detail-archive-1",
    source_plan_sha256: src,
    source_from: stamp,
    source_until: stamp,
    operational_import_allowed: false,
    accounts: [
      {
        key: digest({ tenant: "VSM", client_ref: ref }),
        ref,
        name: "SYNTHETIC LOCAL DOCUMENTARY ONLY",
        source_at: stamp,
        balance_cents: 10000,
        documents: [doc],
      },
    ],
  };
  await db.query("select app.m9_archive_credit_details($1::jsonb)", [archive]);
  const before = await audit(),
    view = (
      await query(db, "select public.m9_delivery_capture_read($1::jsonb)v", [
        { document: doc.key },
      ])
    )[0].v,
    context = view.rows[0].capture_context;
  const plan = (request_id, revision) => ({
    protocol: "m9-delivery-capture-request-1",
    request_id,
    archive_sha256: src,
    document_key: doc.key,
    expected_archive_payload_hash: context.archive_payload_hash,
    expected_document_snapshot_hash: context.document_snapshot_hash,
    expected_revision: revision,
    action: "OBSERVE",
    choice: "UNKNOWN",
    revokes_request_id: null,
    confirmed: true,
  });
  const write = async (c, p) =>
    (
      await query(c, "select public.m9_delivery_capture_write($1::jsonb)v", [p])
    )[0].v;
  for (const c of [a, b]) await c.query("set role authenticated");
  // Two different concrete clicks read revision0. Exactly one append can win.
  const p1 = plan(randomUUID(), 0),
    p2 = plan(randomUUID(), 0);
  await a.query("begin");
  await b.query("begin");
  const first = await write(a, p1);
  assert.equal(first.revision, 1);
  const waiting = write(b, p2).then(
    (v) => ({ v }),
    (error) => ({ error }),
  );
  await blocked(bpid, apid);
  await a.query("commit");
  const conflict = await waiting;
  assert.match(conflict.error?.message ?? "", /DELIVERY_REVISION_CHANGED/);
  await b.query("rollback");
  // Exact concurrent retry with SAME pinned ID/context replays original event.
  const p3 = plan(randomUUID(), 1);
  await a.query("begin");
  await b.query("begin");
  const second = await write(a, p3);
  const same = write(b, p3).then(
    (v) => ({ v }),
    (error) => ({ error }),
  );
  await blocked(bpid, apid);
  await a.query("commit");
  const replay = await same;
  assert.ok(!replay.error);
  assert.equal(replay.v.replayed, true);
  assert.equal(replay.v.revision, second.revision);
  assert.equal(replay.v.reviewed_at, second.reviewed_at);
  assert.equal(replay.v.source_evidence_sha256, doc.evidence_sha256);
  await b.query("commit");
  // Append-only withdrawal deactivates the synthetic observation; no DELETE.
  const undo = {
    ...plan(randomUUID(), 2),
    action: "REVOKE",
    choice: null,
    revokes_request_id: p3.request_id,
  };
  await write(a, undo);
  assert.equal((await write(a, undo)).replayed, true);
  const after = await audit();
  assert.deepEqual(
    after.filter((t) => t.name !== "app.m9_delivery_observations"),
    before.filter((t) => t.name !== "app.m9_delivery_observations"),
  );
  const state = (
    await query(db, "select public.m9_delivery_capture_read($1::jsonb)v", [
      { document: doc.key },
    ])
  )[0].v;
  assert.equal(state.rows[0].capture_context.status, "REVOKED");
  assert.equal(state.rows[0].capture_context.revision, 3);
  assert.equal(state.summary.unknown_lines, 1);
  assert.equal(state.summary.concrete_documentary_reviews, 0);
  const events = await query(
    db,
    "select action,revision from app.m9_delivery_observations where archive_sha256=$1 order by revision",
    [src],
  );
  assert.deepEqual(events, [
    { action: "OBSERVE", revision: 1 },
    { action: "OBSERVE", revision: 2 },
    { action: "REVOKE", revision: 3 },
  ]);
  final = {
    protocol: "m9-delivery-capture-race-local-qa-1",
    synthetic_only: true,
    auth_storage_stubs: true,
    remote_operations: 0,
    distinct_sessions: true,
    observed_lock_waits: 2,
    stale_concurrent_click_rejected: true,
    concurrent_exact_retry_replayed: true,
    pinned_reviewed_at_and_evidence: true,
    deadlocks: 0,
    append_only_withdrawal: true,
    current_statement: "REVOKED",
    source_unknown_preserved: true,
    journal_events_retained: 3,
    archive_fixture_retained: 1,
    other_tables_identical_from_postfixture_baseline: before.length - 1,
    stock_cash_finance_effects: 0,
  };
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(final, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  console.log(JSON.stringify(final));
} finally {
  for (const c of [a, b]) await c.query("rollback").catch(() => {});
  await Promise.all([db.end(), a.end(), b.end()]);
}
