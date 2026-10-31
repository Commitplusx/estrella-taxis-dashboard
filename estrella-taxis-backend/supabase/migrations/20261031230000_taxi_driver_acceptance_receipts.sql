BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- A completed driver button may recover its durable receipt after the offer
-- leaves offered/accepted. New events still require the current authorization.
DO $patch$DECLARE definition text;previous text;replacement text;BEGIN
 previous:='IF NOT public.taxi_bot_inbound_allowed(e.tenant_id,e.waba,e.message) THEN RAISE EXCEPTION USING ERRCODE=''PT403'',MESSAGE=''taxi_customer_not_authorized'';END IF;';
 replacement:=$guard$IF NOT public.taxi_bot_inbound_allowed(e.tenant_id,e.waba,e.message) AND NOT (
   e.state='completed' AND e.message->>'type'='button'
   AND e.message->>'button' ~ '^tx[arf]_[0-9a-f-]{36}$'
   AND public.taxi_bot_customer_phone(e.customer)=public.taxi_bot_customer_phone(e.message->>'from')
   AND EXISTS(SELECT 1 FROM public.taxi_bot_offers receipt_offer
     WHERE receipt_offer.tenant_id=e.tenant_id AND receipt_offer.waba=e.waba
     AND receipt_offer.id::text=substr(e.message->>'button',5)
     AND public.taxi_bot_customer_phone(receipt_offer.driver_phone)=public.taxi_bot_customer_phone(e.message->>'from'))
 ) THEN RAISE EXCEPTION USING ERRCODE='PT403',MESSAGE='taxi_customer_not_authorized';END IF;$guard$;
 SELECT pg_get_functiondef('public.taxi_bot_commit(uuid,uuid,bigint,jsonb)'::regprocedure)INTO definition;
 IF strpos(definition,previous)=0 OR strpos(definition,'receipt_offer')>0 THEN RAISE EXCEPTION 'Review current commit before driver receipt migration';END IF;
 EXECUTE replace(definition,previous,replacement);
END $patch$;
COMMIT;
