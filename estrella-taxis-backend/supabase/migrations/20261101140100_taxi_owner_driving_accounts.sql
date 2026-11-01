BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Owners already may cover a linked unit. Provisioning their login must preserve
-- an existing active shift rather than force it off or rewrite their owner role.
DO $patch$DECLARE f text;needle text:=$old$p_payload->>'role'NOT IN('driver','owner_driver')$old$;BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_contact_apply_core(uuid,bigint,uuid,text,uuid,jsonb)'::regprocedure)INTO f;
 IF strpos(f,needle)=0 THEN RAISE EXCEPTION 'Review current contact role guard before preserving owner driving';END IF;
 EXECUTE replace(f,needle,$new$p_payload->>'role'NOT IN('driver','owner_driver','owner')$new$);
END $patch$;
COMMIT;
