-- Wait for 15 seconds of silence before interpreting a customer's WhatsApp burst.
-- The customer-scoped session lock and event lease still make the batch durable and idempotent.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.taxi_bot_begin(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.taxi_bot_events%ROWTYPE;s public.taxi_bot_sessions%ROWTYPE;l uuid;batch jsonb;trip jsonb;claimed_event uuid;BEGIN
  SELECT * INTO e FROM public.taxi_bot_events WHERE id=p_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi event not found';END IF;
  PERFORM 1 FROM public.taxi_bot_customer_access WHERE tenant_id=e.tenant_id FOR SHARE;
  IF NOT public.taxi_bot_inbound_allowed(e.tenant_id,e.waba,e.message) THEN
    UPDATE public.taxi_bot_events SET state='completed',lease=NULL WHERE id=e.id AND state IN('pending','processing');
    UPDATE public.webhook_queue SET status='done',processed_at=clock_timestamp() WHERE id=e.queue_id;
    RETURN jsonb_build_object('state','blocked');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(e.tenant_id::text||e.waba||e.customer,1));
  IF e.state IN('completed','human')THEN RETURN jsonb_build_object('state','replay');END IF;
  INSERT INTO public.taxi_bot_sessions(tenant_id,waba,customer)VALUES(e.tenant_id,e.waba,e.customer)ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM public.taxi_bot_sessions WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer FOR UPDATE;
  IF s.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('state','busy');END IF;
  IF EXISTS(SELECT 1 FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='pending' AND received_at>clock_timestamp()-interval '15 seconds')THEN RETURN jsonb_build_object('state','debounce');END IF;
  -- Short global reservation lock, never held during a model or GPS request.
  PERFORM pg_advisory_xact_lock(771404,2200);
  IF(SELECT count(*) FROM public.taxi_bot_sessions WHERE lease_until>clock_timestamp())>=4
    OR(SELECT count(*)FROM public.taxi_bot_sessions WHERE tenant_id=e.tenant_id AND lease_until>clock_timestamp())>=2
    OR(SELECT coalesce(sum(attempts),0)FROM public.taxi_bot_events WHERE received_at>clock_timestamp()-interval '10 minutes')>=600
    OR(SELECT coalesce(sum(attempts),0)FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND received_at>clock_timestamp()-interval '10 minutes')>=180
  THEN RETURN jsonb_build_object('state','limited');END IF;
  -- Only read-only interpretation may repeat after an expired lease, at most three times.
  UPDATE public.taxi_bot_events SET state='human',reason='attempts_exhausted' WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state IN('pending','processing')AND attempts>=3;
  IF EXISTS(SELECT 1 FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='human' AND completed_at IS NULL)THEN
    UPDATE public.taxi_bot_sessions SET mode='human' WHERE id=s.id;s.mode:='human';
    PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,'No pude completar la solicitud. La base necesita revisarla antes de buscar una unidad.','attempts-customer:'||s.id||':'||s.revision);
    PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,c.dispatcher,'Una solicitud agotó sus intentos de interpretación. Revisa el contacto '||e.customer,'attempts-dispatch:'||s.id||':'||s.revision)
      FROM public.taxi_bot_channels c WHERE c.tenant_id=e.tenant_id AND c.waba=e.waba AND c.dispatcher IS NOT NULL;
    UPDATE public.taxi_bot_events SET completed_at=clock_timestamp()WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='human'AND completed_at IS NULL;
    UPDATE public.webhook_queue SET status='done',processed_at=clock_timestamp()WHERE id IN(SELECT queue_id FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='human');
  END IF;
  UPDATE public.taxi_bot_events SET state='completed',reason='stale_source',completed_at=clock_timestamp() WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state IN('pending','processing')AND source_at<s.last_source_at;
  UPDATE public.webhook_queue SET status='done',processed_at=clock_timestamp()WHERE id IN(SELECT queue_id FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state='completed'AND reason='stale_source');
  IF EXISTS(SELECT 1 FROM public.taxi_bot_events WHERE id=p_event AND state='completed')THEN RETURN jsonb_build_object('state','replay');END IF;
  l:=gen_random_uuid();
  WITH picked AS(SELECT id FROM public.taxi_bot_events WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer AND state IN('pending','processing')AND attempts<3 ORDER BY source_at,received_at,id LIMIT 20 FOR UPDATE)
    UPDATE public.taxi_bot_events SET state='processing',lease=l,attempts=attempts+1 WHERE id IN(SELECT id FROM picked);
  SELECT jsonb_agg(message ORDER BY source_at,received_at,id)INTO batch FROM public.taxi_bot_events WHERE lease=l AND state='processing';
  IF batch IS NULL THEN RETURN jsonb_build_object('state','replay');END IF;
  UPDATE public.taxi_bot_sessions SET lease=l,lease_until=clock_timestamp()+interval '2 minutes' WHERE id=s.id;
  SELECT id INTO claimed_event FROM public.taxi_bot_events WHERE lease=l AND state='processing'ORDER BY source_at,received_at,id LIMIT 1;
  SELECT jsonb_build_object('id',id,'state',estado,'taxiName',taxi_name) INTO trip FROM public.viajes WHERE tenant_id=e.tenant_id AND cliente_tel=e.customer AND (bot_waba=e.waba OR bot_waba IS NULL)AND estado IN('buscando_conductor','en_camino')ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('state','proceed','eventId',claimed_event,'tenantId',e.tenant_id,'waba',e.waba,'lease',l,'messages',batch,'session',jsonb_build_object('revision',s.revision,'mode',s.mode,'draft',s.draft,'history',s.history,'active',trip));
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_pending()
RETURNS SETOF public.taxi_bot_events LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT e.* FROM public.taxi_bot_events e JOIN public.taxi_bot_channels c ON c.tenant_id=e.tenant_id AND c.waba=e.waba AND c.enabled
  WHERE(e.state='pending'OR(e.state='processing'AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_sessions s WHERE s.tenant_id=e.tenant_id AND s.waba=e.waba AND s.customer=e.customer AND s.lease_until>clock_timestamp())))
  AND e.received_at<clock_timestamp()-interval '15 seconds'
  AND NOT EXISTS(SELECT 1 FROM public.taxi_bot_events newer WHERE newer.tenant_id=e.tenant_id AND newer.waba=e.waba AND newer.customer=e.customer AND newer.state='pending' AND newer.received_at>=clock_timestamp()-interval '15 seconds')
  ORDER BY e.received_at LIMIT 10;
$$;

REVOKE ALL ON FUNCTION public.taxi_bot_begin(uuid),public.taxi_bot_pending() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.taxi_bot_begin(uuid),public.taxi_bot_pending() TO service_role;
COMMIT;
