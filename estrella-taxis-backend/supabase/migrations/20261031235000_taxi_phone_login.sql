BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
CREATE INDEX taxi_contact_login_phone ON public.taxi_base_contacts(phone) WHERE traccar_user_id IS NOT NULL;
CREATE TABLE public.taxi_phone_login_limits (
 bucket timestamptz NOT NULL, key text NOT NULL, attempts integer NOT NULL CHECK(attempts>0), PRIMARY KEY(bucket,key)
);
ALTER TABLE public.taxi_phone_login_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_phone_login_limits FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.taxi_phone_login_scope(p_phone text)RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(a))->0 ELSE NULL END FROM (
  SELECT c.traccar_user_id AS "userId",c.device_id AS "deviceId",c.tenant_id AS "tenantId"
  FROM public.taxi_base_contacts c
  JOIN public.perfiles p ON p.traccar_user_id=c.traccar_user_id AND p.empresa_id=c.tenant_id AND p.rol=c.role
  JOIN public.empresas e ON e.id=c.tenant_id AND e.activo AND e.tipo_negocio='taxi'
  JOIN public.taxi_base_units u ON u.tenant_id=c.tenant_id AND u.device_id=c.device_id
  WHERE c.phone=public.taxi_bot_contact_phone(p_phone) AND c.traccar_user_id IS NOT NULL AND c.role IN('owner','owner_driver','driver')
   AND NOT EXISTS(SELECT 1 FROM public.taxi_account_operations o WHERE o.contact_id=c.id AND NOT o.activated)
  LIMIT 2
 )a
$$;
CREATE FUNCTION public.taxi_phone_login_begin(p_phone text)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t timestamptz:=clock_timestamp();k text;n integer;g integer;BEGIN
 IF p_phone IS NULL OR p_phone IS DISTINCT FROM public.taxi_bot_contact_phone(p_phone)THEN RAISE EXCEPTION 'invalid login phone';END IF;
 -- Private durable budgets: at most 8 attempts per phone and 240 total / rolling ten minutes.
 PERFORM pg_advisory_xact_lock(hashtextextended('taxi-phone-login',72));
 k:=md5(p_phone);
 SELECT coalesce(sum(attempts),0)INTO g FROM public.taxi_phone_login_limits WHERE bucket>=date_trunc('minute',t)-interval '10 minutes' AND key='global';
 SELECT coalesce(sum(attempts),0)INTO n FROM public.taxi_phone_login_limits WHERE bucket>=date_trunc('minute',t)-interval '10 minutes' AND key=k;
 IF n>=8 OR g>=240 THEN RETURN jsonb_build_object('allowed',false);END IF;
 INSERT INTO public.taxi_phone_login_limits(bucket,key,attempts)VALUES(date_trunc('minute',t),'global',1),(date_trunc('minute',t),k,1)
 ON CONFLICT(bucket,key)DO UPDATE SET attempts=taxi_phone_login_limits.attempts+1;
 DELETE FROM public.taxi_phone_login_limits WHERE (bucket,key)IN(SELECT bucket,key FROM public.taxi_phone_login_limits WHERE bucket<t-interval '1 day' ORDER BY bucket LIMIT 1000);
 RETURN jsonb_build_object('allowed',true,'account',public.taxi_phone_login_scope(p_phone));
END $$;
REVOKE ALL ON FUNCTION public.taxi_phone_login_scope(text),public.taxi_phone_login_begin(text)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_phone_login_scope(text),public.taxi_phone_login_begin(text)TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
