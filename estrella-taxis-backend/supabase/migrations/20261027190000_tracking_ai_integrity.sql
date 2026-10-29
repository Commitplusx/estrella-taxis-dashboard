-- Candidate release. Deploy updated Edge functions and both clients together.
-- Traccar verifies each caller and device scope in Edge; public REST cannot write scores.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.driving_scores
  ADD COLUMN IF NOT EXISTS algorithm_version text NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN IF NOT EXISTS quality jsonb,
  ADD COLUMN IF NOT EXISTS computed_at timestamptz;
DO $$ DECLARE policy record; sequence_name text; BEGIN
  FOR policy IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='driving_scores'
  LOOP EXECUTE format('DROP POLICY %I ON public.driving_scores',policy.policyname); END LOOP;
  sequence_name:=pg_get_serial_sequence('public.driving_scores','id');
  IF sequence_name IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC,anon,authenticated',sequence_name);
    EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %s TO service_role',sequence_name);
  END IF;
END $$;
ALTER TABLE public.driving_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driving_scores FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.driving_scores TO service_role;

CREATE TABLE public.tracking_operations (
  user_id bigint NOT NULL CHECK(user_id>0),
  request_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN('audit','score')),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN('running','completed','failed')),
  lease uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  result jsonb,
  response_status integer CHECK(response_status BETWEEN 200 AND 599),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY(user_id,request_id),
  CHECK(result IS NULL OR octet_length(result::text)<=524288)
);
CREATE INDEX tracking_operations_created ON public.tracking_operations(created_at);
CREATE INDEX tracking_operations_user_recent ON public.tracking_operations(user_id,created_at DESC);
ALTER TABLE public.tracking_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tracking_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.tracking_operation_begin(p_user bigint,p_key uuid,p_kind text,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE previous public.tracking_operations%ROWTYPE; next_lease uuid; now_at timestamptz:=clock_timestamp(); BEGIN
  IF p_user IS NULL OR p_user<=0 OR p_key IS NULL OR p_kind IS NULL OR p_kind NOT IN('audit','score') OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid tracking operation'; END IF;
  -- One short lock coordinates limits across all Edge instances, without holding it during HTTP.
  PERFORM pg_advisory_xact_lock(771403,1900);
  DELETE FROM public.tracking_operations WHERE (user_id,request_id) IN (
    SELECT user_id,request_id FROM public.tracking_operations WHERE created_at<now_at-interval '30 days' ORDER BY created_at LIMIT 500
  );
  SELECT * INTO previous FROM public.tracking_operations WHERE user_id=p_user AND request_id=p_key FOR UPDATE;
  IF FOUND THEN
    IF previous.fingerprint<>p_fingerprint OR previous.kind<>p_kind THEN RETURN jsonb_build_object('state','conflict'); END IF;
    IF previous.state IN('completed','failed') THEN RETURN jsonb_build_object('state','replay','result',previous.result,'status',previous.response_status); END IF;
    -- An expired provider call is uncertain. Never silently bill a second analysis.
    RETURN jsonb_build_object('state',CASE WHEN previous.lease_until<now_at THEN 'uncertain' ELSE 'running' END);
  END IF;
  IF (SELECT count(*) FROM public.tracking_operations WHERE created_at>now_at-interval '10 minutes')>=100
    OR (SELECT count(*) FROM public.tracking_operations WHERE user_id=p_user AND kind=p_kind AND created_at>now_at-interval '10 minutes')>=(CASE WHEN p_kind='audit' THEN 3 ELSE 12 END)
    OR (SELECT count(*) FROM public.tracking_operations WHERE state='running' AND lease_until>now_at)>=4
    OR EXISTS(SELECT 1 FROM public.tracking_operations WHERE user_id=p_user AND state='running' AND lease_until>now_at)
  THEN RETURN jsonb_build_object('state','limited'); END IF;
  next_lease:=gen_random_uuid();
  INSERT INTO public.tracking_operations(user_id,request_id,kind,fingerprint,state,lease,lease_until)
  VALUES(p_user,p_key,p_kind,p_fingerprint,'running',next_lease,now_at+interval '2 minutes');
  RETURN jsonb_build_object('state','proceed','lease',next_lease);
END $$;

CREATE FUNCTION public.tracking_operation_complete(p_user bigint,p_key uuid,p_lease uuid,p_result jsonb,p_status integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE changed integer; BEGIN
  IF p_result IS NULL OR octet_length(p_result::text)>524288 OR p_status IS NULL OR p_status<200 OR p_status>599 THEN RAISE EXCEPTION 'invalid tracking result'; END IF;
  UPDATE public.tracking_operations SET result=p_result,response_status=p_status,
    state=CASE WHEN p_status<400 THEN 'completed' ELSE 'failed' END,completed_at=clock_timestamp()
  WHERE user_id=p_user AND request_id=p_key AND lease=p_lease AND state='running' AND lease_until>=clock_timestamp();
  GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION public.tracking_operation_begin(bigint,uuid,text,text),public.tracking_operation_complete(bigint,uuid,uuid,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tracking_operation_begin(bigint,uuid,text,text),public.tracking_operation_complete(bigint,uuid,uuid,jsonb,integer) TO service_role;

CREATE FUNCTION public.tracking_score_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
  IF NEW.algorithm_version<>'tracking-score-v2' OR NEW.computed_at IS NULL OR NEW.quality IS NULL OR jsonb_typeof(NEW.quality)<>'object' THEN RAISE EXCEPTION 'tracking score requires validated evidence'; END IF;
  IF TG_OP='UPDATE' AND OLD.computed_at IS NOT NULL AND NEW.computed_at<OLD.computed_at THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='A newer tracking score already exists'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tracking_score_version_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER tracking_score_guard BEFORE INSERT OR UPDATE ON public.driving_scores FOR EACH ROW EXECUTE FUNCTION public.tracking_score_version_guard();
COMMIT;
