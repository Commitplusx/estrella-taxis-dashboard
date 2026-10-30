-- Store locality fares from the approved paper list while keeping H3 coverage base-owned.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.taxi_bot_neighborhoods
  ADD COLUMN IF NOT EXISTS reference_price_cents integer CHECK(reference_price_cents BETWEEN 1 AND 10000000);

CREATE OR REPLACE FUNCTION public.taxi_bot_neighborhood_read(p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF (SELECT count(*)FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant)>5000
  OR (SELECT count(DISTINCT label)FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant)
   +(SELECT count(*)FROM public.taxi_bot_neighborhoods n WHERE tenant_id=p_tenant AND reference_price_cents IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_base_zones z WHERE z.tenant_id=n.tenant_id AND z.label=n.label))>250 THEN
   RAISE EXCEPTION 'neighborhood catalog limit';
 END IF;
 WITH grouped AS(
  SELECT label,count(*)total,count(price_cents)priced,min(price_cents)low,max(price_cents)high,
   jsonb_agg(h3_index ORDER BY h3_index)cells,
   string_agg(h3_index||':'||coalesce(price_cents::text,'pending'),','ORDER BY h3_index)signature
  FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant GROUP BY label
 ), rows AS(
  SELECT g.label sort_label,jsonb_build_object('label',g.label,'aliases',coalesce(n.aliases,'{}'::text[]),
   'description',coalesce(n.description,''),'minCents',g.low,'maxCents',g.high,
   'cents',CASE WHEN g.priced=g.total AND g.low=g.high THEN g.low ELSE NULL END,'cells',g.cells,
   'priceSource','h3','version',md5(g.label||g.signature||coalesce(n.aliases::text,'{}')||coalesce(n.description,'')||coalesce(n.reference_price_cents::text,''))) item
  FROM grouped g LEFT JOIN public.taxi_bot_neighborhoods n ON n.tenant_id=p_tenant AND n.label=g.label
  UNION ALL
  SELECT n.label sort_label,jsonb_build_object('label',n.label,'aliases',n.aliases,'description',n.description,
   'minCents',n.reference_price_cents,'maxCents',n.reference_price_cents,'cents',n.reference_price_cents,
   'cells','[]'::jsonb,'priceSource','reference',
   'version',md5(n.label||'reference:'||n.reference_price_cents::text||coalesce(n.aliases::text,'{}')||n.description)) item
  FROM public.taxi_bot_neighborhoods n
  WHERE n.tenant_id=p_tenant AND n.reference_price_cents IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_base_zones z WHERE z.tenant_id=n.tenant_id AND z.label=n.label)
 )
 SELECT coalesce(jsonb_agg(item ORDER BY sort_label),'[]') INTO result FROM rows;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_neighborhood_apply(p_tenant uuid,p_actor bigint,p_request uuid,p_label text,p_expected text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.taxi_bot_neighborhood_operations;command jsonb;rows jsonb;current_row jsonb;new_label text;alias_values text[];result jsonb;new_cents integer;
BEGIN
 IF p_actor IS NULL OR p_actor<=0 OR p_request IS NULL OR p_label IS NULL OR length(p_label)NOT BETWEEN 1 AND 100 OR p_expected IS NULL OR p_expected!~'^[a-f0-9]{32}$'OR jsonb_typeof(p_payload)IS DISTINCT FROM 'object'OR octet_length(p_payload::text)>4096 THEN RAISE EXCEPTION 'invalid neighborhood update';END IF;
 IF jsonb_typeof(p_payload->'label')IS DISTINCT FROM 'string'OR jsonb_typeof(p_payload->'description')IS DISTINCT FROM 'string'OR jsonb_typeof(p_payload->'cents')IS DISTINCT FROM 'number'OR (p_payload->>'cents')::numeric<>trunc((p_payload->>'cents')::numeric)OR jsonb_typeof(p_payload->'aliases')IS DISTINCT FROM 'array'OR jsonb_array_length(p_payload->'aliases')>12 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'aliases')a WHERE jsonb_typeof(a)<>'string'OR length(btrim(a#>>'{}'))NOT BETWEEN 1 AND 100)OR coalesce(length(p_payload->>'description'),501)>500 OR coalesce(length(btrim(p_payload->>'label')),0)NOT BETWEEN 1 AND 100 OR coalesce((p_payload->>'cents')::integer,0)NOT BETWEEN 1 AND 10000000 THEN RAISE EXCEPTION 'invalid neighborhood fields';END IF;
 new_label:=btrim(p_payload->>'label');new_cents:=(p_payload->>'cents')::integer;
 SELECT coalesce(array_agg(btrim(value)),'{}')INTO alias_values FROM jsonb_array_elements_text(p_payload->'aliases');
 IF (SELECT count(DISTINCT public.taxi_bot_neighborhood_key(a))FROM unnest(alias_values)a)<>cardinality(alias_values)OR EXISTS(SELECT 1 FROM unnest(alias_values)a WHERE public.taxi_bot_neighborhood_key(a)='')THEN RAISE EXCEPTION 'invalid neighborhood aliases';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,61));
 command:=jsonb_build_array(p_tenant,p_label,p_expected,p_payload);SELECT * INTO old FROM public.taxi_bot_neighborhood_operations WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF old.command IS DISTINCT FROM command THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN old.response;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text,56));
 rows:=public.taxi_bot_neighborhood_read(p_tenant);SELECT value INTO current_row FROM jsonb_array_elements(rows)WHERE value->>'label'=p_label;
 IF current_row IS NULL THEN RETURN jsonb_build_object('state','not_found');END IF;
 IF current_row->>'version'<>p_expected THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
 IF new_label<>p_label AND EXISTS(SELECT 1 FROM jsonb_array_elements(rows)r WHERE public.taxi_bot_neighborhood_key(r->>'label')=public.taxi_bot_neighborhood_key(new_label))THEN RETURN jsonb_build_object('state','name_conflict');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows)r WHERE r->>'label'<>p_label AND EXISTS(SELECT 1 FROM unnest(alias_values||ARRAY[new_label])candidate WHERE public.taxi_bot_neighborhood_key(candidate)=public.taxi_bot_neighborhood_key(r->>'label')OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(r->'aliases')a WHERE public.taxi_bot_neighborhood_key(candidate)=public.taxi_bot_neighborhood_key(a))))THEN RETURN jsonb_build_object('state','alias_conflict');END IF;
 IF new_label<>p_label THEN DELETE FROM public.taxi_bot_neighborhoods WHERE tenant_id=p_tenant AND label=p_label;END IF;
 IF jsonb_array_length(current_row->'cells')=0 THEN
  INSERT INTO public.taxi_bot_neighborhoods(tenant_id,label,aliases,description,updated_by,reference_price_cents)
   VALUES(p_tenant,new_label,alias_values,p_payload->>'description',p_actor,new_cents)
   ON CONFLICT(tenant_id,label)DO UPDATE SET aliases=excluded.aliases,description=excluded.description,updated_at=clock_timestamp(),updated_by=excluded.updated_by,reference_price_cents=excluded.reference_price_cents;
 ELSE
  UPDATE public.taxi_bot_base_zones SET label=new_label,price_cents=new_cents WHERE tenant_id=p_tenant AND label=p_label;
  INSERT INTO public.taxi_bot_neighborhoods(tenant_id,label,aliases,description,updated_by,reference_price_cents)
   VALUES(p_tenant,new_label,alias_values,p_payload->>'description',p_actor,NULL)
   ON CONFLICT(tenant_id,label)DO UPDATE SET aliases=excluded.aliases,description=excluded.description,updated_at=clock_timestamp(),updated_by=excluded.updated_by,reference_price_cents=NULL;
 END IF;
 SELECT value INTO current_row FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))WHERE value->>'label'=new_label;
 result:=jsonb_build_object('state','saved','neighborhood',current_row);
 INSERT INTO public.taxi_bot_neighborhood_operations(actor,request_id,command,response)VALUES(p_actor,p_request,command,result);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_h3_quote_with_references(p_tenant uuid,p_waba text,p_origin text,p_destination text,p_origin_reference jsonb,p_destination_reference jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE origin_cents integer;destination_cents integer;matches integer;row jsonb;amount integer;area jsonb;cell text;
BEGIN
 IF p_origin IS NULL OR p_destination IS NULL OR p_origin !~ '^8a[0-9a-f]{13}$'OR p_destination !~ '^8a[0-9a-f]{13}$'THEN RAISE EXCEPTION 'invalid taxi H3 cell';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND pricing_mode='h3_zone_max')THEN RETURN jsonb_build_object('state','channel_unavailable','mode','h3_zone_max');END IF;
 SELECT count(*)::integer INTO matches FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant AND h3_index IN(p_origin,p_destination);
 IF matches<>(CASE WHEN p_origin=p_destination THEN 1 ELSE 2 END)THEN RETURN jsonb_build_object('state','uncovered','mode','h3_zone_max');END IF;
 SELECT price_cents INTO origin_cents FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant AND h3_index=p_origin;
 SELECT price_cents INTO destination_cents FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant AND h3_index=p_destination;
 IF p_origin_reference IS NOT NULL THEN
  area:=p_origin_reference;cell:=p_origin;
  IF jsonb_typeof(area)IS DISTINCT FROM 'object'OR area->>'priceSource'<>'reference'OR area->>'cell'IS DISTINCT FROM cell OR jsonb_typeof(area->'cents')IS DISTINCT FROM 'number'OR coalesce((area->>'cents')::integer,0)NOT BETWEEN 1 AND 10000000 OR NOT public.taxi_bot_street_reference(area->>'reference',area->>'label')THEN RAISE EXCEPTION 'invalid neighborhood fare reference';END IF;
  SELECT value INTO row FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))WHERE value->>'label'=area->>'label';
  IF row IS NULL OR row->>'priceSource'<>'reference'OR row->>'version'IS DISTINCT FROM area->>'version'OR row->'cents'IS DISTINCT FROM area->'cents'THEN RAISE EXCEPTION 'taxi neighborhood changed';END IF;
  origin_cents:=(area->>'cents')::integer;
 END IF;
 IF p_destination_reference IS NOT NULL THEN
  area:=p_destination_reference;cell:=p_destination;
  IF jsonb_typeof(area)IS DISTINCT FROM 'object'OR area->>'priceSource'<>'reference'OR area->>'cell'IS DISTINCT FROM cell OR jsonb_typeof(area->'cents')IS DISTINCT FROM 'number'OR coalesce((area->>'cents')::integer,0)NOT BETWEEN 1 AND 10000000 OR NOT public.taxi_bot_street_reference(area->>'reference',area->>'label')THEN RAISE EXCEPTION 'invalid neighborhood fare reference';END IF;
  SELECT value INTO row FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))WHERE value->>'label'=area->>'label';
  IF row IS NULL OR row->>'priceSource'<>'reference'OR row->>'version'IS DISTINCT FROM area->>'version'OR row->'cents'IS DISTINCT FROM area->'cents'THEN RAISE EXCEPTION 'taxi neighborhood changed';END IF;
  destination_cents:=(area->>'cents')::integer;
 END IF;
 IF origin_cents IS NULL OR destination_cents IS NULL THEN RETURN jsonb_build_object('state','invalid_zone','mode','h3_zone_max');END IF;
 amount:=greatest(origin_cents,destination_cents);
 RETURN jsonb_build_object('state','priced','mode','h3_zone_max','cents',amount,'originCell',p_origin,'destinationCell',p_destination);
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_validate_quote(p_tenant uuid,p_waba text,p_draft jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE mode text;q jsonb;scope jsonb;old_cents integer;channel public.taxi_bot_channels;item record;point jsonb;lat double precision;lng double precision;distance_km double precision;area jsonb;zone jsonb;expected_cell text;
BEGIN
 SELECT c.* INTO channel FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND c.enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'taxi pricing channel unavailable';END IF;
 mode:=channel.pricing_mode;
 IF p_draft->>'originArea'IS NOT NULL OR p_draft->>'destinationArea'IS NOT NULL THEN RAISE EXCEPTION 'taxi neighborhood reference required';END IF;
 IF p_draft ? 'fareMode' AND (jsonb_typeof(p_draft->'fareMode') IS DISTINCT FROM 'string' OR p_draft->>'fareMode' NOT IN('quoted','unquoted')) THEN RAISE EXCEPTION 'invalid taxi fare mode';END IF;
 scope:=p_draft->'quoteH3';
 FOR item IN SELECT true is_origin,p_draft->'origin' value UNION ALL SELECT false,p_draft->'destination' LOOP
  point:=item.value;lat:=(point->>'lat')::double precision;lng:=(point->>'lng')::double precision;
  IF lat IS NULL OR lng IS NULL OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'invalid taxi coordinates';END IF;
  distance_km:=12742*asin(least(1,sqrt(power(sin(radians(lat-channel.center_lat)/2),2)+cos(radians(channel.center_lat))*cos(radians(lat))*power(sin(radians(lng-channel.center_lng)/2),2))));
  IF distance_km>channel.radius_km THEN RAISE EXCEPTION 'taxi coverage changed';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(jsonb_build_array(p_draft->'origin',p_draft->'destination'))AS points(point)WHERE points.point->'area' IS NOT NULL AND jsonb_typeof(points.point->'area')<>'null')THEN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant::text,56));
  FOR item IN SELECT true is_origin,p_draft->'origin' value UNION ALL SELECT false,p_draft->'destination' LOOP
   point:=item.value;area:=point->'area';IF area IS NULL OR jsonb_typeof(area)='null' THEN CONTINUE;END IF;
   IF item.is_origin THEN expected_cell:=CASE WHEN jsonb_typeof(scope)='object' THEN scope->>'originCell' ELSE area->>'cell' END;
   ELSE expected_cell:=CASE WHEN jsonb_typeof(scope)='object' THEN scope->>'destinationCell' ELSE area->>'cell' END;END IF;
   IF area->>'cell'IS DISTINCT FROM expected_cell OR NOT public.taxi_bot_street_reference(area->>'reference',area->>'label')THEN RAISE EXCEPTION 'taxi neighborhood reference required';END IF;
   SELECT value INTO zone FROM jsonb_array_elements(public.taxi_bot_neighborhood_read(p_tenant))WHERE value->>'label'=area->>'label';
   IF zone IS NULL OR zone->>'version'IS DISTINCT FROM area->>'version'OR zone->'cents'IS DISTINCT FROM area->'cents'OR zone->>'priceSource'IS DISTINCT FROM coalesce(area->>'priceSource','h3')THEN RAISE EXCEPTION 'taxi neighborhood changed';END IF;
   IF coalesce(area->>'priceSource','h3')='reference' THEN
    IF jsonb_array_length(zone->'cells')<>0 OR area->'cents'='null'::jsonb OR left(coalesce(point->>'text',''),17)='Zona aproximada: '
      OR NOT EXISTS(SELECT 1 FROM public.taxi_bot_base_zones WHERE tenant_id=p_tenant AND h3_index=area->>'cell')THEN RAISE EXCEPTION 'taxi neighborhood changed';END IF;
   ELSIF coalesce(area->>'priceSource','h3')='h3' THEN
    IF NOT(zone->'cells' ? (area->>'cell'))OR left(coalesce(point->>'text',''),17)<>'Zona aproximada: 'OR position(area->>'reference'IN coalesce(point->>'text',''))=0 THEN RAISE EXCEPTION 'taxi neighborhood changed';END IF;
   ELSE RAISE EXCEPTION 'taxi neighborhood changed';END IF;
  END LOOP;
 END IF;
 -- No price was offered to this passenger. Location and channel checks still apply.
 IF p_draft->>'fareMode'='unquoted' THEN
  IF p_draft->>'quoteCents' IS NOT NULL OR p_draft->>'quoteH3' IS NOT NULL THEN RAISE EXCEPTION 'unquoted taxi cannot contain a fare';END IF;
  RETURN;
 END IF;
 IF mode='road_distance' THEN
  IF p_draft->>'quoteH3' IS NOT NULL THEN RAISE EXCEPTION 'taxi tariff changed';END IF;
  RETURN;
 END IF;
 IF jsonb_typeof(scope)IS DISTINCT FROM 'object'OR scope->>'originCell'IS NULL OR scope->>'destinationCell'IS NULL THEN RAISE EXCEPTION 'taxi H3 review required';END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant::text,56));
 PERFORM z.h3_index FROM public.taxi_bot_base_zones z WHERE z.tenant_id=p_tenant AND z.h3_index IN(scope->>'originCell',scope->>'destinationCell')ORDER BY z.h3_index FOR SHARE;
 q:=public.taxi_bot_h3_quote_with_references(p_tenant,p_waba,scope->>'originCell',scope->>'destinationCell',
  CASE WHEN p_draft#>>'{origin,area,priceSource}'='reference'THEN p_draft#>'{origin,area}'ELSE NULL END,
  CASE WHEN p_draft#>>'{destination,area,priceSource}'='reference'THEN p_draft#>'{destination,area}'ELSE NULL END);
 old_cents:=(p_draft->>'quoteCents')::integer;
 IF(q->>'state'='priced'AND(q->>'cents')::integer IS NOT DISTINCT FROM old_cents)
  OR(q->>'state'IN('uncovered','invalid_zone')AND old_cents IS NULL)THEN RETURN;END IF;
 RAISE EXCEPTION 'taxi tariff changed';
END $$;

REVOKE ALL ON FUNCTION public.taxi_bot_h3_quote_with_references(uuid,text,text,text,jsonb,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_h3_quote_with_references(uuid,text,text,text,jsonb,jsonb)TO service_role;

-- These are the sixteen exact local H3 labels already present in Pompeyo's base.
CREATE TEMP TABLE pdf_local_fares(label text PRIMARY KEY,cell_count integer,old_min integer,old_max integer,new_price integer)ON COMMIT DROP;
INSERT INTO pdf_local_fares VALUES
 ('1ro de mayo',18,4500,4500,5500),('Infonavit',2,4500,4500,5500),('Colonia Miguel Aleman',13,4500,4500,5500),('Fovisste',5,4500,4500,5500),
 ('Popular',7,4500,4500,5500),('Los pinos',14,4500,4500,5500),('Mariano N Ruiz',145,4500,5000,5500),('Centro',10,4500,4500,5500),
 ('El brasilito',14,5000,5000,6500),('Jacarandas',2,5000,5000,6500),('Las brisas',10,4500,4500,6500),('Valle Balun Canan',33,4500,4500,6500),
 ('Junchavin',2,5000,5000,8000),('Bugambilias primera seccion',4,6000,6000,8000),('Bugambilias segunda seccion',6,6000,6000,8000),('Paraiso comiteco',8,5000,5000,8000);
DO $$
DECLARE target uuid:='4cf9acf1-f07e-4a01-9396-eb5bde3e7411';expected integer;actual integer;item record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=target AND tipo_negocio='taxi')THEN RETURN;END IF;
 SELECT count(*)INTO expected FROM pdf_local_fares;
 SELECT count(*)INTO actual FROM pdf_local_fares m WHERE EXISTS(SELECT 1 FROM public.taxi_bot_base_zones z WHERE z.tenant_id=target AND z.label=m.label);
 IF actual<>expected THEN RAISE EXCEPTION 'Expected % matched Pompeyo H3 labels, found %; local fare import cancelled',expected,actual;END IF;
 IF EXISTS(SELECT 1 FROM pdf_local_fares m WHERE NOT EXISTS(
  SELECT 1 FROM public.taxi_bot_base_zones z WHERE z.tenant_id=target AND z.label=m.label
  GROUP BY z.label HAVING count(*)=m.cell_count AND min(z.price_cents)=m.old_min AND max(z.price_cents)=m.old_max AND count(z.price_cents)=m.cell_count))THEN
  RAISE EXCEPTION 'A matched H3 group changed since review; local fare import cancelled';
 END IF;
 UPDATE public.taxi_bot_base_zones z SET price_cents=m.new_price FROM pdf_local_fares m WHERE z.tenant_id=target AND z.label=m.label;
 IF EXISTS(SELECT 1 FROM public.taxi_bot_neighborhoods n WHERE n.tenant_id=target AND n.label IN('La Esmeralda','Campo de la Mariano N. Ruiz','San Juan','27 de Junio','Manuel Velasco','Reforma','La Esperanza','Chula Vista','Monte Cristo','Chichima Sabinal','Chichima Acapetahua'))THEN
  RAISE EXCEPTION 'A new locality name is already in Pompeyo neighborhoods; local fare import cancelled';
 END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_bot_base_zones z WHERE z.tenant_id=target AND public.taxi_bot_neighborhood_key(z.label) IN('la esmeralda','campo de la mariano n ruiz','san juan','27 de junio','manuel velasco','reforma','la esperanza','chula vista','monte cristo','chichima sabinal','chichima acapetahua'))THEN
  RAISE EXCEPTION 'A new locality name already matches a Pompeyo H3 label; local fare import cancelled';
 END IF;
 FOR item IN SELECT * FROM(VALUES
   ('La Esmeralda',5500),('Campo de la Mariano N. Ruiz',5500),('San Juan',5500),('27 de Junio',5500),
   ('Manuel Velasco',8000),('Reforma',8000),('La Esperanza',8000),('Chula Vista',8000),('Monte Cristo',8000),
   ('Chichima Sabinal',16000),('Chichima Acapetahua',16000)
  ) AS pending(label,cents)
 LOOP
  INSERT INTO public.taxi_bot_neighborhoods(tenant_id,label,aliases,description,reference_price_cents)
   VALUES(target,item.label,'{}','Tarifa de referencia de la lista local; pendiente de vincular al mapa de la base.',item.cents);
 END LOOP;
 -- Preserve the printed spellings where accent normalization is not enough.
 INSERT INTO public.taxi_bot_neighborhoods(tenant_id,label,aliases,description,reference_price_cents)
  VALUES(target,'1ro de mayo',ARRAY['1 de mayo'],'',NULL),(target,'Fovisste',ARRAY['FOVISSSTE'],'',NULL)
  ON CONFLICT(tenant_id,label)DO UPDATE SET aliases=ARRAY(SELECT DISTINCT value FROM unnest(public.taxi_bot_neighborhoods.aliases||excluded.aliases)value ORDER BY value),updated_at=clock_timestamp();
END $$;
COMMIT;
