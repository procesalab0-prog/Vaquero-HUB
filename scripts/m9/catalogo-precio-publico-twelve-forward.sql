-- CANDIDATE ONLY: no PostgreSQL acceptance yet. No remote execution authorization.
-- One atomic installation DO; caller's QA transaction must ROLLBACK.
-- Same APPLY/REVERSE/journal and native UPDATE statements; no new table or public grant.
do $install_twelve$
declare definition text;r jsonb;
begin
 if current_user<>'postgres'or session_user<>'postgres'or current_setting('role')not in('none','postgres')then raise insufficient_privilege;end if;
 perform app.assert_sicar_staging_enabled();perform app.m9_legacy_actor();
 if not app.has_perm('products.price_update')then raise insufficient_privilege;end if;
 if encode(extensions.digest(pg_get_functiondef('app.m9_apply_sicar_public_prices(jsonb)'::regprocedure),'sha256'),'hex')<>'39f3584ee29a00c7baeb6df3d1f452279d7af33ee13b1e04962235a6563de367'
 or not exists(select 1 from pg_proc f where f.oid='app.m9_apply_sicar_public_prices(jsonb)'::regprocedure and pg_get_userbyid(f.proowner)='postgres'and not f.prosecdef
 and not has_function_privilege('anon',f.oid,'EXECUTE')and not has_function_privilege('authenticated',f.oid,'EXECUTE')and not has_function_privilege('service_role',f.oid,'EXECUTE'))
 then raise exception 'SICAR_TWELVE_PRICE_INSTALLED_PREIMAGE_OR_ACL_CHANGED';end if;
 if encode(extensions.digest(pg_get_functiondef('app.m9_reverse_sicar_public_prices(uuid,uuid)'::regprocedure),'sha256'),'hex')<>'8d721d66d216a29afcdccc55f614c6b82533a0adc452822a08ba6c6c81f72892'
 or not exists(select 1 from pg_proc f where f.oid='app.m9_reverse_sicar_public_prices(uuid,uuid)'::regprocedure and pg_get_userbyid(f.proowner)='postgres'and not f.prosecdef
 and not has_function_privilege('anon',f.oid,'EXECUTE')and not has_function_privilege('authenticated',f.oid,'EXECUTE')and not has_function_privilege('service_role',f.oid,'EXECUTE'))
 then raise exception 'SICAR_TWELVE_PRICE_INSTALLED_PREIMAGE_OR_ACL_CHANGED';end if;
 if encode(extensions.digest(pg_get_functiondef('app.m9_sicar_linked_price_locks()'::regprocedure),'sha256'),'hex')<>'03ca42cbf29f5c7877f6ea3b0ed44848d3943052a4177d147e9151d1bc726dae'
 or not exists(select 1 from pg_proc f where f.oid='app.m9_sicar_linked_price_locks()'::regprocedure and pg_get_userbyid(f.proowner)='postgres'and not f.prosecdef
 and not has_function_privilege('anon',f.oid,'EXECUTE')and not has_function_privilege('authenticated',f.oid,'EXECUTE')and not has_function_privilege('service_role',f.oid,'EXECUTE'))
 then raise exception 'SICAR_TWELVE_PRICE_INSTALLED_PREIMAGE_OR_ACL_CHANGED';end if;
 if encode(extensions.digest(pg_get_functiondef('app.m9_sicar_linked_price_state(uuid[])'::regprocedure),'sha256'),'hex')<>'4118db760b66ca276684233dda19cee35c186675ed55bb6a565bbbcbf432af1a'
 or not exists(select 1 from pg_proc f where f.oid='app.m9_sicar_linked_price_state(uuid[])'::regprocedure and pg_get_userbyid(f.proowner)='postgres'and not f.prosecdef
 and not has_function_privilege('anon',f.oid,'EXECUTE')and not has_function_privilege('authenticated',f.oid,'EXECUTE')and not has_function_privilege('service_role',f.oid,'EXECUTE'))
 then raise exception 'SICAR_TWELVE_PRICE_INSTALLED_PREIMAGE_OR_ACL_CHANGED';end if;
 if encode(extensions.digest(pg_get_functiondef('app.m9_sicar_price_state(uuid[])'::regprocedure),'sha256'),'hex')<>'7edf9f5b6b027278433392fe4bc27064bbc208e1fae8add34d0f84a39b1a7d9a'
 or not exists(select 1 from pg_proc f where f.oid='app.m9_sicar_price_state(uuid[])'::regprocedure and pg_get_userbyid(f.proowner)='postgres'and not f.prosecdef
 and not has_function_privilege('anon',f.oid,'EXECUTE')and not has_function_privilege('authenticated',f.oid,'EXECUTE')and not has_function_privilege('service_role',f.oid,'EXECUTE'))
 then raise exception 'SICAR_TWELVE_PRICE_INSTALLED_PREIMAGE_OR_ACL_CHANGED';end if;
 if encode(extensions.digest(pg_get_functiondef('app.m9_validate_linked_price_packet(jsonb)'::regprocedure),'sha256'),'hex')<>'55751ccc5e3392bf6c9666e7bdce4a1fe48a1289befe5bd1c703c055dadc6b2b'
 or not exists(select 1 from pg_proc f where f.oid='app.m9_validate_linked_price_packet(jsonb)'::regprocedure and pg_get_userbyid(f.proowner)='postgres'and not f.prosecdef
 and not has_function_privilege('anon',f.oid,'EXECUTE')and not has_function_privilege('authenticated',f.oid,'EXECUTE')and not has_function_privilege('service_role',f.oid,'EXECUTE'))
 then raise exception 'SICAR_TWELVE_PRICE_INSTALLED_PREIMAGE_OR_ACL_CHANGED';end if;
 execute 'create function app.m9_twelve_price_actor()returns void
language plpgsql security invoker set search_path='''' as $actor$
begin
 if current_user<>''postgres''or session_user<>''postgres''or current_setting(''role'')not in(''none'',''postgres'')then raise insufficient_privilege;end if;
 perform app.assert_sicar_staging_enabled();perform app.m9_legacy_actor();
 if not app.has_perm(''products.price_update'')then raise insufficient_privilege;end if;
end $actor$';
 execute 'revoke all on function app.m9_twelve_price_actor()from public,anon,authenticated,service_role';
 execute 'create function app.m9_validate_twelve_price_packet(p jsonb)returns void
language plpgsql security invoker set search_path='''' as $validator$
declare s jsonb;f jsonb;o jsonb;n jsonb;item jsonb;original jsonb;
begin
 perform app.m9_twelve_price_actor();
 if not app.m9_detail_shape(p,array[''protocol'',''project_id'',''request_id'',''source_before_sha256'',''source_after_sha256'',''source_rows_json'',''source_rows_sha256'',''observed_at'',''expected_state'',''changes''])
 or p->>''protocol''is distinct from''m9-sicar-public-price-provisional12-1''or p->>''project_id''is distinct from''zsezjtswqeijboezvado''
 or p->>''source_before_sha256''is distinct from''33b1d36200f8db0eecf0cd1fbdd1c76400ee291d747348a6c87881f39043cc44''
 or p->>''source_after_sha256''is distinct from''b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93''
 or jsonb_typeof(p->''source_rows_json'')is distinct from''string''or octet_length(p::text)>1000000
 or p->>''source_rows_sha256''is distinct from''a6b575333386948af0ce6fb8053b11e42125d23ed483932755f5132a28c99984''
 or encode(extensions.digest(p->>''source_rows_json'',''sha256''),''hex'')is distinct from p->>''source_rows_sha256''
 or jsonb_typeof(p->''expected_state'')is distinct from''array''or jsonb_array_length(p->''expected_state'')<>12
 or jsonb_typeof(p->''changes'')is distinct from''array''or jsonb_array_length(p->''changes'')<>12
 or jsonb_typeof(p->''request_id'')is distinct from''string''or p->>''request_id''!~''^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$''
 or jsonb_typeof(p->''observed_at'')is distinct from''string''or p->>''observed_at''!~''^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$''
 then raise exception ''SICAR_TWELVE_PRICE_EXACT_PACKET_REQUIRED'';end if;
 if to_char((p->>''observed_at'')::timestamptz at time zone''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')is distinct from p->>''observed_at''
 then raise exception ''SICAR_TWELVE_PRICE_EXACT_PACKET_REQUIRED'';end if;
 s:=(p->>''source_rows_json'')::jsonb;
 if jsonb_typeof(s)is distinct from''array''or jsonb_array_length(s)<>12
 or(select array_agg(x->>''barcode''order by x->>''barcode'')from jsonb_array_elements(p->''expected_state'')x)is distinct from array[''3416'',''3417'',''3418'',''3419'',''3420'',''3421'',''3422'',''3423'',''3424'',''3425'',''3426'',''3427'']
 or(select array_agg(x->>''barcode''order by x->>''barcode'')from jsonb_array_elements(p->''changes'')x)is distinct from array[''3416'',''3417'',''3418'',''3419'',''3420'',''3421'',''3422'',''3423'',''3424'',''3425'',''3426'',''3427'']
 then
  raise exception ''SICAR_TWELVE_PRICE_FIXED_CODES_REQUIRED'';
 end if;
 if(select count(distinct x#>>''{product,id}'')from jsonb_array_elements(p->''expected_state'')x)<>12
 or(select count(distinct x->>''variant_id'')from jsonb_array_elements(p->''expected_state'')x)<>12
 or(select encode(extensions.digest(string_agg((x->>''barcode'')||'':''||(x->>''variant_id'')||'':''||(x#>>''{product,id}''),''|''order by x->>''barcode''),''sha256''),''hex'')from jsonb_array_elements(p->''expected_state'')x)is distinct from''136ce60417d6aa4a157fc3a5820ce40350e9761732217e69c096a40bcbd26511''
 then raise exception ''SICAR_TWELVE_PRICE_FIXED_UUID_BINDINGS_REQUIRED'';end if;
 for f in select value from jsonb_array_elements(p->''expected_state'')loop
  select x->''before'',x->''after''into o,n from jsonb_array_elements(s)x where x->>''barcode''=f->>''barcode'';
  select x into item from jsonb_array_elements(p->''changes'')x where x->>''barcode''=f->>''barcode'';
  original:=f#>''{provisional,source_evidence}'';
  if not app.m9_detail_shape(item,array[''barcode'',''variant_id'',''previous_cents'',''new_cents''])or item->>''variant_id''is distinct from f->>''variant_id''
  or item->''previous_cents''is distinct from''179000''::jsonb or item->''new_cents''is distinct from''199000''::jsonb
  or f#>>''{variant,id}''is distinct from f->>''variant_id''or f#>>''{variant,product_id}''is distinct from f#>>''{product,id}''
  or f#>>''{managed,variant_id}''is distinct from f->>''variant_id''or f#>>''{managed,barcode}''is distinct from f->>''barcode''
  or f#>''{managed,source_row}''is distinct from f->''current''or f#>>''{current,barcode}''is distinct from f->>''barcode''
  or f#>''{variant,price_cents}''is distinct from''179000''::jsonb or f#>''{current,price_cents}''is distinct from''179000''::jsonb
  or f#>''{variant,cost_cents}''is distinct from''null''::jsonb or f#>''{current,cost_cents}''is distinct from''null''::jsonb
  or f#>''{variant,woocommerce_product_id}''is distinct from''null''::jsonb or f#>''{variant,woocommerce_variation_id}''is distinct from''null''::jsonb
  or f#>''{variant,is_active}''is distinct from''true''::jsonb or f#>''{product,is_active}''is distinct from''true''::jsonb
  or f#>>''{product,measure_unit_code}''is distinct from''PIECE''or f->''family_size''is distinct from''1''::jsonb or f->''code_bindings''is distinct from''1''::jsonb
  or f#>>''{managed,source_sha256}''is distinct from''3940d108da85729d074284f83e27f3ffe700d03818273c5f96bb087c73828d37''or f#>>''{provisional,source_sha256}''is distinct from''3940d108da85729d074284f83e27f3ffe700d03818273c5f96bb087c73828d37''
  or f#>>''{provisional,variant_id}''is distinct from f->>''variant_id''or f#>>''{provisional,original_product_id}''is distinct from f#>>''{product,id}''
  or f#>''{provisional,web_release}''is distinct from''false''::jsonb or f#>>''{provisional,grouping_status}''is distinct from''PROVISIONAL''
  or f#>''{provisional,grouping_event_id}''is distinct from''null''::jsonb
  or original->>''barcode''is distinct from f->>''barcode''or original->''web_release''is distinct from''false''::jsonb
  or original->>''grouping_status''is distinct from''PROVISIONAL''or original->>''original_classification''is distinct from''SICAR_ONLY''
  or original->''match_issues''is distinct from''[]''::jsonb or original->''candidate_woo_ids''is distinct from''[]''::jsonb
  or original#>>''{fields,precio1}''is distinct from''1790''or jsonb_set(original->''fields'',''{precio1}'',''"1990"'')is distinct from n
  or o is distinct from n or n->>''precio1''is distinct from''1990''or n->>''clave1 *''is distinct from f->>''barcode''
  or f#>>''{current,description}''is distinct from n->>''descripción *''or f#>>''{current,department}''is distinct from n->>''departamento''or f#>>''{current,section}''is distinct from n->>''categoria''
  or f#>>''{details,source_description}''is distinct from n->>''descripción *''or f#>>''{details,department}''is distinct from n->>''departamento''or f#>>''{details,section}''is distinct from n->>''categoria''
  or f#>''{details,wholesale_cents}''is distinct from''null''::jsonb or f#>''{details,medium_wholesale_cents}''is distinct from''null''::jsonb
  or f#>>''{independent_parent,product_id}''is distinct from f#>>''{product,id}''or f#>>''{independent_parent,family_key}''is distinct from f#>>''{current,family_key}''or f#>>''{independent_parent,section}''is distinct from n->>''categoria''
  or f->''attributes''is distinct from''[]''::jsonb or f->''attribute_values''is distinct from''[]''::jsonb or f#>''{current,attributes}''is distinct from''{}''::jsonb
  or f->''web''is distinct from''{"source":null,"draft":null,"link":null,"category":null,"family":null,"approval":null,"photos":0,"lab_jobs":0,"remote_jobs":0,"lab_enabled":null}''::jsonb
  or jsonb_typeof(f->''barcodes'')is distinct from''array''or jsonb_array_length(f->''barcodes'')<>1
  or not exists(select 1 from jsonb_array_elements(f->''barcodes'')bc where bc->>''code''=f->>''barcode''and bc->>''variant_id''=f->>''variant_id''and bc->>''source''=''SICAR''and bc->''is_primary''=''true''::jsonb)
  then raise exception ''SICAR_TWELVE_PRICE_IDENTITY_SOURCE_OR_WEB_CHANGED'';end if;
 end loop;
end $validator$';
 execute 'revoke all on function app.m9_validate_twelve_price_packet(jsonb)from public,anon,authenticated,service_role';
 definition:=pg_get_functiondef('app.m9_apply_sicar_public_prices(jsonb)'::regprocedure);
 for r in select value from jsonb_array_elements('[["declare linked boolean:=","declare twelve boolean:=coalesce(p->>''protocol''=''m9-sicar-public-price-provisional12-1'',false);linked boolean:=",1],[" if linked then perform app.m9_validate_linked_price_packet(p);end if;"," if twelve then perform app.m9_validate_twelve_price_packet(p);end if;\n if linked then perform app.m9_validate_linked_price_packet(p);end if;",1],["(not linked and p->>''protocol''is distinct from''m9-sicar-public-price-1'')","(not linked and not twelve and p->>''protocol''is distinct from''m9-sicar-public-price-1'')",1],["case when linked then 1 else 10 end","case when twelve then 12 when linked then 1 else 10 end",4],["case when linked then array[''11777'']else","case when twelve then array[''3416'',''3417'',''3418'',''3419'',''3420'',''3421'',''3422'',''3423'',''3424'',''3425'',''3426'',''3427''] when linked then array[''11777'']else",2],[" if linked then perform app.m9_sicar_linked_price_locks();else"," if linked or twelve then perform app.m9_sicar_linked_price_locks();else",1],[" if (p->>''observed_at'')::timestamptz is null"," if twelve and((p->>''observed_at'')::timestamptz>clock_timestamp()or(p->>''observed_at'')::timestamptz<clock_timestamp()-interval''15 minutes'')then raise exception ''SICAR_TWELVE_PRICE_CONTEXT_EXPIRED'';end if;\n if (p->>''observed_at'')::timestamptz is null",1],[" if not linked then\n"," if not linked and not twelve then\n",1],["case when linked then ''830000''::jsonb else ''115000''::jsonb end","case when twelve then ''199000''::jsonb when linked then ''830000''::jsonb else ''115000''::jsonb end",1]]'::jsonb)loop
  if(length(definition)-length(replace(definition,r->>0,'')))/length(r->>0)<>(r->>2)::int then raise exception 'SICAR_TWELVE_PRICE_EXTENSION_TARGET_CHANGED';end if;
  definition:=replace(definition,r->>0,r->>1);
 end loop;execute definition;
 definition:=pg_get_functiondef('app.m9_reverse_sicar_public_prices(uuid,uuid)'::regprocedure);
 for r in select value from jsonb_array_elements('[["declare linked boolean:=false;","declare twelve boolean:=false;linked boolean:=false;",1],[" linked:=coalesce(prior.packet->>''protocol''=''m9-sicar-public-price-linked-1'',false);"," twelve:=coalesce(prior.packet->>''protocol''=''m9-sicar-public-price-provisional12-1'',false);\n linked:=coalesce(prior.packet->>''protocol''=''m9-sicar-public-price-linked-1'',false);\n if twelve then perform app.m9_twelve_price_actor();end if;",1],[" if linked then perform app.m9_sicar_linked_price_locks();else"," if linked or twelve then perform app.m9_sicar_linked_price_locks();else",1],["case when linked then 1 else 10 end","case when twelve then 12 when linked then 1 else 10 end",1]]'::jsonb)loop
  if(length(definition)-length(replace(definition,r->>0,'')))/length(r->>0)<>(r->>2)::int then raise exception 'SICAR_TWELVE_PRICE_EXTENSION_TARGET_CHANGED';end if;
  definition:=replace(definition,r->>0,r->>1);
 end loop;execute definition;
 execute 'revoke all on function app.m9_apply_sicar_public_prices(jsonb)from public,anon,authenticated,service_role';
 execute 'revoke all on function app.m9_reverse_sicar_public_prices(uuid,uuid)from public,anon,authenticated,service_role';
end $install_twelve$;
