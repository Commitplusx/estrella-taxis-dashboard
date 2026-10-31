BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Reuse existing private operation receipts and their concurrency/retention rules.
ALTER TABLE public.tracking_operations DROP CONSTRAINT tracking_operations_kind_check;
ALTER TABLE public.tracking_operations ADD CONSTRAINT tracking_operations_kind_check CHECK(kind IN('audit','score','simulation'));
DO $$DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('public.tracking_operation_begin(bigint,uuid,text,text)'::regprocedure) INTO definition;
 IF strpos(definition,'p_kind NOT IN(''audit'',''score'')')=0 OR strpos(definition,'simulation')>0 THEN RAISE EXCEPTION 'Review tracking operation contract before adding simulation';END IF;
 IF strpos(definition,'CASE WHEN p_kind=''audit'' THEN 3 ELSE 12 END')=0 OR strpos(definition,'WHERE created_at<now_at-interval ''30 days'' ORDER BY created_at LIMIT 500')=0 THEN RAISE EXCEPTION 'Review operation limits and cleanup before adding simulation';END IF;
 definition:=replace(definition,'p_kind NOT IN(''audit'',''score'')','p_kind NOT IN(''audit'',''score'',''simulation'')');
 definition:=replace(definition,'CASE WHEN p_kind=''audit'' THEN 3 ELSE 12 END','CASE WHEN p_kind=''audit'' THEN 3 WHEN p_kind=''simulation'' THEN 30 ELSE 12 END');
 definition:=replace(definition,'WHERE created_at<now_at-interval ''30 days'' ORDER BY created_at LIMIT 500','WHERE (created_at<now_at-interval ''30 days'' OR kind=''simulation'' AND created_at<now_at-interval ''30 minutes'') ORDER BY created_at LIMIT 500');
 EXECUTE definition;
END $$;
CREATE FUNCTION public.taxi_bot_simulation_fleet(p_tenant uuid,p_waba text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 WITH channel AS(SELECT enabled FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba),
 allowed AS(SELECT device_id FROM public.taxi_bot_dispatch_eligible(p_tenant,p_waba)),
 units AS(SELECT u.device_id,u.name FROM public.taxi_base_units u WHERE u.tenant_id=p_tenant ORDER BY u.device_id LIMIT 201)
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM channel)THEN NULL ELSE jsonb_build_object(
  'enabled',(SELECT enabled FROM channel),'paused',public.taxi_bot_dispatch_paused(p_tenant,p_waba),
  'units',coalesce((SELECT jsonb_agg(jsonb_build_object('deviceId',u.device_id,'name',u.name,
   'inTurn',coalesce(d.activo,false),'hasPhone',public.taxi_bot_customer_phone(d.telefono_whatsapp)IS NOT NULL,
   'busy',EXISTS(SELECT 1 FROM public.viajes v WHERE v.device_id=u.device_id AND v.estado='en_camino'),
   'eligible',EXISTS(SELECT 1 FROM allowed a WHERE a.device_id=u.device_id))ORDER BY u.device_id)
  FROM units u LEFT JOIN public.conductores d ON d.tenant_id=p_tenant AND d.device_id=u.device_id),'[]'))END;
$$;
REVOKE ALL ON FUNCTION public.taxi_bot_simulation_fleet(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_bot_simulation_fleet(uuid,text) TO service_role;
COMMENT ON FUNCTION public.taxi_bot_simulation_fleet(uuid,text) IS 'Private read-only fleet facts for administrator dispatch simulation; no driver phone or account data.';
NOTIFY pgrst,'reload schema';
COMMIT;
