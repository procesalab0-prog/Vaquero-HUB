-- Private staging-only forward draft. No remote application by its preparer.
create table app.m9_sicar_price_events(
 request_id uuid primary key,
 action text not null check(action in('APPLY','REVERSE')),
 reverses_request_id uuid unique references app.m9_sicar_price_events(request_id),
 actor_user_id uuid not null references public.app_users(id),
 packet_sha256 text not null check(packet_sha256~'^[a-f0-9]{64}$'),
 packet jsonb not null,before_state jsonb not null,after_state jsonb not null,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 check((action='APPLY'and reverses_request_id is null)or(action='REVERSE'and reverses_request_id is not null))
);
alter table app.m9_sicar_price_events enable row level security;
revoke all on app.m9_sicar_price_events from public,anon,authenticated,service_role;
create trigger m9_sicar_price_events_immutable before update or delete on app.m9_sicar_price_events
 for each row execute function app.m9_legacy_event_immutable();

create function app.m9_sicar_price_state(ids uuid[])returns jsonb
language sql stable security invoker set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object(
 'variant_id',v.id,'barcode',r.barcode,'managed',to_jsonb(r),'current',app.m9_rehearsal_current_row(v.id),
 'variant',to_jsonb(v),'product',to_jsonb(p),'category',to_jsonb(ct),'details',to_jsonb(d),
 'barcodes',coalesce((select jsonb_agg(to_jsonb(b)order by b.id)from public.barcodes b where b.variant_id=v.id),'[]'),
 'code_bindings',(select count(*)from public.barcodes b where b.code=r.barcode),
 'attributes',coalesce((select jsonb_agg(to_jsonb(a)order by a.type_code)from public.variant_attributes a where a.variant_id=v.id),'[]'),
 'attribute_values',coalesce((select jsonb_agg(to_jsonb(a)order by a.id)from public.attribute_values a join public.variant_attributes va on va.value_id=a.id where va.variant_id=v.id),'[]'),
 'independent_parent',(select to_jsonb(s)from app.m9_sicar_products s where s.product_id=p.id),
 'provisional',(select to_jsonb(pr)from app.m9_provisional_variants pr where pr.variant_id=v.id),
 'family_size',(select count(*)from public.variants x where x.product_id=p.id),
 'web',jsonb_build_object(
  'source',(select to_jsonb(s)from app.web_content_sources s where s.product_id=p.id),
  'draft',(select to_jsonb(dr)from app.web_product_drafts dr where dr.product_id=p.id),
  'link',(select to_jsonb(m)from app.m9_products m where m.product_id=p.id),
  'category',(select to_jsonb(c)from app.web_category_bindings c where c.product_id=p.id),
  'family',(select to_jsonb(f)from app.web_lab_family_evidence f where f.product_id=p.id),
  'approval',(select to_jsonb(a)from app.web_remote_family_approvals a where a.product_id=p.id),
  'photos',(select count(*)from app.web_variant_photo_evidence e where e.product_id=p.id),
  'lab_jobs',(select count(*)from app.web_lab_jobs j where j.product_id=p.id),
  'remote_jobs',(select count(*)from app.web_remote_jobs j where j.product_id=p.id),
  'lab_enabled',(select to_jsonb(e)from app.web_lab_enabled_products e where e.product_id=p.id)
 ))order by r.barcode),'[]'::jsonb)
from public.variants v join public.products p on p.id=v.product_id join app.m9_rows r on r.variant_id=v.id
join public.categories ct on ct.id=p.category_id join public.m9_variant_details d on d.variant_id=v.id
where v.id=any(ids)
$$;
revoke all on function app.m9_sicar_price_state(uuid[])from public,anon,authenticated,service_role;

create function app.m9_apply_sicar_public_prices(p jsonb)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;rid uuid;h text;old app.m9_sicar_price_events;ids uuid[];state jsonb;after_state jsonb;
 f jsonb;old_f jsonb;item jsonb;s jsonb;o jsonb;n jsonb;fields jsonb;oldfields jsonb;web jsonb;
begin
 if current_user<>'postgres'then raise insufficient_privilege;end if;
 actor:=app.m9_legacy_actor();
 if not app.m9_detail_shape(p,array['protocol','project_id','request_id','source_before_sha256','source_after_sha256','source_rows_json','source_rows_sha256','observed_at','expected_state','changes'])
  or p->>'protocol'is distinct from'm9-sicar-public-price-1'or p->>'project_id'is distinct from'zsezjtswqeijboezvado'
  or p->>'source_before_sha256'is distinct from'33b1d36200f8db0eecf0cd1fbdd1c76400ee291d747348a6c87881f39043cc44'or p->>'source_after_sha256'is distinct from'b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93'
  or jsonb_typeof(p->'changes')is distinct from'array'or jsonb_array_length(p->'changes')<>10
  or jsonb_typeof(p->'expected_state')is distinct from'array'or jsonb_array_length(p->'expected_state')<>10
  or jsonb_typeof(p->'source_rows_json')is distinct from'string'
  or encode(extensions.digest(p->>'source_rows_json','sha256'),'hex')is distinct from p->>'source_rows_sha256'
  or octet_length(p::text)>1000000 then raise exception 'SICAR_PRICE_EXACT_PACKET_REQUIRED';end if;
 s:=(p->>'source_rows_json')::jsonb;rid:=(p->>'request_id')::uuid;h:=encode(extensions.digest(p::text,'sha256'),'hex');
 if jsonb_typeof(s)is distinct from'array'or jsonb_array_length(s)<>10
  or(select array_agg(x->>'barcode'order by x->>'barcode')from jsonb_array_elements(p->'changes')x)is distinct from array['11425','11426','11427','11428','11429','11430','12232','12233','12235','12236']
  or(select array_agg(x->>'barcode'order by x->>'barcode')from jsonb_array_elements(s)x)is distinct from array['11425','11426','11427','11428','11429','11430','12232','12233','12235','12236']
  then raise exception 'SICAR_PRICE_FIXED_TEN_REQUIRED';end if;
 select array_agg((x->>'variant_id')::uuid order by x->>'barcode')into ids from jsonb_array_elements(p->'expected_state')x;
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 lock table public.products in exclusive mode;lock table public.variants in exclusive mode;
 lock table public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,
  app.m9_rows,app.m9_sicar_products,app.m9_provisional_variants,app.m9_products,app.web_content_sources,app.web_product_drafts,
  app.web_category_bindings,app.web_lab_family_evidence,app.web_remote_family_approvals,app.web_variant_photo_evidence,
  app.web_lab_jobs,app.web_remote_jobs,app.web_lab_enabled_products,app.m9_sicar_price_events in share row exclusive mode;
 select * into old from app.m9_sicar_price_events where request_id=rid;
 if found then
  if old.action<>'APPLY'or old.actor_user_id<>actor or old.packet_sha256<>h
   or exists(select 1 from app.m9_sicar_price_events where reverses_request_id=rid)
   or app.m9_sicar_price_state(ids)is distinct from old.after_state then raise exception 'SICAR_PRICE_REPLAY_CHANGED';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 if (p->>'observed_at')::timestamptz is null or (p->>'observed_at')::timestamptz>clock_timestamp()+interval'5 minutes'
  or(p->>'observed_at')::timestamptz<clock_timestamp()-interval'24 hours'then raise exception 'SICAR_PRICE_CONTEXT_EXPIRED';end if;
 state:=app.m9_sicar_price_state(ids);
 if state is distinct from p->'expected_state'then raise exception 'SICAR_PRICE_CONTEXT_CHANGED';end if;
 for f in select value from jsonb_array_elements(state)loop
  select value into item from jsonb_array_elements(p->'changes')x where x->>'barcode'=f->>'barcode';
  select x->'before',x->'after'into o,n from jsonb_array_elements(s)x where x->>'barcode'=f->>'barcode';
  fields:=n->'fields';oldfields:=o->'fields';web:=f->'web';
  if item is null or o is null or n is null or not app.m9_detail_shape(item,array['barcode','variant_id','previous_cents','new_cents'])
   or item->>'variant_id'is distinct from f->>'variant_id'or item->'previous_cents'is distinct from'98000'::jsonb or item->'new_cents'is distinct from'115000'::jsonb
   or (f->'managed')->'source_row'is distinct from f->'current'or f#>'{current,price_cents}'is distinct from item->'previous_cents'
   or f#>'{variant,cost_cents}'is distinct from'null'::jsonb or f#>'{current,cost_cents}'is distinct from'null'::jsonb
   or f#>'{variant,woocommerce_product_id}'is distinct from'null'::jsonb or f#>'{variant,woocommerce_variation_id}'is distinct from'null'::jsonb
   or f->'family_size'is distinct from'1'::jsonb or f->'code_bindings'is distinct from'1'::jsonb
   or f#>'{provisional,web_release}'is distinct from'false'::jsonb or f#>>'{provisional,grouping_status}'is distinct from'PROVISIONAL'
   or f#>>'{provisional,original_product_id}'is distinct from f#>>'{product,id}'
   or f#>>'{provisional,source_sha256}'is distinct from f#>>'{managed,source_sha256}'
   or f#>>'{variant,product_id}'is distinct from f#>>'{product,id}'
   or web is distinct from'{"source":null,"draft":null,"link":null,"category":null,"family":null,"approval":null,"photos":0,"lab_jobs":0,"remote_jobs":0,"lab_enabled":null}'::jsonb
   or not exists(select 1 from jsonb_array_elements(f->'barcodes')bc where bc->>'code'=f->>'barcode'and bc->>'variant_id'=f->>'variant_id'and bc->>'source'='SICAR'and bc->'is_primary'='true'::jsonb)
   then raise exception 'SICAR_PRICE_IDENTITY_OR_WEB_CHANGED';end if;
  if jsonb_typeof(fields)is distinct from'object'or jsonb_typeof(oldfields)is distinct from'object'
   or(fields-'precio1')is distinct from(oldfields-'precio1')or fields->>'precio1'is distinct from'1150'or oldfields->>'precio1'is distinct from'980'
   or o->>'barcode'is distinct from f->>'barcode'or n->>'barcode'is distinct from f->>'barcode'
   or fields->>'clave1 *'is distinct from f->>'barcode'or oldfields->>'clave1 *'is distinct from f->>'barcode'
   or fields->>'descripción *'is distinct from f#>>'{current,description}'or fields->>'departamento'is distinct from f#>>'{current,department}'
   or fields->>'categoria'is distinct from f#>>'{current,section}'or n->>'description'is distinct from o->>'description'
   or fields->>'unidad'is distinct from'PIEZA'or fields->>'(s/n) mostrar en ventas'is distinct from's'or fields->>'(s/n) inventariable'is distinct from's'
   or fields->>'(s/n) precio con impuestos'is distinct from's'or fields->>'(s/n) granel'is distinct from'n'or fields->>'(s/n) receta'is distinct from'n'or fields->>'(s/n) lotes'is distinct from'n'
   or o->'issues'is distinct from'[]'::jsonb or n->'issues'is distinct from'[]'::jsonb
   or o->'commercial_checks'is distinct from'[]'::jsonb or n->'commercial_checks'is distinct from'[]'::jsonb
   then raise exception 'SICAR_PRICE_LITERAL_SOURCE_CHANGED';end if;
 end loop;
 for item in select value from jsonb_array_elements(p->'changes')loop
  update public.variants set price_cents=(item->>'new_cents')::bigint,updated_by=actor where id=(item->>'variant_id')::uuid;
  update app.m9_rows set source_row=jsonb_set(source_row,'{price_cents}',item->'new_cents')where variant_id=(item->>'variant_id')::uuid;
 end loop;
 after_state:=app.m9_sicar_price_state(ids);
 for f in select value from jsonb_array_elements(after_state)loop
  select value into old_f from jsonb_array_elements(state)x where x->>'variant_id'=f->>'variant_id';
  if (f-array['variant','managed','current'])is distinct from(old_f-array['variant','managed','current'])
   or((f->'variant')-array['price_cents','updated_by','updated_at'])is distinct from((old_f->'variant')-array['price_cents','updated_by','updated_at'])
   or((f->'managed')-'source_row')is distinct from((old_f->'managed')-'source_row')
   or((f#>'{managed,source_row}')-'price_cents')is distinct from((old_f#>'{managed,source_row}')-'price_cents')
   or f#>'{variant,updated_by}'is distinct from to_jsonb(actor)
   or f#>'{managed,source_row}'is distinct from f->'current'or f#>'{current,price_cents}'is distinct from'115000'::jsonb
   then raise exception 'SICAR_PRICE_POSTCONDITION_FAILED';end if;
 end loop;
 insert into app.m9_sicar_price_events(request_id,action,actor_user_id,packet_sha256,packet,before_state,after_state,receipt)
 values(rid,'APPLY',actor,h,p,state,after_state,jsonb_build_object('request_id',rid,'changed',10,'source_after_sha256',p->>'source_after_sha256','projection_updated',true,'original_source_preserved',true,'woo_written',false,'stock_written',false,'web_release',false,'replayed',false))returning *into old;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)values(actor,'m9.sicar_public_price.apply','migration',rid::text,old.receipt);
 return old.receipt;
end $$;
revoke all on function app.m9_apply_sicar_public_prices(jsonb)from public,anon,authenticated,service_role;

create function app.m9_reverse_sicar_public_prices(req uuid,original uuid)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;prior app.m9_sicar_price_events;reversal app.m9_sicar_price_events;ids uuid[];state jsonb;after_state jsonb;f jsonb;old_f jsonb;h text;
begin
 if current_user<>'postgres'then raise insufficient_privilege;end if;actor:=app.m9_legacy_actor();
 if req is null or original is null or req=original then raise exception 'SICAR_PRICE_REVERSE_REQUIRED';end if;
 h:=encode(extensions.digest(jsonb_build_object('original',original)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 lock table public.products in exclusive mode;lock table public.variants in exclusive mode;
 lock table public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,
  app.m9_rows,app.m9_sicar_products,app.m9_provisional_variants,app.m9_products,app.web_content_sources,app.web_product_drafts,
  app.web_category_bindings,app.web_lab_family_evidence,app.web_remote_family_approvals,app.web_variant_photo_evidence,
  app.web_lab_jobs,app.web_remote_jobs,app.web_lab_enabled_products,app.m9_sicar_price_events in share row exclusive mode;
 select *into strict prior from app.m9_sicar_price_events where request_id=original and action='APPLY';
 select array_agg((x->>'variant_id')::uuid)into ids from jsonb_array_elements(prior.after_state)x;
 select *into reversal from app.m9_sicar_price_events where request_id=req;
 if found then
  if reversal.action<>'REVERSE'or reversal.reverses_request_id<>original or reversal.actor_user_id<>actor or reversal.packet_sha256<>h
   or app.m9_sicar_price_state(ids)is distinct from reversal.after_state then raise exception 'SICAR_PRICE_REVERSE_REPLAY_CHANGED';end if;
  return reversal.receipt||'{"replayed":true}'::jsonb;
 end if;
 if exists(select 1 from app.m9_sicar_price_events where reverses_request_id=original)then raise exception 'SICAR_PRICE_ALREADY_REVERSED';end if;
 state:=app.m9_sicar_price_state(ids);
 if state is distinct from prior.after_state then raise exception 'SICAR_PRICE_REVERSE_CONTEXT_CHANGED';end if;
 for f in select value from jsonb_array_elements(prior.before_state)loop
  update public.variants set price_cents=(f#>>'{variant,price_cents}')::bigint,updated_by=actor where id=(f->>'variant_id')::uuid;
  update app.m9_rows set source_row=jsonb_set(source_row,'{price_cents}',f#>'{managed,source_row,price_cents}')where variant_id=(f->>'variant_id')::uuid;
 end loop;
 after_state:=app.m9_sicar_price_state(ids);
 for f in select value from jsonb_array_elements(after_state)loop
  select value into old_f from jsonb_array_elements(prior.before_state)x where x->>'variant_id'=f->>'variant_id';
  if (f-'variant')is distinct from(old_f-'variant')
   or((f->'variant')-array['updated_by','updated_at'])is distinct from((old_f->'variant')-array['updated_by','updated_at'])
   or f#>'{variant,updated_by}'is distinct from to_jsonb(actor)
   then raise exception 'SICAR_PRICE_REVERSE_POSTCONDITION_FAILED';end if;
 end loop;
 insert into app.m9_sicar_price_events(request_id,action,reverses_request_id,actor_user_id,packet_sha256,packet,before_state,after_state,receipt)
 values(req,'REVERSE',original,actor,h,jsonb_build_object('original',original),state,after_state,jsonb_build_object('request_id',req,'reverses',original,'restored_prices',10,'history_preserved',true,'woo_written',false,'stock_written',false,'replayed',false))returning *into reversal;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)values(actor,'m9.sicar_public_price.reverse','migration',req::text,reversal.receipt);
 return reversal.receipt;
end $$;
revoke all on function app.m9_reverse_sicar_public_prices(uuid,uuid)from public,anon,authenticated,service_role;
