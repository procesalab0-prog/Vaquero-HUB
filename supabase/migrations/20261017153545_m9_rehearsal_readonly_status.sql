begin;
do $fix$
declare s text; anchor text;
begin
 s:=pg_get_functiondef('app.m9_rehearsal_status(uuid)'::regprocedure);
 if strpos(s,'where singleton for share;')=0 or strpos(s,'where variant_id=vid for share;')=0 then raise exception 'M9_STATUS_SOURCE_CHANGED'; end if;
 s:=replace(replace(s,'where singleton for share;','where singleton;'),'where variant_id=vid for share;','where variant_id=vid;');
 execute s;
 s:=pg_get_functiondef('app.guard_m9_rehearsal_sale_item()'::regprocedure);
 anchor:=E'begin\n if exists';
 if strpos(s,anchor)=0 then raise exception 'M9_TRIGGER_SOURCE_CHANGED'; end if;
 execute replace(s,anchor,E'begin\n perform 1 from app.m9_rehearsal_control where singleton for share;\n perform 1 from app.m9_rehearsal_allowlist where variant_id=new.variant_id for share;\n if exists');
end $fix$;
commit;
