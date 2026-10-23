import assert from "node:assert/strict";
// Bounded catalog fixtures from the private pinned staging snapshot. Local QA only.
export async function seedPriceFixtures(db, payload) {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const actor = (
    await one(
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit 1",
    )
  )?.id;
  assert.ok(actor);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  const ids = payload.expected_state.map((f) => f.variant_id);
  assert.equal(
    (
      await one(
        "select count(*)::int n from public.variants where id=any($1::uuid[])",
        [ids],
      )
    ).n,
    0,
    "PRICE_FIXTURES_ALREADY_EXIST",
  );
  for (const f of payload.expected_state) {
    await db.query(
      "insert into public.categories select * from jsonb_populate_record(null::public.categories,$1::jsonb)on conflict(id)do nothing",
      [f.category],
    );
    await db.query(
      "insert into public.products(id,name,brand_id,category_id,description,is_active,created_by,updated_by,created_at,updated_at,image_path,department_name,measure_unit_code)select id,name,brand_id,category_id,description,is_active,created_by,updated_by,created_at,updated_at,image_path,department_name,measure_unit_code from jsonb_populate_record(null::public.products,$1::jsonb)",
      [f.product],
    );
    await db.query(
      "insert into public.variants select * from jsonb_populate_record(null::public.variants,$1::jsonb)",
      [f.variant],
    );
    for (const b of f.barcodes)
      await db.query(
        "insert into public.barcodes select * from jsonb_populate_record(null::public.barcodes,$1::jsonb)",
        [b],
      );
    await db.query(
      "insert into public.m9_variant_details select * from jsonb_populate_record(null::public.m9_variant_details,$1::jsonb)",
      [f.details],
    );
    await db.query(
      "insert into app.m9_rows select * from jsonb_populate_record(null::app.m9_rows,$1::jsonb)",
      [f.managed],
    );
    await db.query(
      "insert into app.m9_sicar_products select * from jsonb_populate_record(null::app.m9_sicar_products,$1::jsonb)",
      [f.independent_parent],
    );
    await db.query(
      "insert into app.m9_provisional_variants select * from jsonb_populate_record(null::app.m9_provisional_variants,$1::jsonb)",
      [f.provisional],
    );
  }
  return { actor, ids };
}
