CREATE TABLE IF NOT EXISTS public.telnyx_active_calls (
    call_control_id TEXT PRIMARY KEY,
    history         TEXT NOT NULL,
    bot_speaking    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitar RLS si aplica, aunque las Edge Functions de sistema se saltan el RLS usando service_role
ALTER TABLE public.telnyx_active_calls ENABLE ROW LEVEL SECURITY;
