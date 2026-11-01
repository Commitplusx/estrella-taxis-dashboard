-- Public intake is opt-in per taxi company. Existing bases remain restricted.
ALTER TABLE public.taxi_bot_customer_access
 ADD COLUMN public_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.taxi_bot_customer_allowed(p_tenant uuid,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.taxi_bot_customer_phone(p_phone)IS NOT NULL AND (
  EXISTS(SELECT 1 FROM public.taxi_bot_allowed_customers WHERE tenant_id=p_tenant AND phone=public.taxi_bot_customer_phone(p_phone))
  OR EXISTS(SELECT 1 FROM public.taxi_bot_customer_access a JOIN public.empresas e ON e.id=a.tenant_id
   WHERE a.tenant_id=p_tenant AND a.public_enabled AND e.activo AND e.tipo_negocio='taxi'))
$$;

CREATE OR REPLACE FUNCTION public.taxi_bot_customer_access_read(p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=p_tenant AND tipo_negocio='taxi')THEN RAISE EXCEPTION 'taxi company required';END IF;
 RETURN jsonb_build_object(
  'restricted',NOT coalesce((SELECT public_enabled FROM public.taxi_bot_customer_access WHERE tenant_id=p_tenant),false),
  'revision',coalesce((SELECT revision FROM public.taxi_bot_customer_access WHERE tenant_id=p_tenant),0),
  'phones',(SELECT coalesce(jsonb_agg(phone ORDER BY phone),'[]')FROM(SELECT phone FROM public.taxi_bot_allowed_customers WHERE tenant_id=p_tenant ORDER BY phone LIMIT 101)x));
END $$;

CREATE FUNCTION public.taxi_bot_customer_access_configure(
 p_tenant uuid,p_actor bigint,p_request uuid,p_expected bigint,p_phones jsonb,p_restricted boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior public.taxi_bot_customer_access_operations;command jsonb;result jsonb;current_rev bigint;BEGIN
 IF p_actor IS NULL OR p_actor<=0 OR p_request IS NULL OR p_expected IS NULL OR p_expected<0 OR jsonb_typeof(p_phones)IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid customer access';END IF;
 IF jsonb_array_length(p_phones)>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_phones)v WHERE jsonb_typeof(v)<>'string'OR public.taxi_bot_customer_phone(v#>>'{}')IS NULL OR public.taxi_bot_customer_phone(v#>>'{}')<>v#>>'{}')OR(SELECT count(DISTINCT v#>>'{}')FROM jsonb_array_elements(p_phones)v)<>jsonb_array_length(p_phones)THEN RAISE EXCEPTION 'invalid customer access';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=p_tenant AND tipo_negocio='taxi')THEN RAISE EXCEPTION 'taxi company required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,24));
 command:=jsonb_build_object('tenant',p_tenant,'expected',p_expected,'phones',p_phones);
 IF p_restricted IS NOT NULL THEN command:=command||jsonb_build_object('restricted',p_restricted);END IF;
 SELECT * INTO prior FROM public.taxi_bot_customer_access_operations WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF prior.command IS DISTINCT FROM command THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN prior.response;END IF;
 INSERT INTO public.taxi_bot_customer_access(tenant_id)VALUES(p_tenant)ON CONFLICT DO NOTHING;
 SELECT revision INTO current_rev FROM public.taxi_bot_customer_access WHERE tenant_id=p_tenant FOR UPDATE;
 IF current_rev<>p_expected THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
 DELETE FROM public.taxi_bot_allowed_customers WHERE tenant_id=p_tenant AND phone NOT IN(SELECT value FROM jsonb_array_elements_text(p_phones));
 INSERT INTO public.taxi_bot_allowed_customers(tenant_id,phone,created_by)SELECT p_tenant,value,p_actor FROM jsonb_array_elements_text(p_phones)ON CONFLICT DO NOTHING;
 UPDATE public.taxi_bot_customer_access SET revision=revision+1,
  public_enabled=CASE WHEN p_restricted IS NULL THEN public_enabled ELSE NOT p_restricted END WHERE tenant_id=p_tenant;
 result:=public.taxi_bot_customer_access_read(p_tenant)||jsonb_build_object('state','saved');
 INSERT INTO public.taxi_bot_customer_access_operations(actor,request_id,tenant_id,command,response)VALUES(p_actor,p_request,p_tenant,command,result);
 RETURN result;
END $$;

-- Old panel requests edit the list without silently opening or closing intake.
-- Their original audit command shape also preserves already-recorded replays.
CREATE OR REPLACE FUNCTION public.taxi_bot_customer_access_apply(
 p_tenant uuid,p_actor bigint,p_request uuid,p_expected bigint,p_phones jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.taxi_bot_customer_access_configure(p_tenant,p_actor,p_request,p_expected,p_phones,NULL)
$$;
REVOKE ALL ON FUNCTION public.taxi_bot_customer_access_configure(uuid,bigint,uuid,bigint,jsonb,boolean)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_customer_access_configure(uuid,bigint,uuid,bigint,jsonb,boolean)TO service_role;
NOTIFY pgrst,'reload schema';
