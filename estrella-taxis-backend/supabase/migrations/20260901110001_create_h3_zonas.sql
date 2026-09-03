-- Crear tabla de zonas H3 para el sistema de precios espaciales
CREATE TABLE h3_zonas (
    h3_index TEXT PRIMARY KEY,
    precio NUMERIC NOT NULL,
    resolucion INTEGER NOT NULL,
    nombre TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Trigger para actualizar automáticamente updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_h3_zonas_updated_at
    BEFORE UPDATE ON h3_zonas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Políticas de seguridad para permitir lectura pública y restringir escritura
ALTER TABLE h3_zonas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura pública de zonas H3"
ON h3_zonas FOR SELECT
TO public
USING (true);

-- (Opcional) Si quieres que solo roles de servicio puedan insertar/actualizar:
CREATE POLICY "Servicio puede modificar zonas H3"
ON h3_zonas FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
