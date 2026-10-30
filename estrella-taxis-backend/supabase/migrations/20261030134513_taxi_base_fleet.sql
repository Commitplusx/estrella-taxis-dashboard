BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- A taxi belongs to a base even before its driver supplies a WhatsApp contact.
-- GPS/SIM phone fields are deliberately not copied into conductores.
CREATE TABLE public.taxi_base_units(
  tenant_id uuid NOT NULL REFERENCES public.empresas(id),
  device_id integer NOT NULL CHECK(device_id>0),
  name text NOT NULL CHECK(length(trim(name))BETWEEN 1 AND 120),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,device_id),UNIQUE(device_id)
);
ALTER TABLE public.taxi_base_units ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_base_units FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.taxi_base_units TO service_role;
INSERT INTO public.taxi_base_units(tenant_id,device_id,name)
SELECT tenant_id,device_id,nombre FROM public.conductores;
ALTER TABLE public.conductores ADD CONSTRAINT conductores_base_unit_fkey
  FOREIGN KEY(tenant_id,device_id)REFERENCES public.taxi_base_units(tenant_id,device_id);

CREATE FUNCTION public.taxi_bot_ensure_base_unit()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.device_id::text,54));
  IF EXISTS(SELECT 1 FROM public.taxi_base_units WHERE device_id=NEW.device_id AND tenant_id<>NEW.tenant_id)THEN
    RAISE EXCEPTION 'device belongs to another base';
  END IF;
  INSERT INTO public.taxi_base_units(tenant_id,device_id,name)VALUES(NEW.tenant_id,NEW.device_id,NEW.nombre)
    ON CONFLICT(device_id)DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_ensure_base_unit()FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER conductores_ensure_base_unit BEFORE INSERT OR UPDATE OF tenant_id,device_id ON public.conductores
  FOR EACH ROW EXECUTE FUNCTION public.taxi_bot_ensure_base_unit();

CREATE FUNCTION public.taxi_bot_link_units(p_tenant uuid,p_actor bigint,p_request uuid,p_units jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.taxi_bot_driver_operations;cmd jsonb;result jsonb;unit jsonb;BEGIN
  IF p_actor IS NULL OR p_actor<1 OR p_request IS NULL OR jsonb_typeof(p_units)IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_units)NOT BETWEEN 1 AND 500 OR octet_length(p_units::text)>100000
    OR NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=p_tenant AND tipo_negocio='taxi')THEN RAISE EXCEPTION 'invalid fleet command';END IF;
  FOR unit IN SELECT value FROM jsonb_array_elements(p_units)LOOP
    IF jsonb_typeof(unit)IS DISTINCT FROM 'object'OR jsonb_typeof(unit->'id')IS DISTINCT FROM 'number'
      OR(unit->>'id')!~'^[1-9][0-9]{0,9}$'OR(unit->>'id')::bigint>2147483647 OR jsonb_typeof(unit->'name')IS DISTINCT FROM 'string'
      OR length(trim(unit->>'name'))NOT BETWEEN 1 AND 120 OR(unit-ARRAY['id','name'])<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid fleet unit';END IF;
  END LOOP;
  IF(SELECT count(DISTINCT value->>'id')FROM jsonb_array_elements(p_units))<>jsonb_array_length(p_units)THEN RAISE EXCEPTION 'duplicate fleet unit';END IF;
  SELECT jsonb_build_array('link_units',p_tenant,jsonb_agg(value ORDER BY(value->>'id')::integer))INTO cmd FROM jsonb_array_elements(p_units);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,53));
  SELECT * INTO old FROM public.taxi_bot_driver_operations WHERE actor=p_actor AND request_id=p_request;
  IF FOUND THEN IF old.command IS DISTINCT FROM cmd THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN old.response;END IF;
  FOR unit IN SELECT value FROM jsonb_array_elements(p_units)ORDER BY(value->>'id')::integer LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(unit->>'id',54));
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.taxi_base_units b JOIN jsonb_array_elements(p_units)u ON b.device_id=(u->>'id')::integer WHERE b.tenant_id<>p_tenant)
    OR EXISTS(SELECT 1 FROM public.conductores d JOIN jsonb_array_elements(p_units)u ON d.device_id=(u->>'id')::integer WHERE d.tenant_id<>p_tenant)
  THEN RETURN jsonb_build_object('state','device_conflict');END IF;
  INSERT INTO public.taxi_base_units(tenant_id,device_id,name)
    SELECT p_tenant,(value->>'id')::integer,trim(value->>'name')FROM jsonb_array_elements(p_units)
    ON CONFLICT(device_id)DO UPDATE SET name=EXCLUDED.name;
  result:=jsonb_build_object('state','saved','linkedCount',(SELECT count(*)FROM public.taxi_base_units WHERE tenant_id=p_tenant),
    'readyCount',(SELECT count(*)FROM public.conductores WHERE tenant_id=p_tenant AND activo),
    'pendingCount',(SELECT count(*)FROM public.taxi_base_units b WHERE b.tenant_id=p_tenant AND NOT EXISTS(SELECT 1 FROM public.conductores d WHERE d.tenant_id=b.tenant_id AND d.device_id=b.device_id AND d.activo)));
  INSERT INTO public.taxi_bot_driver_operations(actor,request_id,command,response)VALUES(p_actor,p_request,cmd,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_link_units(uuid,bigint,uuid,jsonb)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_bot_link_units(uuid,bigint,uuid,jsonb)TO service_role;

-- Preserve the existing driver registration, optimistic version and busy checks.
-- A unit registered without a driver must also reject cross-base driver signup.
CREATE OR REPLACE FUNCTION public.taxi_bot_driver_apply(p_tenant uuid,p_actor bigint,p_request uuid,p_device integer,p_name text,p_phone text,p_active boolean,p_expected text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.conductores;old public.taxi_bot_driver_operations;cmd jsonb;result jsonb;BEGIN
  IF p_actor IS NULL OR p_actor<1 OR p_request IS NULL OR p_device IS NULL OR p_device<1 OR p_active IS NULL OR length(trim(p_name))NOT BETWEEN 1 AND 120 OR p_name IS NULL OR p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{7,14}$'
    OR(p_expected IS NOT NULL AND p_expected !~ '^[a-f0-9]{32}$')OR NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=p_tenant AND tipo_negocio='taxi')THEN RAISE EXCEPTION 'invalid driver command';END IF;
  cmd:=jsonb_build_array(p_tenant,p_device,p_name,p_phone,p_active,p_expected);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,53));
  SELECT * INTO old FROM public.taxi_bot_driver_operations WHERE actor=p_actor AND request_id=p_request;
  IF FOUND THEN IF old.command IS DISTINCT FROM cmd THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN old.response;END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_device::text,54));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||public.taxi_bot_customer_phone(p_phone),55));
  IF EXISTS(SELECT 1 FROM public.taxi_base_units WHERE device_id=p_device AND tenant_id<>p_tenant)THEN RETURN jsonb_build_object('state','device_conflict');END IF;
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
REVOKE ALL ON FUNCTION public.taxi_bot_driver_apply(uuid,bigint,uuid,integer,text,text,boolean,text)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_bot_driver_apply(uuid,bigint,uuid,integer,text,text,boolean,text)TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
