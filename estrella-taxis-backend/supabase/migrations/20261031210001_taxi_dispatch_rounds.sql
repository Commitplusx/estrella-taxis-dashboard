BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

CREATE TABLE public.taxi_bot_dispatch_jobs(
 trip_id uuid PRIMARY KEY REFERENCES public.viajes(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL,waba text NOT NULL,
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN('waiting','leased','attention','done')),
 round_no integer NOT NULL DEFAULT 0 CHECK(round_no BETWEEN 0 AND 4),
 scans integer NOT NULL DEFAULT 1 CHECK(scans BETWEEN 0 AND 12),
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 3),
 next_at timestamptz NOT NULL DEFAULT clock_timestamp(),deadline_at timestamptz NOT NULL,
 lease uuid,lease_until timestamptz,code text,notified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,waba)REFERENCES public.taxi_bot_channels(tenant_id,waba)
);
CREATE INDEX taxi_bot_dispatch_due ON public.taxi_bot_dispatch_jobs(next_at,trip_id)WHERE state IN('waiting','leased');
CREATE INDEX taxi_bot_dispatch_panel ON public.taxi_bot_dispatch_jobs(tenant_id,waba,state,updated_at DESC);
CREATE INDEX taxi_bot_offers_device_pending ON public.taxi_bot_offers(device_id,expires_at)WHERE state='offered';
ALTER TABLE public.taxi_bot_offers ADD COLUMN round_no integer NOT NULL DEFAULT 1 CHECK(round_no BETWEEN 1 AND 4);

CREATE TABLE public.taxi_bot_dispatch_health(
 tenant_id uuid NOT NULL,waba text NOT NULL,failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 3),
 paused_until timestamptz,last_failure_at timestamptz,code text,revision bigint NOT NULL DEFAULT 0,
 last_request uuid,last_actor integer,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,waba),FOREIGN KEY(tenant_id,waba)REFERENCES public.taxi_bot_channels(tenant_id,waba)
);
ALTER TABLE public.taxi_bot_dispatch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxi_bot_dispatch_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_dispatch_jobs,public.taxi_bot_dispatch_health FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.taxi_bot_dispatch_paused(p_tenant uuid,p_waba text)RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.taxi_bot_dispatch_health WHERE tenant_id=p_tenant AND waba=p_waba
   AND(failures>=3 OR paused_until>clock_timestamp()));
$$;

CREATE FUNCTION public.taxi_bot_dispatch_eligible(p_tenant uuid,p_waba text,p_excluded integer[] DEFAULT '{}')
RETURNS TABLE(device_id integer)LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF cardinality(p_excluded)>12 OR array_position(p_excluded,NULL)IS NOT NULL THEN RAISE EXCEPTION 'invalid dispatch exclusions';END IF;
 IF public.taxi_bot_dispatch_paused(p_tenant,p_waba)THEN RETURN;END IF;
 RETURN QUERY SELECT d.device_id FROM public.conductores d
 WHERE d.tenant_id=p_tenant AND d.activo AND NOT(d.device_id=ANY(p_excluded))
 AND public.taxi_bot_customer_phone(d.telefono_whatsapp)IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND c.enabled)
 AND NOT EXISTS(SELECT 1 FROM public.viajes v WHERE v.device_id=d.device_id AND v.estado='en_camino')
 ORDER BY d.device_id LIMIT 501;
END $$;

-- One durable output per provider request. Details and controls keep separate IDs,
-- remain ordered, and share the same staleness/recipient checks.
CREATE OR REPLACE FUNCTION public.taxi_bot_emit(p_tenant uuid,p_waba text,p_to text,p_text text,p_key text,p_buttons jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE body_text text:=p_text;BEGIN
 IF p_to !~ '^\+[1-9][0-9]{7,14}$'OR p_text IS NULL OR length(p_text)NOT BETWEEN 1 AND 4096
 OR(p_buttons IS NOT NULL AND(jsonb_typeof(p_buttons)<>'array'OR jsonb_array_length(p_buttons)>3))THEN RAISE EXCEPTION 'invalid taxi output';END IF;
 IF coalesce(jsonb_array_length(p_buttons),0)>0 AND length(p_text)>1024 THEN
  INSERT INTO public.taxi_bot_outbox(tenant_id,waba,destination,body,dedupe_key)
  VALUES(p_tenant,p_waba,p_to,jsonb_build_object('text',p_text,'controlDedupe',p_key),p_key||':details')ON CONFLICT(dedupe_key)DO NOTHING;
  body_text:='Revisa los datos de arriba y elige una opción con los botones.';
 END IF;
 INSERT INTO public.taxi_bot_outbox(tenant_id,waba,destination,body,dedupe_key)
 VALUES(p_tenant,p_waba,p_to,jsonb_build_object('text',body_text,'buttons',p_buttons),p_key)ON CONFLICT(dedupe_key)DO NOTHING;
END $$;

-- Both the first round and later rounds use this same offer creation path.
CREATE FUNCTION public.taxi_bot_dispatch_offer(p_trip uuid,p_candidates jsonb,p_round integer)RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t public.viajes%ROWTYPE;d public.conductores%ROWTYPE;o public.taxi_bot_offers%ROWTYPE;item jsonb;total integer:=0;BEGIN
 IF jsonb_typeof(p_candidates)IS DISTINCT FROM 'array'OR jsonb_array_length(p_candidates)>3 OR p_round NOT BETWEEN 1 AND 4
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_candidates)x WHERE jsonb_typeof(x)IS DISTINCT FROM 'object'OR jsonb_typeof(x->'deviceId')IS DISTINCT FROM 'number'OR(x->>'deviceId')::numeric NOT BETWEEN 1 AND 2147483647 OR(x->>'deviceId')::numeric<>trunc((x->>'deviceId')::numeric))THEN RAISE EXCEPTION 'invalid dispatch candidates';END IF;
 SELECT * INTO t FROM public.viajes WHERE id=p_trip AND bot_managed AND estado='buscando_conductor'FOR UPDATE;
 IF NOT FOUND OR public.taxi_bot_dispatch_paused(t.tenant_id,t.bot_waba)THEN RETURN 0;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=t.tenant_id AND waba=t.bot_waba AND enabled)THEN RETURN 0;END IF;
 PERFORM set_config('app.taxi_bot_write','on',true);
 -- Always lock driver rows in numeric order, regardless of GPS ranking.
 PERFORM 1 FROM public.conductores WHERE tenant_id=t.tenant_id AND device_id IN(SELECT(x->>'deviceId')::integer FROM jsonb_array_elements(p_candidates)x)ORDER BY device_id FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_candidates)LOOP
  SELECT * INTO d FROM public.conductores WHERE tenant_id=t.tenant_id AND device_id=(item->>'deviceId')::integer AND activo;
  IF NOT FOUND OR public.taxi_bot_customer_phone(d.telefono_whatsapp)IS NULL
   OR EXISTS(SELECT 1 FROM public.viajes WHERE device_id=d.device_id AND estado='en_camino')
   OR EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE trip_id=t.id AND device_id=d.device_id)THEN CONTINUE;END IF;
  INSERT INTO public.taxi_bot_offers(tenant_id,waba,trip_id,device_id,driver_phone,driver_name,round_no)
  VALUES(t.tenant_id,t.bot_waba,t.id,d.device_id,public.taxi_bot_customer_phone(d.telefono_whatsapp),d.nombre,p_round)ON CONFLICT DO NOTHING RETURNING * INTO o;
  IF NOT FOUND THEN CONTINUE;END IF;total:=total+1;
  UPDATE public.viajes SET conductores_contactados=array_append(conductores_contactados,d.device_id)WHERE id=t.id;
  PERFORM public.taxi_bot_emit(t.tenant_id,t.bot_waba,o.driver_phone,'🚕 ¿Puedes tomar este viaje?'||E'\nRecogida: '||t.origen||E'\nDestino: '||t.destino||E'\nTarifa: $'||(t.bot_quote_cents::numeric/100)::text||' MXN',
   'offer:'||o.id,jsonb_build_array(jsonb_build_object('id','txa_'||o.id,'title','Aceptar viaje'),jsonb_build_object('id','txr_'||o.id,'title','No puedo')));
 END LOOP;
 RETURN total;
END $$;

CREATE FUNCTION public.taxi_bot_dispatch_attention(p_trip uuid,p_code text)RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public.taxi_bot_dispatch_jobs%ROWTYPE;t public.viajes%ROWTYPE;BEGIN
 UPDATE public.taxi_bot_dispatch_jobs SET state='attention',code=p_code,lease=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE trip_id=p_trip AND state IN('waiting','leased')RETURNING * INTO j;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO t FROM public.viajes WHERE id=p_trip AND estado='buscando_conductor';IF NOT FOUND THEN RETURN;END IF;
 IF j.notified_at IS NULL THEN
  PERFORM public.taxi_bot_emit(j.tenant_id,j.waba,t.cliente_tel,'🚕 Todavía no hay una unidad confirmada. Tu solicitud necesita revisión de la base; seguimos pendientes de ayudarte.','dispatch-attention:'||p_trip);
  UPDATE public.taxi_bot_dispatch_jobs SET notified_at=clock_timestamp()WHERE trip_id=p_trip;
 END IF;
END $$;

CREATE FUNCTION public.taxi_bot_dispatch_start(p_trip uuid,p_candidates jsonb,p_lookup_failed boolean DEFAULT false)RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t public.viajes%ROWTYPE;total integer;BEGIN
 SELECT * INTO t FROM public.viajes WHERE id=p_trip AND bot_managed AND estado='buscando_conductor'FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'dispatch trip not found';END IF;
 total:=public.taxi_bot_dispatch_offer(t.id,p_candidates,1);
 INSERT INTO public.taxi_bot_dispatch_jobs(trip_id,tenant_id,waba,round_no,next_at,deadline_at,failures,code)
 VALUES(t.id,t.tenant_id,t.bot_waba,CASE WHEN total>0 THEN 1 ELSE 0 END,clock_timestamp()+CASE WHEN total>0 THEN interval '90 seconds'ELSE interval '30 seconds'END,
 t.created_at+interval '12 minutes',CASE WHEN p_lookup_failed THEN 1 ELSE 0 END,CASE WHEN p_lookup_failed THEN 'fleet_unavailable'WHEN total=0 THEN 'no_candidates'ELSE NULL END);
 RETURN total;
END $$;

CREATE FUNCTION public.taxi_bot_dispatch_claim()RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public.taxi_bot_dispatch_jobs%ROWTYPE;t public.viajes%ROWTYPE;BEGIN
 FOR j IN SELECT q.* FROM public.taxi_bot_dispatch_jobs q JOIN public.viajes v ON v.id=q.trip_id
  WHERE q.state IN('waiting','leased')AND v.estado='buscando_conductor'
  AND NOT(q.state='leased'AND q.lease_until>clock_timestamp())
  AND(q.scans>=12 OR q.round_no>=4)AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_offers o WHERE o.trip_id=q.trip_id AND o.state='offered'AND o.expires_at>clock_timestamp())
  ORDER BY q.next_at LIMIT 20 LOOP
   PERFORM public.taxi_bot_dispatch_attention(j.trip_id,CASE WHEN j.scans>=12 THEN 'scan_limit'ELSE 'round_limit'END);
 END LOOP;
 FOR j IN SELECT q.* FROM public.taxi_bot_dispatch_jobs q
  JOIN public.viajes v ON v.id=q.trip_id AND v.estado='buscando_conductor'
  JOIN public.taxi_bot_channels c ON c.tenant_id=q.tenant_id AND c.waba=q.waba AND c.enabled
  WHERE(q.state='waiting'OR q.state='leased'AND q.lease_until<=clock_timestamp())AND(q.next_at<=clock_timestamp()OR q.round_no>0 AND q.code IS NULL)
  AND q.deadline_at>clock_timestamp()AND q.round_no<4 AND q.scans<12
  AND NOT public.taxi_bot_dispatch_paused(q.tenant_id,q.waba)
  AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_offers o WHERE o.trip_id=q.trip_id AND o.state='offered'AND o.expires_at>clock_timestamp())
  ORDER BY q.next_at,q.trip_id LIMIT 2 FOR UPDATE OF q SKIP LOCKED LOOP
   UPDATE public.taxi_bot_dispatch_jobs SET state='leased',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',scans=scans+1,updated_at=clock_timestamp()
   WHERE trip_id=j.trip_id RETURNING * INTO j;
   SELECT * INTO t FROM public.viajes WHERE id=j.trip_id;
   RETURN NEXT jsonb_build_object('tripId',j.trip_id,'tenantId',j.tenant_id,'waba',j.waba,'lease',j.lease,
    'origin',jsonb_build_object('text',t.origen,'lat',t.origen_lat,'lng',t.origen_lng,'placeId',NULL,'source','gps'),
    'excluded',coalesce((SELECT jsonb_agg(device_id ORDER BY device_id)FROM public.taxi_bot_offers WHERE trip_id=j.trip_id),'[]'));
 END LOOP;
END $$;

CREATE FUNCTION public.taxi_bot_dispatch_complete(p_trip uuid,p_lease uuid,p_candidates jsonb,p_error text DEFAULT NULL)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public.taxi_bot_dispatch_jobs%ROWTYPE;t public.viajes%ROWTYPE;total integer:=0;BEGIN
 IF p_error IS NOT NULL AND p_error NOT IN('fleet_unavailable','channel_unavailable')THEN RAISE EXCEPTION 'invalid dispatch result';END IF;
 SELECT * INTO t FROM public.viajes WHERE id=p_trip FOR UPDATE;
 SELECT * INTO j FROM public.taxi_bot_dispatch_jobs WHERE trip_id=p_trip FOR UPDATE;
 IF NOT FOUND OR j.state<>'leased'OR j.lease IS DISTINCT FROM p_lease OR j.lease_until<=clock_timestamp()THEN RETURN jsonb_build_object('state','stale');END IF;
 IF t.estado<>'buscando_conductor'OR j.deadline_at<=clock_timestamp()THEN
  UPDATE public.taxi_bot_dispatch_jobs SET state='done',lease=NULL,lease_until=NULL,updated_at=clock_timestamp()WHERE trip_id=p_trip;
  RETURN jsonb_build_object('state','done');
 END IF;
 IF public.taxi_bot_dispatch_paused(j.tenant_id,j.waba)THEN
  UPDATE public.taxi_bot_dispatch_jobs SET state='waiting',code='provider_paused',next_at=clock_timestamp()+interval '2 minutes',lease=NULL,lease_until=NULL,updated_at=clock_timestamp()WHERE trip_id=p_trip;
  RETURN jsonb_build_object('state','paused');
 END IF;
 IF p_error IS NULL THEN total:=public.taxi_bot_dispatch_offer(t.id,p_candidates,j.round_no+1);END IF;
 UPDATE public.taxi_bot_dispatch_jobs SET state='waiting',round_no=round_no+CASE WHEN total>0 THEN 1 ELSE 0 END,
  failures=CASE WHEN p_error IS NULL THEN 0 ELSE least(3,failures+1)END,code=CASE WHEN p_error IS NOT NULL THEN p_error WHEN total=0 THEN 'no_candidates'ELSE NULL END,
  next_at=clock_timestamp()+CASE WHEN total>0 THEN interval '90 seconds'ELSE interval '30 seconds'END,lease=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE trip_id=p_trip RETURNING * INTO j;
 IF j.failures>=3 OR j.scans>=12 AND total=0 THEN PERFORM public.taxi_bot_dispatch_attention(p_trip,CASE WHEN j.failures>=3 THEN 'fleet_unavailable'ELSE 'scan_limit'END);END IF;
 RETURN jsonb_build_object('state',CASE WHEN j.failures>=3 OR j.scans>=12 AND total=0 THEN 'attention'WHEN total>0 THEN 'offered'ELSE 'waiting'END,'offers',total,'round',j.round_no);
END $$;

CREATE FUNCTION public.taxi_bot_dispatch_trip_changed()RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF NEW.bot_managed AND NEW.estado<>'buscando_conductor'THEN
  UPDATE public.taxi_bot_dispatch_jobs SET state='done',lease=NULL,lease_until=NULL,updated_at=clock_timestamp()WHERE trip_id=NEW.id AND state<>'done';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER taxi_bot_dispatch_trip_changed AFTER UPDATE OF estado ON public.viajes FOR EACH ROW EXECUTE FUNCTION public.taxi_bot_dispatch_trip_changed();

CREATE FUNCTION public.taxi_bot_dispatch_delivery_changed()RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE control_key text:=coalesce(NEW.body->>'controlDedupe',NEW.dedupe_key);h public.taxi_bot_dispatch_health%ROWTYPE;BEGIN
 IF NEW.state NOT IN('failed','uncertain','accepted')OR OLD.state=NEW.state THEN RETURN NEW;END IF;
 IF NEW.state IN('failed','uncertain')AND(NEW.error_code IN('provider_not_configured','provider_result_unknown','provider_missing_id','provider_http_401','provider_http_403','provider_http_429')OR NEW.error_code~'^provider_http_5[0-9][0-9]$')THEN
  INSERT INTO public.taxi_bot_dispatch_health(tenant_id,waba)VALUES(NEW.tenant_id,NEW.waba)ON CONFLICT DO NOTHING;
  SELECT * INTO h FROM public.taxi_bot_dispatch_health WHERE tenant_id=NEW.tenant_id AND waba=NEW.waba FOR UPDATE;
  UPDATE public.taxi_bot_dispatch_health SET failures=CASE WHEN h.last_failure_at IS NULL OR h.last_failure_at<clock_timestamp()-interval '10 minutes'THEN 1 WHEN h.last_failure_at<clock_timestamp()-interval '30 seconds'THEN least(3,h.failures+1)ELSE greatest(1,h.failures)END,
   paused_until=clock_timestamp()+interval '2 minutes',last_failure_at=CASE WHEN h.last_failure_at IS NULL OR h.last_failure_at<clock_timestamp()-interval '30 seconds'THEN clock_timestamp()ELSE h.last_failure_at END,
   code=NEW.error_code,revision=revision+1,updated_at=clock_timestamp()WHERE tenant_id=NEW.tenant_id AND waba=NEW.waba;
 ELSIF NEW.state='accepted'AND OLD.state='sending'THEN
  UPDATE public.taxi_bot_dispatch_health SET failures=0,paused_until=NULL,code=NULL,revision=revision+1,updated_at=clock_timestamp()
   WHERE tenant_id=NEW.tenant_id AND waba=NEW.waba AND failures>0 AND NEW.created_at>last_failure_at;
 END IF;
 IF NEW.state='failed'AND control_key~'^offer:[0-9a-f-]{36}$'THEN
  UPDATE public.taxi_bot_offers SET state='revoked'WHERE id=substring(control_key FROM 7)::uuid AND tenant_id=NEW.tenant_id AND waba=NEW.waba AND state='offered';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER taxi_bot_dispatch_delivery_changed AFTER UPDATE OF state ON public.taxi_bot_outbox FOR EACH ROW EXECUTE FUNCTION public.taxi_bot_dispatch_delivery_changed();

CREATE FUNCTION public.taxi_bot_dispatch_status(p_tenant uuid,p_waba text)RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba)THEN RAISE EXCEPTION 'dispatch channel not found';END IF;
 RETURN jsonb_build_object('asOf',clock_timestamp(),'health',coalesce((SELECT jsonb_build_object('paused',public.taxi_bot_dispatch_paused(p_tenant,p_waba),'failures',failures,'code',code,'pausedUntil',paused_until,'revision',revision)FROM public.taxi_bot_dispatch_health WHERE tenant_id=p_tenant AND waba=p_waba),jsonb_build_object('paused',false,'failures',0,'code',NULL,'pausedUntil',NULL,'revision',0)),
  'jobs',coalesce((SELECT jsonb_agg(row ORDER BY row."updatedAt" DESC)FROM(SELECT j.trip_id AS "tripId",v.cliente_nombre AS name,v.cliente_tel AS customer,j.state,j.round_no AS round,j.scans,j.code,j.next_at AS "nextAt",j.deadline_at AS "deadlineAt",j.updated_at AS "updatedAt"
   FROM public.taxi_bot_dispatch_jobs j JOIN public.viajes v ON v.id=j.trip_id WHERE j.tenant_id=p_tenant AND j.waba=p_waba AND j.state<>'done'ORDER BY j.updated_at DESC LIMIT 50)row),'[]'));
END $$;

CREATE FUNCTION public.taxi_bot_dispatch_resume(p_tenant uuid,p_waba text,p_actor integer,p_request uuid,p_revision bigint)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE h public.taxi_bot_dispatch_health%ROWTYPE;BEGIN
 IF p_actor<=0 OR p_request IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'invalid dispatch control';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba)THEN RAISE EXCEPTION 'dispatch channel not found';END IF;
 INSERT INTO public.taxi_bot_dispatch_health(tenant_id,waba)VALUES(p_tenant,p_waba)ON CONFLICT DO NOTHING;
 SELECT * INTO h FROM public.taxi_bot_dispatch_health WHERE tenant_id=p_tenant AND waba=p_waba FOR UPDATE;
 IF h.last_request=p_request AND h.last_actor=p_actor THEN RETURN jsonb_build_object('state','resumed');END IF;
 IF h.revision<>p_revision THEN RETURN jsonb_build_object('state','conflict');END IF;
 UPDATE public.taxi_bot_dispatch_health SET failures=0,paused_until=NULL,code=NULL,revision=revision+1,last_request=p_request,last_actor=p_actor,updated_at=clock_timestamp()WHERE tenant_id=p_tenant AND waba=p_waba;
 RETURN jsonb_build_object('state','resumed');
END $$;

-- Extract the existing first-round loop; do not create a second booking path.
DO $patch$ DECLARE definition text;first_at integer;last_at integer;BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_commit(uuid,uuid,bigint,jsonb)'::regprocedure)INTO definition;
 first_at:=strpos(definition,'    IF jsonb_typeof(p_decision->''candidates'')');last_at:=strpos(definition,'    reply:=CASE WHEN count_offers>0');
 IF first_at=0 OR last_at<=first_at THEN RAISE EXCEPTION 'review current taxi commit before dispatch migration';END IF;
 definition:=substring(definition FROM 1 FOR first_at-1)||'    count_offers:=public.taxi_bot_dispatch_start(tid,p_decision->''candidates'',p_decision->>''reason''=''fleet_lookup_deferred'');'||E'\n'||substring(definition FROM last_at);
 definition:=replace(definition,'🚕 Tu solicitud quedó registrada, pero todavía no hay unidad disponible para ofrecerla. La base debe revisarla.','🚕 Tu solicitud quedó registrada. La búsqueda de unidad sigue pendiente; todavía no hay taxi confirmado.');
 definition:=replace(definition,'WHERE dedupe_key=''reply:''||e.id||'':''||idx AND','WHERE dedupe_key IN(''reply:''||e.id||'':''||idx,''reply:''||e.id||'':''||idx||'':details'') AND');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.taxi_bot_begin(uuid)'::regprocedure)INTO definition;
 IF strpos(definition,'''taxiName'',taxi_name)')=0 THEN RAISE EXCEPTION 'review current taxi begin before dispatch migration';END IF;
 definition:=replace(definition,'''taxiName'',taxi_name)','''taxiName'',taxi_name,''dispatchAttention'',EXISTS(SELECT 1 FROM public.taxi_bot_dispatch_jobs j WHERE j.trip_id=viajes.id AND(j.state=''attention''OR j.deadline_at<=clock_timestamp()))OR public.taxi_bot_dispatch_paused(viajes.tenant_id,viajes.bot_waba))');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.taxi_bot_outbox_claim(uuid,text)'::regprocedure)INTO definition;
 IF strpos(definition,'  RETURN QUERY WITH picked AS')=0 THEN RAISE EXCEPTION 'review current taxi outbox before dispatch migration';END IF;
 definition:=replace(definition,'b.dedupe_key','coalesce(b.body->>''controlDedupe'',b.dedupe_key)');
 definition:=replace(definition,'  RETURN QUERY WITH picked AS','  IF public.taxi_bot_dispatch_paused(p_tenant,p_waba)THEN RETURN;END IF;'||E'\n'||'  RETURN QUERY WITH picked AS');EXECUTE definition;
 SELECT pg_get_functiondef('public.taxi_bot_lifecycle_guard()'::regprocedure)INTO definition;
 IF strpos(definition,'IF NOT coalesce(allowed,false)THEN')=0 THEN RAISE EXCEPTION 'review delivery lifecycle before dispatch migration';END IF;
 definition:=replace(definition,'IF NOT coalesce(allowed,false)THEN',
  'IF TG_TABLE_NAME=''taxi_bot_outbox''AND TG_OP=''UPDATE''THEN IF OLD.state=''sending''AND NEW.state=''pending''AND OLD.provider_id IS NULL AND NEW.provider_id IS NULL AND NEW.lease IS NULL AND current_setting(''app.taxi_dispatch_unsent_release'',true)=OLD.id::text||'':''||OLD.lease::text AND public.taxi_bot_dispatch_paused(OLD.tenant_id,OLD.waba)THEN allowed:=true;END IF;END IF;'||E'\n'||' IF NOT coalesce(allowed,false)THEN');
 EXECUTE definition;
END $patch$;

CREATE OR REPLACE FUNCTION public.taxi_bot_outbox_permitted(p_id uuid,p_lease uuid)RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.taxi_bot_outbox b WHERE b.id=p_id AND b.lease=p_lease AND b.state='sending'
 AND public.taxi_bot_recipient_allowed(b.tenant_id,b.waba,b.destination)AND NOT public.taxi_bot_dispatch_paused(b.tenant_id,b.waba)
 AND NOT(coalesce(b.body->>'controlDedupe',b.dedupe_key)LIKE 'reply:%'AND EXISTS(SELECT 1 FROM public.taxi_bot_sessions s WHERE s.tenant_id=b.tenant_id AND s.waba=b.waba AND s.customer=b.destination AND s.last_reset_revision IS NOT NULL
   AND NOT CASE WHEN jsonb_typeof(b.body->'conversationRevision')='number'THEN(b.body->>'conversationRevision')::numeric>=s.last_reset_revision ELSE false END))
 AND(NOT(b.body?'locationRequest')OR public.taxi_bot_location_request_current(b.tenant_id,b.waba,b.destination,b.body))
 AND(coalesce(b.body->>'controlDedupe',b.dedupe_key)NOT LIKE 'offer:%'OR EXISTS(SELECT 1 FROM public.taxi_bot_offers o JOIN public.viajes v ON v.id=o.trip_id WHERE coalesce(b.body->>'controlDedupe',b.dedupe_key)='offer:'||o.id AND o.state='offered'AND o.expires_at>clock_timestamp()AND v.estado='buscando_conductor')));
$$;

-- Release only an unsent claim when the channel circuit opened. An uncertain
-- provider request is never returned to pending by this function.
CREATE FUNCTION public.taxi_bot_dispatch_send_check(p_id uuid,p_lease uuid)RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b public.taxi_bot_outbox%ROWTYPE;BEGIN
 SELECT * INTO b FROM public.taxi_bot_outbox WHERE id=p_id AND lease=p_lease AND state='sending'FOR UPDATE;
 IF NOT FOUND THEN RETURN 'stale';END IF;
 IF public.taxi_bot_dispatch_paused(b.tenant_id,b.waba)THEN
  PERFORM set_config('app.taxi_dispatch_unsent_release',b.id::text||':'||b.lease::text,true);
  UPDATE public.taxi_bot_outbox SET state='pending',lease=NULL,lease_until=NULL,updated_at=clock_timestamp()WHERE id=b.id;
  PERFORM set_config('app.taxi_dispatch_unsent_release','',true);
  RETURN 'paused';
 END IF;
 RETURN CASE WHEN public.taxi_bot_outbox_permitted(p_id,p_lease)THEN 'ready'ELSE 'denied'END;
END $$;

-- Existing pending requests join the same recovery queue; this migration sends nothing.
INSERT INTO public.taxi_bot_dispatch_jobs(trip_id,tenant_id,waba,round_no,next_at,deadline_at)
SELECT v.id,v.tenant_id,v.bot_waba,CASE WHEN EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE trip_id=v.id)THEN 1 ELSE 0 END,
 coalesce((SELECT max(expires_at)FROM public.taxi_bot_offers WHERE trip_id=v.id AND state='offered'),clock_timestamp()),v.created_at+interval '12 minutes'
FROM public.viajes v JOIN public.taxi_bot_channels c ON c.tenant_id=v.tenant_id AND c.waba=v.bot_waba
WHERE v.bot_managed AND v.estado='buscando_conductor'AND v.created_at>clock_timestamp()-interval '12 minutes'ON CONFLICT DO NOTHING;

DO $$DECLARE fn record;BEGIN FOR fn IN SELECT p.oid::regprocedure signature,p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'AND p.proname LIKE 'taxi_bot_dispatch_%'LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature);
 IF fn.name IN('taxi_bot_dispatch_eligible','taxi_bot_dispatch_claim','taxi_bot_dispatch_complete','taxi_bot_dispatch_status','taxi_bot_dispatch_resume','taxi_bot_dispatch_send_check')THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature);END IF;
END LOOP;END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_emit(uuid,text,text,text,text,jsonb)FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
