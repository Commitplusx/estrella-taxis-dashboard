BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Trips use compact UUID tokens (32 hexadecimal chars). Preserve links already
-- issued with dashed UUIDs while allowing the token shape the dispatcher stores.
DO $patch$
DECLARE definition text;previous text;replacement text;
BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_emit(uuid,text,text,text,text,jsonb)'::regprocedure) INTO definition;
 previous:=$needle$'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'$needle$;
 replacement:=$needle$'^([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'$needle$;
 IF definition IS NULL THEN
  RAISE EXCEPTION 'Could not inspect taxi outbox function before accepting compact tracking tokens';
 END IF;
 IF strpos(definition,replacement)>0 THEN RETURN; END IF;
 IF strpos(definition,previous)=0 THEN
  RAISE EXCEPTION 'Review current tracking token guard before allowing compact tokens';
 END IF;
 EXECUTE replace(definition,previous,replacement);
END $patch$;

COMMIT;
