BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Keep the existing atomic acceptance/outbox contract. Only replace the existing
-- acceptance receipts with actionable links after the locked trip is assigned.
DO $patch$
DECLARE definition text;previous text;replacement text;
BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_emit(uuid,text,text,text,text,jsonb)'::regprocedure) INTO definition;

 previous:='pieces integer;terminal boolean;BEGIN';
 replacement:='pieces integer;terminal boolean;tracking_trip public.viajes%ROWTYPE;tracking_trip_id uuid;BEGIN';
 IF strpos(definition,previous)=0 OR strpos(definition,'tracking_trip_id')>0 THEN
  RAISE EXCEPTION 'Review taxi outbox declaration before adding live tracking receipts';
 END IF;
 definition:=replace(definition,previous,replacement);

 previous:='IF EXISTS(SELECT 1 FROM public.taxi_bot_outbox WHERE dedupe_key=p_key)THEN RETURN;END IF;';
 replacement:=previous||$tracking$
 IF p_key ~ '^trip-assigned:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
  tracking_trip_id:=substring(p_key FROM length('trip-assigned:')+1)::uuid;
  SELECT v.* INTO tracking_trip FROM public.viajes v
   WHERE v.id=tracking_trip_id AND v.tenant_id=p_tenant AND v.bot_waba=p_waba
    AND v.cliente_tel=p_to AND v.bot_managed AND v.estado='en_camino'
    AND v.token ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  IF FOUND THEN
   body_text:='🚕 ¡Listo! La unidad '||coalesce(nullif(tracking_trip.taxi_name,''),'asignada')||' ya aceptó y va por ti. 😊'
    ||E'\n📍 Sigue su ubicación en tiempo real:\nhttps://stellar.estrella-eats.mx/track/'||tracking_trip.token
    ||E'\nTe avisamos si hay algún cambio.';
  END IF;
 ELSIF p_key ~ '^driver-assigned:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
  tracking_trip_id:=substring(p_key FROM length('driver-assigned:')+1)::uuid;
  SELECT v.* INTO tracking_trip FROM public.viajes v
   JOIN public.taxi_bot_offers o ON o.trip_id=v.id AND o.device_id=v.device_id AND o.state='accepted'
   WHERE v.id=tracking_trip_id AND v.tenant_id=p_tenant AND v.bot_waba=p_waba
    AND v.bot_managed AND v.estado='en_camino'
    AND public.taxi_bot_customer_phone(o.driver_phone)=public.taxi_bot_customer_phone(p_to)
    AND v.origen_lat BETWEEN -90 AND 90 AND v.origen_lng BETWEEN -180 AND 180;
  IF FOUND THEN
   body_text:=body_text||E'\n📍 Punto de recogida en el mapa: https://maps.google.com/?q='
    ||round(tracking_trip.origen_lat::numeric,6)::text||','||round(tracking_trip.origen_lng::numeric,6)::text;
  END IF;
 END IF;
$tracking$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review taxi outbox idempotency guard before adding tracking links';END IF;
 EXECUTE replace(definition,previous,replacement);
END $patch$;

COMMIT;
