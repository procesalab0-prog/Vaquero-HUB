// Synthetic local QA only. Always rolls back evidence, journal and receipts.
import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  target.search ||
  target.hash ||
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  !/^\/qa_[a-z0-9_]+$/.test(target.pathname)
)
  throw Error("LOCAL_QA_DATABASE_REQUIRED");
const db = new pg.Client({ connectionString: target.href });
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const source = await readFile(
  new URL("./woo-web-settlement.sql", import.meta.url),
  "utf8",
);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const ownTables = [
  "m9_web_order_snapshots",
  "m9_web_settlement_events",
  "m9_web_settlement_journal",
  "m9_web_settlement_receipts",
];
let checks = 0,
  negatives = 0,
  replays = 0;
const results = [];
async function state() {
  const tables = await q(
    "select schemaname,tablename from pg_tables where schemaname in('public','app')and not(schemaname='app'and tablename=any($1::text[]))order by 1,2",
    [[...ownTables, "m9_web_settlement_control"]],
  );
  const hashes = {};
  for (const t of tables) {
    const name = '"' + t.schemaname + '"."' + t.tablename + '"';
    hashes[t.schemaname + "." + t.tablename] = (
      await q(
        `select count(*)n,md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by to_jsonb(t)::text),''))h from ${name} t`,
      )
    )[0];
  }
  return hashes;
}
const currentState = async () =>
  (
    await q(
      "select jsonb_build_object('snapshots',(select count(*)from app.m9_web_order_snapshots),'events',(select count(*)from app.m9_web_settlement_events),'journal',(select count(*)from app.m9_web_settlement_journal),'receipts',(select count(*)from app.m9_web_settlement_receipts))s",
    )
  )[0].s;
const record = (p) =>
  q("select app.m9_web_settlement_record($1::jsonb)r", [p]).then((r) => r[0].r);
async function rejected(p, message) {
  const before = await currentState();
  await db.query("savepoint negative");
  let caught;
  try {
    await record(p);
  } catch (e) {
    caught = e;
    await db.query("rollback to negative");
  }
  await db.query("release negative");
  assert.equal(caught?.message, message);
  assert.deepEqual(await currentState(), before);
  negatives++;
}
const order = {
  revision: 1,
  components: {
    items_subtotal: 20000,
    discount_total: 2000,
    shipping_total: 1000,
    shipping_tax: 160,
    cart_tax: 2960,
    total_tax: 3120,
    fees_total: 500,
    fee_tax: 80,
    total: 22620,
  },
  lines: [
    {
      line_id: 1,
      product_id: 990000001,
      variation_id: 0,
      barcode: "SYNTHETIC-000236",
      quantity: 2,
      subtotal_cents: 20000,
      total_cents: 18000,
      subtotal_tax_cents: 3200,
      total_tax_cents: 2880,
    },
  ],
};
function packet(kind, amount, related = null, patch = {}) {
  const time = new Date().toISOString();
  return {
    protocol: "m9-web-settlement-synthetic-1",
    mode: "SYNTHETIC_TEST_ONLY",
    operation_id: randomUUID(),
    evidence: {
      provider: "SYNTHETIC-QA-PROVIDER",
      account_id: "SYNTHETIC-QA-ACCOUNT",
      merchant_id: "SYNTHETIC-QA-MERCHANT",
      origin: "https://salmon-nightingale-251188.hostingersite.com",
      order_id: 990000002,
      currency: "MXN",
      kind,
      event_reference: "SYNTHETIC-" + randomUUID(),
      transaction_reference:
        kind === "PHYSICAL_RECEIPT" ? null : "SYNTHETIC-" + randomUUID(),
      related_event_id: related,
      amount_cents: amount,
      source_sha256: sha("SYNTHETIC QA ONLY " + randomUUID()),
      occurred_at: time,
      observed_at: time,
      order_document: structuredClone(order),
      physical_lines: [],
      settlement_components: null,
      ...patch,
    },
  };
}
await db.connect();
try {
  assert.equal(
    (
      await q(
        "select configured_by from app.sicar_sync_control where singleton",
      )
    )[0].configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  const installed = (
    await q("select to_regclass('app.m9_web_settlement_control')t")
  )[0].t;
  if (!installed) await db.query(source);
  else if (process.env.QA_REFRESH_OWN_FUNCTIONS === "1") {
    for (const name of ownTables)
      assert.equal((await q("select count(*)n from app." + name))[0].n, "0");
    await db.query("begin");
    await db.query(
      "create unique index if not exists m9_web_unique_monetary_transaction on app.m9_web_settlement_events(provider,account_id,kind,transaction_reference)where kind in('CAPTURE','REFUND','PROVIDER_FEE','FEE_REVERSAL','SETTLEMENT')",
    );
    for (const fn of source.match(/create function app\.[\s\S]*?\$\$;/g) ?? [])
      await db.query(
        fn.replace("create function", "create or replace function"),
      );
    if (
      !(
        await q(
          "select 1 from pg_trigger where tgname='m9_web_event_journal_balanced'and tgrelid='app.m9_web_settlement_events'::regclass",
        )
      ).length
    )
      await db.query(
        "create constraint trigger m9_web_event_journal_balanced after insert on app.m9_web_settlement_events deferrable initially deferred for each row execute function app.m9_web_journal_balanced()",
      );
    await db.query("commit");
  }
  const baseline = await state();
  const actor = (
    await q(
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit 1",
    )
  )[0].id;
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  await rejected(packet("CAPTURE", 10000), "WEB_SETTLEMENT_DISABLED");
  await db.query(
    "update app.m9_web_settlement_control set enabled=true,actor_id=$1,expires_at=clock_timestamp()+interval'10 minutes'where singleton",
    [actor],
  );
  for (const [mutate, error] of [
    [(p) => (p.mode = "AUTHENTICATED_PROVIDER"), "WEB_PACKET_INVALID"],
    [
      (p) => (p.evidence.origin = "https://vaquerosm.com"),
      "WEB_TEST_ORDER_REQUIRED",
    ],
    [(p) => (p.evidence.currency = "USD"), "WEB_TEST_ORDER_REQUIRED"],
    [
      (p) => (p.evidence.kind = "PARTIAL_SALE"),
      "WEB_SYNTHETIC_EVIDENCE_REQUIRED",
    ],
    [(p) => (p.evidence.amount_cents = null), "DETAIL_AMOUNT_INVALID"],
    [(p) => (p.evidence.amount_cents = 1.5), "DETAIL_AMOUNT_INVALID"],
    [
      (p) => (p.evidence.event_reference = "real_provider_reference"),
      "WEB_SYNTHETIC_EVIDENCE_REQUIRED",
    ],
    [
      (p) => (p.evidence.observed_at = "2026-02-30T00:00:00.000Z"),
      "WEB_TIMESTAMP_INVALID",
    ],
    [
      (p) =>
        (p.evidence.observed_at = new Date(Date.now() - 600000).toISOString()),
      "WEB_EVIDENCE_STALE_OR_FUTURE",
    ],
    [
      (p) => (p.evidence.order_document.lines[0].barcode = 236),
      "WEB_ORDER_LINE_INVALID",
    ],
    [
      (p) => (p.evidence.order_document.lines[0].quantity = 0.5),
      "WEB_ORDER_LINE_INVALID",
    ],
    [
      (p) => (p.evidence.order_document.components.shipping_tax = 0),
      "WEB_ORDER_COMPONENTS_DIFFER",
    ],
    [
      (p) => (p.evidence.customer_email = "forbidden@example.invalid"),
      "WEB_EVIDENCE_INVALID",
    ],
  ]) {
    const p = packet("CAPTURE", 10000);
    mutate(p);
    await rejected(p, error);
  }
  const authPacket = packet("AUTHORIZATION", 22620);
  const authorization = await record(authPacket);
  checks++;
  assert.equal(authorization.balance.captured_cents, 0);
  assert.equal((await currentState()).journal, 0);
  const p1 = packet("CAPTURE", 10000, authorization.event_id, {
      transaction_reference: authPacket.evidence.transaction_reference,
    }),
    capture1 = await record(p1),
    replay1 = await record(p1);
  assert.equal(replay1.receipt_id, capture1.receipt_id);
  assert.equal(replay1.replayed, true);
  replays++;
  await rejected(
    packet("CAPTURE", 10000, null, {
      transaction_reference: p1.evidence.transaction_reference,
    }),
    "WEB_MONETARY_TRANSACTION_REUSED",
  );
  await rejected(
    packet("CAPTURE", 10000, null, {
      order_id: 990000003,
      transaction_reference: p1.evidence.transaction_reference,
    }),
    "WEB_MONETARY_TRANSACTION_REUSED",
  );
  await rejected(
    packet("CAPTURE", 10000, null, {
      merchant_id: "SYNTHETIC-OTHER-MERCHANT",
      transaction_reference: p1.evidence.transaction_reference,
    }),
    "WEB_MONETARY_TRANSACTION_REUSED",
  );
  const capture2 = await record(
    packet("CAPTURE", 12620, authorization.event_id),
  );
  checks++;
  assert.equal(capture2.balance.captured_cents, 22620);
  const reused = structuredClone(p1);
  reused.evidence.amount_cents = 9999;
  await rejected(reused, "WEB_OPERATION_REUSED");
  await rejected(packet("CAPTURE", 1), "WEB_CAPTURE_LIMIT");
  await rejected(
    packet("VOID", 1, authorization.event_id),
    "WEB_AUTHORIZATION_LIMIT",
  );
  await rejected(
    packet("CAPTURE", 10000, null, {
      event_reference: p1.evidence.event_reference,
      order_id: 990000003,
    }),
    "WEB_EVENT_REFERENCE_REUSED",
  );
  const changed = packet("REFUND", 100, capture1.event_id);
  changed.evidence.order_document.revision = 2;
  changed.evidence.order_document.lines[0].barcode = "SYNTHETIC-OTHER";
  await rejected(changed, "WEB_ORDER_CHANGED_AFTER_EVENT");
  const revised = packet("REFUND", 100, capture1.event_id);
  revised.evidence.order_document.lines[0].barcode = "SYNTHETIC-OTHER";
  await rejected(revised, "WEB_ORDER_REVISION_CHANGED");
  await rejected(
    packet("REFUND", 10001, capture1.event_id),
    "WEB_REFUND_LIMIT",
  );
  await rejected(
    packet("REFUND", 100, authorization.event_id),
    "WEB_CAPTURE_REFERENCE_REQUIRED",
  );
  const refundPacket = packet("REFUND", 1000, capture1.event_id);
  const refund = await record(refundPacket);
  await rejected(
    packet("REFUND", 1000, capture1.event_id, {
      transaction_reference: refundPacket.evidence.transaction_reference,
    }),
    "WEB_MONETARY_TRANSACTION_REUSED",
  );
  assert.equal(refund.balance.refunded_cents, 1000);
  checks++;
  assert.equal(
    (
      await q(
        "select count(*)n from app.m9_web_settlement_events where kind='PHYSICAL_RECEIPT'",
      )
    )[0].n,
    "0",
  );
  const feePacket = packet("PROVIDER_FEE", 700, capture1.event_id);
  const fee = await record(feePacket);
  await rejected(
    packet("PROVIDER_FEE", 700, capture1.event_id, {
      transaction_reference: feePacket.evidence.transaction_reference,
    }),
    "WEB_MONETARY_TRANSACTION_REUSED",
  );
  const reversePacket = packet("FEE_REVERSAL", 200, fee.event_id);
  const feeReverse = await record(reversePacket);
  await rejected(
    packet("FEE_REVERSAL", 200, fee.event_id, {
      transaction_reference: reversePacket.evidence.transaction_reference,
    }),
    "WEB_MONETARY_TRANSACTION_REUSED",
  );
  assert.equal(feeReverse.balance.provider_fees_cents, 700);
  assert.equal(feeReverse.balance.fee_reversals_cents, 200);
  checks++;
  await rejected(
    packet("FEE_REVERSAL", 501, fee.event_id),
    "WEB_FEE_REVERSAL_LIMIT",
  );
  const physical = await record(
    packet("PHYSICAL_RECEIPT", 0, null, {
      physical_lines: [
        { line_id: 1, barcode: "SYNTHETIC-000236", quantity: 1 },
      ],
    }),
  );
  assert.equal(physical.balance.refunded_cents, 1000);
  checks++;
  await rejected(
    packet("PHYSICAL_RECEIPT", 0, null, {
      physical_lines: [
        { line_id: 1, barcode: "SYNTHETIC-000236", quantity: 2 },
      ],
    }),
    "WEB_PHYSICAL_QUANTITY_EXCEEDED",
  );
  await rejected(
    packet("PHYSICAL_RECEIPT", 0, null, {
      physical_lines: [{ line_id: 1, barcode: "SYNTHETIC-236", quantity: 1 }],
    }),
    "WEB_PHYSICAL_IDENTITY_CHANGED",
  );
  const statement = {
    captured_cents: 22620,
    refunded_cents: 1000,
    provider_fees_cents: 700,
    fee_reversals_cents: 200,
    prior_settlements_cents: 0,
    net_cents: 21120,
  };
  await rejected(
    packet("SETTLEMENT", 21119, null, { settlement_components: statement }),
    "WEB_NET_SETTLEMENT_REVIEW_REQUIRED",
  );
  const payoutPacket = packet("SETTLEMENT", 21120, null, {
    settlement_components: statement,
  });
  // Fail after events/journal but before receipt: the entire command must roll back.
  await db.query(
    "create function pg_temp.fail_web_receipt()returns trigger language plpgsql as $$begin raise exception 'QA_WEB_RECEIPT_FAILURE';end$$;create trigger qa_fail_web_receipt before insert on app.m9_web_settlement_receipts for each row execute function pg_temp.fail_web_receipt()",
  );
  await rejected(payoutPacket, "QA_WEB_RECEIPT_FAILURE");
  await db.query(
    "drop trigger qa_fail_web_receipt on app.m9_web_settlement_receipts",
  );
  checks++;
  const payout = await record(payoutPacket);
  await rejected(
    packet("SETTLEMENT", 21120, null, {
      transaction_reference: payoutPacket.evidence.transaction_reference,
      settlement_components: statement,
    }),
    "WEB_MONETARY_TRANSACTION_REUSED",
  );
  assert.equal(payout.balance.clearing_cents, 0);
  assert.equal(payout.balance.settlement_pending_cents, 21120);
  assert.equal(payout.balance.bank_verified, false);
  checks++;
  const afterPayout = await record(packet("REFUND", 500, capture1.event_id));
  assert.equal(afterPayout.balance.clearing_cents, -500);
  assert.equal(afterPayout.stock_write_allowed, false);
  checks++;
  const snapshot = (
    await q("select document from app.m9_web_order_snapshots where id=$1", [
      capture1.snapshot_id,
    ])
  )[0].document;
  assert.deepEqual(snapshot, order);
  checks++;
  // Deferred constraint also rejects a financial event inserted without its
  // journal by maintenance; private table grants are checked separately below.
  await db.query("savepoint unbalanced");
  let balanceError;
  try {
    await db.query(
      "insert into app.m9_web_settlement_events select(jsonb_populate_record(null::app.m9_web_settlement_events,to_jsonb(e)||jsonb_build_object('id',gen_random_uuid(),'event_reference','SYNTHETIC-unbalanced-'||gen_random_uuid(),'transaction_reference','SYNTHETIC-unbalanced-'||gen_random_uuid()))).*from app.m9_web_settlement_events e where id=$1",
      [capture1.event_id],
    );
    await db.query("set constraints all immediate");
  } catch (e) {
    balanceError = e;
    await db.query("rollback to unbalanced");
  }
  await db.query("release unbalanced");
  assert.equal(balanceError?.message, "WEB_JOURNAL_UNBALANCED");
  negatives++;
  await db.query("set constraints all immediate");
  checks++;
  for (const table of ownTables) {
    await db.query("savepoint immutable");
    let error;
    try {
      await db.query("delete from app." + table);
    } catch (e) {
      error = e;
      await db.query("rollback to immutable");
    }
    await db.query("release immutable");
    assert.equal(error?.message, "WEB_SETTLEMENT_IMMUTABLE");
    negatives++;
  }
  await db.query(
    "update app.m9_web_settlement_control set enabled=false,actor_id=null,expires_at=null where singleton",
  );
  const lookup = (
    await q("select app.m9_web_settlement_receipt($1)r", [p1.operation_id])
  )[0].r;
  assert.equal(lookup.receipt_id, capture1.receipt_id);
  assert.equal(lookup.lookup_only, true);
  replays++;
  const closedReplay = await record(p1);
  assert.equal(closedReplay.receipt_id, capture1.receipt_id);
  assert.equal(closedReplay.replayed, true);
  replays++;
  await rejected(
    packet("REFUND", 1, capture1.event_id),
    "WEB_SETTLEMENT_DISABLED",
  );
  const acl = await q(
    "select r.rolname,has_function_privilege(r.oid,'app.m9_web_settlement_record(jsonb)','EXECUTE')write,has_function_privilege(r.oid,'app.m9_web_settlement_receipt(uuid)','EXECUTE')read from pg_roles r where rolname in('anon','authenticated','service_role')order by rolname",
  );
  assert.equal(acl.length, 3);
  for (const r of acl) {
    assert.equal(r.write, false);
    assert.equal(r.read, false);
  }
  checks++;
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const sql of [
      "select app.m9_web_settlement_record('{}')",
      "select app.m9_web_settlement_receipt(gen_random_uuid())",
      "select *from app.m9_web_settlement_events",
    ]) {
      await db.query("savepoint role_denial");
      let denial;
      try {
        await db.query("set local role " + role);
        await db.query(sql);
      } catch (e) {
        denial = e;
        await db.query("rollback to role_denial");
      }
      await db.query("release role_denial");
      assert.equal(denial?.code, "42501");
      negatives++;
    }
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    randomUUID(),
  ]);
  await rejected(packet("CAPTURE", 10000), "NOT_AUTHORIZED");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  const tableAcl = await q(
    "select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')priv from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app'and c.relname=any($1::text[])",
    [[...ownTables, "m9_web_settlement_control"]],
  );
  assert.equal(tableAcl.length, 5);
  for (const t of tableAcl) {
    assert.equal(t.relrowsecurity, true);
    assert.equal(t.priv, false);
  }
  checks++;
  const counts = await currentState();
  assert.deepEqual(await state(), baseline);
  checks++;
  results.push({
    mode: "SYNTHETIC_WEB_LEDGER_ROLLBACK",
    checks,
    negative_checks: negatives,
    replays,
    counts,
    partial_capture_recorded: true,
    partial_refund_recorded: true,
    physical_receipt_separate: true,
    nonzero_order_components_preserved: true,
    provider_fee_distinct_from_woo_fee: true,
    receipt_lookup_after_window_closed: true,
    native_tables_unchanged: Object.keys(baseline).length,
    real_gateway_payment: false,
    native_sale: false,
    stock_write: false,
    cash_write: false,
  });
  await db.query("rollback");
  assert.deepEqual(await currentState(), {
    snapshots: 0,
    events: 0,
    journal: 0,
    receipts: 0,
  });
  assert.equal(
    (
      await q(
        "select enabled from app.m9_web_settlement_control where singleton",
      )
    )[0].enabled,
    false,
  );
  assert.deepEqual(await state(), baseline);
  // Two actual backends; only rollback recovery is claimed. Both transactions
  // roll back, so no committed accounting fixtures are left in the local book.
  const a = new pg.Client({ connectionString: target.href });
  const b = new pg.Client({ connectionString: target.href });
  await a.connect();
  await b.connect();
  const races = [];
  try {
    await db.query(
      "update app.m9_web_settlement_control set enabled=true,actor_id=$1,expires_at=clock_timestamp()+interval'10 minutes'where singleton",
      [actor],
    );
    for (const scenario of ["operation", "order", "transaction"]) {
      const p = packet("CAPTURE", 22620, null, { order_id: 990000009 });
      const other =
        scenario === "operation"
          ? p
          : packet("CAPTURE", 22620, null, {
              order_id: scenario === "order" ? 990000009 : 990000010,
              ...(scenario === "transaction"
                ? { transaction_reference: p.evidence.transaction_reference }
                : {}),
            });
      for (const client of [a, b]) {
        await client.query("begin");
        await client.query("set local statement_timeout='10s'");
        await client.query(
          "select set_config('request.jwt.claim.sub',$1,true)",
          [actor],
        );
      }
      const holder = (await a.query("select pg_backend_pid()pid")).rows[0].pid;
      const contender = (await b.query("select pg_backend_pid()pid")).rows[0]
        .pid;
      assert.notEqual(holder, contender);
      await a.query("select app.m9_web_settlement_record($1::jsonb)r", [p]);
      const start = performance.now();
      let resolved = false;
      const waiting = b
        .query("select app.m9_web_settlement_record($1::jsonb)r", [other])
        .then((r) => {
          resolved = true;
          return r;
        });
      let observed = false,
        blockers = [];
      for (let i = 0; i < 100; i++) {
        blockers = (await q("select pg_blocking_pids($1)p", [contender]))[0].p;
        if (blockers.includes(holder)) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(observed, true, "WEB_LEDGER_CONTENTION_NOT_OBSERVED");
      assert.equal(resolved, false);
      await a.query("rollback");
      const recovered = (await waiting).rows[0].r;
      const again = (
        await b.query("select app.m9_web_settlement_record($1::jsonb)r", [
          other,
        ])
      ).rows[0].r;
      assert.equal(again.receipt_id, recovered.receipt_id);
      assert.equal(again.replayed, true);
      assert.equal(recovered.balance.captured_cents, 22620);
      const duplicated = structuredClone(other);
      duplicated.operation_id = randomUUID();
      duplicated.evidence.event_reference = "SYNTHETIC-" + randomUUID();
      await b.query("savepoint duplicate_money");
      let duplicateError;
      try {
        await b.query("select app.m9_web_settlement_record($1::jsonb)", [
          duplicated,
        ]);
      } catch (e) {
        duplicateError = e;
        await b.query("rollback to duplicate_money");
      }
      await b.query("release duplicate_money");
      assert.equal(duplicateError?.message, "WEB_MONETARY_TRANSACTION_REUSED");
      await b.query("rollback");
      assert.deepEqual(await currentState(), {
        snapshots: 0,
        events: 0,
        journal: 0,
        receipts: 0,
      });
      races.push({
        scenario:
          scenario === "operation"
            ? "same_operation_rollback_recovery"
            : scenario === "order"
              ? "same_order_distinct_operation_rollback_recovery"
              : "same_monetary_transaction_distinct_orders_rollback_recovery",
        holder_pid: holder,
        contender_pid: contender,
        blocking_observed: true,
        blockers,
        wait_ms: Math.round(performance.now() - start),
        holder_rolled_back: true,
        contender_recovered: true,
        contender_replayed: true,
        logical_duplicate_transaction_rejected: true,
        both_transactions_rolled_back: true,
      });
    }
  } finally {
    await Promise.allSettled([a.query("rollback"), b.query("rollback")]);
    await Promise.allSettled([a.end(), b.end()]);
    await db.query(
      "update app.m9_web_settlement_control set enabled=false,actor_id=null,expires_at=null where singleton",
    );
  }
  results.push({
    mode: "SYNTHETIC_WEB_LEDGER_ROLLBACK_CONTENTION",
    races,
    committed_events: 0,
    provider_checkout_certified: false,
  });
  assert.deepEqual(await state(), baseline);
  if (process.env.QA_OUTPUT_DIR)
    for (const [name, value] of Object.entries({
      "rollback-results.json": { sql_sha256: sha(source), results },
      "native-before.json": baseline,
      "native-after.json": await state(),
      "own-final.json": {
        counts: await currentState(),
        control: (
          await q(
            "select enabled,project_ref,actor_id,expires_at from app.m9_web_settlement_control where singleton",
          )
        )[0],
      },
    }))
      await writeFile(
        process.env.QA_OUTPUT_DIR + "/" + name,
        JSON.stringify(value, null, 2) + "\n",
        { mode: 0o600 },
      );
  console.log(JSON.stringify({ sql_sha256: sha(source), results }));
} catch (e) {
  await db.query("rollback");
  throw e;
} finally {
  await db.end();
}
