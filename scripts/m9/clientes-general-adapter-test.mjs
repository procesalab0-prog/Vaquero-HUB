/** PostgreSQL local acceptance only. Synthetic fixtures, outer ROLLBACK.
 * The coordinator alone applies the forward SQL remotely. */
import pg from "pg";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { digest } from "./acceleration.mjs";
const u = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
  u.pathname !== "/qa_m9_clientes_block2_20261022"
)
  throw Error("OWN_LOCAL_CLIENTES_DB_REQUIRED");
const c = new pg.Client({ connectionString: u.href });
await c.connect();
const methods = [
  "app.m9_general_registration_snapshot()",
  "app.m9_register_general_customer_archive(jsonb)",
  "app.m9_retire_general_customer_registration(uuid,uuid,text)",
  "app.m9_general_registration_guard()",
];
const snapshot = async () =>
  (await c.query("select app.m9_general_registration_snapshot() as value"))
    .rows[0].value;
async function fullAudit() {
  const tables = (
    await c.query(
      "select schemaname,tablename from pg_tables where schemaname in('app','public') order by schemaname,tablename",
    )
  ).rows;
  const result = [];
  for (const t of tables) {
    const id = [t.schemaname, t.tablename]
      .map((x) => '"' + x.replaceAll('"', '""') + '"')
      .join(".");
    const r = (
      await c.query(
        `select count(*)::int rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) md5 from ${id} t`,
      )
    ).rows[0];
    result.push({ name: t.schemaname + "." + t.tablename, ...r });
  }
  return result;
}
let negatives = 0,
  acl = 0;
async function rejects(sql, params, expected) {
  await c.query("savepoint rejection");
  let error;
  try {
    await c.query(sql, params);
  } catch (e) {
    error = e;
  }
  await c.query("rollback to savepoint rejection");
  await c.query("release savepoint rejection");
  assert.ok(error, "Expected rejection " + expected);
  assert.match(error.message, new RegExp(expected));
  negatives++;
}
const uuid = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
function account(n, balance, paid, cancelled = false) {
  const ref = uuid(n),
    name = "SYNTHETIC GENERAL QA " + n,
    folio = "VSM9900" + n,
    key = digest({ tenant: "VSM", client_ref: ref, folio }),
    payments = paid
      ? [
          {
            key: digest({ tenant: "VSM", source_ref: "Abono 9900" + n }),
            ref: "Abono 9900" + n,
            occurred_label: "10/22/2026 01:00:00 PM",
            amount_cents: paid,
            cancelled: false,
            evidence_sha256: "b".repeat(64),
          },
        ]
      : [];
  if (cancelled)
    payments.push({
      key: digest({ tenant: "VSM", source_ref: "Abono 9910" + n }),
      ref: "Abono 9910" + n,
      occurred_label: "10/22/2026 01:01:00 PM",
      amount_cents: 200,
      cancelled: true,
      evidence_sha256: "c".repeat(64),
    });
  return {
    key: digest({ tenant: "VSM", client_ref: ref }),
    ref,
    name,
    source_at: "2026-10-22T18:00:00.000Z",
    balance_cents: balance,
    documents: [
      {
        key,
        folio,
        source_id: String(n).padStart(24, "a"),
        source_at: "2026-10-22T18:00:00.000Z",
        historical_name: name,
        total_cents: balance + paid,
        balance_cents: balance,
        paid_cents: paid,
        due_date: balance ? "2026-11-22" : null,
        holds: [],
        linked_history_complete: paid > 0,
        evidence_sha256: "a".repeat(64),
        payments,
        lines: [
          {
            index: 0,
            barcode: "SX00000",
            quantity: "1",
            description: "SYNTHETIC DEBE MERCANCIA",
            variant_id: null,
            holds: ["DELIVERY_NOT_OBSERVED", "LEGACY_GENERIC_DEBT_LINE"],
            delivery_status: "UNKNOWN",
            reserved_qty: null,
            stock_deduction: null,
          },
        ],
      },
    ],
  };
}
const request = uuid(90),
  retirement = uuid(91),
  archiveSha = "e".repeat(64),
  batchSha = "d".repeat(64);
try {
  const control = (
    await c.query(
      "select configured_by from app.sicar_sync_control where singleton",
    )
  ).rows[0];
  assert.equal(control?.configured_by, "SYNTHETIC LOCAL QA ONLY");
  // Local-only function replacement permits iteration before the coordinator
  // creates the first immutable forward migration; no applied remote SQL is edited.
  if (process.env.QA_REPLACE_FUNCTIONS === "1") {
    const text = readFileSync(
      new URL("./clientes-general-adapter.sql", import.meta.url),
      "utf8",
    );
    for (const sql of text.matchAll(/create function app\.[\s\S]+?end \$\$;/g))
      await c.query(
        sql[0].replace("create function", "create or replace function"),
      );
  }
  const admin = (
    await c.query(
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN' and u.is_active order by u.id limit 1",
    )
  ).rows[0].id;
  const before = await fullAudit();
  await c.query("begin");
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [admin]);
  const A = account(71, 700, 300, true),
    B = account(72, 700, 300, true),
    C = account(73, 0, 1000),
    D = account(74, 500, 0);
  const archive = {
    protocol: "m9-credit-detail-archive-1",
    source_plan_sha256: archiveSha,
    source_from: "2026-10-22T18:00:00.000Z",
    source_until: "2026-10-22T18:00:00.000Z",
    operational_import_allowed: false,
    accounts: [A, B, C, D],
  };
  await c.query("select app.m9_archive_credit_details($1::jsonb)", [archive]);
  const hash = (
    await c.query(
      "select payload_hash from app.m9_credit_detail_archives where source_plan_sha256=$1",
      [archiveSha],
    )
  ).rows[0].payload_hash;
  const a = A.documents[0];
  await c.query(
    "insert into app.m9_customer_batches(plan_sha256,payload_hash,source_scope,source_at,actor_user_id,receipt) values($1,$1,'SYNTHETIC_QA_NOT_SICAR',now(),$2,'{}')",
    [batchSha, admin],
  );
  const cp = { source_display_name: A.name, phone_candidate: null };
  await c.query(
    "insert into app.m9_customer_sources(customer_key,source_ref,batch_sha256,payload,used_cents) values($1,$2,$3,$4,700)",
    [A.key, A.ref, batchSha, cp],
  );
  await c.query(
    "insert into app.m9_credit_documents(document_key,customer_key,payload,source_folio,total_cents,balance_cents,paid_cents,due_date,financial_status) values($1,$2,$3,$4,1000,700,300,'2026-11-22','OPEN')",
    [a.key, A.key, { source_document_id: a.source_id }, a.folio],
  );
  for (const p of a.payments)
    await c.query(
      "insert into app.m9_credit_source_payments values($1,$2,$3,$4,$5,$6)",
      [p.key, a.key, p.ref, p.amount_cents, p.cancelled, p],
    );
  const rid = (
    await c.query(
      "insert into app.m9_legacy_registry(customer_key,batch_sha256,source_hash,created_by) values($1,$2,$3,$4) returning id",
      [A.key, batchSha, "a".repeat(64), admin],
    )
  ).rows[0].id;
  await c.query(
    "insert into app.m9_legacy_finance_events(id,kind,actor_user_id,request_hash,receipt) values($1,'OPEN',$2,$3,'{}')",
    [uuid(92), admin, "a".repeat(64)],
  );
  await c.query(
    "insert into app.m9_legacy_finance_ledger(registry_id,document_key,opening_event,request_id,kind,amount_cents,due_date,actor_user_id) values($1,$2,$3,$3,'OPEN',700,'2026-11-22',$4)",
    [rid, a.key, uuid(92), admin],
  );
  const p = {
    protocol: "m9-general-customer-registration-1",
    project_id: "zsezjtswqeijboezvado",
    request_id: request,
    archive_sha256: archiveSha,
    archive_payload_hash: hash,
    expected_snapshot: await snapshot(),
    expected_additions: {
      accounts: 2,
      documents: 2,
      payments: 2,
      lines: 2,
      balance_cents: 1200,
    },
    operational_import_allowed: false,
  };
  for (const [, change, error] of [
    [
      "production",
      (x) => (x.project_id = "drubkjlmfbdeglucakmg"),
      "GENERAL_PLAN_INVALID",
    ],
    [
      "operational",
      (x) => (x.operational_import_allowed = true),
      "GENERAL_PLAN_INVALID",
    ],
    ["extra", (x) => (x.import_stock = true), "GENERAL_PLAN_INVALID"],
    ["bad_uuid", (x) => (x.request_id = "bad"), "GENERAL_PLAN_INVALID"],
    [
      "archive_hash",
      (x) => (x.archive_payload_hash = "0".repeat(64)),
      "GENERAL_ARCHIVE_CHANGED",
    ],
    [
      "snapshot",
      (x) => (x.expected_snapshot = []),
      "GENERAL_DESTINATION_SNAPSHOT_CHANGED",
    ],
    [
      "count",
      (x) => x.expected_additions.accounts++,
      "GENERAL_ADDITION_COUNTS_DIFFER",
    ],
    [
      "amount",
      (x) => x.expected_additions.balance_cents++,
      "GENERAL_ADDITION_COUNTS_DIFFER",
    ],
    [
      "count_string",
      (x) => (x.expected_additions.accounts = "2"),
      "GENERAL_ADDITION_COUNTS_DIFFER",
    ],
  ]) {
    const bad = structuredClone(p);
    change(bad);
    await rejects(
      "select app.m9_register_general_customer_archive($1)",
      [bad],
      error,
    );
  }
  for (const role of ["anon", "authenticated", "service_role"])
    for (const method of methods) {
      assert.equal(
        (
          await c.query("select has_function_privilege($1,$2,'execute') ok", [
            role,
            method,
          ])
        ).rows[0].ok,
        false,
      );
      acl++;
    }
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal(
      (
        await c.query(
          "select has_table_privilege($1,'app.m9_general_customer_registrations','select') ok",
          [role],
        )
      ).rows[0].ok,
      false,
    );
    acl++;
  }
  await c.query("savepoint bad_actor");
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
    uuid(99),
  ]);
  await rejects(
    "select app.m9_register_general_customer_archive($1)",
    [p],
    "NOT_AUTHORIZED",
  );
  await c.query("rollback to savepoint bad_actor");
  await c.query("savepoint injected");
  await c.query(
    "create function pg_temp.fail_general_registration()returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_FAILURE_AFTER_SOURCE_INSERTS';end$$;create trigger qa_fail_general before insert on app.m9_general_customer_registrations for each row execute function pg_temp.fail_general_registration();",
  );
  const pre = await snapshot();
  await rejects(
    "select app.m9_register_general_customer_archive($1)",
    [p],
    "SYNTHETIC_FAILURE_AFTER_SOURCE_INSERTS",
  );
  assert.deepEqual(await snapshot(), pre);
  await c.query("rollback to savepoint injected");
  const call = async () =>
    (
      await c.query(
        "select app.m9_register_general_customer_archive($1) result",
        [p],
      )
    ).rows[0].result;
  const r = await call(),
    after = await snapshot(),
    again = await call();
  assert.deepEqual(r.added, p.expected_additions);
  assert.equal(r.preserved_accounts, 1);
  assert.equal(r.paid_documents_archived_only, 1);
  assert.equal(r.debt_opened_cents, 0);
  assert.equal(again.replayed, true);
  assert.deepEqual(await snapshot(), after);
  const n = { ...p, request_id: uuid(93) };
  await rejects(
    "select app.m9_register_general_customer_archive($1)",
    [n],
    "GENERAL_ARCHIVE_ALREADY_REGISTERED",
  );
  await rejects(
    "select app.m9_register_general_customer_archive($1)",
    [{ ...p, expected_additions: { ...p.expected_additions, accounts: 3 } }],
    "GENERAL_IDEMPOTENCY_CONFLICT",
  );
  for (const [table, where] of [
    ["m9_customer_sources", "batch_sha256"],
    ["m9_customer_batches", "plan_sha256"],
  ])
    await rejects(
      `delete from app.${table} where ${where}=$1`,
      [archiveSha],
      "GENERAL_ARCHIVED_SOURCE_IMMUTABLE",
    );
  await rejects(
    "update app.m9_credit_documents set balance_cents=balance_cents where document_key=$1",
    [B.documents[0].key],
    "GENERAL_ARCHIVED_SOURCE_IMMUTABLE",
  );
  await rejects(
    "update app.m9_credit_source_payments set cancelled=not cancelled where document_key=$1",
    [B.documents[0].key],
    "GENERAL_ARCHIVED_SOURCE_IMMUTABLE",
  );
  await rejects(
    "update app.m9_credit_source_lines set quantity=2 where document_key=$1",
    [B.documents[0].key],
    "GENERAL_ARCHIVED_SOURCE_IMMUTABLE",
  );
  const newR = (
    await c.query(
      "select id from app.m9_legacy_registry where customer_key=$1",
      [B.key],
    )
  ).rows[0].id;
  await rejects(
    "insert into app.m9_legacy_finance_ledger(registry_id,document_key,opening_event,request_id,kind,amount_cents,actor_user_id)values($1,$2,$3,$3,'OPEN',700,$4)",
    [newR, B.documents[0].key, uuid(92), admin],
    "GENERAL_ARCHIVE_FINANCE_DISABLED",
  );
  await rejects(
    "insert into public.customer_credit_ledger(customer_id,entry_type,amount_cents,actor_user_id,reference_type,reference_id)values(null,'CHARGE',700,$1,'LEGACY_SICAR_OPENING',$2)",
    [admin, B.documents[0].key],
    "GENERAL_ARCHIVE_FINANCE_DISABLED",
  );
  await rejects(
    "select app.m9_open_legacy_finance($1,$2,'467765fe-d18e-43bb-be68-326adbf05ce1',app.m9_legacy_finance_plan($2))",
    [uuid(94), archiveSha],
    "M9_SOURCE_CUT_STALE",
  );
  await rejects(
    "update app.m9_general_customer_registrations set receipt='{}' where request_id=$1",
    [request],
    "M9_LEGACY_EVENT_IMMUTABLE",
  );
  await rejects(
    "delete from app.m9_general_customer_registrations where request_id=$1",
    [request],
    "M9_LEGACY_EVENT_IMMUTABLE",
  );
  const facts = (
    await c.query(
      "select count(*)::int rows,bool_and(payload->'privacy_consent_at'='null'::jsonb and payload->'auth_user_id'='null'::jsonb and target_customer_id is null) no_fabricated_identity from app.m9_customer_sources where batch_sha256=$1",
      [archiveSha],
    )
  ).rows[0];
  assert.equal(facts.rows, 2);
  assert.equal(facts.no_fabricated_identity, true);
  const retired = (
    await c.query(
      "select app.m9_retire_general_customer_registration($1,$2,'SYNTHETIC QA retirement, no operating debt') result",
      [retirement, request],
    )
  ).rows[0].result;
  assert.equal(retired.physical_rows_deleted, 0);
  assert.deepEqual(await snapshot(), after);
  assert.equal(
    (
      await c.query(
        "select app.m9_retire_general_customer_registration($1,$2,'SYNTHETIC QA retirement, no operating debt') result",
        [retirement, request],
      )
    ).rows[0].result.replayed,
    true,
  );
  await rejects(
    "select app.m9_register_general_customer_archive($1)",
    [p],
    "GENERAL_REGISTRATION_RETIRED",
  );
  await c.query("rollback");
  const final = await fullAudit();
  assert.deepEqual(final, before);
  const result = {
    mode: "LOCAL_SQL_SYNTHETIC_ROLLBACK",
    project_remote_writes: 0,
    accounts_registered: 2,
    documents_registered: 2,
    existing_openings_preserved: 1,
    paid_documents_not_reopened: 1,
    negative_checks: negatives,
    acl_checks: acl,
    failure_after_source_inserts_rolled_back: true,
    replay_verified: true,
    logical_retirement_verified: true,
    all_business_tables_unchanged: before.length,
    auth_postgrest_acceptance: false,
  };
  if (process.env.QA_OUTPUT_DIR)
    writeFileSync(
      resolve(process.env.QA_OUTPUT_DIR, "ensayo-local.json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
  console.log(JSON.stringify(result));
} catch (e) {
  await c.query("rollback");
  throw e;
} finally {
  await c.end();
}
