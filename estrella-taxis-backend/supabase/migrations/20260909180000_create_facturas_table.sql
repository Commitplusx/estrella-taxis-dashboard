-- Crear tabla facturas para registrar solicitudes de facturación del bot
CREATE TABLE IF NOT EXISTS facturas (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  cliente_tel text NOT NULL,
  media_id text NOT NULL,
  media_type text NOT NULL DEFAULT 'image',
  media_url text,
  pdf_url text,
  datos_fiscales text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT facturas_pkey PRIMARY KEY (id),
  CONSTRAINT facturas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT facturas_estado_check CHECK (estado IN ('pendiente', 'facturada', 'cancelada'))
);

-- Si la tabla ya existía de antes, agregamos las nuevas columnas de forma segura:
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS pdf_url text;

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS facturas_tenant_id_idx ON facturas(tenant_id);
CREATE INDEX IF NOT EXISTS facturas_estado_idx ON facturas(estado);
CREATE INDEX IF NOT EXISTS facturas_created_at_idx ON facturas(created_at DESC);

-- RLS habilitado
ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;

-- Permitir lectura y escritura a usuarios autenticados.
CREATE POLICY "Usuarios autenticados pueden ver facturas"
ON facturas FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Usuarios autenticados pueden actualizar facturas"
ON facturas FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role puede insertar facturas"
ON facturas FOR INSERT
WITH CHECK (true);

-- Crear bucket en Supabase Storage para guardar tickets y PDFs de facturas
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('facturas_media', 'facturas_media', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Políticas de Storage para acceso a los archivos (sin PL/pgSQL para evitar deadlock)
DROP POLICY IF EXISTS "Public Read Access Facturas Media" ON storage.objects;
CREATE POLICY "Public Read Access Facturas Media"
ON storage.objects FOR SELECT
USING (bucket_id = 'facturas_media');

DROP POLICY IF EXISTS "Service Role Upload Facturas Media" ON storage.objects;
CREATE POLICY "Service Role Upload Facturas Media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'facturas_media');
