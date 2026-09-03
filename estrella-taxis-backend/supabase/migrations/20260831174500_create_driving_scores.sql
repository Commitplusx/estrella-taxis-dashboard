-- Tabla de scores de manejo calculados por el algoritmo de Stellar Tracking.
-- Guarda el análisis diario de cada vehículo: frenadas bruscas, aceleradas,
-- excesos de velocidad, ralentí excesivo y distancia recorrida.

CREATE TABLE IF NOT EXISTS public.driving_scores (
  id                   BIGSERIAL    PRIMARY KEY,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Identificación del vehículo
  device_id            INTEGER      NOT NULL,
  device_name          TEXT         NOT NULL,
  score_date           DATE         NOT NULL DEFAULT CURRENT_DATE,

  -- Score principal (0-100)
  score                INTEGER      NOT NULL CHECK (score >= 0 AND score <= 100),
  score_label          TEXT         NOT NULL, -- 'Excelente', 'Bueno', 'Regular', 'Deficiente'

  -- Eventos de comportamiento detectados
  harsh_braking        INTEGER      NOT NULL DEFAULT 0,  -- Frenadas bruscas
  harsh_acceleration   INTEGER      NOT NULL DEFAULT 0,  -- Aceleradas bruscas
  overspeed_events     INTEGER      NOT NULL DEFAULT 0,  -- Veces que pasó el límite
  idle_minutes         FLOAT        NOT NULL DEFAULT 0,  -- Minutos de ralentí excesivo

  -- Estadísticas del turno
  distance_km          FLOAT        NOT NULL DEFAULT 0,
  duration_minutes     FLOAT        NOT NULL DEFAULT 0,
  max_speed_kmh        FLOAT        NOT NULL DEFAULT 0,
  positions_analyzed   INTEGER      NOT NULL DEFAULT 0,

  -- Un score por vehículo por día (se hace upsert)
  UNIQUE (device_id, score_date)
);

CREATE INDEX IF NOT EXISTS idx_driving_scores_device_date
  ON public.driving_scores (device_id, score_date DESC);

CREATE INDEX IF NOT EXISTS idx_driving_scores_date
  ON public.driving_scores (score_date DESC);

ALTER TABLE public.driving_scores ENABLE ROW LEVEL SECURITY;

-- La app Flutter con anon key puede insertar y actualizar
DROP POLICY IF EXISTS "anon_insert" ON public.driving_scores;
CREATE POLICY "anon_insert" ON public.driving_scores
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update" ON public.driving_scores;
CREATE POLICY "anon_update" ON public.driving_scores
  FOR UPDATE TO anon USING (true);

-- Leer: Dashboard web o Flutter (cualquiera)
DROP POLICY IF EXISTS "anon_select" ON public.driving_scores;
CREATE POLICY "anon_select" ON public.driving_scores
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "authenticated_select" ON public.driving_scores;
CREATE POLICY "authenticated_select" ON public.driving_scores
  FOR SELECT TO authenticated USING (true);
