begin;

-- Las fotografias son contenido comercial publico, pero solo personal con
-- permiso de catalogo puede subirlas o asociarlas a un producto. Guardamos la
-- ruta, no una URL ligada a un entorno, para que staging y produccion sigan
-- usando sus propios proyectos.
alter table public.products
  add column image_path text;

alter table public.products
  add constraint products_image_path_format check (
    image_path is null
    or image_path ~ ('^' || id::text || '/[0-9a-f-]+\.(jpg|png|webp)$')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Storage evalua sus politicas desde su propio esquema. Encapsular la
-- autorizacion evita que el RLS de products oculte la fila que precisamente
-- necesitamos comprobar, sin conceder escritura directa sobre el catalogo.
create or replace function app.can_manage_product_image(p_storage_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_product_id uuid;
begin
  if v_actor is null
     or p_storage_path is null
     or p_storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]+\.(jpg|png|webp)$' then
    return false;
  end if;
  v_product_id := split_part(p_storage_path, '/', 1)::uuid;
  return exists (
    select 1
    from public.products p
    where p.id = v_product_id
      and (
        (select app.has_perm('products.update'))
        or (
          (select app.has_perm('products.create'))
          and p.created_by = v_actor
          and p.image_path is null
        )
      )
  );
exception
  when invalid_text_representation then
    return false;
end;
$$;

revoke execute on function app.can_manage_product_image(text)
  from public, anon;
grant execute on function app.can_manage_product_image(text)
  to authenticated;

create policy product_images_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (select app.can_manage_product_image(name))
);

create policy product_images_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and (select app.can_manage_product_image(name))
);

create or replace function public.set_product_image(
  p_product_id uuid,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
begin
  if v_actor is null then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_product_id is null
     or p_storage_path is null
     or p_storage_path !~ ('^' || p_product_id::text || '/[0-9a-f-]+\.(jpg|png|webp)$') then
    raise exception 'INVALID_PRODUCT_IMAGE_PATH' using errcode = '22023';
  end if;

  perform 1
  from public.products p
  where p.id = p_product_id
    and (
      (select app.has_perm('products.update'))
      or (
        (select app.has_perm('products.create'))
        and p.created_by = v_actor
        and p.image_path is null
      )
    )
  for update;
  if not found then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'product-images' and o.name = p_storage_path
  ) then
    raise exception 'PRODUCT_IMAGE_NOT_FOUND' using errcode = '22023';
  end if;

  update public.products
  set image_path = p_storage_path,
      updated_by = v_actor
  where id = p_product_id;

  return jsonb_build_object('product_id', p_product_id, 'image_path', p_storage_path);
end;
$$;

comment on column public.products.image_path is
  'Ruta del archivo comercial en el bucket product-images; nunca contiene secretos ni datos personales.';
comment on function public.set_product_image(uuid, text) is
  'Asocia una fotografia ya validada y subida mediante Storage API; exige permiso de catalogo.';

revoke execute on function public.set_product_image(uuid, text) from public, anon;
grant execute on function public.set_product_image(uuid, text) to authenticated;

commit;
