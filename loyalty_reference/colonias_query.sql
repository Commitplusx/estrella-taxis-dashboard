SELECT DISTINCT ON (c.nombre) c.id, c.nombre, c.lat, c.lng, z.id as zona_id, z.nombre as zona_nombre
FROM colonias c
LEFT JOIN zonas_gps z ON ST_Contains(z.geom, ST_SetSRID(ST_Point(c.lng, c.lat), 4326))
WHERE c.lat IS NOT NULL
ORDER BY c.nombre, c.id
