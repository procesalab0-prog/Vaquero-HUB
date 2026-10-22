// Maintenance reader only. Pass the fixed project id to MCP, never browser data.
// Deliberately no network client, environment, credential or mutation helper.
export const CATALOG_PHOTO_PROJECT = "zsezjtswqeijboezvado";
export const CATALOG_PHOTO_COLUMNS = [
  "variant_id",
  "product_id",
  "barcode",
  "woo_product_id",
  "woo_variation_id",
  "variant_active",
  "product_active",
  "barcode_matches",
  "managed_matches",
  "current_hash",
  "binding_hash",
];

export function catalogPhotoReadQuery(section, offset = 0, limit = 500) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500
  )
    throw Error("INVALID_READ_PAGE");
  const page = `limit ${limit} offset ${offset}`;
  const queries = {
    rows: `select coalesce(jsonb_agg(jsonb_build_array(variant_id,product_id,barcode,
      woocommerce_product_id,woocommerce_variation_id,variant_active,product_active,
      barcode_matches,source_row=current_row,md5(current_row::text),binding_hash)
      order by barcode collate "C"),'[]'::jsonb) as items from (
       select r.*,v.product_id,v.woocommerce_product_id,v.woocommerce_variation_id,
       v.is_active variant_active,p.is_active product_active,
       app.m9_rehearsal_current_row(r.variant_id) current_row,md5(to_jsonb(r)::text) binding_hash,
       exists(select 1 from public.barcodes b where b.variant_id=r.variant_id
        and b.code=r.barcode and b.source='SICAR' and b.is_primary) barcode_matches
       from app.m9_rows r join public.variants v on v.id=r.variant_id
       join public.products p on p.id=v.product_id order by r.barcode collate "C" ${page}) m`,
    products: `select coalesce(jsonb_agg(jsonb_build_object(
      'product_id',p.id,'name',p.name,'image_path',p.image_path,
      'catalog_hash',md5(app.web_catalog_snapshot(p.id)::text),
      'source_hash',case when s.product_id is not null then md5(to_jsonb(s)::text) end,
      'draft_hash',md5(coalesce(to_jsonb(d),'null'::jsonb)::text),
      'woo_product_id',m.woo_id,'source_woo_product_id',s.snapshot->'woo_product_id',
      'source_status',s.snapshot->'source_status','source_type',s.snapshot->'type',
      'draft_present',d.product_id is not null,'draft_images',d.content->'images',
      'source_images',s.suggested_content->'images',
      'source_variants',(select coalesce(jsonb_agg(jsonb_build_object(
       'barcode',x->'barcode','woo_variation_id',x->'woo_variation_id',
       'images_woo',x->'images_woo')),'[]'::jsonb)
       from jsonb_array_elements(coalesce(s.snapshot->'variants','[]'::jsonb)) x)
      ) order by p.id),'[]'::jsonb) as items from (
       select p.* from public.products p where exists(select 1 from app.m9_rows r
       join public.variants v on v.id=r.variant_id where v.product_id=p.id
       and v.woocommerce_product_id is not null) order by p.id ${page}) p
      left join app.m9_products m on m.product_id=p.id
      left join app.web_content_sources s on s.product_id=p.id
      left join app.web_product_drafts d on d.product_id=p.id`,
    evidence: `select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object(
      'evidence_hash',md5(to_jsonb(e)::text)) order by e.variant_id),'[]'::jsonb) as items
      from (select e.* from app.web_variant_photo_evidence e join app.m9_rows r
      on r.variant_id=e.variant_id order by e.variant_id ${page}) e`,
    copies: `select coalesce(jsonb_agg(to_jsonb(c)-'created_by' order by c.variant_id),'[]'::jsonb) as items
      from (select c.* from app.web_variant_photo_storage c join app.m9_rows r
      on r.variant_id=c.variant_id order by c.variant_id ${page}) c`,
    objects: `select coalesce(jsonb_agg(jsonb_build_object('name',o.name,
      'bytes',o.metadata->'size','mime',o.metadata->'mimetype') order by o.name),'[]'::jsonb) as items
      from (select name,metadata from storage.objects where bucket_id='product-images'
      order by name ${page}) o`,
  };
  if (!Object.hasOwn(queries, section)) throw Error("INVALID_READ_SECTION");
  return queries[section];
}
