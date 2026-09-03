begin;
create or replace function public.request_sale_print(p_sale_id uuid, p_document_type text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_location uuid; v_id uuid;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if p_document_type not in ('SALE_RECEIPT','GIFT_RECEIPT') then raise exception 'INVALID_DOCUMENT_TYPE' using errcode='22023'; end if;
  select location_id into v_location from public.sales where id=p_sale_id;
  if not found or not (select app.can_access_location(v_location)) then raise exception 'SALE_NOT_FOUND' using errcode='22023'; end if;
  if p_document_type='GIFT_RECEIPT' and not exists(select 1 from public.sale_items where sale_id=p_sale_id and gift_receipt) then raise exception 'GIFT_RECEIPT_NOT_AVAILABLE' using errcode='22023'; end if;
  insert into public.print_jobs(sale_id,requested_by,document_type) values(p_sale_id,v_actor,p_document_type) returning id into v_id;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,metadata)
  values(v_actor,'sale.print_requested','sales',p_sale_id::text,v_location,jsonb_build_object('print_job_id',v_id,'document_type',p_document_type));
  return v_id;
end;
$$;
revoke execute on function public.request_sale_print(uuid,text) from public,anon;
grant execute on function public.request_sale_print(uuid,text) to authenticated,service_role;
commit;
