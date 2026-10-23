// Dedicated synthetic local acceptance. Never accepts a remote/application DB.
import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID, randomInt } from "node:crypto";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  url.protocol !== "postgresql:" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "59432" ||
  url.pathname !== "/qa_m9_woo_bloque7_20261023" ||
  url.search ||
  url.hash ||
  url.username !== "postgres"
)
  throw Error("DEDICATED_LOCAL_WOO_RECOVERY_CLONE_REQUIRED");
if (!process.argv[2]) throw Error("NEW_PRIVATE_OUTPUT_DIRECTORY_REQUIRED");
const out = process.argv[2],
  clients = Array.from(
    { length: 3 },
    (_, i) =>
      new pg.Client({
        connectionString: url.href,
        application_name: "m9-local-recovery-" + i,
      }),
  ),
  [db, writer, reader] = clients;
await Promise.all(clients.map((c) => c.connect()));
const one = async (c, q, a = []) => (await c.query(q, a)).rows[0];
const sha = (x) => createHash("sha256").update(x).digest("hex");
const origin = "https://salmon-nightingale-251188.hostingersite.com",
  source = "7".repeat(64);
const actor = async (c, a, local = true) =>
  c.query("select set_config('request.jwt.claim.sub',$1,$2)", [a, local]);
const write = (n, v) =>
  writeFile(out + "/" + n, JSON.stringify(v, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const readReceipt = async (c, p) =>
  (await one(c, "select app.m9_woo_native_finance_receipt($1::jsonb)r", [p])).r;
const post = async (c, p) =>
  (await one(c, "select app.m9_woo_native_finance($1::jsonb)r", [p])).r;
const tables = (
  await db.query(
    "select schemaname,tablename from pg_tables where schemaname in('app','public')order by schemaname,tablename",
  )
).rows;
const ident = (s) => '"' + s.replaceAll('"', '""') + '"';
async function audit(c = db) {
  const result = {};
  for (const t of tables) {
    const name = t.schemaname + "." + t.tablename;
    result[name] = await one(
      c,
      `select count(*)::int rows,md5(coalesce(string_agg(j,'|'order by j),''))md5,coalesce(jsonb_agg(md5(j)order by j),'[]')row_hashes from(select to_jsonb(t)::text j from ${ident(t.schemaname)}.${ident(t.tablename)} t)x`,
    );
  }
  return result;
}
async function controls() {
  return (
    await one(
      db,
      "select jsonb_build_object('stock',(select enabled from app.m9_woo_pilot_control where singleton),'finance',(select enabled from app.m9_woo_finance_pilot_control where singleton),'rehearsal',(select enabled from app.m9_rehearsal_control where singleton))r",
    )
  ).r;
}
async function disable() {
  await db.query(
    "update app.m9_woo_finance_pilot_control set enabled=false,actor_id=null,location_id=null,cash_session_id=null,expires_at=null where singleton;update app.m9_woo_pilot_control set enabled=false,actor_id=null,location_id=null,expires_at=null where singleton;update app.m9_rehearsal_control set enabled=false,review_sha256=null,expires_at=null where singleton",
  );
}
async function enable(f) {
  await actor(db, f.actor);
  await db.query(
    "update app.m9_rehearsal_control set enabled=true,review_sha256=$1,expires_at=clock_timestamp()+interval '10 minutes'where singleton",
    [source],
  );
  await db.query(
    "update app.m9_woo_pilot_control set enabled=true,actor_id=$1,location_id=$2,expires_at=clock_timestamp()+interval '10 minutes'where singleton",
    [f.actor, f.location],
  );
  await db.query(
    "update app.m9_woo_finance_pilot_control set enabled=true,actor_id=$1,location_id=$2,cash_session_id=$3,expires_at=clock_timestamp()+interval '10 minutes'where singleton",
    [f.actor, f.location, f.session],
  );
}
async function fixture() {
  const f = {
    salt: randomUUID().slice(0, 8),
    actor: (
      await one(
        db,
        "select u.id from public.app_users u join public.roles r on r.id=u.role_id where u.is_active and r.code='ADMIN'and not exists(select 1 from public.cash_sessions cs where cs.cashier_user_id=u.id and cs.status='OPEN')order by u.id limit 1",
      )
    ).id,
    ids: [],
    products: [],
    codes: [],
    lines: [],
    order: 9_500_000_000 + randomInt(1, 1000000),
  };
  await actor(db, f.actor);
  f.location = (
    await one(
      db,
      "insert into public.locations(code,name,type)values($1,'SYNTHETIC WOO RECEIPT QA','STORE')returning id",
      ["QAWR" + f.salt.toUpperCase()],
    )
  ).id;
  f.register = (
    await one(
      db,
      "insert into public.cash_registers(location_id,code,name)values($1,$2,'SYNTHETIC WOO RECEIPT QA')returning id",
      [f.location, "QAWR" + f.salt.toUpperCase()],
    )
  ).id;
  f.session = (
    await one(db, "select(public.open_cash_session($1,0)).id", [f.register])
  ).id;
  f.methodBefore =
    (
      await one(
        db,
        "select to_jsonb(p)v from public.payment_methods p where code='M9_WEB_TEST'",
      )
    )?.v ?? null;
  if (f.methodBefore) {
    assert.equal(f.methodBefore.kind, "OTHER");
    assert.equal(f.methodBefore.requires_reference, true);
    if (!f.methodBefore.is_active)
      await db.query(
        "update public.payment_methods set is_active=true where code='M9_WEB_TEST'",
      );
  } else
    await db.query(
      "insert into public.payment_methods(code,name,kind,requires_reference)values('M9_WEB_TEST','SYNTHETIC QA ONLY; no gateway','OTHER',true)",
    );
  f.categoryName = "SYNTHETIC WOO RECEIPT " + f.salt;
  f.category = (
    await one(db, "insert into public.categories(name)values($1)returning id", [
      "SYNTHETIC WOO RECEIPT " + f.salt,
    ])
  ).id;
  for (let i = 0; i < 2; i++) {
    const code = "SYNTHETIC-WOO-REC-" + f.salt + "-" + i;
    const product = (
      await one(
        db,
        "insert into public.products(name,category_id)values($1,$2)returning id",
        [code, f.category],
      )
    ).id;
    f.products.push(product);
    const id = (
      await one(
        db,
        "with n as(select nextval('app.variant_serial_seq')n)insert into public.variants(product_id,sku,cost_cents,price_cents)select $1,n::text||'-'||app.luhn_check_digit(n::text),null,10000 from n returning id",
        [product],
      )
    ).id;
    f.ids.push(id);
    f.codes.push(code);
    await db.query(
      "insert into public.barcodes(variant_id,code,symbology,source,is_primary)values($1,$2,'CODE128','SICAR',true)",
      [id, code],
    );
    await db.query(
      "insert into public.m9_variant_details(variant_id,department,section,source_description)values($1,'SYNTHETIC QA',$2,'SYNTHETIC NOT SICAR')",
      [id, f.categoryName],
    );
    const current = (await one(db, "select app.m9_current_row($1)r", [id])).r;
    assert.ok(current);
    await db.query(
      "insert into app.m9_rows(barcode,variant_id,source_row,source_sha256)values($1,$2,$3,$4)",
      [code, id, current, source],
    );
    await db.query(
      "insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row)values($1,$2,$3,$4)",
      [id, code, source, current],
    );
    const product_id = f.order + 1000000 + i;
    f.lines.push({
      line_id: i + 1,
      product_id,
      variation_id: 0,
      barcode: code,
      quantity: 2,
    });
    await db.query(
      "insert into app.m9_woo_pilot_links(origin,woo_product_id,woo_variation_id,variant_id,barcode,evidence_sha256)values($1,$2,0,$3,$4,$5)",
      [origin, product_id, id, code, source],
    );
    await db.query(
      "select app.apply_movement($1,$2,'INITIAL_IMPORT',3,'SYNTHETIC_WOO_RECEIPT_QA',$3,'{\"synthetic\":true}')",
      [id, f.location, code],
    );
  }
  await enable(f);
  // A retail POS sale/cancellation uses the same native stock before the web order.
  const sale = (
    await one(
      db,
      "select to_jsonb(public.create_sale($1,$2,$3::jsonb,$4::jsonb,null,'[]','SYNTHETIC RECEIPT QA POS REGRESSION'))r",
      [
        randomUUID(),
        f.session,
        JSON.stringify([{ variant_id: f.ids[0], quantity: 1 }]),
        JSON.stringify([
          {
            method_code: "M9_WEB_TEST",
            amount_cents: 10000,
            reference: "SYNTHETIC-POS-" + f.salt,
          },
        ]),
      ],
    )
  ).r;
  await db.query(
    "select public.cancel_sale($1,'SYNTHETIC QA POS COMPENSATION')",
    [sale.id],
  );
  f.posSale = sale.id;
  const packet = {
    store_origin: origin,
    order_id: f.order,
    operation_id: "SYNTHETIC-reserve-" + f.salt,
    expected_version: 0,
    action: "RESERVE",
    evidence_sha256: source,
    reason: "SYNTHETIC LOCAL QA; no external order",
    lines: f.lines,
  };
  await db.query("select app.m9_woo_pilot_command($1::jsonb)", [packet]);
  f.evidence = (
    await one(
      db,
      "select app.m9_woo_rehearsal_evidence($1,$2::jsonb,'PAYMENT',null)id",
      [f.order, JSON.stringify(f.lines)],
    )
  ).id;
  f.packet = (
    await one(db, "select app.m9_woo_rehearsal_packet($1,$2,1,'POST')p", [
      f.evidence,
      "SYNTHETIC-post-" + f.salt,
    ])
  ).p;
  return f;
}
async function refundPacket(f) {
  const e = (
    await one(
      db,
      "select app.m9_woo_rehearsal_evidence($1,$2::jsonb,'FULL_CANCEL',$3)id",
      [f.order, JSON.stringify(f.lines), f.evidence],
    )
  ).id;
  return (
    await one(
      db,
      "select app.m9_woo_rehearsal_packet($1,$2,2,'FULL_CANCEL')p",
      [e, "SYNTHETIC-cancel-" + f.salt],
    )
  ).p;
}
async function close(f) {
  const r = (
    await one(
      db,
      "select public.close_cash_session($1,0,'SYNTHETIC QA zero-cash closure')r",
      [f.session],
    )
  ).r;
  assert.equal(r.status, "CLOSED");
  await disable();
}
async function state(f) {
  return (
    await one(
      db,
      "select jsonb_build_object('stock',(select jsonb_agg(jsonb_build_object('qty',qty,'reserved',reserved_qty)order by variant_id)from public.inventory_by_location where variant_id=any($1::uuid[])and location_id=$2),'sales',(select count(*)from public.sales where location_id=$2),'completed',(select count(*)from public.sales where location_id=$2 and status<>'CANCELLED'),'nonzero_cash',(select count(*)from public.cash_movements where location_id=$2 and amount_cents<>0),'receipts',(select count(*)from app.m9_woo_finance_receipts where order_id=$3),'costs_known',(select count(*)from public.sale_items where sale_id in(select id from public.sales where location_id=$2)and unit_cost_cents is not null))r",
      [f.ids, f.location, f.order],
    )
  ).r;
}
let negative = 0,
  checks = 0;
async function reject(
  p,
  re = /WOO_FINANCE_RECEIPT_NOT_AVAILABLE/,
  edit = null,
) {
  await db.query("savepoint negative_receipt");
  try {
    if (edit) await edit();
    await assert.rejects(() => readReceipt(db, p), re);
    negative++;
  } finally {
    await db.query("rollback to negative_receipt;release negative_receipt");
  }
}
try {
  assert.equal(
    (
      await one(
        db,
        "select configured_by from app.sicar_sync_control where singleton",
      )
    ).configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  assert.deepEqual(await controls(), {
    stock: false,
    finance: false,
    rehearsal: false,
  });
  const definitionBefore = (
    await one(
      db,
      "select pg_get_functiondef('app.m9_woo_native_finance(jsonb)'::regprocedure)s",
    )
  ).s;
  const sql = await readFile(
    new URL("./woo-native-finance-receipt-read.sql", import.meta.url),
    "utf8",
  );
  assert.equal((sql.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((sql.match(/^commit;$/gm) ?? []).length, 1);
  const forward = sql.replace(/^begin;\n/m, "").replace(/^commit;\n?$/m, "");
  const initial = await audit();
  await write("native-before.json", initial);
  await db.query("begin");
  await db.query(forward);
  const f = await fixture();
  const native = await post(db, f.packet);
  assert.equal((await state(f)).receipts, 1);
  checks++;
  assert.deepEqual((await readReceipt(db, f.packet)).receipt, native);
  const noWrites = await audit();
  await readReceipt(db, f.packet);
  assert.deepEqual(await audit(), noWrites);
  checks++;
  await db.query("savepoint closure_only");
  await close(f);
  const recovered = await readReceipt(db, f.packet);
  assert.equal(recovered.current_sale_status, "COMPLETED");
  assert.equal(recovered.historical_receipt, true);
  assert.equal(recovered.repost_allowed, false);
  await assert.rejects(() => post(db, f.packet), /WOO_FINANCE_DISABLED/);
  await db.query("rollback to closure_only;release closure_only");
  checks++;
  const variants = [
    null,
    [],
    {},
    { ...f.packet, extra: 1 },
    { ...f.packet, store_origin: "https://vaquerosm.com" },
    { ...f.packet, order_id: String(f.order) },
    { ...f.packet, order_id: 1.1 },
    { ...f.packet, expected_version: null },
    { ...f.packet, operation_id: "bad " },
    { ...f.packet, action: "REFUND" },
    { ...f.packet, evidence_id: null },
    { ...f.packet, evidence_sha256: 7 },
  ];
  for (const p of variants) await reject(p, /PACKET_INVALID/);
  for (const p of [
    { ...f.packet, operation_id: "SYNTHETIC-other-operation" },
    { ...f.packet, order_id: f.order + 1 },
    { ...f.packet, expected_version: 0 },
    { ...f.packet, action: "FULL_CANCEL" },
    { ...f.packet, evidence_id: randomUUID() },
    { ...f.packet, evidence_sha256: "a".repeat(64) },
  ])
    await reject(p);
  await reject(null, /NOT_AUTHORIZED/, () => actor(db, ""));
  await reject(null, /NOT_AUTHORIZED/, () => actor(db, randomUUID()));
  const other = (
    await one(
      db,
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active and u.id<>$1 order by u.id limit 1",
      [f.actor],
    )
  )?.id;
  assert.ok(other);
  await reject(f.packet, /NOT_AVAILABLE/, () => actor(db, other));
  await reject(f.packet, /NOT_AUTHORIZED/, () =>
    db.query("update public.app_users set is_active=false where id=$1", [
      f.actor,
    ]),
  );
  await reject(f.packet, /NOT_AUTHORIZED/, () =>
    db.query(
      "delete from public.role_permissions where role_id=(select role_id from public.app_users where id=$1)and permission_code='pos.sell'",
      [f.actor],
    ),
  );
  await reject(f.packet, /NOT_AVAILABLE/, () =>
    db.query("update public.locations set is_active=false where id=$1", [
      f.location,
    ]),
  );
  await reject(f.packet, /NOT_AVAILABLE/, () =>
    db.query("update public.locations set type='WAREHOUSE'where id=$1", [
      f.location,
    ]),
  );
  await reject(f.packet, /NOT_AVAILABLE/, async () => {
    await db.query(
      "alter table app.m9_woo_finance_receipts disable trigger m9_woo_finance_receipts_immutable",
    );
    await db.query(
      "update app.m9_woo_finance_receipts set result=result-'synthetic'where id=$1",
      [native.receipt_id],
    );
  });
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.query("savepoint acl_receipt");
    await db.query("set local role " + role);
    await assert.rejects(
      () => readReceipt(db, f.packet),
      (e) => e.code === "42501",
    );
    await db.query("rollback to acl_receipt;release acl_receipt");
    negative++;
  }
  const cancel = await refundPacket(f);
  const cancelled = await post(db, cancel);
  await close(f);
  assert.equal(
    (await readReceipt(db, cancel)).receipt.receipt_id,
    cancelled.receipt_id,
  );
  assert.equal(
    (await readReceipt(db, f.packet)).current_sale_status,
    "CANCELLED",
  );
  checks++;
  const last = await state(f);
  assert.equal(last.completed, 0);
  assert.equal(last.nonzero_cash, 0);
  assert.equal(last.costs_known, 0);
  assert.ok(last.stock.every((x) => x.qty === 3 && x.reserved === 0));
  checks++;
  const priv = await one(
    db,
    "select p.prosecdef,p.provolatile,has_function_privilege('anon',p.oid,'EXECUTE')a,has_function_privilege('authenticated',p.oid,'EXECUTE')u,has_function_privilege('service_role',p.oid,'EXECUTE')s from pg_proc p where p.oid='app.m9_woo_native_finance_receipt(jsonb)'::regprocedure",
  );
  assert.deepEqual(priv, {
    prosecdef: false,
    provolatile: "s",
    a: false,
    u: false,
    s: false,
  });
  checks++;
  await db.query("rollback");
  assert.deepEqual(await audit(), initial);
  checks++;
  await write("rollback-results.json", {
    protocol: "m9-native-finance-recovery-local-rollback-1",
    checks,
    negative_rejections: negative,
    rollback_tables: tables.length,
    rollback_exact: true,
    sql_writer_unchanged: true,
    auth_postgrest_real: false,
    remote_operations: 0,
  });
  // Separate durable LOCAL cycle. No claim of a complete rollback here.
  await db.query(sql);
  await db.query("begin");
  const durable = await fixture();
  await write("durable-request.json", durable);
  await db.query("commit");
  for (const c of [writer, reader]) {
    await actor(c, durable.actor, false);
    await c.query("set statement_timeout='2s'");
  }
  await writer.query("begin");
  await post(writer, durable.packet);
  let unavailableBeforeCommit = false;
  try {
    await readReceipt(reader, durable.packet);
  } catch (e) {
    assert.match(e.message, /NOT_AVAILABLE/);
    unavailableBeforeCommit = true;
  }
  assert.equal(unavailableBeforeCommit, true);
  await writer.query("commit"); // Deliberately discard the POST response at application boundary.
  await actor(db, durable.actor, false);
  await disable();
  const ackRecovered = await readReceipt(reader, durable.packet);
  assert.equal(ackRecovered.current_sale_status, "COMPLETED");
  assert.equal(ackRecovered.write_executed, false);
  assert.equal(ackRecovered.repost_allowed, false);
  const beforeRecovery = await audit();
  await readReceipt(reader, durable.packet);
  assert.deepEqual(await audit(), beforeRecovery);
  await db.query("begin");
  await enable(durable);
  const cancellation = await refundPacket(durable);
  await post(db, cancellation);
  await db.query("commit");
  await db.query("begin");
  await close(durable);
  await db.query("commit");
  const refundRecovered = await readReceipt(reader, cancellation),
    postRecovered = await readReceipt(reader, durable.packet);
  assert.equal(refundRecovered.current_sale_status, "CANCELLED");
  assert.equal(postRecovered.current_sale_status, "CANCELLED");
  await db.query("begin");
  await actor(db, durable.actor);
  for (let i = 0; i < durable.ids.length; i++)
    await db.query(
      "select app.apply_movement($1,$2,'ADJUSTMENT',-3,'SYNTHETIC_WOO_RECEIPT_RETIREMENT',$3,'{\"synthetic\":true,\"reason\":\"Retire own QA seed after compensation\"}')",
      [durable.ids[i], durable.location, durable.codes[i]],
    );
  await db.query(
    "update public.variants set is_active=false where id=any($1::uuid[])",
    [durable.ids],
  );
  await db.query(
    "update public.products set is_active=false where id=any($1::uuid[])",
    [durable.products],
  );
  await db.query(
    "update public.cash_registers set is_active=false where id=$1",
    [durable.register],
  );
  if (!durable.methodBefore)
    await db.query(
      "update public.payment_methods set is_active=false where code='M9_WEB_TEST'",
    );
  else if (!durable.methodBefore.is_active)
    await db.query(
      "update public.payment_methods set is_active=false where code='M9_WEB_TEST'",
    );
  await disable();
  await db.query("commit");
  const finalState = await state(durable);
  assert.equal(finalState.completed, 0);
  assert.equal(finalState.nonzero_cash, 0);
  assert.equal(finalState.costs_known, 0);
  assert.ok(finalState.stock.every((x) => x.qty === 0 && x.reserved === 0));
  assert.deepEqual(await controls(), {
    stock: false,
    finance: false,
    rehearsal: false,
  });
  assert.equal(
    (
      await one(
        db,
        "select pg_get_functiondef('app.m9_woo_native_finance(jsonb)'::regprocedure)s",
      )
    ).s,
    definitionBefore,
  );
  const after = await audit();
  for (const [name, before] of Object.entries(initial)) {
    const bag = [...after[name].row_hashes];
    for (const h of before.row_hashes) {
      const at = bag.indexOf(h);
      assert.notEqual(at, -1, "PREVIOUS_ROW_CHANGED:" + name);
      bag.splice(at, 1);
    }
  }
  const changedAllowed = new Set([
    "public.locations",
    "public.cash_registers",
    "public.cash_sessions",
    "public.cash_movements",
    "public.categories",
    "public.payment_methods",
    "public.products",
    "public.variants",
    "public.barcodes",
    "public.m9_variant_details",
    "public.folios",
    "public.sales",
    "public.sale_items",
    "public.sale_payments",
    "public.idempotency_keys",
    "public.audit_log",
    "public.inventory_by_location",
    "public.inventory_movements",
    "public.inventory_reservation_movements",
    "app.m9_rows",
    "app.m9_rehearsal_allowlist",
    "app.m9_woo_pilot_links",
    "app.m9_woo_pilot_orders",
    "app.m9_woo_pilot_lines",
    "app.m9_woo_pilot_receipts",
    "app.m9_woo_pilot_stock_outbox",
    "app.m9_woo_finance_test_evidence",
    "app.m9_woo_finance_postings",
    "app.m9_woo_finance_receipts",
    "app.m9_woo_finance_ticket_outbox",
  ]);
  for (const [name, before] of Object.entries(initial))
    if (!changedAllowed.has(name))
      assert.deepEqual(after[name], before, "UNEXPECTED_TABLE_DELTA:" + name);
  assert.deepEqual(
    after["app.m9_woo_connected_trials"],
    initial["app.m9_woo_connected_trials"],
  );
  const books = [
    "public.inventory_by_location",
    "public.inventory_movements",
    "public.inventory_reservation_movements",
    "public.sales",
    "public.sale_payments",
    "public.cash_movements",
  ];
  const delta = Object.fromEntries(
    books.map((n) => [
      n,
      {
        before_rows: initial[n].rows,
        after_rows: after[n].rows,
        added_rows: after[n].rows - initial[n].rows,
        previous_rows_preserved: true,
      },
    ]),
  );
  await write("native-after.json", after);
  await write("durable-results.json", {
    protocol: "m9-native-finance-recovery-local-durable-1",
    simulated_application_ack_loss_after_real_commit: true,
    inflight_invisible_is_nonconclusive: true,
    inflight_read_did_not_wait_for_writer_commit: unavailableBeforeCommit,
    receipt_visible_after_commit_with_window_closed: true,
    post_and_cancel_receipts_read_with_session_closed: true,
    original_receipt_preserved: true,
    recovery_writes: 0,
    all_previous_rows_preserved: true,
    previous_tables: tables.length,
    own_synthetic_sales_retained_cancelled: finalState.sales,
    own_synthetic_receipts_retained: finalState.receipts,
    own_stock_and_reservations_zero: true,
    physical_cash_movements_nonzero: finalState.nonzero_cash,
    known_costs_fabricated: finalState.costs_known,
    book_deltas: delta,
    controls_disabled: true,
    real_gateway: false,
    real_woo_orders_created: 0,
    remote_operations: 0,
    auth_postgrest_real: false,
    writer_definition_sha256: sha(definitionBefore),
    reader_sql_sha256: sha(sql),
    note: "Local committed QA history remains. Not a global rollback, bank payment, checkout, or sixth connected campaign trial. Seeds retired by native compensating movements, never deleted.",
  });
  console.log(
    JSON.stringify({
      rollback_tables: tables.length,
      checks,
      negative_rejections: negative,
      durable_sales_cancelled: finalState.sales,
      receipts: finalState.receipts,
      all_previous_rows_preserved: true,
      native_net_stock_zero: true,
      remote_operations: 0,
    }),
  );
} finally {
  await Promise.allSettled(clients.map((c) => c.query("rollback")));
  await Promise.all(clients.map((c) => c.end()));
}
