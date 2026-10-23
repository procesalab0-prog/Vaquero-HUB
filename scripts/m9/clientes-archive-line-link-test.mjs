import pg from "pg";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { digest } from "./acceleration.mjs";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/qa_m9_entregas_block3_20261022"
)
  throw Error("OWN_LOCAL_LINE_LINK_DB_REQUIRED");
const c = new pg.Client({ connectionString: url.href }),
  writer = new pg.Client({ connectionString: url.href });
await Promise.all([c.connect(), writer.connect()]);
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
          `select count(*)::int rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))md5 from ${id}t`,
        )
      ).rows[0],
    });
  }
  return rows;
};
const uuid = (n) => `${String(n).padStart(8, "0")}-4444-4444-8444-444444444444`;
let negatives = 0,
  acl = 0,
  blocking;
const reject = async (p, pattern) => {
  await c.query("savepoint bad");
  let e;
  try {
    await c.query("select app.m9_record_archived_line_link($1::jsonb)", [p]);
  } catch (x) {
    e = x;
  }
  await c.query("rollback to savepoint bad");
  await c.query("release savepoint bad");
  assert.ok(e, "Expected " + pattern);
  assert.match(e.message, new RegExp(pattern));
  negatives++;
};
try {
  assert.equal(
    (
      await c.query(
        "select configured_by from app.sicar_sync_control where singleton",
      )
    ).rows[0]?.configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  if (
    !(await c.query("select to_regclass('app.m9_archived_line_links')rel"))
      .rows[0].rel
  )
    await c.query(
      readFileSync(
        new URL("./clientes-archive-line-link.sql", import.meta.url),
        "utf8",
      ),
    );
  if (process.env.QA_REPLACE_FUNCTIONS === "1")
    for (const sql of readFileSync(
      new URL("./clientes-archive-line-link.sql", import.meta.url),
      "utf8",
    ).matchAll(/create function app\.[\s\S]+?\$\$;/g))
      await c.query(
        sql[0].replace("create function", "create or replace function"),
      );
  const admin = (
    await c.query(
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit1".replace(
        "limit1",
        "limit 1",
      ),
    )
  ).rows[0].id;
  const managed = (
    await c.query(
      "select r.variant_id,r.barcode from app.m9_rows r where app.m9_rehearsal_current_row(r.variant_id)=r.source_row order by r.barcode limit 1",
    )
  ).rows[0];
  assert.ok(managed);
  const before = await audit();
  await c.query("begin");
  await c.query("set local statement_timeout='15s'");
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [admin]);
  const ref = uuid(70),
    src = "1".repeat(64),
    dk = digest({ tenant: "VSM", client_ref: ref, folio: "SYNTHETIC-LINK-1" }),
    stamp = "2026-10-22T18:00:00.000Z";
  const line = (index, barcode) => ({
    index,
    barcode,
    quantity: "1",
    description: "SYNTHETIC EXACT LINK QA",
    variant_id: null,
    holds: [
      "DELIVERY_NOT_OBSERVED",
      barcode === "SX00000"
        ? "LEGACY_GENERIC_DEBT_LINE"
        : "BARCODE_NOT_IN_STAGING",
    ],
    delivery_status: "UNKNOWN",
    reserved_qty: null,
    stock_deduction: null,
  });
  const doc = {
    key: dk,
    folio: "SYNTHETIC-LINK-1",
    source_id: "e".repeat(24),
    source_at: stamp,
    historical_name: "SYNTHETIC LINE LINK QA",
    total_cents: 10000,
    balance_cents: 10000,
    paid_cents: 0,
    due_date: "2026-11-22",
    holds: [],
    linked_history_complete: false,
    evidence_sha256: "b".repeat(64),
    payments: [],
    lines: [line(0, managed.barcode), line(1, "SX00000")],
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
        name: "SYNTHETIC LINE LINK QA",
        source_at: stamp,
        balance_cents: 10000,
        documents: [doc],
      },
    ],
  };
  await c.query("select app.m9_archive_credit_details($1::jsonb)", [archive]);
  const archiveHash = (
    await c.query(
      "select payload_hash from app.m9_credit_detail_archives where source_plan_sha256=$1",
      [src],
    )
  ).rows[0].payload_hash;
  const snapshot = (
    await c.query("select app.m9_general_registration_snapshot()v")
  ).rows[0].v;
  await c.query("select app.m9_register_general_customer_archive($1::jsonb)", [
    {
      protocol: "m9-general-customer-registration-1",
      project_id: "zsezjtswqeijboezvado",
      request_id: uuid(71),
      archive_sha256: src,
      archive_payload_hash: archiveHash,
      expected_snapshot: snapshot,
      expected_additions: {
        accounts: 1,
        documents: 1,
        payments: 0,
        lines: 2,
        balance_cents: 10000,
      },
      operational_import_allowed: false,
    },
  ]);
  const source = (
    await c.query("select app.m9_archived_line_source_snapshot($1,$2,0)v", [
      src,
      dk,
    ])
  ).rows[0].v;
  const cat = (
    await c.query("select app.m9_archived_line_catalog_snapshot($1,$2)v", [
      managed.barcode,
      managed.variant_id,
    ])
  ).rows[0].v;
  const p = {
    protocol: "m9-archived-line-link-1",
    project_id: "zsezjtswqeijboezvado",
    request_id: uuid(80),
    archive_sha256: src,
    document_key: dk,
    line_index: 0,
    expected_archive_payload_hash: archiveHash,
    expected_document: doc,
    expected_registered_line: source.registered_line,
    expected_managed_row: cat.managed_row,
    expected_current_row: cat.current_row,
    expected_revision: 0,
    action: "BIND",
    revokes_request_id: null,
    variant_id: managed.variant_id,
    evidence_sha256: "c".repeat(64),
    reason: "EXACT_LITERAL_SICAR_CODE_DOCUMENTARY_ONLY",
  };
  const beforeLinks = await audit(),
    call = async (value) =>
      (
        await c.query("select app.m9_record_archived_line_link($1::jsonb)v", [
          value,
        ])
      ).rows[0].v,
    read = async () =>
      (
        await c.query("select app.m9_read_archived_line_link($1,$2,0)v", [
          src,
          dk,
        ])
      ).rows[0].v;
  assert.equal((await read()).status, "UNREVIEWED");
  // Demonstrate the catalog barrier waits on an independent would-be writer.
  await writer.query("begin");
  await writer.query("lock table public.variants in row exclusive mode");
  const cpid = (await c.query("select pg_backend_pid()pid")).rows[0].pid,
    wpid = (await writer.query("select pg_backend_pid()pid")).rows[0].pid;
  let settled = false;
  const pending = call(p).finally(() => (settled = true));
  let observed = false;
  for (let i = 0; i < 50; i++) {
    const blockers = (
      await writer.query("select pg_blocking_pids($1)pids", [cpid])
    ).rows[0].pids;
    if (blockers.includes(wpid)) {
      observed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(observed, true);
  assert.equal(settled, false);
  await writer.query("rollback");
  const first = await pending;
  blocking = {
    catalog_barrier_blocking_observed: true,
    writer_rolled_back: true,
  };
  assert.equal(first.action, "BIND");
  assert.equal((await call(p)).replayed, true);
  assert.equal((await read()).status, "LIVE_EXACT");
  assert.equal((await read()).stock_delivery_allowed, false);
  const bad = async (fn, pattern) => {
    const value = structuredClone(p);
    value.request_id = uuid(90 + negatives);
    value.expected_revision = 1;
    fn(value);
    await reject(value, pattern);
  };
  await bad(
    (x) => (x.project_id = "drubkjlmfbdeglucakmg"),
    "LINE_LINK_PLAN_INVALID",
  );
  await bad(
    (x) => (x.expected_archive_payload_hash = "d".repeat(64)),
    "LINE_LINK_SOURCE_DOCUMENT_CHANGED",
  );
  await bad(
    (x) => (x.expected_document.lines[0].barcode = "changed"),
    "LINE_LINK_SOURCE_DOCUMENT_CHANGED",
  );
  await bad(
    (x) => (x.expected_document.balance_cents = 0),
    "LINE_LINK_SOURCE_DOCUMENT_CHANGED",
  );
  await bad(
    (x) => (x.expected_registered_line.quantity = 2),
    "LINE_LINK_UNMAPPED_LITERAL_SOURCE_REQUIRED",
  );
  await bad(
    (x) => (x.expected_managed_row.barcode = "changed"),
    "LINE_LINK_CATALOG_CHANGED_OR_AMBIGUOUS",
  );
  await bad(
    (x) => (x.expected_current_row.description = "changed"),
    "LINE_LINK_CATALOG_CHANGED_OR_AMBIGUOUS",
  );
  await bad(
    (x) => (x.variant_id = uuid(999)),
    "LINE_LINK_CATALOG_CHANGED_OR_AMBIGUOUS",
  );
  await bad((x) => (x.expected_revision = 0), "LINE_LINK_REVISION_CHANGED");
  await bad((x) => (x.evidence_sha256 = ""), "LINE_LINK_PLAN_INVALID");
  await bad(
    (x) => (x.reason = "GROUPED_BY_DESCRIPTION"),
    "LINE_LINK_PLAN_INVALID",
  );
  await bad(() => {}, "LINE_LINK_ALREADY_BOUND");
  const generic = (
    await c.query("select app.m9_archived_line_source_snapshot($1,$2,1)v", [
      src,
      dk,
    ])
  ).rows[0].v;
  await bad((x) => {
    x.line_index = 1;
    x.expected_revision = 0;
    x.expected_registered_line = generic.registered_line;
  }, "LINE_LINK_UNMAPPED_LITERAL_SOURCE_REQUIRED");
  await reject(
    { ...p, evidence_sha256: "d".repeat(64) },
    "LINE_LINK_IDEMPOTENCY_CONFLICT",
  );
  await c.query("savepoint catalog_drift");
  await c.query(
    "update public.variants set price_cents=price_cents+1 where id=$1",
    [managed.variant_id],
  );
  assert.equal((await read()).status, "HELD_SOURCE_OR_CATALOG_CHANGED");
  await bad(() => {}, "LINE_LINK_CATALOG_CHANGED_OR_AMBIGUOUS");
  const revoke = {
    ...p,
    request_id: uuid(150),
    expected_revision: 1,
    action: "REVOKE",
    revokes_request_id: p.request_id,
    variant_id: null,
    expected_managed_row: null,
    expected_current_row: null,
    reason: "REVOKE_DOCUMENTARY_LINK_PRESERVE_HISTORY",
  };
  // Compensation remains possible even when the catalog changed after binding.
  assert.equal((await call(revoke)).action, "REVOKE");
  assert.equal((await read()).status, "REVOKED");
  await c.query("rollback to savepoint catalog_drift");
  await c.query("release savepoint catalog_drift");
  assert.equal((await read()).status, "LIVE_EXACT");
  assert.equal((await call(revoke)).revision, 2);
  assert.equal((await call(revoke)).replayed, true);
  assert.equal((await read()).status, "REVOKED");
  assert.equal((await call(p)).historical_receipt_only, true);
  await reject(
    { ...revoke, request_id: uuid(151), expected_revision: 2 },
    "LINE_LINK_REVOKE_NOT_CURRENT",
  );
  for (const sql of [
    "update app.m9_archived_line_links set evidence_sha256='changed'",
    "delete from app.m9_archived_line_links",
  ]) {
    await c.query("savepoint immutable");
    let e;
    try {
      await c.query(sql);
    } catch (x) {
      e = x;
    }
    await c.query("rollback to savepoint immutable");
    await c.query("release savepoint immutable");
    assert.match(e?.message ?? "", /IMMUTABLE/);
    negatives++;
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const sql of [
      "select * from app.m9_archived_line_links",
      "select app.m9_archived_line_source_snapshot('" +
        src +
        "','" +
        dk +
        "',0)",
      "select app.m9_read_archived_line_link('" + src + "','" + dk + "',0)",
      "select app.m9_record_archived_line_link('{}'::jsonb)",
    ]) {
      await c.query("savepoint acl");
      await c.query(`set local role ${role}`);
      let e;
      try {
        await c.query(sql);
      } catch (x) {
        e = x;
      }
      await c.query("rollback to savepoint acl");
      await c.query("release savepoint acl");
      assert.match(e?.message ?? "", /permission denied/);
      acl++;
    }
  }
  await c.query("savepoint disabled");
  await c.query(
    "update app.sicar_sync_control set catalog_writes_enabled=false where singleton",
  );
  await reject(p, "SICAR_CATALOG_SYNC_DISABLED");
  await c.query("rollback to savepoint disabled");
  await c.query("release savepoint disabled");
  await c.query("savepoint noactor");
  await c.query("select set_config('request.jwt.claim.sub','',true)");
  await reject(p, "NOT_AUTHORIZED");
  await c.query("rollback to savepoint noactor");
  await c.query("release savepoint noactor");
  const afterLinks = await audit(),
    exclude = (rows) =>
      rows.filter((x) => x.name !== "app.m9_archived_line_links");
  assert.deepEqual(exclude(afterLinks), exclude(beforeLinks));
  assert.equal(
    afterLinks.find((x) => x.name === "app.m9_archived_line_links").rows -
      beforeLinks.find((x) => x.name === "app.m9_archived_line_links").rows,
    2,
  );
  const raw = (
    await c.query("select app.m9_archived_line_source_snapshot($1,$2,0)v", [
      src,
      dk,
    ])
  ).rows[0].v;
  assert.equal(raw.source_line.variant_id, null);
  assert.equal(raw.registered_line.variant_id, null);
  assert.equal(raw.source_line.delivery_status, "UNKNOWN");
  await c.query("rollback");
  const after = await audit();
  assert.deepEqual(after, before);
  const report = {
    protocol: "m9-archive-line-link-local-qa-1",
    synthetic_only: true,
    auth_storage_stubs: true,
    remote_operations: 0,
    negative_cases: negatives,
    acl_rejections: acl,
    ...blocking,
    raw_source_unchanged: true,
    other_tables_unchanged_during_trial: exclude(afterLinks).length,
    tables_unchanged_after_rollback: after.length,
    bind_replay_pass: true,
    compensation_replay_pass: true,
    compensation_after_catalog_drift_pass: true,
    raw_variant_id_still_null: true,
    delivery_status: "UNKNOWN",
    stock_cash_finance_effects: 0,
  };
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
  console.log(JSON.stringify(report));
} finally {
  await Promise.allSettled([c.query("rollback"), writer.query("rollback")]);
  await Promise.all([c.end(), writer.end()]);
}
