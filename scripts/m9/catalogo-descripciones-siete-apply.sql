begin;
select app.assert_sicar_staging_enabled();
-- Private draft only. Root owns migration creation and all remote writes.
create table app.m9_sicar_description_events(
 request_id uuid primary key,
 action text not null check(action in('APPLY','REVERSE')),
 reverses_request_id uuid unique references app.m9_sicar_description_events(request_id),
 actor_user_id uuid not null references public.app_users(id),
 packet_sha256 text not null check(packet_sha256~'^[a-f0-9]{64}$'),
 packet jsonb not null,before_state jsonb not null,after_state jsonb not null,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 check((action='APPLY'and reverses_request_id is null)or(action='REVERSE'and reverses_request_id is not null))
);
alter table app.m9_sicar_description_events enable row level security;
revoke all on app.m9_sicar_description_events from public,anon,authenticated,service_role;
create trigger m9_sicar_description_events_immutable before update or delete on app.m9_sicar_description_events
 for each row execute function app.m9_legacy_event_immutable();

create function app.m9_sicar_description_actor()returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid();begin
 perform app.assert_sicar_staging_enabled();
 if current_user<>'postgres'or actor is null or not exists(
  select 1 from public.app_users u join public.roles r on r.id=u.role_id
  where u.id=actor and u.is_active and r.code='ADMIN')or not app.has_perm('products.update')
 then raise insufficient_privilege;end if;
 return actor;
end $$;
revoke all on function app.m9_sicar_description_actor()from public,anon,authenticated,service_role;

create function app.m9_sicar_description_locks()returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform app.m9_sicar_description_actor();
 -- The exception subtransaction releases every partially acquired barrier.
 begin
  if not pg_try_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0))
  then raise exception 'SICAR_DESCRIPTION_CATALOG_BUSY'using errcode='55P03';end if;
  lock table public.products in exclusive mode nowait;
  lock table public.variants in exclusive mode nowait;
  lock table public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,
   app.m9_rows,app.m9_sicar_products,app.m9_provisional_variants,app.m9_products,app.web_content_sources,app.web_product_drafts,
   app.web_category_bindings,app.web_lab_family_evidence,app.web_remote_family_approvals,app.web_variant_photo_evidence,
   app.web_lab_jobs,app.web_remote_jobs,app.web_lab_enabled_products,app.m9_sicar_description_events in share row exclusive mode nowait;
 exception when lock_not_available then
  raise exception 'SICAR_DESCRIPTION_CATALOG_BUSY'using errcode='55P03';
 end;
end $$;
revoke all on function app.m9_sicar_description_locks()from public,anon,authenticated,service_role;

create function app.m9_apply_sicar_descriptions(p jsonb)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;rid uuid;h text;prior app.m9_sicar_description_events;ids uuid[];state jsonb;after_state jsonb;
 f jsonb;old_f jsonb;item jsonb;s jsonb;o jsonb;n jsonb;web jsonb;expected_f jsonb;rec jsonb;
begin
 actor:=app.m9_sicar_description_actor();
 if not app.m9_detail_shape(p,array['protocol','project_id','request_id','source_before_sha256','source_after_sha256','source_rows_json','source_rows_sha256','observed_at','expected_state','changes'])
  or p->>'protocol'is distinct from'm9-sicar-description-seven-1'or p->>'project_id'is distinct from'zsezjtswqeijboezvado'
  or p->>'source_before_sha256'is distinct from'33b1d36200f8db0eecf0cd1fbdd1c76400ee291d747348a6c87881f39043cc44'
  or p->>'source_after_sha256'is distinct from'b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93'
  or jsonb_typeof(p->'changes')is distinct from'array'or jsonb_array_length(p->'changes')<>7
  or jsonb_typeof(p->'expected_state')is distinct from'array'or jsonb_array_length(p->'expected_state')<>7
  or jsonb_typeof(p->'source_rows_json')is distinct from'string'
  or jsonb_typeof(p->'observed_at')is distinct from'string'
  or p->>'observed_at'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  or p->>'source_rows_sha256'is distinct from'0284d3e543eee30602ce9d2001afffb310df44299181dd0cbd0ee0eadedf60cb'
  or encode(extensions.digest(p->>'source_rows_json','sha256'),'hex')is distinct from p->>'source_rows_sha256'
  or octet_length(p::text)>1000000 then raise exception 'SICAR_DESCRIPTION_EXACT_PACKET_REQUIRED';end if;
 if to_char((p->>'observed_at')::timestamptz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')is distinct from p->>'observed_at'
 then raise exception 'SICAR_DESCRIPTION_EXACT_PACKET_REQUIRED';end if;
 s:=(p->>'source_rows_json')::jsonb;rid:=(p->>'request_id')::uuid;h:=encode(extensions.digest(p::text,'sha256'),'hex');
 if jsonb_typeof(s)is distinct from'array'or jsonb_array_length(s)<>7
  or(select array_agg(x->>'barcode'order by x->>'barcode')from jsonb_array_elements(p->'changes')x)is distinct from array['18221','18222','18223','18224','18225','18226','18227']
  or(select array_agg(x->>'barcode'order by x->>'barcode')from jsonb_array_elements(p->'expected_state')x)is distinct from array['18221','18222','18223','18224','18225','18226','18227']
  then raise exception 'SICAR_DESCRIPTION_FIXED_SEVEN_REQUIRED';end if;
 select array_agg((x->>'variant_id')::uuid order by x->>'barcode')into ids from jsonb_array_elements(p->'expected_state')x;
 perform app.m9_sicar_description_locks();
 select *into prior from app.m9_sicar_description_events where request_id=rid;
 if found then
  if prior.action<>'APPLY'or prior.actor_user_id<>actor or prior.packet_sha256<>h
   or exists(select 1 from app.m9_sicar_description_events where reverses_request_id=rid)
   or app.m9_sicar_price_state(ids)is distinct from prior.after_state then raise exception 'SICAR_DESCRIPTION_REPLAY_CHANGED';end if;
  return prior.receipt||'{"replayed":true}'::jsonb;
 end if;
 if(p->>'observed_at')::timestamptz is null or(p->>'observed_at')::timestamptz>clock_timestamp()+interval'5 minutes'
  or(p->>'observed_at')::timestamptz<clock_timestamp()-interval'24 hours'then raise exception 'SICAR_DESCRIPTION_CONTEXT_EXPIRED';end if;
 state:=app.m9_sicar_price_state(ids);
 if state is distinct from p->'expected_state'then raise exception 'SICAR_DESCRIPTION_CONTEXT_CHANGED';end if;
 for f in select value from jsonb_array_elements(state)loop
  select value into item from jsonb_array_elements(p->'changes')x where x->>'barcode'=f->>'barcode';
  select x->'before',x->'after'into o,n from jsonb_array_elements(s)x where x->>'barcode'=f->>'barcode';
  web:=f->'web';
  if item is null or o is null or n is null or not app.m9_detail_shape(item,array['barcode','variant_id','previous_description','new_description'])
   or item->>'variant_id'is distinct from f->>'variant_id'or item->>'previous_description'is distinct from o->>'descripción *'
   or item->>'new_description'is distinct from n->>'descripción *'or(o-'descripción *')is distinct from(n-'descripción *')
   or f#>'{managed,source_row}'is distinct from f->'current'or f#>>'{current,description}'is distinct from o->>'descripción *'
   or f#>>'{details,source_description}'is distinct from o->>'descripción *'
   or f#>>'{current,barcode}'is distinct from f->>'barcode'or f#>>'{managed,barcode}'is distinct from f->>'barcode'
   or f#>>'{managed,variant_id}'is distinct from f->>'variant_id'or f#>>'{variant,id}'is distinct from f->>'variant_id'
   or f#>>'{variant,product_id}'is distinct from f#>>'{product,id}'
   or f#>'{current,price_cents}'is distinct from'650000'::jsonb or f#>'{variant,price_cents}'is distinct from'650000'::jsonb
   or f#>'{current,cost_cents}'is distinct from'null'::jsonb or f#>'{variant,cost_cents}'is distinct from'null'::jsonb
   or f#>'{current,attributes}'is distinct from'{}'::jsonb or f->'attributes'is distinct from'[]'::jsonb or f->'attribute_values'is distinct from'[]'::jsonb
   or f#>'{variant,woocommerce_product_id}'is distinct from'null'::jsonb or f#>'{variant,woocommerce_variation_id}'is distinct from'null'::jsonb
   or f#>'{current,woo_variation_id}'is distinct from'null'::jsonb
   or f->'family_size'is distinct from'1'::jsonb or f->'code_bindings'is distinct from'1'::jsonb
   or(select count(*)from jsonb_array_elements(f->'barcodes')b where b->>'code'=f->>'barcode'and b->>'variant_id'=f->>'variant_id'and b->>'source'='SICAR')<>1
   or f#>>'{provisional,grouping_status}'is distinct from'PROVISIONAL'or f#>'{provisional,web_release}'is distinct from'false'::jsonb
   or f#>'{provisional,grouping_event_id}'is distinct from'null'::jsonb
   or f#>>'{provisional,original_product_id}'is distinct from f#>>'{product,id}'
   or f#>>'{provisional,source_sha256}'is distinct from f#>>'{managed,source_sha256}'
   or f#>'{provisional,source_evidence,fields}'is distinct from o
   or f#>>'{provisional,source_evidence,barcode}'is distinct from f->>'barcode'
   or f#>>'{provisional,source_evidence,grouping_status}'is distinct from'PROVISIONAL'
   or f#>'{provisional,source_evidence,web_release}'is distinct from'false'::jsonb
   or f#>>'{current,department}'is distinct from o->>'departamento'or f#>>'{current,section}'is distinct from o->>'categoria'
   or f#>>'{current,product_name}'is distinct from(o->>'descripción *')||' [SICAR '||(f->>'barcode')||']'
   or f#>>'{product,name}'is distinct from f#>>'{current,product_name}'
   or f#>>'{independent_parent,product_id}'is distinct from f#>>'{product,id}'
   or f#>>'{independent_parent,family_key}'is distinct from f#>>'{current,family_key}'
   or f#>>'{independent_parent,source_name}'is distinct from f#>>'{current,product_name}'
   or coalesce(f#>>'{current,family_key}','')not like'prov-%'
   or f#>'{category,is_active}'is distinct from'true'::jsonb
   or web is distinct from'{"source":null,"draft":null,"link":null,"category":null,"family":null,"approval":null,"photos":0,"lab_jobs":0,"remote_jobs":0,"lab_enabled":null}'::jsonb
   then raise exception 'SICAR_DESCRIPTION_IDENTITY_SOURCE_OR_WEB_CHANGED';end if;
 end loop;
 for item in select value from jsonb_array_elements(p->'changes')loop
  update public.m9_variant_details set source_description=item->>'new_description'where variant_id=(item->>'variant_id')::uuid;
  update app.m9_rows set source_row=jsonb_set(source_row,'{description}',item->'new_description')where variant_id=(item->>'variant_id')::uuid;
 end loop;
 after_state:=app.m9_sicar_price_state(ids);
 for f in select value from jsonb_array_elements(after_state)loop
  select value into old_f from jsonb_array_elements(state)x where x->>'variant_id'=f->>'variant_id';
  select value into item from jsonb_array_elements(p->'changes')x where x->>'variant_id'=f->>'variant_id';
  expected_f:=jsonb_set(jsonb_set(jsonb_set(old_f,'{details,source_description}',item->'new_description'),'{managed,source_row,description}',item->'new_description'),'{current,description}',item->'new_description');
  if f is distinct from expected_f then raise exception 'SICAR_DESCRIPTION_UNEXPECTED_AFTER_STATE';end if;
 end loop;
 rec:=jsonb_build_object('protocol','m9-sicar-description-seven-receipt-1','request_id',rid,'changed_descriptions',7,
  'source_after_sha256',p->>'source_after_sha256','source_rows_sha256',p->>'source_rows_sha256','original_source_preserved',true,
  'product_names_preserved',true,'price_stock_cost_woo_writes',0,'grouping_decisions',0,'replayed',false);
 insert into app.m9_sicar_description_events(request_id,action,actor_user_id,packet_sha256,packet,before_state,after_state,receipt)
  values(rid,'APPLY',actor,h,p,state,after_state,rec);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  values(actor,'m9.sicar_descriptions.apply','migration',rid::text,rec);
 return rec;
end $$;
revoke all on function app.m9_apply_sicar_descriptions(jsonb)from public,anon,authenticated,service_role;

create function app.m9_reverse_sicar_descriptions(req uuid,original uuid)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;prior app.m9_sicar_description_events;reversal app.m9_sicar_description_events;
 ids uuid[];state jsonb;after_state jsonb;f jsonb;rec jsonb;h text;
begin
 actor:=app.m9_sicar_description_actor();
 if req is null or original is null or req=original then raise exception 'SICAR_DESCRIPTION_REVERSE_IDS_REQUIRED';end if;
 perform app.m9_sicar_description_locks();
 select *into strict prior from app.m9_sicar_description_events where request_id=original and action='APPLY';
 select array_agg((x->>'variant_id')::uuid order by x->>'barcode')into ids from jsonb_array_elements(prior.before_state)x;
 h:=encode(extensions.digest(jsonb_build_object('original',original)::text,'sha256'),'hex');
 select *into reversal from app.m9_sicar_description_events where request_id=req;
 if found then
  if reversal.action<>'REVERSE'or reversal.reverses_request_id<>original or reversal.actor_user_id<>actor or reversal.packet_sha256<>h
   or app.m9_sicar_price_state(ids)is distinct from reversal.after_state then raise exception 'SICAR_DESCRIPTION_REVERSE_REPLAY_CHANGED';end if;
  return reversal.receipt||'{"replayed":true}'::jsonb;
 end if;
 if exists(select 1 from app.m9_sicar_description_events where reverses_request_id=original)then raise exception 'SICAR_DESCRIPTION_ALREADY_REVERSED';end if;
 state:=app.m9_sicar_price_state(ids);
 if state is distinct from prior.after_state then raise exception 'SICAR_DESCRIPTION_REVERSE_CONTEXT_CHANGED';end if;
 for f in select value from jsonb_array_elements(prior.before_state)loop
  update public.m9_variant_details set source_description=f#>>'{details,source_description}'where variant_id=(f->>'variant_id')::uuid;
  update app.m9_rows set source_row=jsonb_set(source_row,'{description}',f#>'{managed,source_row,description}')where variant_id=(f->>'variant_id')::uuid;
 end loop;
 after_state:=app.m9_sicar_price_state(ids);
 if after_state is distinct from prior.before_state then raise exception 'SICAR_DESCRIPTION_UNEXPECTED_REVERSE_STATE';end if;
 rec:=jsonb_build_object('protocol','m9-sicar-description-seven-receipt-1','request_id',req,'reverses_request_id',original,
  'restored_descriptions',7,'original_source_preserved',true,'product_names_preserved',true,'price_stock_cost_woo_writes',0,'replayed',false);
 insert into app.m9_sicar_description_events(request_id,action,reverses_request_id,actor_user_id,packet_sha256,packet,before_state,after_state,receipt)
  values(req,'REVERSE',original,actor,h,jsonb_build_object('original',original),state,after_state,rec);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  values(actor,'m9.sicar_descriptions.reverse','migration',req::text,rec);
 return rec;
end $$;
revoke all on function app.m9_reverse_sicar_descriptions(uuid,uuid)from public,anon,authenticated,service_role;
commit;
