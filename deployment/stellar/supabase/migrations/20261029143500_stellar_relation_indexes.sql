BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE INDEX empresas_stellar_plan ON public.empresas(paquete_id);
CREATE INDEX h3_stellar_owner ON public.h3_zonas(tenant_id);
CREATE INDEX taxi_quality_cases_contact ON public.taxi_bot_quality_cases(tenant_id,waba,contact_hash);
CREATE INDEX taxi_turn_traces_contact ON public.taxi_bot_turn_traces(tenant_id,waba,contact_hash);
COMMIT;
