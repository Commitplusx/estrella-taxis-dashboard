-- 1. Agregar columna de etiquetas/sinónimos a colonias
ALTER TABLE colonias ADD COLUMN IF NOT EXISTS etiquetas text[] DEFAULT '{}';

-- Índice GIN para búsqueda rápida en arrays
CREATE INDEX IF NOT EXISTS idx_colonias_etiquetas ON colonias USING GIN(etiquetas);

-- 2. Tabla para guardar ubicaciones frecuentes del cliente (origen y destino)
CREATE TABLE IF NOT EXISTS cliente_ubicaciones (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_telefono text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('origen', 'destino')),  -- si es donde recoge o donde recibe
  colonia_nombre text,
  colonia_id uuid REFERENCES colonias(id),
  lat double precision,
  lng double precision,
  veces integer DEFAULT 1,
  ultima_vez timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(cliente_telefono, tipo, colonia_nombre)
);

-- Índice para buscar rápido por teléfono
CREATE INDEX IF NOT EXISTS idx_ubic_telefono ON cliente_ubicaciones(cliente_telefono);

-- 3. Función para buscar colonia por etiqueta primero, luego por nombre
CREATE OR REPLACE FUNCTION search_colonia_por_etiqueta(query_text text)
RETURNS TABLE (id uuid, nombre text, lat double precision, lng double precision, sim real)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Primero buscar por etiqueta exacta
  RETURN QUERY
  SELECT c.id, c.nombre::text, c.lat, c.lng, 1.0::real as sim
  FROM colonias c
  WHERE c.lat IS NOT NULL
    AND query_text = ANY(c.etiquetas)
  LIMIT 5;

  -- Si no encontró nada por etiqueta, retorna vacío (el bot fallará al fuzzy)
END;
$$;

GRANT EXECUTE ON FUNCTION search_colonia_por_etiqueta(text) TO anon, authenticated, service_role;
GRANT ALL ON TABLE cliente_ubicaciones TO anon, authenticated, service_role;
