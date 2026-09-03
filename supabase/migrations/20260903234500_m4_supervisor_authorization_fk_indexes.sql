begin;

create index supervisor_authorizations_supervisor_idx
  on app.supervisor_authorizations (supervisor_user_id, created_at desc);

create index supervisor_authorizations_permission_idx
  on app.supervisor_authorizations (permission_code, created_at desc);

commit;
