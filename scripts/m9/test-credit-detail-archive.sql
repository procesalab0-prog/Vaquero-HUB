-- Run in a ROLLBACK transaction with pg_temp.detail_test_input(payload).
create temporary table detail_archive_results(result jsonb) on commit drop;
do $$
declare p jsonb;bad jsonb;r jsonb;r2 jsonb;k text;expected text;caught boolean;checks int:=0;i int;j int;pay_i int;pay_j int;rows_seen int:=0;keys_seen text[]:='{}';q jsonb;a jsonb;
begin
 select payload into strict p from pg_temp.detail_test_input;
 select ai-1,di-1 into pay_i,pay_j from jsonb_array_elements(p->'accounts') with ordinality aa(x,ai),jsonb_array_elements(aa.x->'documents') with ordinality dd(x,di) where jsonb_array_length(dd.x->'payments')>0 limit 1;
 foreach k in array array['extra_field','future','operational','duplicate_account','numeric_barcode','identity','negative','account_total','payment','duplicate_doc','delivery','reservation','quantity','mapping','unmapped_hold','name_review','history'] loop
  bad:=jsonb_set(p,'{source_plan_sha256}',to_jsonb(encode(extensions.digest('detail-qa/'||k,'sha256'),'hex')));
  expected:='DETAIL_SCOPE_INVALID';
  case k
   when 'extra_field' then bad:=bad||'{"import":true}';
   when 'future' then bad:=jsonb_set(bad,'{source_until}',to_jsonb(clock_timestamp()+interval '1 day'));expected:='DETAIL_DATE_INVALID';
   when 'operational' then bad:=jsonb_set(bad,'{operational_import_allowed}','true');
   when 'duplicate_account' then bad:=jsonb_set(bad,'{accounts,1}',p->'accounts'->0);expected:='DETAIL_ACCOUNT_IDENTITY_INVALID';
   when 'numeric_barcode' then bad:=jsonb_set(bad,'{accounts,0,documents,0,lines,0,barcode}','123');expected:='DETAIL_LINE_INVALID';
   when 'identity' then bad:=jsonb_set(bad,'{accounts,0,key}',to_jsonb(repeat('f',64)));expected:='DETAIL_ACCOUNT_IDENTITY_INVALID';
   when 'negative' then bad:=jsonb_set(bad,'{accounts,0,documents,0,balance_cents}','-1');expected:='DETAIL_AMOUNT_INVALID';
   when 'account_total' then bad:=jsonb_set(bad,'{accounts,0,balance_cents}',to_jsonb((p->'accounts'->0->>'balance_cents')::bigint+1));expected:='DETAIL_ACCOUNT_TOTALS_DIFFER';
   when 'payment' then bad:=jsonb_set(bad,array['accounts',pay_i::text,'documents',pay_j::text,'payments','0','amount_cents'],to_jsonb((p#>>array['accounts',pay_i::text,'documents',pay_j::text,'payments','0','amount_cents'])::bigint+1));expected:='DETAIL_ACTIVE_PAYMENTS_DIFFER';
   when 'duplicate_doc' then bad:=jsonb_set(bad,'{accounts,0,documents}',(p->'accounts'->0->'documents')||jsonb_build_array(p->'accounts'->0->'documents'->0));expected:='DETAIL_DOCUMENT_IDENTITY_INVALID';
   when 'delivery' then bad:=jsonb_set(bad,'{accounts,0,documents,0,lines,0,delivery_status}','"DELIVERED"');expected:='DETAIL_LINE_INVALID';
   when 'reservation' then bad:=jsonb_set(bad,'{accounts,0,documents,0,lines,0,reserved_qty}','0');expected:='DETAIL_LINE_INVALID';
   when 'quantity' then bad:=jsonb_set(bad,'{accounts,0,documents,0,lines,0,quantity}','"1.5"');expected:='DETAIL_LINE_INVALID';
   when 'mapping' then bad:=jsonb_set(bad,'{accounts,0,documents,0,lines,0,variant_id}','"00000000-0000-4000-8000-000000000000"');expected:='DETAIL_MAPPING_CHANGED';
   when 'unmapped_hold' then bad:=jsonb_set(jsonb_set(bad,'{accounts,0,documents,0,lines,0,variant_id}','null'),'{accounts,0,documents,0,lines,0,holds}','["DELIVERY_NOT_OBSERVED"]');expected:='DETAIL_UNMAPPED_HOLD_REQUIRED';
   when 'name_review' then bad:=jsonb_set(bad,'{accounts,0,documents,0,historical_name}','"Otro nombre"');expected:='DETAIL_NAME_REVIEW_MISSING';
   when 'history' then bad:=jsonb_set(bad,array['accounts',pay_i::text,'documents',pay_j::text,'linked_history_complete'],'false');expected:='DETAIL_UNOBSERVED_HISTORY_INVALID';
  end case;
  caught:=false;begin perform app.m9_archive_credit_details(bad);exception when others then
   if sqlerrm<>expected then raise exception 'EXPECTED %, GOT % (%)',expected,sqlerrm,k;end if;caught:=true;
  end;
  if not caught then raise exception 'DETAIL_EXPECTED_REJECTION %',k;end if;checks:=checks+1;
 end loop;
 r:=app.m9_archive_credit_details(p);r2:=app.m9_archive_credit_details(p);
 if r2->'replayed'<>'true'::jsonb or r->>'archive'<>r2->>'archive' then raise exception 'DETAIL_REPLAY_FAILED';end if;
 caught:=false;begin perform app.m9_archive_credit_details(jsonb_set(p,'{accounts,0,name}','"Cambiado"'));exception when others then if sqlerrm<>'DETAIL_REPLAY_CHANGED' then raise;end if;caught:=true;end;
 if not caught then raise exception 'DETAIL_REPLAY_MUTABLE';end if;checks:=checks+1;
 caught:=false;begin update app.m9_credit_detail_archives set receipt='{}' where source_plan_sha256=p->>'source_plan_sha256';exception when others then if sqlerrm<>'M9_LEGACY_EVENT_IMMUTABLE' then raise;end if;caught:=true;end;
 if not caught then raise exception 'DETAIL_ARCHIVE_MUTABLE';end if;checks:=checks+1;
 caught:=false;begin delete from app.m9_credit_detail_archives where source_plan_sha256=p->>'source_plan_sha256';exception when others then if sqlerrm<>'M9_LEGACY_EVENT_IMMUTABLE' then raise;end if;caught:=true;end;
 if not caught then raise exception 'DETAIL_ARCHIVE_DELETABLE';end if;checks:=checks+1;
 q:=public.m9_credit_detail_read('{}');
 if q->'ready'<>'true'::jsonb or q->'summary'->'documents'<>r->'documents' or q->'operational_import_allowed'<>'false'::jsonb then raise exception 'DETAIL_READ_INVALID';end if;
 for i in 1..(q->>'pages')::int loop
  q:=public.m9_credit_detail_read(jsonb_build_object('page',i));
  if jsonb_array_length(q->'rows')>10 then raise exception 'DETAIL_PAGE_OVERSIZED';end if;
  for a in select value from jsonb_array_elements(q->'rows') loop
   if a->>'key'=any(keys_seen) then raise exception 'DETAIL_PAGE_DUPLICATE';end if;keys_seen:=array_append(keys_seen,a->>'key');rows_seen:=rows_seen+1;
  end loop;
 end loop;
 if rows_seen<>(r->>'accounts')::int then raise exception 'DETAIL_PAGE_INCOMPLETE';end if;
 foreach k in array array['review','unmapped','paid'] loop
  q:=public.m9_credit_detail_read(jsonb_build_object('filter',k));if (q->>'total')::int<1 then raise exception 'DETAIL_FILTER_EMPTY %',k;end if;
 end loop;
 foreach bad in array array['{"import":true}'::jsonb,'{"q":null}','{"filter":null}','{"page":0}','{"filter":"operate"}'] loop
  caught:=false;begin perform public.m9_credit_detail_read(bad);exception when others then if sqlerrm<>'DETAIL_QUERY_INVALID' then raise;end if;caught:=true;end;
  if not caught then raise exception 'DETAIL_QUERY_ACCEPTED';end if;checks:=checks+1;
 end loop;
 insert into detail_archive_results values(jsonb_build_object('negative_checks',checks,'accounts_paginated',rows_seen,'receipt',r,'replay_pass',true,'immutability_pass',true));
end $$;
set local role authenticated;
do $$declare caught boolean;v jsonb;
begin
 v:=public.m9_credit_detail_read('{}');if v->'ready'<>'true'::jsonb then raise exception 'AUTH_READ_FAILED';end if;
 caught:=false;begin perform 1 from app.m9_credit_detail_archives;exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'DIRECT_TABLE_EXPOSED';end if;
 caught:=false;begin perform app.m9_archive_credit_details('{}');exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'LOADER_EXPOSED';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
 caught:=false;begin perform public.m9_credit_detail_read('{}');exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'INVALID_ACTOR_EXPOSED';end if;
end $$;
reset role;
set local role anon;
do $$declare caught boolean;
begin caught:=false;begin perform public.m9_credit_detail_read('{}');exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'ANON_EXPOSED';end if;end $$;
reset role;
select result||'{"acl_checks":4,"mode":"ARCHIVE_TRIAL_ROLLBACK"}'::jsonb as result from detail_archive_results;
