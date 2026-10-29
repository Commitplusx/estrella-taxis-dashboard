-- Local candidate: authenticated Edge handler is the only public administrative boundary.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER TABLE public.taxi_bot_channels ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0);
ALTER TABLE public.taxi_bot_h3_cells ADD COLUMN label text CHECK(label IS NULL OR length(label)BETWEEN 1 AND 100),
  ADD COLUMN price_cents integer CHECK(price_cents BETWEEN 1 AND 10000000);
-- Local base prices must also support a new cell without modifying the shared catalog.
DO $$DECLARE fk record;BEGIN FOR fk IN SELECT conname FROM pg_constraint WHERE conrelid='public.taxi_bot_h3_cells'::regclass AND confrelid='public.h3_zonas'::regclass LOOP
  EXECUTE format('ALTER TABLE public.taxi_bot_h3_cells DROP CONSTRAINT %I',fk.conname);END LOOP;END $$;
CREATE INDEX taxi_bot_sessions_admin ON public.taxi_bot_sessions(tenant_id,waba,updated_at DESC);
CREATE INDEX viajes_taxi_admin ON public.viajes(tenant_id,bot_waba,created_at DESC)WHERE bot_managed;
CREATE INDEX taxi_bot_outbox_admin ON public.taxi_bot_outbox(tenant_id,waba,destination,created_at DESC);
CREATE TABLE public.taxi_bot_admin_operations(actor bigint NOT NULL,request_id uuid NOT NULL,tenant_id uuid NOT NULL,waba text NOT NULL,
  command jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor,request_id));
ALTER TABLE public.taxi_bot_admin_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_admin_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.taxi_bot_h3_price(p_tenant uuid,p_waba text,p_origin text,p_destination text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE matches integer;amount integer;bad boolean;BEGIN
  IF p_origin IS NULL OR p_destination IS NULL OR p_origin !~ '^8a[0-9a-f]{13}$'OR p_destination !~ '^8a[0-9a-f]{13}$'THEN RAISE EXCEPTION 'invalid taxi H3 cell';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND pricing_mode='h3_zone_max')THEN RETURN jsonb_build_object('state','channel_unavailable','mode','h3_zone_max');END IF;
  SELECT count(*)::integer,max(CASE WHEN s.price_cents IS NOT NULL THEN s.price_cents WHEN z.resolucion=10 AND z.precio::text NOT IN('NaN','Infinity','-Infinity')AND z.precio>0 AND z.precio<=100000 AND z.precio=round(z.precio,2)THEN(z.precio*100)::integer END),
    bool_or(s.price_cents IS NULL AND(z.h3_index IS NULL OR z.resolucion<>10 OR z.precio::text IN('NaN','Infinity','-Infinity')OR z.precio<=0 OR z.precio>100000 OR z.precio<>round(z.precio,2)))
    INTO matches,amount,bad FROM public.taxi_bot_h3_cells s LEFT JOIN public.h3_zonas z USING(h3_index)
    WHERE s.tenant_id=p_tenant AND s.waba=p_waba AND s.h3_index IN(p_origin,p_destination);
  IF bad THEN RETURN jsonb_build_object('state','invalid_zone','mode','h3_zone_max');END IF;
  IF matches<>(CASE WHEN p_origin=p_destination THEN 1 ELSE 2 END)THEN RETURN jsonb_build_object('state','uncovered','mode','h3_zone_max');END IF;
  RETURN jsonb_build_object('state','priced','mode','h3_zone_max','cents',amount,'originCell',p_origin,'destinationCell',p_destination);
END $$;
CREATE OR REPLACE FUNCTION public.taxi_bot_h3_quote(p_tenant uuid,p_waba text,p_origin text,p_destination text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND enabled AND pricing_mode='h3_zone_max')THEN RETURN jsonb_build_object('state','channel_unavailable','mode','h3_zone_max');END IF;
  RETURN public.taxi_bot_h3_price(p_tenant,p_waba,p_origin,p_destination);
END $$;

-- Coverage changes in this panel are rechecked atomically before creating a trip.
CREATE OR REPLACE FUNCTION public.taxi_bot_validate_quote(p_tenant uuid,p_waba text,p_draft jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE mode text;q jsonb;scope jsonb;old_cents integer;channel public.taxi_bot_channels;point jsonb;lat double precision;lng double precision;distance_km double precision;
BEGIN
  SELECT c.* INTO channel FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND c.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi pricing channel unavailable';END IF;
  mode:=channel.pricing_mode;
  FOR point IN SELECT p_draft->'origin' UNION ALL SELECT p_draft->'destination' LOOP
    lat:=(point->>'lat')::double precision;lng:=(point->>'lng')::double precision;
    IF lat IS NULL OR lng IS NULL OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'invalid taxi coordinates';END IF;
    distance_km:=12742*asin(least(1,sqrt(power(sin(radians(lat-channel.center_lat)/2),2)+cos(radians(channel.center_lat))*cos(radians(lat))*power(sin(radians(lng-channel.center_lng)/2),2))));
    IF distance_km>channel.radius_km THEN RAISE EXCEPTION 'taxi coverage changed';END IF;
  END LOOP;
  scope:=p_draft->'quoteH3';
  IF mode='road_distance' THEN
    IF p_draft->>'quoteH3'IS NOT NULL THEN RAISE EXCEPTION 'taxi tariff changed';END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(scope)IS DISTINCT FROM 'object'OR scope->>'originCell'IS NULL OR scope->>'destinationCell'IS NULL THEN RAISE EXCEPTION 'taxi H3 review required';END IF;
  PERFORM s.h3_index FROM public.taxi_bot_h3_cells s WHERE s.tenant_id=p_tenant AND s.waba=p_waba AND s.h3_index IN(scope->>'originCell',scope->>'destinationCell')ORDER BY s.h3_index FOR SHARE;
  PERFORM z.h3_index FROM public.h3_zonas z WHERE z.h3_index IN(scope->>'originCell',scope->>'destinationCell')ORDER BY z.h3_index FOR SHARE;
  q:=public.taxi_bot_h3_quote(p_tenant,p_waba,scope->>'originCell',scope->>'destinationCell');
  old_cents:=(p_draft->>'quoteCents')::integer;
  IF (q->>'state'='priced'AND (q->>'cents')::integer IS NOT DISTINCT FROM old_cents)
    OR(q->>'state'IN('uncovered','invalid_zone')AND old_cents IS NULL)THEN RETURN;END IF;
  RAISE EXCEPTION 'taxi tariff changed';
END $$;

CREATE FUNCTION public.taxi_bot_admin_read(p_tenant uuid,p_waba text,p_view text,p_input jsonb DEFAULT '{}')RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;cap integer;BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba)THEN RAISE EXCEPTION 'taxi admin channel not found';END IF;
  IF p_view='quote'THEN RETURN public.taxi_bot_h3_price(p_tenant,p_waba,p_input->>'originCell',p_input->>'destinationCell');END IF;
  IF p_view='zones'THEN
    IF p_input?'cells'AND(jsonb_typeof(p_input->'cells')<>'array'OR jsonb_array_length(p_input->'cells')>500)THEN RAISE EXCEPTION 'invalid viewport';END IF;
    cap:=CASE WHEN p_input?'cells'THEN 500 ELSE 100 END;
    IF coalesce(p_input->>'source','base')NOT IN('base','catalog')THEN RAISE EXCEPTION 'invalid zone source';END IF;
    WITH available AS(SELECT s.h3_index,coalesce(s.label,z.nombre,'Zona sin nombre')label,
      CASE WHEN s.price_cents IS NOT NULL THEN s.price_cents WHEN z.resolucion=10 AND z.precio::text NOT IN('NaN','Infinity','-Infinity')AND z.precio>0 AND z.precio<=100000 AND z.precio=round(z.precio,2)THEN(z.precio*100)::integer END cents,
      CASE WHEN s.price_cents IS NULL THEN 'catalog'ELSE 'base'END source,true assigned
      FROM public.taxi_bot_h3_cells s LEFT JOIN public.h3_zonas z USING(h3_index)
      WHERE s.tenant_id=p_tenant AND s.waba=p_waba AND coalesce(p_input->>'source','base')='base'
      UNION ALL SELECT z.h3_index,coalesce(z.nombre,'Zona sin nombre'),
      CASE WHEN z.precio::text NOT IN('NaN','Infinity','-Infinity')AND z.precio>0 AND z.precio<=100000 AND z.precio=round(z.precio,2)THEN(z.precio*100)::integer END,
      'catalog',EXISTS(SELECT 1 FROM public.taxi_bot_h3_cells s WHERE s.tenant_id=p_tenant AND s.waba=p_waba AND s.h3_index=z.h3_index)
      FROM public.h3_zonas z WHERE p_input->>'source'='catalog'AND z.resolucion=10 AND z.h3_index~'^8a[0-9a-f]{13}$'),
    rows AS(SELECT *,row_number()OVER(ORDER BY h3_index)n FROM available
      WHERE h3_index>coalesce(p_input->>'after','')
        AND(NOT(p_input?'cells')OR h3_index IN(SELECT jsonb_array_elements_text(p_input->'cells')))
        AND strpos(lower(label),lower(coalesce(p_input->>'search','')))>0
      ORDER BY h3_index LIMIT cap+1)
    SELECT jsonb_build_object('zones',coalesce(jsonb_agg(jsonb_build_object('cell',h3_index,'label',label,'cents',cents,'source',source,'assigned',assigned)ORDER BY h3_index)FILTER(WHERE n<=cap),'[]'),'hasMore',count(*)>cap,
      'totalCells',(SELECT count(*)FROM available),'totalAreas',(SELECT count(DISTINCT label)FROM available))INTO result FROM rows;
    RETURN result;
  END IF;
  IF p_view='operations'THEN
    SELECT jsonb_build_object('sessions',(SELECT coalesce(jsonb_agg(jsonb_build_object('customer',s.customer,'mode',s.mode,'revision',s.revision,'updatedAt',s.updated_at,'history',CASE WHEN p_input?'customer'THEN s.history ELSE '[]'::jsonb END)ORDER BY s.updated_at DESC),'[]')FROM(SELECT * FROM public.taxi_bot_sessions WHERE tenant_id=p_tenant AND waba=p_waba AND updated_at>clock_timestamp()-interval '30 days'AND(NOT(p_input?'customer')OR customer=p_input->>'customer')ORDER BY updated_at DESC LIMIT 50)s),
      'trips',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'customer',t.cliente_tel,'name',t.cliente_nombre,'origin',t.origen,'destination',t.destino,'state',t.estado,'cents',t.bot_quote_cents,'at',t.created_at)ORDER BY t.created_at DESC),'[]')FROM(SELECT * FROM public.viajes WHERE tenant_id=p_tenant AND bot_waba=p_waba AND bot_managed AND created_at>clock_timestamp()-interval '30 days'AND(NOT(p_input?'customer')OR cliente_tel=p_input->>'customer')ORDER BY created_at DESC LIMIT 50)t),
      'deliveries',(SELECT coalesce(jsonb_agg(jsonb_build_object('text',b.body->>'text','state',b.state,'at',b.created_at)ORDER BY b.created_at DESC),'[]')FROM(SELECT * FROM public.taxi_bot_outbox WHERE tenant_id=p_tenant AND waba=p_waba AND destination=p_input->>'customer'ORDER BY created_at DESC LIMIT 10)b))INTO result;
    RETURN result;
  END IF;
  RAISE EXCEPTION 'invalid taxi admin view';
END $$;

CREATE FUNCTION public.taxi_bot_admin_apply(p_tenant uuid,p_waba text,p_actor bigint,p_request uuid,p_expected bigint,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.taxi_bot_channels;s public.taxi_bot_sessions;previous public.taxi_bot_admin_operations;command jsonb;result jsonb;cell text;current_rev bigint;BEGIN
  IF p_actor<=0 OR p_expected<0 OR jsonb_typeof(p_payload)IS DISTINCT FROM 'object'OR octet_length(p_payload::text)>16384 OR p_action NOT IN('configure','upsert_zones','assign_catalog','remove_zones','takeover','resume','send')THEN RAISE EXCEPTION 'invalid admin operation';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,22));
  command:=jsonb_build_object('tenant',p_tenant,'waba',p_waba,'expected',p_expected,'action',p_action,'payload',p_payload);
  SELECT * INTO previous FROM public.taxi_bot_admin_operations WHERE actor=p_actor AND request_id=p_request;
  IF FOUND THEN IF previous.command IS DISTINCT FROM command THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN previous.response;END IF;
  IF p_action IN('takeover','resume','send')THEN
    -- Same lock order as the worker: contact → session → channel. Never channel → contact.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_waba||(p_payload->>'customer'),1));
    SELECT * INTO s FROM public.taxi_bot_sessions WHERE tenant_id=p_tenant AND waba=p_waba AND customer=p_payload->>'customer'FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found');END IF;
    IF s.revision<>p_expected THEN RETURN jsonb_build_object('state','revision_conflict','revision',s.revision);END IF;
    SELECT * INTO c FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba FOR SHARE;
    IF p_action='send'THEN
      IF s.mode<>'human'OR NOT c.enabled OR s.last_source_at IS NULL OR s.last_source_at<clock_timestamp()-interval '24 hours'OR length(coalesce(p_payload->>'text',''))NOT BETWEEN 1 AND 1500 THEN RETURN jsonb_build_object('state','send_forbidden');END IF;
      PERFORM public.taxi_bot_emit(p_tenant,p_waba,s.customer,p_payload->>'text','admin:'||p_actor||':'||p_request);
      UPDATE public.taxi_bot_sessions SET history=(SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]')FROM jsonb_array_elements(history||jsonb_build_array(jsonb_build_object('role','assistant','content',p_payload->>'text')))WITH ORDINALITY x(value,ord)WHERE ord>jsonb_array_length(history)+1-12),revision=revision+1,updated_at=clock_timestamp()WHERE id=s.id;
      result:=jsonb_build_object('state','queued','revision',s.revision+1);
    ELSE
      UPDATE public.taxi_bot_events SET state='pending',lease=NULL WHERE tenant_id=p_tenant AND waba=p_waba AND customer=s.customer AND state='processing';
      UPDATE public.taxi_bot_sessions SET mode=CASE WHEN p_action='takeover'THEN 'human'ELSE 'bot'END,draft=jsonb_set(jsonb_set(draft,'{confirmation}','null'),'{expiresAt}','null'),revision=revision+1,lease=NULL,lease_until=NULL,updated_at=clock_timestamp()WHERE id=s.id;
      result:=jsonb_build_object('state','saved','revision',s.revision+1);
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(p_waba,21));
    SELECT * INTO c FROM public.taxi_bot_channels WHERE waba=p_waba FOR UPDATE;
    IF FOUND AND c.tenant_id<>p_tenant THEN RETURN jsonb_build_object('state','channel_conflict');END IF;
    current_rev:=CASE WHEN FOUND THEN c.revision ELSE 0 END;
    IF current_rev<>p_expected THEN RETURN jsonb_build_object('state','revision_conflict','revision',current_rev);END IF;
    IF p_action='configure'THEN
      IF(p_payload->>'enabled')::boolean AND(NOT EXISTS(SELECT 1 FROM public.conductores WHERE tenant_id=p_tenant AND activo=true)OR(p_payload->>'pricingMode'='h3_zone_max'AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_h3_cells WHERE tenant_id=p_tenant AND waba=p_waba)))THEN RETURN jsonb_build_object('state','activation_incomplete');END IF;
      INSERT INTO public.taxi_bot_channels(tenant_id,waba,name,city,dispatcher,center_lat,center_lng,radius_km,pricing_mode,base_cents,per_km_cents,enabled,revision)
      VALUES(p_tenant,p_waba,p_payload->>'name',p_payload->>'city',p_payload->>'dispatcher',(p_payload->>'centerLat')::double precision,(p_payload->>'centerLng')::double precision,(p_payload->>'radiusKm')::numeric,p_payload->>'pricingMode',(p_payload->>'baseCents')::integer,(p_payload->>'perKmCents')::integer,(p_payload->>'enabled')::boolean,current_rev+1)
      ON CONFLICT(waba)DO UPDATE SET name=EXCLUDED.name,city=EXCLUDED.city,dispatcher=EXCLUDED.dispatcher,center_lat=EXCLUDED.center_lat,center_lng=EXCLUDED.center_lng,radius_km=EXCLUDED.radius_km,pricing_mode=EXCLUDED.pricing_mode,base_cents=EXCLUDED.base_cents,per_km_cents=EXCLUDED.per_km_cents,enabled=EXCLUDED.enabled,revision=EXCLUDED.revision;
    ELSE
      IF c.waba IS NULL THEN RETURN jsonb_build_object('state','not_found');END IF;
      IF jsonb_typeof(p_payload->'cells')IS DISTINCT FROM 'array'OR jsonb_array_length(p_payload->'cells')NOT BETWEEN 1 AND 400 THEN RAISE EXCEPTION 'invalid zone selection';END IF;
      IF p_action='upsert_zones'AND(length(coalesce(p_payload->>'label',''))NOT BETWEEN 1 AND 100 OR(p_payload->>'cents')IS NULL OR(p_payload->>'cents')::integer NOT BETWEEN 1 AND 10000000)THEN RAISE EXCEPTION 'invalid zone price';END IF;
      IF p_action='assign_catalog'THEN
        PERFORM 1 FROM public.h3_zonas WHERE h3_index IN(SELECT jsonb_array_elements_text(p_payload->'cells'))ORDER BY h3_index FOR SHARE;
        IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_payload->'cells')x(cell)LEFT JOIN public.h3_zonas z ON z.h3_index=x.cell
          WHERE z.h3_index IS NULL OR z.resolucion<>10 OR z.precio::text IN('NaN','Infinity','-Infinity')OR z.precio<=0 OR z.precio>100000 OR z.precio<>round(z.precio,2))THEN RETURN jsonb_build_object('state','invalid_catalog');END IF;
      END IF;
      FOR cell IN SELECT jsonb_array_elements_text(p_payload->'cells')ORDER BY 1 LOOP
        IF cell !~ '^8a[0-9a-f]{13}$'THEN RAISE EXCEPTION 'invalid taxi H3 cell';END IF;
        IF p_action='upsert_zones'THEN
          INSERT INTO public.taxi_bot_h3_cells(tenant_id,waba,h3_index,label,price_cents)VALUES(p_tenant,p_waba,cell,p_payload->>'label',(p_payload->>'cents')::integer)
          ON CONFLICT(tenant_id,waba,h3_index)DO UPDATE SET label=EXCLUDED.label,price_cents=EXCLUDED.price_cents;
        ELSIF p_action='assign_catalog'THEN
          INSERT INTO public.taxi_bot_h3_cells(tenant_id,waba,h3_index)VALUES(p_tenant,p_waba,cell)ON CONFLICT(tenant_id,waba,h3_index)DO NOTHING;
        ELSE DELETE FROM public.taxi_bot_h3_cells WHERE tenant_id=p_tenant AND waba=p_waba AND h3_index=cell;END IF;
      END LOOP;
      UPDATE public.taxi_bot_channels SET revision=revision+1 WHERE tenant_id=p_tenant AND waba=p_waba;
    END IF;
    result:=jsonb_build_object('state','saved','revision',current_rev+1);
  END IF;
  INSERT INTO public.taxi_bot_admin_operations(actor,request_id,tenant_id,waba,command,response)VALUES(p_actor,p_request,p_tenant,p_waba,command,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_h3_price(uuid,text,text,text),public.taxi_bot_admin_read(uuid,text,text,jsonb),public.taxi_bot_admin_apply(uuid,text,bigint,uuid,bigint,text,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_h3_price(uuid,text,text,text),public.taxi_bot_admin_read(uuid,text,text,jsonb),public.taxi_bot_admin_apply(uuid,text,bigint,uuid,bigint,text,jsonb)TO service_role;
COMMIT;
