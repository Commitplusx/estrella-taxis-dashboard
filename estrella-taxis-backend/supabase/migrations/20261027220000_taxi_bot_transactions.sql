-- Local candidate. Configure a reviewed channel before enabling this protocol.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.taxi_bot_channels(
  tenant_id uuid NOT NULL REFERENCES public.empresas(id),waba text PRIMARY KEY CHECK(waba ~ '^\+[1-9][0-9]{7,14}$'),
  enabled boolean NOT NULL DEFAULT false,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),city text NOT NULL,
  center_lat double precision NOT NULL CHECK(center_lat BETWEEN -90 AND 90),center_lng double precision NOT NULL CHECK(center_lng BETWEEN -180 AND 180),
  radius_km numeric NOT NULL CHECK(radius_km>0 AND radius_km<=100),dispatcher text CHECK(dispatcher IS NULL OR dispatcher ~ '^\+[1-9][0-9]{7,14}$'),
  model text NOT NULL DEFAULT 'deepseek-chat',base_cents integer CHECK(base_cents BETWEEN 0 AND 1000000),per_km_cents integer CHECK(per_km_cents BETWEEN 0 AND 1000000),
  blocked_phones text[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,waba),CHECK(NOT enabled OR dispatcher IS NOT NULL)
);
ALTER TABLE public.viajes ADD COLUMN IF NOT EXISTS bot_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_waba text,ADD COLUMN IF NOT EXISTS bot_request_id uuid,
  ADD COLUMN IF NOT EXISTS bot_quote_cents integer,ADD COLUMN IF NOT EXISTS bot_quote_h3 jsonb,ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX viajes_taxi_bot_request ON public.viajes(bot_request_id) WHERE bot_request_id IS NOT NULL;
CREATE UNIQUE INDEX viajes_taxi_bot_active_customer ON public.viajes(tenant_id,bot_waba,cliente_tel)
  WHERE bot_managed AND estado IN('buscando_conductor','en_camino');
CREATE INDEX viajes_taxi_bot_device_active ON public.viajes(device_id) WHERE estado='en_camino';
-- Existing permissive policies cannot expose or mutate protocol-owned trips.
CREATE FUNCTION public.taxi_bot_owns_tenant(p_tenant uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND enabled);
$$;
CREATE POLICY taxi_bot_private ON public.viajes AS RESTRICTIVE FOR ALL TO anon,authenticated
  USING(NOT bot_managed AND NOT public.taxi_bot_owns_tenant(tenant_id))WITH CHECK(NOT bot_managed AND NOT public.taxi_bot_owns_tenant(tenant_id));
CREATE TABLE public.taxi_bot_sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,waba text NOT NULL,customer text NOT NULL,
  revision bigint NOT NULL DEFAULT 0,mode text NOT NULL DEFAULT 'bot' CHECK(mode IN('bot','human')),
  draft jsonb NOT NULL DEFAULT '{"name":null,"origin":null,"destination":null,"quoteCents":null,"confirmation":null,"expiresAt":null,"awaitingLocation":null,"pendingLocation":null,"quoteH3":null}',
  history jsonb NOT NULL DEFAULT '[]',lease uuid,lease_until timestamptz,last_source_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,waba,customer),
  FOREIGN KEY(tenant_id,waba) REFERENCES public.taxi_bot_channels(tenant_id,waba),CHECK(customer ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE TABLE public.taxi_bot_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,waba text NOT NULL,customer text NOT NULL,source_id text NOT NULL,
  message jsonb NOT NULL CHECK(jsonb_typeof(message)='object' AND octet_length(message::text)<=16384),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),source_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','completed','human')),attempts integer NOT NULL DEFAULT 0,
  lease uuid,queue_id uuid,completed_at timestamptz,reason text,
  UNIQUE(tenant_id,waba,source_id),FOREIGN KEY(tenant_id,waba) REFERENCES public.taxi_bot_channels(tenant_id,waba)
);
CREATE INDEX taxi_bot_events_pending ON public.taxi_bot_events(state,received_at);
CREATE INDEX taxi_bot_events_customer ON public.taxi_bot_events(tenant_id,waba,customer,received_at);
CREATE INDEX taxi_bot_events_tenant_recent ON public.taxi_bot_events(tenant_id,received_at DESC);
CREATE INDEX taxi_bot_events_recent ON public.taxi_bot_events(received_at DESC);
CREATE INDEX taxi_bot_sessions_active ON public.taxi_bot_sessions(tenant_id,lease_until)WHERE lease_until IS NOT NULL;
CREATE TABLE public.taxi_bot_offers(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,waba text NOT NULL,trip_id uuid NOT NULL REFERENCES public.viajes(id),
  device_id integer NOT NULL,driver_phone text NOT NULL,driver_name text NOT NULL,
  state text NOT NULL DEFAULT 'offered' CHECK(state IN('offered','accepted','rejected','revoked','expired','finished')),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '90 seconds'),UNIQUE(trip_id,device_id)
);
CREATE TABLE public.taxi_bot_outbox(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,tenant_id uuid NOT NULL,waba text NOT NULL,destination text NOT NULL,
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=16384),dedupe_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','accepted','delivered','read','failed','uncertain')),
  lease uuid,lease_until timestamptz,provider_id text,error_code text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX taxi_bot_outbox_pending ON public.taxi_bot_outbox(state,sequence);
CREATE INDEX taxi_bot_outbox_channel_pending ON public.taxi_bot_outbox(tenant_id,waba,destination,sequence)WHERE state IN('pending','sending');
CREATE INDEX taxi_bot_offers_expiry ON public.taxi_bot_offers(expires_at)WHERE state='offered';
CREATE INDEX viajes_taxi_bot_timeout ON public.viajes(created_at)WHERE bot_managed AND estado='buscando_conductor';
DO $$ DECLARE t text;BEGIN
  FOREACH t IN ARRAY ARRAY['taxi_bot_channels','taxi_bot_sessions','taxi_bot_events','taxi_bot_offers','taxi_bot_outbox'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  END LOOP;
END $$;
GRANT SELECT ON public.taxi_bot_channels,public.taxi_bot_outbox TO service_role;

CREATE FUNCTION public.taxi_bot_emit(p_tenant uuid,p_waba text,p_to text,p_text text,p_key text,p_buttons jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
  IF p_to !~ '^\+[1-9][0-9]{7,14}$' OR p_text IS NULL OR length(p_text)<1 OR length(p_text)>4096 OR (p_buttons IS NOT NULL AND (jsonb_typeof(p_buttons)<>'array' OR jsonb_array_length(p_buttons)>3)) THEN RAISE EXCEPTION 'invalid taxi output';END IF;
  INSERT INTO public.taxi_bot_outbox(tenant_id,waba,destination,body,dedupe_key)
    VALUES(p_tenant,p_waba,p_to,jsonb_build_object('text',p_text,'buttons',p_buttons),p_key) ON CONFLICT(dedupe_key) DO NOTHING;
END $$;

CREATE FUNCTION public.taxi_bot_enqueue(p_tenant uuid,p_waba text,p_message jsonb,p_hash text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.taxi_bot_events%ROWTYPE;c public.taxi_bot_channels%ROWTYPE;q uuid;BEGIN
  SELECT * INTO c FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi channel unavailable';END IF;
  IF jsonb_typeof(p_message)<>'object' OR p_message->>'to'<>p_waba OR p_message->>'from' !~ '^\+[1-9][0-9]{7,14}$' OR length(p_message->>'id') NOT BETWEEN 1 AND 256 OR p_hash !~ '^[a-f0-9]{64}$' OR octet_length(p_payload::text)>131072 THEN RAISE EXCEPTION 'invalid taxi input';END IF;
  IF p_message->>'from'=ANY(c.blocked_phones) THEN RETURN jsonb_build_object('ignored',true);END IF;
  IF (p_message->>'at')::timestamptz<clock_timestamp()-interval '24 hours' OR (p_message->>'at')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid taxi timestamp';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_waba||(p_message->>'from'),1));
  SELECT * INTO e FROM public.taxi_bot_events WHERE tenant_id=p_tenant AND waba=p_waba AND source_id=p_message->>'id';
  IF FOUND THEN
    IF e.fingerprint<>p_hash THEN RAISE EXCEPTION 'taxi event identity conflict';END IF;
    RETURN jsonb_build_object('duplicate',true,'queueId',e.queue_id,'eventId',e.id);
  END IF;
  IF (SELECT count(*) FROM public.taxi_bot_events WHERE tenant_id=p_tenant AND waba=p_waba AND customer=p_message->>'from' AND received_at>now()-interval '1 minute')>=20 THEN RAISE EXCEPTION USING ERRCODE='PT429',MESSAGE='taxi input rate exceeded';END IF;
  INSERT INTO public.taxi_bot_events(tenant_id,waba,customer,source_id,message,fingerprint,source_at)
    VALUES(p_tenant,p_waba,p_message->>'from',p_message->>'id',p_message,p_hash,(p_message->>'at')::timestamptz) RETURNING * INTO e;
  INSERT INTO public.webhook_queue(payload,status)VALUES(p_payload,'pending')RETURNING id INTO q;
  UPDATE public.taxi_bot_events SET queue_id=q WHERE id=e.id;
  RETURN jsonb_build_object('duplicate',false,'queueId',q,'eventId',e.id);
END $$;

CREATE FUNCTION public.taxi_bot_begin(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.taxi_bot_events%ROWTYPE;s public.taxi_bot_sessions%ROWTYPE;l uuid;batch jsonb;trip jsonb;claimed_event uuid;BEGIN
  SELECT * INTO e FROM public.taxi_bot_events WHERE id=p_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi event not found';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(e.tenant_id::text||e.waba||e.customer,1));
  IF e.state IN('completed','human')THEN RETURN jsonb_build_object('state','replay');END IF;
  INSERT INTO public.taxi_bot_sessions(tenant_id,waba,customer)VALUES(e.tenant_id,e.waba,e.customer)ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM public.taxi_bot_sessions WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer FOR UPDATE;
  IF s.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('state','busy');END IF;
  IF EXISTS(SELECT 1 FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='pending' AND received_at>clock_timestamp()-interval '1500 milliseconds')THEN RETURN jsonb_build_object('state','debounce');END IF;
  -- Short global reservation lock, never held during a model or GPS request.
  PERFORM pg_advisory_xact_lock(771404,2200);
  IF(SELECT count(*) FROM public.taxi_bot_sessions WHERE lease_until>clock_timestamp())>=4
    OR(SELECT count(*)FROM public.taxi_bot_sessions WHERE tenant_id=e.tenant_id AND lease_until>clock_timestamp())>=2
    OR(SELECT coalesce(sum(attempts),0)FROM public.taxi_bot_events WHERE received_at>clock_timestamp()-interval '10 minutes')>=600
    OR(SELECT coalesce(sum(attempts),0)FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND received_at>clock_timestamp()-interval '10 minutes')>=180
  THEN RETURN jsonb_build_object('state','limited');END IF;
  -- Only read-only interpretation may repeat after an expired lease, at most three times.
  UPDATE public.taxi_bot_events SET state='human',reason='attempts_exhausted' WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state IN('pending','processing')AND attempts>=3;
  IF EXISTS(SELECT 1 FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='human' AND completed_at IS NULL)THEN
    UPDATE public.taxi_bot_sessions SET mode='human' WHERE id=s.id;s.mode:='human';
    PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,'No pude completar la solicitud. La base necesita revisarla antes de buscar una unidad.','attempts-customer:'||s.id||':'||s.revision);
    PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,c.dispatcher,'Una solicitud agotó sus intentos de interpretación. Revisa el contacto '||e.customer,'attempts-dispatch:'||s.id||':'||s.revision)
      FROM public.taxi_bot_channels c WHERE c.tenant_id=e.tenant_id AND c.waba=e.waba AND c.dispatcher IS NOT NULL;
    UPDATE public.taxi_bot_events SET completed_at=clock_timestamp()WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='human'AND completed_at IS NULL;
    UPDATE public.webhook_queue SET status='done',processed_at=clock_timestamp()WHERE id IN(SELECT queue_id FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='human');
  END IF;
  UPDATE public.taxi_bot_events SET state='completed',reason='stale_source',completed_at=clock_timestamp() WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state IN('pending','processing')AND source_at<s.last_source_at;
  UPDATE public.webhook_queue SET status='done',processed_at=clock_timestamp()WHERE id IN(SELECT queue_id FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='completed'AND reason='stale_source');
  IF EXISTS(SELECT 1 FROM public.taxi_bot_events WHERE id=p_event AND state='completed')THEN RETURN jsonb_build_object('state','replay');END IF;
  l:=gen_random_uuid();
  WITH picked AS(SELECT id FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state IN('pending','processing')AND attempts<3 ORDER BY source_at,received_at,id LIMIT 20 FOR UPDATE)
    UPDATE public.taxi_bot_events SET state='processing',lease=l,attempts=attempts+1 WHERE id IN(SELECT id FROM picked);
  SELECT jsonb_agg(message ORDER BY source_at,received_at,id)INTO batch FROM public.taxi_bot_events WHERE lease=l AND state='processing';
  IF batch IS NULL THEN RETURN jsonb_build_object('state','replay');END IF;
  UPDATE public.taxi_bot_sessions SET lease=l,lease_until=clock_timestamp()+interval '2 minutes' WHERE id=s.id;
  SELECT id INTO claimed_event FROM public.taxi_bot_events WHERE lease=l AND state='processing'ORDER BY source_at,received_at,id LIMIT 1;
  SELECT jsonb_build_object('id',id,'state',estado,'taxiName',taxi_name) INTO trip FROM public.viajes WHERE tenant_id=e.tenant_id AND cliente_tel=e.customer AND (bot_waba=e.waba OR bot_waba IS NULL)AND estado IN('buscando_conductor','en_camino')ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('state','proceed','eventId',claimed_event,'tenantId',e.tenant_id,'waba',e.waba,'lease',l,'messages',batch,'session',jsonb_build_object('revision',s.revision,'mode',s.mode,'draft',s.draft,'history',s.history,'active',trip));
END $$;

CREATE FUNCTION public.taxi_bot_trip_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
  IF TG_OP='DELETE'THEN
    IF(OLD.bot_managed OR public.taxi_bot_owns_tenant(OLD.tenant_id))AND current_setting('app.taxi_bot_write',true)IS DISTINCT FROM 'on'THEN RAISE EXCEPTION 'taxi protocol owns this trip';END IF;RETURN OLD;
  END IF;
  IF (NEW.bot_managed OR public.taxi_bot_owns_tenant(NEW.tenant_id)OR(TG_OP='UPDATE'AND(OLD.bot_managed OR public.taxi_bot_owns_tenant(OLD.tenant_id))))AND current_setting('app.taxi_bot_write',true)IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'taxi protocol owns this trip';END IF;RETURN NEW;
END $$;
CREATE TRIGGER taxi_bot_trip_guard BEFORE INSERT OR UPDATE OR DELETE ON public.viajes FOR EACH ROW EXECUTE FUNCTION public.taxi_bot_trip_guard();

CREATE FUNCTION public.taxi_bot_commit(p_event uuid,p_lease uuid,p_revision bigint,p_decision jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.taxi_bot_events%ROWTYPE;s public.taxi_bot_sessions%ROWTYPE;c public.taxi_bot_channels%ROWTYPE;
  t public.viajes%ROWTYPE;o public.taxi_bot_offers%ROWTYPE;driver public.conductores%ROWTYPE;
  a text;d jsonb;item jsonb;idx integer:=0;count_offers integer:=0;tid uuid;token text;reply text;last_at timestamptz;hist jsonb;current_messages text;BEGIN
  SELECT * INTO e FROM public.taxi_bot_events WHERE id=p_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi event not found';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(e.tenant_id::text||e.waba||e.customer,1));
  SELECT * INTO s FROM public.taxi_bot_sessions WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer FOR UPDATE;
  IF e.state='completed' THEN RETURN jsonb_build_object('state','replay');END IF;
  IF s.lease IS DISTINCT FROM p_lease OR s.lease_until<clock_timestamp()OR s.revision<>p_revision OR e.lease IS DISTINCT FROM p_lease THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='stale taxi operation';END IF;
  -- A correction arriving while interpretation/geocoding runs must join the next turn.
  IF EXISTS(SELECT 1 FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='pending')THEN
    UPDATE public.taxi_bot_events SET state='pending',lease=NULL WHERE lease=p_lease AND state='processing';
    UPDATE public.taxi_bot_sessions SET lease=NULL,lease_until=NULL WHERE id=s.id;
    RETURN jsonb_build_object('state','superseded');
  END IF;
  SELECT * INTO c FROM public.taxi_bot_channels WHERE tenant_id=e.tenant_id AND waba=e.waba AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi channel disabled';END IF;
  a:=p_decision->>'action';d:=p_decision->'draft';
  IF a IS NULL OR a NOT IN('draft','reply','confirm','cancel','human','driver_accept','driver_reject','driver_finish')OR jsonb_typeof(d)<>'object' OR octet_length(p_decision::text)>32768 THEN RAISE EXCEPTION 'invalid taxi decision';END IF;
  PERFORM set_config('app.taxi_bot_write','on',true);
  IF a='confirm' THEN
    IF s.mode<>'bot' OR s.draft->>'confirmation' IS NULL OR s.draft->>'confirmation'IS DISTINCT FROM p_decision->>'confirmation'OR coalesce((s.draft->>'expiresAt')::timestamptz<=clock_timestamp(),true)
      OR s.draft->>'awaitingLocation'IS NOT NULL OR s.draft->>'pendingLocation'IS NOT NULL
      OR length(coalesce(s.draft->>'name',''))NOT BETWEEN 2 AND 80 OR coalesce(jsonb_typeof(s.draft->'origin'),'null')<>'object'OR coalesce(jsonb_typeof(s.draft->'destination'),'null')<>'object' THEN RAISE EXCEPTION 'taxi confirmation not current';END IF;
    -- Companion H3 migration must be installed before activating this local candidate.
    PERFORM public.taxi_bot_validate_quote(e.tenant_id,e.waba,s.draft);
    IF EXISTS(SELECT 1 FROM public.viajes WHERE tenant_id=e.tenant_id AND cliente_tel=e.customer AND estado IN('buscando_conductor','en_camino'))THEN RAISE EXCEPTION 'customer already has an active trip';END IF;
    tid:=gen_random_uuid();token:=replace(gen_random_uuid()::text,'-','');
    INSERT INTO public.viajes(id,token,tenant_id,cliente_tel,cliente_nombre,origen,destino,origen_lat,origen_lng,estado,conductores_contactados,bot_managed,bot_waba,bot_request_id,bot_quote_cents,bot_quote_h3)
      VALUES(tid,token,e.tenant_id,e.customer,s.draft->>'name',s.draft#>>'{origin,text}',s.draft#>>'{destination,text}',(s.draft#>>'{origin,lat}')::double precision,(s.draft#>>'{origin,lng}')::double precision,'buscando_conductor','{}',true,e.waba,e.id,(s.draft->>'quoteCents')::integer,NULLIF(s.draft->'quoteH3','null'::jsonb));
    IF jsonb_typeof(p_decision->'candidates')<>'array'OR jsonb_array_length(p_decision->'candidates')>3 THEN RAISE EXCEPTION 'invalid candidate limit';END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_decision->'candidates') LOOP
      SELECT * INTO driver FROM public.conductores WHERE tenant_id=e.tenant_id AND device_id=(item->>'deviceId')::integer AND activo=true;
      IF NOT FOUND OR EXISTS(SELECT 1 FROM public.viajes WHERE device_id=driver.device_id AND estado='en_camino')THEN CONTINUE;END IF;
      IF '+'||regexp_replace(driver.telefono_whatsapp,'\D','','g') !~ '^\+[1-9][0-9]{7,14}$'THEN CONTINUE;END IF;
      INSERT INTO public.taxi_bot_offers(tenant_id,waba,trip_id,device_id,driver_phone,driver_name)VALUES(e.tenant_id,e.waba,tid,driver.device_id,'+'||regexp_replace(driver.telefono_whatsapp,'\D','','g'),driver.nombre)ON CONFLICT DO NOTHING RETURNING * INTO o;
      IF NOT FOUND THEN CONTINUE;END IF;count_offers:=count_offers+1;
      UPDATE public.viajes SET conductores_contactados=array_append(conductores_contactados,driver.device_id)WHERE id=tid;
      PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,o.driver_phone,'¿Puedes tomar este viaje?'||E'\nRecogida: '||(s.draft#>>'{origin,text}')||E'\nDestino: '||(s.draft#>>'{destination,text}')||E'\nTarifa: '||CASE WHEN s.draft->>'quoteCents'IS NULL THEN 'por confirmar con la base' ELSE '$'||((s.draft->>'quoteCents')::numeric/100)::text||' MXN'END,
        'offer:'||o.id,jsonb_build_array(jsonb_build_object('id','txa_'||o.id,'title','Aceptar viaje'),jsonb_build_object('id','txr_'||o.id,'title','No puedo')));
    END LOOP;
    reply:=CASE WHEN count_offers>0 THEN 'Tu solicitud quedó registrada. Estamos buscando quién puede ir por ti; aún no hay unidad confirmada.'ELSE 'Tu solicitud quedó registrada, pero todavía no hay unidad disponible para ofrecerla. La base debe revisarla.'END;
    PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,reply,'trip-created:'||tid);
    IF c.dispatcher IS NOT NULL THEN PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,c.dispatcher,'Solicitud de taxi pendiente.'||E'\nPasajero: '||(s.draft->>'name')||E'\nContacto: '||e.customer||E'\nRecogida: '||(s.draft#>>'{origin,text}')||E'\nDestino: '||(s.draft#>>'{destination,text}')||E'\nOfertas creadas: '||count_offers,'dispatch:'||tid);END IF;
    d:='{"name":null,"origin":null,"destination":null,"quoteCents":null,"confirmation":null,"expiresAt":null,"awaitingLocation":null,"pendingLocation":null,"quoteH3":null}'::jsonb;
  ELSIF a='cancel' THEN
    SELECT * INTO t FROM public.viajes WHERE id=(p_decision->>'tripId')::uuid AND tenant_id=e.tenant_id AND cliente_tel=e.customer AND bot_waba=e.waba AND bot_managed FOR UPDATE;
    IF NOT FOUND OR t.estado NOT IN('buscando_conductor','en_camino')THEN reply:='Ese viaje ya no está activo. No cambié ninguna otra solicitud.';
    ELSE
      UPDATE public.viajes SET estado='cancelado',updated_at=clock_timestamp()WHERE id=t.id;
      UPDATE public.taxi_bot_offers SET state='revoked'WHERE trip_id=t.id AND state IN('offered','accepted');
      FOR o IN SELECT * FROM public.taxi_bot_offers WHERE trip_id=t.id AND device_id=t.device_id LOOP
        PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,o.driver_phone,'El pasajero canceló este viaje. Ya no te dirijas al punto.','cancel-driver:'||t.id);
      END LOOP;reply:='Tu viaje quedó cancelado.';
    END IF;
    PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,reply,'cancel-customer:'||e.id);
  ELSIF a IN('driver_accept','driver_reject','driver_finish')THEN
    SELECT * INTO o FROM public.taxi_bot_offers WHERE id=(p_decision->>'offerId')::uuid AND tenant_id=e.tenant_id AND waba=e.waba AND driver_phone=e.customer;
    IF NOT FOUND THEN reply:='Ese botón no corresponde a una oferta para tu cuenta.';
    ELSE
      SELECT * INTO t FROM public.viajes WHERE id=o.trip_id AND tenant_id=e.tenant_id AND bot_waba=e.waba AND bot_managed FOR UPDATE;
      SELECT * INTO o FROM public.taxi_bot_offers WHERE id=o.id FOR UPDATE;
      SELECT * INTO driver FROM public.conductores WHERE tenant_id=e.tenant_id AND device_id=o.device_id AND activo=true AND '+'||regexp_replace(telefono_whatsapp,'\D','','g')=e.customer FOR UPDATE;
      IF NOT FOUND THEN reply:='Tu cuenta ya no está autorizada para esa unidad.';
      ELSIF a='driver_accept'AND t.estado='buscando_conductor'AND o.state='offered'AND o.expires_at>clock_timestamp()THEN
        IF EXISTS(SELECT 1 FROM public.viajes WHERE device_id=o.device_id AND estado='en_camino')THEN reply:='La unidad ya tiene otro viaje activo. No se asignó este servicio.';
        ELSE
          UPDATE public.viajes SET estado='en_camino',device_id=o.device_id,taxi_name=o.driver_name,updated_at=clock_timestamp()WHERE id=t.id;
          UPDATE public.taxi_bot_offers SET state=CASE WHEN id=o.id THEN 'accepted'ELSE 'revoked'END WHERE trip_id=t.id AND state='offered';
          PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,t.cliente_tel,'La unidad '||o.driver_name||' aceptó tu viaje. Te avisamos si hay algún cambio.','trip-assigned:'||t.id);
          PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,'Viaje asignado a tu unidad.'||E'\nPasajero: '||t.cliente_nombre||E'\nContacto: '||t.cliente_tel||E'\nRecogida: '||t.origen||E'\nDestino: '||t.destino,'driver-assigned:'||t.id,jsonb_build_array(jsonb_build_object('id','txf_'||o.id,'title','Finalizar viaje')));
        END IF;
      ELSIF a='driver_reject'AND t.estado='buscando_conductor'AND o.state='offered'THEN
        UPDATE public.taxi_bot_offers SET state='rejected'WHERE id=o.id;reply:='Registré que no puedes tomar ese viaje.';
        IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE trip_id=t.id AND state='offered'AND expires_at>clock_timestamp())AND c.dispatcher IS NOT NULL THEN PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,c.dispatcher,'Las ofertas del viaje '||t.id||' quedaron sin aceptación. Revisa la solicitud en la base.','no-offers:'||t.id);END IF;
      ELSIF a='driver_finish'AND t.estado='en_camino'AND t.device_id=o.device_id AND o.state='accepted'THEN
        UPDATE public.viajes SET estado='completado',updated_at=clock_timestamp()WHERE id=t.id;
        UPDATE public.taxi_bot_offers SET state='finished'WHERE id=o.id;reply:='Viaje marcado como finalizado.';
        PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,t.cliente_tel,'El conductor marcó tu viaje como finalizado. Gracias por viajar con nosotros.','trip-finished:'||t.id);
      ELSE reply:='Esa oferta venció o el viaje ya cambió de estado. No se hizo otra asignación.';END IF;
    END IF;
    IF reply IS NOT NULL THEN PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,reply,'driver-reply:'||e.id);END IF;
  ELSE
    IF s.mode='human'AND a<>'human'THEN p_decision:=jsonb_set(p_decision,'{messages}','[]');END IF;
    IF a='human'THEN
      UPDATE public.taxi_bot_sessions SET mode='human'WHERE id=s.id;
      d:=jsonb_set(jsonb_set(d,'{confirmation}','null'),'{expiresAt}','null');
      SELECT string_agg(message->>'text',E'\n'ORDER BY source_at,received_at,id)INTO current_messages FROM public.taxi_bot_events WHERE lease=p_lease AND state='processing';
      IF c.dispatcher IS NOT NULL THEN PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,c.dispatcher,'Se necesita atención humana para el contacto '||e.customer||'. Motivo: '||coalesce(p_decision->>'reason','revision')||E'\nMensajes recientes (hasta 1500 caracteres): '||right(coalesce(current_messages,''),1500),'human:'||e.id);END IF;
    END IF;
    IF a IN('draft','human')THEN
      IF d->>'confirmation'IS NOT NULL AND (d->>'awaitingLocation'IS NOT NULL OR d->>'pendingLocation'IS NOT NULL OR d->>'expiresAt'IS NULL
        OR(d->>'expiresAt')::timestamptz>clock_timestamp()+interval '11 minutes'OR(d->>'expiresAt')::timestamptz<=clock_timestamp())THEN RAISE EXCEPTION 'invalid summary state or expiry';END IF;
    ELSE d:=s.draft;END IF;
    IF jsonb_typeof(p_decision->'messages')<>'array'OR jsonb_array_length(p_decision->'messages')>3 THEN RAISE EXCEPTION 'invalid output count';END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_decision->'messages')LOOP
      IF item->>'to'IS DISTINCT FROM e.customer THEN RAISE EXCEPTION 'reply recipient is not the current customer';END IF;
      idx:=idx+1;PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,item->>'text','reply:'||e.id||':'||idx,CASE WHEN jsonb_typeof(item->'buttons')='array'THEN item->'buttons'ELSE NULL END);
    END LOOP;
  END IF;
  SELECT max(source_at)INTO last_at FROM public.taxi_bot_events WHERE lease=p_lease AND state='processing';
  SELECT coalesce(jsonb_agg(jsonb_build_object('role','user','content',left(CASE WHEN length(message->>'text')>0 THEN message->>'text'ELSE '[Ubicación o botón]'END,3000))ORDER BY source_at,received_at,id),'[]')INTO hist FROM public.taxi_bot_events WHERE lease=p_lease AND state='processing';
  hist:=s.history||hist;
  SELECT body->>'text'INTO reply FROM public.taxi_bot_outbox WHERE dedupe_key IN('trip-created:'||tid,'reply:'||e.id||':1','cancel-customer:'||e.id,'driver-reply:'||e.id)ORDER BY created_at DESC LIMIT 1;
  IF reply IS NOT NULL THEN hist:=hist||jsonb_build_array(jsonb_build_object('role','assistant','content',left(reply,3000)));END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]')INTO hist FROM jsonb_array_elements(hist)WITH ORDINALITY x(value,ord)WHERE ord>jsonb_array_length(hist)-12;
  UPDATE public.taxi_bot_sessions SET draft=d,history=hist,revision=revision+1,lease=NULL,lease_until=NULL,last_source_at=last_at,updated_at=clock_timestamp()WHERE id=s.id;
  UPDATE public.taxi_bot_events SET state='completed',reason=left(p_decision->>'reason',80),completed_at=clock_timestamp()WHERE lease=p_lease AND state='processing';
  UPDATE public.webhook_queue SET status='done',processed_at=clock_timestamp()WHERE id IN(SELECT queue_id FROM public.taxi_bot_events WHERE lease=p_lease);
  RETURN jsonb_build_object('state','committed','tripId',tid);
END $$;

CREATE FUNCTION public.taxi_bot_outbox_claim(p_tenant uuid,p_waba text)
RETURNS SETOF public.taxi_bot_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
  UPDATE public.taxi_bot_outbox SET state='uncertain',error_code='send_lease_expired',updated_at=clock_timestamp()WHERE tenant_id=p_tenant AND waba=p_waba AND state='sending'AND lease_until<clock_timestamp();
  IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND enabled)THEN RETURN;END IF;
  UPDATE public.taxi_bot_outbox SET state='failed',error_code='outdated_before_send',updated_at=clock_timestamp()WHERE id IN(
    SELECT b.id FROM public.taxi_bot_outbox b WHERE b.tenant_id=p_tenant AND b.waba=p_waba AND b.state='pending'AND(
      (b.dedupe_key LIKE 'offer:%'AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_offers o JOIN public.viajes v ON v.id=o.trip_id WHERE b.dedupe_key='offer:'||o.id AND o.state='offered'AND o.expires_at>clock_timestamp()AND v.estado='buscando_conductor'))
      OR(b.dedupe_key LIKE 'trip-created:%'AND NOT EXISTS(SELECT 1 FROM public.viajes v WHERE b.dedupe_key='trip-created:'||v.id AND v.estado='buscando_conductor'))
      OR(b.dedupe_key LIKE 'trip-assigned:%'AND NOT EXISTS(SELECT 1 FROM public.viajes v WHERE b.dedupe_key='trip-assigned:'||v.id AND v.estado='en_camino'))
      OR(b.dedupe_key LIKE 'driver-assigned:%'AND NOT EXISTS(SELECT 1 FROM public.viajes v WHERE b.dedupe_key='driver-assigned:'||v.id AND v.estado='en_camino'))
      OR(b.body#>>'{buttons,0,id}'LIKE 'txc_%'AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_sessions s WHERE s.tenant_id=b.tenant_id AND s.waba=b.waba AND s.customer=b.destination AND 'txc_'||(s.draft->>'confirmation')=b.body#>>'{buttons,0,id}'AND(s.draft->>'expiresAt')::timestamptz>clock_timestamp()))
    )ORDER BY b.sequence LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  -- Serialise pending messages for a recipient, so a result cannot overtake its summary.
  RETURN QUERY WITH picked AS(SELECT b.id FROM public.taxi_bot_outbox b WHERE b.tenant_id=p_tenant AND b.waba=p_waba AND b.state='pending'
    AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_outbox older WHERE older.tenant_id=b.tenant_id AND older.waba=b.waba AND older.destination=b.destination AND older.state IN('pending','sending')AND older.sequence<b.sequence)
    ORDER BY b.sequence LIMIT 3 FOR UPDATE SKIP LOCKED)
    UPDATE public.taxi_bot_outbox b SET state='sending',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp()WHERE b.id IN(SELECT id FROM picked)RETURNING b.*;
END $$;
CREATE FUNCTION public.taxi_bot_outbox_complete(p_id uuid,p_lease uuid,p_state text,p_provider text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE changed integer;BEGIN
  IF p_state NOT IN('accepted','failed','uncertain')OR(p_state='accepted'AND length(coalesce(p_provider,''))NOT BETWEEN 1 AND 256)THEN RAISE EXCEPTION 'invalid provider result';END IF;
  UPDATE public.taxi_bot_outbox SET state=p_state,provider_id=p_provider,error_code=left(p_error,80),updated_at=clock_timestamp()WHERE id=p_id AND lease=p_lease AND state='sending';
  GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed=1;
END $$;
CREATE FUNCTION public.taxi_bot_provider_status(p_id uuid,p_provider text,p_waba text,p_to text,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE changed integer;BEGIN
  IF p_status NOT IN('accepted','delivered','read','failed')THEN RETURN false;END IF;
  UPDATE public.taxi_bot_outbox SET state=p_status,provider_id=p_provider,updated_at=clock_timestamp()
    WHERE id=p_id AND waba=p_waba AND destination=p_to AND (provider_id IS NULL OR provider_id=p_provider)
    AND CASE p_status WHEN 'accepted'THEN state IN('sending','uncertain')WHEN 'delivered'THEN state IN('sending','uncertain','accepted')WHEN 'read'THEN state IN('sending','uncertain','accepted','delivered')ELSE state IN('sending','uncertain','accepted')END;
  GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed=1;
END $$;
CREATE FUNCTION public.taxi_bot_pending()RETURNS SETOF public.taxi_bot_events LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT e.* FROM public.taxi_bot_events e JOIN public.taxi_bot_channels c ON c.tenant_id=e.tenant_id AND c.waba=e.waba AND c.enabled
  WHERE(e.state='pending'OR(e.state='processing'AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_sessions s WHERE s.tenant_id=e.tenant_id AND s.waba=e.waba AND s.customer=e.customer AND s.lease_until>clock_timestamp())))
  AND e.received_at<clock_timestamp()-interval '1500 milliseconds'ORDER BY e.received_at LIMIT 10;
$$;
CREATE FUNCTION public.taxi_bot_event_for_queue(p_queue uuid)RETURNS SETOF public.taxi_bot_events LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT * FROM public.taxi_bot_events WHERE queue_id=p_queue LIMIT 1;
$$;
CREATE FUNCTION public.taxi_bot_maintain()RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t public.viajes%ROWTYPE;c public.taxi_bot_channels%ROWTYPE;total integer:=0;BEGIN
  PERFORM set_config('app.taxi_bot_write','on',true);
  UPDATE public.taxi_bot_offers SET state='expired'WHERE id IN(SELECT id FROM public.taxi_bot_offers WHERE state='offered'AND expires_at<clock_timestamp()ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
  FOR t IN SELECT v.* FROM public.viajes v WHERE v.bot_managed AND v.estado='buscando_conductor'AND v.created_at<clock_timestamp()-interval '12 minutes'
    AND EXISTS(SELECT 1 FROM public.taxi_bot_channels channel WHERE channel.tenant_id=v.tenant_id AND channel.waba=v.bot_waba AND channel.enabled)ORDER BY v.created_at LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
    SELECT * INTO c FROM public.taxi_bot_channels WHERE tenant_id=t.tenant_id AND waba=t.bot_waba;
    UPDATE public.viajes SET estado='cancelado_timeout',updated_at=clock_timestamp()WHERE id=t.id;
    UPDATE public.taxi_bot_offers SET state='revoked'WHERE trip_id=t.id AND state='offered';
    PERFORM public.taxi_bot_emit(t.tenant_id,t.bot_waba,t.cliente_tel,'No se consiguió una unidad para este viaje. La solicitud se cerró; escríbenos si quieres volver a intentarlo.','timeout-customer:'||t.id);
    IF c.dispatcher IS NOT NULL THEN PERFORM public.taxi_bot_emit(t.tenant_id,t.bot_waba,c.dispatcher,'El viaje '||t.id||' cerró sin unidad confirmada. Revisa si el pasajero aún necesita ayuda.','timeout-dispatch:'||t.id);END IF;total:=total+1;
  END LOOP;
  RETURN total;
END $$;
CREATE FUNCTION public.taxi_bot_resume(p_tenant uuid,p_waba text,p_customer text,p_revision bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE changed integer;BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_waba||p_customer,1));
  UPDATE public.taxi_bot_sessions SET mode='bot',draft=jsonb_set(jsonb_set(draft,'{confirmation}','null'),'{expiresAt}','null'),revision=revision+1,updated_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND waba=p_waba AND customer=p_customer AND revision=p_revision AND mode='human'AND(lease_until IS NULL OR lease_until<clock_timestamp());
  GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed=1;
END $$;
-- No public RPC may bypass the service's verified provider/worker boundary.
DO $$ DECLARE fn record;BEGIN
  FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'AND p.proname LIKE 'taxi_bot_%'LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature);
    IF fn.signature::text NOT LIKE 'taxi_bot_emit(%'AND fn.signature::text NOT LIKE 'taxi_bot_trip_guard(%'THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature);END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.taxi_bot_owns_tenant(uuid)TO anon,authenticated;
COMMIT;
