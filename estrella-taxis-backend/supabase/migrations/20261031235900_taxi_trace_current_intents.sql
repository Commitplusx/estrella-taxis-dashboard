-- Align trace validation with the existing interpreter and resolver contracts.
-- A trace is committed atomically with the customer reply; rejecting a supported
-- result would roll back the reply and leave its processing lease outstanding.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $patch$
DECLARE
 definition text;
 previous_intents text := '(''provide'',''quote'',''question'',''confirm'',''cancel'',''status'',''human'',''smalltalk'',''ambiguous'')';
 current_intents text := '(''provide'',''request'',''quote'',''question'',''confirm'',''cancel'',''status'',''human'',''smalltalk'',''ambiguous'')';
 previous_resolutions text := '(''resolved'',''ambiguous'',''unavailable'')';
 current_resolutions text := '(''resolved'',''ambiguous'',''reference_conflict'',''unavailable'')';
BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_trace_packet_valid(jsonb)'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,previous_intents,'')))/length(previous_intents)<>2
 OR (length(definition)-length(replace(definition,previous_resolutions,'')))/length(previous_resolutions)<>1 THEN
  RAISE EXCEPTION 'Review current trace validator before extending its supported results';
 END IF;
 -- Preserve the function signature, limits, validation of private fields and ACL.
 EXECUTE replace(replace(definition,previous_intents,current_intents),previous_resolutions,current_resolutions);
END $patch$;

COMMIT;
