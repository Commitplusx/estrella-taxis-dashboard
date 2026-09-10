-- MIGRACION: Push Notifications - 20260910
-- Ejecutar en: Supabase -> SQL Editor

-- 1. Tabla para almacenar suscripciones push por dispositivo/navegador
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  traccar_user_id bigint,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_tenant_idx ON public.push_subscriptions(tenant_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_all" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- 2. Funcion trigger que llama a la Edge Function send-push via pg_net
CREATE OR REPLACE FUNCTION public.notify_new_pedido_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_edge_url text;
  v_anon_key text;
BEGIN
  v_edge_url := current_setting('app.supabase_url', true) || '/functions/v1/send-push';
  v_anon_key := current_setting('app.anon_key', true);
  PERFORM net.http_post(
    url     := v_edge_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon_key),
    body    := jsonb_build_object('tenant_id', NEW.tenant_id, 'pedido', row_to_json(NEW))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[push] Error: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_pedido_push ON public.pedidos;
CREATE TRIGGER trg_notify_new_pedido_push
  AFTER INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_pedido_push();

-- CONFIGURAR (ejecutar con tus valores reales):
-- ALTER DATABASE postgres SET app.supabase_url = 'https://TU_PROYECTO.supabase.co';
-- ALTER DATABASE postgres SET app.anon_key = 'TU_ANON_KEY';
-- Habilitar pg_net: Dashboard -> Database -> Extensions -> pg_net
