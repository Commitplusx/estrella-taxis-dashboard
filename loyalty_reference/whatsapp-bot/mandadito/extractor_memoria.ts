import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import 'https://deno.land/std@0.168.0/dotenv/load.ts'
import { callGemini } from '../../_shared/gemini.ts'

// Configuración de Supabase
let supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL') || ''
let supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('VITE_SUPABASE_ANON_KEY') || ''
let supabase = supabaseUrl ? createClient(supabaseUrl, supabaseKey) : null

// Para entornos locales que cargan env vars después de inicializar
export function getSupabase() {
  if (!supabase) {
    supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL') || ''
    supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('VITE_SUPABASE_ANON_KEY') || ''
    if (supabaseUrl) supabase = createClient(supabaseUrl, supabaseKey)
  }
  return supabase
}


interface PerfilExtraido {
  tono_preferido: string
  alergias_gustos: string[]
  resumen_memoria: string
  nuevas_ubicaciones_semanticas: Record<string, {
    lat: number
    lng: number
    nombre_oficial: string
    referencia: string
  }>
  nuevas_rutinas: Array<{ dia: string; hora: string; patron: string }>
}

/**
 * Llama a la IA para analizar el historial de chat de un cliente y extraer su perfil semántico.
 */
async function analizarHistorialIA(telefono: string, historialTexto: string): Promise<PerfilExtraido | null> {
  const prompt = `
Eres un analista de datos de comportamiento para una empresa de delivery (Estrella Delivery).
Analiza el siguiente historial de pedidos y chats del cliente ${telefono}.

Tu objetivo es extraer:
1. El tono de comunicación preferido del cliente (amigable, formal, impaciente, etc.)
2. Sus alergias o gustos específicos de comida.
3. Un resumen de su memoria (ej. "Suele pedir comida rápida los fines de semana").
4. Sus ubicaciones semánticas (aliases). Si el cliente menciona "mi casa", "mi negocio", "casa de mi abuela" y hay coordenadas o nombres oficiales asociados, extráelos.
5. Patrones de rutina (ej. "Pide pizza los viernes por la noche").

Historial:
${historialTexto}

Devuelve el resultado ESTRICTAMENTE en formato JSON:
{
  "tono_preferido": "string",
  "alergias_gustos": ["string"],
  "resumen_memoria": "string",
  "nuevas_ubicaciones_semanticas": {
    "alias (ej. 'mi casa')": {
      "lat": numero,
      "lng": numero,
      "nombre_oficial": "string",
      "referencia": "string"
    }
  },
  "nuevas_rutinas": [
    { "dia": "string", "hora": "string", "patron": "string" }
  ]
}`

  try {
    const aiKey = Deno.env.get('DEEPSEEK_API_KEY') || Deno.env.get('OPENAI_API_KEY');
    if (!aiKey) {
      console.error('[IA] Faltó DEEPSEEK_API_KEY o OPENAI_API_KEY en variables de entorno');
      return null;
    }
    
    const url = Deno.env.get('DEEPSEEK_API_KEY') ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const model = Deno.env.get('DEEPSEEK_API_KEY') ? 'deepseek-chat' : 'gpt-4o-mini';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiKey}`
      },
      body: JSON.stringify({
        model: model,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API Error: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    const content = data.choices[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as PerfilExtraido;
  } catch (error) {
    console.error(`Error analizando IA para ${telefono}:`, error);
    return null;
  }
}

/**
 * Función principal del worker que procesa un cliente.
 */
export async function procesarPerfilCliente(telefono: string, historialTexto: string) {
  console.log(`[PERFIL] Procesando cliente ${telefono}...`)
  
  const extraccion = await analizarHistorialIA(telefono, historialTexto)
  if (!extraccion) {
    console.log(`[PERFIL] Falló la extracción para ${telefono}`)
    return
  }

  // Obtener perfil actual
  const client = getSupabase()
  const { data: perfilActual } = await client!
    .from('cliente_perfiles')
    .select('*')
    .eq('cliente_telefono', telefono)
    .maybeSingle()

  // Fusionar ubicaciones
  const ubicacionesActuales = perfilActual?.ubicaciones_semanticas || {}
  const nuevasUbicaciones = { ...ubicacionesActuales, ...(extraccion.nuevas_ubicaciones_semanticas || {}) }

  // Fusionar rutinas
  const rutinasActuales = perfilActual?.rutinas || []
  const nuevasRutinas = [...rutinasActuales, ...(extraccion.nuevas_rutinas || [])]
  
  // Limpiar rutinas duplicadas (básico)
  const rutinasUnicas = nuevasRutinas.filter((v, i, a) => a.findIndex(t => (t.patron === v.patron)) === i)

  // Guardar en BD
  const { error } = await client!
    .from('cliente_perfiles')
    .upsert({
      cliente_telefono: telefono,
      tono_preferido: extraccion.tono_preferido || 'amigable',
      alergias_gustos: extraccion.alergias_gustos || [],
      resumen_memoria: extraccion.resumen_memoria || '',
      ubicaciones_semanticas: nuevasUbicaciones,
      rutinas: rutinasUnicas
    })

  if (error) {
    console.error(`[PERFIL] Error guardando en BD para ${telefono}:`, error)
  } else {
    console.log(`[PERFIL] Perfil actualizado exitosamente para ${telefono}`)
  }
}
