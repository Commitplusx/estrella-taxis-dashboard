-- 1. Límite de 2.5km (2500m) para rechazar GPS foráneos
CREATE OR REPLACE FUNCTION get_nearest_colonia(p_lat double precision, p_lng double precision)
RETURNS TABLE (id uuid, nombre text, lat double precision, lng double precision, distance_meters double precision)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.nombre::text, c.lat, c.lng, 
         ST_Distance(ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as distance_meters
  FROM colonias c
  WHERE c.lat IS NOT NULL 
    AND ST_DWithin(ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, 2500)
  ORDER BY distance_meters ASC
  LIMIT 1;
END;
$$;

-- 2. Incrementar rigor del fuzzy search a 0.30
CREATE OR REPLACE FUNCTION search_colonia_fuzzy(query_text text)
RETURNS TABLE (id uuid, nombre text, lat double precision, lng double precision, sim real)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.nombre::text, c.lat, c.lng, similarity(c.nombre::text, query_text) as sim
  FROM colonias c
  WHERE c.lat IS NOT NULL AND similarity(c.nombre::text, query_text) > 0.30
  ORDER BY sim DESC
  LIMIT 10;
END;
$$;

GRANT EXECUTE ON FUNCTION get_nearest_colonia(double precision, double precision) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_colonia_fuzzy(text) TO anon, authenticated, service_role;
