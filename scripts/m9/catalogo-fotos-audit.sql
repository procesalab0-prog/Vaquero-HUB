-- All reads. Fingerprints cover the actual photo/binding inputs and inventory
-- separately. Never call a mutating RPC to construct a supposedly read-only audit.
select jsonb_build_object(
 'm9_rows',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by barcode collate "C"),''))) from app.m9_rows t),
 'products',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),''))) from public.products t),
 'variants',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),''))) from public.variants t),
 'barcodes',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),''))) from public.barcodes t),
 'm9_products',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by product_id),''))) from app.m9_products t),
 'sources',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by product_id),''))) from app.web_content_sources t),
 'drafts',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by product_id),''))) from app.web_product_drafts t),
 'evidence',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by variant_id),''))) from app.web_variant_photo_evidence t),
 'copies',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by variant_id),''))) from app.web_variant_photo_storage t),
 'objects',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by name),''))) from storage.objects t where bucket_id='product-images'),
 'inventory',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by variant_id,location_id),''))) from public.inventory_by_location t),
 'movements',(select jsonb_build_object('rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),''))) from public.inventory_movements t)
) as audit;
