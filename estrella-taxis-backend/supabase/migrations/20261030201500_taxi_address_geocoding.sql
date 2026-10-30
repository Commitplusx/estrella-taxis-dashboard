-- Server-only bounded address cache and global budget for user-triggered Photon searches.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.taxi_bot_address_cache(
 tenant_id uuid NOT NULL REFERENCES public.empresas(id),query_hash text NOT NULL CHECK(query_hash~'^[a-f0-9]{64}$'),
 result jsonb,lease uuid,lease_until timestamptz,expires_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,query_hash),CHECK(result IS NULL OR octet_length(result::text)<=4096)
);
CREATE INDEX taxi_bot_address_cache_lease ON public.taxi_bot_address_cache(lease_until)WHERE lease IS NOT NULL;
CREATE TABLE public.taxi_bot_address_budget(id boolean PRIMARY KEY CHECK(id),window_at timestamptz NOT NULL,requests integer NOT NULL CHECK(requests BETWEEN 0 AND 30));
INSERT INTO public.taxi_bot_address_budget VALUES(true,clock_timestamp(),0);
ALTER TABLE public.taxi_bot_address_cache ENABLE ROW LEVEL SECURITY;ALTER TABLE public.taxi_bot_address_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taxi_bot_address_cache,public.taxi_bot_address_budget FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.taxi_bot_address_lookup(p_tenant uuid,p_key text,p_lease uuid,p_result jsonb)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.taxi_bot_address_cache;budget public.taxi_bot_address_budget;new_lease uuid;ttl interval;BEGIN
 IF p_key IS NULL OR p_key!~'^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=p_tenant AND tipo_negocio='taxi')THEN RAISE EXCEPTION 'invalid address lookup';END IF;
 -- Same global lock order for claim and completion; no duplicate parallel lookup of a cached address.
 SELECT * INTO budget FROM public.taxi_bot_address_budget WHERE id=true FOR UPDATE;
 SELECT * INTO item FROM public.taxi_bot_address_cache WHERE tenant_id=p_tenant AND query_hash=p_key FOR UPDATE;
 IF p_lease IS NOT NULL THEN
  IF item.lease IS DISTINCT FROM p_lease OR item.lease_until<=clock_timestamp()THEN RETURN jsonb_build_object('state','stale');END IF;
  IF jsonb_typeof(p_result)IS DISTINCT FROM 'object' OR coalesce(p_result->>'kind','')NOT IN('resolved','ambiguous','unavailable')OR octet_length(p_result::text)>4096 THEN RAISE EXCEPTION 'invalid address result';END IF;
  ttl:=CASE p_result->>'kind'WHEN 'resolved'THEN interval '7 days'WHEN 'ambiguous'THEN interval '5 minutes'ELSE interval '30 seconds'END;
  UPDATE public.taxi_bot_address_cache SET result=p_result,lease=NULL,lease_until=NULL,expires_at=clock_timestamp()+ttl,updated_at=clock_timestamp()WHERE tenant_id=p_tenant AND query_hash=p_key;
  RETURN jsonb_build_object('state','saved');
 END IF;
 IF p_result IS NOT NULL THEN RAISE EXCEPTION 'address result requires lease';END IF;
 IF item.result IS NOT NULL AND item.expires_at>clock_timestamp()THEN RETURN jsonb_build_object('state','cached','result',item.result);END IF;
 IF item.lease IS NOT NULL AND item.lease_until>clock_timestamp()THEN RETURN jsonb_build_object('state','busy');END IF;
 IF budget.window_at<=clock_timestamp()-interval '1 minute'THEN budget.requests:=0;budget.window_at:=clock_timestamp();END IF;
 IF budget.requests>=30 OR (SELECT count(*)FROM public.taxi_bot_address_cache WHERE lease_until>clock_timestamp())>=2 THEN RETURN jsonb_build_object('state','limited');END IF;
 DELETE FROM public.taxi_bot_address_cache WHERE (tenant_id,query_hash)IN(SELECT tenant_id,query_hash FROM public.taxi_bot_address_cache WHERE tenant_id=p_tenant AND expires_at<clock_timestamp()AND(lease_until IS NULL OR lease_until<clock_timestamp())AND query_hash<>p_key ORDER BY updated_at LIMIT 100);
 IF item.tenant_id IS NULL AND (SELECT count(*)FROM public.taxi_bot_address_cache WHERE tenant_id=p_tenant)>=500 THEN RETURN jsonb_build_object('state','limited');END IF;
 new_lease:=gen_random_uuid();
 INSERT INTO public.taxi_bot_address_cache(tenant_id,query_hash,lease,lease_until)VALUES(p_tenant,p_key,new_lease,clock_timestamp()+interval '20 seconds')
 ON CONFLICT(tenant_id,query_hash)DO UPDATE SET lease=excluded.lease,lease_until=excluded.lease_until;
 UPDATE public.taxi_bot_address_budget SET window_at=budget.window_at,requests=budget.requests+1 WHERE id=true;
 RETURN jsonb_build_object('state','fetch','lease',new_lease);
END $$;
REVOKE ALL ON FUNCTION public.taxi_bot_address_lookup(uuid,text,uuid,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.taxi_bot_address_lookup(uuid,text,uuid,jsonb)TO service_role;
COMMIT;
