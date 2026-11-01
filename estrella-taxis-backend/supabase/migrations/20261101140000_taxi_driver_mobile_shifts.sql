BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE public.taxi_driver_shift_operations(
 actor integer NOT NULL,request_id uuid NOT NULL,tenant_id uuid NOT NULL,
 command jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor,request_id)
);
CREATE TABLE public.taxi_mobile_positions(
 tenant_id uuid NOT NULL,device_id integer NOT NULL,contact_id uuid NOT NULL,shift_version text NOT NULL,
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy double precision NOT NULL CHECK(accuracy BETWEEN 0 AND 100),
 speed double precision NOT NULL CHECK(speed BETWEEN 0 AND 70),
 heading double precision CHECK(heading>=0 AND heading<360),
 recorded_at timestamptz NOT NULL,received_at timestamptz NOT NULL,
 stationary_since timestamptz NOT NULL,anchor_lat double precision NOT NULL,anchor_lng double precision NOT NULL,
 PRIMARY KEY(tenant_id,device_id),
 FOREIGN KEY(tenant_id,device_id) REFERENCES public.taxi_base_units(tenant_id,device_id),
 FOREIGN KEY(tenant_id,contact_id) REFERENCES public.taxi_base_contacts(tenant_id,id)
);
ALTER TABLE public.taxi_driver_shift_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxi_mobile_positions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_driver_shift_operations,public.taxi_mobile_positions FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.taxi_driver_location_epochs(tenant_id uuid NOT NULL,device_id integer NOT NULL,epoch text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-',''),PRIMARY KEY(tenant_id,device_id),FOREIGN KEY(tenant_id,device_id)REFERENCES public.taxi_base_units(tenant_id,device_id));
ALTER TABLE public.taxi_driver_location_epochs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_driver_location_epochs FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.taxi_driver_location_epochs(tenant_id,device_id)SELECT tenant_id,device_id FROM public.conductores;
CREATE FUNCTION public.taxi_rotate_driver_location_epoch()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT'OR ROW(OLD.tenant_id,OLD.device_id,OLD.nombre,OLD.telefono_whatsapp,OLD.activo)IS DISTINCT FROM ROW(NEW.tenant_id,NEW.device_id,NEW.nombre,NEW.telefono_whatsapp,NEW.activo)THEN
  INSERT INTO public.taxi_driver_location_epochs(tenant_id,device_id)VALUES(NEW.tenant_id,NEW.device_id)ON CONFLICT(tenant_id,device_id)DO UPDATE SET epoch=replace(gen_random_uuid()::text,'-','');
  DELETE FROM public.taxi_mobile_positions WHERE tenant_id=NEW.tenant_id AND device_id=NEW.device_id;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.taxi_rotate_driver_location_epoch()FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER taxi_driver_location_epoch AFTER INSERT OR UPDATE ON public.conductores FOR EACH ROW EXECUTE FUNCTION public.taxi_rotate_driver_location_epoch();

CREATE FUNCTION public.taxi_driver_scope(p_user integer)RETURNS public.taxi_base_contacts
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.taxi_base_contacts;BEGIN
 SELECT b.* INTO c FROM public.taxi_base_contacts b
 JOIN public.perfiles p ON p.traccar_user_id=b.traccar_user_id AND p.empresa_id=b.tenant_id AND p.rol=b.role
 JOIN public.empresas e ON e.id=b.tenant_id AND e.activo AND e.tipo_negocio='taxi'
 WHERE b.traccar_user_id=p_user AND b.role IN('driver','owner','owner_driver') AND b.phone IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.taxi_account_operations a WHERE a.contact_id=b.id AND NOT a.activated);
 IF NOT FOUND THEN RAISE insufficient_privilege USING MESSAGE='Personal taxi access is not active';END IF;
 RETURN c;
END $$;

CREATE FUNCTION public.taxi_driver_context(p_user integer)RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.taxi_base_contacts;BEGIN c:=public.taxi_driver_scope(p_user);
 RETURN jsonb_build_object('contact',public.taxi_bot_contact_record(c),'units',(
 SELECT coalesce(jsonb_agg(jsonb_build_object('deviceId',u.device_id,'name',coalesce(d.nombre,'Unidad '||c.unit_number),
 'active',coalesce(d.activo AND public.taxi_bot_customer_phone(d.telefono_whatsapp)=c.phone,false),
 'occupiedByOther',coalesce(d.activo AND public.taxi_bot_customer_phone(d.telefono_whatsapp)<>c.phone,false),
 'version',CASE WHEN d.id IS NULL THEN NULL ELSE public.taxi_bot_driver_record(d)->>'version' END,
 'locationVersion',CASE WHEN d.activo AND public.taxi_bot_customer_phone(d.telefono_whatsapp)=c.phone THEN ep.epoch ELSE NULL END,
 'busy',EXISTS(SELECT 1 FROM public.viajes v WHERE v.device_id=u.device_id AND v.estado='en_camino')
 OR EXISTS(SELECT 1 FROM public.taxi_bot_offers o WHERE o.device_id=u.device_id AND(o.state='accepted' OR o.state='offered' AND o.expires_at>clock_timestamp())),
 'mobileFresh',coalesce(d.activo AND m.contact_id=c.id AND m.shift_version=ep.epoch AND m.recorded_at>=clock_timestamp()-interval '2 minutes',false),
 'lastLocationAt',CASE WHEN m.contact_id=c.id THEN m.recorded_at ELSE NULL END)ORDER BY u.device_id),'[]')
 FROM public.taxi_base_units u LEFT JOIN public.conductores d ON d.tenant_id=u.tenant_id AND d.device_id=u.device_id
 LEFT JOIN public.taxi_mobile_positions m ON m.tenant_id=u.tenant_id AND m.device_id=u.device_id
 LEFT JOIN public.taxi_driver_location_epochs ep ON ep.tenant_id=u.tenant_id AND ep.device_id=u.device_id
 WHERE u.tenant_id=c.tenant_id AND(u.device_id=c.device_id OR EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=c.tenant_id AND l.contact_id=c.id AND l.device_id=u.device_id))));
END $$;

CREATE FUNCTION public.taxi_driver_shift_apply(p_user integer,p_request uuid,p_device integer,p_active boolean,p_expected text)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.taxi_base_contacts;d public.conductores;op public.taxi_driver_shift_operations;cmd jsonb;r jsonb;BEGIN
 c:=public.taxi_driver_scope(p_user);
 IF p_request IS NULL OR p_device IS NULL OR p_active IS NULL OR(p_expected IS NOT NULL AND p_expected!~'^[a-f0-9]{32}$')THEN RAISE EXCEPTION 'invalid personal shift';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.id::text,58));c:=public.taxi_driver_scope(p_user);
 IF NOT EXISTS(SELECT 1 FROM public.taxi_base_units u WHERE u.tenant_id=c.tenant_id AND u.device_id=p_device AND(u.device_id=c.device_id OR EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=c.tenant_id AND l.contact_id=c.id AND l.device_id=u.device_id)))THEN RAISE insufficient_privilege USING MESSAGE='Unit is not linked to this person';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||p_request::text,79));
 cmd:=jsonb_build_array(p_device,p_active,p_expected);
 SELECT * INTO op FROM public.taxi_driver_shift_operations WHERE actor=p_user AND request_id=p_request;
 IF FOUND THEN IF op.command<>cmd OR op.tenant_id<>c.tenant_id THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN op.result;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_device::text,54));
 SELECT * INTO d FROM public.conductores WHERE device_id=p_device FOR UPDATE;
 IF d.id IS NOT NULL AND d.tenant_id<>c.tenant_id THEN RAISE insufficient_privilege;END IF;
 IF (d.id IS NULL AND p_expected IS NOT NULL)OR(d.id IS NOT NULL AND public.taxi_bot_driver_record(d)->>'version'IS DISTINCT FROM p_expected)THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
 IF d.activo AND public.taxi_bot_customer_phone(d.telefono_whatsapp)<>c.phone THEN RETURN jsonb_build_object('state','other_driver_active');END IF;
 IF EXISTS(SELECT 1 FROM public.viajes WHERE device_id=p_device AND estado='en_camino')
 OR EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE device_id=p_device AND(state='accepted'OR state='offered'AND expires_at>clock_timestamp()))THEN RETURN jsonb_build_object('state','driver_busy');END IF;
 IF p_active=coalesce(d.activo,false)THEN r:=jsonb_build_object('state','saved');
 ELSE r:=public.taxi_bot_driver_apply(c.tenant_id,p_user,md5(p_request::text||':personal-shift')::uuid,p_device,c.name,c.phone,p_active,p_expected);END IF;
 IF r->>'state'='saved'THEN
  INSERT INTO public.taxi_driver_shift_operations(actor,request_id,tenant_id,command,result)VALUES(p_user,p_request,c.tenant_id,cmd,r);
 END IF;
 RETURN r;
END $$;

CREATE FUNCTION public.taxi_mobile_position_write(p_user integer,p_device integer,p_version text,p_lat double precision,p_lng double precision,p_accuracy double precision,p_speed double precision,p_heading double precision,p_recorded timestamptz,p_mocked boolean)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.taxi_base_contacts;d public.conductores;m public.taxi_mobile_positions;t timestamptz:=clock_timestamp();since timestamptz;alat double precision;alng double precision;meters double precision;BEGIN
 c:=public.taxi_driver_scope(p_user);
 IF p_device IS NULL OR p_version IS NULL OR p_version!~'^[a-f0-9]{32}$'OR p_lat IS NULL OR NOT(p_lat BETWEEN -90 AND 90)OR p_lng IS NULL OR NOT(p_lng BETWEEN -180 AND 180)
 OR p_accuracy IS NULL OR NOT(p_accuracy BETWEEN 0 AND 100)OR p_speed IS NULL OR NOT(p_speed BETWEEN 0 AND 70)
 OR(p_heading IS NOT NULL AND NOT(p_heading>=0 AND p_heading<360))OR p_recorded IS NULL OR p_recorded<t-interval '90 seconds'OR p_recorded>t+interval '30 seconds'OR p_mocked IS DISTINCT FROM false THEN RETURN jsonb_build_object('state','invalid_position');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_device::text,54));
 SELECT * INTO d FROM public.conductores WHERE tenant_id=c.tenant_id AND device_id=p_device AND activo AND public.taxi_bot_customer_phone(telefono_whatsapp)=c.phone FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.taxi_driver_location_epochs ep WHERE ep.tenant_id=c.tenant_id AND ep.device_id=p_device AND ep.epoch=p_version)
 OR NOT EXISTS(SELECT 1 FROM public.taxi_base_units u WHERE u.tenant_id=c.tenant_id AND u.device_id=p_device AND(u.device_id=c.device_id OR EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=c.tenant_id AND l.contact_id=c.id AND l.device_id=u.device_id)))THEN RETURN jsonb_build_object('state','shift_changed');END IF;
 SELECT * INTO m FROM public.taxi_mobile_positions WHERE tenant_id=c.tenant_id AND device_id=p_device FOR UPDATE;
 IF FOUND AND m.shift_version=p_version AND m.contact_id=c.id THEN
  IF p_recorded<=m.recorded_at THEN RETURN jsonb_build_object('state','older_position');END IF;
  IF t-m.received_at<interval '10 seconds'THEN RETURN jsonb_build_object('state','rate_limited');END IF;
  since:=m.stationary_since;alat:=m.anchor_lat;alng:=m.anchor_lng;
  meters:=6371000*2*asin(sqrt(least(1.0,power(sin(radians(p_lat-alat)/2),2)+cos(radians(alat))*cos(radians(p_lat))*power(sin(radians(p_lng-alng)/2),2))));
  IF meters>greatest(60.0,p_accuracy+m.accuracy)THEN since:=p_recorded;alat:=p_lat;alng:=p_lng;END IF;
 ELSE since:=p_recorded;alat:=p_lat;alng:=p_lng;END IF;
 INSERT INTO public.taxi_mobile_positions VALUES(c.tenant_id,p_device,c.id,p_version,p_lat,p_lng,p_accuracy,p_speed,p_heading,p_recorded,t,since,alat,alng)
 ON CONFLICT(tenant_id,device_id)DO UPDATE SET contact_id=EXCLUDED.contact_id,shift_version=EXCLUDED.shift_version,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,accuracy=EXCLUDED.accuracy,speed=EXCLUDED.speed,heading=EXCLUDED.heading,recorded_at=EXCLUDED.recorded_at,received_at=EXCLUDED.received_at,stationary_since=EXCLUDED.stationary_since,anchor_lat=EXCLUDED.anchor_lat,anchor_lng=EXCLUDED.anchor_lng;
 RETURN jsonb_build_object('state','saved','recordedAt',p_recorded);
END $$;

CREATE FUNCTION public.taxi_mobile_dispatch_positions(p_tenant uuid,p_device integer DEFAULT NULL)RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.device_id,'deviceId',m.device_id,'valid',true,'latitude',m.latitude,'longitude',m.longitude,
 'fixTime',m.recorded_at,'speed',m.speed*1.943844492,'course',m.heading,'attributes',jsonb_build_object('taxiPositionSource','mobile','occupied',false,'taxiAvailability','free','taxiStationarySinceMs',extract(epoch FROM m.stationary_since)*1000))),'[]')
 FROM(SELECT m.* FROM public.taxi_mobile_positions m JOIN public.conductores d ON d.tenant_id=m.tenant_id AND d.device_id=m.device_id AND d.activo
 JOIN public.taxi_driver_location_epochs ep ON ep.tenant_id=m.tenant_id AND ep.device_id=m.device_id AND ep.epoch=m.shift_version
 JOIN public.taxi_base_contacts c ON c.id=m.contact_id AND c.tenant_id=m.tenant_id AND c.phone=public.taxi_bot_customer_phone(d.telefono_whatsapp)
 JOIN public.perfiles p ON p.traccar_user_id=c.traccar_user_id AND p.empresa_id=c.tenant_id AND p.rol=c.role
 WHERE m.tenant_id=p_tenant AND(p_device IS NULL OR m.device_id=p_device)AND m.recorded_at>=clock_timestamp()-interval '2 minutes'
 AND(c.device_id=m.device_id OR EXISTS(SELECT 1 FROM public.taxi_unit_drivers l WHERE l.tenant_id=m.tenant_id AND l.contact_id=c.id AND l.device_id=m.device_id))
 AND NOT EXISTS(SELECT 1 FROM public.taxi_account_operations a WHERE a.contact_id=c.id AND NOT a.activated)ORDER BY m.device_id LIMIT 501)m
$$;

DO $$DECLARE f text;BEGIN
 FOREACH f IN ARRAY ARRAY['taxi_driver_scope(integer)','taxi_driver_context(integer)','taxi_driver_shift_apply(integer,uuid,integer,boolean,text)','taxi_mobile_position_write(integer,integer,text,double precision,double precision,double precision,double precision,double precision,timestamptz,boolean)','taxi_mobile_dispatch_positions(uuid,integer)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC,anon,authenticated,service_role';
 IF f NOT LIKE 'taxi_driver_scope%'THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO service_role';END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
