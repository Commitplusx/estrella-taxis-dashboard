CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION search_colonia_fuzzy(query_text text)
RETURNS TABLE (id uuid, nombre text, lat double precision, lng double precision, sim real) AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.nombre::text, c.lat, c.lng, similarity(c.nombre::text, query_text) as sim
  FROM colonias c
  WHERE c.lat IS NOT NULL AND similarity(c.nombre::text, query_text) > 0.15
  ORDER BY sim DESC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql;
