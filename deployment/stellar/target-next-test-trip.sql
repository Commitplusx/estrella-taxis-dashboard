-- Operator-only, single-use dispatch exception. Does not arm a test by itself.
-- The normal confirmation, offer, recipient, acceptance and outbox guards remain.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.taxi_bot_test_targets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,waba text NOT NULL,
 customer text NOT NULL CHECK(customer~'^\+[1-9][0-9]{7,14}$'),device_id integer NOT NULL,
 armed_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 trip_id uuid UNIQUE REFERENCES public.viajes(id),consumed_at timestamptz,
 CHECK(expires_at>armed_at AND expires_at<=armed_at+interval '30 minutes'),
 CHECK((trip_id IS NULL)=(consumed_at IS NULL)),
 FOREIGN KEY(tenant_id,waba)REFERENCES public.taxi_bot_channels(tenant_id,waba),
 FOREIGN KEY(tenant_id,device_id)REFERENCES public.taxi_base_units(tenant_id,device_id)
);
CREATE UNIQUE INDEX taxi_bot_one_armed_test ON public.taxi_bot_test_targets(tenant_id,waba,customer)WHERE trip_id IS NULL;
ALTER TABLE public.taxi_bot_test_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_test_targets FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.taxi_bot_test_candidates(p_trip uuid,p_candidates jsonb,p_round integer)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t public.viajes;r public.taxi_bot_test_targets;BEGIN
 SELECT * INTO t FROM public.viajes WHERE id=p_trip AND bot_managed AND estado='buscando_conductor';
 IF NOT FOUND THEN RETURN p_candidates;END IF;
 SELECT * INTO r FROM public.taxi_bot_test_targets WHERE trip_id=t.id AND tenant_id=t.tenant_id AND waba=t.bot_waba FOR UPDATE;
 IF NOT FOUND AND p_round=1 THEN
  SELECT * INTO r FROM public.taxi_bot_test_targets WHERE trip_id IS NULL AND tenant_id=t.tenant_id AND waba=t.bot_waba
   AND customer=public.taxi_bot_customer_phone(t.cliente_tel)AND t.created_at>=armed_at AND expires_at>clock_timestamp() FOR UPDATE;
  IF FOUND THEN
   UPDATE public.taxi_bot_test_targets SET trip_id=t.id,consumed_at=clock_timestamp()WHERE id=r.id AND trip_id IS NULL;
  END IF;
 END IF;
 IF r.id IS NULL THEN RETURN p_candidates;END IF;
 -- This trip never spills into other units, even after expiry or later rounds.
 -- Native offer guards still refuse an inactive/busy/reserved target.
 RETURN jsonb_build_array(jsonb_build_object('deviceId',r.device_id));
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_test_candidates(uuid,jsonb,integer)FROM PUBLIC,anon,authenticated,service_role;
DO $patch$DECLARE f text;needle text;BEGIN
 SELECT pg_get_functiondef('public.taxi_bot_dispatch_offer(uuid,jsonb,integer)'::regprocedure)INTO f;
 needle:=' PERFORM set_config(''app.taxi_bot_write'',''on'',true);';
 IF strpos(f,needle)=0 OR strpos(f,'taxi_bot_test_candidates')>0 THEN RAISE EXCEPTION 'Review current offer function before adding scoped test hook';END IF;
 EXECUTE replace(f,needle,needle||E'\n p_candidates:=public.taxi_bot_test_candidates(t.id,p_candidates,p_round);');
END $patch$;
COMMIT;
