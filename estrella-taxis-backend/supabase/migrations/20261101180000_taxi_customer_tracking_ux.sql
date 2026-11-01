BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='45s';
ALTER TABLE public.viajes ADD COLUMN bot_driver_name text;
ALTER TABLE public.taxi_bot_channels ADD COLUMN customer_tracking_button_enabled boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.taxi_bot_unit_label(p_tenant uuid,p_device integer)RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE unit_number integer;variants integer;label text;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.taxi_base_units WHERE tenant_id=p_tenant AND device_id=p_device)THEN RETURN 'Tu taxi';END IF;
 SELECT min(n),count(DISTINCT n)INTO unit_number,variants FROM(
  SELECT CASE WHEN trim(c.unit_number)~'^[0-9]{1,6}$'THEN trim(c.unit_number)::integer END n
  FROM public.taxi_base_contacts c WHERE c.tenant_id=p_tenant AND c.device_id=p_device
 )x WHERE n>0;
 IF variants=1 THEN RETURN 'Unidad '||lpad(unit_number::text,greatest(4,length(unit_number::text)),'0');END IF;
 SELECT (regexp_match(name,'(^|[[:space:]])([0-9]{2,6})[[:space:]]*$'))[2] INTO label
 FROM public.taxi_base_units WHERE tenant_id=p_tenant AND device_id=p_device;
 RETURN CASE WHEN label IS NOT NULL THEN 'Unidad '||lpad(label,greatest(4,length(label)),'0')ELSE 'Tu taxi'END;
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_unit_label(uuid,integer)FROM PUBLIC,anon,authenticated,service_role;
DO $patch$DECLARE f text;needle text;replacement text;BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_commit(uuid,uuid,bigint,jsonb)'::regprocedure)INTO f;
 needle:='taxi_name=o.driver_name,updated_at=clock_timestamp()';
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review current assignment unit/driver snapshot';END IF;
 EXECUTE replace(f,needle,'taxi_name=public.taxi_bot_unit_label(t.tenant_id,o.device_id),bot_driver_name=o.driver_name,updated_at=clock_timestamp()');
 SELECT pg_get_functiondef('public.taxi_bot_emit(uuid,text,text,text,text,jsonb)'::regprocedure)INTO f;
 needle:=' IF pieces=2 THEN';
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review current customer receipt boundary';END IF;
 replacement:=$cta$ IF p_key~'^trip-assigned:[0-9a-f-]{36}$'AND EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba AND customer_tracking_button_enabled)THEN
  SELECT * INTO tracking_trip FROM public.viajes WHERE id=substring(p_key FROM 15)::uuid AND tenant_id=p_tenant AND bot_waba=p_waba AND cliente_tel=p_to AND bot_managed AND estado='en_camino';
  IF FOUND THEN
   body_text:='🚕 ¡Tu taxi va por ti! 😊'||E'\n'||coalesce(nullif(tracking_trip.taxi_name,''),'Tu taxi')
    ||CASE WHEN nullif(tracking_trip.bot_driver_name,'')IS NOT NULL THEN E'\nTe atiende: '||left(tracking_trip.bot_driver_name,100)ELSE ''END
    ||E'\n\nPuedes seguir su ubicación en tiempo real con el botón de abajo.';
   p_buttons:=NULL;meta:=meta||jsonb_build_object('urlButton',jsonb_build_object('title','Ver viaje en vivo','url','https://stellar.estrella-eats.mx/track/'||tracking_trip.token));
  END IF;
 END IF;
 IF pieces=2 THEN$cta$;
 f:=replace(f,needle,replacement);
 needle:='meta:=jsonb_build_object(''messageServiceId'',s.message_service_id,''messageClass'',category);';
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review receipt metadata budget merge';END IF;
 f:=replace(f,needle,'meta:=meta||jsonb_build_object(''messageServiceId'',s.message_service_id,''messageClass'',category);');
 EXECUTE f;
 SELECT pg_get_functiondef('public.taxi_driver_trip_read(text)'::regprocedure)INTO f;
 needle:='SELECT name INTO unit_name FROM public.taxi_base_units WHERE tenant_id=l.tenant_id AND device_id=l.device_id;';
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review driver page unit label';END IF;
 EXECUTE replace(f,needle,'unit_name:=public.taxi_bot_unit_label(l.tenant_id,l.device_id);');
END $patch$;
-- Correct only currently assigned bot trips, retaining the accepted driver snapshot.
SELECT set_config('app.taxi_bot_write','on',true);
UPDATE public.viajes v SET taxi_name=public.taxi_bot_unit_label(v.tenant_id,v.device_id),bot_driver_name=o.driver_name
FROM public.taxi_bot_offers o WHERE o.trip_id=v.id AND o.tenant_id=v.tenant_id AND o.waba=v.bot_waba AND o.device_id=v.device_id
AND o.state='accepted'AND v.bot_managed AND v.estado='en_camino';
NOTIFY pgrst,'reload schema';
COMMIT;
