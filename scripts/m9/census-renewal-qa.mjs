import pg from "pg";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { digest } from "./acceleration.mjs";
import { generalCustomerRenewal } from "./prepare-general-customers.mjs";
import { censusRenewalArchive } from "./archive-general-census.mjs";
const u = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
  u.port !== "59432" ||
  u.pathname !== "/qa_m9_docresponses_block5_20261022"
)
  throw Error("OWN_LOCAL_CENSUS_DB_REQUIRED");
const c = new pg.Client({ connectionString: u.href }),
  b = new pg.Client({ connectionString: u.href });
await Promise.all([c.connect(), b.connect()]);
const query = async (sql, args = []) => (await c.query(sql, args)).rows;
async function audit() {
  const ts = await query(
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
          `select count(*)::int rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))md5 from ${id}t`,
        )
      )[0],
    });
  }
  return rows;
}
const ref = (n) => `00000000-5555-4555-8555-${String(n).padStart(12, "0")}`,
  key = (n) => digest({ tenant: "VSM", client_ref: ref(n) }),
  folio = "148",
  hash = "a".repeat(64);
let rejects = 0,
  acls = 0;
async function reject(p, pattern = /CENSUS_|DETAIL_/) {
  await c.query("savepoint bad");
  let error;
  try {
    await c.query("select app.m9_archive_general_census($1::jsonb)", [p]);
  } catch (e) {
    error = e;
  }
  await c.query("rollback to savepoint bad");
  await c.query("release savepoint bad");
  assert.match(error?.message ?? "", pattern);
  rejects++;
}
try {
  assert.equal(
    (
      await query(
        "select configured_by from app.sicar_sync_control where singleton",
      )
    )[0].configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  const legacyBefore = (
    await query(
      "select pg_get_functiondef('app.m9_archive_general_census(jsonb)'::regprocedure)s",
    )
  )[0].s;
  await c.query(
    readFileSync(
      new URL("./census-renewal.sql", import.meta.url),
      "utf8",
    ).replaceAll("create function ", "create or replace function "),
  );
  const legacyAfter = (
    await query(
      "select pg_get_functiondef('app.m9_archive_general_census(jsonb)'::regprocedure)s",
    )
  )[0].s;
  const dispatch =
    "\n if p->>'protocol'='m9-census-archive-renewal-1'then return app.m9_archive_general_census_renewal(p);end if;";
  assert.equal(
    legacyAfter.replace(dispatch, ""),
    legacyBefore.replace(dispatch, ""),
  );
  assert.ok(
    legacyAfter.includes("source_row(value)"),
    "Applied v1 alias repair must be preserved",
  );
  const admin = (
    await query(
      "select u.id,u.role_id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit 1",
    )
  )[0];
  const before = await audit();
  await c.query("begin");
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
    admin.id,
  ]);
  const now = (await query("select clock_timestamp()t"))[0].t.getTime(),
    oldStamp = new Date(now - 7200000).toISOString(),
    stamp = new Date(now - 60000).toISOString(),
    at = new Date(now).toISOString();
  const sourcePayload = {
      source_display_name: "SYNTHETIC LOCAL REGISTERED A ONLY",
    },
    batch = "b".repeat(64);
  await c.query(
    "insert into app.m9_customer_batches(plan_sha256,payload_hash,source_scope,source_at,actor_user_id,receipt)values($1,$1,'SYNTHETIC_QA_NOT_SICAR',$2,$3,'{}')",
    [batch, oldStamp, admin.id],
  );
  await c.query(
    "insert into app.m9_customer_sources(customer_key,source_ref,batch_sha256,payload,used_cents)values($1,$2,$3,$4,1000)",
    [key(1), ref(1), batch, sourcePayload],
  );
  await c.query(
    "insert into app.m9_legacy_registry(customer_key,batch_sha256,source_hash,created_by)values($1,$2,encode(extensions.digest($3::jsonb::text,'sha256'),'hex'),$4)",
    [key(1), batch, sourcePayload, admin.id],
  );
  const doc = (n, amount) => ({
    key: digest({ tenant: "VSM", client_ref: ref(n), folio }),
    folio,
    total_cents: 1000,
    balance_cents: amount,
    occurred_label: "10/21/2026 10:00:00 AM",
    evidence_sha256: hash,
  });
  const prior = {
    protocol: "m9-census-archive-1",
    source_plan_sha256: "c".repeat(64),
    source_at: oldStamp,
    observed_until: oldStamp,
    scope: "VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY",
    accounts: [1, 2, 3].map((n) => ({
      key: key(n),
      ref: ref(n),
      name:
        n === 1
          ? "SYNTHETIC OLD A"
          : n === 2
            ? "SYNTHETIC DUPLICATE"
            : "SYNTHETIC ABSENT",
      source_at: oldStamp,
      evidence_sha256: hash,
      used_cents: n === 1 ? 1000 : n === 2 ? 500 : 200,
      overdue_cents: 0,
      list_balance_cents: null,
      previously_registered: n === 1,
      holds: [],
      documents: [doc(n, n === 1 ? 1000 : n === 2 ? 500 : 200)],
    })),
  };
  const oldReceipt = (
    await query("select app.m9_archive_general_census($1::jsonb)v", [prior])
  )[0].v;
  assert.equal(oldReceipt.accounts, 3);
  assert.equal(oldReceipt.previous_accounts, 1);
  const ctx = (await query("select app.m9_census_renewal_context()v"))[0].v;
  const rows = [
    { n: 1, name: "SYNTHETIC RENAMED A", amount: 800 },
    { n: 2, name: "SYNTHETIC DUPLICATE", amount: 500 },
    { n: 4, name: "SYNTHETIC DUPLICATE", amount: 300 },
  ];
  const money = (n) => "$" + (n / 100).toFixed(2);
  const uiDoc = (n) =>
    `\n        - row "10/21/2026 10:00:00 AM 148 $10.00 MXN ${money(n)}":\n          - cell:\n            - paragraph: 10/21/2026 10:00:00 AM\n            - button "148":\n          - cell:\n            - paragraph: $10.00 MXN\n            - paragraph: ${money(n)}`;
  const list = {
    captured_at: stamp,
    state: '- combobox "Buscar"\n- button "0":\n',
    rows: rows.map((x, i) => ({
      list_index: i,
      paragraphs: ["", x.name],
      text: x.name + " " + money(x.amount),
    })),
  };
  const captures = rows.map((x, i) => ({
    list_index: i,
    name: x.name,
    client_ref: ref(x.n),
    url: "https://app.sicarx.com/clients/detail/" + ref(x.n),
    full_reload_before_read: true,
    captured_at: stamp,
    credit:
      x.name +
      "\n    - text: Saldo utilizado\n    - paragraph: " +
      money(x.amount) +
      "\n    - text: Saldo vencido\n    - paragraph: $0.00" +
      uiDoc(x.amount),
    rows: ["$10.00 MXN " + money(x.amount)],
  }));
  const evidence = {
    list_sha256: hash,
    accounts_sha256: hash,
    prior_payload_sha256: hash,
    registry_snapshot_sha256: hash,
  };
  const plan = generalCustomerRenewal(list, captures, prior, ctx, at, evidence),
    p = censusRenewalArchive(plan, digest(plan), at);
  assert.equal(plan.archive_eligible, true);
  assert.equal(
    plan.accounts.find((a) => a.source_ref === ref(2)).present_in_prior_census,
    true,
  );
  assert.equal(
    plan.accounts.find((a) => a.source_ref === ref(2)).previously_registered,
    false,
  );
  assert.deepEqual(p.delta.missing_from_visible_scope, [key(3)]);
  assert.equal(
    p.accounts.some((a) => a.ref === ref(3)),
    false,
  );
  const baseline = await audit();
  for (const bad of [
    null,
    [],
    { ...p, scope: "ALL_CUSTOMERS" },
    { ...p, archive_only: false },
    { ...p, operational_import_allowed: true },
    { ...p, unknown_field: true },
    { ...p, source_at: "2026-02-31T00:00:00.000Z" },
    { ...p, source_at: oldStamp },
    { ...p, observed_until: new Date(now + 86400000).toISOString() },
    { ...p, expected_context: { ...ctx, registry_count: 2 } },
    { ...p, evidence: { ...evidence, accounts_sha256: "bad" } },
    { ...p, delta: { ...p.delta, added_keys: [] } },
  ])
    await reject(bad, /CENSUS_|date\/time|out of range/);
  const mutate = (change) => {
    const q = structuredClone(p);
    change(q);
    return q;
  };
  for (const change of [
    (q) => (q.accounts[0].used_cents = null),
    (q) => (q.accounts[0].used_cents = "800"),
    (q) => (q.accounts[0].ref = 1),
    (q) => (q.accounts[0].key = hash),
    (q) => q.accounts.push(q.accounts[0]),
    (q) => (q.accounts[0].name = "bad\nname"),
    (q) =>
      (q.accounts[0].previously_registered =
        !q.accounts[0].previously_registered),
    (q) =>
      (q.accounts[0].present_in_prior_census =
        !q.accounts[0].present_in_prior_census),
    (q) => (q.accounts[0].used_cents += 1),
    (q) => (q.accounts[0].documents[0].key = hash),
    (q) => q.accounts[0].documents.push(q.accounts[0].documents[0]),
    (q) => (q.accounts[0].documents[0].balance_cents = 0),
    (q) => (q.accounts[0].documents[0].balance_cents = 1001),
    (q) => (q.accounts[0].documents[0].total_cents = "1000"),
    (q) => (q.accounts[0].source_at = "2026-02-31T00:00:00.000Z"),
    (q) => q.accounts[0].holds.push("DELIVERY_APPROVED"),
    (q) => (q.accounts[0].holds = []),
    (q) => (q.accounts[0].documents[0].source_document_id = "invented"),
  ])
    await reject(mutate(change), /CENSUS_|DETAIL_|date\/time|out of range/);
  await reject(
    mutate((q) => (q.accounts.find((a) => a.ref === ref(4)).holds = [null])),
    /HOLD_INVALID/,
  );
  await reject(
    mutate((q) => (q.accounts[0].overdue_cents = q.accounts[0].used_cents + 1)),
    /INTERNAL_MISMATCH/,
  );
  await c.query("savepoint registry_drift");
  await c.query(
    "update app.m9_customer_sources set used_cents=used_cents+1 where customer_key=$1",
    [key(1)],
  );
  await reject(p, /CONTEXT_CHANGED/);
  await c.query("rollback to savepoint registry_drift");
  await c.query("release savepoint registry_drift");
  await c.query("savepoint source_corrupt");
  await c.query(
    "alter table app.m9_customer_census_archives disable trigger m9_customer_census_immutable",
  );
  await c.query(
    "update app.m9_customer_census_archives set payload=jsonb_set(payload,'{accounts,0,name}','\"SYNTHETIC CORRUPTION\"')where source_plan_sha256=$1",
    [prior.source_plan_sha256],
  );
  await reject(p, /PRIOR_CORRUPTED/);
  await c.query("rollback to savepoint source_corrupt");
  await c.query("release savepoint source_corrupt");
  // A table writer can coexist with fixture ROW EXCLUSIVE locks but must make
  // renewal fail NOWAIT. No partial stronger barrier/nonce may survive failure.
  await b.query(
    "begin;lock table app.m9_customer_sources in row exclusive mode",
  );
  await reject(p, /CENSUS_RENEWAL_BUSY_RETRY/);
  await b.query("rollback");
  const pid = (await query("select pg_backend_pid()p"))[0].p;
  assert.equal(
    (
      await query(
        "select count(*)::int n from pg_locks where pid=$1 and granted and(locktype='advisory'and classid::bigint=((hashtextextended('m9-census-archive/'||$2,0)>>32)&4294967295)and objid::bigint=(hashtextextended('m9-census-archive/'||$2,0)&4294967295) or mode='ShareRowExclusiveLock')",
        [pid, p.source_plan_sha256],
      )
    )[0].n,
    0,
  );
  const r = (
    await query("select app.m9_archive_general_census($1::jsonb)v", [p])
  )[0].v;
  assert.equal(r.previous_accounts, 1);
  assert.equal(r.prior_census_members, 2);
  assert.equal(r.observed_balance_cents, 1600);
  assert.equal(r.financial_openings_created, 0);
  assert.equal(r.operational_import_allowed, false);
  const post = await audit();
  assert.deepEqual(
    post.filter((t) => t.name !== "app.m9_customer_census_archives"),
    baseline.filter((t) => t.name !== "app.m9_customer_census_archives"),
  );
  const replay = (
    await query("select app.m9_archive_general_census($1::jsonb)v", [p])
  )[0].v;
  assert.equal(replay.replayed, true);
  assert.equal(replay.historical_receipt_only, true);
  assert.deepEqual(await audit(), post);
  await reject({ ...p, accounts: [] }, /CENSUS_RENEWAL_SCOPE_INVALID/);
  await reject({ ...p, delta: {} }, /CENSUS_REPLAY_CHANGED/);
  const oldReplay = (
    await query("select app.m9_archive_general_census($1::jsonb)v", [prior])
  )[0].v;
  assert.equal(oldReplay.replayed, true);
  assert.equal(oldReplay.previous_accounts, 1);
  // Replay remains historical after registry metadata changes, never a new cut.
  await c.query("savepoint replay_drift");
  await c.query(
    "update app.m9_customer_sources set used_cents=used_cents+1 where customer_key=$1",
    [key(1)],
  );
  assert.equal(
    (await query("select app.m9_archive_general_census($1::jsonb)v", [p]))[0].v
      .historical_receipt_only,
    true,
  );
  await c.query("rollback to savepoint replay_drift");
  await c.query("release savepoint replay_drift");
  await c.query("savepoint inactive");
  await c.query("update public.app_users set is_active=false where id=$1", [
    admin.id,
  ]);
  await reject(p, /NOT_AUTHORIZED/);
  await c.query("rollback to savepoint inactive");
  await c.query("release savepoint inactive");
  await c.query("savepoint permission");
  await c.query(
    "delete from public.role_permissions where role_id=$1 and permission_code='customers.manage'",
    [admin.role_id],
  );
  await reject(null, /NOT_AUTHORIZED/);
  await c.query("rollback to savepoint permission");
  await c.query("release savepoint permission");
  await c.query("savepoint stage");
  await c.query(
    "update app.sicar_sync_control set catalog_writes_enabled=false where singleton",
  );
  await reject(null, /SICAR_CATALOG_SYNC_DISABLED/);
  await c.query("rollback to savepoint stage");
  await c.query("release savepoint stage");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await c.query("set local role " + role);
    for (const sql of [
      "select app.m9_archive_general_census('{}')",
      "select app.m9_archive_general_census_renewal('{}')",
      "select app.m9_census_renewal_context()",
    ]) {
      await c.query("savepoint acl");
      await assert.rejects(() => c.query(sql), /permission denied/);
      await c.query("rollback to savepoint acl");
      acls++;
    }
    await c.query("reset role");
  }
  await c.query("set local role authenticated");
  const read = (
    await query("select public.m9_general_migration_read('{}')v")
  )[0].v;
  assert.equal(read.total, 3);
  assert.equal(read.summary.prior_census_members, 2);
  assert.equal(read.operational_import_allowed, false);
  await c.query("reset role");
  await c.query("savepoint immutable");
  await assert.rejects(
    () =>
      c.query(
        "update app.m9_customer_census_archives set receipt='{}'where source_plan_sha256=$1",
        [p.source_plan_sha256],
      ),
    /IMMUTABLE/,
  );
  await c.query("rollback to savepoint immutable");
  await c.query("rollback");
  assert.deepEqual(await audit(), before);
  const result = {
    protocol: "m9-census-renewal-local-qa-1",
    synthetic_local_only: true,
    auth_storage_stubs: true,
    negative_rejections: rejects,
    acl_rejections: acls,
    old_census_accounts: 3,
    renewal_accounts: 3,
    live_registered: 1,
    prior_members: 2,
    missing_only_observed: 1,
    new_census_members: 1,
    old_archive_flags_preserved: true,
    v1_definition_preserved_except_dispatch: true,
    v1_alias_repair_preserved: true,
    v1_replay_unchanged: true,
    v2_historical_replay_after_context_drift: true,
    source_registry_money_untouched: true,
    only_census_changed_in_trial: true,
    other_tables_identical: baseline.length - 1,
    tables_identical_after_rollback: before.length,
    nowait_contention_rejected: true,
    partial_locks_released: true,
    legacy_reader_compatible: true,
    remote_operations: 0,
    financial_openings_created: 0,
  };
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  console.log(JSON.stringify(result));
} finally {
  await Promise.allSettled([c.query("rollback"), b.query("rollback")]);
  await Promise.all([c.end(), b.end()]);
}
