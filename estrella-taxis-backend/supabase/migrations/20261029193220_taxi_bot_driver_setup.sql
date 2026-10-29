BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.taxi_bot_driver_operations(
  actor bigint NOT NULL,request_id uuid NOT NULL,command jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor,request_id)
);
ALTER TABLE public.taxi_bot_driver_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_driver_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.taxi_bot_driver_record(p_driver public.conductores)RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('deviceId',p_driver.device_id,'name',p_driver.nombre,'phone','+'||regexp_replace(p_driver.telefono_whatsapp,'\D','','g'),'active',p_driver.activo,
    'version',md5(jsonb_build_array(p_driver.id,p_driver.tenant_id,p_driver.device_id,p_driver.nombre,p_driver.telefono_whatsapp,p_driver.activo)::text))
$$;
CREATE FUNCTION public.taxi_bot_driver_read(p_tenant uuid,p_waba text)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('drivers',(SELECT coalesce(jsonb_agg(public.taxi_bot_driver_record(d)ORDER BY d.nombre,d.device_id),'[]')FROM(SELECT * FROM public.conductores WHERE tenant_id=p_tenant ORDER BY nombre,device_id LIMIT 501)d),
    'activeCount',(SELECT count(*)FROM public.conductores WHERE tenant_id=p_tenant AND activo),
    'zoneCount',(SELECT count(*)FROM public.taxi_bot_h3_cells WHERE tenant_id=p_tenant AND waba=p_waba))
$$;
CREATE FUNCTION public.taxi_bot_driver_apply(p_tenant uuid,p_actor bigint,p_request uuid,p_device integer,p_name text,p_phone text,p_active boolean,p_expected text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.conductores;old public.taxi_bot_driver_operations;cmd jsonb;result jsonb;BEGIN
  IF p_actor IS NULL OR p_actor<1 OR p_request IS NULL OR p_device IS NULL OR p_device<1 OR p_active IS NULL OR length(trim(p_name))NOT BETWEEN 1 AND 120 OR p_name IS NULL OR p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{7,14}$'
    OR(p_expected IS NOT NULL AND p_expected !~ '^[a-f0-9]{32}$')OR NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=p_tenant AND tipo_negocio='taxi')THEN RAISE EXCEPTION 'invalid driver command';END IF;
  cmd:=jsonb_build_array(p_tenant,p_device,p_name,p_phone,p_active,p_expected);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,53));
  SELECT * INTO old FROM public.taxi_bot_driver_operations WHERE actor=p_actor AND request_id=p_request;
  IF FOUND THEN IF old.command IS DISTINCT FROM cmd THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN old.response;END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_device::text,54));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||public.taxi_bot_customer_phone(p_phone),55));
  SELECT * INTO d FROM public.conductores WHERE device_id=p_device FOR UPDATE;
  IF FOUND AND d.tenant_id IS DISTINCT FROM p_tenant THEN RETURN jsonb_build_object('state','device_conflict');END IF;
  IF (d.id IS NULL AND p_expected IS NOT NULL)OR(d.id IS NOT NULL AND(public.taxi_bot_driver_record(d)->>'version')IS DISTINCT FROM p_expected)THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
  IF EXISTS(SELECT 1 FROM public.conductores WHERE tenant_id=p_tenant AND device_id<>p_device AND activo AND public.taxi_bot_customer_phone('+'||regexp_replace(telefono_whatsapp,'\D','','g'))=public.taxi_bot_customer_phone(p_phone))THEN RETURN jsonb_build_object('state','phone_conflict');END IF;
  IF d.id IS NOT NULL AND(d.nombre IS DISTINCT FROM p_name OR d.telefono_whatsapp IS DISTINCT FROM p_phone OR d.activo IS DISTINCT FROM p_active)
    AND EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE tenant_id=p_tenant AND device_id=p_device AND (state='accepted'OR(state='offered'AND expires_at>clock_timestamp())))THEN RETURN jsonb_build_object('state','driver_busy');END IF;
  IF d.id IS NULL THEN INSERT INTO public.conductores(tenant_id,device_id,nombre,telefono_whatsapp,activo)VALUES(p_tenant,p_device,p_name,p_phone,p_active)RETURNING * INTO d;
  ELSE UPDATE public.conductores SET nombre=p_name,telefono_whatsapp=p_phone,activo=p_active WHERE id=d.id RETURNING * INTO d;END IF;
  result:=jsonb_build_object('state','saved','driver',public.taxi_bot_driver_record(d));
  INSERT INTO public.taxi_bot_driver_operations(actor,request_id,command,response)VALUES(p_actor,p_request,cmd,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_driver_record(public.conductores),public.taxi_bot_driver_read(uuid,text),public.taxi_bot_driver_apply(uuid,bigint,uuid,integer,text,text,boolean,text)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_bot_driver_read(uuid,text),public.taxi_bot_driver_apply(uuid,bigint,uuid,integer,text,text,boolean,text)TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
