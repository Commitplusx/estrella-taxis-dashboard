-- 1. Habilitar la extensión de vectores (si no está habilitada ya)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Crear la tabla polimórfica de catálogos
CREATE TABLE IF NOT EXISTS public.catalogos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    tipo_item TEXT NOT NULL, -- Ej: 'comida', 'servicio_medico', 'refaccion'
    nombre TEXT NOT NULL,
    precio NUMERIC, -- Puede ser nulo si el precio varía o no aplica
    detalles JSONB DEFAULT '{}'::jsonb, -- Aquí guardamos ingredientes, duración, etc.
    embedding VECTOR(768), -- Vector para Gemini (768 dimensiones)
    disponible BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Crear índices para búsquedas ultra-rápidas
-- Índice para filtrar rápido por empresa y tipo
CREATE INDEX IF NOT EXISTS catalogos_tenant_tipo_idx ON public.catalogos(tenant_id, tipo_item);
-- Índice para el JSONB
CREATE INDEX IF NOT EXISTS catalogos_detalles_gin_idx ON public.catalogos USING GIN (detalles);
-- Índice vectorial para la búsqueda semántica
CREATE INDEX IF NOT EXISTS catalogos_embedding_idx ON public.catalogos USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 4. Crear la función de búsqueda de similitud (RAG)
CREATE OR REPLACE FUNCTION match_catalogos(
  query_embedding VECTOR(768),
  match_threshold FLOAT,
  match_count INT,
  p_tenant_id UUID
)
RETURNS TABLE (
  id UUID,
  nombre TEXT,
  precio NUMERIC,
  detalles JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    catalogos.id,
    catalogos.nombre,
    catalogos.precio,
    catalogos.detalles,
    1 - (catalogos.embedding <=> query_embedding) AS similarity
  FROM catalogos
  WHERE catalogos.tenant_id = p_tenant_id
    AND catalogos.disponible = true
    AND 1 - (catalogos.embedding <=> query_embedding) > match_threshold
  ORDER BY catalogos.embedding <=> query_embedding
  LIMIT match_count;
$$;
