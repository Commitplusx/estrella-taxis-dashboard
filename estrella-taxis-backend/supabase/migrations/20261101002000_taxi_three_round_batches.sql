-- Three simultaneous offers, one shared three-minute deadline per round.
-- Preserve the existing booking, outbox, acceptance locks and provider circuit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
ALTER TABLE public.taxi_bot_dispatch_jobs
 ADD COLUMN choice_token uuid,
 ADD COLUMN choice_expires_at timestamptz,
 ADD COLUMN continuations integer NOT NULL DEFAULT 0 CHECK(continuations BETWEEN 0 AND 1);
ALTER TABLE public.taxi_bot_dispatch_jobs ADD CONSTRAINT taxi_dispatch_choice_pair
 CHECK((choice_token IS NULL)=(choice_expires_at IS NULL));
CREATE UNIQUE INDEX taxi_dispatch_current_choice ON public.taxi_bot_dispatch_jobs(choice_token) WHERE choice_token IS NOT NULL;

DO $patch$
DECLARE definition text;previous text;replacement text;
BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_dispatch_offer(uuid,jsonb,integer)'::regprocedure)INTO definition;
 previous:='p_round NOT BETWEEN 1 AND 4';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review offer round validation';END IF;
 definition:=replace(definition,previous,'p_round NOT BETWEEN 1 AND 3');
 previous:='o public.taxi_bot_offers%ROWTYPE;item jsonb;total integer:=0;BEGIN';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review offer deadline declaration';END IF;
 definition:=replace(definition,previous,'o public.taxi_bot_offers%ROWTYPE;item jsonb;total integer:=0;round_deadline timestamptz:=clock_timestamp()+interval ''3 minutes'';BEGIN');
 previous:='clock_timestamp()+interval ''60 seconds''';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review offer deadline';END IF;
 definition:=replace(definition,previous,'round_deadline');
 previous:='  EXIT;'||E'\n'||' END LOOP;';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review simultaneous offer loop';END IF;
 definition:=replace(definition,previous,' END LOOP;');
 previous:='Tienes 1 minuto para responder con los botones.';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review offer copy';END IF;
 definition:=replace(definition,previous,'Tienes 3 minutos para responder. La primera unidad que acepte se queda con el viaje.');
 EXECUTE definition;

 SELECT pg_get_functiondef('public.taxi_bot_dispatch_delivery_changed()'::regprocedure)INTO definition;
 previous:=substring(definition FROM strpos(definition,' -- Start the response minute') FOR strpos(definition,' IF NEW.state NOT IN(')-strpos(definition,' -- Start the response minute'));
 IF length(previous)=0 THEN RAISE EXCEPTION 'Review shared round delivery deadline';END IF;
 -- A provider callback must never give one taxi more time than its round peers.
 EXECUTE replace(definition,previous,E' -- All offers retain the common round deadline; callbacks never extend or revive it.\n');

 SELECT pg_get_functiondef('public.taxi_bot_dispatch_eligible(uuid,text,integer[])'::regprocedure)INTO definition;
 IF strpos(definition,'cardinality(p_excluded)>12')=0 THEN RAISE EXCEPTION 'Review bounded dispatch exclusions';END IF;
 EXECUTE replace(definition,'cardinality(p_excluded)>12','cardinality(p_excluded)>18');

 SELECT pg_get_functiondef('public.taxi_bot_dispatch_start(uuid,jsonb,boolean)'::regprocedure)INTO definition;
 IF strpos(definition,'interval ''60 seconds''')=0 OR strpos(definition,'t.created_at+interval ''12 minutes''')=0 THEN RAISE EXCEPTION 'Review first batch schedule';END IF;
 definition:=replace(definition,'interval ''60 seconds''','interval ''3 minutes''');
 EXECUTE replace(definition,'t.created_at+interval ''12 minutes''','clock_timestamp()+interval ''9 minutes''');

 SELECT pg_get_functiondef('public.taxi_bot_dispatch_complete(uuid,uuid,jsonb,text)'::regprocedure)INTO definition;
 previous:=' IF t.estado<>''buscando_conductor''OR j.deadline_at<=clock_timestamp()THEN';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review batch completion terminal check';END IF;
 definition:=replace(definition,previous,' IF t.estado<>''buscando_conductor''THEN');
 previous:=' IF public.taxi_bot_dispatch_paused(j.tenant_id,j.waba)THEN';
 replacement:=$limit$ IF j.deadline_at<=clock_timestamp()OR j.round_no>=3 THEN
  PERFORM public.taxi_bot_dispatch_attention(p_trip,CASE WHEN j.round_no>=3 THEN 'round_limit'ELSE 'deadline_limit'END);
  RETURN jsonb_build_object('state','attention','offers',0,'round',j.round_no);
 END IF;
$limit$||previous;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review batch completion limit';END IF;
 definition:=replace(definition,previous,replacement);
 IF strpos(definition,'interval ''60 seconds''')=0 THEN RAISE EXCEPTION 'Review next batch schedule';END IF;
 EXECUTE replace(definition,'interval ''60 seconds''','interval ''3 minutes''');
END $patch$;

-- Lock the trip before its job, as the acceptance and completion paths do.
CREATE OR REPLACE FUNCTION public.taxi_bot_dispatch_attention(p_trip uuid,p_code text)RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public.taxi_bot_dispatch_jobs%ROWTYPE;t public.viajes%ROWTYPE;choice boolean;BEGIN
 SELECT * INTO t FROM public.viajes WHERE id=p_trip AND bot_managed AND estado='buscando_conductor'FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO j FROM public.taxi_bot_dispatch_jobs WHERE trip_id=p_trip FOR UPDATE;
 IF NOT FOUND OR j.state NOT IN('waiting','leased')THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE trip_id=p_trip AND state='offered'AND expires_at>clock_timestamp())THEN RETURN;END IF;
 choice:=p_code IN('round_limit','deadline_limit','scan_limit');
 IF choice AND j.continuations=0 THEN
  UPDATE public.taxi_bot_dispatch_jobs SET state='attention',code='customer_choice',lease=NULL,lease_until=NULL,
   choice_token=gen_random_uuid(),choice_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp()
  WHERE trip_id=p_trip RETURNING * INTO j;
  PERFORM public.taxi_bot_emit(j.tenant_id,j.waba,t.cliente_tel,
   '🚕 Todavía no conseguimos una unidad. ¿Buscamos hasta 9 minutos más o prefieres cancelar? 😊 Si no eliges en 5 minutos, cerraremos esta solicitud.',
   'dispatch-choice:'||p_trip||':'||j.choice_token,
   jsonb_build_array(jsonb_build_object('id','txw_'||j.choice_token,'title','Seguir esperando'),jsonb_build_object('id','txk_'||j.choice_token,'title','Cancelar solicitud')));
 ELSE
  UPDATE public.taxi_bot_dispatch_jobs SET state='attention',code=CASE WHEN choice THEN 'search_exhausted'ELSE p_code END,
   lease=NULL,lease_until=NULL,choice_token=NULL,choice_expires_at=NULL,updated_at=clock_timestamp()
  WHERE trip_id=p_trip RETURNING * INTO j;
  IF j.notified_at IS NULL THEN
   PERFORM public.taxi_bot_emit(j.tenant_id,j.waba,t.cliente_tel,
    '🚕 Aún no tenemos una unidad confirmada. La base necesita revisar tu solicitud para ayudarte; no hay un taxi asignado.',
    'dispatch-attention:'||p_trip);
  END IF;
 END IF;
 UPDATE public.taxi_bot_dispatch_jobs SET notified_at=clock_timestamp()WHERE trip_id=p_trip;
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_dispatch_claim()RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public.taxi_bot_dispatch_jobs%ROWTYPE;t public.viajes%ROWTYPE;BEGIN
 FOR t IN SELECT v.* FROM public.viajes v JOIN public.taxi_bot_dispatch_jobs q ON q.trip_id=v.id
  WHERE q.state IN('waiting','leased')AND v.estado='buscando_conductor'
  AND NOT(q.state='leased'AND q.lease_until>clock_timestamp())
  AND(q.deadline_at<=clock_timestamp()OR q.scans>=12 OR q.round_no>=3 AND q.next_at<=clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_offers o WHERE o.trip_id=q.trip_id AND o.state='offered'AND o.expires_at>clock_timestamp())
  ORDER BY q.next_at,q.trip_id LIMIT 20 FOR UPDATE OF v SKIP LOCKED LOOP
   SELECT * INTO j FROM public.taxi_bot_dispatch_jobs WHERE trip_id=t.id FOR UPDATE;
   PERFORM public.taxi_bot_dispatch_attention(t.id,CASE WHEN j.round_no>=3 THEN 'round_limit'WHEN j.scans>=12 THEN 'scan_limit'ELSE 'deadline_limit'END);
 END LOOP;
 FOR t IN SELECT v.* FROM public.viajes v JOIN public.taxi_bot_dispatch_jobs q ON q.trip_id=v.id
  JOIN public.taxi_bot_channels c ON c.tenant_id=q.tenant_id AND c.waba=q.waba AND c.enabled
  WHERE(q.state='waiting'OR q.state='leased'AND q.lease_until<=clock_timestamp())AND q.next_at<=clock_timestamp()
  AND v.estado='buscando_conductor'AND q.deadline_at>clock_timestamp()AND q.round_no<3 AND q.scans<12
  AND NOT public.taxi_bot_dispatch_paused(q.tenant_id,q.waba)
  AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_offers o WHERE o.trip_id=q.trip_id AND o.state='offered'AND o.expires_at>clock_timestamp())
  ORDER BY q.next_at,q.trip_id LIMIT 2 FOR UPDATE OF v SKIP LOCKED LOOP
   UPDATE public.taxi_bot_dispatch_jobs SET state='leased',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',scans=scans+1,updated_at=clock_timestamp()
   WHERE trip_id=t.id AND(state='waiting'OR state='leased'AND lease_until<=clock_timestamp())RETURNING * INTO j;
   IF NOT FOUND THEN CONTINUE;END IF;
   RETURN NEXT jsonb_build_object('tripId',j.trip_id,'tenantId',j.tenant_id,'waba',j.waba,'lease',j.lease,
    'origin',jsonb_build_object('text',t.origen,'lat',t.origen_lat,'lng',t.origen_lng,'placeId',NULL,'source','gps'),
    'excluded',coalesce((SELECT jsonb_agg(device_id ORDER BY device_id)FROM public.taxi_bot_offers WHERE trip_id=j.trip_id),'[]'));
 END LOOP;
END $$;

-- Only the currently issued native button for this customer's trip can resume.
-- One explicit extension is bounded to another three rounds / nine new units.
CREATE FUNCTION public.taxi_bot_dispatch_customer_choice(p_tenant uuid,p_waba text,p_customer text,p_token uuid,p_cancel boolean)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public.taxi_bot_dispatch_jobs%ROWTYPE;t public.viajes%ROWTYPE;BEGIN
 SELECT v.* INTO t FROM public.viajes v JOIN public.taxi_bot_dispatch_jobs q ON q.trip_id=v.id
 WHERE q.choice_token=p_token AND q.tenant_id=p_tenant AND q.waba=p_waba
 AND v.tenant_id=p_tenant AND v.bot_waba=p_waba AND v.cliente_tel=p_customer AND v.bot_managed FOR UPDATE OF v;
 IF NOT FOUND OR t.estado<>'buscando_conductor'THEN RETURN jsonb_build_object('state','stale');END IF;
 SELECT * INTO j FROM public.taxi_bot_dispatch_jobs WHERE trip_id=t.id FOR UPDATE;
 IF j.state<>'attention'OR j.code<>'customer_choice'OR j.choice_token IS DISTINCT FROM p_token
 OR j.choice_expires_at<=clock_timestamp()OR EXISTS(SELECT 1 FROM public.taxi_bot_offers WHERE trip_id=t.id AND state='offered'AND expires_at>clock_timestamp())
 THEN RETURN jsonb_build_object('state','stale');END IF;
 IF p_cancel THEN RETURN jsonb_build_object('state','cancel','tripId',t.id);END IF;
 IF j.continuations>=1 OR public.taxi_bot_dispatch_paused(p_tenant,p_waba)THEN RETURN jsonb_build_object('state','paused');END IF;
 UPDATE public.taxi_bot_dispatch_jobs SET state='waiting',round_no=0,scans=0,failures=0,code='customer_continued',
  continuations=continuations+1,choice_token=NULL,choice_expires_at=NULL,next_at=clock_timestamp(),
  deadline_at=clock_timestamp()+interval '9 minutes',lease=NULL,lease_until=NULL,notified_at=NULL,updated_at=clock_timestamp()
 WHERE trip_id=t.id;
 RETURN jsonb_build_object('state','continued','tripId',t.id);
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_dispatch_customer_choice(uuid,text,text,uuid,boolean)FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE definition text;previous text;replacement text;
BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_commit(uuid,uuid,bigint,jsonb)'::regprocedure)INTO definition;
 previous:='  IF a=''confirm''THEN';
 replacement:=$choice$  -- Read native input from the durable event, never from a model-proposed action.
  IF a='reply'AND s.mode='bot'AND e.message->>'type'='button'AND e.message->>'button'~'^tx[wk]_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND(SELECT count(*)FROM public.taxi_bot_events WHERE lease=p_lease AND state='processing')=1 THEN
   item:=public.taxi_bot_dispatch_customer_choice(e.tenant_id,e.waba,e.customer,substring(e.message->>'button'FROM 5)::uuid,left(e.message->>'button',4)='txk_');
   IF item->>'state'='cancel'THEN
    a:='cancel';p_decision:=jsonb_set(p_decision,'{tripId}',item->'tripId');
   ELSE
    reply:=CASE item->>'state'WHEN 'continued'THEN '🚕 Seguimos buscando otras unidades por hasta 9 minutos más. Te aviso cuando alguna acepte. 😊'
     WHEN 'paused'THEN 'Los avisos están en pausa. La base debe revisar la conexión antes de seguir buscando; tu solicitud sigue guardada.'
     ELSE 'Esa opción ya no está disponible. No cambié tu solicitud actual.'END;
    PERFORM set_config('app.taxi_reply_class','change',true);
    PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,reply,'reply:'||e.id||':1');
    p_decision:=jsonb_set(p_decision,'{messages}','[]');
   END IF;
  END IF;
$choice$||previous;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review customer choice commit entry';END IF;
 definition:=replace(definition,previous,replacement);
 previous:='Esa oferta venció o el viaje ya cambió de estado. No se hizo otra asignación.';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review stale offer response';END IF;
 EXECUTE replace(definition,previous,'🚕 Esta oferta ya no está disponible: venció la ronda o una unidad ya aceptó el viaje.');

 SELECT pg_get_functiondef('public.taxi_bot_begin(uuid)'::regprocedure)INTO definition;
 previous:='''taxiName'',taxi_name,';
 replacement:=$session$'taxiName',taxi_name,'dispatchChoice',(SELECT jsonb_build_object('token',j.choice_token,'expiresAt',j.choice_expires_at)FROM public.taxi_bot_dispatch_jobs j
 WHERE j.trip_id=viajes.id AND j.state='attention'AND j.code='customer_choice'AND j.choice_expires_at>clock_timestamp()),$session$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review active trip choice session';END IF;
 EXECUTE replace(definition,previous,replacement);

 SELECT pg_get_functiondef('public.taxi_bot_maintain()'::regprocedure)INTO definition;
 previous:='  FOR t IN SELECT v.*';
 replacement:=$maintain$  -- Due jobs are paused with a question before the older timeout can close them.
  FOR t IN SELECT v.* FROM public.viajes v JOIN public.taxi_bot_dispatch_jobs j ON j.trip_id=v.id
   WHERE v.bot_managed AND v.estado='buscando_conductor'AND j.state IN('waiting','leased')
   AND j.deadline_at<=clock_timestamp()AND NOT(j.state='leased'AND j.lease_until>clock_timestamp())
   AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_offers o WHERE o.trip_id=v.id AND o.state='offered'AND o.expires_at>clock_timestamp())
   ORDER BY j.deadline_at LIMIT 20 FOR UPDATE OF v SKIP LOCKED LOOP
    PERFORM public.taxi_bot_dispatch_attention(t.id,'deadline_limit');
  END LOOP;
$maintain$||previous;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review choice maintenance';END IF;
 definition:=replace(definition,previous,replacement);
 previous:='AND v.created_at<clock_timestamp()-interval ''12 minutes''';
 replacement:=$timeout$AND(
    EXISTS(SELECT 1 FROM public.taxi_bot_dispatch_jobs j WHERE j.trip_id=v.id AND j.choice_expires_at<=clock_timestamp())
    OR v.created_at<clock_timestamp()-interval '12 minutes'AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_dispatch_jobs j WHERE j.trip_id=v.id
     AND(j.state IN('waiting','leased')OR j.choice_token IS NOT NULL OR j.updated_at>clock_timestamp()-interval '5 minutes')))
$timeout$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review legacy timeout coexistence';END IF;
 EXECUTE replace(definition,previous,replacement);

 SELECT pg_get_functiondef('public.taxi_bot_outbox_permitted(uuid,uuid)'::regprocedure)INTO definition;
 previous:=' AND(NOT(b.body?''locationRequest'')';
 replacement:=$output$ AND(coalesce(b.body->>'controlDedupe',b.dedupe_key)NOT LIKE 'dispatch-choice:%'OR EXISTS(
  SELECT 1 FROM public.taxi_bot_dispatch_jobs j JOIN public.viajes v ON v.id=j.trip_id
  WHERE j.tenant_id=b.tenant_id AND j.waba=b.waba AND v.cliente_tel=b.destination AND v.estado='buscando_conductor'
  AND j.state='attention'AND j.code='customer_choice'AND j.choice_expires_at>clock_timestamp()
  AND coalesce(b.body->>'controlDedupe',b.dedupe_key)='dispatch-choice:'||j.trip_id||':'||j.choice_token))
$output$||previous;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review waiting choice output staleness';END IF;
 definition:=replace(definition,previous,replacement);
 previous:=' AND(NOT(b.body?''locationRequest'')';
 replacement:=$reply$ AND(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.body->'buttons')='array'THEN b.body->'buttons'ELSE '[]'END)c WHERE c->>'id'~'^tx[wk]_')
  OR EXISTS(SELECT 1 FROM public.taxi_bot_dispatch_jobs j JOIN public.viajes v ON v.id=j.trip_id
   WHERE j.tenant_id=b.tenant_id AND j.waba=b.waba AND v.cliente_tel=b.destination AND v.estado='buscando_conductor'
   AND j.state='attention'AND j.code='customer_choice'AND j.choice_expires_at>clock_timestamp()
   AND(b.body->'buttons'@>jsonb_build_array(jsonb_build_object('id','txw_'||j.choice_token))
    OR b.body->'buttons'@>jsonb_build_array(jsonb_build_object('id','txk_'||j.choice_token)))))
$reply$||previous;
 EXECUTE replace(definition,previous,replacement);

 SELECT pg_get_functiondef('public.taxi_bot_emit(uuid,text,text,text,text,jsonb)'::regprocedure)INTO definition;
 previous:='OR p_key LIKE ''attempts-customer:%'' OR p_key LIKE ''dispatch-attention:%''';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review choice message budget classification';END IF;
 definition:=replace(definition,previous,previous||' OR p_key LIKE ''dispatch-choice:%''');
 previous:='IF p_key LIKE ''attempts-customer:%'' THEN category:=''question'';END IF;';
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review choice question message budget';END IF;
 EXECUTE replace(definition,previous,'IF p_key LIKE ''attempts-customer:%'' OR p_key LIKE ''dispatch-choice:%'' THEN category:=''question'';END IF;');
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
