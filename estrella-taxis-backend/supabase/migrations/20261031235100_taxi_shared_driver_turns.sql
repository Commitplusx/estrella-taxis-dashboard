BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
ALTER TABLE public.taxi_base_contacts ADD CONSTRAINT taxi_contact_tenant_identity UNIQUE(tenant_id,id);
CREATE TABLE public.taxi_unit_drivers(
 tenant_id uuid NOT NULL,device_id integer NOT NULL,contact_id uuid NOT NULL,created_by integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tenant_id,device_id,contact_id),
 FOREIGN KEY(tenant_id,device_id)REFERENCES public.taxi_base_units(tenant_id,device_id),
 FOREIGN KEY(tenant_id,contact_id)REFERENCES public.taxi_base_contacts(tenant_id,id)
);
CREATE INDEX taxi_unit_driver_person ON public.taxi_unit_drivers(contact_id);
ALTER TABLE public.taxi_unit_drivers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_unit_drivers FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.taxi_person_devices(p_contact uuid,p_primary integer)RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(device_id ORDER BY device_id),'[]') FROM(
  SELECT p_primary AS device_id WHERE p_primary IS NOT NULL
  UNION SELECT l.device_id FROM public.taxi_unit_drivers l JOIN public.taxi_base_contacts c ON c.id=l.contact_id AND c.tenant_id=l.tenant_id WHERE c.id=p_contact
 )d
$$;
CREATE FUNCTION public.taxi_owner_driver_link_allowed(p_user integer,p_contact uuid)RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE o public.taxi_base_contacts;BEGIN o:=public.taxi_owner_scope(p_user);
 RETURN EXISTS(SELECT 1 FROM public.taxi_base_contacts c JOIN public.perfiles p ON p.traccar_user_id=c.traccar_user_id AND p.empresa_id=c.tenant_id AND p.rol=c.role
 WHERE c.id=p_contact AND c.tenant_id=o.tenant_id AND c.role IN('owner','owner_driver','driver') AND c.traccar_user_id IS NOT NULL
 AND(c.device_id=o.device_id OR EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=o.tenant_id AND l.device_id=o.device_id AND l.contact_id=c.id))
 AND NOT EXISTS(SELECT 1 FROM public.taxi_account_operations a WHERE a.contact_id=c.id AND NOT a.activated));
END $$;

CREATE OR REPLACE FUNCTION public.taxi_owner_read(p_user integer)RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.taxi_base_contacts;BEGIN c:=public.taxi_owner_scope(p_user);
 RETURN jsonb_build_object('owner',public.taxi_bot_contact_record(c),'tenantId',c.tenant_id,'deviceId',c.device_id,
 'waba',(SELECT waba FROM public.taxi_bot_channels WHERE tenant_id=c.tenant_id ORDER BY enabled DESC,waba LIMIT 1),
 'drivers',(SELECT coalesce(jsonb_agg(public.taxi_bot_contact_record(d)||jsonb_build_object('receiving',EXISTS(SELECT 1 FROM public.conductores x WHERE x.tenant_id=c.tenant_id AND x.device_id=c.device_id AND x.activo AND public.taxi_bot_customer_phone(x.telefono_whatsapp)=d.phone))ORDER BY d.name,d.id),'[]')
 FROM(SELECT * FROM public.taxi_base_contacts d WHERE tenant_id=c.tenant_id AND role IN('driver','owner','owner_driver')
 AND(device_id=c.device_id OR EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=c.tenant_id AND l.device_id=c.device_id AND l.contact_id=d.id))ORDER BY name,id LIMIT 21)d),
 'authorizedDriverIds',(SELECT coalesce(jsonb_agg(contact_id ORDER BY contact_id),'[]')FROM public.taxi_unit_drivers WHERE tenant_id=c.tenant_id AND device_id=c.device_id),
 'pending',(SELECT coalesce(jsonb_agg(r),'[]')FROM(SELECT o.request_id AS "requestId",o.command->>0 AS "contactId",o.command->1 AS expected,o.command->>2 AS name,o.command->>3 AS phone,a.command->>'email'AS email,a.state='review'AS review
 FROM public.taxi_owner_operations o LEFT JOIN public.taxi_account_operations a ON a.actor=o.actor AND a.request_id=o.request_id
 JOIN public.taxi_base_contacts d ON d.id=(o.command->>0)::uuid AND d.tenant_id=c.tenant_id AND d.device_id=c.device_id
 WHERE o.actor=p_user AND o.kind='contact'AND o.device_id=c.device_id AND NOT coalesce((o.result->>'accessReady')::boolean,false) AND NOT coalesce(a.activated,false)ORDER BY o.created_at LIMIT 21)r),
 'driver',(SELECT public.taxi_bot_driver_record(d)FROM public.conductores d WHERE tenant_id=c.tenant_id AND device_id=c.device_id),
 'busy',EXISTS(SELECT 1 FROM public.viajes WHERE device_id=c.device_id AND estado='en_camino')OR EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE device_id=c.device_id AND(state='accepted'OR state='offered'AND expires_at>clock_timestamp())));
END $$;

-- Reuse an existing person by canonical phone. Ownership and passwords never change.
DO $patch$DECLARE f text;needle text;BEGIN
 SELECT pg_get_functiondef('public.taxi_owner_contact_save(integer,uuid,uuid,text,text,text)'::regprocedure)INTO f;
 needle:='PERFORM pg_advisory_xact_lock(hashtextextended(p_contact::text,58));';
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'review owner contact before shared turns';END IF;
 f:=replace(f,needle,$code$
 PERFORM pg_advisory_xact_lock(hashtextextended(owner.device_id::text,54));
 SELECT * INTO c FROM public.taxi_base_contacts WHERE tenant_id=owner.tenant_id AND phone=public.taxi_bot_contact_phone(p_phone);
 IF c.id IS NOT NULL AND c.traccar_user_id IS NOT NULL AND c.role IN('owner','owner_driver','driver')THEN
  IF p_expected IS NOT NULL AND(c.id<>p_contact OR public.taxi_bot_contact_record(c)->>'version'IS DISTINCT FROM p_expected)THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
  IF NOT EXISTS(SELECT 1 FROM public.perfiles WHERE traccar_user_id=c.traccar_user_id AND empresa_id=owner.tenant_id AND rol=c.role)
   OR EXISTS(SELECT 1 FROM public.taxi_account_operations WHERE contact_id=c.id AND NOT activated)THEN RETURN jsonb_build_object('state','driver_access_required');END IF;
  IF c.device_id IS DISTINCT FROM owner.device_id AND NOT EXISTS(SELECT 1 FROM public.taxi_unit_drivers WHERE tenant_id=owner.tenant_id AND device_id=owner.device_id AND contact_id=c.id)
   AND(SELECT count(*)FROM public.taxi_base_contacts d WHERE tenant_id=owner.tenant_id AND role IN('owner','owner_driver','driver')AND(device_id=owner.device_id OR EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=owner.tenant_id AND l.device_id=owner.device_id AND l.contact_id=d.id)))>=20 THEN RETURN jsonb_build_object('state','driver_limit');END IF;
  IF(SELECT count(*)FROM public.taxi_unit_drivers WHERE contact_id=c.id)>=20 AND NOT EXISTS(SELECT 1 FROM public.taxi_unit_drivers WHERE contact_id=c.id AND device_id=owner.device_id)THEN RETURN jsonb_build_object('state','driver_limit');END IF;
  INSERT INTO public.taxi_unit_drivers(tenant_id,device_id,contact_id,created_by)VALUES(owner.tenant_id,owner.device_id,c.id,p_user)ON CONFLICT DO NOTHING;
  r:=jsonb_build_object('state','saved','contact',public.taxi_bot_contact_record(c),'accessReady',true,'driverVersion',(SELECT public.taxi_bot_driver_record(d)->>'version'FROM public.conductores d WHERE device_id=owner.device_id));
  INSERT INTO public.taxi_owner_operations(actor,request_id,kind,tenant_id,device_id,command,result)VALUES(p_user,p_request,'contact',owner.tenant_id,owner.device_id,cmd,r);
  RETURN r;
 END IF;
 IF c.id IS NOT NULL AND c.id<>p_contact THEN RETURN jsonb_build_object('state','phone_conflict');END IF;
 IF c.id IS NULL AND EXISTS(SELECT 1 FROM public.conductores WHERE tenant_id=owner.tenant_id AND activo AND public.taxi_bot_customer_phone(telefono_whatsapp)=public.taxi_bot_contact_phone(p_phone)AND device_id<>owner.device_id)THEN RETURN jsonb_build_object('state','phone_assigned_to_other_unit');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_contact::text,58));
 $code$);
 f:=replace(f,$old$(SELECT count(*)FROM public.taxi_base_contacts WHERE tenant_id=owner.tenant_id AND device_id=owner.device_id AND role IN('driver','owner_driver'))>=20$old$,
 $new$(SELECT count(*)FROM public.taxi_base_contacts d WHERE tenant_id=owner.tenant_id AND role IN('driver','owner','owner_driver')AND(device_id=owner.device_id OR EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=owner.tenant_id AND l.device_id=owner.device_id AND l.contact_id=d.id)))>=20$new$);
 f:=replace(f,'CREATE FUNCTION','CREATE OR REPLACE FUNCTION');EXECUTE f;
 SELECT pg_get_functiondef('public.taxi_owner_shift_apply(integer,uuid,uuid,text)'::regprocedure)INTO f;
 needle:='AND device_id=owner.device_id AND role IN(''driver'',''owner_driver'')';
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'review owner shift before shared turns';END IF;
 f:=replace(f,needle,$code$AND role IN('driver','owner','owner_driver') AND(device_id=owner.device_id OR EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=owner.tenant_id AND l.device_id=owner.device_id AND l.contact_id=p_contact))$code$);
 needle:='r:=public.taxi_bot_driver_apply(owner.tenant_id,p_user,md5(p_request::text||'':shift'')::uuid,owner.device_id,c.name,c.phone,true,p_expected);';
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'review owner shift recipient';END IF;
 f:=replace(f,needle,$code$IF EXISTS(SELECT 1 FROM public.conductores x WHERE x.tenant_id=owner.tenant_id AND x.activo AND x.device_id<>owner.device_id AND public.taxi_bot_customer_phone(x.telefono_whatsapp)=c.phone)THEN RETURN jsonb_build_object('state','driver_active_elsewhere');END IF;
  $code$||needle);EXECUTE f;
END $patch$;

CREATE OR REPLACE FUNCTION public.taxi_bot_guard_contact_driver()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''AS $$
BEGIN
 IF NEW.activo AND EXISTS(SELECT 1 FROM public.taxi_base_contacts c WHERE c.tenant_id=NEW.tenant_id
 AND c.phone=public.taxi_bot_customer_phone('+'||regexp_replace(NEW.telefono_whatsapp,'\D','','g'))
 AND(c.role NOT IN('driver','owner','owner_driver')OR(c.device_id IS DISTINCT FROM NEW.device_id AND NOT EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=c.tenant_id AND l.device_id=NEW.device_id AND l.contact_id=c.id))))THEN RAISE EXCEPTION 'Confirm driving role and authorized unit before enabling offers';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.taxi_phone_login_scope(p_phone text)RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(a))->0 ELSE NULL END FROM (
 SELECT c.traccar_user_id AS "userId",c.device_id AS "deviceId",c.tenant_id AS "tenantId",public.taxi_person_devices(c.id,c.device_id)AS "deviceIds"
 FROM public.taxi_base_contacts c JOIN public.perfiles p ON p.traccar_user_id=c.traccar_user_id AND p.empresa_id=c.tenant_id AND p.rol=c.role
 JOIN public.empresas e ON e.id=c.tenant_id AND e.activo AND e.tipo_negocio='taxi' JOIN public.taxi_base_units u ON u.tenant_id=c.tenant_id AND u.device_id=c.device_id
 WHERE c.phone=public.taxi_bot_contact_phone(p_phone)AND c.traccar_user_id IS NOT NULL AND c.role IN('owner','owner_driver','driver')
 AND NOT EXISTS(SELECT 1 FROM public.taxi_account_operations o WHERE o.contact_id=c.id AND NOT o.activated)LIMIT 2)a
$$;
REVOKE ALL ON FUNCTION public.taxi_person_devices(uuid,integer),public.taxi_owner_driver_link_allowed(integer,uuid)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_person_devices(uuid,integer),public.taxi_owner_driver_link_allowed(integer,uuid)TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
