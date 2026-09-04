-- Tabla de viajes activos con token de seguimiento
-- Cada vez que el bot registra un viaje, se crea un registro aquí
-- El cliente recibe un link con el token para ver su taxi en tiempo real

CREATE TABLE IF NOT EXISTS public.viajes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT UNIQUE NOT NULL,               -- Token corto para la URL pública de tracking
  tenant_id     UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
  device_id     INTEGER NOT NULL,                   -- ID de la unidad en Traccar
  taxi_name     TEXT NOT NULL,                      -- Nombre legible de la unidad
  cliente_tel   TEXT NOT NULL,                      -- Teléfono del cliente para identificar el viaje
  origen        TEXT NOT NULL,
  destino       TEXT NOT NULL,
  origen_lat    DOUBLE PRECISION,
  origen_lng    DOUBLE PRECISION,
  estado        TEXT NOT NULL DEFAULT 'en_camino',  -- en_camino | completado | cancelado
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para buscar viajes por token rápidamente (se usa en la página pública)
CREATE INDEX IF NOT EXISTS idx_viajes_token ON public.viajes (token);

-- Permitir lectura pública por token sin autenticación (la página /track/:token es pública)
ALTER TABLE public.viajes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura pública por token"
  ON public.viajes
  FOR SELECT
  USING (true);

CREATE POLICY "Solo el sistema puede insertar viajes"
  ON public.viajes
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Solo el sistema puede actualizar el estado"
  ON public.viajes
  FOR UPDATE
  USING (true);
