BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Traccar owns credentials and device permissions; this is the existing person's login link.
ALTER TABLE public.taxi_base_contacts ADD COLUMN traccar_user_id integer UNIQUE;
ALTER TABLE public.taxi_base_contacts ADD CONSTRAINT taxi_contact_user_positive CHECK(traccar_user_id>0);
DO $$DECLARE c record;BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.perfiles'::regclass AND contype='c' AND pg_get_constraintdef(oid)LIKE '%rol = ANY%'
 LOOP EXECUTE format('ALTER TABLE public.perfiles DROP CONSTRAINT %I',c.conname);END LOOP;
END $$;
ALTER TABLE public.perfiles ADD CONSTRAINT perfiles_taxi_roles CHECK(rol IN('superadmin','admin_empresa','operador','owner','driver','owner_driver'));
CREATE OR REPLACE FUNCTION public.taxi_bot_contact_record(p_contact public.taxi_base_contacts)RETURNS jsonb LANGUAGE sql STABLE SET search_path=''AS $$
 SELECT jsonb_build_object('id',p_contact.id,'unitNumber',p_contact.unit_number,'name',p_contact.name,'phoneInput',p_contact.phone_input,
   'phone',p_contact.phone,'role',p_contact.role,'deviceId',p_contact.device_id,'receiving',d.id IS NOT NULL,'accountUserId',p_contact.traccar_user_id,
   'version',md5(jsonb_build_array(p_contact.id,p_contact.tenant_id,p_contact.unit_number,p_contact.name,p_contact.phone_input,p_contact.role,p_contact.device_id,p_contact.traccar_user_id,
     CASE WHEN d.id IS NOT NULL THEN public.taxi_bot_driver_record(d)ELSE NULL END)::text))
 FROM(SELECT 1)s LEFT JOIN public.conductores d ON d.tenant_id=p_contact.tenant_id AND d.activo
   AND public.taxi_bot_customer_phone('+'||regexp_replace(d.telefono_whatsapp,'\D','','g'))=p_contact.phone
$$;
CREATE TABLE public.taxi_account_operations(
 actor bigint NOT NULL,request_id uuid NOT NULL,tenant_id uuid NOT NULL REFERENCES public.empresas(id),
 contact_id uuid NOT NULL REFERENCES public.taxi_base_contacts(id),command jsonb NOT NULL,
 lease uuid NOT NULL,lease_until timestamptz NOT NULL,state text NOT NULL CHECK(state IN('pending','saved','review')),
 user_id integer,result jsonb,activated boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor,request_id)
);
CREATE UNIQUE INDEX taxi_account_pending_contact ON public.taxi_account_operations(contact_id)WHERE state='pending';
CREATE UNIQUE INDEX taxi_account_pending_email ON public.taxi_account_operations((command->>'email'))WHERE state='pending';
ALTER TABLE public.taxi_account_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_account_operations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.taxi_account_begin(p_tenant uuid,p_actor bigint,p_request uuid,p_contact uuid,p_expected text,p_email text,p_user integer,p_assignment jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''AS $$
DECLARE c public.taxi_base_contacts;o public.taxi_account_operations;cmd jsonb;l uuid:=gen_random_uuid();BEGIN
 IF p_actor<=0 OR p_expected IS NULL OR p_expected!~'^[a-f0-9]{32}$' OR p_email IS NULL OR length(p_email)>254 OR p_email!~'^[^ @]+@[^ @]+\.[^ @]+$'
   OR p_email<>lower(trim(p_email)) OR(p_user IS NOT NULL AND p_user<=0)THEN RAISE EXCEPTION 'invalid account command';END IF;
 IF jsonb_typeof(p_assignment)IS DISTINCT FROM 'object' OR coalesce(p_assignment->>'role','')NOT IN('driver','owner','owner_driver','staff')
   OR jsonb_typeof(p_assignment->'receiveOffers')IS DISTINCT FROM 'boolean' OR NOT(p_assignment?'deviceId') OR NOT(p_assignment?'driverVersion')
   OR(p_assignment->'deviceId'<>'null'::jsonb AND(p_assignment->>'deviceId')!~'^[1-9][0-9]{0,9}$')THEN RAISE EXCEPTION 'invalid account assignment';END IF;
 cmd:=jsonb_build_object('tenant',p_tenant,'contact',p_contact,'expected',p_expected,'email',p_email,'userId',p_user,'assignment',p_assignment);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,59));
 SELECT * INTO o FROM public.taxi_account_operations WHERE actor=p_actor AND request_id=p_request FOR UPDATE;
 IF FOUND THEN
   IF o.command<>cmd THEN RETURN jsonb_build_object('state','request_conflict');END IF;
   IF o.state='review'THEN RETURN jsonb_build_object('state','account_review');END IF;
   IF o.state='saved'THEN RETURN jsonb_build_object('state','replay','result',o.result,'activated',o.activated);END IF;
   IF o.lease_until>clock_timestamp()THEN RETURN jsonb_build_object('state','running');END IF;
   UPDATE public.taxi_account_operations SET lease=l,lease_until=clock_timestamp()+interval '90 seconds'WHERE actor=p_actor AND request_id=p_request;
   RETURN jsonb_build_object('state','proceed','lease',l);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_contact::text,58));
 SELECT * INTO c FROM public.taxi_base_contacts WHERE id=p_contact AND tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','contact_forbidden');END IF;
 IF public.taxi_bot_contact_record(c)->>'version'IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
 IF p_assignment->>'role'<>'staff'AND p_assignment->'deviceId'='null'::jsonb THEN RETURN jsonb_build_object('state','device_required');END IF;
 IF p_assignment->'deviceId'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM public.taxi_base_units WHERE tenant_id=p_tenant AND device_id=(p_assignment->>'deviceId')::integer)THEN RETURN jsonb_build_object('state','device_forbidden');END IF;
 IF c.traccar_user_id IS NOT NULL AND c.traccar_user_id IS DISTINCT FROM p_user THEN RETURN jsonb_build_object('state','account_already_linked');END IF;
 IF p_user=p_actor OR EXISTS(SELECT 1 FROM public.perfiles WHERE traccar_user_id=p_user AND(empresa_id IS DISTINCT FROM p_tenant OR rol IN('superadmin','admin_empresa')))
   OR EXISTS(SELECT 1 FROM public.taxi_base_contacts WHERE traccar_user_id=p_user AND id<>p_contact)THEN RETURN jsonb_build_object('state','user_forbidden');END IF;
 BEGIN
   INSERT INTO public.taxi_account_operations(actor,request_id,tenant_id,contact_id,command,lease,lease_until,state)
   VALUES(p_actor,p_request,p_tenant,p_contact,cmd,l,clock_timestamp()+interval '90 seconds','pending');
 EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('state','account_pending');END;
 -- The unique email insert may have waited for a concurrent bind to commit.
 IF EXISTS(SELECT 1 FROM public.taxi_base_contacts WHERE traccar_user_id=p_user AND id<>p_contact) OR EXISTS(SELECT 1 FROM public.perfiles WHERE traccar_user_id=p_user AND(empresa_id IS DISTINCT FROM p_tenant OR rol IN('superadmin','admin_empresa')))THEN
   DELETE FROM public.taxi_account_operations WHERE actor=p_actor AND request_id=p_request;
   RETURN jsonb_build_object('state','user_forbidden');
 END IF;
 RETURN jsonb_build_object('state','proceed','lease',l);
END $$;
CREATE FUNCTION public.taxi_account_activated(p_actor bigint,p_request uuid,p_user integer)RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''AS $$
BEGIN
 UPDATE public.taxi_account_operations SET activated=true WHERE actor=p_actor AND request_id=p_request AND state='saved'AND user_id=p_user;
 RETURN FOUND;
END $$;
CREATE FUNCTION public.taxi_account_self(p_user integer)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''AS $$
 SELECT jsonb_build_object('contact',public.taxi_bot_contact_record(c)) FROM public.taxi_base_contacts c
 JOIN public.perfiles p ON p.traccar_user_id=c.traccar_user_id AND p.empresa_id=c.tenant_id
 WHERE c.traccar_user_id=p_user
$$;
CREATE FUNCTION public.taxi_account_pending(p_actor bigint,p_tenant uuid)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',request_id,'command',command)),'[]'::jsonb)
 FROM(SELECT request_id,command FROM public.taxi_account_operations WHERE actor=p_actor AND tenant_id=p_tenant AND NOT activated AND state IN('pending','saved') ORDER BY created_at LIMIT 100)o
$$;
CREATE FUNCTION public.taxi_account_finish(p_actor bigint,p_request uuid,p_lease uuid,p_user integer)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''AS $$
DECLARE o public.taxi_account_operations;c public.taxi_base_contacts;r jsonb;BEGIN
 SELECT * INTO o FROM public.taxi_account_operations WHERE actor=p_actor AND request_id=p_request FOR UPDATE;
 IF NOT FOUND OR o.lease<>p_lease OR p_user<=0 OR(p_user IS DISTINCT FROM(o.command->>'userId')::integer AND o.command->'userId'<>'null'::jsonb)THEN RETURN jsonb_build_object('state','operation_changed');END IF;
 IF o.state='saved'THEN RETURN o.result;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(o.contact_id::text,58));
 SELECT * INTO c FROM public.taxi_base_contacts WHERE id=o.contact_id FOR UPDATE;
 IF c.tenant_id<>o.tenant_id OR public.taxi_bot_contact_record(c)->>'version'IS DISTINCT FROM o.command->>'expected' THEN
   UPDATE public.taxi_account_operations SET state='review',user_id=p_user WHERE actor=p_actor AND request_id=p_request;
   RETURN jsonb_build_object('state','account_review');
 END IF;
 IF p_user=p_actor OR EXISTS(SELECT 1 FROM public.perfiles WHERE traccar_user_id=p_user AND(empresa_id IS DISTINCT FROM o.tenant_id OR rol IN('superadmin','admin_empresa')))
   OR EXISTS(SELECT 1 FROM public.taxi_base_contacts WHERE traccar_user_id=p_user AND id<>c.id)THEN
   UPDATE public.taxi_account_operations SET state='review',user_id=p_user WHERE actor=p_actor AND request_id=p_request;
   RETURN jsonb_build_object('state','account_review');
 END IF;
 r:=public.taxi_bot_contact_apply_core(o.tenant_id,p_actor,md5(p_request::text||':person')::uuid,o.command->>'expected',c.id,
   (o.command->'assignment')||jsonb_build_object('unitNumber',c.unit_number,'name',c.name,'phoneInput',c.phone_input));
 IF r->>'state'<>'saved'THEN
   IF r->>'state'<>'driver_busy'THEN
     UPDATE public.taxi_account_operations SET state='review',user_id=p_user WHERE actor=p_actor AND request_id=p_request;
     RETURN jsonb_build_object('state','account_review');
   END IF;
   RETURN r;
 END IF;
 SELECT * INTO c FROM public.taxi_base_contacts WHERE id=o.contact_id;
 INSERT INTO public.perfiles(traccar_user_id,empresa_id,rol)VALUES(p_user,o.tenant_id,CASE WHEN c.role='staff'THEN 'operador'ELSE c.role END)
 ON CONFLICT(traccar_user_id)DO UPDATE SET empresa_id=EXCLUDED.empresa_id,rol=EXCLUDED.rol;
 UPDATE public.taxi_base_contacts SET traccar_user_id=p_user WHERE id=c.id RETURNING * INTO c;
 r:=jsonb_build_object('state','saved','userId',p_user,'email',o.command->>'email','contact',public.taxi_bot_contact_record(c));
 UPDATE public.taxi_account_operations SET state='saved',user_id=p_user,result=r WHERE actor=p_actor AND request_id=p_request;
 RETURN r;
END $$;
-- Existing editor may change contact details, but account roles/GPS cannot silently diverge.
ALTER FUNCTION public.taxi_bot_contact_apply(uuid,bigint,uuid,text,uuid,jsonb)RENAME TO taxi_bot_contact_apply_core;
CREATE FUNCTION public.taxi_bot_contact_apply(p_tenant uuid,p_actor bigint,p_request uuid,p_expected text,p_contact uuid,p_payload jsonb)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''AS $$
DECLARE c public.taxi_base_contacts;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_contact::text,58));
 IF EXISTS(SELECT 1 FROM public.taxi_account_operations WHERE contact_id=p_contact AND state='pending')THEN RETURN jsonb_build_object('state','account_pending');END IF;
 SELECT * INTO c FROM public.taxi_base_contacts WHERE id=p_contact;
 IF c.traccar_user_id IS NOT NULL AND(c.role IS DISTINCT FROM p_payload->>'role'OR c.device_id IS DISTINCT FROM(p_payload->>'deviceId')::integer)THEN RETURN jsonb_build_object('state','account_assignment_locked');END IF;
 RETURN public.taxi_bot_contact_apply_core(p_tenant,p_actor,p_request,p_expected,p_contact,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.taxi_account_begin(uuid,bigint,uuid,uuid,text,text,integer,jsonb),public.taxi_account_finish(bigint,uuid,uuid,integer),public.taxi_bot_contact_apply(uuid,bigint,uuid,text,uuid,jsonb),public.taxi_bot_contact_apply_core(uuid,bigint,uuid,text,uuid,jsonb),public.taxi_account_self(integer),public.taxi_account_activated(bigint,uuid,integer)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_account_begin(uuid,bigint,uuid,uuid,text,text,integer,jsonb),public.taxi_account_finish(bigint,uuid,uuid,integer),public.taxi_bot_contact_apply(uuid,bigint,uuid,text,uuid,jsonb),public.taxi_account_self(integer),public.taxi_account_activated(bigint,uuid,integer)TO service_role;
NOTIFY pgrst,'reload schema';
REVOKE ALL ON FUNCTION public.taxi_account_pending(bigint,uuid)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_account_pending(bigint,uuid)TO service_role;
COMMIT;
