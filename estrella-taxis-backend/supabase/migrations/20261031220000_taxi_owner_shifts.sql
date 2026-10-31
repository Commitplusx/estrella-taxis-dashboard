BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='45s';
CREATE TABLE public.taxi_owner_operations(
 actor integer NOT NULL,request_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('contact','shift')),
 tenant_id uuid NOT NULL,device_id integer NOT NULL,command jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor,request_id)
);
ALTER TABLE public.taxi_owner_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_owner_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.taxi_owner_scope(p_user integer)RETURNS public.taxi_base_contacts
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.taxi_base_contacts;BEGIN
 SELECT t.* INTO c FROM public.taxi_base_contacts t JOIN public.perfiles p ON p.traccar_user_id=t.traccar_user_id AND p.empresa_id=t.tenant_id AND p.rol=t.role
 JOIN public.empresas e ON e.id=t.tenant_id AND e.activo AND e.tipo_negocio='taxi'
 JOIN public.taxi_base_units u ON u.tenant_id=t.tenant_id AND u.device_id=t.device_id
 WHERE t.traccar_user_id=p_user AND t.role IN('owner','owner_driver');
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_access_required';END IF;
 RETURN c;
END $$;

CREATE FUNCTION public.taxi_owner_read(p_user integer)RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.taxi_base_contacts;BEGIN c:=public.taxi_owner_scope(p_user);
 RETURN jsonb_build_object('owner',public.taxi_bot_contact_record(c),'tenantId',c.tenant_id,'deviceId',c.device_id,
 'waba',(SELECT waba FROM public.taxi_bot_channels WHERE tenant_id=c.tenant_id ORDER BY enabled DESC,waba LIMIT 1),
 'drivers',(SELECT coalesce(jsonb_agg(public.taxi_bot_contact_record(d)ORDER BY d.name,d.id),'[]') FROM(SELECT * FROM public.taxi_base_contacts WHERE tenant_id=c.tenant_id AND device_id=c.device_id AND role IN('driver','owner_driver')ORDER BY name,id LIMIT 21)d),
 'pending',(SELECT coalesce(jsonb_agg(r),'[]')FROM(SELECT o.request_id AS "requestId",o.command->>0 AS "contactId",o.command->1 AS expected,o.command->>2 AS name,o.command->>3 AS phone,a.command->>'email'AS email,a.state='review'AS review
 FROM public.taxi_owner_operations o LEFT JOIN public.taxi_account_operations a ON a.actor=o.actor AND a.request_id=o.request_id
 JOIN public.taxi_base_contacts d ON d.id=(o.command->>0)::uuid AND d.tenant_id=c.tenant_id AND d.device_id=c.device_id
 WHERE o.actor=p_user AND o.kind='contact'AND o.device_id=c.device_id AND NOT coalesce(a.activated,false)ORDER BY o.created_at LIMIT 21)r),
 'driver',(SELECT public.taxi_bot_driver_record(d)FROM public.conductores d WHERE tenant_id=c.tenant_id AND device_id=c.device_id),
 'busy',EXISTS(SELECT 1 FROM public.viajes WHERE device_id=c.device_id AND estado='en_camino')OR EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE device_id=c.device_id AND(state='accepted'OR state='offered'AND expires_at>clock_timestamp())));
END $$;

CREATE FUNCTION public.taxi_owner_contact_save(p_user integer,p_request uuid,p_contact uuid,p_expected text,p_name text,p_phone text)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE owner public.taxi_base_contacts;c public.taxi_base_contacts;o public.taxi_owner_operations;cmd jsonb;r jsonb;BEGIN
 owner:=public.taxi_owner_scope(p_user);
 PERFORM pg_advisory_xact_lock(hashtextextended(owner.id::text,58));owner:=public.taxi_owner_scope(p_user);
 IF p_request IS NULL OR p_contact IS NULL OR p_name IS NULL OR length(trim(p_name))NOT BETWEEN 1 AND 120 OR public.taxi_bot_contact_phone(p_phone)IS NULL THEN RAISE EXCEPTION 'invalid owner contact';END IF;
 cmd:=jsonb_build_array(p_contact,p_expected,trim(p_name),p_phone);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||p_request::text,71));
 SELECT * INTO o FROM public.taxi_owner_operations WHERE actor=p_user AND request_id=p_request;
 IF FOUND THEN IF o.kind<>'contact'OR o.command<>cmd OR o.device_id<>owner.device_id OR o.tenant_id<>owner.tenant_id THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN o.result;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_contact::text,58));
 PERFORM pg_advisory_xact_lock(hashtextextended(owner.device_id::text,54));
 SELECT * INTO c FROM public.taxi_base_contacts WHERE id=p_contact;
 IF c.id IS NOT NULL AND(c.tenant_id<>owner.tenant_id OR c.device_id IS DISTINCT FROM owner.device_id OR c.role<>'driver')THEN RETURN jsonb_build_object('state','contact_forbidden');END IF;
 IF c.id IS NULL AND(SELECT count(*)FROM public.taxi_base_contacts WHERE tenant_id=owner.tenant_id AND device_id=owner.device_id AND role IN('driver','owner_driver'))>=20 THEN RETURN jsonb_build_object('state','driver_limit');END IF;
 IF c.id IS NOT NULL AND c.traccar_user_id IS NULL AND EXISTS(SELECT 1 FROM public.taxi_owner_operations x LEFT JOIN public.taxi_account_operations a ON a.actor=x.actor AND a.request_id=x.request_id WHERE x.actor=p_user AND x.kind='contact'AND x.command->>0=c.id::text AND NOT coalesce(a.activated,false))THEN RETURN jsonb_build_object('state','account_pending');END IF;
 IF c.traccar_user_id IS NOT NULL AND(c.name IS DISTINCT FROM trim(p_name)OR c.phone IS DISTINCT FROM public.taxi_bot_contact_phone(p_phone))THEN RETURN jsonb_build_object('state','account_details_locked');END IF;
 r:=public.taxi_bot_contact_apply(owner.tenant_id,p_user,md5(p_request::text||':contact')::uuid,p_expected,p_contact,
 jsonb_build_object('unitNumber',coalesce(c.unit_number,owner.unit_number),'name',trim(p_name),'phoneInput',p_phone,'role','driver','deviceId',owner.device_id,
 'receiveOffers',coalesce((public.taxi_bot_contact_record(c)->>'receiving')::boolean,false),'driverVersion',(SELECT public.taxi_bot_driver_record(d)->>'version'FROM public.conductores d WHERE device_id=owner.device_id)));
 IF r->>'state'='saved'THEN
  r:=r||jsonb_build_object('driverVersion',(SELECT public.taxi_bot_driver_record(d)->>'version'FROM public.conductores d WHERE device_id=owner.device_id));
  INSERT INTO public.taxi_owner_operations(actor,request_id,kind,tenant_id,device_id,command,result)VALUES(p_user,p_request,'contact',owner.tenant_id,owner.device_id,cmd,r);
 END IF;
 RETURN r;
END $$;

CREATE FUNCTION public.taxi_owner_shift_apply(p_user integer,p_request uuid,p_contact uuid,p_expected text)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE owner public.taxi_base_contacts;c public.taxi_base_contacts;d public.conductores;o public.taxi_owner_operations;cmd jsonb;r jsonb;BEGIN
 owner:=public.taxi_owner_scope(p_user);IF p_request IS NULL THEN RAISE EXCEPTION 'invalid shift request';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner.id::text,58));owner:=public.taxi_owner_scope(p_user);
 IF p_contact IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_contact::text,58));END IF;
 cmd:=jsonb_build_array(p_contact,p_expected);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||p_request::text,71));
 SELECT * INTO o FROM public.taxi_owner_operations WHERE actor=p_user AND request_id=p_request;
 IF FOUND THEN IF o.kind<>'shift'OR o.command<>cmd OR o.device_id<>owner.device_id OR o.tenant_id<>owner.tenant_id THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN o.result;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner.device_id::text,54));
 IF EXISTS(SELECT 1 FROM public.viajes WHERE device_id=owner.device_id AND estado='en_camino')THEN RETURN jsonb_build_object('state','driver_busy');END IF;
 SELECT * INTO d FROM public.conductores WHERE device_id=owner.device_id FOR UPDATE;
 IF p_contact IS NOT NULL THEN
  SELECT * INTO c FROM public.taxi_base_contacts WHERE id=p_contact AND tenant_id=owner.tenant_id AND device_id=owner.device_id AND role IN('driver','owner_driver');
  IF NOT FOUND OR c.phone IS NULL OR c.traccar_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.perfiles WHERE traccar_user_id=c.traccar_user_id AND empresa_id=owner.tenant_id AND rol=c.role)THEN RETURN jsonb_build_object('state','driver_access_required');END IF;
  IF EXISTS(SELECT 1 FROM public.taxi_account_operations WHERE contact_id=c.id AND NOT activated)THEN RETURN jsonb_build_object('state','driver_access_required');END IF;
  r:=public.taxi_bot_driver_apply(owner.tenant_id,p_user,md5(p_request::text||':shift')::uuid,owner.device_id,c.name,c.phone,true,p_expected);
 ELSIF d.id IS NOT NULL THEN
  r:=public.taxi_bot_driver_apply(owner.tenant_id,p_user,md5(p_request::text||':shift')::uuid,owner.device_id,d.nombre,d.telefono_whatsapp,false,p_expected);
 ELSIF p_expected IS NOT NULL THEN RETURN jsonb_build_object('state','revision_conflict');
 ELSE r:=jsonb_build_object('state','saved');END IF;
 IF r->>'state'='saved'THEN INSERT INTO public.taxi_owner_operations(actor,request_id,kind,tenant_id,device_id,command,result)VALUES(p_user,p_request,'shift',owner.tenant_id,owner.device_id,cmd,r);END IF;
 RETURN r;
END $$;

-- The existing account workflow keeps provider creation, permission replacement,
-- receipts and recovery. Delegated requests cannot outlive ownership revocation.
CREATE FUNCTION public.taxi_owner_account_allowed(p_actor bigint,p_request uuid,p_contact uuid,p_assignment jsonb)RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE o public.taxi_owner_operations;c public.taxi_base_contacts;BEGIN
 SELECT * INTO o FROM public.taxi_owner_operations WHERE actor=p_actor AND request_id=p_request AND kind='contact';
 IF NOT FOUND THEN RETURN NOT EXISTS(SELECT 1 FROM public.perfiles WHERE traccar_user_id=p_actor AND rol IN('owner','owner_driver','driver'));END IF;
 BEGIN
  c:=public.taxi_owner_scope(p_actor::integer);
  PERFORM pg_advisory_xact_lock(hashtextextended(c.id::text,58));
  c:=public.taxi_owner_scope(p_actor::integer);
 EXCEPTION WHEN insufficient_privilege THEN RETURN false;END;
 RETURN o.tenant_id=c.tenant_id AND o.device_id=c.device_id AND o.command->>0=p_contact::text AND p_assignment->>'role'='driver'
 AND(p_assignment->>'deviceId')::integer=c.device_id AND p_assignment->'receiveOffers'='false'::jsonb;
END $$;
DO $patch$DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('public.taxi_account_begin(uuid,bigint,uuid,uuid,text,text,integer,jsonb)'::regprocedure)INTO definition;
 IF strpos(definition,'cmd:=jsonb_build_object(')=0 THEN RAISE EXCEPTION 'review account begin before owner migration';END IF;
 definition:=replace(definition,'cmd:=jsonb_build_object(',E'IF NOT public.taxi_owner_account_allowed(p_actor,p_request,p_contact,p_assignment)THEN RETURN jsonb_build_object(''state'',''owner_access_changed'');END IF;\n cmd:=jsonb_build_object(');EXECUTE definition;
 SELECT pg_get_functiondef('public.taxi_account_finish(bigint,uuid,uuid,integer)'::regprocedure)INTO definition;
 IF strpos(definition,'IF o.state=''saved''THEN RETURN o.result;END IF;')=0 THEN RAISE EXCEPTION 'review account finish before owner migration';END IF;
 definition:=replace(definition,'IF o.state=''saved''THEN RETURN o.result;END IF;',E'IF NOT public.taxi_owner_account_allowed(p_actor,p_request,o.contact_id,o.command->''assignment'')THEN RETURN jsonb_build_object(''state'',''owner_access_changed'');END IF;\n IF o.state=''saved''THEN RETURN o.result;END IF;');EXECUTE definition;
END $patch$;
DO $$DECLARE fn record;BEGIN FOR fn IN SELECT p.oid::regprocedure signature,p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'AND p.proname LIKE 'taxi_owner_%'LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature);
 IF fn.name IN('taxi_owner_read','taxi_owner_contact_save','taxi_owner_shift_apply','taxi_owner_account_allowed')THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature);END IF;
END LOOP;END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
