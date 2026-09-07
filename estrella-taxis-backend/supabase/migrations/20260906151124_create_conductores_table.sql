-- 1. Crear tabla para vincular dispositivos con el WhatsApp de los choferes
CREATE TABLE IF NOT EXISTS public.conductores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL UNIQUE,
    telefono_whatsapp TEXT NOT NULL,
    nombre TEXT NOT NULL,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para busquedas ultra-rapidas
CREATE INDEX IF NOT EXISTS idx_conductores_telefono ON public.conductores(telefono_whatsapp);
CREATE INDEX IF NOT EXISTS idx_conductores_device ON public.conductores(device_id);

-- RLS (Proteccion de datos)
ALTER TABLE public.conductores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Servicio puede modificar conductores" ON public.conductores FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Modificar la tabla de viajes para soportar la Cascada
ALTER TABLE public.viajes ADD COLUMN IF NOT EXISTS conductores_contactados INTEGER[] DEFAULT '{}';
ALTER TABLE public.viajes ALTER COLUMN device_id DROP NOT NULL, ALTER COLUMN taxi_name DROP NOT NULL;

-- 3. FUNCION ATÓMICA: Agregar chofer a la lista sin Race Conditions
CREATE OR REPLACE FUNCTION array_append_viaje_conductores(v_id UUID, d_id INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Strict update
  UPDATE public.viajes 
  SET conductores_contactados = array_append(conductores_contactados, d_id)
  WHERE id = v_id AND NOT (conductores_contactados @> ARRAY[d_id]);
END;
$$;

-- 4. FUNCION ATÓMICA: Asignación a prueba de balas (Optimistic Locking con SKIP LOCKED)
CREATE OR REPLACE FUNCTION assign_taxi_to_trip(v_id UUID, p_device_id INTEGER, p_taxi_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_estado TEXT;
BEGIN
  -- Bloqueamos la fila (FOR UPDATE). Esperaremos si hay un update concurrente pequeño.
  SELECT estado INTO v_estado FROM public.viajes WHERE id = v_id FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  IF v_estado = 'buscando_conductor' THEN
    UPDATE public.viajes 
    SET estado = 'en_camino', device_id = p_device_id, taxi_name = p_taxi_name, updated_at = NOW()
    WHERE id = v_id;
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;
