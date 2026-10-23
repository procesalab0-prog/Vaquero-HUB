import assert from "node:assert/strict";
// Metadata fixtures only in the assigned clone. No Auth session or media bytes.
export async function seedLinkedPriceFixtures(db, p) {
  const one = async (q, a = []) => (await db.query(q, a)).rows[0],
    f = p.expected_state[0];
  const actor = (
    await one(
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where r.code='ADMIN'and u.is_active order by u.id limit 1",
    )
  ).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  assert.equal(
    (
      await one(
        "select count(*)::int n from public.variants where woocommerce_product_id=21768",
      )
    ).n,
    0,
  );
  const insert = async (table, row, extra = "") =>
    db.query(
      `insert into ${table} select *from jsonb_populate_record(null::${table},$1::jsonb)${extra}`,
      [row],
    );
  const members = [f, ...f.linked_context.siblings];
  for (const v of members)
    for (const av of v.attribute_values)
      if (av.scale_code)
        await db.query(
          "insert into public.size_scales(code,name)values($1,$2)on conflict(code)do nothing",
          [av.scale_code, "Local QA linked price scale " + av.scale_code],
        );
  await insert("public.categories", f.category, "on conflict(id)do nothing");
  const author = f.web.draft.updated_by;
  await db.query(
    "insert into auth.users(id)values($1)on conflict(id)do nothing",
    [author],
  );
  await db.query(
    "insert into public.app_users(id,employee_code,full_name,email,role_id)select $1,'QA-LINKED-AUTHOR','Synthetic linked price author','qa-linked-author@example.invalid',role_id from public.app_users where id=$2 on conflict(id)do nothing",
    [author, actor],
  );
  await db.query(
    "insert into public.products(id,name,brand_id,category_id,description,is_active,created_by,updated_by,created_at,updated_at,image_path,department_name,measure_unit_code)select id,name,brand_id,category_id,description,is_active,created_by,updated_by,created_at,updated_at,image_path,department_name,measure_unit_code from jsonb_populate_record(null::public.products,$1::jsonb)",
    [f.product],
  );
  for (const v of members) {
    await insert("public.variants", v.variant);
    for (const av of v.attribute_values)
      await insert("public.attribute_values", av, "on conflict(id)do nothing");
    for (const a of v.attributes) await insert("public.variant_attributes", a);
    for (const barcode of v.barcodes) await insert("public.barcodes", barcode);
    await insert("public.m9_variant_details", v.details);
    await insert("app.m9_rows", v.managed);
  }
  await insert("app.m9_products", f.web.link);
  await insert("app.web_content_sources", f.web.source);
  await insert("app.web_product_drafts", f.web.draft);
  await insert("app.web_category_bindings", f.web.category);
  for (const e of f.linked_context.evidence)
    await insert("app.web_variant_photo_evidence", e);
  for (const c of f.linked_context.copies) {
    await db.query(
      "insert into auth.users(id)values($1)on conflict(id)do nothing",
      [c.created_by],
    );
    await insert("app.web_variant_photo_storage", c);
    for (const image of c.photos) {
      const path = image.url.split("/product-images/")[1];
      assert.ok(path);
      await db.query(
        "insert into storage.objects(id,bucket_id,name)select extensions.gen_random_uuid(),'product-images',$1 where not exists(select 1 from storage.objects where bucket_id='product-images'and name=$1)",
        [path],
      );
    }
  }
  return {
    actor,
    ids: [f.variant_id],
    members: members.map((v) => v.variant.id),
    product_id: f.product.id,
  };
}
