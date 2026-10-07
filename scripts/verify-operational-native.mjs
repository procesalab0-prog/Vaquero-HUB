/** Isolated SQL QA, NOT Auth/PostgREST or a production deployment.
 * Provide QA_DATABASE_URL for an EMPTY local database named qa_*.
 * Never drops databases, rewrites deployed migrations or reads application secrets.
 */
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import pg from "pg";
import { verifyMeasureInventory } from "./verify-measure-inventory-native.mjs";
import { verifyMeasureCommercial } from "./verify-measure-commercial-native.mjs";
import { verifyUsdReference } from "./verify-usd-reference-native.mjs";
import { verifyUsdCheckout } from "./verify-usd-checkout-native.mjs";
import { verifyUsdClose } from "./verify-usd-close-native.mjs";
import { verifyUsdRefund } from "./verify-usd-refund-native.mjs";

const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  !/^\/qa_[a-z0-9_]+$/i.test(target.pathname)
)
  throw new Error(
    "Use an empty local database named qa_*. Remote or application databases are forbidden.",
  );
pg.types.setTypeParser(20, Number); // Fixture amounts are bounded, far below MAX_SAFE_INTEGER.
const db = new pg.Client({ connectionString: target.href });
const a = new pg.Client({
  connectionString: target.href,
  application_name: "qa-weight-a",
});
const b = new pg.Client({
  connectionString: target.href,
  application_name: "qa-weight-b",
});
await db.connect();
try {
  const existing = await db.query(
    "select 1 from pg_tables where schemaname in ('public','auth','storage','app') limit 1",
  );
  if (existing.rowCount)
    throw new Error("Database is not empty. No changes were made.");
  await db.query(`do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin; end if;
  end$$;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
  create function auth.role() returns text language sql stable as $$select coalesce(auth.jwt()->>'role',current_user)$$;
  grant usage on schema auth to anon,authenticated,service_role;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
  alter table storage.objects enable row level security;`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations) {
    try {
      await db.query(await readFile(new URL(name, directory), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${name}: ${error.message}`, { cause: error });
    }
  }
  const admin = crypto.randomUUID(),
    cashier = crypto.randomUUID();
  for (const [id, role] of [
    [admin, "ADMIN"],
    [cashier, "CASHIER"],
  ]) {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, `${id}@qa.test`],
    );
    await db.query(
      "insert into app_users(id,employee_code,full_name,role_id) select $1,$2,$3,id from roles where code=$3",
      [id, `QA${id.slice(0, 8).toUpperCase()}`, role],
    );
  }
  const locations = (
    await db.query(
      "insert into locations(code,name,type) values('QAONE','QA One','STORE'),('QATWO','QA Two','STORE') returning id",
    )
  ).rows.map((row) => row.id);
  await db.query(
    "insert into user_locations(user_id,location_id) values($1,$3),($2,$3)",
    [admin, cashier, locations[0]],
  );
  const category = (
    await db.query("select id from categories where is_active limit 1")
  ).rows[0].id;
  const login = async (client, id) => {
    await client.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id,
    ]);
    await client.query("set role authenticated");
  };
  await login(db, admin);
  const product = (
    await db.query(
      "select create_catalog_product('QA Native Product',$1,$2::jsonb) result",
      [
        category,
        JSON.stringify([
          { cost_cents: 10000, price_cents: 25000, attributes: {} },
        ]),
      ],
    )
  ).rows[0].result;
  const variant = (
    await db.query(
      "select variant_id from search_catalog('QA Native Product',5)",
    )
  ).rows[0].variant_id;
  await db.query("select set_product_measure_unit($1,'PAIR','PIECE')", [
    product.product_id,
  ]);
  await assert.rejects(
    () =>
      db.query("select set_product_measure_unit($1,'KILO','PAIR')", [
        product.product_id,
      ]),
    /UNIT_FRACTIONAL_FLOW_PENDING/,
  );
  await assert.rejects(
    () =>
      db.query("select set_product_measure_unit($1,'PIECE','PIECE')", [
        product.product_id,
      ]),
    /STALE_PRODUCT_UNIT/,
  );
  await db.query(
    "select apply_inventory_adjustment($1,$2,0,3,'CONTEO_FISICO','QA native')",
    [variant, locations[0]],
  );
  await assert.rejects(
    () =>
      db.query("select set_product_measure_unit($1,'PIECE','PAIR')", [
        product.product_id,
      ]),
    /PRODUCT_UNIT_HAS_HISTORY/,
  );
  const register = (
    await db.query("select (create_cash_register($1,'QA01','QA 01')).id", [
      locations[0],
    ])
  ).rows[0].id;
  const session = (
    await db.query("select (open_cash_session($1,50000)).id", [register])
  ).rows[0].id;
  const quote = (
    await db.query(
      "select (create_quote_v2($1,$2::jsonb,null,null,null,'Empresa QA')).*",
      [
        locations[0],
        JSON.stringify([
          {
            variant_id: variant,
            quantity: 2,
            unit_price_cents: 22000,
            discount_cents: 1000,
          },
        ]),
      ],
    )
  ).rows[0];
  assert.equal(quote.total_cents, 43000);
  await db.query("select update_catalog_variant_price($1,30000)", [variant]);
  const sale = (
    await db.query("select (convert_quote_to_sale($1,$2,$3,$4::jsonb)).*", [
      quote.id,
      crypto.randomUUID(),
      session,
      JSON.stringify([
        { method_code: "CASH", amount_cents: 43000, tendered_cents: 45000 },
      ]),
    ])
  ).rows[0];
  assert.equal(sale.total_cents, 43000);
  // Mixed quick/catalog sale: only the real variant may move physical stock.
  const quickItem = {
    variant_id: crypto.randomUUID(),
    quantity: 2,
    gift_receipt: false,
    quick: { name: "Accesorio sin catálogo QA", unit_price_cents: 1999 },
  };
  const mixedItems = [
    { variant_id: variant, quantity: 1, gift_receipt: false },
    quickItem,
  ];
  const quickKey = crypto.randomUUID();
  const mixedArgs = [
    quickKey,
    session,
    JSON.stringify(mixedItems),
    JSON.stringify([
      { method_code: "CASH", amount_cents: 33998, tendered_cents: 34000 },
    ]),
  ];
  const mixedSql = "select (create_sale($1,$2,$3::jsonb,$4::jsonb)).*";
  const mixedSale = (await db.query(mixedSql, mixedArgs)).rows[0];
  assert.equal(mixedSale.total_cents, 33998);
  assert.equal((await db.query(mixedSql, mixedArgs)).rows[0].id, mixedSale.id);
  const quickReceipt = (
    await db.query("select get_sale_receipt($1) result", [mixedSale.id])
  ).rows[0].result;
  assert.equal(quickReceipt.items.length, 2);
  assert.equal(quickReceipt.items[1].sku, "");
  assert.equal(quickReceipt.items[1].product_name, quickItem.quick.name);
  const recoverable = (
    await db.query("select list_quick_sale_items($1) result", [locations[0]])
  ).rows[0].result;
  assert.equal(recoverable[0].product_name, quickItem.quick.name);
  assert.equal("unit_cost_cents" in recoverable[0], false);
  await db.query("select cancel_sale($1,$2)", [
    mixedSale.id,
    "QA cancelar venta mixta",
  ]);
  await db.query("reset role");
  const quickSource = (
    await db.query(
      "select variant_id,sku,quick_cost_recorded from sale_items where sale_id=$1 and quick_line_id=$2",
      [mixedSale.id, quickItem.variant_id],
    )
  ).rows[0];
  assert.equal(quickSource.variant_id, null);
  assert.equal(quickSource.sku, null);
  assert.equal(quickSource.quick_cost_recorded, false);
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('anon','public.list_quick_sale_items(uuid,integer)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','public.sale_items','INSERT') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select qty from inventory_by_location where variant_id=$1 and location_id=$2",
          [variant, locations[0]],
        )
      ).rows[0].qty,
    ),
    1,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) qty from inventory_movements where reference_id=$1",
          [mixedSale.id],
        )
      ).rows[0].qty,
    ),
    2,
  );
  assert.equal(
    Number(
      (
        await db.query("select count(*) qty from variants where id=$1", [
          quickItem.variant_id,
        ])
      ).rows[0].qty,
    ),
    0,
  );
  await login(db, admin);
  const quickDraft = (
    await db.query("select hold_pos_draft($1,$2::jsonb,null,0,$3) id", [
      session,
      JSON.stringify([quickItem]),
      "QA rápido",
    ])
  ).rows[0].id;
  const resumedQuick = (
    await db.query("select resume_pos_draft($1) result", [quickDraft])
  ).rows[0].result;
  assert.equal(resumedQuick.items[0].quick.unit_price_cents, 1999);
  await db.query("select save_pos_current_draft($1,$2::jsonb)", [
    session,
    "[]",
  ]);
  await login(db, cashier);
  await assert.rejects(
    () =>
      db.query("select save_pos_current_draft($1,$2::jsonb)", [
        session,
        JSON.stringify([quickItem]),
      ]),
    /SESSION_FORBIDDEN/,
  );
  await db.query("reset role");
  const cashierRegister = (
    await db.query(
      "insert into cash_registers(location_id,code,name) values($1,'QA02','QA02') returning id",
      [locations[0]],
    )
  ).rows[0].id;
  await login(db, cashier);
  const cashierSession = (
    await db.query("select (open_cash_session($1,0)).id", [cashierRegister])
  ).rows[0].id;
  const unauthorizedCost = {
    ...quickItem,
    quick: { ...quickItem.quick, unit_cost_cents: 100 },
  };
  await assert.rejects(
    () =>
      db.query(mixedSql, [
        crypto.randomUUID(),
        cashierSession,
        JSON.stringify([unauthorizedCost]),
        JSON.stringify([
          { method_code: "CASH", amount_cents: 3998, tendered_cents: 4000 },
        ]),
      ]),
    /QUICK_COST_FORBIDDEN/,
  );
  const quickSale = (
    await db.query(mixedSql, [
      crypto.randomUUID(),
      cashierSession,
      JSON.stringify([quickItem]),
      JSON.stringify([
        { method_code: "CASH", amount_cents: 3998, tendered_cents: 4000 },
      ]),
    ])
  ).rows[0];
  const returnable = (
    await db.query("select get_returnable_sale($1) result", [quickSale.id])
  ).rows[0].result;
  assert.equal(returnable.items[0].variant_id, null);
  await db.query("reset role");
  const physicalBefore = Number(
    (await db.query("select count(*) n from inventory_movements")).rows[0].n,
  );
  const token = (
    await db.query(
      "insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at) values($1,$2,'returns.authorize',now()+interval '5 minutes') returning id",
      [cashier, admin],
    )
  ).rows[0].id;
  await login(db, cashier);
  const returnArgs = [
    crypto.randomUUID(),
    cashierSession,
    quickSale.id,
    JSON.stringify([
      {
        sale_item_id: returnable.items[0].sale_item_id,
        quantity: 1,
        condition: "DAMAGED",
      },
    ]),
    "[]",
    "[]",
    "[]",
    token,
    "QA devolución rápida parcial",
  ];
  const returnSql =
    "select create_return_exchange($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9) result";
  const quickReturn = (await db.query(returnSql, returnArgs)).rows[0].result;
  assert.equal(quickReturn.difference_cents, -1999);
  assert.equal(
    (await db.query(returnSql, returnArgs)).rows[0].result.id,
    quickReturn.id,
  );
  await assert.rejects(
    () => db.query(returnSql, [crypto.randomUUID(), ...returnArgs.slice(1)]),
    /RETURN_AUTHORIZATION_REQUIRED/,
  );
  await db.query("reset role");
  assert.equal(
    Number(
      (await db.query("select count(*) n from inventory_movements")).rows[0].n,
    ),
    physicalBefore,
  );
  assert.equal(
    (
      await db.query("select variant_id from return_items where return_id=$1", [
        quickReturn.id,
      ])
    ).rows[0].variant_id,
    null,
  );
  await login(db, admin);
  // Raw quantity checks must reject excess precision BEFORE casts can round it.
  await assert.rejects(
    () =>
      db.query(mixedSql, [
        crypto.randomUUID(),
        session,
        JSON.stringify([
          { variant_id: variant, quantity: 1.0001, gift_receipt: false },
        ]),
        JSON.stringify([
          { method_code: "CASH", amount_cents: 30000, tendered_cents: 30000 },
        ]),
      ]),
    /INVALID_MEASURE_QUANTITY/,
  );
  await assert.rejects(
    () =>
      db.query("select create_quote_v2($1,$2::jsonb)", [
        locations[0],
        JSON.stringify([{ variant_id: variant, quantity: 1.5 }]),
      ]),
    /INVALID_MEASURE_QUANTITY/,
  );
  await assert.rejects(
    () =>
      db.query(
        "select apply_inventory_adjustment($1,$2,1,1.0001,'CONTEO_FISICO','QA precisión')",
        [variant, locations[0]],
      ),
    /INVALID_MEASURE_QUANTITY/,
  );
  const precisionCount = (
    await db.query("select create_inventory_count($1) result", [locations[0]])
  ).rows[0].result;
  await assert.rejects(
    () =>
      db.query("select record_inventory_count_item($1,$2,1.0001)", [
        precisionCount.id,
        variant,
      ]),
    /INVALID_MEASURE_QUANTITY/,
  );
  await assert.rejects(
    () =>
      db.query("select create_transfer($1,$2,$3::jsonb)", [
        locations[0],
        locations[1],
        JSON.stringify([{ variant_id: variant, qty: 1.0001 }]),
      ]),
    /INVALID_MEASURE_QUANTITY/,
  );
  const supplier = (
    await db.query("select upsert_supplier(null,'QA','Proveedor QA') id")
  ).rows[0].id;
  // Integer units still reject fractional orders; the widened schema cannot
  // turn half a pair into a full pair or bypass the product's measurement policy.
  await assert.rejects(
    () =>
      db.query("select create_purchase_order($1,$2,$3::jsonb)", [
        supplier,
        locations[0],
        JSON.stringify([
          { variant_id: variant, qty: 1.5, unit_cost_cents: 10000 },
        ]),
      ]),
    /INVALID_MEASURE_QUANTITY/,
  );
  await assert.rejects(
    () =>
      db.query("select create_purchase_order($1,$2,$3::jsonb)", [
        supplier,
        locations[0],
        JSON.stringify([
          { variant_id: variant, qty: 1.0001, unit_cost_cents: 10000 },
        ]),
      ]),
    /INVALID_PURCHASE_ITEMS/,
  );
  const createOrder = async (client, location, qty, cost) => {
    const order = (
      await client.query(
        "select create_purchase_order($1,$2,$3::jsonb) result",
        [
          supplier,
          location,
          JSON.stringify([{ variant_id: variant, qty, unit_cost_cents: cost }]),
        ],
      )
    ).rows[0].result;
    const item = (
      await client.query(
        "select id from purchase_items where purchase_order_id=$1",
        [order.id],
      )
    ).rows[0].id;
    return [
      order.id,
      JSON.stringify([{ purchase_item_id: item, qty }]),
      crypto.randomUUID(),
    ];
  };
  const receiveSql = "select receive_purchase_order($1,$2::jsonb,$3)";
  const receipt = await createOrder(db, locations[0], 2, 20000);
  const purchaseV2 = (
    await db.query("select * from list_purchase_orders_v2($1)", [locations[0]])
  ).rows[0];
  assert.equal(Number(purchaseV2.ordered_qty), 2);
  assert.equal(Number(purchaseV2.total_cents), 40000);
  assert.equal(purchaseV2.items[0].measure_unit_code, "PAIR");
  await assert.rejects(
    () =>
      db.query(receiveSql, [
        receipt[0],
        JSON.stringify([
          {
            purchase_item_id: JSON.parse(receipt[1])[0].purchase_item_id,
            qty: 0.5,
          },
        ]),
        crypto.randomUUID(),
      ]),
    /INVALID_MEASURE_QUANTITY/,
  );
  const cost = async () =>
    Number(
      (
        await db.query(
          "select cost_cents from search_catalog('QA Native Product',5)",
        )
      ).rows[0].cost_cents,
    );
  assert.equal(await cost(), 10000);
  await db.query(receiveSql, receipt);
  assert.equal(await cost(), 16667);
  await db.query(receiveSql, receipt);
  assert.equal(await cost(), 16667);
  const note = (
    await db.query("select save_workspace_note('Privada QA',null) result")
  ).rows[0].result;
  await db.query("select create_measure_unit('BOXQA','Caja QA',0)");
  await login(db, cashier);
  assert.equal(
    (
      await db.query("select list_workspace_notes($1) result", [locations[0]])
    ).rows[0].result.some((row) => row.id === note.id),
    false,
  );
  await assert.rejects(
    () =>
      db.query("select save_workspace_note('Intruso',null,$1,1)", [note.id]),
    /NOTE_NOT_EDITABLE/,
  );
  await assert.rejects(
    () => db.query("select create_measure_unit('NOQA','No permitido',0)"),
    /NOT_AUTHORIZED/,
  );
  await login(db, admin);
  await Promise.all([a.connect(), b.connect()]);
  await login(a, admin);
  await login(b, admin);
  const receiptA = await createOrder(a, locations[0], 1, 20000);
  const receiptB = await createOrder(b, locations[1], 1, 30000);
  await a.query("begin");
  await a.query(receiveSql, receiptA);
  let settled = false;
  const pending = b.query(receiveSql, receiptB).finally(() => {
    settled = true;
  });
  let waiting = false;
  // Observer must not run as cashier: pg_stat_activity details are restricted.
  await db.query("reset role");
  for (let i = 0; i < 40; i++) {
    const stat = await db.query(
      "select wait_event_type from pg_stat_activity where application_name='qa-weight-b'",
    );
    if (stat.rows[0]?.wait_event_type === "Lock") {
      waiting = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  try {
    assert.equal(waiting, true);
    assert.equal(settled, false);
  } finally {
    await a.query("commit");
    await pending;
  }
  const final = (
    await db.query(
      "select cost_cents,(select sum(qty) from inventory_by_location where variant_id=v.id) qty from variants v where id=$1",
      [variant],
    )
  ).rows[0];
  assert.equal(Number(final.qty), 5);
  assert.equal(Number(final.cost_cents), 20000);
  const measured = await verifyMeasureInventory(db, {
    login,
    admin,
    locations,
    category,
    supplier,
  });
  // Concurrent decimal counts on the same stock row must not both use 0.625
  // as their starting balance. A keeps its transaction open; observe B waiting
  // on a genuine database lock before committing A.
  const decimalAdjustment =
    "select apply_inventory_adjustment($1,$2,0.625,0.375,'CONTEO_FISICO','QA decimal concurrente')";
  const decimalArgs = [measured.variant, locations[0]];
  await a.query("begin");
  await a.query(decimalAdjustment, decimalArgs);
  let decimalSettled = false;
  const decimalPending = b
    .query(decimalAdjustment, decimalArgs)
    .then(
      () => null,
      (error) => error,
    )
    .finally(() => {
      decimalSettled = true;
    });
  let decimalWaiting = false;
  for (let i = 0; i < 40; i++) {
    const stat = await db.query(
      "select wait_event_type from pg_stat_activity where application_name='qa-weight-b'",
    );
    if (stat.rows[0]?.wait_event_type === "Lock") {
      decimalWaiting = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  try {
    assert.equal(decimalWaiting, true);
    assert.equal(decimalSettled, false);
  } finally {
    await a.query("commit");
  }
  const staleAdjustment = await decimalPending;
  assert.match(staleAdjustment?.message ?? "", /STALE_INVENTORY/);
  const decimalBalance = (
    await db.query(
      "select sum(qty) qty from inventory_by_location where variant_id=$1",
      [measured.variant],
    )
  ).rows[0].qty;
  const decimalLedger = (
    await db.query(
      "select sum(quantity) qty from inventory_movements where variant_id=$1",
      [measured.variant],
    )
  ).rows[0].qty;
  assert.equal(Number(decimalBalance), 0.875);
  assert.equal(Number(decimalLedger), 0.875);
  await verifyMeasureCommercial(db, {
    login,
    admin,
    locations,
    session,
    variant: measured.variant,
    pieceVariant: variant,
  });
  await login(a, admin);
  await login(b, cashier);
  const fractionalSaleItems = JSON.stringify([
    { variant_id: measured.variant, quantity: 2, gift_receipt: false },
  ]);
  const fractionalPayment = JSON.stringify([
    { method_code: "CASH", amount_cents: 24690, tendered_cents: 24690 },
  ]);
  await a.query("begin");
  await a.query(mixedSql, [
    crypto.randomUUID(),
    session,
    fractionalSaleItems,
    fractionalPayment,
  ]);
  let saleWaiting = false,
    saleSettled = false;
  const parallelSale = b
    .query(mixedSql, [
      crypto.randomUUID(),
      cashierSession,
      fractionalSaleItems,
      fractionalPayment,
    ])
    .then(
      () => null,
      (error) => error,
    )
    .finally(() => {
      saleSettled = true;
    });
  for (let i = 0; i < 40; i++) {
    const stat = await db.query(
      "select wait_event_type from pg_stat_activity where application_name='qa-weight-b'",
    );
    if (stat.rows[0]?.wait_event_type === "Lock") {
      saleWaiting = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  try {
    assert.equal(saleWaiting, true);
    assert.equal(saleSettled, false);
  } finally {
    await a.query("commit");
  }
  const rejectedSale = await parallelSale;
  assert.match(rejectedSale?.message ?? "", /INSUFFICIENT_STOCK/);
  const finalMeasure = (
    await db.query(
      "select (select sum(qty) from inventory_by_location where variant_id=$1) stock,(select sum(quantity) from inventory_movements where variant_id=$1) ledger",
      [measured.variant],
    )
  ).rows[0];
  assert.equal(Number(finalMeasure.stock), 2.25);
  assert.equal(Number(finalMeasure.ledger), 2.25);
  await verifyUsdReference(db, {
    login,
    admin,
    cashier,
    session,
    locations,
    a,
    b,
  });
  await verifyUsdCheckout(db, {
    login,
    admin,
    session,
    locations,
    variant,
    a,
    b,
  });
  await verifyUsdClose(db, { login, admin, cashier, session, a, b });
  await verifyUsdRefund(db, { login, admin, locations, variant });
  console.log(
    `${migrations.length} migrations + quick/catalog checkout, unit guards, fractional commercial backend, note privacy, gated USD checkout/reference/original-MXN-refund/blind close and actual two-connection cost/count/stock/USD-change/USD-close locks: PASS. Fractional product assignment and USD checkout remain gated; Auth/Storage mocked; NOT staging/PostgREST.`,
  );
} finally {
  await Promise.allSettled([a.end(), b.end(), db.end()]);
}
