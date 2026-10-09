begin;
-- Read confirmed public commercial covers without changing storage paths or catalogue.
create function app.read_catalog_covers(p_product_ids uuid[])
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
    select p.id, s.suggested_content#>>'{images,0,url}'
    from public.products p
    join app.web_content_sources s on s.product_id=p.id
    join app.m9_products m on m.product_id=p.id
      and m.woo_id::text=s.snapshot->>'woo_product_id'
    where p.id=any(p_product_ids) and p.image_path is null
      and (s.suggested_content#>>'{images,0,url}') ~ '^https://vaquerosm[.]com/wp-content/uploads/[A-Za-z0-9_./%-]+$';
end;
$$;
revoke all on function app.read_catalog_covers(uuid[]) from public,anon,service_role;
grant execute on function app.read_catalog_covers(uuid[]) to authenticated;
create function public.read_catalog_covers(p_product_ids uuid[])
returns table(product_id uuid,image_url text)
language sql stable security invoker set search_path='' as $$
  select * from app.read_catalog_covers(p_product_ids);
$$;
revoke all on function public.read_catalog_covers(uuid[]) from public,anon,service_role;
grant execute on function public.read_catalog_covers(uuid[]) to authenticated;
commit;
