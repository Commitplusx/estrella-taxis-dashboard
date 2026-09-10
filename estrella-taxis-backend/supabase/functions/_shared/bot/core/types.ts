import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export interface EmpresaConfig {
  id: string;
  nombre_bot?: string;
  nombre_empresa?: string;
  ciudad?: string;
  prompt_personalizado?: string;
  dispatcher_phone?: string;
  contador_phone?: string;
  waba_number?: string;
  tipo_negocio?: string;
  categorias_catalogo?: string[];
}

export interface ToolData {
  pedido?: string;
  direccion?: string;
  tipo_entrega?: string;
  nombre?: string;
  origen?: string;
  destino?: string;
  motivo?: string;
  resumen?: string;
  query?: string;
  mensaje?: string;
  boton?: string;
  items?: Array<{ nombre: string; descripcion?: string }>;
  [key: string]: unknown;
}

export type SupabaseAppClient = SupabaseClient;

export interface PermisosSistema {
  [key: string]: boolean;
}
