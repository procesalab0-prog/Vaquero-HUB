begin;
create or replace function app.read_migration_galleries(p_product_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app.has_perm('products.read') or not app.has_perm('products.update') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 perform app.assert_sicar_staging_enabled();
 return (select coalesce(jsonb_agg(jsonb_build_object('product_id',s.product_id,'name',p.name,
  'source_sha256',s.source_sha256,'woo_product_id',s.snapshot->'woo_product_id','images',s.suggested_content->'images') order by p.name,s.product_id),'[]'::jsonb)
 from app.web_content_sources s join app.m9_products m on m.product_id=s.product_id and m.woo_id::text=s.snapshot->>'woo_product_id'
 join public.products p on p.id=s.product_id
 left join app.web_product_drafts d on d.product_id=s.product_id
 where p.is_active and (p_product_id is null or s.product_id=p_product_id)
 -- Explicit reads are unchanged: actions still recheck source and revision.
 -- Match the existing copier's unchanged predicate, using only a saved draft.
 and (p_product_id is not null or not coalesce(
   jsonb_typeof(d.content->'images')='array'
   and not exists(select 1 from jsonb_array_elements(
     case when jsonb_typeof(d.content->'images')='array' then d.content->'images' else '[]'::jsonb end
   ) i where coalesce(i->>'url','') not like
     'https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/'||s.product_id::text||'/%'),false)));
end $$;
commit;
