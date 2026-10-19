import assert from "node:assert/strict";

// Isolated local fixture; outer runner enforces localhost, empty qa_* database.
export async function verifyInventoryCatalog(
  db,
  { login, admin, cashier, locations },
) {
  await db.query("reset role");
  const before = (await db.query("select count(*)::int n from variants"))
    .rows[0].n;
  await db.query("begin");
  try {
    await db.query(
      `with products_fixture as (
      insert into products(name,category_id,created_by,updated_by)
      select 'ZZ QA CATALOG '||lpad(i::text,4,'0'),(select id from categories where is_active limit 1),$1,$1
      from generate_series(1,610) i returning id,name
    ) insert into variants(product_id,sku,price_cents,cost_cents)
      select id,('800'||right(name,4))||'-'||app.luhn_check_digit('800'||right(name,4)),10000,null from products_fixture`,
      [admin],
    );
    const ids = (
      await db.query(
        "select v.id from variants v join products p on p.id=v.product_id where p.name like 'ZZ QA CATALOG %' order by p.name",
      )
    ).rows.map((r) => r.id);
    await db.query(
      `insert into barcodes(variant_id,code,symbology,source,is_primary)
      values($1,'000000939','LEGACY','SICAR',true),($2,'QA%_\\literal','LEGACY','MANUAL',true)`,
      [ids[609], ids[608]],
    );
    await db.query(
      "update products set measure_unit_code='PAIR' where id=(select product_id from variants where id=$1)",
      [ids[608]],
    );
    await login(db, admin);
    for (const [vid, loc, qty] of [
      [ids[609], locations[0], 1],
      [ids[608], locations[0], 4],
      [ids[607], locations[0], 2],
      [ids[609], locations[1], 90],
    ])
      await db.query(
        "select apply_inventory_adjustment($1,$2,0,$3,'CONTEO_FISICO','QA LOCAL catálogo, rollback')",
        [vid, loc, qty],
      );
    await db.query("reset role");
    const customer = (
      await db.query(
        "insert into customers(full_name,phone_e164,privacy_consent_at,privacy_notice_version) values('QA LOCAL catálogo','+523521110939',now(),'QA') returning id",
      )
    ).rows[0].id;
    const sid = (
      await db.query(
        "select id from cash_sessions where cashier_user_id=$1 and status='OPEN'",
        [admin],
      )
    ).rows[0].id;
    await login(db, admin);
    await db.query(
      "select create_layaway($1,$2,$3,current_date+30,$4::jsonb)",
      [
        crypto.randomUUID(),
        sid,
        customer,
        JSON.stringify([
          { variant_id: ids[607], quantity: 2, gift_receipt: false },
        ]),
      ],
    );
    await db.query("reset role");
    const color = (
      await db.query(
        "insert into attribute_values(type_code,value) values('COLOR','CAFÉ_% QA') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into variant_attributes(variant_id,type_code,value_id) values($1,'COLOR',$2)",
      [ids[609], color],
    );
    await login(db, admin);
    const call = async (
      query = "",
      filter = "all",
      page = 1,
      size = 50,
      exact = false,
      loc = locations[0],
    ) =>
      (
        await db.query("select get_inventory_catalog($1,$2,$3,$4,$5,$6) r", [
          loc,
          query,
          filter,
          page,
          size,
          exact,
        ])
      ).rows[0].r;
    const first = await call("ZZ QA CATALOG");
    assert.equal(Number(first.total_count), 610);
    assert.equal(first.items.length, 50);
    assert.equal(Number(first.summary.variant_count), before + 610);
    const seen = new Set();
    for (let page = 1; page <= 7; page++)
      for (const item of (await call("ZZ QA CATALOG", "all", page, 100))
        .items) {
        assert(!seen.has(item.variant_id));
        seen.add(item.variant_id);
      }
    assert.equal(seen.size, 610);
    assert.equal((await call("ZZ QA CATALOG", "all", 1000000, 100)).page, 7);
    const literal = await call("000000939", "all", 1, 50, true);
    assert.equal(literal.items[0].variant_id, ids[609]);
    assert.equal(literal.items[0].primary_barcode, "000000939");
    assert.equal(literal.items[0].qty, 1);
    assert.equal((await call("939", "all", 1, 50, true)).total_count, 0);
    assert.equal((await call("939")).items[0].variant_id, ids[609]);
    assert.equal(
      (await call(literal.items[0].sku, "all", 1, 50, true)).items[0]
        .primary_barcode,
      "000000939",
    );
    assert.equal((await call("%_\\literal")).total_count, 1);
    assert.equal((await call("' OR 1=1 --")).total_count, 0);
    assert.equal((await call("cafe_% QA")).items[0].variant_id, ids[609]);
    const available = await call("ZZ QA CATALOG", "available");
    assert.equal(available.total_count, 2);
    assert.equal((await call("ZZ QA CATALOG", "last")).total_count, 1);
    assert.equal((await call("ZZ QA CATALOG", "out")).total_count, 608);
    assert.deepEqual(available.summary, first.summary);
    const other = await call("000000939", "all", 1, 50, true, locations[1]);
    assert.equal(other.items[0].qty, 90);
    const piece = first.summary.units.find((u) => u.unit.code === "PIECE");
    const pair = first.summary.units.find((u) => u.unit.code === "PAIR");
    assert(piece && pair);
    assert(Number(pair.available_quantity) >= 4);
    await db.query("savepoint validation");
    await assert.rejects(
      () => call("", "all", 1, 101),
      /INVALID_INVENTORY_QUERY/,
    );
    await db.query("rollback to savepoint validation");
    await assert.rejects(() => call("", "all", 0), /INVALID_INVENTORY_QUERY/);
    await db.query("rollback to savepoint validation");
    await assert.rejects(
      () => call("x".repeat(121)),
      /INVALID_INVENTORY_QUERY/,
    );
    await db.query("rollback to savepoint validation");
    await assert.rejects(
      () => call("", "all", 1, 50, true),
      /INVALID_INVENTORY_QUERY/,
    );
    await db.query("rollback to savepoint validation");
    await assert.rejects(() => call("", "invalid"), /INVALID_INVENTORY_QUERY/);
    await db.query("rollback to savepoint validation");
    await db.query("reset role");
    await db.query(
      "insert into role_permissions(role_id,permission_code) select role_id,'inventory.read' from app_users where id=$1 on conflict do nothing",
      [cashier],
    );
    await login(db, cashier);
    assert.equal((await call("000000939", "all", 1, 50, true)).items[0].qty, 1);
    await assert.rejects(
      () => call("", "all", 1, 50, false, locations[1]),
      /LOCATION_FORBIDDEN/,
    );
    await db.query("rollback to savepoint validation");
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("set role authenticated");
    await assert.rejects(() => call(), /NOT_AUTHORIZED/);
    await db.query("rollback to savepoint validation");
    await db.query("reset role");
    const privileges = (
      await db.query(
        "select has_function_privilege('anon','public.get_inventory_catalog(uuid,text,text,integer,integer,boolean)','EXECUTE') anon,has_function_privilege('service_role','public.get_inventory_catalog(uuid,text,text,integer,integer,boolean)','EXECUTE') service, p.prosecdef from pg_proc p where p.oid='public.get_inventory_catalog(uuid,text,text,integer,integer,boolean)'::regprocedure",
      )
    ).rows[0];
    assert.equal(privileges.anon, false);
    assert.equal(privileges.service, false);
    assert.equal(privileges.prosecdef, false);
    await db.query("rollback");
    assert.equal(
      (await db.query("select count(*)::int n from variants")).rows[0].n,
      before,
    );
    console.log(
      JSON.stringify({
        inventory_catalog_acceptance: true,
        fixture_variants: 610,
        complete_pagination: true,
        leading_zero_literal: true,
        literal_metacharacters: true,
        attribute_accent_search: true,
        global_summary_unchanged_by_filter: true,
        one_unit_available: true,
        reservations_and_location_isolation: true,
        unit_totals_separate: true,
        limits_and_auth: true,
        rollback: true,
      }),
    );
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
