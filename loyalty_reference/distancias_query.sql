SELECT 
  c.id as colonia_id, 
  z.id as zona_id, 
  ST_Distance(ST_SetSRID(ST_Point(c.lng, c.lat), 4326)::geography, z.geom::geography) as dist_metros
FROM colonias c 
CROSS JOIN zonas_gps z 
WHERE c.lat IS NOT NULL;
