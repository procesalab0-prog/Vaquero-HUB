// Synthetic committed history in a separate LOCAL clone. Never runs on staging.
import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { digest } from "./acceleration.mjs";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/qa_m9_entregas_race_20261022"
)
  throw Error("OWN_LOCAL_LINE_RACE_DB_REQUIRED");
const db = new pg.Client({ connectionString: url.href }),
  binder = new pg.Client({ connectionString: url.href }),
  writer = new pg.Client({ connectionString: url.href });
await Promise.all([db.connect(), binder.connect(), writer.connect()]);
const query = async (c, sql, args = []) => (await c.query(sql, args)).rows;
const fullAudit = async () => {
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
};
const waitForBlock = async (waiter, holder) => {
  for (let i = 0; i < 100; i++) {
    const blockers = (
      await query(db, "select pg_blocking_pids($1)pids", [waiter])
    )[0].pids;
    if (blockers.includes(holder)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("REAL_ROW_LOCK_CONTENTION_NOT_OBSERVED");
};
const results = [];
let cleanup;
try {
  assert.equal(
    (
      await query(
        db,
        "select configured_by from app.sicar_sync_control where singleton",
      )
    )[0]?.configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  for (const sql of readFileSync(
    new URL("./clientes-archive-line-link.sql", import.meta.url),
    "utf8",
  ).matchAll(/create function app\.[\s\S]+?\$\$;/g))
    await db.query(
      sql[0].replace("create function", "create or replace function"),
    );
  const admin = (
    await query(
      db,
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit 1",
    )
  )[0].id;
  for (const c of [db, binder, writer]) {
    await c.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await c.query("set statement_timeout='12s'");
  }
  const pid = {
    binder: (await query(binder, "select pg_backend_pid()pid"))[0].pid,
    writer: (await query(writer, "select pg_backend_pid()pid"))[0].pid,
  };
  assert.notEqual(pid.binder, pid.writer);
  const run = randomUUID(),
    prefix = "QA-LINE-LOCK-" + run,
    sourceSha = digest({ run, synthetic: true }),
    clientRef = randomUUID(),
    stamp = new Date(Date.now() - 300000).toISOString(),
    registration = randomUUID(),
    retirement = randomUUID();
  await db.query("begin");
  const cat = (
    await query(
      db,
      "select id,name from public.categories where name='SYNTHETIC QA race'",
    )
  )[0];
  assert.ok(cat);
  const fixtures = [];
  for (let i = 0; i < 2; i++) {
    const code = prefix + "-" + i,
      product = (
        await query(
          db,
          "insert into public.products(name,category_id,description)values($1,$2,'SYNTHETIC LOCAL LINE LOCK QA, never real merchandise')returning id",
          ["SYNTHETIC LOCAL ONLY " + code, cat.id],
        )
      )[0].id;
    const variant = (
      await query(
        db,
        "with n as(select nextval('app.variant_serial_seq')serial)insert into public.variants(product_id,sku,cost_cents,price_cents)select $1,serial::text||'-'||app.luhn_check_digit(serial::text),null,10000 from n returning id",
        [product],
      )
    )[0].id;
    await db.query(
      "insert into public.barcodes(variant_id,code,symbology,source,is_primary)values($1,$2,'LEGACY','SICAR',true)",
      [variant, code],
    );
    await db.query(
      "insert into public.m9_variant_details(variant_id,department,section,source_description)values($1,'SYNTHETIC QA',$2,'SYNTHETIC LOCAL QA LINE')",
      [variant, cat.name],
    );
    const current = (
      await query(db, "select app.m9_current_row($1)r", [variant])
    )[0].r;
    assert.ok(current);
    await db.query(
      "insert into app.m9_rows(barcode,variant_id,source_row,source_sha256)values($1,$2,$3,$4)",
      [code, variant, current, sourceSha],
    );
    const folio = "SYNTHETIC-LOCK-" + i + "-" + run,
      doc = {
        key: digest({ tenant: "VSM", client_ref: clientRef, folio }),
        folio,
        source_id: digest({ run, i }).slice(0, 24),
        source_at: stamp,
        historical_name: "SYNTHETIC LOCAL ROWLOCK QA",
        total_cents: 10000,
        balance_cents: 10000,
        paid_cents: 0,
        due_date: "2026-11-22",
        holds: [],
        linked_history_complete: false,
        evidence_sha256: digest({ run, i, kind: "synthetic-document" }),
        payments: [],
        lines: [
          {
            index: 0,
            barcode: code,
            quantity: "1",
            description: "SYNTHETIC LOCAL QA",
            variant_id: null,
            holds: ["DELIVERY_NOT_OBSERVED", "BARCODE_NOT_IN_STAGING"],
            delivery_status: "UNKNOWN",
            reserved_qty: null,
            stock_deduction: null,
          },
        ],
      };
    fixtures.push({
      code,
      product,
      variant,
      doc,
      request: randomUUID(),
      revoke: randomUUID(),
    });
  }
  const archive = {
    protocol: "m9-credit-detail-archive-1",
    source_plan_sha256: sourceSha,
    source_from: stamp,
    source_until: stamp,
    operational_import_allowed: false,
    accounts: [
      {
        key: digest({ tenant: "VSM", client_ref: clientRef }),
        ref: clientRef,
        name: "SYNTHETIC LOCAL ROWLOCK QA",
        source_at: stamp,
        balance_cents: 20000,
        documents: fixtures.map((f) => f.doc),
      },
    ],
  };
  await db.query("select app.m9_archive_credit_details($1::jsonb)", [archive]);
  const archiveHash = (
    await query(
      db,
      "select payload_hash from app.m9_credit_detail_archives where source_plan_sha256=$1",
      [sourceSha],
    )
  )[0].payload_hash;
  await db.query("select app.m9_register_general_customer_archive($1::jsonb)", [
    {
      protocol: "m9-general-customer-registration-1",
      project_id: "zsezjtswqeijboezvado",
      request_id: registration,
      archive_sha256: sourceSha,
      archive_payload_hash: archiveHash,
      expected_snapshot: (
        await query(db, "select app.m9_general_registration_snapshot()v")
      )[0].v,
      expected_additions: {
        accounts: 1,
        documents: 2,
        payments: 0,
        lines: 2,
        balance_cents: 20000,
      },
      operational_import_allowed: false,
    },
  ]);
  for (const f of fixtures) {
    const src = (
        await query(
          db,
          "select app.m9_archived_line_source_snapshot($1,$2,0)v",
          [sourceSha, f.doc.key],
        )
      )[0].v,
      cat = (
        await query(
          db,
          "select app.m9_archived_line_catalog_snapshot($1,$2)v",
          [f.code, f.variant],
        )
      )[0].v;
    f.payload = {
      protocol: "m9-archived-line-link-1",
      project_id: "zsezjtswqeijboezvado",
      request_id: f.request,
      archive_sha256: sourceSha,
      document_key: f.doc.key,
      line_index: 0,
      expected_archive_payload_hash: archiveHash,
      expected_document: f.doc,
      expected_registered_line: src.registered_line,
      expected_managed_row: cat.managed_row,
      expected_current_row: cat.current_row,
      expected_revision: 0,
      action: "BIND",
      revokes_request_id: null,
      variant_id: f.variant,
      evidence_sha256: digest({
        run,
        kind: "synthetic-link-review",
        code: f.code,
      }),
      reason: "EXACT_LITERAL_SICAR_CODE_DOCUMENTARY_ONLY",
    };
  }
  await db.query("commit");
  const before = await fullAudit(),
    read = async (f) =>
      (
        await query(db, "select app.m9_read_archived_line_link($1,$2,0)v", [
          sourceSha,
          f.doc.key,
        ])
      )[0].v;
  cleanup = async () => {
    await db.query("begin");
    await db.query(
      "update public.variants set is_active=false where id=any($1::uuid[])",
      [fixtures.map((f) => f.variant)],
    );
    await db.query(
      "update public.products set is_active=false,description=description||' · CANCELLED LOCAL QA COMPLETE' where id=any($1::uuid[])",
      [fixtures.map((f) => f.product)],
    );
    await db.query(
      "select app.m9_retire_general_customer_registration($1,$2,$3)",
      [
        retirement,
        registration,
        "SYNTHETIC LOCAL ROWLOCK QA COMPLETE; retained audit history, no real debt or stock",
      ],
    );
    await db.query("commit");
  };
  const first = fixtures[0];
  await writer.query("begin");
  assert.equal(
    (
      await query(
        writer,
        "select id from public.variants where id=$1 for update",
        [first.variant],
      )
    ).length,
    1,
  );
  await binder.query("begin");
  let settled = false;
  const waiting = query(
    binder,
    "select app.m9_record_archived_line_link($1::jsonb)v",
    [first.payload],
  )
    .then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    .finally(() => (settled = true));
  await waitForBlock(pid.binder, pid.writer);
  assert.equal(settled, false);
  await writer.query(
    "update public.variants set price_cents=price_cents+1 where id=$1",
    [first.variant],
  );
  await writer.query("commit");
  const one = await waiting;
  assert.equal(one.error?.message, "LINE_LINK_CATALOG_CHANGED_OR_AMBIGUOUS");
  await binder.query("rollback");
  assert.equal((await read(first)).status, "UNREVIEWED");
  results.push({
    order: "FOR_UPDATE_THEN_UPDATE_COMMIT_BEFORE_BIND",
    blocking_observed: true,
    writer_committed: true,
    binder_result: one.error.message,
    deadlock: false,
    no_stale_link_created: true,
  });
  const second = fixtures[1];
  await binder.query("begin");
  assert.equal(
    (
      await query(
        binder,
        "select app.m9_record_archived_line_link($1::jsonb)v",
        [second.payload],
      )
    )[0].v.action,
    "BIND",
  );
  await writer.query("begin");
  settled = false;
  const rowWait = query(
    writer,
    "select id from public.variants where id=$1 for update",
    [second.variant],
  )
    .then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    .finally(() => (settled = true));
  await waitForBlock(pid.writer, pid.binder);
  assert.equal(settled, false);
  await binder.query("commit");
  const two = await rowWait;
  if (two.error) throw two.error;
  assert.equal(two.value.length, 1);
  await writer.query(
    "update public.variants set price_cents=price_cents+1 where id=$1",
    [second.variant],
  );
  await writer.query("commit");
  assert.equal((await read(second)).status, "HELD_SOURCE_OR_CATALOG_CHANGED");
  const revoke = {
    ...second.payload,
    request_id: second.revoke,
    expected_revision: 1,
    action: "REVOKE",
    revokes_request_id: second.request,
    variant_id: null,
    expected_managed_row: null,
    expected_current_row: null,
    reason: "REVOKE_DOCUMENTARY_LINK_PRESERVE_HISTORY",
  };
  assert.equal(
    (
      await query(db, "select app.m9_record_archived_line_link($1::jsonb)v", [
        revoke,
      ])
    )[0].v.action,
    "REVOKE",
  );
  assert.equal((await read(second)).status, "REVOKED");
  results.push({
    order: "BIND_BEFORE_FOR_UPDATE_THEN_UPDATE_COMMIT",
    blocking_observed: true,
    binder_committed: true,
    writer_committed: true,
    after_writer_status: "HELD_SOURCE_OR_CATALOG_CHANGED",
    compensation_status: "REVOKED",
    deadlock: false,
  });
  assert.deepEqual(
    (
      await query(
        db,
        "select payload from app.m9_credit_detail_archives where source_plan_sha256=$1",
        [sourceSha],
      )
    )[0].payload,
    archive,
  );
  assert.equal(
    (
      await query(
        db,
        "select count(*)::int n from app.m9_credit_source_lines where document_key=any($1::text[])and(variant_id is not null or payload->>'delivery_status'<>'UNKNOWN')",
        [fixtures.map((f) => f.doc.key)],
      )
    )[0].n,
    0,
  );
  assert.equal(
    (
      await query(
        db,
        "select count(*)::int n from public.inventory_by_location where variant_id=any($1::uuid[])",
        [fixtures.map((f) => f.variant)],
      )
    )[0].n,
    0,
  );
  await cleanup();
  cleanup = null;
  const after = await fullAudit(),
    changed = after
      .filter((r, i) => r.md5 !== before[i].md5 || r.rows !== before[i].rows)
      .map((r) => r.name);
  const allowed = [
    "app.m9_archived_line_links",
    "app.m9_general_customer_registrations",
    "public.variants",
    "public.products",
    "public.audit_log",
  ];
  for (const name of changed)
    assert.ok(allowed.includes(name), "UNEXPECTED_TABLE_CHANGE:" + name);
  const report = {
    protocol: "m9-archive-line-lock-race-local-qa-1",
    synthetic_only: true,
    auth_storage_stubs: true,
    local_database: url.pathname.slice(1),
    run_id: run,
    races: results,
    history_preserved_no_truncate: true,
    fixtures_logically_retired: true,
    variants_products_inactive: true,
    raw_source_unchanged: true,
    source_delivery_status: "UNKNOWN",
    stock_finance_cash_effects: 0,
    changed_tables_after_fixture_baseline: changed,
    unchanged_tables_after_fixture_baseline: after.length - changed.length,
    scope_note:
      "Committed synthetic race history is intentionally retained in this separate local clone; the normal rollback suite remains separate.",
  };
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  console.log(JSON.stringify(report));
} finally {
  await Promise.allSettled([
    db.query("rollback"),
    binder.query("rollback"),
    writer.query("rollback"),
  ]);
  if (cleanup) await cleanup().catch(() => {});
  await Promise.all([db.end(), binder.end(), writer.end()]);
}
