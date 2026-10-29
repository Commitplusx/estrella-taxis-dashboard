-- Fresh Stellar project only. Never apply to the restaurant or delivery databases.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF to_regclass('public.empresas') IS NOT NULL OR to_regclass('public.pedidos') IS NOT NULL
    OR to_regclass('public.ruta_envios') IS NOT NULL THEN
    RAISE EXCEPTION 'stellar_bootstrap_requires_empty_project';
  END IF;
END $$;
CREATE TABLE public.paquetes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nombre text NOT NULL,
  precio_mensual numeric NOT NULL DEFAULT 0,incluye_bot boolean NOT NULL DEFAULT false,
  incluye_whatsapp boolean NOT NULL DEFAULT false,limite_vehiculos integer,
  activo boolean NOT NULL DEFAULT true,features jsonb NOT NULL DEFAULT '{}',
  permisos_sistema jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.empresas(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nombre_empresa text NOT NULL,
  nombre_bot text,tipo_negocio text NOT NULL DEFAULT 'taxi' CHECK(tipo_negocio='taxi'),
  telefono_whatsapp text,dispatcher_phone text,ciudad text,
  activo boolean NOT NULL DEFAULT false,paquete_id uuid REFERENCES public.paquetes(id),
  logo_url text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.perfiles(
  traccar_user_id integer PRIMARY KEY CHECK(traccar_user_id>0),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  rol text NOT NULL CHECK(rol IN('superadmin','admin_empresa','operador')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX perfiles_stellar_empresa ON public.perfiles(empresa_id);
CREATE TABLE public.webhook_queue(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
-- No restaurant queue trigger or restaurant recovery worker exists in this database.
CREATE TABLE public.conductores(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.empresas(id),
  device_id integer NOT NULL UNIQUE CHECK(device_id>0),telefono_whatsapp text NOT NULL,
  nombre text NOT NULL,activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conductores_stellar_tenant ON public.conductores(tenant_id,activo);
CREATE TABLE public.viajes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token text UNIQUE NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.empresas(id),device_id integer,taxi_name text,
  cliente_tel text NOT NULL,cliente_nombre text,origen text NOT NULL,destino text NOT NULL,
  origen_lat double precision,origen_lng double precision,destino_lat double precision,destino_lng double precision,
  distancia_estimada_km double precision,estado text NOT NULL,
  conductores_contactados integer[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.h3_zonas(
  h3_index text PRIMARY KEY,precio numeric NOT NULL,resolucion integer NOT NULL,
  nombre text,tenant_id uuid REFERENCES public.empresas(id),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.lugares_frecuentes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.empresas(id),
  alias text NOT NULL,nombre text NOT NULL,lat double precision NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK(lng BETWEEN -180 AND 180),activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lugares_stellar_tenant_alias ON public.lugares_frecuentes(tenant_id,alias) WHERE activo;
CREATE TABLE public.driving_scores(
  id bigserial PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now(),device_id integer NOT NULL,
  device_name text NOT NULL,score_date date NOT NULL DEFAULT current_date,
  score integer NOT NULL CHECK(score BETWEEN 0 AND 100),score_label text NOT NULL,
  harsh_braking integer NOT NULL DEFAULT 0,harsh_acceleration integer NOT NULL DEFAULT 0,
  overspeed_events integer NOT NULL DEFAULT 0,idle_minutes double precision NOT NULL DEFAULT 0,
  distance_km double precision NOT NULL DEFAULT 0,duration_minutes double precision NOT NULL DEFAULT 0,
  max_speed_kmh double precision NOT NULL DEFAULT 0,positions_analyzed integer NOT NULL DEFAULT 0,
  UNIQUE(device_id,score_date)
);
CREATE INDEX driving_scores_stellar_date ON public.driving_scores(score_date DESC);
CREATE TABLE public.command_logs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now(),
  device_name text NOT NULL,command_type text NOT NULL,user_email text NOT NULL
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['paquetes','empresas','perfiles','webhook_queue','conductores','viajes','h3_zonas','lugares_frecuentes','driving_scores','command_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
  END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE public.driving_scores_id_seq TO service_role;
COMMIT;
