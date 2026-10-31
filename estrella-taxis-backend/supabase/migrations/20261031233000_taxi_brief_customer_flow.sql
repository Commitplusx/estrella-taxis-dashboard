BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';

CREATE TABLE public.taxi_bot_message_budgets(
 tenant_id uuid NOT NULL,waba text NOT NULL,customer text NOT NULL,
 message_service_id uuid NOT NULL DEFAULT gen_random_uuid(),
 normal_message_count integer NOT NULL DEFAULT 0 CHECK(normal_message_count BETWEEN 0 AND 5),
 extra_message_count integer NOT NULL DEFAULT 0 CHECK(extra_message_count>=0),
 message_budget_closed boolean NOT NULL DEFAULT false,
 optional_messages_omitted integer NOT NULL DEFAULT 0 CHECK(optional_messages_omitted>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,waba,customer),
 FOREIGN KEY(tenant_id,waba)REFERENCES public.taxi_bot_channels(tenant_id,waba)ON DELETE CASCADE
);
ALTER TABLE public.taxi_bot_message_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_message_budgets FROM PUBLIC,anon,authenticated,service_role;

-- Count durable provider requests, not model turns. Driver offers and dispatcher
-- messages are independent. Reservations survive retries and worker restarts.
CREATE OR REPLACE FUNCTION public.taxi_bot_emit(p_tenant uuid,p_waba text,p_to text,p_text text,p_key text,p_buttons jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE body_text text:=p_text;s public.taxi_bot_message_budgets%ROWTYPE;category text:='normal';meta jsonb:='{}';customer_output boolean;pieces integer;terminal boolean;BEGIN
 IF p_to !~ '^\+[1-9][0-9]{7,14}$'OR p_text IS NULL OR length(p_text)NOT BETWEEN 1 AND 4096
 OR(p_buttons IS NOT NULL AND(jsonb_typeof(p_buttons)<>'array'OR jsonb_array_length(p_buttons)>3))THEN RAISE EXCEPTION 'invalid taxi output';END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_bot_outbox WHERE dedupe_key=p_key)THEN RETURN;END IF;
 customer_output:=p_key LIKE 'reply:%' OR p_key LIKE 'trip-created:%' OR p_key LIKE 'trip-assigned:%' OR p_key LIKE 'trip-finished:%' OR p_key LIKE 'timeout-customer:%' OR p_key LIKE 'cancel-customer:%' OR p_key LIKE 'attempts-customer:%';
 terminal:=p_key LIKE 'trip-finished:%' OR p_key LIKE 'timeout-customer:%' OR p_key LIKE 'cancel-customer:%';
 pieces:=CASE WHEN coalesce(jsonb_array_length(p_buttons),0)>0 AND length(p_text)>1024 THEN 2 ELSE 1 END;
 IF customer_output THEN
  INSERT INTO public.taxi_bot_message_budgets(tenant_id,waba,customer)VALUES(p_tenant,p_waba,p_to)ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM public.taxi_bot_message_budgets WHERE tenant_id=p_tenant AND waba=p_waba AND customer=p_to FOR UPDATE;
  IF FOUND THEN
   IF EXISTS(SELECT 1 FROM public.taxi_bot_outbox WHERE dedupe_key=p_key)THEN RETURN;END IF;
   IF s.message_budget_closed AND p_key LIKE 'reply:%' AND NOT EXISTS(SELECT 1 FROM public.viajes WHERE tenant_id=p_tenant AND bot_waba=p_waba AND cliente_tel=p_to AND estado IN('buscando_conductor','en_camino')) THEN
    UPDATE public.taxi_bot_message_budgets SET message_service_id=gen_random_uuid(),normal_message_count=0,extra_message_count=0,message_budget_closed=false,optional_messages_omitted=0 WHERE tenant_id=s.tenant_id AND waba=s.waba AND customer=s.customer RETURNING * INTO s;
   END IF;
   IF p_key LIKE 'reply:%' AND current_setting('app.taxi_reply_customer',true)=p_to THEN category:=coalesce(nullif(current_setting('app.taxi_reply_class',true),''),'normal');END IF;
   IF p_key LIKE 'cancel-customer:%' THEN category:='change';END IF;
   IF p_key LIKE 'attempts-customer:%' THEN category:='question';END IF;
   IF category NOT IN('normal','question','change')THEN RAISE EXCEPTION 'invalid taxi reply class';END IF;
   -- A searching acknowledgement and a closing courtesy are optional. The
   -- assignment / no-unit outcome always retains the last normal slot.
   IF(p_key LIKE 'trip-created:%' AND s.normal_message_count>=4)OR(p_key LIKE 'trip-finished:%' AND s.normal_message_count>=5)THEN
    UPDATE public.taxi_bot_message_budgets SET optional_messages_omitted=optional_messages_omitted+1,message_budget_closed=message_budget_closed OR terminal WHERE tenant_id=s.tenant_id AND waba=s.waba AND customer=s.customer;RETURN;
   END IF;
   IF category='normal' AND s.normal_message_count+pieces>5 THEN
    IF p_key LIKE 'trip-assigned:%' OR p_key LIKE 'timeout-customer:%' THEN category:='change';
    ELSE RAISE EXCEPTION 'taxi normal message budget exceeded';END IF;
   END IF;
   UPDATE public.taxi_bot_message_budgets SET normal_message_count=normal_message_count+CASE WHEN category='normal' THEN pieces ELSE 0 END,
    extra_message_count=extra_message_count+CASE WHEN category<>'normal' THEN pieces ELSE 0 END,message_budget_closed=message_budget_closed OR terminal,updated_at=clock_timestamp() WHERE tenant_id=s.tenant_id AND waba=s.waba AND customer=s.customer;
   meta:=jsonb_build_object('messageServiceId',s.message_service_id,'messageClass',category);
  END IF;
 END IF;
 IF pieces=2 THEN
  INSERT INTO public.taxi_bot_outbox(tenant_id,waba,destination,body,dedupe_key)
  VALUES(p_tenant,p_waba,p_to,jsonb_build_object('text',p_text,'controlDedupe',p_key)||meta,p_key||':details')ON CONFLICT(dedupe_key)DO NOTHING;
  body_text:='Revisa los datos de arriba y elige una opción con los botones.';
 END IF;
 INSERT INTO public.taxi_bot_outbox(tenant_id,waba,destination,body,dedupe_key)
 VALUES(p_tenant,p_waba,p_to,jsonb_build_object('text',body_text,'buttons',p_buttons)||meta,p_key)ON CONFLICT(dedupe_key)DO NOTHING;
END $$;

DO $patch$DECLARE definition text;previous text;replacement text;BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_begin(uuid)'::regprocedure)INTO definition;
 previous:='''history'',s.history,''active'',trip';
 replacement:='''history'',s.history,''active'',trip,''messageBudget'',coalesce((SELECT jsonb_build_object(''normal'',b.normal_message_count,''extra'',b.extra_message_count,''closed'',b.message_budget_closed)FROM public.taxi_bot_message_budgets b WHERE b.tenant_id=s.tenant_id AND b.waba=s.waba AND b.customer=s.customer),''{"normal":0,"extra":0,"closed":false}''::jsonb)';
 IF strpos(definition,previous)=0 OR strpos(definition,'messageBudget')>0 THEN RAISE EXCEPTION 'Review current begin before brief flow migration';END IF;
 EXECUTE replace(definition,previous,replacement);

 SELECT pg_get_functiondef('public.taxi_bot_commit(uuid,uuid,bigint,jsonb)'::regprocedure)INTO definition;
 previous:='a:=p_decision->>''action'';d:=p_decision->''draft'';';
 replacement:=previous||$class$
  IF coalesce(p_decision->>'replyClass','normal') NOT IN('normal','question','change') THEN RAISE EXCEPTION 'invalid taxi reply class';END IF;
  PERFORM set_config('app.taxi_reply_customer',e.customer,true);
  PERFORM set_config('app.taxi_reply_class',coalesce(p_decision->>'replyClass','normal'),true);
 $class$;
 IF strpos(definition,previous)=0 OR strpos(definition,'app.taxi_reply_class')>0 THEN RAISE EXCEPTION 'Review current commit before brief flow migration';END IF;
 definition:=replace(definition,previous,replacement);
 previous:='UPDATE public.taxi_bot_sessions SET last_reset_at=clock_timestamp(),last_reset_revision=p_revision+1 WHERE id=s.id;';
 replacement:=previous||$reset$
      IF NOT EXISTS(SELECT 1 FROM public.viajes WHERE tenant_id=e.tenant_id AND bot_waba=e.waba AND cliente_tel=e.customer AND estado IN('buscando_conductor','en_camino'))THEN
       INSERT INTO public.taxi_bot_message_budgets(tenant_id,waba,customer)VALUES(e.tenant_id,e.waba,e.customer)ON CONFLICT(tenant_id,waba,customer)DO UPDATE SET message_service_id=gen_random_uuid(),normal_message_count=0,extra_message_count=0,message_budget_closed=false,optional_messages_omitted=0,updated_at=clock_timestamp();
       PERFORM set_config('app.taxi_reply_class','normal',true);
      END IF;
 $reset$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current reset before brief flow migration';END IF;
 definition:=replace(definition,previous,replacement);
 -- A literal explicit destination deferral can answer the grouped question even
 -- before GPS. Button consent still requires its exact current prompt/token.
 previous:=$old$IF a<>'draft' OR s.draft->>'awaitingLocation' IS DISTINCT FROM 'destination' OR s.draft->>'destinationPrompt' IS NULL
      OR coalesce((s.draft->>'expiresAt')::timestamptz<=clock_timestamp(),true)
      OR (SELECT count(*) FROM public.taxi_bot_events WHERE lease=p_lease AND state='processing')<>1$old$;
 replacement:=$new$IF a<>'draft' OR (SELECT count(*) FROM public.taxi_bot_events WHERE lease=p_lease AND state='processing')<>1$new$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review explicit destination deferral guard';END IF;
 definition:=replace(definition,previous,replacement);
 previous:=$old$(choice.message->>'type'='button' AND choice.message->>'button'='txd_'||(s.draft->>'destinationPrompt'))$old$;
 replacement:=$new$(choice.message->>'type'='button' AND s.draft->>'awaitingLocation'='destination' AND s.draft->>'destinationPrompt' IS NOT NULL AND coalesce((s.draft->>'expiresAt')::timestamptz>clock_timestamp(),false) AND choice.message->>'button'='txd_'||(s.draft->>'destinationPrompt'))$new$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review destination button guard';END IF;
 EXECUTE replace(definition,previous,replacement);
END $patch$;

-- Existing grants are deliberately preserved. Only the service worker can commit.
COMMIT;
