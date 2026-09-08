-- Tabla: lugares_frecuentes
-- Diccionario local de lugares conocidos por tenant.
-- El bot consulta aqui PRIMERO antes de llamar a Google Maps,
-- para resolver apodos locales: "el crucero del OXXO", "la terminal", etc.

CREATE TABLE IF NOT EXISTS lugares_frecuentes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES empresas(id) ON DELETE CASCADE,
  alias       text NOT NULL,            -- Como lo dice el cliente (ej: "el oxxo de la glorieta")
  nombre      text NOT NULL,            -- Nombre formal / descripcion del lugar
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  precio_fijo integer DEFAULT NULL,     -- Tarifa fija opcional si aplica a este destino
  activo      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- Indice por tenant para busquedas rapidas
CREATE INDEX IF NOT EXISTS idx_lugares_tenant ON lugares_frecuentes(tenant_id, activo);

-- Full-text search en alias para busqueda difusa
CREATE INDEX IF NOT EXISTS idx_lugares_alias_trgm ON lugares_frecuentes
  USING GIN (alias gin_trgm_ops);

-- Habilitar extension si no existe (necesaria para busqueda por trigrama)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- RLS: el service role tiene acceso completo (Edge Functions)
ALTER TABLE lugares_frecuentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_lugares" ON lugares_frecuentes
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE lugares_frecuentes IS
  'Diccionario local de lugares frecuentes por empresa de taxi. El bot lo consulta antes de Google Maps para resolver apodos locales de la ciudad.';

COMMENT ON COLUMN lugares_frecuentes.alias IS 'Como lo menciona el cliente en WhatsApp (puede haber multiples filas con distintos alias para el mismo lugar)';
COMMENT ON COLUMN lugares_frecuentes.precio_fijo IS 'Si el viaje a este destino tiene precio cerrado, se usa aqui en vez del calculo H3';
