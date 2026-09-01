-- Server-side PostgREST requests use service_role. RLS bypass does not grant
-- access to custom schemas used by table triggers, so customer linking failed
-- when customers_touch_updated_at invoked app.touch_updated_at().
grant usage on schema app to service_role;
