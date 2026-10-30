-- A taxi can be requested without a quoted fare; existing quoted reviews keep their safeguards.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.taxi_bot_validate_quote(p_tenant uuid,p_waba text,p_draft jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE mode text;q jsonb;scope jsonb;old_cents integer;channel public.taxi_bot_channels;point jsonb;lat double precision;lng double precision;distance_km double precision;
BEGIN
  SELECT c.* INTO channel FROM public.taxi_bot_channels c WHERE c.tenant_id=p_tenant AND c.waba=p_waba AND c.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'taxi pricing channel unavailable';END IF;
  mode:=channel.pricing_mode;
  FOR point IN SELECT p_draft->'origin' UNION ALL SELECT p_draft->'destination' LOOP
    lat:=(point->>'lat')::double precision;lng:=(point->>'lng')::double precision;
    IF lat IS NULL OR lng IS NULL OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'invalid taxi coordinates';END IF;
    distance_km:=12742*asin(least(1,sqrt(power(sin(radians(lat-channel.center_lat)/2),2)+cos(radians(channel.center_lat))*cos(radians(lat))*power(sin(radians(lng-channel.center_lng)/2),2))));
    IF distance_km>channel.radius_km THEN RAISE EXCEPTION 'taxi coverage changed';END IF;
  END LOOP;
  IF p_draft ? 'fareMode' AND (jsonb_typeof(p_draft->'fareMode') IS DISTINCT FROM 'string' OR p_draft->>'fareMode' NOT IN('quoted','unquoted')) THEN RAISE EXCEPTION 'invalid taxi fare mode';END IF;
  -- No price was offered to this passenger. Location/tenant/channel checks above still apply.
  IF p_draft->>'fareMode'='unquoted' THEN
    IF p_draft->>'quoteCents' IS NOT NULL OR p_draft->>'quoteH3' IS NOT NULL THEN RAISE EXCEPTION 'unquoted taxi cannot contain a fare';END IF;
    RETURN;
  END IF;
  scope:=p_draft->'quoteH3';
  IF mode='road_distance' THEN
    IF p_draft->>'quoteH3'IS NOT NULL THEN RAISE EXCEPTION 'taxi tariff changed';END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(scope)IS DISTINCT FROM 'object'OR scope->>'originCell'IS NULL OR scope->>'destinationCell'IS NULL THEN RAISE EXCEPTION 'taxi H3 review required';END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_tenant::text,56));
  PERFORM z.h3_index FROM public.taxi_bot_base_zones z WHERE z.tenant_id=p_tenant AND z.h3_index IN(scope->>'originCell',scope->>'destinationCell')ORDER BY z.h3_index FOR SHARE;
  q:=public.taxi_bot_h3_quote(p_tenant,p_waba,scope->>'originCell',scope->>'destinationCell');
  old_cents:=(p_draft->>'quoteCents')::integer;
  IF (q->>'state'='priced'AND (q->>'cents')::integer IS NOT DISTINCT FROM old_cents)
    OR(q->>'state'IN('uncovered','invalid_zone')AND old_cents IS NULL)THEN RETURN;END IF;
  RAISE EXCEPTION 'taxi tariff changed';
END $$;
COMMIT;
