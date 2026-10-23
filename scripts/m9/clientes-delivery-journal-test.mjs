import pg from "pg";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { digest } from "./acceleration.mjs";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/qa_m9_entregas_block3_20261022"
)
  throw Error("OWN_LOCAL_DELIVERY_DB_REQUIRED");
const c = new pg.Client({ connectionString: url.href });
await c.connect();
const audit = async () => {
  const tables = (
      await c.query(
        "select schemaname,tablename from pg_tables where schemaname in('app','public') order by schemaname,tablename",
      )
    ).rows,
    rows = [];
  for (const t of tables) {
    const id = [t.schemaname, t.tablename]
      .map((x) => '"' + x.replaceAll('"', '""') + '"')
      .join(".");
    rows.push({
      name: t.schemaname + "." + t.tablename,
      ...(
        await c.query(
          `select count(*)::int rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) md5 from ${id} t`,
        )
      ).rows[0],
    });
  }
  return rows;
};
let negative = 0,
  acl = 0;
const rejects = async (sql, params, pattern) => {
  await c.query("savepoint bad");
  let error;
  try {
    await c.query(sql, params);
  } catch (e) {
    error = e;
  }
  await c.query("rollback to savepoint bad");
  await c.query("release savepoint bad");
  assert.ok(error, "Expected " + pattern);
  assert.match(error.message, new RegExp(pattern));
  negative++;
};
const uuid = (n) => `${String(n).padStart(8, "0")}-3333-4333-8333-333333333333`;
let report;
try {
  assert.equal(
    (
      await c.query(
        "select configured_by from app.sicar_sync_control where singleton",
      )
    ).rows[0]?.configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  // DDL is local and deliberately separate from all rolled-back business fixtures.
  if (
    !(await c.query("select to_regclass('app.m9_delivery_observations') rel"))
      .rows[0].rel
  )
    await c.query(
      readFileSync(
        new URL("./clientes-delivery-journal.sql", import.meta.url),
        "utf8",
      ),
    );
  const admin = (
    await c.query(
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN' and u.is_active order by u.id limit 1",
    )
  ).rows[0].id;
  const before = await audit();
  await c.query("begin");
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [admin]);
  const ref = uuid(71),
    key = digest({ tenant: "VSM", client_ref: ref }),
    dk = digest({ tenant: "VSM", client_ref: ref, folio: "SYNTHETIC-DOC-1" }),
    stamp = "2026-10-22T18:00:00.000Z";
  const doc = {
    key: dk,
    folio: "SYNTHETIC-DOC-1",
    source_id: "f".repeat(24),
    source_at: stamp,
    historical_name: "SYNTHETIC DELIVERY QA",
    total_cents: 10000,
    balance_cents: 10000,
    paid_cents: 0,
    due_date: "2026-11-22",
    holds: [],
    linked_history_complete: false,
    evidence_sha256: "b".repeat(64),
    payments: [],
    lines: [
      {
        index: 0,
        barcode: "000123",
        quantity: "2",
        description: "SYNTHETIC PRODUCT",
        variant_id: null,
        holds: ["DELIVERY_NOT_OBSERVED", "BARCODE_NOT_IN_STAGING"],
        delivery_status: "UNKNOWN",
        reserved_qty: null,
        stock_deduction: null,
      },
      {
        index: 1,
        barcode: "SX00000",
        quantity: "1",
        description: "SYNTHETIC GENERIC DEBT",
        variant_id: null,
        holds: ["DELIVERY_NOT_OBSERVED", "LEGACY_GENERIC_DEBT_LINE"],
        delivery_status: "UNKNOWN",
        reserved_qty: null,
        stock_deduction: null,
      },
    ],
  };
  const archive = {
    protocol: "m9-credit-detail-archive-1",
    source_plan_sha256: "f".repeat(64),
    source_from: stamp,
    source_until: stamp,
    operational_import_allowed: false,
    accounts: [
      {
        key,
        ref,
        name: "SYNTHETIC DELIVERY QA",
        source_at: stamp,
        balance_cents: 10000,
        documents: [doc],
      },
    ],
  };
  await c.query("select app.m9_archive_credit_details($1::jsonb)", [archive]);
  const beforeObservations = await audit();
  const ctx = (
    await c.query("select app.m9_delivery_document_snapshot($1,$2) value", [
      archive.source_plan_sha256,
      dk,
    ])
  ).rows[0].value;
  const observation = {
    reviewed_at: "2026-10-22T23:00:00.000Z",
    reviewer_ref: "SYNTHETIC REVIEWER",
    evidence_sha256: "c".repeat(64),
    statement: "ALL_DELIVERED",
    lines: [],
    documentary_only: true,
    operational_import_allowed: false,
    stock_delivery_allowed: false,
  };
  const payload = {
    protocol: "m9-document-delivery-observation-1",
    project_id: "zsezjtswqeijboezvado",
    request_id: uuid(80),
    archive_sha256: archive.source_plan_sha256,
    document_key: dk,
    expected_archive_payload_hash: ctx.archive_payload_hash,
    expected_document: doc,
    expected_revision: 0,
    action: "OBSERVE",
    revokes_request_id: null,
    observation,
  };
  const call = async (p) =>
    (
      await c.query(
        "select app.m9_record_delivery_observation($1::jsonb) value",
        [p],
      )
    ).rows[0].value;
  const first = await call(payload);
  assert.equal(first.revision, 1);
  assert.equal(first.stock_delivery_allowed, false);
  assert.equal(first.financial_opening_allowed, false);
  assert.equal((await call(payload)).replayed, true);
  const bad = async (fn, pattern) => {
    const p = structuredClone(payload);
    p.request_id = uuid(81 + negative);
    p.expected_revision = 1;
    fn(p);
    await rejects(
      "select app.m9_record_delivery_observation($1::jsonb)",
      [p],
      pattern,
    );
  };
  await bad(
    (p) => (p.project_id = "drubkjlmfbdeglucakmg"),
    "DELIVERY_PLAN_INVALID",
  );
  await bad(
    (p) => (p.expected_archive_payload_hash = "e".repeat(64)),
    "DELIVERY_SOURCE_DOCUMENT_CHANGED",
  );
  await bad(
    (p) => (p.expected_document.lines[0].barcode = "123"),
    "DELIVERY_SOURCE_DOCUMENT_CHANGED",
  );
  await bad(
    (p) => (p.expected_document.balance_cents = 0),
    "DELIVERY_SOURCE_DOCUMENT_CHANGED",
  );
  await bad(
    (p) => p.expected_document.payments.push({ cancelled: true }),
    "DELIVERY_SOURCE_DOCUMENT_CHANGED",
  );
  await bad((p) => (p.expected_revision = 0), "DELIVERY_REVISION_CHANGED");
  await bad(
    (p) => (p.observation.stock_delivery_allowed = true),
    "DELIVERY_OBSERVATION_INVALID",
  );
  await bad(
    (p) => (p.observation.documentary_only = false),
    "DELIVERY_OBSERVATION_INVALID",
  );
  await bad(
    (p) => (p.observation.evidence_sha256 = ""),
    "DELIVERY_OBSERVATION_INVALID",
  );
  await bad(
    (p) => (p.observation.reviewer_ref = "x\ny"),
    "DELIVERY_OBSERVATION_INVALID",
  );
  await bad(
    (p) => (p.observation.reviewed_at = "2026-02-31T00:00:00.000Z"),
    "date/time field value out of range|DELIVERY_DATE_INVALID",
  );
  await bad(
    (p) => (p.observation.reviewed_at = "2026-10-22T24:00:00.000Z"),
    "DELIVERY_DATE_INVALID",
  );
  await bad(
    (p) => (p.observation.reviewed_at = "2026-10-22T23:00:00Z"),
    "DELIVERY_OBSERVATION_INVALID",
  );
  await bad(
    (p) => (p.observation.reviewed_at = "2026-10-21T23:00:00.000Z"),
    "DELIVERY_DATE_INVALID",
  );
  await bad(
    (p) => (p.observation.reviewed_at = "2099-10-22T23:00:00.000Z"),
    "DELIVERY_DATE_INVALID",
  );
  await bad(
    (p) => (p.observation.lines = [{ index: 0 }]),
    "DELIVERY_NO_INFERRED_QUANTITIES",
  );
  await bad((p) => {
    p.observation.statement = "MIXED";
    p.observation.lines = [];
  }, "DELIVERY_MIXED_COVERAGE_INVALID");
  const mixed = [
    {
      index: 0,
      barcode: "000123",
      status: "QUANTIFIED",
      delivered_qty: "0.25",
      pending_qty: "1.75",
    },
    {
      index: 1,
      barcode: "SX00000",
      status: "UNKNOWN",
      delivered_qty: null,
      pending_qty: null,
    },
  ];
  await bad((p) => {
    p.observation.statement = "MIXED";
    p.observation.lines = structuredClone(mixed);
    p.observation.lines[0].barcode = "123";
  }, "DELIVERY_LITERAL_LINE_CHANGED");
  await bad((p) => {
    p.observation.statement = "MIXED";
    p.observation.lines = structuredClone(mixed);
    p.observation.lines[0].pending_qty = "1.76";
  }, "DELIVERY_QUANTITIES_DIFFER");
  await bad((p) => {
    p.observation.statement = "MIXED";
    p.observation.lines = structuredClone(mixed);
    p.observation.lines[1] = {
      index: 1,
      barcode: "SX00000",
      status: "QUANTIFIED",
      delivered_qty: "0",
      pending_qty: "1",
    };
  }, "DELIVERY_UNKNOWN_IS_NOT_PHYSICAL_ZERO");
  await bad((p) => {
    p.observation.statement = "MIXED";
    p.observation.lines = [
      structuredClone(mixed[0]),
      structuredClone(mixed[0]),
    ];
  }, "DELIVERY_LITERAL_LINE_CHANGED");
  const mix = structuredClone(payload);
  mix.request_id = uuid(150);
  mix.expected_revision = 1;
  mix.observation.statement = "MIXED";
  mix.observation.lines = mixed;
  assert.equal((await call(mix)).revision, 2);
  const replay = await call(payload);
  assert.equal(replay.historical_receipt_only, true);
  assert.equal(replay.current_revision, 2);
  const conflicting = structuredClone(mix);
  conflicting.observation.statement = "UNKNOWN";
  conflicting.observation.lines = [];
  await rejects(
    "select app.m9_record_delivery_observation($1::jsonb)",
    [conflicting],
    "DELIVERY_IDEMPOTENCY_CONFLICT",
  );
  const revoke = {
    ...mix,
    request_id: uuid(151),
    expected_revision: 2,
    action: "REVOKE",
    revokes_request_id: mix.request_id,
    observation: null,
  };
  const compensation = await call(revoke);
  assert.equal(compensation.revision, 3);
  assert.equal((await call(revoke)).replayed, true);
  await rejects(
    "select app.m9_record_delivery_observation($1::jsonb)",
    [{ ...revoke, request_id: uuid(152), expected_revision: 3 }],
    "DELIVERY_REVOKE_NOT_CURRENT",
  );
  await rejects(
    "update app.m9_delivery_observations set action='REVOKE' where request_id=$1",
    [payload.request_id],
    "IMMUTABLE",
  );
  await rejects(
    "delete from app.m9_delivery_observations where request_id=$1",
    [payload.request_id],
    "IMMUTABLE",
  );
  const source = (
    await c.query(
      "select payload from app.m9_credit_detail_archives where source_plan_sha256=$1",
      [archive.source_plan_sha256],
    )
  ).rows[0].payload;
  assert.deepEqual(source, archive);
  assert.equal(
    source.accounts[0].documents[0].lines[0].delivery_status,
    "UNKNOWN",
  );
  await c.query("savepoint disabled");
  await c.query(
    "update app.sicar_sync_control set catalog_writes_enabled=false where singleton",
  );
  await rejects(
    "select app.m9_delivery_document_snapshot($1,$2)",
    [archive.source_plan_sha256, dk],
    "DISABLED|NOT_ENABLED|STAGING_NOT_CONFIGURED",
  );
  await c.query("rollback to savepoint disabled");
  await c.query("release savepoint disabled");
  await c.query("savepoint noactor");
  await c.query("select set_config('request.jwt.claim.sub','',true)");
  await rejects(
    "select app.m9_delivery_document_snapshot($1,$2)",
    [archive.source_plan_sha256, dk],
    "NOT_AUTHORIZED",
  );
  await c.query("rollback to savepoint noactor");
  await c.query("release savepoint noactor");
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const sql of [
      "select * from app.m9_delivery_observations",
      "select app.m9_delivery_document_snapshot('" +
        archive.source_plan_sha256 +
        "','" +
        dk +
        "')",
      "select app.m9_record_delivery_observation('{}'::jsonb)",
    ]) {
      await c.query("savepoint rolecheck");
      await c.query(`set local role ${role}`);
      let error;
      try {
        await c.query(sql);
      } catch (e) {
        error = e;
      }
      await c.query("rollback to savepoint rolecheck");
      await c.query("release savepoint rolecheck");
      assert.ok(error);
      assert.match(error.message, /permission denied/);
      acl++;
    }
  }
  const during = await audit();
  const otherTables = (rows) =>
    rows.filter((t) => t.name !== "app.m9_delivery_observations");
  assert.deepEqual(otherTables(during), otherTables(beforeObservations));
  assert.equal(
    during.find((t) => t.name === "app.m9_delivery_observations").rows -
      beforeObservations.find((t) => t.name === "app.m9_delivery_observations")
        .rows,
    3,
  );
  await c.query("rollback");
  const after = await audit();
  assert.deepEqual(after, before);
  report = {
    protocol: "m9-delivery-journal-local-qa-1",
    database: url.pathname.slice(1),
    synthetic_only: true,
    auth_storage_stubs: true,
    remote_operations: 0,
    negative_cases: negative,
    acl_rejections: acl,
    tables_unchanged: after.length,
    other_tables_unchanged_during_trial: otherTables(during).length,
    source_unchanged: true,
    events_trial: 3,
    replay_pass: true,
    logical_reversal_pass: true,
    rollback_pass: true,
    stock_finance_cash_effects: 0,
  };
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
  console.log(JSON.stringify(report));
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
