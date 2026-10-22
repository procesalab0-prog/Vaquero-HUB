-- One read-only census of all managed rows and every missing variant-photo
-- evidence row. No stock/price payload and no mutation. Use staging MCP only.
with gap as materialized (
 select r.barcode,r.variant_id,v.product_id,v.woocommerce_product_id,v.woocommerce_variation_id,
 (select x->>'images_woo' from jsonb_array_elements(coalesce(s.snapshot->'variants','[]'::jsonb)) x
  where x->>'barcode'=r.barcode and x->>'woo_variation_id'=v.woocommerce_variation_id::text limit 1) images
 from app.m9_rows r join public.variants v on v.id=r.variant_id
 left join app.web_content_sources s on s.product_id=v.product_id
 left join app.web_variant_photo_evidence e on e.variant_id=v.id
 where v.woocommerce_product_id is not null and v.woocommerce_variation_id is not null and e.variant_id is null
), checked as materialized (
 select e.variant_id,c.variant_id is not null has_copy,c.evidence_hash=md5(to_jsonb(e)::text) hash_matches,
 not exists(select 1 from jsonb_array_elements(e.photos) with ordinality a(photo,pos)
  full join jsonb_array_elements(coalesce(c.photos,'[]'::jsonb)) with ordinality b(image,pos) using(pos)
  where image is distinct from jsonb_build_object('url',
   'https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/'||e.product_id::text||'/'||
   (photo->>'sha256')||'.'||case photo->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end,
   'alt',photo->>'alt')) mapping_matches,
 not exists(select 1 from jsonb_array_elements(e.photos) photo where not exists(select 1 from storage.objects o
  where o.bucket_id='product-images' and o.name=e.product_id::text||'/'||(photo->>'sha256')||'.'||
   case photo->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end
   and o.metadata->>'size'=photo->>'bytes' and o.metadata->>'mimetype'=photo->>'mime')) objects_match,
 exists(select 1 from public.variants v join public.barcodes b on b.variant_id=v.id and b.source='SICAR' and b.is_primary
  join app.m9_products m on m.product_id=e.product_id join app.web_content_sources s on s.product_id=e.product_id
  where v.id=e.variant_id and v.product_id=e.product_id and v.is_active and b.code=e.barcode
   and v.woocommerce_product_id=e.woo_product_id and v.woocommerce_variation_id=e.woo_variation_id
   and m.woo_id=e.woo_product_id and md5(to_jsonb(s)::text)=e.source_fingerprint) reader_identity_matches
 from app.web_variant_photo_evidence e left join app.web_variant_photo_storage c on c.variant_id=e.variant_id
 where jsonb_array_length(e.photos)>0
)
select jsonb_build_object(
 'coverage',jsonb_build_object(
  'linked_woo',(select count(*) from app.m9_rows r join public.variants v on v.id=r.variant_id where v.woocommerce_product_id is not null),
  'sicar_only',(select count(*) from app.m9_rows r join public.variants v on v.id=r.variant_id where v.woocommerce_product_id is null),
  'linked_simple',(select count(*) from app.m9_rows r join public.variants v on v.id=r.variant_id where v.woocommerce_product_id is not null and v.woocommerce_variation_id is null),
  'without_evidence',(select count(*) from gap),
  'nonempty_without_copy',(select count(*) from checked where not has_copy),
  'copies_wrong_hash',(select count(*) from checked where hash_matches is distinct from true)),
 'gaps',(select jsonb_agg(jsonb_build_array(barcode,variant_id,product_id,woocommerce_product_id,woocommerce_variation_id,images) order by barcode collate "C") from gap),
 'metadata', (select jsonb_build_object('nonempty_evidence',count(*),'copied',count(*) filter(where has_copy),
  'exact_metadata_and_reader',count(*) filter(where hash_matches and mapping_matches and objects_match and reader_identity_matches),
  'object_problems',count(*) filter(where not objects_match),'mapping_problems',count(*) filter(where not mapping_matches),
  'identity_problems',count(*) filter(where not reader_identity_matches)) from checked),
 'writes_performed',0,'import_allowed',false,'send_allowed',false
) as census;
