-- Local candidate. No telemetry is sent to an external vendor.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.taxi_bot_quality_secret(id boolean PRIMARY KEY DEFAULT true CHECK(id),salt text NOT NULL);
INSERT INTO public.taxi_bot_quality_secret(salt)VALUES(gen_random_uuid()::text||gen_random_uuid()::text);
CREATE TABLE public.taxi_bot_quality_contacts(tenant_id uuid NOT NULL,waba text NOT NULL,contact_hash text NOT NULL,cohort text NOT NULL CHECK(cohort IN('train','validation','holdout')),inspected_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,waba,contact_hash),FOREIGN KEY(tenant_id,waba)REFERENCES public.taxi_bot_channels(tenant_id,waba));
CREATE TABLE public.taxi_bot_turn_traces(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES public.taxi_bot_events(id),tenant_id uuid NOT NULL,waba text NOT NULL,lease uuid NOT NULL,revision bigint NOT NULL,
 contact_hash text NOT NULL,event_ids uuid[]NOT NULL CHECK(cardinality(event_ids)BETWEEN 1 AND 20),source_hashes jsonb NOT NULL,
 state text NOT NULL DEFAULT 'running'CHECK(state IN('running','committed','superseded','error','abandoned')),meta jsonb NOT NULL CHECK(octet_length(meta::text)<=2048),
 phase_before text NOT NULL,phase_after text,action text,reason text,packet jsonb CHECK(packet IS NULL OR octet_length(packet::text)<=32768),
 context_private jsonb NOT NULL CHECK(octet_length(context_private::text)<=65536),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz,UNIQUE(event_id,lease),
 FOREIGN KEY(tenant_id,waba,contact_hash)REFERENCES public.taxi_bot_quality_contacts(tenant_id,waba,contact_hash));
CREATE INDEX taxi_bot_traces_scope ON public.taxi_bot_turn_traces(tenant_id,waba,started_at DESC,id);
CREATE INDEX taxi_bot_traces_running ON public.taxi_bot_turn_traces(started_at)WHERE state='running';
CREATE INDEX taxi_bot_traces_retention ON public.taxi_bot_turn_traces(started_at);
CREATE TABLE public.taxi_bot_lifecycle_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL,waba text NOT NULL,entity text NOT NULL,entity_id uuid NOT NULL,previous text,next text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX taxi_bot_lifecycle_scope ON public.taxi_bot_lifecycle_audit(tenant_id,waba,created_at DESC);
CREATE INDEX taxi_bot_lifecycle_retention ON public.taxi_bot_lifecycle_audit(created_at);
CREATE TABLE public.taxi_bot_quality_cases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),trace_id uuid UNIQUE REFERENCES public.taxi_bot_turn_traces(id)ON DELETE SET NULL,tenant_id uuid NOT NULL,waba text NOT NULL,contact_hash text NOT NULL,cohort text NOT NULL,label text NOT NULL CHECK(label IN('correct','interpretation_error','policy_error','external_failure','incomplete')),revision bigint NOT NULL,reviewer bigint NOT NULL,source_hashes jsonb NOT NULL,context_private jsonb NOT NULL,expected_private jsonb,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(tenant_id,waba,contact_hash)REFERENCES public.taxi_bot_quality_contacts(tenant_id,waba,contact_hash));
CREATE INDEX taxi_bot_cases_export ON public.taxi_bot_quality_cases(tenant_id,waba,cohort,id);
CREATE INDEX taxi_bot_cases_reviewed ON public.taxi_bot_quality_cases(tenant_id,waba,reviewed_at);
CREATE INDEX taxi_bot_cases_retention ON public.taxi_bot_quality_cases(reviewed_at);
CREATE TABLE public.taxi_bot_quality_reviews(actor bigint NOT NULL,request_id uuid NOT NULL,command jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor,request_id));
CREATE INDEX taxi_bot_reviews_retention ON public.taxi_bot_quality_reviews(created_at);
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['taxi_bot_quality_secret','taxi_bot_quality_contacts','taxi_bot_turn_traces','taxi_bot_lifecycle_audit','taxi_bot_quality_cases','taxi_bot_quality_reviews']LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);END LOOP;END $$;

CREATE FUNCTION public.taxi_bot_phase(p_mode text,p_draft jsonb,p_trip text,p_now timestamptz DEFAULT clock_timestamp())RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN p_mode='human'THEN 'human'WHEN p_trip='buscando_conductor'THEN 'searching'WHEN p_trip='en_camino'THEN 'en_route'
 WHEN p_draft->>'pendingLocation'IS NOT NULL OR p_draft->>'awaitingLocation'='choice'THEN 'location_role'
 WHEN p_draft->>'origin'IS NULL OR p_draft->>'awaitingLocation'='origin'THEN 'origin'
 WHEN p_draft->>'destination'IS NULL OR p_draft->>'awaitingLocation'='destination'THEN 'destination'
 WHEN p_draft->>'name'IS NULL THEN 'name'WHEN p_draft->>'confirmation'IS NULL OR p_draft->>'expiresAt'IS NULL THEN 'ready_for_review'
 WHEN(p_draft->>'expiresAt')::timestamptz>p_now THEN 'review'ELSE 'review_expired'END;
$$;
CREATE FUNCTION public.taxi_bot_trace_packet_valid(p jsonb)RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$DECLARE s jsonb;f text;BEGIN
 IF p IS NULL THEN RETURN true;END IF;
 IF NOT(p?&ARRAY['version','steps','durationMs'])OR jsonb_typeof(p->'durationMs')IS DISTINCT FROM 'number'OR jsonb_typeof(p)IS DISTINCT FROM 'object'OR p->>'version'IS DISTINCT FROM 'taxi-trace-v1'OR octet_length(p::text)>32768 OR jsonb_typeof(p->'steps')IS DISTINCT FROM 'array'OR jsonb_array_length(p->'steps')>12 OR(p->>'durationMs')::numeric NOT BETWEEN 0 AND 120000 THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p)k WHERE k NOT IN('version','steps','phaseBefore','phaseProposed','decision','reason','durationMs','interpretationPrivate'))THEN RETURN false;END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p->'steps')LOOP
  IF NOT(s?&ARRAY['phase','outcome','durationMs','inputHash','outputHash','code'])OR jsonb_typeof(s->'phase')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'outcome')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'inputHash')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'code')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'durationMs')IS DISTINCT FROM 'number'OR jsonb_typeof(s)IS DISTINCT FROM 'object'OR s->>'phase'NOT IN('interpret','resolve','quote','candidates')OR s->>'outcome'NOT IN('ok','error')OR s->>'inputHash'!~'^[0-9a-f]{64}$'OR(s->>'outputHash'IS NOT NULL AND s->>'outputHash'!~'^[0-9a-f]{64}$')OR s->>'code'!~'^[a-z0-9_]{1,80}$'OR(s->>'durationMs')::numeric NOT BETWEEN 0 AND 120000 THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s)k WHERE k NOT IN('phase','outcome','durationMs','inputHash','outputHash','code','intent','fields','resolution','amountCents','candidateCount','model'))THEN RETURN false;END IF;
  IF s?'fields'AND(jsonb_typeof(s->'fields')<>'array'OR jsonb_array_length(s->'fields')>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(s->'fields')v WHERE v NOT IN('name','origin','destination')))THEN RETURN false;END IF;
  IF s?'intent'AND s->>'intent'NOT IN('provide','quote','confirm','cancel','status','human','smalltalk','ambiguous')THEN RETURN false;END IF;
  IF s?'resolution'AND s->>'resolution'NOT IN('resolved','ambiguous','unavailable')THEN RETURN false;END IF;
  IF s->>'amountCents'IS NOT NULL AND((s->>'amountCents')::numeric NOT BETWEEN 0 AND 10000000 OR(s->>'amountCents')::numeric<>trunc((s->>'amountCents')::numeric))THEN RETURN false;END IF;
  IF s?'candidateCount'AND(s->>'candidateCount')::numeric NOT BETWEEN 0 AND 10000 THEN RETURN false;END IF;
  IF s?'model'THEN
   IF NOT((s->'model')?&ARRAY['inputTokens','outputTokens','responseHash'])OR jsonb_typeof(s->'model')IS DISTINCT FROM 'object'OR EXISTS(SELECT 1 FROM jsonb_object_keys(s->'model')k WHERE k NOT IN('inputTokens','outputTokens','responseHash'))THEN RETURN false;END IF;
   FOREACH f IN ARRAY ARRAY['inputTokens','outputTokens']LOOP IF s#>>ARRAY['model',f]IS NOT NULL AND((s#>>ARRAY['model',f])::numeric NOT BETWEEN 0 AND 10000000 OR(s#>>ARRAY['model',f])::numeric<>trunc((s#>>ARRAY['model',f])::numeric))THEN RETURN false;END IF;END LOOP;
   IF s#>>'{model,responseHash}'IS NOT NULL AND s#>>'{model,responseHash}'!~'^[0-9a-f]{64}$'THEN RETURN false;END IF;
  END IF;
 END LOOP;
 -- Content is an explicitly private validated interpretation, never chain of thought or a raw provider response.
 IF p->>'interpretationPrivate'IS NOT NULL THEN
  s:=p->'interpretationPrivate';IF jsonb_typeof(s)IS DISTINCT FROM 'object'OR s->>'intent'NOT IN('provide','quote','confirm','cancel','status','human','smalltalk','ambiguous')OR NOT(s?&ARRAY['intent','fields'])OR jsonb_typeof(s->'intent')IS DISTINCT FROM 'string'OR jsonb_typeof(s->'fields')IS DISTINCT FROM 'object'OR EXISTS(SELECT 1 FROM jsonb_object_keys(s)k WHERE k NOT IN('intent','fields'))THEN RETURN false;END IF;
  FOR f IN SELECT jsonb_object_keys(s->'fields')LOOP IF f NOT IN('name','origin','destination')OR jsonb_typeof(s#>ARRAY['fields',f])<>'object'OR jsonb_typeof(s#>ARRAY['fields',f,'value'])IS DISTINCT FROM 'string'OR jsonb_typeof(s#>ARRAY['fields',f,'evidence'])IS DISTINCT FROM 'string'OR length(coalesce(s#>>ARRAY['fields',f,'value'],''))NOT BETWEEN 1 AND 400 OR length(coalesce(s#>>ARRAY['fields',f,'evidence'],''))NOT BETWEEN 1 AND 6000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(s#>ARRAY['fields',f])k WHERE k NOT IN('value','evidence'))THEN RETURN false;END IF;END LOOP;
 END IF;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION public.taxi_bot_trace_start(p_event uuid,p_lease uuid,p_revision bigint,p_meta jsonb)RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.taxi_bot_events;s public.taxi_bot_sessions;contact text;bucket integer;ids uuid[];hashes jsonb;active text;phase text;BEGIN
 SELECT * INTO e FROM public.taxi_bot_events WHERE id=p_event;IF NOT FOUND THEN RAISE EXCEPTION 'trace event not found';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.tenant_id::text||e.waba||e.customer,1));
 SELECT * INTO s FROM public.taxi_bot_sessions WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer FOR SHARE;
 IF e.lease IS DISTINCT FROM p_lease OR s.lease IS DISTINCT FROM p_lease OR s.revision<>p_revision OR coalesce(s.lease_until<=clock_timestamp(),true)OR e.state<>'processing'THEN RAISE EXCEPTION 'stale trace start';END IF;
 IF NOT(p_meta?&ARRAY['version','engineVersion','model','promptHash','phaseBefore'])OR jsonb_typeof(p_meta->'promptHash')IS DISTINCT FROM 'string'OR jsonb_typeof(p_meta->'model')IS DISTINCT FROM 'string'OR jsonb_typeof(p_meta)IS DISTINCT FROM 'object'OR octet_length(p_meta::text)>2048 OR p_meta->>'promptHash'!~'^[a-f0-9]{64}$'OR p_meta->>'version'IS DISTINCT FROM 'taxi-trace-v1'OR length(coalesce(p_meta->>'model',''))NOT BETWEEN 1 AND 120 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_meta)k WHERE k NOT IN('version','engineVersion','model','promptHash','phaseBefore'))THEN RAISE EXCEPTION 'invalid trace metadata';END IF;
 SELECT encode(sha256(convert_to(salt||'|'||e.tenant_id::text||'|'||e.waba||'|'||e.customer,'UTF8')),'hex')INTO contact FROM public.taxi_bot_quality_secret WHERE id;
 bucket:=('x'||substr(contact,1,8))::bit(32)::bigint%10;
 INSERT INTO public.taxi_bot_quality_contacts(tenant_id,waba,contact_hash,cohort,created_at)VALUES(e.tenant_id,e.waba,contact,CASE WHEN bucket<7 THEN 'train'WHEN bucket<9 THEN 'validation'ELSE 'holdout'END,clock_timestamp())ON CONFLICT DO NOTHING;
 SELECT array_agg(id ORDER BY source_at,received_at,id),jsonb_agg(fingerprint ORDER BY source_at,received_at,id)INTO ids,hashes FROM public.taxi_bot_events WHERE lease=p_lease AND state='processing';
 SELECT estado INTO active FROM public.viajes WHERE tenant_id=e.tenant_id AND(bot_waba=e.waba OR bot_waba IS NULL)AND cliente_tel=e.customer AND estado IN('buscando_conductor','en_camino')LIMIT 1;
 phase:=public.taxi_bot_phase(s.mode,s.draft,active);
 IF p_meta->>'phaseBefore'IS DISTINCT FROM phase AND NOT(p_meta->>'phaseBefore'IN('review','review_expired')AND phase IN('review','review_expired'))THEN RAISE EXCEPTION 'trace phase mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_bot_turn_traces WHERE event_id=p_event AND lease=p_lease AND meta IS DISTINCT FROM p_meta)THEN RAISE EXCEPTION 'trace start conflict';END IF;
 INSERT INTO public.taxi_bot_turn_traces(event_id,tenant_id,waba,lease,revision,contact_hash,event_ids,source_hashes,meta,phase_before,context_private)
 VALUES(e.id,e.tenant_id,e.waba,p_lease,p_revision,contact,ids,hashes,p_meta,phase,jsonb_build_object('draft',s.draft,'history',s.history,'mode',s.mode,'revision',s.revision,'activeState',active))ON CONFLICT(event_id,lease)DO NOTHING;
 RETURN true;
END $$;
CREATE FUNCTION public.taxi_bot_trace_complete(p_event uuid,p_lease uuid,p_revision bigint,p_state text,p_packet jsonb,p_action text,p_reason text)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.taxi_bot_sessions;e public.taxi_bot_events;active text;BEGIN
 IF p_state NOT IN('committed','superseded','error')OR NOT public.taxi_bot_trace_packet_valid(p_packet)THEN RAISE EXCEPTION 'invalid trace result';END IF;
 SELECT * INTO e FROM public.taxi_bot_events WHERE id=p_event;SELECT * INTO s FROM public.taxi_bot_sessions WHERE tenant_id=e.tenant_id AND waba=e.waba AND customer=e.customer;
 SELECT estado INTO active FROM public.viajes WHERE tenant_id=e.tenant_id AND(bot_waba=e.waba OR bot_waba IS NULL)AND cliente_tel=e.customer AND estado IN('buscando_conductor','en_camino')LIMIT 1;
 UPDATE public.taxi_bot_turn_traces SET state=p_state,packet=p_packet,action=p_action,reason=left(p_reason,80),phase_after=public.taxi_bot_phase(s.mode,s.draft,active),completed_at=clock_timestamp()WHERE event_id=p_event AND lease=p_lease AND revision=p_revision AND state='running';
END $$;
CREATE FUNCTION public.taxi_bot_trace_fail(p_event uuid,p_lease uuid,p_code text,p_packet jsonb)RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE rev bigint;BEGIN
 IF p_code!~'^[a-z0-9_]{1,80}$'THEN RAISE EXCEPTION 'invalid trace error';END IF;
 SELECT revision INTO rev FROM public.taxi_bot_turn_traces WHERE event_id=p_event AND lease=p_lease AND state='running';IF NOT FOUND THEN RETURN false;END IF;
 PERFORM public.taxi_bot_trace_complete(p_event,p_lease,rev,'error',p_packet,NULL,p_code);RETURN true;
END $$;
CREATE FUNCTION public.taxi_bot_lifecycle_guard()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE kind text;previous text;next text;tenant uuid;waba text;allowed boolean;BEGIN
 IF TG_TABLE_NAME='viajes'THEN IF NOT NEW.bot_managed THEN RETURN NEW;END IF;kind:='trip';next:=NEW.estado;tenant:=NEW.tenant_id;waba:=NEW.bot_waba;IF TG_OP='UPDATE'THEN previous:=OLD.estado;END IF;
 ELSE kind:=CASE WHEN TG_TABLE_NAME='taxi_bot_offers'THEN 'offer'ELSE 'delivery'END;next:=NEW.state;tenant:=NEW.tenant_id;waba:=NEW.waba;IF TG_OP='UPDATE'THEN previous:=OLD.state;END IF;END IF;
 IF previous IS NOT DISTINCT FROM next THEN RETURN NEW;END IF;
 allowed:=CASE WHEN previous IS NULL THEN next=CASE kind WHEN 'trip'THEN 'buscando_conductor'WHEN 'offer'THEN 'offered'ELSE 'pending'END
 WHEN kind='trip'THEN(previous='buscando_conductor'AND next IN('en_camino','cancelado','cancelado_timeout'))OR(previous='en_camino'AND next IN('completado','cancelado'))
 WHEN kind='offer'THEN(previous='offered'AND next IN('accepted','rejected','revoked','expired'))OR(previous='accepted'AND next IN('finished','revoked'))
 ELSE(previous='pending'AND next IN('sending','failed'))OR(previous IN('sending','uncertain')AND next IN('accepted','delivered','read','failed','uncertain'))OR(previous='accepted'AND next IN('delivered','read','failed'))OR(previous='delivered'AND next='read')END;
 IF NOT coalesce(allowed,false)THEN RAISE EXCEPTION 'invalid taxi lifecycle transition';END IF;
 INSERT INTO public.taxi_bot_lifecycle_audit(tenant_id,waba,entity,entity_id,previous,next)VALUES(tenant,waba,kind,NEW.id,previous,next);RETURN NEW;
END $$;
CREATE TRIGGER taxi_bot_trip_state BEFORE INSERT OR UPDATE ON public.viajes FOR EACH ROW EXECUTE FUNCTION public.taxi_bot_lifecycle_guard();
CREATE TRIGGER taxi_bot_offer_state BEFORE INSERT OR UPDATE ON public.taxi_bot_offers FOR EACH ROW EXECUTE FUNCTION public.taxi_bot_lifecycle_guard();
CREATE TRIGGER taxi_bot_delivery_state BEFORE INSERT OR UPDATE ON public.taxi_bot_outbox FOR EACH ROW EXECUTE FUNCTION public.taxi_bot_lifecycle_guard();
CREATE FUNCTION public.taxi_bot_quality_read(p_tenant uuid,p_waba text,p_view text,p_input jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$DECLARE a timestamptz;b timestamptz;result jsonb;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels WHERE tenant_id=p_tenant AND waba=p_waba)THEN RAISE EXCEPTION 'quality channel not found';END IF;
 IF p_view='trace'THEN
  UPDATE public.taxi_bot_quality_contacts c SET inspected_at=coalesce(inspected_at,clock_timestamp())WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND EXISTS(SELECT 1 FROM public.taxi_bot_turn_traces t WHERE t.id=(p_input->>'traceId')::uuid AND t.tenant_id=c.tenant_id AND t.waba=c.waba AND t.contact_hash=c.contact_hash);
  SELECT jsonb_build_object('id',t.id,'state',t.state,'meta',t.meta,'phaseBefore',t.phase_before,'phaseAfter',t.phase_after,'action',t.action,'reason',t.reason,'packet',t.packet,'context',t.context_private,'sourceHashes',t.source_hashes,'cohort',c.cohort,'blindEligible',false,
   'messages',(SELECT jsonb_agg(e.message ORDER BY e.source_at,e.received_at,e.id)FROM public.taxi_bot_events e WHERE e.id=ANY(t.event_ids)),
   'review',(SELECT jsonb_build_object('revision',q.revision,'label',q.label,'reviewer',q.reviewer,'expected',q.expected_private)FROM public.taxi_bot_quality_cases q WHERE q.trace_id=t.id))INTO result
  FROM public.taxi_bot_turn_traces t JOIN public.taxi_bot_quality_contacts c USING(tenant_id,waba,contact_hash)WHERE t.tenant_id=p_tenant AND t.waba=p_waba AND t.id=(p_input->>'traceId')::uuid;
  RETURN coalesce(result,jsonb_build_object('state','not_found'));
 ELSIF p_view='export'THEN
  WITH candidates AS(SELECT id,jsonb_build_object('id',id,'cohort',cohort,'contactPartition',contact_hash,'sourceHashes',source_hashes,'context',context_private,'expected',expected_private,'reviewer',reviewer,'revision',revision,'label',label,'reviewedAt',reviewed_at,
   'contextHash',encode(sha256(convert_to(context_private::text,'UTF8')),'hex'),'expectedHash',encode(sha256(convert_to(expected_private::text,'UTF8')),'hex'))data
   FROM public.taxi_bot_quality_cases WHERE tenant_id=p_tenant AND waba=p_waba AND cohort='train'AND label IN('correct','interpretation_error')AND expected_private IS NOT NULL AND(p_input->>'after'IS NULL OR id>(p_input->>'after')::uuid)ORDER BY id LIMIT 26),
  sized AS(SELECT *,row_number()OVER(ORDER BY id)n,sum(octet_length(data::text))OVER(ORDER BY id)bytes FROM candidates)
  SELECT jsonb_build_object('synthetic',NULL,'source','reviewed_whatsapp_events','blindAccuracyMeasured',false,'cohort','train','cases',coalesce(jsonb_agg(data ORDER BY id)FILTER(WHERE n<=25 AND bytes<=1048576),'[]'),'hasMore',coalesce(bool_or(n>25 OR bytes>1048576),false))INTO result FROM sized;
  RETURN result;
 ELSIF p_view NOT IN('overview','attempts')THEN RAISE EXCEPTION 'invalid quality view';END IF;
 a:=(p_input->>'from')::timestamptz;b:=(p_input->>'to')::timestamptz;
 IF a IS NULL OR b IS NULL OR b<=a OR b-a>interval '31 days'THEN RAISE EXCEPTION 'invalid quality window';END IF;
 IF p_view='attempts'THEN
  IF p_input?'after'AND(jsonb_typeof(p_input->'after')IS DISTINCT FROM 'object'OR NOT(p_input->'after'?&ARRAY['startedAt','id']))THEN RAISE EXCEPTION 'invalid quality cursor';END IF;
  WITH page AS(SELECT t.id,t.started_at,jsonb_build_object('id',t.id,'startedAt',t.started_at,'state',t.state,'phaseBefore',t.phase_before,'phaseAfter',t.phase_after,'action',t.action,'reason',t.reason,
   'label',(SELECT q.label FROM public.taxi_bot_quality_cases q WHERE q.trace_id=t.id))data FROM public.taxi_bot_turn_traces t
   WHERE t.tenant_id=p_tenant AND t.waba=p_waba AND t.started_at>=a AND t.started_at<b
   AND(NOT(p_input?'after')OR(t.started_at,t.id)<((p_input->'after'->>'startedAt')::timestamptz,(p_input->'after'->>'id')::uuid))ORDER BY t.started_at DESC,t.id DESC LIMIT 21),
  ranked AS(SELECT *,row_number()OVER(ORDER BY started_at DESC,id DESC)n FROM page)
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(data ORDER BY started_at DESC,id DESC)FILTER(WHERE n<=20),'[]'),'hasMore',coalesce(bool_or(n>20),false))INTO result FROM ranked;
  RETURN result;
 END IF;
 SELECT jsonb_build_object('from',a,'to',b,'attempts',count(*),'committed',count(*)FILTER(WHERE state='committed'),'superseded',count(*)FILTER(WHERE state='superseded'),'errors',count(*)FILTER(WHERE state='error'),'abandoned',count(*)FILTER(WHERE state='abandoned'),'open',count(*)FILTER(WHERE state='running'),
 'interpretationAttempts',(SELECT count(*)FROM public.taxi_bot_turn_traces t CROSS JOIN LATERAL jsonb_array_elements(t.packet->'steps')s WHERE t.tenant_id=p_tenant AND t.waba=p_waba AND t.started_at>=a AND t.started_at<b AND s->>'phase'='interpret'),
 'interpretationFailures',(SELECT count(*)FROM public.taxi_bot_turn_traces t CROSS JOIN LATERAL jsonb_array_elements(t.packet->'steps')s WHERE t.tenant_id=p_tenant AND t.waba=p_waba AND t.started_at>=a AND t.started_at<b AND s->>'phase'='interpret'AND s->>'outcome'='error'),
 'handoffSignals',count(*)FILTER(WHERE action='human'),
 'confirmedInterpretationErrors',(SELECT count(*)FROM public.taxi_bot_quality_cases WHERE tenant_id=p_tenant AND waba=p_waba AND reviewed_at>=a AND reviewed_at<b AND label='interpretation_error'),
 'reviewedCases',(SELECT count(*)FROM public.taxi_bot_quality_cases WHERE tenant_id=p_tenant AND waba=p_waba AND reviewed_at>=a AND reviewed_at<b),
 'deliveryTransitions',(SELECT coalesce(jsonb_object_agg(next,n),'{}')FROM(SELECT next,count(*)n FROM public.taxi_bot_lifecycle_audit WHERE tenant_id=p_tenant AND waba=p_waba AND created_at>=a AND created_at<b AND entity='delivery'GROUP BY next)d),
 'blindAccuracyMeasured',false,'reviewSignalsAreConfirmedErrors',false)INTO result FROM public.taxi_bot_turn_traces WHERE tenant_id=p_tenant AND waba=p_waba AND started_at>=a AND started_at<b;
 RETURN result;
END $$;
CREATE FUNCTION public.taxi_bot_quality_review(p_tenant uuid,p_waba text,p_trace uuid,p_actor bigint,p_request uuid,p_revision bigint,p_label text,p_expected jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.taxi_bot_turn_traces;existing public.taxi_bot_quality_cases;previous public.taxi_bot_quality_reviews;command jsonb;result jsonb;ctx jsonb;expected jsonb;fold text;BEGIN
 IF p_actor<=0 OR p_revision<0 OR p_label NOT IN('correct','interpretation_error','policy_error','external_failure','incomplete')THEN RAISE EXCEPTION 'invalid quality review';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,24));
 command:=jsonb_build_object('tenant',p_tenant,'waba',p_waba,'trace',p_trace,'revision',p_revision,'label',p_label,'expected',p_expected);
 SELECT * INTO previous FROM public.taxi_bot_quality_reviews WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF previous.command IS DISTINCT FROM command THEN RETURN jsonb_build_object('state','request_conflict');END IF;RETURN previous.response;END IF;
 SELECT * INTO t FROM public.taxi_bot_turn_traces WHERE tenant_id=p_tenant AND waba=p_waba AND id=p_trace FOR SHARE;
 IF NOT FOUND OR t.state='running'THEN RETURN jsonb_build_object('state','not_found');END IF;
 -- Per-source serialization prevents two reviewers from overwriting the first label.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_trace::text,25));
 SELECT * INTO existing FROM public.taxi_bot_quality_cases WHERE trace_id=p_trace FOR UPDATE;
 IF coalesce(existing.revision,0)<>p_revision THEN RETURN jsonb_build_object('state','revision_conflict');END IF;
 expected:=CASE WHEN p_label='correct'AND p_expected IS NULL THEN t.packet->'interpretationPrivate'ELSE p_expected END;
 IF p_label IN('correct','interpretation_error')AND(expected IS NULL OR expected='null'::jsonb)THEN RAISE EXCEPTION 'a reviewed interpretation is required';END IF;
 IF expected IS NOT NULL AND NOT public.taxi_bot_trace_packet_valid(jsonb_build_object('version','taxi-trace-v1','steps','[]'::jsonb,'durationMs',0,'interpretationPrivate',expected))THEN RAISE EXCEPTION 'invalid expected interpretation';END IF;
 SELECT cohort INTO fold FROM public.taxi_bot_quality_contacts WHERE tenant_id=p_tenant AND waba=p_waba AND contact_hash=t.contact_hash;
 UPDATE public.taxi_bot_quality_contacts SET inspected_at=coalesce(inspected_at,clock_timestamp())WHERE tenant_id=p_tenant AND waba=p_waba AND contact_hash=t.contact_hash;
 ctx:=jsonb_build_object('before',t.context_private,'messages',(SELECT jsonb_agg(message ORDER BY source_at,received_at,id)FROM public.taxi_bot_events WHERE id=ANY(t.event_ids)));
 IF octet_length(ctx::text)>131072 THEN RAISE EXCEPTION 'review context too large';END IF;
 INSERT INTO public.taxi_bot_quality_cases(trace_id,tenant_id,waba,contact_hash,cohort,label,revision,reviewer,source_hashes,context_private,expected_private)
 VALUES(t.id,p_tenant,p_waba,t.contact_hash,fold,p_label,p_revision+1,p_actor,t.source_hashes,ctx,expected)
 ON CONFLICT(trace_id)DO UPDATE SET label=EXCLUDED.label,revision=EXCLUDED.revision,reviewer=EXCLUDED.reviewer,expected_private=EXCLUDED.expected_private,reviewed_at=clock_timestamp();
 result:=jsonb_build_object('state','saved','revision',p_revision+1,'cohort',fold);
 INSERT INTO public.taxi_bot_quality_reviews VALUES(p_actor,p_request,command,result,clock_timestamp());RETURN result;
END $$;
CREATE FUNCTION public.taxi_bot_trace_maintain()RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN
 UPDATE public.taxi_bot_turn_traces SET state='abandoned',reason='lease_expired',completed_at=clock_timestamp()WHERE id IN(SELECT id FROM public.taxi_bot_turn_traces WHERE state='running'AND started_at<clock_timestamp()-interval '3 minutes'ORDER BY started_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 DELETE FROM public.taxi_bot_turn_traces WHERE id IN(SELECT id FROM public.taxi_bot_turn_traces WHERE started_at<clock_timestamp()-interval '30 days'ORDER BY started_at LIMIT 200 FOR UPDATE SKIP LOCKED);
 DELETE FROM public.taxi_bot_lifecycle_audit WHERE id IN(SELECT id FROM public.taxi_bot_lifecycle_audit WHERE created_at<clock_timestamp()-interval '90 days'ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED);
 DELETE FROM public.taxi_bot_quality_cases WHERE id IN(SELECT id FROM public.taxi_bot_quality_cases WHERE reviewed_at<clock_timestamp()-interval '90 days'ORDER BY reviewed_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 DELETE FROM public.taxi_bot_quality_reviews WHERE(actor,request_id)IN(SELECT actor,request_id FROM public.taxi_bot_quality_reviews WHERE created_at<clock_timestamp()-interval '90 days'ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED);
END $$;

CREATE OR REPLACE FUNCTION public.taxi_bot_commit(p_event uuid,p_lease uuid,p_revision bigint,p_decision jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.taxi_bot_events%ROWTYPE;s public.taxi_bot_sessions%ROWTYPE;c public.taxi_bot_channels%ROWTYPE;
  t public.viajes%ROWTYPE;o public.taxi_bot_offers%ROWTYPE;driver public.conductores%ROWTYPE;
  a text;d jsonb;item jsonb;idx integer:=0;count_offers integer:=0;tid uuid;token text;reply text;last_at timestamptz;hist jsonb;current_messages text;BEGIN
  SELECT * INTO e FROM public.taxi_bot_events WHERE id=p_event;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi event not found';END IF;
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
    INSERT INTO public.viajes(id,token,tenant_id,cliente_tel,cliente_nombre,origen,destino,origen_lat,origen_lng,estado,conductores_contactados,bot_managed,bot_waba,bot_request_id,bot_quote_cents,bot_quote_h3)
      VALUES(tid,token,e.tenant_id,e.customer,s.draft->>'name',s.draft#>>'{origin,text}',s.draft#>>'{destination,text}',(s.draft#>>'{origin,lat}')::double precision,(s.draft#>>'{origin,lng}')::double precision,'buscando_conductor','{}',true,e.waba,e.id,(s.draft->>'quoteCents')::integer,NULLIF(s.draft->'quoteH3','null'::jsonb));
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
    SELECT * INTO o FROM public.taxi_bot_offers WHERE id=(p_decision->>'offerId')::uuid AND tenant_id=e.tenant_id AND waba=e.waba AND driver_phone=e.customer;
    IF NOT FOUND THEN reply:='Ese botón no corresponde a una oferta para tu cuenta.';
    ELSE
      SELECT * INTO t FROM public.viajes WHERE id=o.trip_id AND tenant_id=e.tenant_id AND bot_waba=e.waba AND bot_managed FOR UPDATE;
      SELECT * INTO o FROM public.taxi_bot_offers WHERE id=o.id FOR UPDATE;
      SELECT * INTO driver FROM public.conductores WHERE tenant_id=e.tenant_id AND device_id=o.device_id AND activo=true AND '+'||regexp_replace(telefono_whatsapp,'\D','','g')=e.customer FOR UPDATE;
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
      idx:=idx+1;PERFORM public.taxi_bot_emit(e.tenant_id,e.waba,e.customer,item->>'text','reply:'||e.id||':'||idx,CASE WHEN jsonb_typeof(item->'buttons')='array'THEN item->'buttons'ELSE NULL END);
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
CREATE OR REPLACE FUNCTION public.taxi_bot_maintain()RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t public.viajes%ROWTYPE;c public.taxi_bot_channels%ROWTYPE;total integer:=0;BEGIN
  PERFORM public.taxi_bot_trace_maintain();
  PERFORM set_config('app.taxi_bot_write','on',true);
  UPDATE public.taxi_bot_offers SET state='expired'WHERE id IN(SELECT id FROM public.taxi_bot_offers WHERE state='offered'AND expires_at<clock_timestamp()ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
  FOR t IN SELECT v.* FROM public.viajes v WHERE v.bot_managed AND v.estado='buscando_conductor'AND v.created_at<clock_timestamp()-interval '12 minutes'
    AND EXISTS(SELECT 1 FROM public.taxi_bot_channels channel WHERE channel.tenant_id=v.tenant_id AND channel.waba=v.bot_waba AND channel.enabled)ORDER BY v.created_at LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
    SELECT * INTO c FROM public.taxi_bot_channels WHERE tenant_id=t.tenant_id AND waba=t.bot_waba;
    UPDATE public.viajes SET estado='cancelado_timeout',updated_at=clock_timestamp()WHERE id=t.id;
    UPDATE public.taxi_bot_offers SET state='revoked'WHERE trip_id=t.id AND state='offered';
    PERFORM public.taxi_bot_emit(t.tenant_id,t.bot_waba,t.cliente_tel,'No se consiguió una unidad para este viaje. La solicitud se cerró; escríbenos si quieres volver a intentarlo.','timeout-customer:'||t.id);
    IF c.dispatcher IS NOT NULL THEN PERFORM public.taxi_bot_emit(t.tenant_id,t.bot_waba,c.dispatcher,'El viaje '||t.id||' cerró sin unidad confirmada. Revisa si el pasajero aún necesita ayuda.','timeout-dispatch:'||t.id);END IF;total:=total+1;
  END LOOP;
  RETURN total;
END $$;
DO $$DECLARE fn record;BEGIN FOR fn IN SELECT p.oid::regprocedure signature,p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'AND p.proname IN('taxi_bot_phase','taxi_bot_trace_packet_valid','taxi_bot_trace_start','taxi_bot_trace_complete','taxi_bot_trace_fail','taxi_bot_lifecycle_guard','taxi_bot_quality_read','taxi_bot_quality_review','taxi_bot_trace_maintain')LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature);
 IF fn.name IN('taxi_bot_trace_start','taxi_bot_trace_fail','taxi_bot_quality_read','taxi_bot_quality_review')THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature);END IF;
END LOOP;END $$;
COMMIT;
