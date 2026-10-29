-- Pompeyo: customer intake is closed unless explicitly authorized. No public-mode switch.
CREATE TABLE public.taxi_bot_customer_access(
  tenant_id uuid PRIMARY KEY REFERENCES public.empresas(id), revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0)
);
CREATE FUNCTION public.taxi_bot_customer_phone(p_phone text)RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p_phone ~ '^\+521[0-9]{10}$' THEN '+52'||substr(p_phone,5) WHEN p_phone ~ '^\+[1-9][0-9]{7,14}$' THEN p_phone ELSE NULL END
$$;
CREATE TABLE public.taxi_bot_allowed_customers(
  tenant_id uuid NOT NULL REFERENCES public.taxi_bot_customer_access(tenant_id), phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),created_by bigint,source text NOT NULL DEFAULT 'panel',
  PRIMARY KEY(tenant_id,phone),CHECK(phone=public.taxi_bot_customer_phone(phone) AND public.taxi_bot_customer_phone(phone)IS NOT NULL)
);
CREATE TABLE public.taxi_bot_customer_access_operations(
  actor bigint NOT NULL,request_id uuid NOT NULL,tenant_id uuid NOT NULL,command jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor,request_id)
);
ALTER TABLE public.taxi_bot_customer_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxi_bot_allowed_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxi_bot_customer_access_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_customer_access,public.taxi_bot_allowed_customers,public.taxi_bot_customer_access_operations FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.taxi_bot_customer_access(tenant_id)SELECT id FROM public.empresas WHERE tipo_negocio='taxi';

CREATE FUNCTION public.taxi_bot_customer_allowed(p_tenant uuid,p_phone text)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.taxi_bot_allowed_customers WHERE tenant_id=p_tenant AND phone=public.taxi_bot_customer_phone(p_phone))
$$;
CREATE FUNCTION public.taxi_bot_inbound_allowed(p_tenant uuid,p_waba text,p_message jsonb)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.taxi_bot_customer_allowed(p_tenant,p_message->>'from') OR (
    p_message->>'type'='button' AND p_message->>'button' ~ '^tx[arf]_[0-9a-f-]{36}$' AND EXISTS(
      SELECT 1 FROM public.taxi_bot_offers o JOIN public.conductores d ON d.tenant_id=o.tenant_id AND d.device_id=o.device_id AND d.activo
      WHERE o.tenant_id=p_tenant AND o.waba=p_waba AND o.id::text=substr(p_message->>'button',5)
      AND public.taxi_bot_customer_phone(o.driver_phone)=public.taxi_bot_customer_phone(p_message->>'from')
      AND public.taxi_bot_customer_phone('+'||regexp_replace(d.telefono_whatsapp,'\D','','g'))=public.taxi_bot_customer_phone(p_message->>'from')
      AND ((left(p_message->>'button',3)IN('txa','txr')AND o.state='offered'AND o.expires_at>clock_timestamp()) OR(left(p_message->>'button',3)='txf'AND o.state='accepted'))
    )
  )
$$;
CREATE FUNCTION public.taxi_bot_recipient_allowed(p_tenant uuid,p_waba text,p_to text)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND (
    public.taxi_bot_customer_allowed(p_tenant,p_to) OR public.taxi_bot_customer_phone(c.dispatcher)=public.taxi_bot_customer_phone(p_to) OR EXISTS(
      SELECT 1 FROM public.conductores d WHERE d.tenant_id=p_tenant AND d.activo AND public.taxi_bot_customer_phone('+'||regexp_replace(d.telefono_whatsapp,'\D','','g'))=public.taxi_bot_customer_phone(p_to)
    )
  ))
$$;
CREATE FUNCTION public.taxi_bot_outbox_permitted(p_id uuid,p_lease uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.taxi_bot_outbox b WHERE id=p_id AND lease=p_lease AND state='sending'AND public.taxi_bot_recipient_allowed(b.tenant_id,b.waba,b.destination))
$$;
CREATE FUNCTION public.taxi_bot_customer_access_read(p_tenant uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=p_tenant AND tipo_negocio='taxi')THEN RAISE EXCEPTION 'taxi company required';END IF;
  SELECT jsonb_build_object('restricted',true,'revision',coalesce((SELECT revision FROM public.taxi_bot_customer_access WHERE tenant_id=p_tenant),0),'phones',(SELECT coalesce(jsonb_agg(phone ORDER BY phone),'[]') FROM(SELECT phone FROM public.taxi_bot_allowed_customers WHERE tenant_id=p_tenant ORDER BY phone LIMIT 101)x))INTO result;
  RETURN result;
END $$;
CREATE FUNCTION public.taxi_bot_customer_access_apply(p_tenant uuid,p_actor bigint,p_request uuid,p_expected bigint,p_phones jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior public.taxi_bot_customer_access_operations;command jsonb;result jsonb;current_rev bigint;BEGIN
  IF p_actor IS NULL OR p_actor<=0 OR p_request IS NULL OR p_expected IS NULL OR p_expected<0 OR jsonb_typeof(p_phones)IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid customer access';END IF;
  IF jsonb_array_length(p_phones)>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_phones)v WHERE jsonb_typeof(v)<>'string'OR public.taxi_bot_customer_phone(v#>>'{}')IS NULL OR public.taxi_bot_customer_phone(v#>>'{}')<>v#>>'{}')OR(SELECT count(DISTINCT v#>>'{}')FROM jsonb_array_elements(p_phones)v)<>jsonb_array_length(p_phones)THEN RAISE EXCEPTION 'invalid customer access';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,24));
  command:=jsonb_build_object('tenant',p_tenant,'expected',p_expected,'phones',p_phones);
  SELECT * INTO prior FROM public.taxi_bot_customer_access_operations WHERE actor=p_actor AND request_id=p_request;
  IF FOUND THEN IF prior.command IS DISTINCT FROM command THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN prior.response;END IF;
  INSERT INTO public.taxi_bot_customer_access(tenant_id)VALUES(p_tenant)ON CONFLICT DO NOTHING;
  SELECT revision INTO current_rev FROM public.taxi_bot_customer_access WHERE tenant_id=p_tenant FOR UPDATE;
  IF current_rev<>p_expected THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
  DELETE FROM public.taxi_bot_allowed_customers WHERE tenant_id=p_tenant AND phone NOT IN(SELECT value FROM jsonb_array_elements_text(p_phones));
  INSERT INTO public.taxi_bot_allowed_customers(tenant_id,phone,created_by)SELECT p_tenant,value,p_actor FROM jsonb_array_elements_text(p_phones)ON CONFLICT DO NOTHING;
  UPDATE public.taxi_bot_customer_access SET revision=revision+1 WHERE tenant_id=p_tenant;
  result:=public.taxi_bot_customer_access_read(p_tenant)||jsonb_build_object('state','saved');
  INSERT INTO public.taxi_bot_customer_access_operations(actor,request_id,tenant_id,command,response)VALUES(p_actor,p_request,p_tenant,command,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_customer_phone(text),public.taxi_bot_customer_allowed(uuid,text),public.taxi_bot_inbound_allowed(uuid,text,jsonb),public.taxi_bot_recipient_allowed(uuid,text,text),public.taxi_bot_outbox_permitted(uuid,uuid),public.taxi_bot_customer_access_read(uuid),public.taxi_bot_customer_access_apply(uuid,bigint,uuid,bigint,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_customer_phone(text),public.taxi_bot_customer_allowed(uuid,text),public.taxi_bot_inbound_allowed(uuid,text,jsonb),public.taxi_bot_recipient_allowed(uuid,text,text),public.taxi_bot_outbox_permitted(uuid,uuid),public.taxi_bot_customer_access_read(uuid),public.taxi_bot_customer_access_apply(uuid,bigint,uuid,bigint,jsonb)TO service_role;

CREATE OR REPLACE FUNCTION public.taxi_bot_enqueue(p_tenant uuid,p_waba text,p_message jsonb,p_hash text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.taxi_bot_events%ROWTYPE;c public.taxi_bot_channels%ROWTYPE;q uuid;BEGIN
  SELECT * INTO c FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi channel unavailable';END IF;
  IF jsonb_typeof(p_message)<>'object' OR p_message->>'to'<>p_waba OR p_message->>'from' !~ '^\+[1-9][0-9]{7,14}$' OR length(p_message->>'id') NOT BETWEEN 1 AND 256 OR p_hash !~ '^[a-f0-9]{64}$' OR octet_length(p_payload::text)>131072 THEN RAISE EXCEPTION 'invalid taxi input';END IF;
  PERFORM 1 FROM public.taxi_bot_customer_access WHERE tenant_id=p_tenant FOR SHARE;
  IF NOT public.taxi_bot_inbound_allowed(p_tenant,p_waba,p_message) THEN RETURN jsonb_build_object('ignored',true,'reason','customer_not_authorized');END IF;
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

CREATE OR REPLACE FUNCTION public.taxi_bot_begin(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.taxi_bot_events%ROWTYPE;s public.taxi_bot_sessions%ROWTYPE;l uuid;batch jsonb;trip jsonb;claimed_event uuid;BEGIN
  SELECT * INTO e FROM public.taxi_bot_events WHERE id=p_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi event not found';END IF;
  PERFORM 1 FROM public.taxi_bot_customer_access WHERE tenant_id=e.tenant_id FOR SHARE;
  IF NOT public.taxi_bot_inbound_allowed(e.tenant_id,e.waba,e.message) THEN
    UPDATE public.taxi_bot_events SET state='completed',lease=NULL WHERE id=e.id AND state IN('pending','processing');
    UPDATE public.webhook_queue SET status='done',processed_at=clock_timestamp() WHERE id=e.queue_id;
    RETURN jsonb_build_object('state','blocked');
  END IF;
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

CREATE OR REPLACE FUNCTION public.taxi_bot_commit(p_event uuid,p_lease uuid,p_revision bigint,p_decision jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.taxi_bot_events%ROWTYPE;s public.taxi_bot_sessions%ROWTYPE;c public.taxi_bot_channels%ROWTYPE;
  t public.viajes%ROWTYPE;o public.taxi_bot_offers%ROWTYPE;driver public.conductores%ROWTYPE;
  a text;d jsonb;item jsonb;idx integer:=0;count_offers integer:=0;tid uuid;token text;reply text;last_at timestamptz;hist jsonb;current_messages text;BEGIN
  SELECT * INTO e FROM public.taxi_bot_events WHERE id=p_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi event not found';END IF;
  PERFORM 1 FROM public.taxi_bot_customer_access WHERE tenant_id=e.tenant_id FOR SHARE;
  IF NOT public.taxi_bot_inbound_allowed(e.tenant_id,e.waba,e.message) THEN RAISE EXCEPTION USING ERRCODE='PT403',MESSAGE='taxi_customer_not_authorized';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(e.tenant_id::text||e.waba||e.customer,1));
  SELECT * INTO s FROM public.taxi_bot_sessions WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer FOR UPDATE;
  IF e.state='completed' THEN RETURN jsonb_build_object('state','replay');END IF;
  IF s.lease IS DISTINCT FROM p_lease OR s.lease_until<clock_timestamp()OR s.revision<>p_revision OR e.lease IS DISTINCT FROM p_lease THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='stale taxi operation';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_turn_traces WHERE event_id=p_event AND lease=p_lease AND revision=p_revision AND state='running')THEN RAISE EXCEPTION 'trace start required';END IF;
  IF NOT public.taxi_bot_trace_packet_valid(p_decision->'audit')THEN RAISE EXCEPTION 'invalid trace packet';END IF;
  -- A correction arriving while interpretation/geocoding runs must join the next turn.
  IF EXISTS(SELECT 1 FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='pending')THEN
    UPDATE public.taxi_bot_events SET state='pending',lease=NULL WHERE lease=p_lease AND state='processing';
    UPDATE public.taxi_bot_sessions SET lease=NULL,lease_until=NULL WHERE id=s.id;
    PERFORM public.taxi_bot_trace_complete(p_event,p_lease,p_revision,'superseded',p_decision->'audit',p_decision->>'action','newer_input');
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
    SELECT * INTO o FROM public.taxi_bot_offers WHERE id=(p_decision->>'offerId')::uuid AND tenant_id=e.tenant_id AND waba=e.waba AND public.taxi_bot_customer_phone(driver_phone)=public.taxi_bot_customer_phone(e.customer);
    IF NOT FOUND THEN reply:='Ese botón no corresponde a una oferta para tu cuenta.';
    ELSE
      SELECT * INTO t FROM public.viajes WHERE id=o.trip_id AND tenant_id=e.tenant_id AND bot_waba=e.waba AND bot_managed FOR UPDATE;
      SELECT * INTO o FROM public.taxi_bot_offers WHERE id=o.id FOR UPDATE;
      SELECT * INTO driver FROM public.conductores WHERE tenant_id=e.tenant_id AND device_id=o.device_id AND activo=true AND public.taxi_bot_customer_phone('+'||regexp_replace(telefono_whatsapp,'\D','','g'))=public.taxi_bot_customer_phone(e.customer) FOR UPDATE;
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
  PERFORM public.taxi_bot_trace_complete(p_event,p_lease,p_revision,'committed',p_decision->'audit',a,p_decision->>'reason');
  RETURN jsonb_build_object('state','committed','tripId',tid);
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_outbox_claim(p_tenant uuid,p_waba text)
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
  UPDATE public.taxi_bot_outbox SET state='failed',error_code='customer_not_authorized',updated_at=clock_timestamp() WHERE id IN(
    SELECT b.id FROM public.taxi_bot_outbox b WHERE b.tenant_id=p_tenant AND b.waba=p_waba AND b.state='pending' AND NOT public.taxi_bot_recipient_allowed(b.tenant_id,b.waba,b.destination) ORDER BY b.sequence LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  -- Serialise pending messages for a recipient, so a result cannot overtake its summary.
  RETURN QUERY WITH picked AS(SELECT b.id FROM public.taxi_bot_outbox b WHERE b.tenant_id=p_tenant AND b.waba=p_waba AND b.state='pending'AND public.taxi_bot_recipient_allowed(b.tenant_id,b.waba,b.destination)
    AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_outbox older WHERE older.tenant_id=b.tenant_id AND older.waba=b.waba AND older.destination=b.destination AND older.state IN('pending','sending')AND older.sequence<b.sequence)
    ORDER BY b.sequence LIMIT 3 FOR UPDATE SKIP LOCKED)
    UPDATE public.taxi_bot_outbox b SET state='sending',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp()WHERE b.id IN(SELECT id FROM picked)RETURNING b.*;
END $$;
