begin;
create function app.read_migration_galleries(p_product_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app.has_perm('products.read') or not app.has_perm('products.update') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 perform app.assert_sicar_staging_enabled();
 return (select coalesce(jsonb_agg(jsonb_build_object('product_id',s.product_id,'name',p.name,
  'source_sha256',s.source_sha256,'woo_product_id',s.snapshot->'woo_product_id','images',s.suggested_content->'images') order by p.name,s.product_id),'[]'::jsonb)
 from app.web_content_sources s join app.m9_products m on m.product_id=s.product_id and m.woo_id::text=s.snapshot->>'woo_product_id'
 join public.products p on p.id=s.product_id
 where p.is_active and (p_product_id is null or s.product_id=p_product_id));
end $$;
revoke all on function app.read_migration_galleries(uuid) from public,anon,service_role;
grant execute on function app.read_migration_galleries(uuid) to authenticated;
create function public.read_migration_galleries(p_product_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$ select app.read_migration_galleries(p_product_id) $$;
revoke all on function public.read_migration_galleries(uuid) from public,anon,service_role;
grant execute on function public.read_migration_galleries(uuid) to authenticated;
commit;
