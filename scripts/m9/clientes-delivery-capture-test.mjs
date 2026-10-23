import pg from "pg";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { digest } from "./acceleration.mjs";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/qa_m9_docresponses_block5_20261022"
)
  throw Error("OWN_LOCAL_REVIEW_DB_REQUIRED");
const c = new pg.Client({ connectionString: url.href });
await c.connect();
const query = async (sql, args = []) => (await c.query(sql, args)).rows;
const audit = async () => {
  const tables = await query(
      "select schemaname,tablename from pg_tables where schemaname in('app','public')order by schemaname,tablename",
    ),
    rows = [];
  for (const t of tables) {
    const id = [t.schemaname, t.tablename]
      .map((x) => '"' + x.replaceAll('"', '""') + '"')
      .join(".");
    rows.push({
      name: t.schemaname + "." + t.tablename,
      ...(
        await query(
          `select count(*)::int rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))md5 from ${id}t`,
        )
      )[0],
    });
  }
  return rows;
};
const uuid = (n) => `${String(n).padStart(8, "0")}-5555-4555-8555-555555555555`;
let negatives = 0,
  acl = 0;
async function reject(sql, args, pattern) {
  await c.query("savepoint bad");
  let error;
  try {
    await c.query(sql, args);
  } catch (e) {
    error = e;
  }
  await c.query("rollback to savepoint bad");
  await c.query("release savepoint bad");
  assert.match(error?.message ?? "", new RegExp(pattern));
  negatives++;
}
try {
  assert.equal(
    (
      await query(
        "select configured_by from app.sicar_sync_control where singleton",
      )
    )[0]?.configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  if (
    !(
      await query(
        "select to_regprocedure('public.m9_delivery_review_read(jsonb)')r",
      )
    )[0].r
  )
    await c.query(
      readFileSync(
        new URL("./clientes-delivery-review-read.sql", import.meta.url),
        "utf8",
      ),
    );
  if (process.env.QA_REPLACE_FUNCTIONS === "1")
    for (const sql of readFileSync(
      new URL("./clientes-delivery-review-read.sql", import.meta.url),
      "utf8",
    ).matchAll(/create function (?:app|public)\.[\s\S]+?\$\$;/g))
      await c.query(
        sql[0].replace("create function", "create or replace function"),
      );
  await c.query(
    readFileSync(
      new URL("./clientes-delivery-capture.sql", import.meta.url),
      "utf8",
    ).replaceAll("create function ", "create or replace function "),
  );
  const admin = (
      await query(
        "select u.id,u.role_id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit 1",
      )
    )[0],
    other = (
      await query(
        "select u.id,(select id from public.roles where code='CASHIER')role_id from public.app_users u where u.is_active and u.id<>$1 order by u.id limit 1",
        [admin.id],
      )
    )[0],
    managed = (
      await query(
        "select barcode,variant_id from app.m9_rows r where app.m9_rehearsal_current_row(r.variant_id)=r.source_row order by barcode limit 1",
      )
    )[0];
  assert.ok(admin && other && managed);
  const before = await audit();
  await c.query("begin");
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
    admin.id,
  ]);
  const src = "3".repeat(64),
    stamp = new Date(
      (await query("select clock_timestamp()stamp"))[0].stamp.getTime() - 1,
    ).toISOString(),
    accounts = [],
    allDocs = [];
  for (let a = 0; a < 2; a++) {
    const ref = uuid(70 + a),
      documents = [];
    for (let i = 0; i < 5; i++) {
      const number = a * 5 + i,
        folio = i === 0 ? "SYNTHETIC SAME FOLIO" : "SYNTHETIC DOC " + number;
      const lines = [
        {
          index: 0,
          barcode: number < 2 ? managed.barcode : "0000004" + number,
          quantity: "1",
          description: "SYNTHETIC PRODUCT " + number,
          variant_id: number === 1 ? managed.variant_id : null,
          holds:
            number === 1
              ? ["DELIVERY_NOT_OBSERVED"]
              : ["DELIVERY_NOT_OBSERVED", "BARCODE_NOT_IN_STAGING"],
          delivery_status: "UNKNOWN",
          reserved_qty: null,
          stock_deduction: null,
        },
      ];
      if (number === 0)
        lines.push({
          index: 1,
          barcode: "SX00000",
          quantity: "2",
          description: "SYNTHETIC GENERIC DEBT",
          variant_id: null,
          holds: ["DELIVERY_NOT_OBSERVED", "LEGACY_GENERIC_DEBT_LINE"],
          delivery_status: "UNKNOWN",
          reserved_qty: null,
          stock_deduction: null,
        });
      const doc = {
        key: digest({ tenant: "VSM", client_ref: ref, folio }),
        folio,
        source_id: digest({ a, i, synthetic: "review-page" }).slice(0, 24),
        source_at: stamp,
        historical_name: "SYNTHETIC DUPLICATE NAME",
        total_cents: 10000,
        balance_cents: 10000,
        paid_cents: 0,
        due_date: "2026-11-22",
        holds: [],
        linked_history_complete: false,
        evidence_sha256: digest({ a, i, synthetic: "document" }),
        payments: [],
        lines,
      };
      documents.push(doc);
      allDocs.push(doc);
    }
    accounts.push({
      key: digest({ tenant: "VSM", client_ref: ref }),
      ref,
      name: "SYNTHETIC DUPLICATE NAME",
      source_at: stamp,
      balance_cents: 50000,
      documents,
    });
  }
  const archive = {
    protocol: "m9-credit-detail-archive-1",
    source_plan_sha256: src,
    source_from: stamp,
    source_until: stamp,
    operational_import_allowed: false,
    accounts,
  };
  await c.query("select app.m9_archive_credit_details($1::jsonb)", [archive]);
  const archiveHash = (
    await query(
      "select payload_hash from app.m9_credit_detail_archives where source_plan_sha256=$1",
      [src],
    )
  )[0].payload_hash;
  await c.query("select app.m9_register_general_customer_archive($1::jsonb)", [
    {
      protocol: "m9-general-customer-registration-1",
      project_id: "zsezjtswqeijboezvado",
      request_id: uuid(80),
      archive_sha256: src,
      archive_payload_hash: archiveHash,
      expected_snapshot: (
        await query("select app.m9_general_registration_snapshot()v")
      )[0].v,
      expected_additions: {
        accounts: 2,
        documents: 10,
        payments: 0,
        lines: 11,
        balance_cents: 100000,
      },
      operational_import_allowed: false,
    },
  ]);
  const first = allDocs[0],
    source = (
      await query("select app.m9_archived_line_source_snapshot($1,$2,0)v", [
        src,
        first.key,
      ])
    )[0].v,
    cat = (
      await query("select app.m9_archived_line_catalog_snapshot($1,$2)v", [
        managed.barcode,
        managed.variant_id,
      ])
    )[0].v;
  await c.query("select app.m9_record_archived_line_link($1::jsonb)", [
    {
      protocol: "m9-archived-line-link-1",
      project_id: "zsezjtswqeijboezvado",
      request_id: uuid(81),
      archive_sha256: src,
      document_key: first.key,
      line_index: 0,
      expected_archive_payload_hash: archiveHash,
      expected_document: first,
      expected_registered_line: source.registered_line,
      expected_managed_row: cat.managed_row,
      expected_current_row: cat.current_row,
      expected_revision: 0,
      action: "BIND",
      revokes_request_id: null,
      variant_id: managed.variant_id,
      evidence_sha256: "c".repeat(64),
      reason: "EXACT_LITERAL_SICAR_CODE_DOCUMENTARY_ONLY",
    },
  ]);

  const baseline = await audit();
  await c.query("set local role authenticated");
  const read = async () =>
    (
      await query("select public.m9_delivery_capture_read($1::jsonb)v", [
        { document: allDocs[1].key },
      ])
    )[0].v;
  const view = await read(),
    doc = view.rows[0];
  assert.equal(view.responses_enabled, true);
  assert.equal(view.summary.pending_documentary_reviews, 10);
  const plan = (n, choice = "UNKNOWN", revision = 0, document = doc) => ({
    protocol: "m9-delivery-capture-request-1",
    request_id: uuid(n),
    archive_sha256: src,
    document_key: document.document_key,
    expected_archive_payload_hash:
      document.capture_context.archive_payload_hash,
    expected_document_snapshot_hash:
      document.capture_context.document_snapshot_hash,
    expected_revision: revision,
    action: "OBSERVE",
    choice,
    revokes_request_id: null,
    confirmed: true,
  });
  const write = async (p) =>
    (
      await query("select public.m9_delivery_capture_write($1::jsonb)v", [
        JSON.stringify(p),
      ])
    )[0].v;
  const input = plan(100),
    one = await write(input),
    replay = await write(input);
  assert.equal(one.revision, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, 1);
  assert.equal(one.document_snapshot_hash, replay.document_snapshot_hash);
  for (const p of [
    null,
    [],
    { ...input, confirmed: false },
    { ...input, expected_revision: "0" },
    { ...input, request_id: "bad" },
    { ...input, choice: null },
    { ...input, choice: "MIXED" },
    { ...input, action: "DELETE" },
    { ...input, extra: "untrusted" },
  ])
    await reject(
      "select public.m9_delivery_capture_write($1::jsonb)",
      [JSON.stringify(p)],
      "DELIVERY_CAPTURE_",
    );
  await reject(
    "select public.m9_delivery_capture_write($1::jsonb)",
    [JSON.stringify({ ...input, choice: "ALL_PENDING" })],
    "DELIVERY_IDEMPOTENCY_CONFLICT",
  );
  await reject(
    "select public.m9_delivery_capture_write($1::jsonb)",
    [JSON.stringify(plan(101, "ALL_PENDING", 0))],
    "DELIVERY_REVISION_CHANGED",
  );
  for (const field of [
    "expected_archive_payload_hash",
    "expected_document_snapshot_hash",
  ])
    await reject(
      "select public.m9_delivery_capture_write($1::jsonb)",
      [JSON.stringify({ ...plan(102), [field]: "f".repeat(64) })],
      "DELIVERY_CAPTURE_CONTEXT_CHANGED",
    );
  const genericView = (
    await query("select public.m9_delivery_capture_read($1::jsonb)v", [
      { document: first.key },
    ])
  )[0].v;
  for (const choice of ["ALL_PENDING", "ALL_DELIVERED", "PARTIAL_REVIEW"])
    await reject(
      "select public.m9_delivery_capture_write($1::jsonb)",
      [JSON.stringify(plan(103, choice, 0, genericView.rows[0]))],
      "DELIVERY_CAPTURE_PHYSICAL_SCOPE_UNKNOWN",
    );
  const mixed = await write(plan(104, "PARTIAL_REVIEW", 1));
  assert.equal(mixed.revision, 2);
  assert.equal((await read()).summary.pending_documentary_reviews, 10);
  const all = await write(plan(105, "ALL_DELIVERED", 2));
  assert.equal(all.revision, 3);
  assert.equal((await read()).summary.concrete_documentary_reviews, 1);
  assert.equal((await read()).summary.pending_documentary_reviews, 9);
  const undo = {
    ...plan(106, null, 3),
    action: "REVOKE",
    revokes_request_id: all.request_id,
  };
  const revoked = await write(undo);
  assert.equal(revoked.revision, 4);
  assert.equal((await write(undo)).replayed, true);
  assert.equal((await read()).rows[0].capture_context.status, "REVOKED");
  assert.equal((await read()).summary.pending_documentary_reviews, 10);
  // A historical replay remains a receipt; it never restores the revoked answer.
  assert.equal(
    (await write(plan(105, "ALL_DELIVERED", 2))).historical_receipt_only,
    true,
  );
  assert.equal((await read()).rows[0].capture_context.status, "REVOKED");
  await reject(
    "select public.m9_delivery_capture_write($1::jsonb)",
    [
      JSON.stringify({
        ...plan(107, null, 4),
        action: "REVOKE",
        revokes_request_id: input.request_id,
      }),
    ],
    "DELIVERY_REVOKE_NOT_CURRENT",
  );
  const pending = await write(plan(108, "ALL_PENDING", 4));
  assert.equal(pending.revision, 5);
  assert.equal((await read()).summary.concrete_documentary_reviews, 1);
  const unknown = await write(plan(109, "UNKNOWN", 5));
  assert.equal(unknown.revision, 6);
  assert.equal((await read()).summary.pending_documentary_reviews, 10);
  for (const sql of [
    "select * from app.m9_delivery_observations",
    "select app.m9_record_delivery_observation('{}'::jsonb)",
    "select app.m9_delivery_document_snapshot('a','b')",
    "select app.m9_delivery_capture_context('a','b')",
  ]) {
    await reject(sql, [], "permission denied");
    acl++;
  }
  await c.query("reset role");
  const events = await query(
    "select * from app.m9_delivery_observations where archive_sha256=$1 order by revision",
    [src],
  );
  assert.equal(events.length, 6);
  assert.equal(events[0].observation.reviewer_ref, admin.id);
  assert.equal(
    events[0].observation.evidence_sha256,
    allDocs[1].evidence_sha256,
  );
  for (const line of events[1].observation.lines) {
    assert.equal(line.status, "UNKNOWN");
    assert.equal(line.delivered_qty, null);
    assert.equal(line.pending_qty, null);
  }

  await c.query("savepoint queue_cases");
  await c.query("set local role authenticated");
  const captureRead = async (p) =>
    (await query("select public.m9_delivery_capture_read($1::jsonb)v", [p]))[0]
      .v;
  const d2 = (await captureRead({ document: allDocs[2].key })).rows[0],
    d8 = (await captureRead({ document: allDocs[8].key })).rows[0];
  await write(plan(120, "ALL_PENDING", 0, d2));
  await write(plan(121, "PARTIAL_REVIEW", 0, d8));
  const pq1 = await captureRead({ review_filter: "pending", page: 1 }),
    pq2 = await captureRead({ review_filter: "pending", page: 2 });
  assert.equal(pq1.total, 9);
  assert.equal(pq1.rows.length, 8);
  assert.equal(pq2.rows.length, 1);
  assert.equal(pq2.pages, 2);
  const pendingKeys = [...pq1.rows, ...pq2.rows].map((d) => d.document_key);
  assert.equal(new Set(pendingKeys).size, 9);
  assert.ok(!pendingKeys.includes(d2.document_key));
  assert.ok(pendingKeys.includes(d8.document_key));
  assert.ok(pendingKeys.includes(doc.document_key));
  assert.equal((await captureRead({ review_filter: "concrete" })).total, 1);
  const d7 = (await captureRead({ document: allDocs[7].key })).rows[0];
  await write(plan(122, "ALL_DELIVERED", 0, d7));
  const pq3 = await captureRead({ review_filter: "pending", page: 2 });
  assert.equal(pq3.total, 8);
  assert.equal(pq3.page, 1);
  assert.equal(pq3.pages, 1);
  assert.equal(pq3.rows.length, 8);
  assert.equal(
    (await captureRead({ document: d7.document_key })).rows[0].capture_context
      .revision,
    1,
  );
  for (const review_filter of [null, "bad", 1])
    await reject(
      "select public.m9_delivery_capture_read($1::jsonb)",
      [JSON.stringify({ review_filter })],
      "DELIVERY_CAPTURE_QUERY_INVALID",
    );
  await c.query("rollback to savepoint queue_cases");
  await c.query("release savepoint queue_cases");
  await c.query("savepoint renewed_cut");
  await c.query("select app.m9_archive_credit_details($1::jsonb)", [
    {
      ...archive,
      source_plan_sha256: "9".repeat(64),
      source_until: (
        await query("select clock_timestamp()stamp")
      )[0].stamp.toISOString(),
    },
  ]);
  await c.query("set local role authenticated");
  await reject(
    "select public.m9_delivery_capture_write($1::jsonb)",
    [JSON.stringify(plan(123, "UNKNOWN", 6))],
    "DELIVERY_CAPTURE_ARCHIVE_NOT_CURRENT",
  );
  await c.query("rollback to savepoint renewed_cut");
  await c.query("release savepoint renewed_cut");
  // Simulate privileged corruption only inside a savepoint; immutable source ACL
  // and trigger remain intact after rollback. Hash validation must still fail.
  await c.query("savepoint corrupt_archive");
  await c.query(
    "alter table app.m9_credit_detail_archives disable trigger m9_credit_detail_immutable",
  );
  await c.query(
    "update app.m9_credit_detail_archives set payload=jsonb_set(payload,'{accounts,0,documents,1,lines,0,description}',to_jsonb('SYNTHETIC CORRUPTED'::text))where source_plan_sha256=$1",
    [src],
  );
  await c.query("set local role authenticated");
  await reject(
    "select public.m9_delivery_capture_write($1::jsonb)",
    [JSON.stringify(plan(124, "UNKNOWN", 6))],
    "DELIVERY_ARCHIVE_CHANGED",
  );
  await c.query("rollback to savepoint corrupt_archive");
  await c.query("release savepoint corrupt_archive");
  const after = await audit();
  assert.deepEqual(
    after.filter((t) => t.name !== "app.m9_delivery_observations"),
    baseline.filter((t) => t.name !== "app.m9_delivery_observations"),
  );
  await c.query("savepoint other_actor");
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
    other.id,
  ]);
  await c.query("set local role authenticated");
  await reject(
    "select public.m9_delivery_capture_write($1::jsonb)",
    [JSON.stringify(input)],
    "DELIVERY_IDEMPOTENCY_CONFLICT",
  );
  await c.query("rollback to savepoint other_actor");
  await c.query("release savepoint other_actor");
  await c.query("savepoint nonadmin_capture");
  await c.query("update public.app_users set role_id=$1 where id=$2", [
    other.role_id,
    other.id,
  ]);
  await c.query(
    "insert into public.role_permissions(role_id,permission_code)values($1,'customers.manage')on conflict do nothing",
    [other.role_id],
  );
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
    other.id,
  ]);
  await c.query("set local role authenticated");
  for (const fn of ["m9_delivery_capture_read", "m9_delivery_capture_write"])
    await reject(`select public.${fn}('{}'::jsonb)`, [], "NOT_AUTHORIZED");
  await c.query("rollback to savepoint nonadmin_capture");
  await c.query("release savepoint nonadmin_capture");
  for (const [setup, pattern] of [
    [
      "update public.app_users set is_active=false where id='" + admin.id + "'",
      "NOT_AUTHORIZED",
    ],
    [
      "delete from public.role_permissions where role_id='" +
        admin.role_id +
        "'and permission_code='customers.manage'",
      "NOT_AUTHORIZED",
    ],
    [
      "update app.sicar_sync_control set catalog_writes_enabled=false where singleton",
      "SICAR_CATALOG_SYNC_DISABLED",
    ],
  ]) {
    await c.query("savepoint guard");
    await c.query(setup);
    await c.query("set local role authenticated");
    for (const fn of ["m9_delivery_capture_read", "m9_delivery_capture_write"])
      await reject(`select public.${fn}('{}'::jsonb)`, [], pattern);
    await c.query("rollback to savepoint guard");
    await c.query("release savepoint guard");
  }
  await c.query("savepoint absent_actor");
  await c.query("select set_config('request.jwt.claim.sub','',true)");
  await c.query("set local role authenticated");
  await reject(
    "select public.m9_delivery_capture_write('{}'::jsonb)",
    [],
    "NOT_AUTHORIZED",
  );
  await c.query("rollback to savepoint absent_actor");
  await c.query("release savepoint absent_actor");
  for (const role of ["anon", "service_role"]) {
    await c.query("set local role " + role);
    for (const fn of [
      "m9_delivery_capture_read",
      "m9_delivery_capture_write",
    ]) {
      await reject(`select public.${fn}('{}'::jsonb)`, [], "permission denied");
      acl++;
    }
    await c.query("reset role");
  }
  // Old maintenance immutable protections are not weakened by the new API.
  await reject(
    "update app.m9_delivery_observations set observation='{}' where archive_sha256=$1",
    [src],
    "IMMUTABLE|immutable",
  );
  await c.query("rollback");
  assert.deepEqual(await audit(), before);
  const result = {
    protocol: "m9-delivery-capture-local-qa-1",
    synthetic_only: true,
    auth_storage_stubs: true,
    remote_operations: 0,
    negative_cases: negatives,
    acl_rejections: acl,
    events_appended_then_rolled_back: 6,
    only_journal_changed: true,
    all_other_tables_unchanged: baseline.length - 1,
    tables_unchanged_after_rollback: before.length,
    pagination_filtered_before_page: true,
    renewed_cut_rejected: true,
    corrupted_source_rejected: true,
    idempotent_replay: true,
    undo_append: true,
    partial_quantities_unknown: true,
    generic_physical_assertions_rejected: true,
    source_status_unchanged: true,
    stock_cash_finance_effects: 0,
  };
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  console.log(JSON.stringify(result));
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
