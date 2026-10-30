-- GPS pickup, mandatory server tariff lookup, optional destination and current-button consent.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.taxi_bot_validate_pickup(p_tenant uuid,p_waba text,p_customer text,p_draft jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_draft#>>'{origin,source}' IS DISTINCT FROM 'gps' OR NOT EXISTS(
  SELECT 1 FROM public.taxi_bot_events e WHERE e.tenant_id=p_tenant AND e.waba=p_waba AND e.customer=p_customer
   AND e.message->>'id'=p_draft->>'pickupMessageId' AND e.message->>'type'='location' AND e.state IN('processing','completed')
   AND e.source_at>clock_timestamp()-interval '24 hours'
   AND (e.message#>>'{location,lat}')::double precision=(p_draft#>>'{origin,lat}')::double precision
   AND (e.message#>>'{location,lng}')::double precision=(p_draft#>>'{origin,lng}')::double precision
 ) THEN RAISE EXCEPTION 'taxi verified pickup GPS required'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_pickup_quote(p_tenant uuid,p_waba text,p_origin text,p_destination_reference jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE origin_cents integer;destination_cents integer:=0;locality jsonb;
BEGIN
 IF p_origin IS NULL OR p_origin !~ '^8a[0-9a-f]{13}$' THEN RAISE EXCEPTION 'invalid taxi H3 cell'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND pricing_mode='h3_zone_max' AND enabled) THEN RETURN jsonb_build_object('state','channel_unavailable','mode','h3_zone_max'); END IF;
 SELECT price_cents INTO origin_cents FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant AND h3_index=p_origin;
 IF origin_cents IS NULL THEN RETURN jsonb_build_object('state','uncovered','mode','h3_zone_max'); END IF;
 IF p_destination_reference IS NOT NULL THEN
  IF jsonb_typeof(p_destination_reference) IS DISTINCT FROM 'object' OR octet_length(p_destination_reference::text)>4096 THEN RAISE EXCEPTION 'invalid taxi destination reference'; END IF;
  SELECT value INTO locality FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))
   WHERE value->>'label'=p_destination_reference->>'label' AND value->>'category'=p_destination_reference->>'category';
  IF locality IS NULL OR locality->>'version' IS DISTINCT FROM p_destination_reference->>'version' OR locality->'cents' IS DISTINCT FROM p_destination_reference->'cents' OR locality->'cents'='null'::jsonb THEN RAISE EXCEPTION 'taxi locality changed'; END IF;
  destination_cents:=(locality->>'cents')::integer;
 END IF;
 RETURN jsonb_build_object('state','priced','mode','h3_zone_max','cents',greatest(origin_cents,destination_cents),'originCell',p_origin,'destinationCell',p_origin);
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_phase(p_mode text,p_draft jsonb,p_trip text,p_now timestamptz DEFAULT clock_timestamp())
RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN p_mode='human' THEN 'human' WHEN p_trip='buscando_conductor' THEN 'searching' WHEN p_trip='en_camino' THEN 'en_route'
 WHEN p_draft->>'pendingLocation' IS NOT NULL OR p_draft->>'awaitingLocation'='choice' THEN 'location_role'
 WHEN p_draft->>'origin' IS NULL OR p_draft#>>'{origin,source}' IS DISTINCT FROM 'gps' OR p_draft->>'pickupMessageId' IS NULL OR p_draft->>'awaitingLocation'='origin' THEN 'origin'
 WHEN p_draft->>'awaitingLocation'='destination' THEN 'destination'
 WHEN p_draft->>'name' IS NULL THEN 'name' WHEN p_draft->>'confirmation' IS NULL OR p_draft->>'expiresAt' IS NULL THEN 'ready_for_review'
 WHEN (p_draft->>'expiresAt')::timestamptz>p_now THEN 'review' ELSE 'review_expired' END;
$$;

CREATE OR REPLACE FUNCTION public.taxi_bot_trace_packet_valid(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$DECLARE s jsonb;f text;BEGIN
 IF p IS NULL THEN RETURN true;END IF;
 IF NOT(p?&ARRAY['version','steps','durationMs'])OR jsonb_typeof(p->'durationMs')IS DISTINCT FROM 'number'OR jsonb_typeof(p)IS DISTINCT FROM 'object'OR p->>'version'IS DISTINCT FROM 'taxi-trace-v1'OR octet_length(p::text)>32768 OR jsonb_typeof(p->'steps')IS DISTINCT FROM 'array'OR jsonb_array_length(p->'steps')>12 OR(p->>'durationMs')::numeric NOT BETWEEN 0 AND 120000 THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p)k WHERE k NOT IN('version','steps','phaseBefore','phaseProposed','decision','reason','durationMs','interpretationPrivate'))THEN RETURN false;END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p->'steps')LOOP
  IF NOT(s?&ARRAY['phase','outcome','durationMs','inputHash','outputHash','code'])OR jsonb_typeof(s->'phase')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'outcome')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'inputHash')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'code')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'durationMs')IS DISTINCT FROM 'number'OR jsonb_typeof(s)IS DISTINCT FROM 'object'OR s->>'phase'NOT IN('interpret','resolve','quote','candidates')OR s->>'outcome'NOT IN('ok','error')OR s->>'inputHash'!~'^[0-9a-f]{64}$'OR(s->>'outputHash'IS NOT NULL AND s->>'outputHash'!~'^[0-9a-f]{64}$')OR s->>'code'!~'^[a-z0-9_]{1,80}$'OR(s->>'durationMs')::numeric NOT BETWEEN 0 AND 120000 THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s)k WHERE k NOT IN('phase','outcome','durationMs','inputHash','outputHash','code','intent','fields','resolution','amountCents','candidateCount','model'))THEN RETURN false;END IF;
  IF s?'fields'AND(jsonb_typeof(s->'fields')<>'array'OR jsonb_array_length(s->'fields')>4 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(s->'fields')v WHERE v NOT IN('name','origin','destination','pickupReference')))THEN RETURN false;END IF;
  IF s?'intent'AND s->>'intent'NOT IN('provide','quote','confirm','cancel','status','human','smalltalk','ambiguous')THEN RETURN false;END IF;
  IF s?'resolution'AND s->>'resolution'NOT IN('resolved','ambiguous','unavailable')THEN RETURN false;END IF;
  IF s->>'amountCents'IS NOT NULL AND((s->>'amountCents')::numeric NOT BETWEEN 0 AND 10000000 OR(s->>'amountCents')::numeric<>trunc((s->>'amountCents')::numeric))THEN RETURN false;END IF;
  IF s?'candidateCount'AND(s->>'candidateCount')::numeric NOT BETWEEN 0 AND 10000 THEN RETURN false;END IF;
  IF s?'model'THEN
   IF NOT((s->'model')?&ARRAY['inputTokens','outputTokens','responseHash'])OR jsonb_typeof(s->'model')IS DISTINCT FROM 'object'OR EXISTS(SELECT 1 FROM jsonb_object_keys(s->'model')k WHERE k NOT IN('inputTokens','outputTokens','responseHash'))THEN RETURN false;END IF;
   FOREACH f IN ARRAY ARRAY['inputTokens','outputTokens']LOOP IF s#>>ARRAY['model',f]IS NOT NULL AND((s#>>ARRAY['model',f])::numeric NOT BETWEEN 0 AND 10000000 OR(s#>>ARRAY['model',f])::numeric<>trunc((s#>>ARRAY['model',f])::numeric))THEN RETURN false;END IF;END LOOP;
   IF s#>>'{model,responseHash}'IS NOT NULL AND s#>>'{model,responseHash}'!~'^[0-9a-f]{64}$'THEN RETURN false;END IF;
  END IF;
 END LOOP;
 -- Content is an explicitly private validated interpretation, never chain of thought or a raw provider response.
 IF p->>'interpretationPrivate'IS NOT NULL THEN
  s:=p->'interpretationPrivate';IF jsonb_typeof(s)IS DISTINCT FROM 'object'OR s->>'intent'NOT IN('provide','quote','confirm','cancel','status','human','smalltalk','ambiguous')OR NOT(s?&ARRAY['intent','fields'])OR jsonb_typeof(s->'intent')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'fields')IS DISTINCT FROM 'object'OR EXISTS(SELECT 1 FROM jsonb_object_keys(s)k WHERE k NOT IN('intent','fields'))THEN RETURN false;END IF;
  FOR f IN SELECT jsonb_object_keys(s->'fields')LOOP IF f NOT IN('name','origin','destination','pickupReference')OR jsonb_typeof(s#>ARRAY['fields',f])<>'object'OR jsonb_typeof(s#>ARRAY['fields',f,'value'])IS DISTINCT FROM 'string'OR jsonb_typeof(s#>ARRAY['fields',f,'evidence'])IS DISTINCT FROM 'string'OR length(coalesce(s#>>ARRAY['fields',f,'value'],''))NOT BETWEEN 1 AND 400 OR length(coalesce(s#>>ARRAY['fields',f,'evidence'],''))NOT BETWEEN 1 AND 6000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(s#>ARRAY['fields',f])k WHERE k NOT IN('value','evidence'))THEN RETURN false;END IF;END LOOP;
 END IF;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$;
CREATE OR REPLACE FUNCTION public.taxi_bot_validate_quote(p_tenant uuid, p_waba text, p_draft jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE mode text;q jsonb;scope jsonb;old_cents integer;channel public.taxi_bot_channels;item record;point jsonb;lat double precision;lng double precision;distance_km double precision;area jsonb;locality jsonb;matches integer;expected_cell text;point_source text;
BEGIN
 SELECT c.* INTO channel FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND c.enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'taxi pricing channel unavailable'; END IF;
 mode:=channel.pricing_mode;
 IF p_draft#>>'{origin,source}' IS DISTINCT FROM 'gps' OR p_draft->>'pickupMessageId' IS NULL THEN RAISE EXCEPTION 'taxi pickup GPS required'; END IF;
 IF p_draft->>'fareMode' IS DISTINCT FROM 'quoted' OR jsonb_typeof(p_draft->'quoteCents') IS DISTINCT FROM 'number' OR (p_draft->>'quoteCents')::numeric NOT BETWEEN 1 AND 10000000 THEN RAISE EXCEPTION 'taxi server fare required'; END IF;
 IF p_draft->>'quoteBasis' IS DISTINCT FROM (CASE WHEN p_draft->>'destination' IS NOT NULL OR p_draft->>'destinationArea' IS NOT NULL THEN 'route' ELSE 'pickup' END) THEN RAISE EXCEPTION 'taxi fare basis changed'; END IF;
 IF p_draft->>'originArea' IS NOT NULL OR (p_draft->>'destinationArea' IS NOT NULL AND p_draft->>'destination' IS NOT NULL) THEN RAISE EXCEPTION 'taxi locality clarification required'; END IF;
 IF p_draft ? 'fareMode' AND (jsonb_typeof(p_draft->'fareMode') IS DISTINCT FROM 'string' OR p_draft->>'fareMode' NOT IN('quoted','unquoted')) THEN RAISE EXCEPTION 'invalid taxi fare mode'; END IF;
 scope:=p_draft->'quoteH3';
 FOR item IN SELECT true is_origin,p_draft->'origin' value UNION ALL SELECT false,p_draft->'destination' LOOP
  point:=item.value; IF point IS NULL OR point='null'::jsonb THEN CONTINUE; END IF;area:=point->'area';lat:=(point->>'lat')::double precision;lng:=(point->>'lng')::double precision;
  IF lat IS NULL OR lng IS NULL OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'invalid taxi coordinates'; END IF;
  distance_km:=12742*asin(least(1,sqrt(power(sin(radians(lat-channel.center_lat)/2),2)+cos(radians(channel.center_lat))*cos(radians(lat))*power(sin(radians(lng-channel.center_lng)/2),2))));
  IF distance_km>channel.radius_km THEN RAISE EXCEPTION 'taxi coverage changed'; END IF;
  point_source:=coalesce(point->>'source',CASE WHEN area->>'priceSource'='reference' THEN 'locality' WHEN area->>'priceSource'='h3' THEN 'gps' ELSE 'written' END);
  IF point_source NOT IN('gps','written','locality') THEN RAISE EXCEPTION 'invalid taxi location source'; END IF;
  IF area IS NOT NULL AND jsonb_typeof(area)<>'null' THEN
   IF point_source<>'locality' OR area->>'priceSource'<>'reference' OR area->>'cell' IS NULL OR NOT public.taxi_bot_street_reference(area->>'reference',area->>'label')
    OR left(coalesce(point->>'text',''),17)='Zona aproximada: ' OR position(coalesce(area->>'reference','') IN coalesce(point->>'text',''))=0
   THEN RAISE EXCEPTION 'taxi locality reference required'; END IF;
   IF jsonb_typeof(scope)='object' THEN
    expected_cell:=CASE WHEN item.is_origin THEN scope->>'originCell' ELSE scope->>'destinationCell' END;
    IF area->>'cell' IS DISTINCT FROM expected_cell THEN RAISE EXCEPTION 'taxi locality coordinate changed'; END IF;
   END IF;
   PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant::text,56));
   SELECT count(*) INTO matches FROM public.taxi_bot_localities WHERE tenant_id=p_tenant AND label=area->>'label' AND ((area->>'category') IS NULL OR category=area->>'category');
   IF matches<>1 THEN RAISE EXCEPTION 'taxi locality category required'; END IF;
   SELECT value INTO locality FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))
    WHERE value->>'label'=area->>'label' AND ((area->>'category') IS NULL OR value->>'category'=area->>'category');
   IF locality IS NULL OR locality->>'version' IS DISTINCT FROM area->>'version' OR locality->'cents' IS DISTINCT FROM area->'cents'
    OR locality->'cents'='null'::jsonb THEN RAISE EXCEPTION 'taxi locality changed'; END IF;
  ELSIF point_source='locality' THEN RAISE EXCEPTION 'taxi locality fare missing';
  END IF;
  IF coalesce(p_draft->>'fareMode','quoted')<>'unquoted' AND point_source='written' THEN RAISE EXCEPTION 'written taxi address needs a locality fare or an unquoted request'; END IF;
 END LOOP;
 IF mode='road_distance' THEN
  IF p_draft->>'quoteH3' IS NOT NULL THEN RAISE EXCEPTION 'taxi tariff changed'; END IF;
  IF p_draft->>'destination' IS NULL AND ((p_draft->>'quoteCents')::integer IS DISTINCT FROM channel.base_cents OR p_draft->>'destinationArea' IS NOT NULL) THEN RAISE EXCEPTION 'taxi pickup tariff changed'; END IF;
  RETURN;
 END IF;
 IF jsonb_typeof(scope) IS DISTINCT FROM 'object' OR scope->>'originCell' IS NULL OR scope->>'destinationCell' IS NULL THEN RAISE EXCEPTION 'taxi H3 review required'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant::text,56));
 PERFORM z.h3_index FROM public.taxi_bot_base_zones z WHERE z.tenant_id=p_tenant AND z.h3_index IN(scope->>'originCell',scope->>'destinationCell') ORDER BY z.h3_index FOR SHARE;
 IF p_draft->>'destination' IS NULL THEN
  IF scope->>'destinationCell' IS DISTINCT FROM scope->>'originCell' THEN RAISE EXCEPTION 'taxi pickup quote scope changed'; END IF;
  q:=public.taxi_bot_pickup_quote(p_tenant,p_waba,scope->>'originCell',NULLIF(p_draft->'destinationArea','null'::jsonb));
 ELSE
 q:=public.taxi_bot_h3_quote_with_references(p_tenant,p_waba,scope->>'originCell',scope->>'destinationCell',
  CASE WHEN p_draft#>>'{origin,area,priceSource}'='reference' THEN p_draft#>'{origin,area}' ELSE NULL END,
  CASE WHEN p_draft#>>'{destination,area,priceSource}'='reference' THEN p_draft#>'{destination,area}' ELSE NULL END);
 END IF; old_cents:=(p_draft->>'quoteCents')::integer;
 IF (q->>'state'='priced' AND (q->>'cents')::integer IS NOT DISTINCT FROM old_cents) THEN RETURN; END IF;
 RAISE EXCEPTION 'taxi tariff changed';
END $function$;
CREATE OR REPLACE FUNCTION public.taxi_bot_commit(p_event uuid, p_lease uuid, p_revision bigint, p_decision jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
    IF e.state IS DISTINCT FROM 'processing' OR e.message->>'type' IS DISTINCT FROM 'button'
      OR e.message->>'button' IS DISTINCT FROM 'txc_'||(s.draft->>'confirmation')
      OR (SELECT count(*) FROM public.taxi_bot_events WHERE lease=p_lease AND state='processing')<>1
    THEN RAISE EXCEPTION 'taxi current confirmation button required'; END IF;
    PERFORM public.taxi_bot_validate_pickup(e.tenant_id,e.waba,e.customer,s.draft);
    IF s.mode<>'bot' OR s.draft->>'confirmation' IS NULL OR s.draft->>'confirmation'IS DISTINCT FROM p_decision->>'confirmation'OR coalesce((s.draft->>'expiresAt')::timestamptz<=clock_timestamp(),true)
      OR s.draft->>'awaitingLocation'IS NOT NULL OR s.draft->>'pendingLocation'IS NOT NULL
      OR length(coalesce(s.draft->>'name',''))NOT BETWEEN 2 AND 80 OR coalesce(jsonb_typeof(s.draft->'origin'),'null')<>'object'OR (s.draft->>'destination' IS NOT NULL AND jsonb_typeof(s.draft->'destination')<>'object') THEN RAISE EXCEPTION 'taxi confirmation not current';END IF;
    -- Companion H3 migration must be installed before activating this local candidate.
    PERFORM public.taxi_bot_validate_quote(e.tenant_id,e.waba,s.draft);
    IF EXISTS(SELECT 1 FROM public.viajes WHERE tenant_id=e.tenant_id AND cliente_tel=e.customer AND estado IN('buscando_conductor','en_camino'))THEN RAISE EXCEPTION 'customer already has an active trip';END IF;
    tid:=gen_random_uuid();token:=replace(gen_random_uuid()::text,'-','');
    INSERT INTO public.viajes(id,token,tenant_id,cliente_tel,cliente_nombre,origen,destino,origen_lat,origen_lng,estado,conductores_contactados,bot_managed,bot_waba,bot_request_id,bot_quote_cents,bot_quote_h3,bot_origin_area,bot_destination_area)
      VALUES(tid,token,e.tenant_id,e.customer,s.draft->>'name',(s.draft#>>'{origin,text}')||CASE WHEN s.draft->>'pickupText' IS NULL THEN '' ELSE E'\nReferencia: '||(s.draft->>'pickupText') END,coalesce(s.draft#>>'{destination,text}',s.draft->>'destinationText',s.draft#>>'{destinationArea,label}','Destino por indicar al conductor'),(s.draft#>>'{origin,lat}')::double precision,(s.draft#>>'{origin,lng}')::double precision,'buscando_conductor','{}',true,e.waba,e.id,(s.draft->>'quoteCents')::integer,NULLIF(s.draft->'quoteH3','null'::jsonb),NULLIF(s.draft#>'{origin,area}','null'::jsonb),coalesce(NULLIF(s.draft#>'{destination,area}','null'::jsonb),NULLIF(s.draft->'destinationArea','null'::jsonb)));
    IF jsonb_typeof(p_decision->'candidates')<>'array'OR jsonb_array_length(p_decision->'candidates')>3 THEN RAISE EXCEPTION 'invalid candidate limit';END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_decision->'candidates') LOOP
      SELECT * INTO driver FROM public.conductores WHERE tenant_id=e.tenant_id AND device_id=(item->>'deviceId')::integer AND activo=true;
      IF NOT FOUND OR EXISTS(SELECT 1 FROM public.viajes WHERE device_id=driver.device_id AND estado='en_camino')THEN CONTINUE;END IF;
      IF '+'||regexp_replace(driver.telefono_whatsapp,'\D','','g') !~ '^\+[1-9][0-9]{7,14}$'THEN CONTINUE;END IF;
      INSERT INTO public.taxi_bot_offers(tenant_id,waba,trip_id,device_id,driver_phone,driver_name)VALUES(e.tenant_id,e.waba,tid,driver.device_id,'+'||regexp_replace(driver.telefono_whatsapp,'\D','','g'),driver.nombre)ON CONFLICT DO NOTHING RETURNING * INTO o;
      IF NOT FOUND THEN CONTINUE;END IF;count_offers:=count_offers+1;
      UPDATE public.viajes SET conductores_contactados=array_append(conductores_contactados,driver.device_id)WHERE id=tid;
      PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,o.driver_phone,'🚕 ¿Puedes tomar este viaje?'||E'\nRecogida: '||((s.draft#>>'{origin,text}')||CASE WHEN s.draft->>'pickupText' IS NULL THEN '' ELSE E'\nReferencia: '||(s.draft->>'pickupText') END)||E'\nDestino: '||(coalesce(s.draft#>>'{destination,text}',s.draft->>'destinationText',s.draft#>>'{destinationArea,label}','Destino por indicar al conductor'))||E'\nTarifa: '||CASE WHEN s.draft->>'quoteCents'IS NULL THEN 'por confirmar con la base' ELSE '$'||((s.draft->>'quoteCents')::numeric/100)::text||' MXN'END,
        'offer:'||o.id,jsonb_build_array(jsonb_build_object('id','txa_'||o.id,'title','Aceptar viaje'),jsonb_build_object('id','txr_'||o.id,'title','No puedo')));
    END LOOP;
    reply:=CASE WHEN count_offers>0 THEN '🚕 Tu solicitud quedó registrada. Estamos buscando quién puede ir por ti; aún no hay unidad confirmada.'ELSE '🚕 Tu solicitud quedó registrada, pero todavía no hay unidad disponible para ofrecerla. La base debe revisarla.'END;
    PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,reply,'trip-created:'||tid);
    IF c.dispatcher IS NOT NULL THEN PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,c.dispatcher,'Solicitud de taxi pendiente.'||E'\nPasajero: '||(s.draft->>'name')||E'\nContacto: '||e.customer||E'\nRecogida: '||((s.draft#>>'{origin,text}')||CASE WHEN s.draft->>'pickupText' IS NULL THEN '' ELSE E'\nReferencia: '||(s.draft->>'pickupText') END)||E'\nDestino: '||(coalesce(s.draft#>>'{destination,text}',s.draft->>'destinationText',s.draft#>>'{destinationArea,label}','Destino por indicar al conductor'))||E'\nOfertas creadas: '||count_offers,'dispatch:'||tid);END IF;
    d:='{"name":null,"origin":null,"destination":null,"quoteCents":null,"confirmation":null,"expiresAt":null,"awaitingLocation":null,"pendingLocation":null,"quoteH3":null}'::jsonb;
  ELSIF a='cancel' THEN
    SELECT * INTO t FROM public.viajes WHERE id=(p_decision->>'tripId')::uuid AND tenant_id=e.tenant_id AND cliente_tel=e.customer AND bot_waba=e.waba AND bot_managed FOR UPDATE;
    IF NOT FOUND OR t.estado NOT IN('buscando_conductor','en_camino')THEN reply:='Ese viaje ya no está activo. No cambié ninguna otra solicitud.';
    ELSE
      UPDATE public.viajes SET estado='cancelado',updated_at=clock_timestamp()WHERE id=t.id;
      UPDATE public.taxi_bot_offers SET state='revoked'WHERE trip_id=t.id AND state IN('offered','accepted');
      FOR o IN SELECT * FROM public.taxi_bot_offers WHERE trip_id=t.id AND device_id=t.device_id LOOP
        PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,o.driver_phone,'El pasajero canceló este viaje. Ya no te dirijas al punto.','cancel-driver:'||t.id);
      END LOOP;reply:='Tu viaje quedó cancelado. Si necesitas otro taxi, aquí estoy. 🙂';
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
          PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,t.cliente_tel,'🚕 La unidad '||o.driver_name||' aceptó tu viaje. Te avisamos si hay algún cambio. 😊','trip-assigned:'||t.id);
          PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,'🚕 Viaje asignado a tu unidad.'||E'\nPasajero: '||t.cliente_nombre||E'\nContacto: '||t.cliente_tel||E'\nRecogida: '||t.origen||E'\nDestino: '||t.destino,'driver-assigned:'||t.id,jsonb_build_array(jsonb_build_object('id','txf_'||o.id,'title','Finalizar viaje')));
        END IF;
      ELSIF a='driver_reject'AND t.estado='buscando_conductor'AND o.state='offered'THEN
        UPDATE public.taxi_bot_offers SET state='rejected'WHERE id=o.id;reply:='Registré que no puedes tomar ese viaje.';
        IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE trip_id=t.id AND state='offered'AND expires_at>clock_timestamp())AND c.dispatcher IS NOT NULL THEN PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,c.dispatcher,'Las ofertas del viaje '||t.id||' quedaron sin aceptación. Revisa la solicitud en la base.','no-offers:'||t.id);END IF;
      ELSIF a='driver_finish'AND t.estado='en_camino'AND t.device_id=o.device_id AND o.state='accepted'THEN
        UPDATE public.viajes SET estado='completado',updated_at=clock_timestamp()WHERE id=t.id;
        UPDATE public.taxi_bot_offers SET state='finished'WHERE id=o.id;reply:='Viaje marcado como finalizado.';
        PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,t.cliente_tel,'🚕 Viaje finalizado. ¡Gracias por viajar con nosotros! 😊','trip-finished:'||t.id);
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
      IF a='draft' AND d->>'confirmation' IS NOT NULL THEN
        PERFORM public.taxi_bot_validate_pickup(e.tenant_id,e.waba,e.customer,d);
        PERFORM public.taxi_bot_validate_quote(e.tenant_id,e.waba,d);
      END IF;
      IF d->>'confirmation'IS NOT NULL AND (d->>'awaitingLocation'IS NOT NULL OR d->>'pendingLocation'IS NOT NULL OR d->>'expiresAt'IS NULL
        OR(d->>'expiresAt')::timestamptz>clock_timestamp()+interval '11 minutes'OR(d->>'expiresAt')::timestamptz<=clock_timestamp())THEN RAISE EXCEPTION 'invalid summary state or expiry';END IF;
    ELSE d:=s.draft;END IF;
    IF jsonb_typeof(p_decision->'messages')<>'array'OR jsonb_array_length(p_decision->'messages')>3 THEN RAISE EXCEPTION 'invalid output count';END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_decision->'messages')LOOP
      IF item->>'to'IS DISTINCT FROM e.customer THEN RAISE EXCEPTION 'reply recipient is not the current customer';END IF;
      IF item ? 'locationRequest' THEN
        IF jsonb_typeof(item->'locationRequest') IS DISTINCT FROM 'string' OR item->>'locationRequest' NOT IN('origin','destination')
          OR a<>'draft' OR s.mode<>'bot' OR d->>'awaitingLocation' IS DISTINCT FROM item->>'locationRequest'
          OR d->>'pendingLocation' IS NOT NULL OR d->>'confirmation' IS NOT NULL
          OR length(coalesce(item->>'text',''))>1024
          OR (item->'buttons' IS NOT NULL AND item->'buttons'<>'null'::jsonb AND item->'buttons'<>'[]'::jsonb)
          OR EXISTS(SELECT 1 FROM public.viajes WHERE tenant_id=e.tenant_id AND bot_waba=e.waba AND cliente_tel=e.customer AND estado IN('buscando_conductor','en_camino'))
          THEN RAISE EXCEPTION 'invalid location request';END IF;
      END IF;
      idx:=idx+1;PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,item->>'text','reply:'||e.id||':'||idx,CASE WHEN jsonb_typeof(item->'buttons')='array'THEN item->'buttons'ELSE NULL END);
      IF item ? 'locationRequest' THEN
        UPDATE public.taxi_bot_outbox SET body=body||jsonb_build_object('locationRequest',item->>'locationRequest','locationRevision',p_revision+1)
          WHERE dedupe_key='reply:'||e.id||':'||idx AND tenant_id=e.tenant_id AND waba=e.waba AND destination=e.customer;
      END IF;
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
END $function$;

REVOKE ALL ON FUNCTION public.taxi_bot_validate_pickup(uuid,text,text,jsonb),public.taxi_bot_pickup_quote(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_validate_pickup(uuid,text,text,jsonb),public.taxi_bot_pickup_quote(uuid,text,text,jsonb) TO service_role;
COMMIT;
