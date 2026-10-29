-- Local candidate. No channel, tenant or global zone is assigned automatically.
-- Apply together with 20261027220000_taxi_bot_transactions.sql before activating the worker.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Preserve an existing channel's distance rule; H3 is the default only for new channels.
ALTER TABLE public.taxi_bot_channels ADD COLUMN pricing_mode text NOT NULL DEFAULT 'road_distance'
  CHECK(pricing_mode IN('h3_zone_max','road_distance'));
ALTER TABLE public.taxi_bot_channels ALTER COLUMN pricing_mode SET DEFAULT 'h3_zone_max';

-- Bind the existing live price catalog to a reviewed base/channel; do not duplicate its prices.
CREATE TABLE public.taxi_bot_h3_cells(
  tenant_id uuid NOT NULL,waba text NOT NULL,h3_index text NOT NULL CHECK(h3_index ~ '^8a[0-9a-f]{13}$'),
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,waba,h3_index),
  FOREIGN KEY(tenant_id,waba) REFERENCES public.taxi_bot_channels(tenant_id,waba) ON DELETE CASCADE,
  FOREIGN KEY(h3_index) REFERENCES public.h3_zonas(h3_index) ON DELETE CASCADE
);
CREATE INDEX taxi_bot_h3_cells_zone ON public.taxi_bot_h3_cells(h3_index);
ALTER TABLE public.taxi_bot_h3_cells ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_h3_cells FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.taxi_bot_h3_cells,public.h3_zonas TO service_role;
CREATE POLICY taxi_bot_h3_service_read ON public.taxi_bot_h3_cells FOR SELECT TO service_role USING(true);

CREATE FUNCTION public.taxi_bot_h3_quote(p_tenant uuid,p_waba text,p_origin text,p_destination text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE amount numeric;matches integer;bad boolean;
BEGIN
  IF p_origin IS NULL OR p_destination IS NULL OR p_origin !~ '^8a[0-9a-f]{13}$' OR p_destination !~ '^8a[0-9a-f]{13}$'THEN RAISE EXCEPTION 'invalid taxi H3 cell';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND c.enabled AND c.pricing_mode='h3_zone_max')THEN
    RETURN jsonb_build_object('state','channel_unavailable','mode','h3_zone_max');
  END IF;
  SELECT count(*)::integer,max(z.precio),bool_or(z.resolucion<>10 OR z.precio::text IN('NaN','Infinity','-Infinity') OR z.precio<=0 OR z.precio>100000 OR z.precio<>round(z.precio,2))
    INTO matches,amount,bad FROM public.taxi_bot_h3_cells s JOIN public.h3_zonas z USING(h3_index)
    WHERE s.tenant_id=p_tenant AND s.waba=p_waba AND s.h3_index IN(p_origin,p_destination);
  IF bad THEN RETURN jsonb_build_object('state','invalid_zone','mode','h3_zone_max');END IF;
  IF matches<>(CASE WHEN p_origin=p_destination THEN 1 ELSE 2 END)THEN RETURN jsonb_build_object('state','uncovered','mode','h3_zone_max');END IF;
  RETURN jsonb_build_object('state','priced','mode','h3_zone_max','cents',(amount*100)::integer,'originCell',p_origin,'destinationCell',p_destination);
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_h3_quote(uuid,text,text,text)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_h3_quote(uuid,text,text,text)TO service_role;

-- Revalidate the shown H3 amount in the same transaction that creates a trip.
-- Existing rows are locked in cell order so price edits cannot race a confirmed fare.
CREATE FUNCTION public.taxi_bot_validate_quote(p_tenant uuid,p_waba text,p_draft jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE mode text;q jsonb;scope jsonb;old_cents integer;
BEGIN
  SELECT c.pricing_mode INTO mode FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND c.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi pricing channel unavailable';END IF;
  scope:=p_draft->'quoteH3';
  IF mode='road_distance' THEN
    IF p_draft->>'quoteH3'IS NOT NULL THEN RAISE EXCEPTION 'taxi tariff changed';END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(scope)IS DISTINCT FROM 'object'OR scope->>'originCell'IS NULL OR scope->>'destinationCell'IS NULL THEN RAISE EXCEPTION 'taxi H3 review required';END IF;
  PERFORM s.h3_index FROM public.taxi_bot_h3_cells s WHERE s.tenant_id=p_tenant AND s.waba=p_waba AND s.h3_index IN(scope->>'originCell',scope->>'destinationCell')ORDER BY s.h3_index FOR SHARE;
  PERFORM z.h3_index FROM public.h3_zonas z WHERE z.h3_index IN(scope->>'originCell',scope->>'destinationCell')ORDER BY z.h3_index FOR SHARE;
  q:=public.taxi_bot_h3_quote(p_tenant,p_waba,scope->>'originCell',scope->>'destinationCell');
  old_cents:=(p_draft->>'quoteCents')::integer;
  IF (q->>'state'='priced'AND (q->>'cents')::integer IS NOT DISTINCT FROM old_cents)
    OR(q->>'state'IN('uncovered','invalid_zone')AND old_cents IS NULL)THEN RETURN;END IF;
  RAISE EXCEPTION 'taxi tariff changed';
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_validate_quote(uuid,text,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_validate_quote(uuid,text,jsonb)TO service_role;
COMMENT ON TABLE public.taxi_bot_h3_cells IS 'Explicit channel ownership of existing H3 price cells. No global or nearest-zone fallback.';
COMMENT ON FUNCTION public.taxi_bot_h3_quote(uuid,text,text,text)IS 'Exact res-10 cells only. Both endpoints must be assigned to this tenant/channel. Uses the higher current zone price, in MXN cents.';
COMMIT;
