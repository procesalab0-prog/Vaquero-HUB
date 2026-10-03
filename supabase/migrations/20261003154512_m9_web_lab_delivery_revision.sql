begin;
-- Delivery revisions are independent of editorial revisions. Existing receipts remain valid.
create function app.web_lab_delivery_identity(packet jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select packet - array['version','revision','editorial_revision','mode','previous','family_evidence'];
$$;
revoke all on function app.web_lab_delivery_identity(jsonb) from public,anon,authenticated,service_role;
create function app.web_lab_delivery_packet(pid uuid,packet jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare prior app.web_lab_jobs; next_revision integer;
begin
 select * into prior from app.web_lab_jobs where product_id=pid and state='SUCCEEDED' order by revision desc limit 1;
 if prior.id is not null and app.web_lab_delivery_identity(packet)=app.web_lab_delivery_identity(prior.packet)
 then raise exception 'LAB_REVISION_ALREADY_SENT'; end if;
 select coalesce(max(revision),0)+1 into next_revision from app.web_lab_jobs where product_id=pid;
 return packet||jsonb_build_object('editorial_revision',packet->'revision','revision',next_revision);
end $$;
revoke all on function app.web_lab_delivery_packet(uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function app.web_lab_simple_packet(pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d app.web_product_drafts; s app.web_content_sources; e app.web_lab_enabled_products; c jsonb; b jsonb; prior app.web_lab_jobs; result jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into e from app.web_lab_enabled_products where product_id=pid and enabled;
 if not found then raise exception 'LAB_NOT_ENABLED'; end if;
 select * into s from app.web_content_sources where product_id=pid;
 if s.product_id is null or s.snapshot->>'type' is distinct from 'simple' or md5(s.snapshot::text)<>e.source_fingerprint then raise exception 'LAB_SOURCE_CHANGED'; end if;
 select * into d from app.web_product_drafts where product_id=pid;
 if d.product_id is null then raise exception 'LAB_SAVE_REQUIRED'; end if;
 perform app.validate_web_content(d.content);
 b:=app.web_category_binding_state(pid);
 if coalesce((b->>'valid')::boolean,false)=false then raise exception 'LAB_CATEGORY_REVIEW'; end if;
 c:=app.web_catalog_snapshot(pid);
 if c->>'active'<>'true' or jsonb_array_length(c->'variants')<>1
   or c#>>'{variants,0,active}'<>'true' or c#>'{variants,0,attributes}'<>'{}'::jsonb
   or coalesce(jsonb_array_length(s.snapshot->'unselected_woo_variation_ids'),0)<>0
   or nullif(c#>>'{variants,0,barcode}','') is null or nullif(c#>>'{variants,0,sku}','') is null
   or (c#>>'{variants,0,price_cents}')::bigint<=0
   then raise exception 'LAB_SIMPLE_PRODUCT_ONLY'; end if;
 if not exists(select 1 from app.m9_rows r where r.variant_id=(c#>>'{variants,0,id}')::uuid
   and r.barcode=c#>>'{variants,0,barcode}' and r.source_row=app.m9_current_row(r.variant_id))
   then raise exception 'LAB_SICAR_REVIEW_REQUIRED'; end if;
 if length(btrim(d.content->>'description'))=0 or length(btrim(d.content->>'base_code'))=0
   or d.content->>'short_description'<>d.content->>'base_code'
   or jsonb_array_length(d.content->'images')=0 then raise exception 'LAB_INCOMPLETE_CONTENT'; end if;
 select * into prior from app.web_lab_jobs where product_id=pid and state='SUCCEEDED' order by revision desc limit 1;
 result:=jsonb_build_object('version',1,'store',jsonb_build_object('id',e.store_id,'base_url','http://127.0.0.1:9417','environment','LOCAL_WOO_TEST'),
 'product_id',pid,'revision',d.revision,'mode','create','type','simple','content',d.content,
 'catalog',c,'fingerprint',md5(c::text),'category_evidence',b,'source_fingerprint',e.source_fingerprint);
 if prior.id is not null then
  result:=result||jsonb_build_object('version',2,'mode','update','previous',jsonb_build_object('job_id',prior.id,'revision',prior.revision,'receipt',prior.receipt));
 end if;
 return app.web_lab_delivery_packet(pid,result);
end $$;
create or replace function app.web_lab_packet(pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s app.web_content_sources; e app.web_lab_enabled_products; f app.web_lab_family_evidence;
 d app.web_product_drafts; prior app.web_lab_jobs; c jsonb; b jsonb; v jsonb; expected jsonb; actual jsonb; result jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into s from app.web_content_sources where product_id=pid;
 if s.snapshot->>'type'='simple' then return app.web_lab_simple_packet(pid); end if;
 select * into e from app.web_lab_enabled_products where product_id=pid and enabled;
 if not found then raise exception 'LAB_NOT_ENABLED'; end if;
 if s.product_id is null or s.snapshot->>'type' is distinct from 'variable' or md5(s.snapshot::text)<>e.source_fingerprint then raise exception 'LAB_SOURCE_CHANGED'; end if;
 c:=app.web_catalog_snapshot(pid);
 select * into f from app.web_lab_family_evidence where product_id=pid;
 if not found or f.source_sha256<>s.source_sha256 or f.source_fingerprint<>md5(s.snapshot::text)
   or f.catalog_fingerprint<>md5(c::text) then raise exception 'LAB_FAMILY_REVIEW_REQUIRED'; end if;
 if c->>'active' is distinct from 'true' or jsonb_array_length(c->'variants') not between 2 and 100 then raise exception 'LAB_INCOMPLETE_FAMILY'; end if;
 select jsonb_agg(id order by id) into expected from (
  select (value->>'woo_variation_id')::bigint id from jsonb_array_elements(s.snapshot->'variants')
  union all select value::bigint from jsonb_array_elements_text(s.snapshot->'unselected_woo_variation_ids')
 ) q;
 select jsonb_agg((value->>'woo_variation_id')::bigint order by (value->>'woo_variation_id')::bigint) into actual from jsonb_array_elements(c->'variants');
 if expected is null or actual is distinct from expected then raise exception 'LAB_INCOMPLETE_FAMILY'; end if;
 for v in select value from jsonb_array_elements(c->'variants') loop
  if v->>'active' is distinct from 'true' or (v->>'woo_product_id')::bigint is distinct from (s.snapshot->>'woo_product_id')::bigint
    or nullif(v->>'barcode','') is null or nullif(v->>'sku','') is null
    or coalesce((v->>'price_cents')::bigint,0)<=0 or v->'attributes'='{}'::jsonb then raise exception 'LAB_INCOMPLETE_FAMILY'; end if;
  if not exists(select 1 from app.m9_rows r where r.variant_id=(v->>'id')::uuid and r.barcode=v->>'barcode'
    and r.source_row=app.m9_current_row(r.variant_id)) then raise exception 'LAB_SICAR_REVIEW_REQUIRED'; end if;
 end loop;
 select * into d from app.web_product_drafts where product_id=pid;
 if d.product_id is null then raise exception 'LAB_SAVE_REQUIRED'; end if;
 perform app.validate_web_content(d.content);
 b:=app.web_category_binding_state(pid);
 if coalesce((b->>'valid')::boolean,false)=false then raise exception 'LAB_CATEGORY_REVIEW'; end if;
 if length(btrim(d.content->>'description'))=0 or length(btrim(d.content->>'base_code'))=0
   or d.content->>'short_description'<>d.content->>'base_code' or jsonb_array_length(d.content->'images')=0 then raise exception 'LAB_INCOMPLETE_CONTENT'; end if;
 select * into prior from app.web_lab_jobs where product_id=pid and state='SUCCEEDED' order by revision desc limit 1;
 result:=jsonb_build_object('version',3,'store',jsonb_build_object('id',e.store_id,'base_url','http://127.0.0.1:9417','environment','LOCAL_WOO_TEST'),
 'product_id',pid,'revision',d.revision,'mode','create','type','variable','content',d.content,
 'catalog',c,'fingerprint',md5(c::text),'category_evidence',b,'source_fingerprint',e.source_fingerprint,
 'family_evidence',to_jsonb(f),'parent_attributes',coalesce(s.snapshot->'parent_attributes_source','[]'::jsonb));
 if prior.id is not null then
  if prior.packet->>'type'<>'variable' then raise exception 'LAB_TARGET_CHANGED'; end if;
  result:=result||jsonb_build_object('version',4,'mode','update','previous',jsonb_build_object('job_id',prior.id,'revision',prior.revision,'receipt',prior.receipt));
 end if;
 return app.web_lab_delivery_packet(pid,result);
end $$;
create or replace function app.enqueue_web_lab(p_product_id uuid,p_revision integer,p_fingerprint text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; packet jsonb; j app.web_lab_jobs; h text;
begin
 d:=app.read_web_draft(p_product_id,null);
 if coalesce((d->>'can_edit')::boolean,false)=false then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_request_id is null or p_revision is null then raise exception 'INVALID_LAB_REQUEST'; end if;
 h:=md5(jsonb_build_array(p_product_id,p_revision,p_fingerprint)::text);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,1));
 select * into j from app.web_lab_jobs where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if j.request_hash<>h then raise exception 'LAB_REQUEST_REUSED'; end if;
  return app.read_web_lab(p_product_id);
 end if;
 perform 1 from public.products where id=p_product_id for update;
 packet:=app.web_lab_packet(p_product_id);
 if p_revision<>(packet->>'editorial_revision')::integer or p_fingerprint is distinct from packet->>'fingerprint' then raise exception 'LAB_SAVED_VERSION_CHANGED'; end if;
 if exists(select 1 from app.web_lab_jobs where product_id=p_product_id and state in ('READY','RUNNING','REVIEW_REQUIRED')) then raise exception 'LAB_ALREADY_REQUESTED'; end if;
 insert into app.web_lab_jobs(product_id,actor_id,request_id,request_hash,revision,packet)
 values(p_product_id,auth.uid(),p_request_id,h,(packet->>'revision')::integer,packet) returning * into j;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.web_lab.enqueue','product',p_product_id,
  jsonb_build_object('job_id',j.id,'actor',auth.uid(),'revision',j.revision,'editorial_revision',p_revision,'production_written',false));
 return app.read_web_lab(p_product_id);
end $$;
create or replace function app.claim_web_lab(p_job_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j app.web_lab_jobs; fresh jsonb; pid uuid;
begin
 perform app.assert_sicar_staging_enabled();
 select product_id into strict pid from app.web_lab_jobs where id=p_job_id;
 perform 1 from public.products where id=pid for update;
 select * into strict j from app.web_lab_jobs where id=p_job_id for update;
 if j.state<>'READY' then raise exception 'LAB_NOT_READY'; end if;
 begin fresh:=app.web_lab_packet(pid); exception when others then fresh:=null; end;
 -- Ignore only the newly allocated candidate sequence, not evidence or editorial changes.
 if (fresh - 'revision') is distinct from (j.packet - 'revision') then
  update app.web_lab_jobs set state='SUPERSEDED',updated_at=now() where id=j.id;
  return jsonb_build_object('id',j.id,'state','SUPERSEDED');
 end if;
 update app.web_lab_jobs set state='RUNNING',claim_id=gen_random_uuid(),updated_at=now() where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'state',j.state,'claim_id',j.claim_id,'packet',j.packet);
end $$;
create or replace function app.read_web_lab(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d jsonb; j app.web_lab_jobs; enabled boolean; verified app.web_lab_jobs; can_request boolean:=false; reason text; candidate jsonb;
begin
 d:=app.read_web_draft(p_product_id,null); -- authenticated permission and staging checks
 select coalesce(e.enabled,false) into enabled from app.web_lab_enabled_products e where product_id=p_product_id;
 select * into j from app.web_lab_jobs where product_id=p_product_id order by created_at desc,id desc limit 1;
 select * into verified from app.web_lab_jobs where product_id=p_product_id and state='SUCCEEDED' order by revision desc limit 1;
 if coalesce(enabled,false) and not exists(select 1 from app.web_lab_jobs where product_id=p_product_id and state in ('READY','RUNNING','REVIEW_REQUIRED')) then
  begin candidate:=app.web_lab_packet(p_product_id); can_request:=true;
  exception when raise_exception then reason:=sqlerrm; end;
 end if;
 return jsonb_build_object('can_request',can_request,'request_reason',reason,'last_verified_variants',coalesce(verified.receipt->'variants','[]'::jsonb),'last_verified_revision',verified.revision,'local_product_id',verified.receipt->'local_product_id','enabled',coalesce(enabled,false),'supervised',true,'production_enabled',false,
 'job',case when j.id is null then null else jsonb_build_object('id',j.id,'state',j.state,'revision',j.revision,'editorial_revision',coalesce(j.packet->'editorial_revision',to_jsonb(j.revision)),'mode',j.packet->>'mode',
 'created_at',j.created_at,'updated_at',j.updated_at,'local_product_id',j.receipt->'local_product_id') end);
end $$;
commit;
