BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
ALTER TABLE public.taxi_bot_channels ADD COLUMN driver_web_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.viajes ADD COLUMN bot_arrived_at timestamptz;
ALTER TABLE public.viajes ADD COLUMN IF NOT EXISTS destino_lat double precision;
ALTER TABLE public.viajes ADD COLUMN IF NOT EXISTS destino_lng double precision;
CREATE TABLE public.taxi_driver_trip_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,waba text NOT NULL,
 trip_id uuid NOT NULL REFERENCES public.viajes(id),offer_id uuid NOT NULL UNIQUE REFERENCES public.taxi_bot_offers(id),
 device_id integer NOT NULL,driver_phone text NOT NULL,token_hash text NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,device_id)REFERENCES public.taxi_base_units(tenant_id,device_id)
);
CREATE TABLE public.taxi_driver_trip_actions(
 link_id uuid NOT NULL REFERENCES public.taxi_driver_trip_links(id),request_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('arrive','finish')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(link_id,request_id),UNIQUE(link_id,action)
);
ALTER TABLE public.taxi_driver_trip_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxi_driver_trip_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_driver_trip_links,public.taxi_driver_trip_actions FROM PUBLIC,anon,authenticated,service_role;

-- One canonical finalization path, used by the existing WhatsApp button and web.
CREATE FUNCTION public.taxi_bot_finish_driver_trip(p_tenant uuid,p_waba text,p_offer uuid,p_phone text)RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t public.viajes;o public.taxi_bot_offers;BEGIN
 SELECT v.* INTO t FROM public.viajes v JOIN public.taxi_bot_offers x ON x.trip_id=v.id
 WHERE x.id=p_offer AND x.tenant_id=p_tenant AND x.waba=p_waba AND v.tenant_id=p_tenant AND v.bot_waba=p_waba AND v.bot_managed FOR UPDATE OF v;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO o FROM public.taxi_bot_offers WHERE id=p_offer FOR UPDATE;
 PERFORM 1 FROM public.conductores d WHERE d.tenant_id=p_tenant AND d.device_id=o.device_id AND d.activo
 AND public.taxi_bot_customer_phone(d.telefono_whatsapp)=public.taxi_bot_customer_phone(p_phone)
 AND public.taxi_bot_customer_phone(o.driver_phone)=public.taxi_bot_customer_phone(p_phone) FOR UPDATE;
 IF NOT FOUND OR t.estado<>'en_camino' OR t.device_id<>o.device_id OR o.state<>'accepted'
 OR NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND enabled)THEN RETURN false;END IF;
 PERFORM set_config('app.taxi_bot_write','on',true);
 UPDATE public.viajes SET estado='completado',updated_at=clock_timestamp()WHERE id=t.id;
 UPDATE public.taxi_bot_offers SET state='finished'WHERE id=o.id;
 PERFORM public.taxi_bot_emit(p_tenant,p_waba,t.cliente_tel,'🚕 Viaje finalizado. ¡Gracias por viajar con nosotros! 😊','trip-finished:'||t.id);
 RETURN true;
END $$;

CREATE FUNCTION public.taxi_bot_driver_trip_issue(p_trip uuid,p_to text)RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t public.viajes;o public.taxi_bot_offers;secret text;BEGIN
 SELECT v.* INTO t FROM public.viajes v JOIN public.taxi_bot_channels c ON c.tenant_id=v.tenant_id AND c.waba=v.bot_waba
 WHERE v.id=p_trip AND v.bot_managed AND v.estado='en_camino' AND c.enabled AND c.driver_web_enabled;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO o FROM public.taxi_bot_offers WHERE trip_id=t.id AND device_id=t.device_id AND state='accepted'
 AND tenant_id=t.tenant_id AND waba=t.bot_waba AND public.taxi_bot_customer_phone(driver_phone)=public.taxi_bot_customer_phone(p_to);
 IF NOT FOUND THEN RETURN NULL;END IF;
 secret:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public.taxi_driver_trip_links(tenant_id,waba,trip_id,offer_id,device_id,driver_phone,token_hash,expires_at)
 VALUES(t.tenant_id,t.bot_waba,t.id,o.id,o.device_id,public.taxi_bot_customer_phone(p_to),encode(sha256(convert_to(secret,'UTF8')),'hex'),clock_timestamp()+interval '24 hours')
 ON CONFLICT(offer_id)DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at;
 RETURN 'https://stellar.estrella-eats.mx/driver-trip#'||secret;
END $$;

CREATE FUNCTION public.taxi_driver_trip_read(p_token text)RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l public.taxi_driver_trip_links;t public.viajes;o public.taxi_bot_offers;paused boolean;notice text;unit_name text;BEGIN
 IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$'THEN RETURN jsonb_build_object('state','not_found');END IF;
 SELECT * INTO l FROM public.taxi_driver_trip_links WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found');END IF;
 IF l.expires_at<=clock_timestamp()THEN RETURN jsonb_build_object('state','expired');END IF;
 SELECT * INTO t FROM public.viajes WHERE id=l.trip_id AND tenant_id=l.tenant_id AND bot_waba=l.waba AND bot_managed;
 SELECT * INTO o FROM public.taxi_bot_offers WHERE id=l.offer_id AND trip_id=l.trip_id AND tenant_id=l.tenant_id AND waba=l.waba AND device_id=l.device_id
 AND public.taxi_bot_customer_phone(driver_phone)=l.driver_phone;
 IF t.id IS NULL OR o.id IS NULL OR t.device_id IS DISTINCT FROM l.device_id OR o.state NOT IN('accepted','finished','revoked')THEN RETURN jsonb_build_object('state','expired');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.conductores WHERE tenant_id=l.tenant_id AND device_id=l.device_id AND activo
 AND public.taxi_bot_customer_phone(telefono_whatsapp)=l.driver_phone)THEN RETURN jsonb_build_object('state','expired');END IF;
 SELECT NOT(c.enabled AND c.driver_web_enabled AND e.activo AND e.tipo_negocio='taxi') INTO paused
 FROM public.taxi_bot_channels c JOIN public.empresas e ON e.id=c.tenant_id WHERE c.tenant_id=l.tenant_id AND c.waba=l.waba;
 SELECT name INTO unit_name FROM public.taxi_base_units WHERE tenant_id=l.tenant_id AND device_id=l.device_id;
 SELECT state INTO notice FROM public.taxi_bot_outbox WHERE dedupe_key='trip-arrived:'||t.id;
 RETURN jsonb_build_object('state','ready','tenantId',l.tenant_id,'trip',jsonb_build_object('id',t.id,'status',t.estado,'passenger',left(coalesce(nullif(t.cliente_nombre,''),'Pasajero'),120),'unit',left(unit_name,120),
 'origin',jsonb_build_object('text',t.origen,'lat',t.origen_lat,'lng',t.origen_lng),
 'destination',jsonb_build_object('text',t.destino,'lat',t.destino_lat,'lng',t.destino_lng),
 'arrivedAt',t.bot_arrived_at,'paused',coalesce(paused,true),'canArrive',NOT coalesce(paused,true)AND t.estado='en_camino'AND o.state='accepted'AND t.bot_arrived_at IS NULL,
 'canFinish',NOT coalesce(paused,true)AND t.estado='en_camino'AND o.state='accepted','arrivalNotice',notice));
END $$;

CREATE FUNCTION public.taxi_driver_trip_apply(p_token text,p_request uuid,p_action text)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l public.taxi_driver_trip_links;t public.viajes;o public.taxi_bot_offers;prior text;r jsonb;BEGIN
 IF p_request IS NULL OR p_action IS NULL OR p_action NOT IN('arrive','finish')THEN RETURN jsonb_build_object('state','invalid_action');END IF;
 r:=public.taxi_driver_trip_read(p_token);IF r->>'state'<>'ready'THEN RETURN r;END IF;
 SELECT * INTO l FROM public.taxi_driver_trip_links WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 SELECT * INTO t FROM public.viajes WHERE id=l.trip_id FOR UPDATE;
 SELECT * INTO o FROM public.taxi_bot_offers WHERE id=l.offer_id FOR UPDATE;
 PERFORM 1 FROM public.conductores WHERE tenant_id=l.tenant_id AND device_id=l.device_id FOR UPDATE;
 -- Recheck authorization after taking the same trip → offer → driver locks as WhatsApp.
 r:=public.taxi_driver_trip_read(p_token);IF r->>'state'<>'ready'THEN RETURN r;END IF;
 IF (r#>>'{trip,paused}')::boolean THEN RETURN jsonb_build_object('state','paused');END IF;
 SELECT action INTO prior FROM public.taxi_driver_trip_actions WHERE link_id=l.id AND request_id=p_request;
 IF FOUND AND prior<>p_action THEN RETURN jsonb_build_object('state','request_conflict');END IF;
 IF FOUND OR EXISTS(SELECT 1 FROM public.taxi_driver_trip_actions WHERE link_id=l.id AND action=p_action)THEN RETURN r;END IF;
 IF t.estado<>'en_camino'OR o.state<>'accepted'THEN RETURN r;END IF;
 PERFORM set_config('app.taxi_bot_write','on',true);
 IF p_action='arrive'THEN
  IF t.bot_arrived_at IS NULL THEN
   UPDATE public.viajes SET bot_arrived_at=clock_timestamp(),updated_at=clock_timestamp()WHERE id=t.id;
   PERFORM public.taxi_bot_emit(l.tenant_id,l.waba,t.cliente_tel,'🚕 Tu taxi ya llegó al punto donde pasamos por ti. Ya puedes salir, '||coalesce(nullif(left(t.cliente_nombre,80),''),'por favor')||'. 😊','trip-arrived:'||t.id);
  END IF;
 ELSE
  IF NOT public.taxi_bot_finish_driver_trip(l.tenant_id,l.waba,l.offer_id,l.driver_phone)THEN RETURN jsonb_build_object('state','trip_changed');END IF;
 END IF;
 INSERT INTO public.taxi_driver_trip_actions(link_id,request_id,action)VALUES(l.id,p_request,p_action)ON CONFLICT DO NOTHING;
 RETURN public.taxi_driver_trip_read(p_token);
END $$;

DO $patch$DECLARE f text;needle text;replacement text;BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_commit(uuid,uuid,bigint,jsonb)'::regprocedure)INTO f;
 needle:='origen_lat,origen_lng,estado,conductores_contactados';IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review booking destination coordinates';END IF;
 f:=replace(f,needle,'origen_lat,origen_lng,destino_lat,destino_lng,estado,conductores_contactados');
 needle:=$coords$(s.draft#>>'{origin,lng}')::double precision,'buscando_conductor'$coords$;
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review booking coordinate values';END IF;
 f:=replace(f,needle,$coords$(s.draft#>>'{origin,lng}')::double precision,(s.draft#>>'{destination,lat}')::double precision,(s.draft#>>'{destination,lng}')::double precision,'buscando_conductor'$coords$);
 needle:=$old$        UPDATE public.viajes SET estado='completado',updated_at=clock_timestamp()WHERE id=t.id;
        UPDATE public.taxi_bot_offers SET state='finished'WHERE id=o.id;reply:='Viaje marcado como finalizado.';
        PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,t.cliente_tel,'🚕 Viaje finalizado. ¡Gracias por viajar con nosotros! 😊','trip-finished:'||t.id);$old$;
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review current driver finalization before extracting shared transition';END IF;
 replacement:=$new$        IF public.taxi_bot_finish_driver_trip(e.tenant_id,e.waba,o.id,e.customer)THEN reply:='Viaje marcado como finalizado.';
        ELSE reply:='Este viaje ya no está disponible para tu unidad.';END IF;$new$;
 EXECUTE replace(f,needle,replacement);

 SELECT pg_get_functiondef('public.taxi_bot_emit(uuid,text,text,text,text,jsonb)'::regprocedure)INTO f;
 needle:='tracking_trip_id uuid;BEGIN';IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review driver receipt declaration';END IF;
 f:=replace(f,needle,'tracking_trip_id uuid;driver_url text;BEGIN');
 needle:=' customer_output:=';IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review driver receipt output boundary';END IF;
 replacement:=$cta$ IF p_key~'^driver-assigned:[0-9a-f-]{36}$'THEN
  driver_url:=public.taxi_bot_driver_trip_issue(substring(p_key FROM 17)::uuid,p_to);
  IF driver_url IS NOT NULL THEN
   SELECT * INTO tracking_trip FROM public.viajes WHERE id=substring(p_key FROM 17)::uuid AND tenant_id=p_tenant AND bot_waba=p_waba;
   IF tracking_trip.id IS NOT NULL THEN
    body_text:='🚕 Viaje asignado a tu unidad.'||E'\n👤 Pasajero: '||left(coalesce(tracking_trip.cliente_nombre,'Pasajero'),100)
     ||E'\n🏁 Destino: '||left(tracking_trip.destino,220)||E'\n\nToca Ver mi viaje para ver el punto de recogida y avisar cuando llegues.';
    p_buttons:=NULL;meta:=jsonb_build_object('urlButton',jsonb_build_object('title','Ver mi viaje','url',driver_url));
   END IF;
  END IF;
 END IF;
 customer_output:=$cta$;
 f:=replace(f,needle,replacement);
 f:=replace(f,'customer_output:=p_key LIKE ''reply:%''','customer_output:=p_key LIKE ''trip-arrived:%'' OR p_key LIKE ''reply:%''');
 needle:='IF p_key LIKE ''cancel-customer:%'' THEN category:=''change'';END IF;';
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review arrival message budget category';END IF;
 f:=replace(f,needle,'IF p_key LIKE ''cancel-customer:%'' OR p_key LIKE ''trip-arrived:%'' THEN category:=''change'';END IF;');
 EXECUTE f;

 SELECT pg_get_functiondef('public.taxi_bot_outbox_permitted(uuid,uuid)'::regprocedure)INTO f;
 needle:=' AND public.taxi_bot_recipient_allowed';IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review arrival send guard';END IF;
 replacement:=$guard$ AND(coalesce(b.body->>'controlDedupe',b.dedupe_key)NOT LIKE 'trip-arrived:%'OR EXISTS(
  SELECT 1 FROM public.viajes v WHERE coalesce(b.body->>'controlDedupe',b.dedupe_key)='trip-arrived:'||v.id
  AND v.tenant_id=b.tenant_id AND v.bot_waba=b.waba AND v.cliente_tel=b.destination AND v.estado='en_camino'AND v.bot_arrived_at IS NOT NULL))
 AND public.taxi_bot_recipient_allowed$guard$;
 EXECUTE replace(f,needle,replacement);
END $patch$;

REVOKE ALL ON FUNCTION public.taxi_bot_finish_driver_trip(uuid,text,uuid,text),public.taxi_bot_driver_trip_issue(uuid,text),public.taxi_driver_trip_read(text),public.taxi_driver_trip_apply(text,uuid,text)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_driver_trip_read(text),public.taxi_driver_trip_apply(text,uuid,text)TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
