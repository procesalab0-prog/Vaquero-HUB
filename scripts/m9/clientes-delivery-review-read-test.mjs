import pg from "pg";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { digest } from "./acceleration.mjs";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/qa_m9_revision_block4_20261022"
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
    stamp = new Date(Date.now() - 60000).toISOString(),
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
  const beforeReads = await audit();
  await c.query("set local role authenticated");
  const read = async (p) =>
    (await query("select public.m9_delivery_review_read($1::jsonb)v", [p]))[0]
      .v;
  const one = await read({ page: 1 }),
    two = await read({ page: 2 });
  assert.equal(one.rows.length, 8);
  assert.equal(two.rows.length, 2);
  assert.equal(one.total, 10);
  assert.equal(one.pages, 2);
  assert.equal(
    new Set([...one.rows, ...two.rows].map((d) => d.document_key)).size,
    10,
  );
  assert.deepEqual((await read({ page: 1 })).rows, one.rows);
  assert.deepEqual(one.summary, {
    documents: 10,
    lines: 11,
    unknown_documents: 10,
    unknown_lines: 11,
    raw_mapped_lines: 1,
    raw_unmapped_lines: 10,
    live_documentary_links: 1,
    effective_documentary_identities: 2,
    observed_documents: 0,
  });
  const duplicate = await read({ q: "SYNTHETIC SAME FOLIO" });
  assert.equal(duplicate.rows.length, 2);
  assert.notEqual(
    duplicate.rows[0].document_key,
    duplicate.rows[1].document_key,
  );
  assert.notEqual(duplicate.rows[0].client_ref, duplicate.rows[1].client_ref);
  const focused = await read({ document: first.key });
  assert.equal(focused.total, 1);
  assert.equal(focused.rows[0].document_key, first.key);
  assert.equal(focused.rows[0].lines[0].identity_kind, "SIDECAR");
  assert.equal(focused.rows[0].lines[1].generic_debt, true);
  assert.equal(focused.rows[0].lines[1].identity_kind, "UNRESOLVED");
  assert.equal((await read({ filter: "sidecar" })).total, 1);
  assert.equal((await read({ filter: "identity" })).total, 9);
  assert.equal((await read({ page: 999999 })).page, 2);
  assert.equal((await read({ q: "ABSENT" })).rows.length, 0);
  const literal = await read({ q: "00000042" });
  assert.equal(literal.total, 1);
  assert.equal(literal.rows[0].lines[0].barcode, "00000042");
  assert.equal((await read({ filter: "unknown" })).total, 10);
  for (const p of [
    null,
    [],
    { page: 0 },
    { page: 1.1 },
    { page: "1" },
    { page: 1000000 },
    { q: null },
    { q: "a".repeat(101) },
    { filter: "saved" },
    { document: "bad" },
    { action: "SAVE" },
  ])
    await reject(
      "select public.m9_delivery_review_read($1::jsonb)",
      [JSON.stringify(p)],
      "DELIVERY_REVIEW_QUERY_INVALID",
    );
  for (const sql of [
    "select * from app.m9_delivery_observations",
    "select * from app.m9_archived_line_links",
    "select app.m9_record_delivery_observation('{}'::jsonb)",
    "select app.m9_record_archived_line_link('{}'::jsonb)",
  ]) {
    await reject(sql, [], "permission denied");
    acl++;
  }
  await c.query("reset role");
  // Having customers.manage without the ADMIN role never widens the reader.
  await c.query("savepoint nonadmin");
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
  await reject(
    "select public.m9_delivery_review_read('{}'::jsonb)",
    [],
    "NOT_AUTHORIZED",
  );
  await c.query("rollback to savepoint nonadmin");
  await c.query("release savepoint nonadmin");
  await c.query("savepoint inactive");
  await c.query("update public.app_users set is_active=false where id=$1", [
    admin.id,
  ]);
  await c.query("set local role authenticated");
  await reject(
    "select public.m9_delivery_review_read('{}'::jsonb)",
    [],
    "NOT_AUTHORIZED",
  );
  await c.query("rollback to savepoint inactive");
  await c.query("release savepoint inactive");
  await c.query("savepoint no_permission");
  await c.query(
    "delete from public.role_permissions where role_id=$1 and permission_code='customers.manage'",
    [admin.role_id],
  );
  await c.query("set local role authenticated");
  await reject(
    "select public.m9_delivery_review_read('{}'::jsonb)",
    [],
    "NOT_AUTHORIZED",
  );
  await c.query("rollback to savepoint no_permission");
  await c.query("release savepoint no_permission");
  await c.query("savepoint disabled");
  await c.query(
    "update app.sicar_sync_control set catalog_writes_enabled=false where singleton",
  );
  await c.query("set local role authenticated");
  await reject(
    "select public.m9_delivery_review_read('{}'::jsonb)",
    [],
    "SICAR_CATALOG_SYNC_DISABLED",
  );
  await c.query("rollback to savepoint disabled");
  await c.query("release savepoint disabled");
  await c.query("savepoint no_actor");
  await c.query("select set_config('request.jwt.claim.sub','',true)");
  await c.query("set local role authenticated");
  await reject(
    "select public.m9_delivery_review_read('{}'::jsonb)",
    [],
    "NOT_AUTHORIZED",
  );
  await c.query("rollback to savepoint no_actor");
  await c.query("release savepoint no_actor");
  for (const role of ["anon", "service_role"]) {
    await c.query("savepoint acl_role");
    await c.query(`set local role ${role}`);
    await reject(
      "select public.m9_delivery_review_read('{}'::jsonb)",
      [],
      "permission denied",
    );
    acl++;
    await c.query("rollback to savepoint acl_role");
    await c.query("release savepoint acl_role");
  }
  assert.deepEqual(await audit(), beforeReads);
  assert.deepEqual(
    (
      await query(
        "select payload from app.m9_credit_detail_archives where source_plan_sha256=$1",
        [src],
      )
    )[0].payload,
    archive,
  );
  await c.query("rollback");
  assert.deepEqual(await audit(), before);
  const report = {
    protocol: "m9-delivery-review-read-local-qa-1",
    synthetic_only: true,
    auth_storage_stubs: true,
    remote_operations: 0,
    documents: 10,
    lines: 11,
    page_sizes: [8, 2],
    distinct_documents_across_pages: 10,
    duplicate_names_folios_preserved: true,
    raw_identity_and_live_sidecar_separate: true,
    delivery_unknown_preserved: true,
    negative_cases: negatives,
    acl_rejections: acl,
    tables_unchanged_during_reads: beforeReads.length,
    tables_unchanged_after_rollback: before.length,
    writers_remain_private: true,
    responses_enabled: false,
    stock_cash_finance_effects: 0,
  };
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  console.log(JSON.stringify(report));
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
