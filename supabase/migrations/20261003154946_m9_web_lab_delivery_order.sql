begin;
-- now() can tie inside a transaction; the delivery sequence defines latest.
create or replace function app.read_web_lab(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d jsonb; j app.web_lab_jobs; enabled boolean; verified app.web_lab_jobs; can_request boolean:=false; reason text; candidate jsonb;
begin
 d:=app.read_web_draft(p_product_id,null); -- authenticated permission and staging checks
 select coalesce(e.enabled,false) into enabled from app.web_lab_enabled_products e where product_id=p_product_id;
 select * into j from app.web_lab_jobs where product_id=p_product_id order by revision desc,created_at desc,id desc limit 1;
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
