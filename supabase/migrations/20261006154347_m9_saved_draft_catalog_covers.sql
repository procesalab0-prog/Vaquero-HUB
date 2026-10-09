begin;
-- A read-time cover follows a saved web draft without racing or overwriting
-- the independently assigned product image. Historical fallback remains matched.
create or replace function app.read_catalog_covers(p_product_ids uuid[])
returns table(product_id uuid, image_url text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app.has_perm('products.read') then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  perform app.assert_sicar_staging_enabled();
  if p_product_ids is null or cardinality(p_product_ids)>200 then
    raise exception 'INVALID_PRODUCT_BATCH' using errcode='22023';
  end if;
  return query
    select p.id, cover.url
    from public.products p
    left join app.web_product_drafts d on d.product_id=p.id
    left join app.web_content_sources s on s.product_id=p.id
    left join app.m9_products m on m.product_id=p.id and m.woo_id::text=s.snapshot->>'woo_product_id'
    cross join lateral (select case when d.product_id is not null then d.content#>>'{images,0,url}'
      when m.product_id is not null then s.suggested_content#>>'{images,0,url}' end as url) cover
    where p.id=any(p_product_ids) and p.image_path is null
      and cover.url ~ '^https://(vaquerosm[.]com/wp-content/uploads/|zsezjtswqeijboezvado[.]supabase[.]co/storage/v1/object/public/product-images/)[A-Za-z0-9%._~!$&''()*+,;=:@/?#-]+$';
end;
$$;
revoke all on function app.read_catalog_covers(uuid[]) from public,anon,service_role;
grant execute on function app.read_catalog_covers(uuid[]) to authenticated;
commit;
