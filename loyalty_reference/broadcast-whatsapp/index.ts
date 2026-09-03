// ══════════════════════════════════════════════════════════════════════════════
// broadcast-whatsapp/index.ts
// Edge Function para envío masivo de plantillas de WhatsApp (Meta Templates)
// ── Características ──────────────────────────────────────────────────────────
//  • Segmentación: todos | vip | etiqueta personalizada
//  • Rate limiting propio: 5 env/seg para cumplir con políticas de YCloud/Meta
//  • Logging persistente: cada broadcast queda registrado en la tabla
//    `campanas_broadcast` con resultados individuales por número
//  • Idempotente por campana_id: no reenvía si ya procesó ese ID
//  • Responde parcialmente con streaming de progreso via Supabase Realtime
//    (actualiza la fila de la campaña cada N envíos)
// ══════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Normaliza un teléfono a formato E.164 para México (sin +) */
function normalizarTel(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `521${digits}`          // local → +521XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('1'))
    return `52${digits}`                                    // 1XXXXXXXXXX → 521XXXXXXXXXX (edge)
  if (digits.length === 12 && digits.startsWith('52'))
    return `521${digits.slice(2)}`                          // 52XXXXXXXXXX → 521XXXXXXXXXX
  if (digits.length === 13 && digits.startsWith('521'))
    return digits                                            // ya correcto
  return null                                               // inválido
}

/** Espera N ms */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Envía una plantilla de WhatsApp via YCloud */
async function sendTemplate(
  apiKey: string,
  senderPhone: string,
  to: string,
  templateName: string,
  langCode: string,
  components: any[] = []
): Promise<{ ok: boolean; error?: string }> {
  try {
    const payloadTemplate: any = {
      name: templateName,
      language: { code: langCode },
    };
    if (components && components.length > 0) {
      payloadTemplate.components = components;
    }

    const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: senderPhone,
        to,
        type: 'template',
        template: payloadTemplate
      })
    })
    if (res.ok) return { ok: true }
    const err = await res.text()
    return { ok: false, error: err.substring(0, 300) }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// ── Handler principal ──────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' }

  try {
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const YCLOUD_KEY    = Deno.env.get('YCLOUD_API_KEY')!
    const SENDER_PHONE  = Deno.env.get('YCLOUD_SENDER_PHONE')!

    if (!YCLOUD_KEY || !SENDER_PHONE) {
      return new Response(JSON.stringify({ error: 'Faltan credenciales de YCloud en los secretos' }), {
        status: 500, headers: jsonHeaders
      })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
    const body = await req.json().catch(() => ({})) as any

    const {
      campana_id,       // string (UUID) — identificador único de esta campaña
      template_name,    // string — nombre exacto de la plantilla en Meta
      lang_code = 'es', // string — código de idioma (default: es)
      segmento = 'todos', // 'todos' | 'vip' | 'etiqueta' | 'prueba'
      etiqueta,          // string — solo si segmento === 'etiqueta'
      telefono_prueba,   // string - solo si segmento === 'prueba'
      components = [],   // array — componentes dinámicos para la plantilla
    } = body

    if (!campana_id || !template_name) {
      return new Response(JSON.stringify({ error: 'Se requiere campana_id y template_name' }), {
        status: 400, headers: jsonHeaders
      })
    }

    // ── Idempotencia: ¿ya procesamos esta campaña? ─────────────────────────
    const { data: existente } = await supabase
      .from('campanas_broadcast')
      .select('id, estado')
      .eq('campana_id', campana_id)
      .maybeSingle()

    if (existente?.estado === 'completada') {
      return new Response(JSON.stringify({ ok: true, msg: 'Ya procesada', campana_id }), {
        headers: jsonHeaders
      })
    }

    // ── Marcar como en progreso ────────────────────────────────────────────
    await supabase.from('campanas_broadcast').upsert({
      campana_id,
      template_name,
      lang_code,
      segmento,
      etiqueta: etiqueta ?? null,
      estado: 'procesando',
      exitos: 0,
      errores: 0,
      total: 0,
      resultados: [],
      iniciada_at: new Date().toISOString(),
    }, { onConflict: 'campana_id' })

    // ── Obtener destinatarios según segmento ───────────────────────────────
    let clientes: any[] = []
    
    if (segmento === 'prueba' && telefono_prueba) {
      clientes = [{ telefono: telefono_prueba, nombre: 'Modo Prueba' }]
    } else {
      let query = supabase.from('clientes').select('telefono, nombre, es_vip, etiquetas')
      if (segmento === 'vip') query = query.eq('es_vip', true)
      else if (segmento === 'normales') query = query.eq('es_vip', false).neq('nombre', 'Cliente Express')
      else if (segmento === 'sin_registro') query = query.eq('nombre', 'Cliente Express')
      
      const { data, error: errClientes } = await query
      if (errClientes) throw errClientes
      clientes = data || []
    }

    const total = clientes.length

    if (total === 0) {
      await supabase.from('campanas_broadcast').update({
        estado: 'completada',
        completada_at: new Date().toISOString()
      }).eq('campana_id', campana_id)
      
      return new Response(JSON.stringify({ ok: true, campana_id, total: 0, exitos: 0, errores: 0 }), { headers: jsonHeaders })
    }

    let exitos = 0
    let errores = 0
    const resultados: { tel: string; nombre: string; ok: boolean; error?: string }[] = []

    // ── Envío por lotes con rate limiting (5 msgs/s) ───────────────────────
    // YCloud recomienda no más de 50 req/s por WABA — usamos 5/s para seguridad
    const BATCH_SIZE   = 5    // mensajes por lote
    const BATCH_DELAY  = 1100 // ms entre lotes (~5/s con margen)
    const UPDATE_EVERY = 10   // actualizar BD cada N envíos

    for (let i = 0; i < total; i++) {
      const cliente = clientes[i]
      const tel = normalizarTel(cliente.telefono)

      if (!tel) {
        resultados.push({ tel: cliente.telefono, nombre: cliente.nombre || '?', ok: false, error: 'Número inválido' })
        errores++
      } else {
        const res = await sendTemplate(YCLOUD_KEY, SENDER_PHONE, tel, template_name, lang_code, components)
        resultados.push({ tel, nombre: cliente.nombre || '?', ok: res.ok, error: res.error })
        if (res.ok) exitos++
        else errores++
      }

      // Rate limiting: pausar al final de cada lote
      if ((i + 1) % BATCH_SIZE === 0) await sleep(BATCH_DELAY)

      // Actualizar progreso en BD periódicamente
      if ((i + 1) % UPDATE_EVERY === 0 || i === total - 1) {
        await supabase.from('campanas_broadcast').update({
          exitos,
          errores,
          total,
          resultados,
          estado: i === total - 1 ? 'completada' : 'procesando',
          completada_at: i === total - 1 ? new Date().toISOString() : null
        }).eq('campana_id', campana_id)
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      campana_id,
      total,
      exitos,
      errores,
    }), { headers: jsonHeaders })

  } catch (err: any) {
    console.error('[broadcast-whatsapp] Fatal error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: jsonHeaders
    })
  }
})
