-- Private forward draft; extend the SAME price writer/journal, never a new importer.
-- Existing v1 service definitions are patched below only after exact preimage checks.
select app.assert_sicar_staging_enabled();
create function app.m9_sicar_linked_price_state(ids uuid[])returns jsonb
language sql stable security invoker set search_path='' as $$
select coalesce(jsonb_agg(f||jsonb_build_object('linked_context',jsonb_build_object(
 'siblings',coalesce((select jsonb_agg(jsonb_build_object('variant',to_jsonb(v),'managed',to_jsonb(r),'details',to_jsonb(d),
  'barcodes',(select jsonb_agg(to_jsonb(b)order by b.id)from public.barcodes b where b.variant_id=v.id),
  'attributes',(select coalesce(jsonb_agg(to_jsonb(a)order by a.type_code),'[]')from public.variant_attributes a where a.variant_id=v.id),
  'attribute_values',(select coalesce(jsonb_agg(to_jsonb(a)order by a.id),'[]')from public.attribute_values a join public.variant_attributes va on va.value_id=a.id where va.variant_id=v.id))order by v.id)
  from public.variants v join app.m9_rows r on r.variant_id=v.id join public.m9_variant_details d on d.variant_id=v.id
  where v.product_id=(f#>>'{product,id}')::uuid and v.id<>(f->>'variant_id')::uuid),'[]'),
 'catalog_identity',jsonb_set(app.web_catalog_snapshot((f#>>'{product,id}')::uuid),'{variants}',
  (select coalesce(jsonb_agg(x-'price_cents'order by x->>'id'),'[]')from jsonb_array_elements(app.web_catalog_snapshot((f#>>'{product,id}')::uuid)->'variants')x)),
 'evidence',(select coalesce(jsonb_agg(to_jsonb(e)order by e.variant_id),'[]')from app.web_variant_photo_evidence e where e.product_id=(f#>>'{product,id}')::uuid),
 'copies',(select coalesce(jsonb_agg(to_jsonb(c)order by c.variant_id),'[]')from app.web_variant_photo_storage c join app.web_variant_photo_evidence e using(variant_id)where e.product_id=(f#>>'{product,id}')::uuid),
 'category_guard',app.web_category_binding_state((f#>>'{product,id}')::uuid),
 'source_fingerprint',md5((f#>'{web,source}')::text),
 'copy_valid_count',(select count(*)from app.web_variant_photo_storage c join app.web_variant_photo_evidence e using(variant_id)
  where e.product_id=(f#>>'{product,id}')::uuid and c.evidence_hash=md5(to_jsonb(e)::text)
  and not exists(select 1 from jsonb_array_elements(c.photos)i where not exists(select 1 from storage.objects o where o.bucket_id='product-images'
   and o.name=substr(i->>'url',length('https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/')+1))))
 ))order by f->>'barcode'),'[]')
from jsonb_array_elements(app.m9_sicar_price_state(ids))x(f)
$$;
revoke all on function app.m9_sicar_linked_price_state(uuid[])from public,anon,authenticated,service_role;

create function app.m9_sicar_linked_price_locks()returns void
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'postgres'then raise insufficient_privilege;end if;
 perform app.m9_legacy_actor();if not app.has_perm('products.price_update')then raise insufficient_privilege;end if;
 begin
  if not pg_try_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0))then raise lock_not_available;end if;
  lock table public.products in exclusive mode nowait;
  lock table public.variants in exclusive mode nowait;
  lock table public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,
   app.m9_rows,app.m9_sicar_products,app.m9_provisional_variants,app.m9_products,app.web_content_sources,app.web_product_drafts,
   app.web_category_bindings,app.web_lab_family_evidence,app.web_remote_family_approvals,app.web_variant_photo_evidence,
   app.web_variant_photo_storage,app.web_lab_jobs,app.web_remote_jobs,app.web_lab_enabled_products,app.m9_sicar_price_events in share row exclusive mode nowait;
  perform 1 from storage.objects o where o.bucket_id='product-images'and exists(
   select 1 from app.web_variant_photo_storage c join app.web_variant_photo_evidence e using(variant_id)
   join app.m9_rows r on r.barcode='11777'join public.variants v on v.id=r.variant_id and v.product_id=e.product_id
   cross join jsonb_array_elements(c.photos)i where o.name=substr(i->>'url',length('https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/')+1))
   order by o.name for share of o nowait;
 exception when lock_not_available then raise exception 'SICAR_LINKED_PRICE_BUSY_RETRY'using errcode='55P03';end;
end $$;
revoke all on function app.m9_sicar_linked_price_locks()from public,anon,authenticated,service_role;

create function app.m9_validate_linked_price_packet(p jsonb)returns void
language plpgsql security invoker set search_path='' as $$
declare f jsonb;ctx jsonb;s jsonb;o jsonb;n jsonb;item jsonb;sv jsonb;e jsonb;
begin
 if current_user<>'postgres'then raise insufficient_privilege;end if;
 perform app.m9_legacy_actor();if not app.has_perm('products.price_update')then raise insufficient_privilege;end if;
 if not app.m9_detail_shape(p,array['protocol','project_id','request_id','source_before_sha256','source_after_sha256','source_rows_json','source_rows_sha256','observed_at','expected_state','changes'])
  or p->>'protocol'is distinct from'm9-sicar-public-price-linked-1'or p->>'project_id'is distinct from'zsezjtswqeijboezvado'
  or p->>'source_before_sha256'is distinct from'33b1d36200f8db0eecf0cd1fbdd1c76400ee291d747348a6c87881f39043cc44'
  or p->>'source_after_sha256'is distinct from'b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93'
  or jsonb_typeof(p->'source_rows_json')is distinct from'string'
  or p->>'source_rows_sha256'is distinct from'1358af1189079e5ce8ca12077c252f6a7445f6f4432a8e1b1b443a0574224b39'
  or encode(extensions.digest(p->>'source_rows_json','sha256'),'hex')is distinct from p->>'source_rows_sha256'
  or jsonb_typeof(p->'expected_state')is distinct from'array'or jsonb_array_length(p->'expected_state')<>1
  or jsonb_typeof(p->'changes')is distinct from'array'or jsonb_array_length(p->'changes')<>1
  or jsonb_typeof(p->'observed_at')is distinct from'string'
  or p->>'observed_at'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  then raise exception 'SICAR_LINKED_PRICE_EXACT_PACKET_REQUIRED';end if;
 if to_char((p->>'observed_at')::timestamptz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')is distinct from p->>'observed_at'
 then raise exception 'SICAR_LINKED_PRICE_EXACT_PACKET_REQUIRED';end if;
 s:=(p->>'source_rows_json')::jsonb;o:=s#>'{0,before}';n:=s#>'{0,after}';
 f:=p#>'{expected_state,0}';ctx:=f->'linked_context';item:=p#>'{changes,0}';
 select x into sv from jsonb_array_elements(f#>'{web,source,snapshot,variants}')x where x->>'barcode'='11777'and x->'woo_variation_id'='21826'::jsonb;
 select x into e from jsonb_array_elements(ctx->'evidence')x where x->>'barcode'='11777';
 if f->>'barcode'is distinct from'11777'or not app.m9_detail_shape(item,array['barcode','variant_id','previous_cents','new_cents'])
  or item->>'barcode'is distinct from'11777'or item->>'variant_id'is distinct from f->>'variant_id'
  or item->'previous_cents'is distinct from'810000'::jsonb or item->'new_cents'is distinct from'830000'::jsonb
  or f#>>'{managed,barcode}'is distinct from'11777'or f#>>'{managed,variant_id}'is distinct from f->>'variant_id'
  or f#>>'{variant,id}'is distinct from f->>'variant_id'or f#>>'{variant,product_id}'is distinct from f#>>'{product,id}'
  or f#>'{managed,source_row}'is distinct from f->'current'or f#>'{current,price_cents}'is distinct from'810000'::jsonb
  or f#>'{variant,price_cents}'is distinct from'810000'::jsonb
  or f#>'{current,cost_cents}'is distinct from'null'::jsonb or f#>'{variant,cost_cents}'is distinct from'null'::jsonb
  or f#>'{current,attributes}'is distinct from'{"TALLA":"56"}'::jsonb
  or f#>'{variant,woocommerce_product_id}'is distinct from'21768'::jsonb or f#>'{variant,woocommerce_variation_id}'is distinct from'21826'::jsonb
  or f#>'{current,woo_product_id}'is distinct from'21768'::jsonb or f#>'{current,woo_variation_id}'is distinct from'21826'::jsonb
  or f->'provisional'is distinct from'null'::jsonb or f->'independent_parent'is distinct from'null'::jsonb
  or f->'family_size'is distinct from'5'::jsonb or f->'code_bindings'is distinct from'1'::jsonb
  or not exists(select 1 from jsonb_array_elements(f->'barcodes')b where b->>'code'='11777'and b->>'variant_id'=f->>'variant_id'and b->>'source'='SICAR'and b->'is_primary'='true'::jsonb)
  or f#>>'{current,description}'is distinct from o->>'descripción *'or f#>>'{details,source_description}'is distinct from o->>'descripción *'
  or f#>>'{current,department}'is distinct from o->>'departamento'or f#>>'{current,section}'is distinct from o->>'categoria'
  or sv is null or sv->'attributes_sicar'is distinct from'{"TALLA":"56"}'::jsonb
  or sv->'attributes_woo'is distinct from'[{"name":"Talla","option":"56"}]'::jsonb
  or sv->>'retail_from_sicar'is distinct from'8100.00'or sv->>'regular_price_woo'is distinct from'8300'
  or f#>'{web,link,woo_id}'is distinct from'21768'::jsonb or f#>'{web,source,snapshot,woo_product_id}'is distinct from'21768'::jsonb
  or f#>>'{web,source,snapshot,source_status}'is distinct from'publish'
  or f#>'{web,family}'is distinct from'null'::jsonb or f#>'{web,approval}'is distinct from'null'::jsonb
  or f#>'{web,lab_enabled}'is distinct from'null'::jsonb or f#>'{web,lab_jobs}'is distinct from'0'::jsonb or f#>'{web,remote_jobs}'is distinct from'0'::jsonb
  or f#>'{web,photos}'is distinct from'5'::jsonb or jsonb_array_length(ctx->'siblings')<>4
  or jsonb_array_length(ctx->'evidence')<>5 or jsonb_array_length(ctx->'copies')<>5
  or ctx->'copy_valid_count'is distinct from'5'::jsonb or ctx#>'{category_guard,valid}'is distinct from'true'::jsonb
  or e is null or e->>'variant_id'is distinct from f->>'variant_id'or e->'woo_product_id'is distinct from'21768'::jsonb
  or e->'woo_variation_id'is distinct from'21826'::jsonb or e->'source_fingerprint'is distinct from ctx->'source_fingerprint'
  or e#>'{source_variant,attributes}'is distinct from sv->'attributes_woo'
  or e#>'{source_variant,id}'is distinct from'21826'::jsonb or e#>>'{source_variant,status}'is distinct from'publish'
  then raise exception 'SICAR_LINKED_PRICE_IDENTITY_OR_WEB_CHANGED';end if;
end $$;
revoke all on function app.m9_validate_linked_price_packet(jsonb)from public,anon,authenticated,service_role;

do $price_extension$
declare definition text;r jsonb;begin
 definition:=pg_get_functiondef('app.m9_apply_sicar_public_prices(jsonb)'::regprocedure);
 if encode(extensions.digest(definition,'sha256'),'hex')is distinct from'9617e8adecd4df455ab7ad108b0d6d612986ea326ba3a7d063bc4f9209b23c9b'then raise exception 'SICAR_PRICE_INSTALLED_PREIMAGE_CHANGED';end if;
 for r in select value from jsonb_array_elements('[["declare actor uuid;rid uuid;", "declare linked boolean:=coalesce(p->>''protocol''=''m9-sicar-public-price-linked-1'',false);actor uuid;rid uuid;", 1], [" actor:=app.m9_legacy_actor();", " actor:=app.m9_legacy_actor();\n if linked then perform app.m9_validate_linked_price_packet(p);end if;", 1], ["p->>''protocol''is distinct from''m9-sicar-public-price-1''", "(not linked and p->>''protocol''is distinct from''m9-sicar-public-price-1'')", 1], ["<>10", "<>(case when linked then 1 else 10 end)", 3], ["array[''11425'',''11426'',''11427'',''11428'',''11429'',''11430'',''12232'',''12233'',''12235'',''12236'']", "(case when linked then array[''11777'']else array[''11425'',''11426'',''11427'',''11428'',''11429'',''11430'',''12232'',''12233'',''12235'',''12236''] end)", 2], [" for f in select value from jsonb_array_elements(state)loop", " if not linked then\n for f in select value from jsonb_array_elements(state)loop", 1], [" end loop;\n for item in select value from jsonb_array_elements(p->''changes'')loop", " end loop;\n end if;\n for item in select value from jsonb_array_elements(p->''changes'')loop", 1], ["f#>''{current,price_cents}''is distinct from''115000''::jsonb", "f#>''{current,price_cents}''is distinct from(case when linked then ''830000''::jsonb else ''115000''::jsonb end)", 1], ["''changed'',10", "''changed'',case when linked then 1 else 10 end", 1], [" perform pg_advisory_xact_lock(hashtextextended(''sicar-catalog-sync'',0));\n lock table public.products in exclusive mode;lock table public.variants in exclusive mode;\n lock table public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,\n  app.m9_rows,app.m9_sicar_products,app.m9_provisional_variants,app.m9_products,app.web_content_sources,app.web_product_drafts,\n  app.web_category_bindings,app.web_lab_family_evidence,app.web_remote_family_approvals,app.web_variant_photo_evidence,\n  app.web_lab_jobs,app.web_remote_jobs,app.web_lab_enabled_products,app.m9_sicar_price_events in share row exclusive mode;", " if linked then perform app.m9_sicar_linked_price_locks();else\n perform pg_advisory_xact_lock(hashtextextended(''sicar-catalog-sync'',0));\n lock table public.products in exclusive mode;lock table public.variants in exclusive mode;\n lock table public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,\n  app.m9_rows,app.m9_sicar_products,app.m9_provisional_variants,app.m9_products,app.web_content_sources,app.web_product_drafts,\n  app.web_category_bindings,app.web_lab_family_evidence,app.web_remote_family_approvals,app.web_variant_photo_evidence,\n  app.web_lab_jobs,app.web_remote_jobs,app.web_lab_enabled_products,app.m9_sicar_price_events in share row exclusive mode;\n end if;", 1], ["app.m9_sicar_price_state(ids)", "(case when linked then app.m9_sicar_linked_price_state(ids)else app.m9_sicar_price_state(ids)end)", 3]]'::jsonb)loop
  if (length(definition)-length(replace(definition,r->>0,'')))/length(r->>0)<>(r->>2)::int then raise exception 'SICAR_PRICE_EXTENSION_TARGET_CHANGED';end if;
  definition:=replace(definition,r->>0,r->>1);
 end loop;
 execute definition;
end $price_extension$;
revoke all on function app.m9_apply_sicar_public_prices(jsonb)from public,anon,authenticated,service_role;

do $price_extension$
declare definition text;r jsonb;begin
 definition:=pg_get_functiondef('app.m9_reverse_sicar_public_prices(uuid,uuid)'::regprocedure);
 if encode(extensions.digest(definition,'sha256'),'hex')is distinct from'b98bb5713111632c24868e3ab6c7bb88ff7a3ddf01a1a238a75f72d0c9b1549a'then raise exception 'SICAR_PRICE_INSTALLED_PREIMAGE_CHANGED';end if;
 for r in select value from jsonb_array_elements('[["declare actor uuid;prior app.m9_sicar_price_events;", "declare linked boolean:=false;actor uuid;prior app.m9_sicar_price_events;", 1], [" h:=encode(extensions.digest(jsonb_build_object(''original'',original)::text,''sha256''),''hex'');", " select *into strict prior from app.m9_sicar_price_events where request_id=original and action=''APPLY'';\n linked:=coalesce(prior.packet->>''protocol''=''m9-sicar-public-price-linked-1'',false);\n if linked and not app.has_perm(''products.price_update'')then raise insufficient_privilege;end if;\n h:=encode(extensions.digest(jsonb_build_object(''original'',original)::text,''sha256''),''hex'');", 1], ["''restored_prices'',10", "''restored_prices'',case when linked then 1 else 10 end", 1], [" perform pg_advisory_xact_lock(hashtextextended(''sicar-catalog-sync'',0));\n lock table public.products in exclusive mode;lock table public.variants in exclusive mode;\n lock table public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,\n  app.m9_rows,app.m9_sicar_products,app.m9_provisional_variants,app.m9_products,app.web_content_sources,app.web_product_drafts,\n  app.web_category_bindings,app.web_lab_family_evidence,app.web_remote_family_approvals,app.web_variant_photo_evidence,\n  app.web_lab_jobs,app.web_remote_jobs,app.web_lab_enabled_products,app.m9_sicar_price_events in share row exclusive mode;", " if linked then perform app.m9_sicar_linked_price_locks();else\n perform pg_advisory_xact_lock(hashtextextended(''sicar-catalog-sync'',0));\n lock table public.products in exclusive mode;lock table public.variants in exclusive mode;\n lock table public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,\n  app.m9_rows,app.m9_sicar_products,app.m9_provisional_variants,app.m9_products,app.web_content_sources,app.web_product_drafts,\n  app.web_category_bindings,app.web_lab_family_evidence,app.web_remote_family_approvals,app.web_variant_photo_evidence,\n  app.web_lab_jobs,app.web_remote_jobs,app.web_lab_enabled_products,app.m9_sicar_price_events in share row exclusive mode;\n end if;", 1], ["app.m9_sicar_price_state(ids)", "(case when linked then app.m9_sicar_linked_price_state(ids)else app.m9_sicar_price_state(ids)end)", 3]]'::jsonb)loop
  if (length(definition)-length(replace(definition,r->>0,'')))/length(r->>0)<>(r->>2)::int then raise exception 'SICAR_PRICE_EXTENSION_TARGET_CHANGED';end if;
  definition:=replace(definition,r->>0,r->>1);
 end loop;
 execute definition;
end $price_extension$;
revoke all on function app.m9_reverse_sicar_public_prices(uuid,uuid)from public,anon,authenticated,service_role;
