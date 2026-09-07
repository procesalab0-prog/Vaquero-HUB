begin;

alter table public.idempotency_keys
  drop constraint idempotency_keys_operation_check;
alter table public.idempotency_keys
  add constraint idempotency_keys_operation_check
  check (operation in ('CREATE_SALE', 'CREATE_EQUAL_EXCHANGE'));

commit;
