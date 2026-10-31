-- Do not let pending input from a conversation consume a worker slot while its current turn holds the session lease.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.taxi_bot_pending()
RETURNS SETOF public.taxi_bot_events LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT e.* FROM public.taxi_bot_events e JOIN public.taxi_bot_channels c ON c.tenant_id=e.tenant_id AND c.waba=e.waba AND c.enabled
  WHERE(e.state='pending'OR(e.state='processing'AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_sessions s WHERE s.tenant_id=e.tenant_id AND s.waba=e.waba AND s.customer=e.customer AND s.lease_until>clock_timestamp())))
  AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_sessions s WHERE s.tenant_id=e.tenant_id AND s.waba=e.waba AND s.customer=e.customer AND s.lease_until>clock_timestamp())
  AND e.received_at<clock_timestamp()-interval '15 seconds'
  AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_events newer WHERE newer.tenant_id=e.tenant_id AND newer.waba=e.waba AND newer.customer=e.customer AND newer.state='pending' AND newer.received_at>=clock_timestamp()-interval '15 seconds')
  ORDER BY e.received_at LIMIT 10;
$$;

REVOKE ALL ON FUNCTION public.taxi_bot_pending() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_bot_pending() TO service_role;
COMMIT;
