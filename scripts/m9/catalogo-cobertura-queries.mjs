// Read-only maintenance SELECT templates. No driver, credentials, execution or
// locks; the coordinator captures full table audits before and after all pages.
export function catalogCoveragePageQuery(offset = 0, limit = 500) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500
  )
    throw Error("INVALID_CATALOG_COVERAGE_PAGE");
  return `with meta as materialized (
 select count(*)::integer total,
  encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(r)::text,'|' order by r.barcode collate "C"),''),'UTF8'),'sha256'),'hex') managed_sha256
 from app.m9_rows r
), selected as materialized (
 select r.*,v.product_id,v.woocommerce_product_id,v.woocommerce_variation_id,
  v.is_active variant_active,p.is_active product_active,p.measure_unit_code,
  app.m9_rehearsal_current_row(r.variant_id) current_row,
  (select count(*)::integer from public.barcodes b where b.variant_id=r.variant_id and b.code=r.barcode and b.source='SICAR' and b.is_primary) barcode_binding_count
 from app.m9_rows r left join public.variants v on v.id=r.variant_id
 left join public.products p on p.id=v.product_id
 order by r.barcode collate "C" limit ${limit} offset ${offset}
), payload as (
 select coalesce(jsonb_agg(jsonb_build_object(
  'barcode',r.barcode,'variant_id',r.variant_id,'product_id',r.product_id,
  'stored',r.source_row,'current',r.current_row,
  'source_sha256',r.source_sha256,
  'native_woo_product_id',r.woocommerce_product_id,'native_woo_variation_id',r.woocommerce_variation_id,
  'variant_active',r.variant_active,'product_active',r.product_active,'unit_code',r.measure_unit_code,
  'barcode_binding_count',r.barcode_binding_count,
  'stored_hash_pg',md5(r.source_row::text),'current_hash_pg',md5(r.current_row::text)
 )order by r.barcode collate "C"),'[]'::jsonb)::text rows_json from selected r
)
select jsonb_build_object('protocol','m9-full-catalog-pages-1','project_id','zsezjtswqeijboezvado',
 'scope','ALL_MANAGED_SICAR_ROWS_NO_CUSTOMERS','observed_at',clock_timestamp(),
 'offset',${offset},'limit',${limit},'total',m.total,'managed_sha256',m.managed_sha256,
 'rows_json',p.rows_json,'rows_sha256',encode(extensions.digest(convert_to(p.rows_json,'UTF8'),'sha256'),'hex')) page
from meta m cross join payload p;`;
}
