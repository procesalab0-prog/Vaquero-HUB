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
  url.pathname !== "/qa_m9_woo_closedcash_20261023" ||
  url.search ||
  url.hash ||
  url.username !== "postgres"
)
  throw Error("DEDICATED_LOCAL_WOO_CLOSED_CASH_CLONE_REQUIRED");
if (!process.argv[2]) throw Error("NEW_PRIVATE_OUTPUT_DIRECTORY_REQUIRED");
const out = process.argv[2],
  clients = Array.from(
    { length: 3 },
    (_, i) =>
      new pg.Client({
        connectionString: url.href,
        application_name: "m9-local-closedcash-" + i,
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
      "insert into public.locations(code,name,type)values($1,'SYNTHETIC WOO CLOSED CASH QA','STORE')returning id",
      ["QAWR" + f.salt.toUpperCase()],
    )
  ).id;
  f.register = (
    await one(
      db,
      "insert into public.cash_registers(location_id,code,name)values($1,$2,'SYNTHETIC WOO CLOSED CASH QA')returning id",
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
  f.categoryName = "SYNTHETIC WOO CLOSED CASH " + f.salt;
  f.category = (
    await one(db, "insert into public.categories(name)values($1)returning id", [
      "SYNTHETIC WOO CLOSED CASH " + f.salt,
    ])
  ).id;
  for (let i = 0; i < 2; i++) {
    const code = "SYNTHETIC-WOO-CLOSED-" + f.salt + "-" + i;
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
// The fixture builders above intentionally reuse the accepted recovery runner's
// native adapters. Only their synthetic namespace and exact clone guard differ.
let checks = 0,
  negative = 0,
  baseline = null,
  baselineDefinitions = null,
  durableStarted = false;
const direct = (f) =>
  db.query(
    "select public.cancel_sale($1,'SYNTHETIC DIRECT CALL MUST NOT AUTHORIZE')",
    [f.native.sale_id],
  );
const capabilityExists = async (c = db) =>
  (
    await one(
      c,
      "select to_regclass('pg_temp.m9_woo_closed_cancel_cap')is not null present",
    )
  ).present;
async function reject(run, re, edit = null) {
  const initial = await audit();
  await db.query("savepoint negative_closed");
  try {
    if (edit) await edit();
    await assert.rejects(run, re);
    negative++;
  } finally {
    await db.query("rollback to negative_closed;release negative_closed");
  }
  assert.deepEqual(await audit(), initial);
  checks++;
}
async function closedSnapshot(f, c = db) {
  return (
    await one(
      c,
      "select to_jsonb(s)v from public.cash_sessions s where id=$1",
      [f.session],
    )
  ).v;
}
async function finish(f) {
  await actor(db, f.actor, false);
  await db.query("begin");
  for (const id of f.ids)
    await db.query(
      "select app.apply_movement($1,$2,'ADJUSTMENT',-3,'SYNTHETIC_WOO_CLOSED_RETIRE',$3,'{\"synthetic\":true}')",
      [id, f.location, f.salt],
    );
  await db.query(
    "update public.variants set is_active=false where id=any($1::uuid[])",
    [f.ids],
  );
  await db.query(
    "update public.products set is_active=false where id=any($1::uuid[])",
    [f.products],
  );
  await db.query(
    "update public.cash_registers set is_active=false where id=$1",
    [f.register],
  );
  if (!f.methodBefore || !f.methodBefore.is_active)
    await db.query(
      "update public.payment_methods set is_active=false where code='M9_WEB_TEST'",
    );
  await disable();
  await db.query("commit");
  const s = await state(f);
  assert.equal(s.completed, 0);
  assert.equal(s.nonzero_cash, 0);
  assert.equal(s.costs_known, 0);
  assert.ok(s.stock.every((x) => x.qty === 0 && x.reserved === 0));
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function assertBlocked(observer, waitingPid, holderPid) {
  for (let n = 0; n < 100; n++) {
    const { p } = await one(observer, "select pg_blocking_pids($1)p", [
      waitingPid,
    ]);
    if (p.includes(holderPid)) return;
    await pause(20);
  }
  throw Error("EXPECTED_REAL_BLOCKING_NOT_OBSERVED");
}
async function pid(c) {
  return (await one(c, "select pg_backend_pid()pid")).pid;
}
async function definitions() {
  const d = {};
  for (const name of [
    "app.cancel_sale_base(uuid,text)",
    "app.m9_woo_native_finance(jsonb)",
    "app.m9_woo_assert_finance_sale(uuid)",
    "public.cancel_sale(uuid,text)",
  ])
    d[name] = (
      await one(db, "select pg_get_functiondef($1::regprocedure)d", [name])
    ).d;
  return d;
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
  const initial = await audit(),
    defsBefore = await definitions();
  baseline = initial;
  baselineDefinitions = defsBefore;
  await write("native-before.json", initial);
  const sql = await readFile(
    new URL("./woo-closed-cash-cancel-forward.sql", import.meta.url),
    "utf8",
  );
  const forward = sql.replace(/^begin;\n/m, "").replace(/^commit;\n?$/m, "");
  await db.query(
    "begin;set local statement_timeout='20s';set local lock_timeout='5s'",
  );
  await db.query(forward);
  const f = await fixture();
  f.native = await post(db, f.packet);
  const cancel = await refundPacket(f);
  await reject(() => direct(f), /WOO_FINANCE_SERVICE_REQUIRED/);
  await reject(
    () => direct(f),
    /WOO_FINANCE_SERVICE_REQUIRED/,
    () =>
      db.query(
        "select set_config('app.m9_woo_finance_binding',$1,true),set_config('app.m9_woo_cancel_capability',$2,true)",
        [f.native.posting_id, randomUUID()],
      ),
  );
  await db.query("savepoint ordinary_pos");
  const ordinary = (
    await one(
      db,
      "select to_jsonb(public.create_sale($1,$2,$3::jsonb,$4::jsonb,null,'[]','SYNTHETIC CLOSED CASH POS REGRESSION'))r",
      [
        randomUUID(),
        f.session,
        JSON.stringify([{ variant_id: f.ids[0], quantity: 1 }]),
        JSON.stringify([
          {
            method_code: "M9_WEB_TEST",
            amount_cents: 10000,
            reference: "SYNTHETIC-ordinary-" + f.salt,
          },
        ]),
      ],
    )
  ).r;
  await close(f);
  await enable(f);
  await db.query("savepoint ordinary_attempt");
  await assert.rejects(
    () =>
      db.query(
        "select public.cancel_sale($1,'SYNTHETIC POS CLOSED MUST STILL REJECT')",
        [ordinary.id],
      ),
    /SALE_SESSION_CLOSED/,
  );
  negative++;
  await db.query("rollback to ordinary_pos;release ordinary_pos");
  checks++;
  await close(f);
  await enable(f);
  const closedBefore = await closedSnapshot(f);
  await reject(() => post(db, f.packet), /WOO_FINANCE_SESSION_REQUIRED/);
  await reject(() => direct(f), /WOO_FINANCE_SERVICE_REQUIRED/);
  await reject(
    () => direct(f),
    /WOO_FINANCE_SERVICE_REQUIRED/,
    () =>
      db.query(
        "select set_config('app.m9_woo_finance_binding',$1,true),set_config('app.m9_woo_cancel_capability',$2,true)",
        [f.native.posting_id, randomUUID()],
      ),
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    await reject(
      () => post(db, cancel),
      (e) => e.code === "42501",
      () => db.query("set local role " + role),
    );
    await reject(
      () => direct(f),
      (e) => e.code === "42501",
      async () => {
        await db.query(
          "select set_config('app.m9_woo_finance_binding',$1,true),set_config('app.m9_woo_cancel_capability',$2,true)",
          [f.native.posting_id, randomUUID()],
        );
        await db.query("set local role " + role);
      },
    );
  }
  for (const perm of ["pos.sell", "sales.cancel"])
    await reject(
      () => post(db, cancel),
      /WOO_FINANCE_(DISABLED|SESSION_REQUIRED)/,
      () =>
        db.query(
          "delete from public.role_permissions where role_id=(select role_id from public.app_users where id=$1)and permission_code=$2",
          [f.actor, perm],
        ),
    );
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_DISABLED/,
    () =>
      db.query("update public.app_users set is_active=false where id=$1", [
        f.actor,
      ]),
  );
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_DISABLED/,
    () =>
      db.query("update public.locations set is_active=false where id=$1", [
        f.location,
      ]),
  );
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_DISABLED/,
    () =>
      db.query("update public.locations set type='WAREHOUSE'where id=$1", [
        f.location,
      ]),
  );
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_SESSION_REQUIRED/,
    () =>
      db.query(
        "update app.m9_woo_finance_pilot_control set cash_session_id=(select id from public.cash_sessions where id<>$1 order by id limit 1)where singleton",
        [f.session],
      ),
  );
  for (const kind of ["CASH", "CARD", "TRANSFER"])
    await reject(
      () => post(db, cancel),
      /WOO_FINANCE_SERVICE_REQUIRED/,
      () =>
        db.query(
          "update public.payment_methods set kind=$1 where code='M9_WEB_TEST'",
          [kind],
        ),
    );
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_SERVICE_REQUIRED/,
    async () => {
      await db.query("select set_config('app.sales_write','on',true)");
      await db.query(
        "update public.sale_payments set method_code='USD'where sale_id=$1",
        [f.native.sale_id],
      );
    },
  );
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_SERVICE_REQUIRED/,
    async () => {
      await db.query("select set_config('app.sales_write','on',true)");
      await db.query(
        "update public.sale_payments set amount_cents=amount_cents+1 where sale_id=$1",
        [f.native.sale_id],
      );
    },
  );
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_SERVICE_REQUIRED/,
    async () => {
      await db.query("select set_config('app.sales_write','on',true)");
      await db.query(
        "insert into public.sale_payments(sale_id,method_code,amount_cents,reference)values($1,'M9_WEB_TEST',1,'SYNTHETIC mixed forbidden')",
        [f.native.sale_id],
      );
    },
  );
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_FULL_RETURN_PROOF_REQUIRED/,
    async () => {
      await db.query(
        "alter table app.m9_woo_finance_test_evidence disable trigger m9_woo_finance_test_evidence_immutable",
      );
      await db.query(
        "update app.m9_woo_finance_test_evidence set physical_lines='[]'where id=$1",
        [cancel.evidence_id],
      );
    },
  );
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_EVIDENCE_REQUIRED/,
    async () => {
      await db.query(
        "alter table app.m9_woo_finance_test_evidence disable trigger m9_woo_finance_test_evidence_immutable",
      );
      await db.query(
        "update app.m9_woo_finance_test_evidence set observed_at=clock_timestamp()-interval'10 minutes'where id=$1",
        [cancel.evidence_id],
      );
    },
  );
  await reject(
    () => post(db, { ...cancel, expected_version: 1 }),
    /VERSION_CONFLICT/,
  );
  await reject(
    () => post(db, { ...cancel, evidence_sha256: "0".repeat(64) }),
    /EVIDENCE_REQUIRED/,
  );
  await reject(
    () => post(db, cancel),
    /WOO_CANCEL_CAPABILITY_COLLISION/,
    () =>
      db.query(
        "create temporary table m9_woo_closed_cancel_cap(unrelated text)on commit drop;insert into pg_temp.m9_woo_closed_cancel_cap values('SYNTHETIC DO NOT MUTATE')",
      ),
  );
  await db.query("savepoint foreign_temp");
  await db.query(
    "create temporary table m9_woo_closed_cancel_cap(unrelated text)on commit drop;insert into pg_temp.m9_woo_closed_cancel_cap values('SYNTHETIC FOREIGN OWNER');alter table pg_temp.m9_woo_closed_cancel_cap owner to authenticated",
  );
  assert.equal(
    (
      await one(db, "select app.m9_woo_cancel_capability($1,null,true)ok", [
        f.native.sale_id,
      ])
    ).ok,
    false,
  );
  const collisionBefore = (
    await one(
      db,
      "select md5(to_jsonb(t)::text)h from pg_temp.m9_woo_closed_cancel_cap t",
    )
  ).h;
  await db.query("savepoint collision_attempt");
  await assert.rejects(
    () => post(db, cancel),
    /WOO_CANCEL_CAPABILITY_COLLISION/,
  );
  negative++;
  await db.query("rollback to collision_attempt;release collision_attempt");
  assert.equal(
    (
      await one(
        db,
        "select md5(to_jsonb(t)::text)h from pg_temp.m9_woo_closed_cancel_cap t",
      )
    ).h,
    collisionBefore,
  );
  checks++;
  await db.query("rollback to foreign_temp;release foreign_temp");
  // Catch an actual failure AFTER the capability was consumed and native stock
  // began, then inspect restored context before rolling back the test savepoint.
  await db.query("savepoint interruption");
  await db.query(
    "select set_config('app.m9_woo_finance_binding','SYNTHETIC-old-binding',true),set_config('app.m9_woo_cancel_capability','SYNTHETIC-old-capability',true)",
  );
  await db.query(
    `create function pg_temp.fail_closed_cancel()returns trigger language plpgsql as $$begin if new.reference_id='${f.native.sale_id}'and new.movement_type='CANCELLATION'then raise exception 'SYNTHETIC_FAIL_AFTER_CAPABILITY';end if;return new;end$$;create trigger qa_closed_cancel_failure after insert on public.inventory_movements for each row execute function pg_temp.fail_closed_cancel()`,
  );
  await db.query(
    "create function pg_temp.catch_closed_cancel(p jsonb)returns jsonb language plpgsql as $$begin perform app.m9_woo_native_finance(p);return null;exception when others then return jsonb_build_object('error',SQLERRM,'binding',current_setting('app.m9_woo_finance_binding',true),'capability',current_setting('app.m9_woo_cancel_capability',true),'temp_exists',to_regclass('pg_temp.m9_woo_closed_cancel_cap')is not null);end$$",
  );
  const interrupted = (
    await one(db, "select pg_temp.catch_closed_cancel($1::jsonb)r", [cancel])
  ).r;
  assert.deepEqual(interrupted, {
    error: "SYNTHETIC_FAIL_AFTER_CAPABILITY",
    binding: "SYNTHETIC-old-binding",
    capability: "SYNTHETIC-old-capability",
    temp_exists: false,
  });
  negative++;
  checks++;
  await db.query("rollback to interruption;release interruption");
  // Reentrant cancellation sees an already-consumed capability, so the complete
  // outer transaction fails rather than performing the native engine twice.
  await reject(
    () => post(db, cancel),
    /WOO_FINANCE_SERVICE_REQUIRED/,
    () =>
      db.query(
        `create function pg_temp.reenter_closed_cancel()returns trigger language plpgsql as $$begin if new.reference_id='${f.native.sale_id}'and new.movement_type='CANCELLATION'then perform public.cancel_sale('${f.native.sale_id}','SYNTHETIC REENTRANT MUST REJECT');end if;return new;end$$;create trigger qa_closed_cancel_reenter after insert on public.inventory_movements for each row execute function pg_temp.reenter_closed_cancel()`,
      ),
  );
  const paidBefore = await one(
    db,
    "select md5(to_jsonb(p)::text)h from public.sale_payments p where sale_id=$1",
    [f.native.sale_id],
  );
  const cancelled = await post(db, cancel);
  assert.equal(cancelled.action, "FULL_CANCEL");
  assert.equal(cancelled.cash_movement_created, false);
  assert.equal(await capabilityExists(), false);
  checks++;
  assert.deepEqual(await closedSnapshot(f), closedBefore);
  assert.deepEqual(
    await one(
      db,
      "select md5(to_jsonb(p)::text)h from public.sale_payments p where sale_id=$1",
      [f.native.sale_id],
    ),
    paidBefore,
  );
  checks++;
  const afterCancel = await audit();
  assert.equal((await post(db, cancel)).replayed, true);
  assert.deepEqual(await audit(), afterCancel);
  checks++;
  await reject(
    () => post(db, { ...cancel, operation_id: cancel.operation_id + "-other" }),
    /WOO_FINANCE_PAYMENT_REUSED/,
  );
  await reject(() => direct(f), /WOO_FINANCE_SERVICE_REQUIRED/);
  assert.equal(
    (await readReceipt(db, cancel)).current_sale_status,
    "CANCELLED",
  );
  const final = await state(f);
  assert.equal(final.completed, 0);
  assert.equal(final.nonzero_cash, 0);
  assert.equal(final.costs_known, 0);
  assert.ok(final.stock.every((x) => x.qty === 3 && x.reserved === 0));
  checks++;
  const defsAfter = await definitions();
  assert.equal(
    defsBefore["public.cancel_sale(uuid,text)"],
    defsAfter["public.cancel_sale(uuid,text)"],
  );
  for (const role of ["anon", "authenticated", "service_role"])
    assert.equal(
      (
        await one(
          db,
          "select has_function_privilege($1,'app.m9_woo_cancel_capability(uuid,uuid,boolean)','EXECUTE')p",
          [role],
        )
      ).p,
      false,
    );
  checks++;
  await db.query("rollback");
  assert.deepEqual(await audit(), initial);
  assert.deepEqual(await definitions(), defsBefore);
  checks++;
  await write("rollback-results.json", {
    protocol: "m9-closed-cash-cancel-local-1",
    checks,
    negative_rejections: negative,
    rollback_tables: tables.length,
    rollback_exact: true,
    temporary_capability_removed: true,
    original_cash_session_and_payment_unchanged: true,
    public_cancel_wrapper_unchanged: true,
    POS_POST_CASH_CARD_USD_mixed_regressions_held: true,
    reentrancy_rejected: true,
    exception_context_restored: true,
    remote_operations: 0,
    auth_postgrest_real: false,
  });
  console.log(
    JSON.stringify({
      phase: "rollback",
      checks,
      negative,
      rollback_tables: tables.length,
    }),
  );
  // A separate LOCAL committed campaign, not one of the five connected orders.
  // Keep original rows and native compensation history instead of erasing them.
  durableStarted = true;
  await db.query("begin");
  await db.query(forward);
  await db.query("commit");
  for (const c of clients)
    await c.query("set statement_timeout='20s';set lock_timeout='10s'");
  const pids = await Promise.all(clients.map(pid)),
    cases = [];
  async function prepare(name) {
    await db.query("begin");
    const f = await fixture();
    f.native = await post(db, f.packet);
    f.cancel = await refundPacket(f);
    await write(name + "-requests.json", {
      synthetic: true,
      location: f.location,
      session: f.session,
      post: f.packet,
      cancel: f.cancel,
    });
    await db.query("commit");
    for (const c of clients) await actor(c, f.actor, false);
    return f;
  }
  // Close first: cancellation really blocks on the ORIGINAL session, then
  // succeeds with that same session CLOSED. A simultaneous duplicate blocks on
  // the sale and returns the same receipt after COMMIT, with no extra stock.
  const a = await prepare("close-first");
  await writer.query("begin");
  await writer.query(
    "select public.close_cash_session($1,0,'SYNTHETIC close-first QA')",
    [a.session],
  );
  const closedA = await closedSnapshot(a, writer);
  await db.query("begin");
  const waitingCancel = post(db, a.cancel).then(
    (v) => ({ v }),
    (e) => ({ e }),
  );
  await assertBlocked(reader, pids[0], pids[1]);
  await writer.query("commit");
  const first = await waitingCancel;
  if (first.e) throw first.e;
  await reader.query("begin");
  const waitingReplay = post(reader, a.cancel).then(
    (v) => ({ v }),
    (e) => ({ e }),
  );
  await assertBlocked(writer, pids[2], pids[0]);
  await db.query("commit");
  const replay = await waitingReplay;
  if (replay.e) throw replay.e;
  await reader.query("commit");
  assert.equal(replay.v.replayed, true);
  assert.equal(replay.v.receipt_id, first.v.receipt_id);
  assert.deepEqual(await closedSnapshot(a), closedA);
  assert.equal(await capabilityExists(), false);
  await disable();
  const recovered = await readReceipt(reader, a.cancel);
  assert.equal(recovered.receipt.receipt_id, first.v.receipt_id);
  assert.equal(recovered.current_sale_status, "CANCELLED");
  await finish(a);
  cases.push({
    order: "close-first",
    session_lock_block_observed: true,
    original_session_stayed_closed: true,
    duplicate_sale_lock_block_observed: true,
    one_receipt: true,
    recovered_without_repost_after_gate_closed: true,
  });
  // Cancel first: the normal native sale→session order holds the closer until
  // the complete compensation/receipt commits. The closer then closes normally.
  const b = await prepare("cancel-first");
  await db.query("begin");
  const cancelledB = await post(db, b.cancel);
  await writer.query("begin");
  const waitingClose = writer
    .query(
      "select public.close_cash_session($1,0,'SYNTHETIC cancel-first QA')",
      [b.session],
    )
    .then(
      (v) => ({ v }),
      (e) => ({ e }),
    );
  await assertBlocked(reader, pids[1], pids[0]);
  await db.query("commit");
  const closeB = await waitingClose;
  if (closeB.e) throw closeB.e;
  await writer.query("commit");
  assert.equal((await closedSnapshot(b)).status, "CLOSED");
  const beforeReplay = await audit();
  assert.equal((await post(db, b.cancel)).replayed, true);
  assert.deepEqual(await audit(), beforeReplay);
  await disable();
  assert.equal(
    (await readReceipt(reader, b.cancel)).receipt.receipt_id,
    cancelledB.receipt_id,
  );
  await finish(b);
  cases.push({
    order: "cancel-first",
    session_lock_block_observed: true,
    closer_completed_after_cancel_commit: true,
    replay_zero_new_rows: true,
    recovered_after_original_session_closed: true,
  });
  const after = await audit();
  await write("native-after.json", after);
  for (const [name, prior] of Object.entries(initial)) {
    const remaining = [...after[name].row_hashes];
    for (const h of prior.row_hashes) {
      const i = remaining.indexOf(h);
      assert.notEqual(i, -1, "PREVIOUS_ROW_CHANGED:" + name);
      remaining.splice(i, 1);
    }
  }
  const allowed = new Set([
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
  for (const [name, prior] of Object.entries(initial))
    if (!allowed.has(name))
      assert.deepEqual(after[name], prior, "UNEXPECTED_TABLE_DELTA:" + name);
  assert.deepEqual(
    after["app.m9_woo_connected_trials"],
    initial["app.m9_woo_connected_trials"],
  );
  assert.deepEqual(await controls(), {
    stock: false,
    finance: false,
    rehearsal: false,
  });
  const books = Object.fromEntries(
    [
      "public.inventory_by_location",
      "public.inventory_movements",
      "public.inventory_reservation_movements",
      "public.sales",
      "public.sale_payments",
      "public.cash_movements",
    ].map((name) => [
      name,
      {
        before: initial[name].rows,
        after: after[name].rows,
        added: after[name].rows - initial[name].rows,
        all_previous_rows_preserved: true,
      },
    ]),
  );
  const finalDefs = await definitions();
  await write(
    "definitions-after.json",
    Object.fromEntries(
      Object.entries(finalDefs).map(([name, d]) => [
        name,
        { sha256: sha(d), definition: d },
      ]),
    ),
  );
  assert.equal(
    finalDefs["public.cancel_sale(uuid,text)"],
    defsBefore["public.cancel_sale(uuid,text)"],
  );
  await write("durable-results.json", {
    protocol: "m9-closed-cash-cancel-durable-races-1",
    cases,
    real_local_transactions_committed: true,
    all_previous_rows_preserved: true,
    previous_tables: tables.length,
    previous_native_receipts: initial["app.m9_woo_finance_receipts"].rows,
    own_synthetic_sales_cancelled: 4,
    own_native_receipts_retained: 4,
    stock_and_reservations_zero: true,
    costs_unknown: true,
    physical_cash_nonzero: 0,
    books,
    temporary_capability_absent: true,
    controls_disabled: true,
    connected_campaign_unchanged: true,
    remote_operations: 0,
    real_woo_orders_created: 0,
    real_gateway: false,
    auth_postgrest_real: false,
    sql_sha256: sha(sql),
    note: "Local synthetic committed history retained. This is not global rollback, a remote campaign trial, or 24/7 production payment acceptance.",
  });
  console.log(
    JSON.stringify({
      phase: "durable",
      races: cases.length,
      previous_rows_preserved: true,
      previous_receipts: initial["app.m9_woo_finance_receipts"].rows,
    }),
  );
} catch (e) {
  for (const c of clients) await c.query("rollback").catch(() => {});
  const postFailure = await audit();
  const defs = await definitions();
  const rollbackExact = baseline
    ? JSON.stringify(postFailure) === JSON.stringify(baseline)
    : null;
  const functionsExact = baselineDefinitions
    ? JSON.stringify(defs) === JSON.stringify(baselineDefinitions)
    : null;
  await write("failure.json", {
    error: e.message,
    code: e.code ?? null,
    checks,
    negative,
    durable_started: durableStarted,
    rollback_exact: rollbackExact,
    functions_unchanged: functionsExact,
    remote_operations: 0,
  }).catch(() => {});
  throw e;
} finally {
  await Promise.all(clients.map((c) => c.end()));
}
