import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { ToolData } from "./types.ts";

export const ZodToolSchemas: Record<string, z.ZodTypeAny> = {
  // COMMON
  escalar_humano: z.object({
    resumen: z.coerce.string().catch(''),
    motivo: z.coerce.string().catch('').optional()
  }).passthrough(),
  
  pedir_ubicacion: z.object({}).passthrough(),
  
  consultar_catalogo: z.object({
    query: z.coerce.string().catch('')
  }).passthrough(),

  // RESTAURANT
  preguntar_tipo_entrega: z.object({}).passthrough(),
  
  mostrar_menu_lista: z.object({
    mensaje: z.coerce.string().catch(''),
    boton: z.coerce.string().catch(''),
    items: z.array(z.object({
      nombre: z.coerce.string().catch(''),
      descripcion: z.coerce.string().catch('').optional(),
      categoria: z.coerce.string().catch('').optional()
    })).catch([])
  }).passthrough(),
  
  enviar_pedido: z.object({
    pedido: z.coerce.string().catch(''),
    direccion: z.coerce.string().catch(''),
    tipo_entrega: z.coerce.string().catch(''),
    nombre: z.coerce.string().catch('')
  }).passthrough(),
  
  cotizar_envio: z.object({
    direccion: z.coerce.string().catch('')
  }).passthrough(),

  // TAXI
  book_taxi: z.object({
    origen: z.coerce.string().catch(''),
    destino: z.coerce.string().catch(''),
    nombre: z.coerce.string().catch('')
  }).passthrough(),
  
  cotizar_viaje: z.object({
    origen: z.coerce.string().catch(''),
    destino: z.coerce.string().catch('')
  }).passthrough(),
  
  cancelar_viaje: z.object({
    motivo: z.coerce.string().catch('')
  }).passthrough(),
};

/**
 * Parsea y sanitiza los argumentos del Tool usando Zod.
 * Si falla o el tool no tiene schema, devuelve el objeto original con fallback.
 */
export function safeParseToolData(toolName: string, rawData: unknown): ToolData {
  try {
    const schema = ZodToolSchemas[toolName];
    if (schema) {
      return schema.parse(rawData) as ToolData;
    }
  } catch (error) {
    console.error(`[ZOD] Error validando schema para ${toolName}:`, error);
  }
  
  return (typeof rawData === 'object' && rawData !== null ? rawData : {}) as ToolData;
}
