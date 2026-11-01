-- One current offer per trip. Keep the existing ranked candidates, durable jobs,
-- four-round limit, provider circuit breaker and acceptance transaction.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE definition text;previous text;replacement text;function_name text;
BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_dispatch_offer(uuid,jsonb,integer)'::regprocedure)INTO definition;
 previous:=' PERFORM set_config(''app.taxi_bot_write'',''on'',true);';
 replacement:=$guard$ IF EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE trip_id=t.id AND state='offered'AND expires_at>clock_timestamp())THEN RETURN 0;END IF;
$guard$||previous;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current offer guard';END IF;
 definition:=replace(definition,previous,replacement);
 previous:='OR EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE trip_id=t.id AND device_id=d.device_id)THEN CONTINUE;END IF;';
 replacement:=$busy$OR EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE trip_id=t.id AND device_id=d.device_id)
   OR EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE tenant_id=t.tenant_id AND device_id=d.device_id AND state='offered'AND expires_at>clock_timestamp())THEN CONTINUE;END IF;$busy$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current offer eligibility';END IF;
 definition:=replace(definition,previous,replacement);
 previous:='INSERT INTO public.taxi_bot_offers(tenant_id,waba,trip_id,device_id,driver_phone,driver_name,round_no)';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current offer insert';END IF;
 definition:=replace(definition,previous,'INSERT INTO public.taxi_bot_offers(tenant_id,waba,trip_id,device_id,driver_phone,driver_name,round_no,expires_at)');
 previous:='d.nombre,p_round)ON CONFLICT';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current offer duration';END IF;
 definition:=replace(definition,previous,'d.nombre,p_round,clock_timestamp()+interval ''60 seconds'')ON CONFLICT');
 previous:=$old$'🚕 ¿Puedes tomar este viaje?'||E'\nRecogida: '||t.origen||E'\nDestino: '||t.destino||E'\nTarifa: $'||(t.bot_quote_cents::numeric/100)::text||' MXN'$old$;
 replacement:=$message$'🚕 *¿Puedes tomar este viaje?*'||E'\n👤 '||left(coalesce(t.cliente_nombre,'Pasajero'),80)||E'\n\n📍 *Pasas por el pasajero aquí:*\nhttps://maps.google.com/?q='||to_char(t.origen_lat,'FM990.00000')||','||to_char(t.origen_lng,'FM990.00000')||
 CASE WHEN strpos(t.origen,E'\nReferencia: ')>0 THEN E'\n📝 '||left(split_part(t.origen,E'\nReferencia: ',2),120)ELSE ''END||
 E'\n\n🏁 *Destino:* '||left(t.destino,180)||E'\n\n⏳ Tienes 1 minuto para responder con los botones.'$message$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current driver offer message';END IF;
 definition:=replace(definition,previous,replacement);
 previous:=' END LOOP;'||E'\n'||' RETURN total;';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current offer loop';END IF;
 definition:=replace(definition,previous,'  EXIT;'||E'\n'||previous);
 EXECUTE definition;

 FOREACH function_name IN ARRAY ARRAY['public.taxi_bot_dispatch_start(uuid,jsonb,boolean)','public.taxi_bot_dispatch_complete(uuid,uuid,jsonb,text)']LOOP
  SELECT pg_get_functiondef(function_name::regprocedure)INTO definition;
  IF strpos(definition,'interval ''90 seconds''')=0 THEN RAISE EXCEPTION 'Review current dispatch schedule';END IF;
  EXECUTE replace(definition,'interval ''90 seconds''','interval ''60 seconds''');
 END LOOP;

 SELECT pg_get_functiondef('public.taxi_bot_dispatch_eligible(uuid,text,integer[])'::regprocedure)INTO definition;
 previous:='ORDER BY d.device_id LIMIT 501;';
 replacement:=$eligible$AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_offers o WHERE o.tenant_id=p_tenant AND o.device_id=d.device_id AND o.state='offered'AND o.expires_at>clock_timestamp())
 $eligible$||previous;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current dispatch eligibility';END IF;
 EXECUTE replace(definition,previous,replacement);

 SELECT pg_get_functiondef('public.taxi_bot_dispatch_delivery_changed()'::regprocedure)INTO definition;
 previous:=$old$ IF NEW.state NOT IN('failed','uncertain','accepted')OR OLD.state=NEW.state THEN RETURN NEW;END IF;$old$;
 replacement:=$ack$ -- Start the response minute at the first successful provider acknowledgement.
 -- Delivered/read/repeated callbacks cannot extend it, revive an expired offer
 -- or authorize a trip; driver acceptance still checks the current offer.
 IF NEW.state IN('accepted','delivered','read')AND OLD.state NOT IN('accepted','delivered','read')AND control_key~'^offer:[0-9a-f-]{36}$'THEN
  PERFORM 1 FROM public.viajes v WHERE v.id=(SELECT o.trip_id FROM public.taxi_bot_offers o WHERE o.id=substring(control_key FROM 7)::uuid AND o.tenant_id=NEW.tenant_id AND o.waba=NEW.waba)AND v.estado='buscando_conductor'FOR UPDATE;
  IF FOUND THEN
   UPDATE public.taxi_bot_offers SET expires_at=clock_timestamp()+interval '60 seconds'
   WHERE id=substring(control_key FROM 7)::uuid AND tenant_id=NEW.tenant_id AND waba=NEW.waba AND state='offered'AND expires_at>clock_timestamp();
  END IF;
 END IF;
$ack$||previous;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current delivery acknowledgement';END IF;
 EXECUTE replace(definition,previous,replacement);
END $patch$;
COMMIT;
