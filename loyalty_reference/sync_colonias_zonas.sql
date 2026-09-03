-- Este script actualiza la columna 'etiqueta_zona' de la tabla 'colonias'
-- basándose en la intersección de sus coordenadas (lat, lng) 
-- con los polígonos geométricos definidos en la tabla 'zonas_gps'

UPDATE colonias c
SET etiqueta_zona = (
    SELECT z.nombre
    FROM zonas_gps z
    WHERE ST_Contains(z.geom, ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326))
    LIMIT 1
)
WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL;

-- Para las colonias que no caen en ninguna zona, podemos marcarlas como NULL
-- o dejarlas como estaban (la query anterior las pondrá en NULL si no coinciden)
