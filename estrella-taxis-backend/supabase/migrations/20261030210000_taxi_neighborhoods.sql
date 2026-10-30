-- Neighborhood names/aliases describe existing base-owned H3 cells; no second tariff catalog.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.taxi_bot_neighborhoods(
 tenant_id uuid NOT NULL REFERENCES public.empresas(id),label text NOT NULL CHECK(length(label)BETWEEN 1 AND 100),
 aliases text[]NOT NULL DEFAULT '{}'CHECK(cardinality(aliases)<=12),description text NOT NULL DEFAULT ''CHECK(length(description)<=500),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by bigint,PRIMARY KEY(tenant_id,label)
);
CREATE TABLE public.taxi_bot_neighborhood_operations(actor bigint NOT NULL,request_id uuid NOT NULL,command jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor,request_id));
ALTER TABLE public.taxi_bot_neighborhoods ENABLE ROW LEVEL SECURITY;ALTER TABLE public.taxi_bot_neighborhood_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_neighborhoods,public.taxi_bot_neighborhood_operations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.taxi_bot_neighborhood_key(p_text text)RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT regexp_replace(btrim(regexp_replace(regexp_replace(translate(lower(p_text),'áéíóúüñ','aeiouun'),'[^a-z0-9 ]',' ','g'),'\s+',' ','g')),'^((el|la|los|las|colonia|col|barrio) +)+','')
$$;
CREATE FUNCTION public.taxi_bot_street_reference(p_reference text,p_label text)RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT length(p_reference)BETWEEN 6 AND 260
  AND public.taxi_bot_neighborhood_key(p_reference)<>public.taxi_bot_neighborhood_key(p_label)
  AND public.taxi_bot_neighborhood_key(p_reference)!~'^(si|si claro|va|sale|ok|okay|gracias|ahi|por ahi|aqui|por aqui|mandalo|de acuerdo|listo|adelante)$'
  AND public.taxi_bot_neighborhood_key(p_reference)~'\m(calle|avenida|av|privada|carretera|numero|num|frente|junto|cerca|lado|esquina|atras|detras|costado|sobre|pasando|casa|local|tienda|farmacia|escuela|iglesia|parque|puerta|porton|entrada|salida|entre|oxxo|mercado|cancha|plaza|hospital|clinica)\M'
  AND p_reference!~'[[:cntrl:]<>]|https?://'
$$;
CREATE FUNCTION public.taxi_bot_neighborhood_read(p_tenant uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 IF (SELECT count(*)FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant)>5000 OR (SELECT count(DISTINCT label)FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant)>250 THEN RAISE EXCEPTION 'neighborhood catalog limit';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('label',g.label,'aliases',coalesce(n.aliases,'{}'::text[]),'description',coalesce(n.description,''),'minCents',g.low,'maxCents',g.high,'cents',CASE WHEN g.priced=g.total AND g.low=g.high THEN g.low ELSE NULL END,'cells',g.cells,'version',md5(g.label||g.signature||coalesce(n.aliases::text,'{}')||coalesce(n.description,'')))ORDER BY g.label),'[]')INTO result FROM(
  SELECT label,count(*)total,count(price_cents)priced,min(price_cents)low,max(price_cents)high,jsonb_agg(h3_index ORDER BY h3_index)cells,string_agg(h3_index||':'||coalesce(price_cents::text,'pending'),','ORDER BY h3_index)signature FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant GROUP BY label
 )g LEFT JOIN public.taxi_bot_neighborhoods n ON n.tenant_id=p_tenant AND n.label=g.label;
 RETURN result;
END $$;
CREATE FUNCTION public.taxi_bot_neighborhood_apply(p_tenant uuid,p_actor bigint,p_request uuid,p_label text,p_expected text,p_payload jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.taxi_bot_neighborhood_operations;command jsonb;rows jsonb;current_row jsonb;new_label text;alias_values text[];result jsonb;BEGIN
 IF p_actor IS NULL OR p_actor<=0 OR p_request IS NULL OR p_label IS NULL OR length(p_label)NOT BETWEEN 1 AND 100 OR p_expected IS NULL OR p_expected!~'^[a-f0-9]{32}$'OR jsonb_typeof(p_payload)IS DISTINCT FROM 'object'OR octet_length(p_payload::text)>4096 THEN RAISE EXCEPTION 'invalid neighborhood update';END IF;
 IF jsonb_typeof(p_payload->'label')IS DISTINCT FROM 'string'OR jsonb_typeof(p_payload->'description')IS DISTINCT FROM 'string'OR jsonb_typeof(p_payload->'cents')IS DISTINCT FROM 'number'OR (p_payload->>'cents')::numeric<>trunc((p_payload->>'cents')::numeric)OR jsonb_typeof(p_payload->'aliases')IS DISTINCT FROM 'array'OR jsonb_array_length(p_payload->'aliases')>12 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'aliases')a WHERE jsonb_typeof(a)<>'string'OR length(btrim(a#>>'{}'))NOT BETWEEN 1 AND 100)OR coalesce(length(p_payload->>'description'),501)>500 OR coalesce(length(btrim(p_payload->>'label')),0)NOT BETWEEN 1 AND 100 OR coalesce((p_payload->>'cents')::integer,0)NOT BETWEEN 1 AND 10000000 THEN RAISE EXCEPTION 'invalid neighborhood fields';END IF;
 new_label:=btrim(p_payload->>'label');SELECT coalesce(array_agg(btrim(value)),'{}')INTO alias_values FROM jsonb_array_elements_text(p_payload->'aliases');
 IF (SELECT count(DISTINCT public.taxi_bot_neighborhood_key(a))FROM unnest(alias_values)a)<>cardinality(alias_values)OR EXISTS(SELECT 1 FROM unnest(alias_values)a WHERE public.taxi_bot_neighborhood_key(a)='')THEN RAISE EXCEPTION 'invalid neighborhood aliases';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,61));
 command:=jsonb_build_array(p_tenant,p_label,p_expected,p_payload);SELECT * INTO old FROM public.taxi_bot_neighborhood_operations WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF old.command IS DISTINCT FROM command THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN old.response;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text,56));
 rows:=public.taxi_bot_neighborhood_read(p_tenant);SELECT value INTO current_row FROM jsonb_array_elements(rows)WHERE value->>'label'=p_label;
 IF current_row IS NULL THEN RETURN jsonb_build_object('state','not_found');END IF;
 IF current_row->>'version'<>p_expected THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
 IF new_label<>p_label AND EXISTS(SELECT 1 FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant AND public.taxi_bot_neighborhood_key(label)=public.taxi_bot_neighborhood_key(new_label))THEN RETURN jsonb_build_object('state','name_conflict');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows)r WHERE r->>'label'<>p_label AND EXISTS(SELECT 1 FROM unnest(alias_values||ARRAY[new_label])candidate WHERE public.taxi_bot_neighborhood_key(candidate)=public.taxi_bot_neighborhood_key(r->>'label')OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(r->'aliases')a WHERE public.taxi_bot_neighborhood_key(candidate)=public.taxi_bot_neighborhood_key(a))))THEN RETURN jsonb_build_object('state','alias_conflict');END IF;
 UPDATE public.taxi_bot_base_zones SET label=new_label,price_cents=(p_payload->>'cents')::integer WHERE tenant_id=p_tenant AND label=p_label;
 IF new_label<>p_label THEN DELETE FROM public.taxi_bot_neighborhoods WHERE tenant_id=p_tenant AND label=p_label;END IF;
 INSERT INTO public.taxi_bot_neighborhoods(tenant_id,label,aliases,description,updated_by)VALUES(p_tenant,new_label,alias_values,p_payload->>'description',p_actor)ON CONFLICT(tenant_id,label)DO UPDATE SET aliases=excluded.aliases,description=excluded.description,updated_at=clock_timestamp(),updated_by=excluded.updated_by;
 SELECT value INTO current_row FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))WHERE value->>'label'=new_label;
 result:=jsonb_build_object('state','saved','neighborhood',current_row);INSERT INTO public.taxi_bot_neighborhood_operations(actor,request_id,command,response)VALUES(p_actor,p_request,command,result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_neighborhood_key(text),public.taxi_bot_street_reference(text,text),public.taxi_bot_neighborhood_read(uuid),public.taxi_bot_neighborhood_apply(uuid,bigint,uuid,text,text,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_street_reference(text,text),public.taxi_bot_neighborhood_read(uuid),public.taxi_bot_neighborhood_apply(uuid,bigint,uuid,text,text,jsonb)TO service_role;
CREATE OR REPLACE FUNCTION public.taxi_bot_validate_quote(p_tenant uuid,p_waba text,p_draft jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE mode text;q jsonb;scope jsonb;old_cents integer;channel public.taxi_bot_channels;point jsonb;lat double precision;lng double precision;distance_km double precision;area jsonb;zone jsonb;
BEGIN
  SELECT c.* INTO channel FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND c.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi pricing channel unavailable';END IF;
  mode:=channel.pricing_mode;
  IF p_draft->>'originArea'IS NOT NULL OR p_draft->>'destinationArea'IS NOT NULL THEN RAISE EXCEPTION 'taxi neighborhood reference required';END IF;
  IF p_draft#>>'{origin,area}'IS NOT NULL OR p_draft#>>'{destination,area}'IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant::text,56));END IF;
  FOR point IN SELECT p_draft->'origin' UNION ALL SELECT p_draft->'destination' LOOP
    area:=point->'area';
    IF point->>'area'IS NOT NULL THEN
      IF jsonb_typeof(area)IS DISTINCT FROM 'object'OR jsonb_typeof(area->'reference')IS DISTINCT FROM 'string'OR NOT public.taxi_bot_street_reference(area->>'reference',area->>'label')OR left(point->>'text',17)<>'Zona aproximada: 'OR position(area->>'reference'IN point->>'text')=0 THEN RAISE EXCEPTION 'taxi neighborhood reference required';END IF;
      SELECT value INTO zone FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))WHERE value->>'label'=area->>'label';
      IF zone IS NULL OR zone->>'version'IS DISTINCT FROM area->>'version'OR NOT(zone->'cells' ? (area->>'cell'))OR zone->'cents'IS DISTINCT FROM area->'cents' THEN RAISE EXCEPTION 'taxi neighborhood changed';END IF;
    END IF;
    lat:=(point->>'lat')::double precision;lng:=(point->>'lng')::double precision;
    IF lat IS NULL OR lng IS NULL OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'invalid taxi coordinates';END IF;
    distance_km:=12742*asin(least(1,sqrt(power(sin(radians(lat-channel.center_lat)/2),2)+cos(radians(channel.center_lat))*cos(radians(lat))*power(sin(radians(lng-channel.center_lng)/2),2))));
    IF distance_km>channel.radius_km THEN RAISE EXCEPTION 'taxi coverage changed';END IF;
  END LOOP;
  IF p_draft ? 'fareMode' AND (jsonb_typeof(p_draft->'fareMode') IS DISTINCT FROM 'string' OR p_draft->>'fareMode' NOT IN('quoted','unquoted')) THEN RAISE EXCEPTION 'invalid taxi fare mode';END IF;
  -- No price was offered to this passenger. Location/tenant/channel checks above still apply.
  IF p_draft->>'fareMode'='unquoted' THEN
    IF p_draft->>'quoteCents' IS NOT NULL OR p_draft->>'quoteH3' IS NOT NULL THEN RAISE EXCEPTION 'unquoted taxi cannot contain a fare';END IF;
    RETURN;
  END IF;
  scope:=p_draft->'quoteH3';
  IF mode='road_distance' THEN
    IF p_draft->>'quoteH3'IS NOT NULL THEN RAISE EXCEPTION 'taxi tariff changed';END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(scope)IS DISTINCT FROM 'object'OR scope->>'originCell'IS NULL OR scope->>'destinationCell'IS NULL THEN RAISE EXCEPTION 'taxi H3 review required';END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant::text,56));
  PERFORM z.h3_index FROM public.taxi_bot_base_zones z WHERE z.tenant_id=p_tenant AND z.h3_index IN(scope->>'originCell',scope->>'destinationCell')ORDER BY z.h3_index FOR SHARE;
  q:=public.taxi_bot_h3_quote(p_tenant,p_waba,scope->>'originCell',scope->>'destinationCell');
  old_cents:=(p_draft->>'quoteCents')::integer;
  IF (q->>'state'='priced'AND (q->>'cents')::integer IS NOT DISTINCT FROM old_cents)
    OR(q->>'state'IN('uncovered','invalid_zone')AND old_cents IS NULL)THEN RETURN;END IF;
  RAISE EXCEPTION 'taxi tariff changed';
END $$;

ALTER TABLE public.viajes ADD COLUMN bot_origin_area jsonb,ADD COLUMN bot_destination_area jsonb;
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
    INSERT INTO public.viajes(id,token,tenant_id,cliente_tel,cliente_nombre,origen,destino,origen_lat,origen_lng,estado,conductores_contactados,bot_managed,bot_waba,bot_request_id,bot_quote_cents,bot_quote_h3,bot_origin_area,bot_destination_area)
      VALUES(tid,token,e.tenant_id,e.customer,s.draft->>'name',s.draft#>>'{origin,text}',s.draft#>>'{destination,text}',(s.draft#>>'{origin,lat}')::double precision,(s.draft#>>'{origin,lng}')::double precision,'buscando_conductor','{}',true,e.waba,e.id,(s.draft->>'quoteCents')::integer,NULLIF(s.draft->'quoteH3','null'::jsonb),NULLIF(s.draft#>'{origin,area}','null'::jsonb),NULLIF(s.draft#>'{destination,area}','null'::jsonb));
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
END $$;
COMMIT;
