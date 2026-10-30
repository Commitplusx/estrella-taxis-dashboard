-- The service-only quote RPC needs its private locality reader and reference validator.
-- Preserve the tenant/channel predicates and empty search_path without granting table access.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
ALTER FUNCTION public.taxi_bot_h3_quote_with_references(uuid,text,text,text,jsonb,jsonb) SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.taxi_bot_h3_quote_with_references(uuid,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_h3_quote_with_references(uuid,text,text,text,jsonb,jsonb) TO service_role;
COMMIT;
