CREATE OR REPLACE VIEW vista_colonias_tarifas AS
SELECT 
  o.nombre AS origen_colonia,
  d.nombre AS destino_colonia,
  ct.precio
FROM colonias_tarifas ct
JOIN colonias o ON ct.origen_colonia_id = o.id
JOIN colonias d ON ct.destino_colonia_id = d.id
ORDER BY o.nombre, d.nombre;
