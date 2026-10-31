BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $patch$DECLARE definition text;previous text;replacement text;BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_commit(uuid,uuid,bigint,jsonb)'::regprocedure)INTO definition;
 previous:=$old$PERFORM set_config('app.taxi_reply_customer',e.customer,true);$old$;
 replacement:=previous||$new$
  PERFORM set_config('app.taxi_budget_close',CASE WHEN a='draft' AND p_decision->>'reason'='draft_cancelled' THEN 'true' ELSE 'false' END,true);$new$;
 IF strpos(definition,previous)=0 OR strpos(definition,'app.taxi_budget_close')>0 THEN RAISE EXCEPTION 'Review current commit before draft budget close';END IF;
 EXECUTE replace(definition,previous,replacement);
 SELECT pg_get_functiondef('public.taxi_bot_emit(uuid,text,text,text,text,jsonb)'::regprocedure)INTO definition;
 previous:=$old$terminal:=p_key LIKE 'trip-finished:%' OR p_key LIKE 'timeout-customer:%' OR p_key LIKE 'cancel-customer:%';$old$;
 replacement:=$new$terminal:=p_key LIKE 'trip-finished:%' OR p_key LIKE 'timeout-customer:%' OR p_key LIKE 'cancel-customer:%'
  OR coalesce(p_key LIKE 'reply:%' AND current_setting('app.taxi_reply_customer',true)=p_to AND current_setting('app.taxi_budget_close',true)='true',false);$new$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review current emit before draft budget close';END IF;
 definition:=replace(definition,previous,replacement);
 previous:=$old$OR p_key LIKE 'attempts-customer:%';$old$;
 replacement:=$new$OR p_key LIKE 'attempts-customer:%' OR p_key LIKE 'dispatch-attention:%';$new$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review customer dispatch attention classification';END IF;
 definition:=replace(definition,previous,replacement);
 previous:=$old$IF(p_key LIKE 'trip-created:%' AND s.normal_message_count>=4)$old$;
 replacement:=$new$IF((p_key LIKE 'trip-created:%' OR p_key LIKE 'dispatch-attention:%') AND s.normal_message_count>=4)$new$;
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Review optional dispatch attention budget';END IF;
 EXECUTE replace(definition,previous,replacement);
END $patch$;
COMMIT;
