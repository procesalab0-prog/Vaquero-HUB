begin;
-- Creators may finish their own web gallery in staging after assigning a cover.
create or replace function app.can_manage_product_image(p_storage_path text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=app.current_user_id(); pid uuid; own_web boolean;
begin
 if actor is null or p_storage_path is null or p_storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]+\.(jpg|png|webp)$' then return false; end if;
 pid:=split_part(p_storage_path,'/',1)::uuid;
 select exists(select 1 from app.web_product_drafts where product_id=pid) into own_web;
 if own_web and not app.has_perm('products.update') then perform app.assert_sicar_staging_enabled(); end if;
 return exists(select 1 from public.products p where p.id=pid and
   (app.has_perm('products.update') or (app.has_perm('products.create') and p.created_by=actor and (p.image_path is null or own_web))));
exception when invalid_text_representation then return false;
end $$;
revoke all on function app.can_manage_product_image(text) from public,anon,service_role;
grant execute on function app.can_manage_product_image(text) to authenticated;

do $$ declare signature text; d text; before_text text:='insert into public.audit_log(action,entity_type,entity_id,metadata)'; begin
 foreach signature in array array['app.save_web_draft(uuid,jsonb,integer,text,uuid)','app.create_product_with_web_draft(text,uuid,jsonb,text,jsonb,uuid)'] loop
  select pg_get_functiondef(signature::regprocedure) into d;
  if strpos(d,before_text)=0 then raise exception 'WEB_AUDIT_EXPECTED_SIGNATURE'; end if;
  d:=replace(d,before_text,'insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)');
  d:=replace(d,'values(''m9.web_draft.save''','values(actor,''m9.web_draft.save''');
  execute d;
 end loop;
end $$;
commit;
