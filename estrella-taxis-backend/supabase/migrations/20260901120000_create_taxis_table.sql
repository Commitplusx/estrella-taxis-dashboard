-- Tabla para almacenar la ubicación en tiempo real de los taxis
CREATE TABLE taxis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT UNIQUE NOT NULL, -- El ID único proveniente de Traccar
    lat NUMERIC,
    lng NUMERIC,
    h3_index TEXT REFERENCES h3_zonas(h3_index), -- Hexágono actual donde está el taxi
    bateria NUMERIC,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Trigger para actualizar updated_at automáticamente
CREATE TRIGGER update_taxis_updated_at
    BEFORE UPDATE ON taxis
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Políticas de seguridad
ALTER TABLE taxis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura pública de taxis"
ON taxis FOR SELECT
TO public
USING (true);

CREATE POLICY "Servicio puede modificar taxis"
ON taxis FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
