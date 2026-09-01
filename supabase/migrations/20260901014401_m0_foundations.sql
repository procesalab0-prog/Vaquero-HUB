create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;

revoke all on schema app from public;
revoke all on schema app from anon;
revoke all on schema app from authenticated;
