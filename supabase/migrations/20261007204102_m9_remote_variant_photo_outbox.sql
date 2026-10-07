begin;
create table app.web_remote_variant_photo_outbox (
 id uuid primary key,
 parent_id uuid not null unique references app.web_remote_jobs(id),
 actor_id uuid not null references public.app_users(id),
 context_hash text not null,
 packet jsonb not null,
 remote_before jsonb not null,
 state text not null default 'RUNNING' check(state in ('RUNNING','SUCCEEDED')),
 receipt jsonb,
 created_at timestamptz not null default now()
);
alter table app.web_remote_variant_photo_outbox enable row level security;
revoke all on app.web_remote_variant_photo_outbox from public,anon,authenticated,service_role;

-- Service-only worker: actor authorization and ownership are checked by the
-- existing claim function, not by editable JWT metadata or form-supplied evidence.
create function app.remote_variant_photo_context(p_parent uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare bound jsonb; fresh jsonb; j app.web_remote_jobs; items jsonb; evidence jsonb; d app.web_product_drafts; s app.web_content_sources;
begin
 perform app.assert_sicar_staging_enabled();
 if p_parent is null or p_parent not in ('97c82026-b3cc-4c60-8f22-13d7c00fb33a'::uuid,'ba239bba-7691-43cc-9c76-8768a1af9f21'::uuid) then raise exception 'VARIANT_PHOTO_PILOT_ONLY'; end if;
 bound:=app.claim_remote_web(p_parent,p_actor);
 if bound->>'state' is distinct from 'SUCCEEDED' then raise exception 'VARIANT_PHOTO_PARENT_REQUIRED'; end if;
 if not exists(select 1 from public.app_users u join public.role_permissions rp on rp.role_id=u.role_id where u.id=p_actor and u.is_active and rp.permission_code='products.update') then raise insufficient_privilege; end if;
 select * into strict j from app.web_remote_jobs where id=p_parent;
 perform 1 from public.products where id=j.product_id for update;
 perform 1 from public.variants where product_id=j.product_id order by id for update;
 select * into strict s from app.web_content_sources where product_id=j.product_id for update;
 select * into strict d from app.web_product_drafts where product_id=j.product_id for update;
 perform 1 from app.web_variant_photo_evidence where product_id=j.product_id order by variant_id for update;
 perform 1 from app.web_variant_photo_storage where variant_id in (select variant_id from app.web_variant_photo_evidence where product_id=j.product_id) order by variant_id for update;
 fresh:=app.remote_web_packet(j.product_id);
 if fresh->>'protocol' is distinct from 'm9-remote-family-1' or fresh->'variants' is distinct from j.packet->'variants' or fresh->>'fingerprint' is distinct from j.packet->>'fingerprint' then raise exception 'VARIANT_PHOTO_CATALOG_CHANGED'; end if;
 select jsonb_agg(jsonb_build_object('variant_id',e.variant_id,'barcode',e.barcode,'photos',e.photos,'stored',c.photos) order by e.variant_id),
 jsonb_agg(jsonb_build_object('evidence',to_jsonb(e),'copy',to_jsonb(c)) order by e.variant_id)
 into items,evidence from app.web_variant_photo_evidence e
 join public.variants v on v.id=e.variant_id and v.product_id=e.product_id and v.is_active and v.woocommerce_product_id=e.woo_product_id and v.woocommerce_variation_id=e.woo_variation_id
 join public.barcodes b on b.variant_id=v.id and b.is_primary and b.code=e.barcode
 join app.m9_products m on m.product_id=e.product_id and m.woo_id=e.woo_product_id
 left join app.web_variant_photo_storage c on c.variant_id=e.variant_id and c.evidence_hash=md5(to_jsonb(e)::text)
 where e.product_id=j.product_id and e.source_fingerprint=md5(to_jsonb(s)::text);
 if items is null or jsonb_array_length(items)<>5 or jsonb_array_length(j.packet->'variants')<>5
 or exists(select 1 from jsonb_array_elements(items) i where
   not exists(select 1 from jsonb_array_elements(j.packet->'variants') v where v->>'variant_id'=i->>'variant_id' and v->>'barcode'=i->>'barcode')
   or jsonb_array_length(i->'photos')>1
   or (jsonb_array_length(i->'photos')=1 and (jsonb_typeof(i->'stored') is distinct from 'array' or jsonb_array_length(i->'stored')<>1
     or i#>>'{stored,0,alt}' is distinct from i#>>'{photos,0,alt}'
     or i#>>'{stored,0,url}' is distinct from 'https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/'||j.product_id::text||'/'||(i#>>'{photos,0,sha256}')||case i#>>'{photos,0,mime}' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' else 'INVALID' end
     or not exists(select 1 from storage.objects o where o.bucket_id='product-images' and o.name=substr(i#>>'{stored,0,url}',length('https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/')+1) and o.metadata->>'size'=i#>>'{photos,0,bytes}' and o.metadata->>'mimetype'=i#>>'{photos,0,mime}'))))
 then raise exception 'VARIANT_PHOTO_SOURCE_REVIEW'; end if;
 return jsonb_build_object('parent_id',p_parent,'product_id',j.product_id,'packet',j.packet||jsonb_build_object('request_id',j.id),'receipt',j.receipt,'items',items,
 'context_hash',md5(jsonb_build_object('catalog',app.web_catalog_snapshot(j.product_id),'source',to_jsonb(s),'draft',to_jsonb(d),'evidence',evidence)::text));
end $$;
revoke all on function app.remote_variant_photo_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app.remote_variant_photo_context(uuid,uuid) to service_role;
create function public.remote_variant_photo_context(p_parent uuid,p_actor uuid) returns jsonb language sql security invoker set search_path='' as $$ select app.remote_variant_photo_context(p_parent,p_actor) $$;
revoke all on function public.remote_variant_photo_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remote_variant_photo_context(uuid,uuid) to service_role;

create function app.begin_remote_variant_photos(p_parent uuid,p_actor uuid,p_context_hash text default null,p_packet jsonb default null,p_remote jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb; j app.web_remote_variant_photo_outbox; a jsonb; i jsonb; r jsonb; saved jsonb; source_sha text;
begin
 ctx:=app.remote_variant_photo_context(p_parent,p_actor);
 select * into j from app.web_remote_variant_photo_outbox where parent_id=p_parent for update;
 if found then return jsonb_build_object('dispatch',false,'job',to_jsonb(j)); end if;
 if p_packet is null then return jsonb_build_object('dispatch',false,'job',null); end if;
 if ctx->>'context_hash' is distinct from p_context_hash or jsonb_typeof(p_packet) is distinct from 'object'
 or not(p_packet ?& array['protocol','update_id','parent_id','expected_revision','gallery_revision','assignments']) or (select count(*) from jsonb_object_keys(p_packet))<>6
 or p_packet->>'protocol' is distinct from 'm9-remote-variant-photo-write-1' or p_packet->>'parent_id' is distinct from p_parent::text
 or coalesce(p_packet->>'update_id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
 or coalesce(p_packet->>'expected_revision','') !~ '^[a-f0-9]{64}$' or coalesce(p_packet->>'gallery_revision','') !~ '^[a-f0-9]{64}$'
 or p_remote->>'protocol' is distinct from 'm9-remote-variant-photo-read-1' or p_remote->>'origin' is distinct from 'https://salmon-nightingale-251188.hostingersite.com'
 or p_remote->>'request_id' is distinct from p_parent::text or p_remote->>'product_id' is distinct from ctx->>'product_id'
 or p_remote->'woo_product_id' is distinct from ctx#>'{receipt,remote_product_id}' or p_remote->'complete' is distinct from 'true'::jsonb or p_remote->'write_enabled' is distinct from 'false'::jsonb
 or p_remote->>'revision' is distinct from p_packet->>'expected_revision' or p_remote->>'gallery_revision' is distinct from p_packet->>'gallery_revision'
 or jsonb_typeof(p_packet->'assignments') is distinct from 'array' or jsonb_typeof(p_remote->'variants') is distinct from 'array'
 then raise exception 'VARIANT_PHOTO_PACKET_REVIEW'; end if;
 if jsonb_array_length(p_packet->'assignments')<>5 or jsonb_array_length(p_remote->'variants')<>5
 or (select count(distinct x->>'variant_id') from jsonb_array_elements(p_packet->'assignments') x)<>5
 or (select count(distinct x->>'barcode') from jsonb_array_elements(p_packet->'assignments') x)<>5
 or (select count(distinct x->>'woo_variant_id') from jsonb_array_elements(p_packet->'assignments') x)<>5 then raise exception 'VARIANT_PHOTO_PACKET_DUPLICATE'; end if;
 for a in select value from jsonb_array_elements(p_packet->'assignments') loop
  select value into i from jsonb_array_elements(ctx->'items') x where x->>'variant_id'=a->>'variant_id' and x->>'barcode'=a->>'barcode';
  select value into saved from jsonb_array_elements(ctx#>'{receipt,verified,variants}') x where x->>'variant_id'=a->>'variant_id' and x->>'barcode'=a->>'barcode' and x->'remote_variation_id'=a->'woo_variant_id';
  select value into r from jsonb_array_elements(p_remote->'variants') x where x->>'variant_id'=a->>'variant_id' and x->>'barcode'=a->>'barcode' and x->'woo_variant_id'=a->'woo_variant_id';
  if i is null or saved is null or r is null or (select count(*) from jsonb_object_keys(a))<>6 or not(a ?& array['variant_id','barcode','woo_variant_id','image_id','sha256','alt'])
   or r->'price_cents' is distinct from saved->'price_cents' or r->'attributes' is distinct from saved->'attributes' or r->'own_image_id' is distinct from '0'::jsonb or r->'own_image' is distinct from 'null'::jsonb then raise exception 'VARIANT_PHOTO_IDENTITY_REVIEW'; end if;
  if a->>'barcode'='10324' then
   if jsonb_array_length(i->'photos')<>0 or a->'image_id' is distinct from '0'::jsonb or a->'sha256' is distinct from 'null'::jsonb or a->'alt' is distinct from 'null'::jsonb then raise exception 'VARIANT_PHOTO_ABSENCE'; end if;
  else
   source_sha:=case p_parent when '97c82026-b3cc-4c60-8f22-13d7c00fb33a'::uuid then 'a4d55159c147562de6d990134c1f9259d96be3a3a107c748d362d7db7b6f0c25' else '812a400b0264f59b6eb90a04d98f2a1c9c3ceb269312076480b4a9daf0438ec5' end;
   if jsonb_array_length(i->'photos')<>1 or a->>'sha256' is distinct from source_sha or a->>'sha256' is distinct from i#>>'{photos,0,sha256}' or a->>'alt' is distinct from i#>>'{photos,0,alt}'
    or coalesce(a->>'image_id','') !~ '^[1-9][0-9]{0,9}$'
    or (select count(*) from jsonb_array_elements(p_remote->'images') x where x->'id'=a->'image_id' and x->'sha256'=a->'sha256' and x->'alt'=a->'alt')<>1
    or (select count(*) from jsonb_array_elements(p_remote->'images') x where x->'sha256'=a->'sha256' and x->'alt'=a->'alt')<>1 then raise exception 'VARIANT_PHOTO_ATTACHMENT_REVIEW'; end if;
  end if;
 end loop;
 insert into app.web_remote_variant_photo_outbox(id,parent_id,actor_id,context_hash,packet,remote_before) values((p_packet->>'update_id')::uuid,p_parent,p_actor,p_context_hash,p_packet,p_remote) returning * into j;
 return jsonb_build_object('dispatch',true,'job',to_jsonb(j));
end $$;
revoke all on function app.begin_remote_variant_photos(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function app.begin_remote_variant_photos(uuid,uuid,text,jsonb,jsonb) to service_role;
create function public.begin_remote_variant_photos(p_parent uuid,p_actor uuid,p_context_hash text default null,p_packet jsonb default null,p_remote jsonb default null) returns jsonb language sql security invoker set search_path='' as $$ select app.begin_remote_variant_photos(p_parent,p_actor,p_context_hash,p_packet,p_remote) $$;
revoke all on function public.begin_remote_variant_photos(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.begin_remote_variant_photos(uuid,uuid,text,jsonb,jsonb) to service_role;

create function app.finish_remote_variant_photos(p_job uuid,p_actor uuid,p_receipt jsonb,p_live jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j app.web_remote_variant_photo_outbox; ctx jsonb; expected jsonb; a jsonb; v jsonb; own jsonb; variants jsonb:='[]'::jsonb;
begin
 select * into strict j from app.web_remote_variant_photo_outbox where id=p_job;
 ctx:=app.remote_variant_photo_context(j.parent_id,p_actor);
 select * into strict j from app.web_remote_variant_photo_outbox where id=p_job for update;
 if j.actor_id is distinct from p_actor or ctx->>'context_hash' is distinct from j.context_hash then raise exception 'VARIANT_PHOTO_SOURCE_CHANGED'; end if;
 if p_receipt->>'state' is distinct from 'SUCCEEDED' or p_receipt->>'protocol' is distinct from 'm9-remote-variant-photo-write-1'
 or p_receipt->'owner' is distinct from ctx#>'{receipt,owner}' or coalesce(p_receipt->>'fingerprint','') !~ '^[a-f0-9]{64}$'
 or p_receipt->'packet' is distinct from j.packet or p_receipt->'before' is distinct from j.remote_before or p_receipt->>'after_revision' is distinct from p_live->>'revision'
 or coalesce(p_live->>'revision','') !~ '^[a-f0-9]{64}$' then raise exception 'VARIANT_PHOTO_RECEIPT_REVIEW'; end if;
 for v in select value from jsonb_array_elements(j.remote_before->'variants') loop
  select value into strict a from jsonb_array_elements(j.packet->'assignments') x where x->>'variant_id'=v->>'variant_id';
  own:=case when a->'image_id'='0'::jsonb then 'null'::jsonb else jsonb_build_object('id',a->'image_id','sha256',a->'sha256','alt',a->'alt') end;
  variants:=variants||jsonb_build_array(v||jsonb_build_object('own_image_id',a->'image_id','own_image',own));
 end loop;
 expected:=(j.remote_before-'revision')||jsonb_build_object('variants',variants);
 if (p_live-'revision') is distinct from expected then raise exception 'VARIANT_PHOTO_READBACK_CHANGED'; end if;
 if j.state='SUCCEEDED' then
  if j.receipt is distinct from p_receipt then raise exception 'VARIANT_PHOTO_RECEIPT_CHANGED'; end if;
  return jsonb_build_object('state','SUCCEEDED');
 end if;
 update app.web_remote_variant_photo_outbox set state='SUCCEEDED',receipt=p_receipt where id=j.id;
 return jsonb_build_object('state','SUCCEEDED');
end $$;
revoke all on function app.finish_remote_variant_photos(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function app.finish_remote_variant_photos(uuid,uuid,jsonb,jsonb) to service_role;
create function public.finish_remote_variant_photos(p_job uuid,p_actor uuid,p_receipt jsonb,p_live jsonb) returns jsonb language sql security invoker set search_path='' as $$ select app.finish_remote_variant_photos(p_job,p_actor,p_receipt,p_live) $$;
revoke all on function public.finish_remote_variant_photos(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_remote_variant_photos(uuid,uuid,jsonb,jsonb) to service_role;
commit;
