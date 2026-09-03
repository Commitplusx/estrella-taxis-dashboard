import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0"
import { sendWA } from "../whatsapp-bot/whatsapp.ts"

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

// ─────────────────────────────────────────────────────────────
// SEGURIDAD: Validar firma RSA de Conekta
// La llave pública se obtiene de las variables de entorno (CONEKTA_WEBHOOK_PUBLIC_KEY)
// ─────────────────────────────────────────────────────────────
async function verificarFirmaConekta(bodyText: string, signatureB64: string | null): Promise<boolean> {
  const publicKeyPem = Deno.env.get('CONEKTA_WEBHOOK_PUBLIC_KEY')

  // Si no hay llave configurada, omitir verificación (modo desarrollo)
  if (!publicKeyPem) {
    console.warn('⚠️  CONEKTA_WEBHOOK_PUBLIC_KEY no configurada — saltando verificación de firma')
    return true
  }

  if (!signatureB64) {
    console.error('❌ Webhook sin header de firma Conekta')
    return false
  }

  try {
    const pemContent = publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s+/g, '')

    const binaryDer = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0))

    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      binaryDer.buffer,
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const signatureBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0))
    const bodyBytes = new TextEncoder().encode(bodyText)

    const isValid = await crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 32 },
      cryptoKey,
      signatureBytes,
      bodyBytes
    )

    return isValid
  } catch (e) {
    console.error('❌ Error al verificar firma:', e)
    return false
  }
}

// ─────────────────────────────────────────────────────────────
// SANITIZACIÓN: Limpiar strings para prevenir inyección
// ─────────────────────────────────────────────────────────────
function sanitizar(str: unknown, maxLen = 500): string {
  if (typeof str !== 'string') return ''
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen)
}

// ─────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────
serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Solo aceptar POST
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Leer body como texto (necesario para validar firma)
    const bodyText = await req.text()

    // Verificar que el body no esté vacío
    if (!bodyText || bodyText.length > 50_000) {
      console.error(`[${requestId}] Body inválido (vacío o muy grande)`)
      return new Response('Bad Request', { status: 400 })
    }

    // ── SEGURIDAD: Validar firma RSA ──────────────────────────
    const signature = req.headers.get('x-conekta-signature')
    const firmaValida = await verificarFirmaConekta(bodyText, signature)

    if (!firmaValida) {
      console.error(`[${requestId}] Firma Conekta inválida — posible petición falsa RECHAZADA`)
      return new Response('Unauthorized', { status: 401 })
    }

    // ── PARSEO Y VALIDACIÓN ───────────────────────────────────
    let payload: any
    try {
      payload = JSON.parse(bodyText)
    } catch {
      console.error(`[${requestId}] JSON inválido en el body`)
      return new Response('Bad Request', { status: 400 })
    }

    const eventType = sanitizar(payload?.type)
    console.log(`[${requestId}] Evento Conekta recibido: ${eventType}`)

    // Solo procesar pagos confirmados
    if (eventType !== 'order.paid') {
      return new Response('Evento ignorado', { status: 200 })
    }

    const order = payload?.data?.object
    const pedidoId = sanitizar(order?.metadata?.pedido_id, 20)
    const restauranteNombre = sanitizar(order?.metadata?.restaurante || '', 200)
    const montoTotal = order?.amount ? Number(order.amount) / 100 : null

    // Validar que tengamos los datos mínimos
    if (!pedidoId) {
      console.error(`[${requestId}] order.paid sin pedido_id en metadata`)
      return new Response('OK - sin pedido_id', { status: 200 })
    }

    console.log(`[${requestId}] Procesando pago para pedido: ${pedidoId}`)

    // ── EXTRAER DATOS DE PAGO ────────────────────────────────
    const paymentMethodObj = order?.charges?.data?.[0]?.payment_method
    const brand = paymentMethodObj?.brand || paymentMethodObj?.type || 'Tarjeta'
    const last4 = paymentMethodObj?.last4 || ''
    const paymentInfoStr = last4 ? `${brand} terminada en ${last4}` : brand

    // ── IDEMPOTENCIA: Solo actualizar si sigue pendiente ─────
    const { data: pedidoData, error: updateError } = await supabase
      .from('pedidos')
      .update({ 
        estado: 'pendiente',
        estado_pago: 'pagado',
        updated_at: new Date().toISOString()
      })
      .eq('wb_message_id', pedidoId)
      .eq('estado', 'pendiente_pago')  // Guard: evitar procesamiento doble
      .select('id, cliente_nombre, restaurante, restaurante_id, descripcion, total, direccion')
      .maybeSingle()  // maybeSingle en vez de single para no lanzar error si no hay filas

    if (updateError) {
      console.error(`[${requestId}] Error BD al actualizar pedido:`, updateError)
      // Retornar 200 para que Conekta no reintente indefinidamente
      return new Response('Error interno registrado', { status: 200 })
    }

    if (!pedidoData) {
      // No hay filas = ya fue procesado antes (retry de Conekta) o pedido no existe
      console.warn(`[${requestId}] Pedido ${pedidoId} no encontrado en estado pendiente_pago — posible retry o ya procesado`)
      return new Response('Ya procesado', { status: 200 })
    }

    console.log(`[${requestId}] ✅ Pedido ${pedidoId} marcado como pendiente (pago confirmado)`)


    // BUG 2 fix: look up restaurant by ID if available, fall back to name search
    let restData: any = null
    if (pedidoData.restaurante_id) {
      const { data } = await supabase
        .from('restaurantes')
        .select('telefono')
        .eq('id', pedidoData.restaurante_id)
        .maybeSingle()
      restData = data
    }
    if (!restData && restauranteNombre) {
      const { data } = await supabase
        .from('restaurantes')
        .select('telefono')
        .ilike('nombre', `%${restauranteNombre}%`)
        .maybeSingle()
      restData = data
    }

    const restTelefono = restData?.telefono || null

    if (!restTelefono) {
      console.warn(`[${requestId}] No se encontró teléfono para restaurante: "${restauranteNombre}"`)
    } else {
      const numeroRestaurante = "52" + restTelefono.replace(/\D/g, '')
      const montoStr = montoTotal ? `$${montoTotal.toFixed(2)}` : 'N/A'
      
      let tipoEntrega = 'A domicilio'
      if (pedidoData.direccion && (pedidoData.direccion.toLowerCase().includes('tienda') || pedidoData.direccion.toLowerCase().includes('recoger'))) {
        tipoEntrega = 'Recoger en tienda'
      }

      const ticketCorto = pedidoId.split('-')[0].toUpperCase()

      const mensajeRest = [
        `Hola, tienes un nuevo pedido en linea, aqui los detalles:`,
        `orden: #${ticketCorto}`,
        `tipo de entrega: ${tipoEntrega}`,
        `pidio:\n${sanitizar(pedidoData.descripcion || 'Sin detalles.', 1000)}`,
        `total: ${montoStr}`,
        `estado: pagado (${paymentInfoStr})`
      ].join('\n')

      try {
        await sendWA(numeroRestaurante, mensajeRest)
        console.log(`[${requestId}] 📲 WhatsApp enviado al restaurante: ${numeroRestaurante}`)
        
        // Notificar al admin
        const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
        const adminPhoneRaw = ADMIN_PHONES_ENV.split(',')[0]?.replace(/\D/g, '').slice(-10)
        if (adminPhoneRaw) {
          const numeroAdmin = "52" + adminPhoneRaw
          const mensajeAdmin = `👁️ *VISTA ADMIN* | Pedido Pagado\n\n` + mensajeRest
          await sendWA(numeroAdmin, mensajeAdmin)
          console.log(`[${requestId}] 📲 Copia de WhatsApp enviada al admin: ${numeroAdmin}`)
        }
      } catch (waError) {
        // No lanzar error global si falla WA, el pago ya fue registrado
        console.error(`[${requestId}] Error al enviar WhatsApp:`, waError)
      }
    }

    return new Response('OK', { status: 200 })

  } catch (error: any) {
    console.error(`[${requestId}] Error no controlado en webhook:`, error)
    // Retornar 200 para que Conekta no reintente en errores internos
    return new Response('Error interno', { status: 200 })
  }
})
