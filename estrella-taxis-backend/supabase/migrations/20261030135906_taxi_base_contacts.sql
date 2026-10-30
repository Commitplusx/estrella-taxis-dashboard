BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.taxi_bot_contact_phone(p_value text)RETURNS text LANGUAGE sql IMMUTABLE SET search_path=''AS $$
 SELECT CASE WHEN v~'^[0-9]{10}$'THEN '+52'||v
   WHEN v~'^\+52(1)?[0-9]{10}$'THEN public.taxi_bot_customer_phone(v)
   WHEN v~'^\+1[0-9]{10}$'OR v~'^\+502[0-9]{8}$'THEN v ELSE NULL END
 FROM(SELECT regexp_replace(p_value,'[ ()-]','','g')AS v)s
$$;
CREATE TABLE public.taxi_base_contacts(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES public.empresas(id),
 unit_number text NOT NULL CHECK(length(trim(unit_number))BETWEEN 1 AND 20),
 name text NOT NULL CHECK(length(trim(name))BETWEEN 1 AND 120),
 phone_input text NOT NULL CHECK(length(phone_input)<=40 AND phone_input~'^[+0-9 ()-]*$'),
 phone text GENERATED ALWAYS AS(public.taxi_bot_contact_phone(phone_input))STORED,
 role text NOT NULL DEFAULT 'pending'CHECK(role IN('pending','driver','owner','owner_driver','staff')),
 device_id integer,source_hash text CHECK(source_hash IS NULL OR source_hash~'^[a-f0-9]{64}$'),source_row integer CHECK(source_row>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,device_id)REFERENCES public.taxi_base_units(tenant_id,device_id)
);
CREATE UNIQUE INDEX taxi_base_contacts_phone ON public.taxi_base_contacts(tenant_id,phone)WHERE phone IS NOT NULL;
CREATE INDEX taxi_base_contacts_tenant ON public.taxi_base_contacts(tenant_id,unit_number,id);
CREATE INDEX taxi_base_contacts_device ON public.taxi_base_contacts(tenant_id,device_id)WHERE device_id IS NOT NULL;
ALTER TABLE public.taxi_base_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_base_contacts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.taxi_bot_contact_record(p_contact public.taxi_base_contacts)RETURNS jsonb LANGUAGE sql STABLE SET search_path=''AS $$
 SELECT jsonb_build_object('id',p_contact.id,'unitNumber',p_contact.unit_number,'name',p_contact.name,'phoneInput',p_contact.phone_input,
   'phone',p_contact.phone,'role',p_contact.role,'deviceId',p_contact.device_id,'receiving',d.id IS NOT NULL,
   'version',md5(jsonb_build_array(p_contact.id,p_contact.tenant_id,p_contact.unit_number,p_contact.name,p_contact.phone_input,p_contact.role,p_contact.device_id,
     CASE WHEN d.id IS NOT NULL THEN public.taxi_bot_driver_record(d)ELSE NULL END)::text))
 FROM(SELECT 1)s LEFT JOIN public.conductores d ON d.tenant_id=p_contact.tenant_id AND d.activo
   AND public.taxi_bot_customer_phone('+'||regexp_replace(d.telefono_whatsapp,'\D','','g'))=p_contact.phone
$$;
CREATE FUNCTION public.taxi_bot_contacts_read(p_tenant uuid,p_waba text)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''AS $$
 SELECT public.taxi_bot_driver_read(p_tenant,p_waba)||jsonb_build_object(
   'contacts',(SELECT coalesce(jsonb_agg(public.taxi_bot_contact_record(c)ORDER BY c.unit_number,c.name,c.id),'[]')FROM(SELECT * FROM public.taxi_base_contacts WHERE tenant_id=p_tenant ORDER BY unit_number,name,id LIMIT 501)c),
   'linkedUnitIds',(SELECT coalesce(jsonb_agg(device_id ORDER BY device_id),'[]')FROM public.taxi_base_units WHERE tenant_id=p_tenant))
$$;
CREATE FUNCTION public.taxi_bot_guard_contact_driver()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''AS $$
BEGIN
 IF NEW.activo AND EXISTS(SELECT 1 FROM public.taxi_base_contacts c WHERE c.tenant_id=NEW.tenant_id
   AND c.phone=public.taxi_bot_customer_phone('+'||regexp_replace(NEW.telefono_whatsapp,'\D','','g'))
   AND(c.role NOT IN('driver','owner_driver')OR c.device_id IS DISTINCT FROM NEW.device_id))THEN RAISE EXCEPTION 'Confirm driving role and unit before enabling offers';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER conductores_contact_guard BEFORE INSERT OR UPDATE OF tenant_id,device_id,telefono_whatsapp,activo ON public.conductores
 FOR EACH ROW EXECUTE FUNCTION public.taxi_bot_guard_contact_driver();
CREATE TABLE public.taxi_bot_contact_operations(actor bigint NOT NULL,request_id uuid NOT NULL,command jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor,request_id));
ALTER TABLE public.taxi_bot_contact_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_contact_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.taxi_bot_contact_apply(p_tenant uuid,p_actor bigint,p_request uuid,p_expected text,p_contact uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''AS $$
DECLARE c public.taxi_base_contacts;old public.taxi_bot_contact_operations;d public.conductores;target public.conductores;
 cmd jsonb;result jsonb;r jsonb;dev integer;receive boolean;normalized text;lock_dev integer;lock_phone text;BEGIN
 IF p_actor IS NULL OR p_actor<1 OR p_request IS NULL OR p_contact IS NULL OR jsonb_typeof(p_payload)IS DISTINCT FROM 'object'
   OR(p_payload-ARRAY['unitNumber','name','phoneInput','role','deviceId','receiveOffers','driverVersion'])<>'{}'::jsonb
   OR jsonb_typeof(p_payload->'unitNumber')IS DISTINCT FROM 'string'OR jsonb_typeof(p_payload->'name')IS DISTINCT FROM 'string'
   OR coalesce(length(trim(p_payload->>'unitNumber')),0)NOT BETWEEN 1 AND 20 OR coalesce(length(trim(p_payload->>'name')),0)NOT BETWEEN 1 AND 120
   OR jsonb_typeof(p_payload->'phoneInput')IS DISTINCT FROM 'string'OR length(p_payload->>'phoneInput')>40 OR(p_payload->>'phoneInput')!~'^[+0-9 ()-]*$'
   OR coalesce(p_payload->>'role','')NOT IN('pending','driver','owner','owner_driver','staff')OR jsonb_typeof(p_payload->'receiveOffers')IS DISTINCT FROM 'boolean'
   OR NOT(p_payload?'deviceId')OR NOT(p_payload?'driverVersion')OR octet_length(p_payload::text)>4096
   OR(p_expected IS NOT NULL AND p_expected!~'^[a-f0-9]{32}$')OR NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=p_tenant AND tipo_negocio='taxi')THEN RAISE EXCEPTION 'invalid contact command';END IF;
 IF p_payload->'deviceId'<>'null'::jsonb AND(jsonb_typeof(p_payload->'deviceId')IS DISTINCT FROM 'number'OR(p_payload->>'deviceId')!~'^[1-9][0-9]{0,9}$'OR(p_payload->>'deviceId')::bigint>2147483647)THEN RAISE EXCEPTION 'invalid contact unit';END IF;
 IF p_payload->'driverVersion'<>'null'::jsonb AND(jsonb_typeof(p_payload->'driverVersion')IS DISTINCT FROM 'string'OR(p_payload->>'driverVersion')!~'^[a-f0-9]{32}$')THEN RAISE EXCEPTION 'invalid driver version';END IF;
 dev:=(p_payload->>'deviceId')::integer;receive:=(p_payload->>'receiveOffers')::boolean;normalized:=public.taxi_bot_contact_phone(p_payload->>'phoneInput');
 IF receive AND p_payload->>'role'NOT IN('driver','owner_driver')THEN RETURN jsonb_build_object('state','role_not_driving');END IF;
 IF receive AND normalized IS NULL THEN RETURN jsonb_build_object('state','phone_invalid');END IF;
 IF receive AND dev IS NULL THEN RETURN jsonb_build_object('state','device_required');END IF;
 cmd:=jsonb_build_array(p_tenant,p_contact,p_expected,p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,57));
 SELECT * INTO old FROM public.taxi_bot_contact_operations WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF old.command IS DISTINCT FROM cmd THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN old.response;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_contact::text,58));
 SELECT * INTO c FROM public.taxi_base_contacts WHERE id=p_contact FOR UPDATE;
 IF FOUND AND c.tenant_id<>p_tenant THEN RETURN jsonb_build_object('state','contact_forbidden');END IF;
 IF(c.id IS NULL AND p_expected IS NOT NULL)OR(c.id IS NOT NULL AND public.taxi_bot_contact_record(c)->>'version'IS DISTINCT FROM p_expected)THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
 SELECT * INTO d FROM public.conductores WHERE tenant_id=p_tenant AND activo AND public.taxi_bot_customer_phone('+'||regexp_replace(telefono_whatsapp,'\D','','g'))=coalesce(c.phone,normalized);
 FOR lock_dev IN SELECT DISTINCT value FROM unnest(ARRAY[d.device_id,dev])AS a(value)WHERE value IS NOT NULL ORDER BY value LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended(lock_dev::text,54));
 END LOOP;
 FOR lock_phone IN SELECT DISTINCT value FROM unnest(ARRAY[c.phone,normalized])AS a(value)WHERE value IS NOT NULL ORDER BY value LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||lock_phone,55));
 END LOOP;
 IF c.id IS NOT NULL AND public.taxi_bot_contact_record(c)->>'version'IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
 IF c.id IS NULL THEN
   SELECT * INTO d FROM public.conductores WHERE tenant_id=p_tenant AND activo AND public.taxi_bot_customer_phone('+'||regexp_replace(telefono_whatsapp,'\D','','g'))=normalized;
   IF d.id IS NOT NULL AND(dev IS DISTINCT FROM d.device_id OR p_payload->>'driverVersion'IS DISTINCT FROM public.taxi_bot_driver_record(d)->>'version')THEN RETURN jsonb_build_object('state','driver_changed');END IF;
 ELSIF normalized IS DISTINCT FROM c.phone AND EXISTS(SELECT 1 FROM public.conductores WHERE tenant_id=p_tenant AND activo AND public.taxi_bot_customer_phone('+'||regexp_replace(telefono_whatsapp,'\D','','g'))=normalized)THEN
   RETURN jsonb_build_object('state','phone_conflict');
 END IF;
 IF dev IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.taxi_base_units WHERE tenant_id=p_tenant AND device_id=dev)THEN RETURN jsonb_build_object('state','device_forbidden');END IF;
 SELECT * INTO target FROM public.conductores WHERE device_id=dev FOR UPDATE;
 IF receive AND((target.id IS NULL AND p_payload->>'driverVersion'IS NOT NULL)OR(target.id IS NOT NULL AND public.taxi_bot_driver_record(target)->>'version'IS DISTINCT FROM p_payload->>'driverVersion'))THEN RETURN jsonb_build_object('state','driver_changed');END IF;
 BEGIN
   IF d.id IS NOT NULL AND(NOT receive OR d.device_id IS DISTINCT FROM dev OR d.nombre IS DISTINCT FROM trim(p_payload->>'name')OR public.taxi_bot_customer_phone(d.telefono_whatsapp)IS DISTINCT FROM normalized)THEN
     r:=public.taxi_bot_driver_apply(p_tenant,p_actor,md5(p_request::text||':pause')::uuid,d.device_id,d.nombre,d.telefono_whatsapp,false,public.taxi_bot_driver_record(d)->>'version');
     IF r->>'state'<>'saved'THEN RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE=r->>'state';END IF;
   END IF;
   INSERT INTO public.taxi_base_contacts(id,tenant_id,unit_number,name,phone_input,role,device_id)
     VALUES(p_contact,p_tenant,trim(p_payload->>'unitNumber'),trim(p_payload->>'name'),p_payload->>'phoneInput',p_payload->>'role',dev)
     ON CONFLICT(id)DO UPDATE SET unit_number=EXCLUDED.unit_number,name=EXCLUDED.name,phone_input=EXCLUDED.phone_input,role=EXCLUDED.role,device_id=EXCLUDED.device_id RETURNING * INTO c;
   IF receive THEN
     SELECT * INTO target FROM public.conductores WHERE device_id=dev FOR UPDATE;
     r:=public.taxi_bot_driver_apply(p_tenant,p_actor,md5(p_request::text||':apply')::uuid,dev,c.name,normalized,true,CASE WHEN target.id IS NULL THEN NULL ELSE public.taxi_bot_driver_record(target)->>'version'END);
     IF r->>'state'<>'saved'THEN RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE=r->>'state';END IF;
   END IF;
   result:=jsonb_build_object('state','saved','contact',public.taxi_bot_contact_record(c));
   INSERT INTO public.taxi_bot_contact_operations(actor,request_id,command,response)VALUES(p_actor,p_request,cmd,result);
 EXCEPTION WHEN SQLSTATE 'Z0001'THEN RETURN jsonb_build_object('state',SQLERRM);
   WHEN unique_violation THEN RETURN jsonb_build_object('state','phone_conflict');
 END;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_contact_phone(text),public.taxi_bot_contact_record(public.taxi_base_contacts),public.taxi_bot_contacts_read(uuid,text),public.taxi_bot_guard_contact_driver(),public.taxi_bot_contact_apply(uuid,bigint,uuid,text,uuid,jsonb)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_bot_contacts_read(uuid,text),public.taxi_bot_contact_apply(uuid,bigint,uuid,text,uuid,jsonb)TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
