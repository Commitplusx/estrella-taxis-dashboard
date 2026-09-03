CREATE TABLE IF NOT EXISTS geocode_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lat_key text NOT NULL,
  lng_key text NOT NULL,
  barrio text,
  hits integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  UNIQUE(lat_key, lng_key)
);

-- Habilitar RLS
ALTER TABLE geocode_cache ENABLE ROW LEVEL SECURITY;

-- Service role puede hacer lo que sea (el bot usa anon/service role depende de la key, pero dejemos anon para select/insert si el bot no usa service role siempre)
CREATE POLICY "Anon_Access_Geocode_Cache"
ON geocode_cache FOR ALL TO anon
USING (true)
WITH CHECK (true);
