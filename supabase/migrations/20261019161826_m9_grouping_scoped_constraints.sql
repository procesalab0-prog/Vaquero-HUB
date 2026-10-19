begin;
-- Grouping must not alter the caller's deferred monetary constraints. Insert
-- the referenced audit event before its member FKs instead of toggling ALL.
-- Existing events, sale snapshots and ledgers are not rewritten.
do $patch$
declare s text; anchor text;
begin
 s:=pg_get_functiondef('app.m9_group_provisionals(uuid,text,jsonb,text,text,text,text)'::regprocedure);
 if strpos(s,'set constraints all deferred;')=0 or strpos(s,'set constraints all immediate;')=0 then
  raise exception 'M9_GROUP_CONSTRAINT_SOURCE_CHANGED';end if;
 s:=replace(replace(s,'set constraints all deferred;',''),'set constraints all immediate;','');
 anchor:=$s$ for m in select value from jsonb_array_elements(p_members) order by value->>'variant_id' loop$s$;
 if strpos(s,anchor)=0 then raise exception 'M9_GROUP_EVENT_INSERT_ANCHOR_CHANGED';end if;
 s:=replace(s,anchor,$s$ receipt:=jsonb_build_object('event_id',p_request,'product_id',pid,'variants',jsonb_array_length(p_members),'variant_ids_preserved',true,'inventory_operations',0);
 insert into app.m9_grouping_events(id,request_hash,reviewer,reason,evidence_sha256,before_state,after_state,receipt)
 values(p_request,reqhash,p_reviewer,p_reason,p_evidence_sha,plan->'states','[]'::jsonb,receipt);
$s$||anchor);
 anchor:=$s$insert into app.m9_grouping_events(id,request_hash,reviewer,reason,evidence_sha256,before_state,after_state,receipt) values(p_request,reqhash,p_reviewer,p_reason,p_evidence_sha,plan->'states',after_rows,receipt);$s$;
 if strpos(s,anchor)=0 then raise exception 'M9_GROUP_EVENT_UPDATE_ANCHOR_CHANGED';end if;
 s:=replace(s,anchor,'update app.m9_grouping_events set after_state=after_rows where id=p_request;');
 s:=replace(s,'-- Insert event before forcing the deferred FK to be checked.','-- Complete the event atomically; all member references already exist.');
 execute s;
 s:=pg_get_functiondef('app.m9_undo_provisional_group(uuid,text,text)'::regprocedure);
 if strpos(s,'set constraints all immediate;')=0 then raise exception 'M9_UNGROUP_CONSTRAINT_SOURCE_CHANGED';end if;
 execute replace(s,'set constraints all immediate;','');
end $patch$;
commit;
