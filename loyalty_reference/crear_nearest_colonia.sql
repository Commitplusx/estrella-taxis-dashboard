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
  ORDER BY distance_meters ASC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_nearest_colonia(double precision, double precision) TO anon, authenticated, service_role;
