-- Tabla de auditoría: registra cada comando remoto enviado a un taxi (apagar/reanudar motor, etc.)
-- Ejecutada manualmente en Supabase el 28/08/2026. Este archivo documenta el estado real de la DB.

CREATE TABLE IF NOT EXISTS public.command_logs (
  id            BIGSERIAL    PRIMARY KEY,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  device_name   TEXT         NOT NULL,
  command_type  TEXT         NOT NULL,
  user_email    TEXT         NOT NULL
);

-- RLS habilitado según arquitectura §11
ALTER TABLE public.command_logs ENABLE ROW LEVEL SECURITY;

-- Solo el service_role (Edge Functions) puede insertar registros
CREATE POLICY "service_role_insert" ON public.command_logs
  FOR INSERT TO service_role WITH CHECK (true);

-- Usuarios autenticados del Dashboard pueden leer el historial de auditoría
CREATE POLICY "authenticated_select" ON public.command_logs
  FOR SELECT TO authenticated USING (true);
