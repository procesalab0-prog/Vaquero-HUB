begin;

select set_config('request.jwt.claim.sub','46f5c785-cf64-4a5e-bca9-18a904754c89',true);
do $test$
declare pid uuid; ctx jsonb; items jsonb; r jsonb; audit_count bigint; expected_created integer;
begin
select e.product_id into pid from app.web_variant_photo_evidence e where jsonb_array_length(e.photos)>0
and not exists(select 1 from app.web_variant_photo_evidence x cross join lateral jsonb_array_elements(x.photos) i
 where x.product_id=e.product_id and not exists(select 1 from storage.objects o where o.bucket_id='product-images'
 and o.name=x.product_id::text||'/'||(i->>'sha256')||'.'||case i->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end
 and o.metadata->>'size'=i->>'bytes' and o.metadata->>'mimetype'=i->>'mime')) limit 1;
if pid is null then raise exception 'NO_EXISTING_STORAGE_FIXTURE';end if;
ctx:=app.variant_photo_copy_context(pid);
select count(*) into expected_created from jsonb_array_elements(ctx->'items') i where jsonb_array_length(i->'photos')>0 and i->'stored'='null'::jsonb;
select jsonb_agg(jsonb_build_object('variant_id',i->>'variant_id','photos',(select jsonb_agg(jsonb_build_object('url',
'https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/'||pid::text||'/'||(p->>'sha256')||'.'||
case p->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end,'alt',p->>'alt') order by n)
from jsonb_array_elements(i->'photos') with ordinality z(p,n))))
into items from jsonb_array_elements(ctx->'items') i where jsonb_array_length(i->'photos')>0;
begin perform app.save_variant_photo_copies(pid,'bad',ctx->>'evidence_hash',items); raise exception 'EXPECTED_CHANGED';
exception when others then if sqlerrm<>'VARIANT_PHOTO_COPY_CHANGED' then raise;end if;end;
begin perform app.save_variant_photo_copies(pid,ctx->>'catalog_hash',ctx->>'evidence_hash','[]');raise exception 'EXPECTED_PACKET';
exception when others then if sqlerrm<>'INVALID_VARIANT_PHOTO_COPY_PACKET' then raise;end if;end;
begin perform app.save_variant_photo_copies(pid,ctx->>'catalog_hash',ctx->>'evidence_hash',jsonb_set(items,'{0,photos,0,url}','"https://evil.example/a.png"'));raise exception 'EXPECTED_ORIGIN';
exception when others then if sqlerrm<>'VARIANT_PHOTO_COPY_STORAGE_REVIEW' then raise;end if;end;
r:=app.save_variant_photo_copies(pid,ctx->>'catalog_hash',ctx->>'evidence_hash',items);
if (r->>'created')::int<>expected_created then raise exception 'CREATE_FAILED';end if;
select count(*) into audit_count from public.audit_log;
r:=app.save_variant_photo_copies(pid,ctx->>'catalog_hash',ctx->>'evidence_hash',items);
if (r->>'created')::int<>0 or (r->>'unchanged')::int<>jsonb_array_length(items) or audit_count<>(select count(*) from public.audit_log) then raise exception 'REPEAT_FAILED';end if;
if exists(select 1 from public.read_variant_photos(array(select (i->>'variant_id')::uuid from jsonb_array_elements(items) i)) r where r.photos#>>'{0,url}' not like 'https://zsezjtswqeijboezvado.supabase.co/%') then raise exception 'READER_FAILED';end if;
if has_table_privilege('authenticated','app.web_variant_photo_storage','UPDATE') or has_function_privilege('anon','public.save_variant_photo_copies(uuid,text,text,jsonb)','EXECUTE') then raise exception 'PERMISSIONS_FAILED';end if;
perform set_config('request.jwt.claim.sub','',true);
begin perform app.variant_photo_copy_context(pid);raise exception 'EXPECTED_NO_AUTH';exception when insufficient_privilege then null;end;
end $test$;
select jsonb_build_object('rollback',true,'checks',8) as data;
rollback;
