CREATE OR REPLACE FUNCTION public.get_zona_from_coords(p_lat double precision, p_lng double precision)
 RETURNS TABLE(id uuid, nombre text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT z.id, z.nombre
  FROM zonas_gps z
  WHERE ST_DWithin(z.geom::geography, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, 150)
  ORDER BY ST_Distance(z.geom::geography, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) ASC
  LIMIT 1;
$function$;
