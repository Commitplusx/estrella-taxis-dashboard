BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- A WhatsApp sender cannot receive the base's fallback alerts on itself.
-- NOT VALID preserves the current channel row until the owner supplies a distinct
-- human contact, while enforcing the rule on every new row and future edit.
ALTER TABLE public.taxi_bot_channels
  ADD CONSTRAINT taxi_bot_dispatcher_must_be_person
  CHECK (
    dispatcher IS NULL
    OR public.taxi_bot_customer_phone(dispatcher) IS DISTINCT FROM public.taxi_bot_customer_phone(waba)
  ) NOT VALID;

NOTIFY pgrst,'reload schema';
COMMIT;
