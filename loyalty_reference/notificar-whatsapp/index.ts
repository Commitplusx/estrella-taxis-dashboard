// supabase/functions/notificar-whatsapp/index.ts
// Supabase Edge Function — Envía notificaciones WhatsApp al repartidor y al cliente
// Disparada manualmente desde la app Flutter o el cerebro AI.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extract10Digits, formatTel, generarNumeroOrden, logError, fetchWithTimeout } from '../_shared/utils.ts'
import { getMetaPuntos } from '../_shared/constants.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const WA_TOKEN = Deno.env.get('YCLOUD_API_KEY') || Deno.env.get('WHATSAPP_TOKEN')!
const WA_PHONE_ID = Deno.env.get('YCLOUD_SENDER_PHONE') || Deno.env.get('WHATSAPP_PHONE_ID')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ── VALIDACIÓN DE ENV VARS EN STARTUP ──
const validateEnv = () => {
  const missing = []
  if (!WA_TOKEN) missing.push('WHATSAPP_TOKEN')
  if (!WA_PHONE_ID) missing.push('WHATSAPP_PHONE_ID')
  if (!SUPABASE_URL) missing.push('SUPABASE_URL')
  if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (missing.length > 0) {
    throw new Error(`Missing critical environment variables: ${missing.join(', ')}`)
  }
}
validateEnv()

async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  bodyParams: string[],
  headerParams?: string[],
  langCode = 'es_MX'
): Promise<void> {
  const url = `https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`

  const components: any[] = []
  if (headerParams && headerParams.length > 0) {
    components.push({
      type: 'header',
      parameters: headerParams.map(t => ({ type: 'text', text: t || '-' }))
    })
  }
  if (bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map(t => ({ type: 'text', text: t || 'Cliente' }))
    })
  }

  const payload = {
    from: WA_PHONE_ID, to, type: 'template',
    template: { name: templateName, language: { code: langCode }, components }
  }
  console.log(`[TEMPLATE] Enviando '${templateName}' (${langCode}) a ${to} | ${JSON.stringify(components)}`)

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 15000)
  const textBody = await res.text()
  if (!res.ok) {
    console.error(`[TEMPLATE] ❌ '${templateName}' HTTP ${res.status} → ${textBody}`)
    throw new Error(`WhatsApp API error (${templateName}): ${textBody}`)
  }
  console.log(`[TEMPLATE] ✅ '${templateName}' enviada → ${textBody.substring(0, 120)}`)
}

async function sendInteractiveButton(to: string, text: string, buttonId: string, buttonTitle: string): Promise<void> {
  const url = `https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`
  console.log(`Sending Interactive Button to ${to}:`, { text, buttonId, buttonTitle })
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'X-API-Key': WA_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: WA_PHONE_ID,
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: text.substring(0, 1024) },
        action: {
          buttons: [{ type: 'reply', reply: { id: buttonId, title: buttonTitle } }]
        }
      }
    }),
  }, 15000)
  const textBody = await res.text()
  console.log(`WA Interactive API Response [${res.status}]:`, textBody)
  if (!res.ok) throw new Error(`WhatsApp Interactive API error: ${textBody}`)
}

async function logPedidoAccion(supabase: any, pedidoId: string, accion: string, detalles: string, actorId?: string) {
  try {
    const payload: any = { pedido_id: pedidoId, accion, detalles }
    if (actorId) payload.actor_id = actorId
    const { error } = await supabase.from('pedido_logs').insert(payload)
    if (error) console.error(`[LOG DB ERROR] No se pudo guardar el log en BD: ${error.message}`)
    else console.log(`[LOG DB] Guardado exitosamente: ${accion} -> ${detalles.substring(0, 50)}`)
  } catch (e: any) {
    console.error(`[LOG DB CRASH] ${e.message}`)
  }
}

async function notificarCliente(
  estado: string, tel: string, desc: string, pedidoId: string,
  nombre?: string, direccion?: string, restaurante?: string, repartidorNombre?: string, supabase?: any
): Promise<string> {
  const telFormateado = formatTel(tel)
  const nombreC = nombre || 'Cliente'
  const restC = restaurante || 'Restaurante'
  const repC = repartidorNombre || 'tu repartidor'
  const numeroOrden = generarNumeroOrden(pedidoId)

  switch (estado) {
    case 'creado': {
      const res0 = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: WA_PHONE_ID,
          to: telFormateado,
          type: 'text',
          text: { body: `⭐ *Confirmación de Pedido — Estrella Delivery*\n\n¡Hola ${nombreC}! 👋\nRecibimos exitosamente tu orden #${numeroOrden} de *${restC}*.\n\nTe avisaremos en cuanto el repartidor acepte tu servicio. 🛵💨` }
        })
      }, 15000)
      if (!res0.ok) console.error(`Error enviando text 'creado':`, await res0.text())
      return `OK: Mensaje de confirmacion 'creado' enviado al cliente`
    }
    case 'aceptado':
    case 'asignado': {
      const esMandadito = !restC || restC === 'Restaurante' || restC === '' || restC === 'Estrella'
      if (esMandadito) {
        let saludo = nombreC && nombreC !== 'Cliente Express' && nombreC !== 'Cliente' ? nombreC : '';
        saludo = saludo ? `, ${saludo}` : '';
        const msgMandadito = `🛵 *¡Tu repartidor va en camino${saludo}!* \n\n` +
          `*${repC}* aceptó tu encargo y saldrá a recogerlo en breve.\n\n` +
          `📍 Dale click al botón para rastrear su ubicación en tiempo real.`
        
        // 🛵 Tracker de Mandadito: usa TrackerPage en estrella-eats.mx/tracker?pedido=UUID
        // TrackerPage lee el query param ?pedido= con useSearchParams y hace realtime del repartidor
        const link = `https://estrella-eats.mx/tracker?pedido=${pedidoId}`;
        
        const resMand = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
          method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: WA_PHONE_ID,
            to: telFormateado,
            type: 'interactive',
            interactive: {
              type: 'cta_url',
              body: { text: msgMandadito },
              action: {
                name: 'cta_url',
                parameters: {
                  display_text: '🗺️ Ver Ubicación',
                  url: link
                }
              }
            }
          })
        }, 15000)
        
        if (!resMand.ok) console.error(`[ASIGNADO] Error interactivo mandadito: ${await resMand.text()}`)
        return `OK: Interactivo 'asignado' mandadito enviado con tracking`
      }
      const components = [
        { type: 'header', parameters: [{ type: 'image', image: { link: 'https://jdrrkpvodnqoljycixbg.supabase.co/storage/v1/object/public/public-assets/logo.png' } }] },
        { type: 'body', parameters: [
          { type: 'text', text: nombreC },
          { type: 'text', text: restC },
          { type: 'text', text: repC }
        ] }
      ]
      const res = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: WA_PHONE_ID, to: telFormateado, type: 'template', template: { name: 'pedido_aceptado_v2', language: { code: 'es_MX' }, components } })
      }, 15000)
      const t1 = await res.text()
      if (!res.ok) {
        console.error(`[TEMPLATE] ERROR 'pedido_aceptado_v2' HTTP ${res.status}. Fallback texto plano...`)
        let saludo = nombreC && nombreC !== 'Cliente Express' && nombreC !== 'Cliente' ? nombreC : '';
        saludo = saludo ? `, ${saludo}` : '';
        const msgFb = `🛵 *¡Tu pedido va en camino${saludo}!* \n\nTu repartidor *${repC}* aceptó tu pedido${restC && restC !== 'Restaurante' ? ' de *' + restC + '*' : ''} y va en camino a recogerlo.\n\n📍 Te avisamos cuando salga hacia tu domicilio.`
        const resFb = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
          method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: WA_PHONE_ID, to: telFormateado, type: 'text', text: { body: msgFb } })
        }, 15000)
        if (!resFb.ok) console.error(`[ASIGNADO] Fallback fallo: ${await resFb.text()}`)
      } else { console.log(`[TEMPLATE] OK 'pedido_aceptado_v2' enviado`) }
      return `OK: Notificacion 'asignado' enviada`
    }
    case 'recibido': {
      console.log(`[NOTIFICACION] Estado 'recibido' ignorado (el repartidor solo llegó al origen, no enviamos WA para no confundir al cliente).`)
      return `✅ Estado 'recibido' silenciado intencionalmente.`
    }
    case 'en_camino': {
      const isEnCamino = true;
      const esMandadito = !restC || restC === 'Restaurante' || restC === 'Estrella' || restC === '';
      
      let saludo = nombreC && nombreC !== 'Cliente Express' && nombreC !== 'Cliente' ? nombreC : '';
      saludo = saludo ? `, ${saludo}` : '';
      
      let msgTexto = '';
      if (esMandadito) {
        msgTexto = `🛵 *¡Tu repartidor va en camino!*\n\nTu repartidor *${repC}* ya tiene tu encargo y se dirige a tu ubicación.\n\n📍 Por favor, mantente al tanto para recibirlo. 😊`;
      } else {
        msgTexto = `🛵 *¡Tu pedido va en camino${saludo}!*\n\nTu repartidor *${repC}* ya salió de *${restC}* y se dirige a tu domicilio.\n\n📍 Por favor, mantente al tanto para recibirlo. 🍔`;
      }

      const res = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: WA_PHONE_ID, to: telFormateado, type: 'text', text: { body: msgTexto } })
      }, 15000)
      if (!res.ok) console.error(`WA error (${estado} texto plano):`, await res.text())
      return `✅ Mensaje de texto plano '${estado}' enviado (Ventana 24h)`
    }
    case 'entregado': {
      // Plantilla pedido_entregado_v2 no existe en Meta — usar texto plano como fallback
      const msgEntregado = `✅ *¡Entregado con éxito, ${nombreC}!* 🎉\n\nEsperamos que disfrutes tu pedido de *${restC}*. 🍽️\n\nGracias por confiar en Estrella Delivery. 🌟\n¿Qué tal fue nuestro servicio? ¡Nos encantaría leerte!`;
      const res = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: WA_PHONE_ID, to: telFormateado, type: 'text', text: { body: msgEntregado } })
      }, 15000)
      if (!res.ok) console.error(`WA error (entregado texto):`, await res.text())

      return `✅ Mensaje de texto plano 'entregado' enviado al cliente`
    }
    case 'punto_acumulado': {
      // Solo se llama cuando el cliente acaba de completar un ciclo y tiene envío gratis disponible
      const msgPunto = `🎉 *¡Felicidades, ${nombreC}!*\n\n⭐ Acabas de completar tu ciclo de puntos en *Estrella Delivery*.\n\n🎁 *¡Tienes un envío GRATIS disponible!*\nMuestra tu QR al repartidor en tu próximo pedido para canjearlo.\n\n¡Gracias por tu lealtad! 🌟`
      const res = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: WA_PHONE_ID, to: telFormateado, type: 'text', text: { body: msgPunto } })
      }, 15000)
      if (!res.ok) console.error(`WA error (punto_acumulado):`, await res.text())
      return `✅ Notificación 'punto_acumulado' enviada a ${tel}`
    }
    default:
      return `ℹ️ Estado '${estado}' no dispara plantilla de cliente`
  }
}

function buildRepartidorAsignacionText(
  pedidoId: string, descripcion: string, direccion: string | null, restaurante: string | null, clienteNombre: string | null, cuponTexto: string = ''
): string {
  const numeroOrden = generarNumeroOrden(pedidoId)
  return [
    `Nuevo Pedido Asignado - Estrella Delivery`,
    `Orden: ${numeroOrden}`,
    restaurante ? `Restaurante: ${restaurante}` : null,
    clienteNombre ? `👤 *Cliente:* ${clienteNombre}` : null,
    `📝 *Pedido:* ${descripcion}`,
    direccion ? `📍 *Dirección:* ${direccion}` : null,
    cuponTexto ? `\n${cuponTexto}` : null
  ].filter(Boolean).join('\n')
}

// ── Handler principal ────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  try {
    const bodyText = await req.text()
    console.log("NOTIFICAR_WHATSAPP INCOMING BODY:", bodyText)
    if (!bodyText) return new Response(JSON.stringify({ error: 'Body vacio' }), { status: 400 })

    const payload = JSON.parse(bodyText)

    // ── HANDLER DE DB WEBHOOK (Supabase Database Webhooks) ──────────────────
    // El payload de un DB Webhook tiene { type, table, record, old_record }
    // mientras que las llamadas manuales tienen { tipo, ... }
    if (payload.type && payload.table === 'pedidos' && payload.record) {
      const record = payload.record
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

      // Solo actuar en INSERT de pedidos con estado 'pendiente' (efectivo) o 'pendiente_pago' (en línea)
      // Los pagos en línea los maneja el webhook de MercadoPago cuando confirma el pago,
      // así que aquí solo procesamos efectivo para evitar doble notificación.
      if (payload.type === 'INSERT' && record.estado === 'pendiente' && record.restaurante) {
        console.log(`[DB_WEBHOOK] Nuevo pedido en efectivo detectado: ${record.id} — Restaurante: ${record.restaurante}`)
        try {
          const ticketId = (record.wb_message_id || record.id.substring(record.id.length - 5)).toUpperCase()
          const icono = record.tipo_pedido === 'tienda' ? '🏪' : '🛵'
          const etiqueta = record.tipo_pedido === 'tienda' ? 'Recoger en Tienda' : 'A Domicilio'
          const linkWeb = 'https://restaurantes-app-estrella.shop/portal'
          const mensajeRest = `🚨 *¡ATENCIÓN! NUEVO PEDIDO* 🚨\n\n` +
            `*Orden:* #${ticketId}\n` +
            `*Entrega:* ${icono} ${etiqueta}\n\n` +
            `🛒 *RESUMEN DEL PEDIDO:*\n` +
            `------------------------\n` +
            `${record.descripcion}\n` +
            `------------------------\n\n` +
            `👨‍🍳 *¡Manos a la obra!*\n` +
            `Por favor, acepta y gestiona el pedido desde tu panel:\n` +
            `👉 ${linkWeb}`

          // Buscar teléfono del restaurante en BD (Seguridad: usar ID si está disponible)
          let query = supabase.from('restaurantes').select('telefono, es_socio').eq('activo', true)
          if (record.restaurante_id) {
            query = query.eq('id', record.restaurante_id)
          } else {
            query = query.ilike('nombre', `%${record.restaurante}%`)
          }
          const { data: restData } = await query.limit(1).maybeSingle()

          if (restData && restData.es_socio === false) {
            console.log(`[DB_WEBHOOK] 🤫 Restaurante NO OFICIAL (Concierge) detectado: ${record.restaurante}. Se omitirá el envío de WhatsApp al local.`);
          } else if (restData?.telefono) {
            console.log(`[DB_WEBHOOK] Teléfono encontrado para ${record.restaurante}: ${restData.telefono}, intentando enviar mensaje...`)
            
            const payloadTemplate = {
              from: WA_PHONE_ID,
              to: formatTel(restData.telefono),
              type: 'template',
              template: {
                name: 'pedido_nuevo_restaurante',
                language: { code: 'es' },
                components: [
                  {
                    type: 'body',
                    parameters: [
                      { type: 'text', text: ticketId }, // {{1}} Orden
                      { type: 'text', text: record.metodo_pago === 'en_linea' ? 'Pagado (Tarjeta/Web)' : `Cobrar Efectivo: $${(record.total || 0) - (record.precio_entrega || 0)}` }, // {{2}} Metodo y Cobro
                      { type: 'text', text: record.descripcion ? record.descripcion.substring(0, 800) : 'Sin detalles' } // {{3}} Platillos
                    ]
                  },
                  {
                    type: 'button',
                    sub_type: 'quick_reply',
                    index: '0',
                    parameters: [
                      { type: 'payload', payload: `REST_ORDER_PREPARE_${record.id}` }
                    ]
                  },
                  {
                    type: 'button',
                    sub_type: 'quick_reply',
                    index: '1',
                    parameters: [
                      { type: 'payload', payload: `REST_ORDER_REJECT_${record.id}` }
                    ]
                  }
                ]
              }
            };

            const resRest = await fetch(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
              method: 'POST',
              headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadTemplate)
            })
            const resText = await resRest.text()
            if (!resRest.ok) {
              console.error(`[DB_WEBHOOK] ❌ Falló envío a restaurante ${record.restaurante}. HTTP ${resRest.status}: ${resText}`)
            } else {
              console.log(`[DB_WEBHOOK] ✅ EXITOSO: Notificación de WhatsApp enviada al restaurante ${record.restaurante}.`)
            }
          } else {
            console.error(`[DB_WEBHOOK] ⚠️ ATENCIÓN: El restaurante "${record.restaurante}" no tiene teléfono activo en la base de datos. No se le envió WhatsApp.`)
          }

          // También notificar al admin
          const adminPhone = Deno.env.get('ADMIN_PHONE') || (Deno.env.get('ADMIN_PHONES') ?? '').split(',')[0]?.trim()
          if (adminPhone) {
            await fetch(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
              method: 'POST',
              headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: WA_PHONE_ID, to: formatTel(adminPhone), type: 'text',
                text: { body: `🚨 *NUEVO PEDIDO WEB (#${ticketId})*\n\n🏪 Restaurante: ${record.restaurante}\n${record.tipo_pedido === 'tienda' ? '🏪 Recoger en Tienda' : '🛵 A Domicilio'}\n\n${record.descripcion}` }
              })
            }).catch(e => console.warn('[DB_WEBHOOK] Error WA admin:', e))
          }
        } catch (err: any) {
          console.error(`[DB_WEBHOOK] Error procesando nuevo pedido: ${err.message}`)
        }
      } else if (payload.type === 'UPDATE' && payload.old_record && payload.old_record.estado !== record.estado) {
        console.log(`[DB_WEBHOOK] Estado cambió de ${payload.old_record.estado} a ${record.estado}. Delegando a notificaciones...`)
        payload.tipo = record.estado
        payload.pedido_id = record.id
        // No retornamos aquí para que el flujo caiga a los handlers manuales de abajo
      } else {
        console.log(`[DB_WEBHOOK] Evento ignorado: type=${payload.type} estado=${record?.estado} — No requiere acción.`)
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }
      
      // Si fue un INSERT, ya terminó y retornamos. Si fue un UPDATE con cambio de estado, sigue abajo.
      if (payload.type === 'INSERT') {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }
    }

    // ── HANDLER DE LLAMADAS MANUALES (desde la app Flutter o funciones internas) ──
    const { tipo } = payload
    
    // EVITAR DUPLICADOS: Si es una invocación manual desde la app para un cambio de estado,
    // lo ignoramos porque el DB Webhook de Supabase (payload.type === 'UPDATE') ya lo hace automáticamente.
    if (!payload.type && ['recibido', 'en_camino', 'entregado', 'asignado'].includes(tipo)) {
      console.log(`[DE-DUPLICATOR] Ignorando invocación manual de app Flutter para el estado '${tipo}'. El DB Webhook se encargará de enviarlo.`)
      return new Response(JSON.stringify({ ok: true, message: 'Ignorado por deduplicación' }), { status: 200, headers: CORS_HEADERS })
    }

    if (!tipo) {
      return new Response(JSON.stringify({ error: 'tipo es requerido' }), { status: 400 })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    if (tipo === 'cupon_generado') {
      const { cliente_tel, cliente_nombre, codigo_cupon, descuento, expires_at, tipo_canje } = payload
      const telFormateado = formatTel(cliente_tel)
      const f_exp = new Date(expires_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
      const strDesc = tipo_canje === 'billetera' ? `$${descuento} en pedidos/comida` : `Hasta $${descuento} en tu próximo envío`

      const res = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: WA_PHONE_ID, to: telFormateado, type: 'template',
          template: {
            name: 'estrella_cupon_generado',
            language: { code: 'en' },
            components: [
              {
                type: 'header',
                parameters: [{ type: 'image', image: { link: 'https://jdrrkpvodnqoljycixbg.supabase.co/storage/v1/object/public/public-assets/logo.png' } }]
              },
              {
                type: 'body', parameters: [
                  { type: 'text', text: cliente_nombre || 'Cliente' }, // {{1}}
                  { type: 'text', text: codigo_cupon }, // {{2}}
                  { type: 'text', text: f_exp } // {{3}}
                ]
              }
            ]
          }
        })
      }, 15000)
      if (!res.ok) console.error(`WA error (estrella_cupon_generado):`, await res.text())

      const adminPhoneRaw = Deno.env.get('ADMIN_PHONE_BILLETERA') || Deno.env.get('ADMIN_PHONE') || (Deno.env.get('ADMIN_PHONES') ?? '').split(',')[0]?.trim()
      if (adminPhoneRaw && adminPhoneRaw.length > 0) {
        const adminTelFormateado = formatTel(adminPhoneRaw)
        const horaActual = new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' })
        const resAdm = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
          method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: WA_PHONE_ID, to: formatTel(adminPhoneRaw), type: 'text',
            text: { body: `🚨 *NUEVO CANJE DE BENEFICIO* 🚨\n\n👤 Cliente: ${cliente_nombre || 'Desconocido'} (${cliente_tel})\n🎯️ Cupón: *${codigo_cupon}*\n⏰ Hora: ${horaActual}\n\n📌 *Asegúrate de no cobrarle este descuento en su ticket.*` }
          })
        }, 15000)
        if (!resAdm.ok) console.error(`WA error admin cupon_generado:`, await resAdm.text())
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    if (tipo === 'bienvenida_vip') {
      const { cliente_tel, cliente_nombre } = payload
      const telFormateado = formatTel(cliente_tel)
      const resCli = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: WA_PHONE_ID, to: telFormateado, type: 'text',
          text: { body: `👑 *¡BIENVENIDO AL CLUB VIP, ${cliente_nombre || 'Cliente'}!* 👑\n\nHas completado 3 ciclos de envíos con nosotros. 🎉\n\nA partir de este momento eres *Cliente VIP* ⭐.\nPor cada envío que pidas, acumularás saldo real en pesos en tu billetera que podrás usar para pagar futuros envíos o descuentos en comida.\n\n¡Gracias por tu gran preferencia! 🌟` }
        })
      }, 15000)
      if (!resCli.ok) console.error(`WA error bienvenida_vip:`, await resCli.text())
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    if (tipo === 'notificacion_generica') {
      const { cliente_tel, mensaje } = payload
      const telFormateado = formatTel(cliente_tel)
      const resCli = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: WA_PHONE_ID, to: telFormateado, type: 'text',
          text: { body: mensaje }
        })
      }, 15000)
      if (!resCli.ok) console.error(`WA error notificacion_generica:`, await resCli.text())
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    // ── SOS / Emergencia del Repartidor ─────────────────────────────────────
    if (tipo === 'sos') {
      const { repartidor_nombre, lat, lng } = payload
      const adminPhoneRaw = Deno.env.get('ADMIN_PHONE_BILLETERA') || Deno.env.get('ADMIN_PHONE') || (Deno.env.get('ADMIN_PHONES') ?? '').split(',')[0]?.trim()

      if (!adminPhoneRaw || adminPhoneRaw.length === 0) {
        console.error('[SOS] No hay teléfono de admin configurado')
        return new Response(JSON.stringify({ error: 'Admin phone not configured' }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }

      const horaActual = new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' })
      const ubicacionTexto = (lat && lng)
        ? `📍 *Ubicación:* https://maps.google.com/?q=${lat},${lng}`
        : '📍 Ubicación no disponible'

      const mensaje = `🆘🆘🆘 *EMERGENCIA — SOS* 🆘🆘🆘\n\n` +
        `🛵 *Repartidor:* ${repartidor_nombre || 'Desconocido'}\n` +
        `⏰ *Hora:* ${horaActual}\n` +
        `${ubicacionTexto}\n\n` +
        `⚠️ El repartidor marcó una EMERGENCIA desde la app. Contáctalo de inmediato.`

      const adminTelFormateado = formatTel(adminPhoneRaw)
      const resSOS = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST',
        headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: WA_PHONE_ID,
          to: adminTelFormateado,
          type: 'text',
          text: { body: mensaje }
        })
      }, 15000)

      const sosBody = await resSOS.text()
      if (!resSOS.ok) {
        console.error(`[SOS] Error enviando WhatsApp al admin: ${sosBody}`)
        return new Response(JSON.stringify({ error: 'WA error', detail: sosBody }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }

      console.log(`[SOS] ✅ Alerta enviada al admin ${adminPhoneRaw} → ${sosBody.substring(0, 80)}`)
      return new Response(JSON.stringify({ ok: true, message: 'SOS enviado al admin' }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    // ── Repartidor no encuentra la dirección → avisa al cliente por WA ──────────
    if (tipo === 'no_encuentro_dir') {
      const { pedido_id, repartidor_nombre } = payload
      if (!pedido_id) {
        return new Response(JSON.stringify({ error: 'pedido_id es requerido' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }

      const { data: pedDir } = await supabase
        .from('pedidos')
        .select('cliente_tel, cliente_nombre, destino, direccion')
        .eq('id', pedido_id)
        .maybeSingle()

      if (!pedDir?.cliente_tel) {
        return new Response(JSON.stringify({ error: 'Pedido no encontrado' }), { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }

      const clienteTelFormateado = formatTel(pedDir.cliente_tel)
      const nombreCliente = pedDir.cliente_nombre?.split(' ')[0] || 'amigo/a'
      const repNombre = repartidor_nombre || 'Tu repartidor'

      const mensaje = `📍 *¡Hola ${nombreCliente}!*\n\n` +
        `${repNombre} de Estrella ya llegó a tu zona pero no te está encontrando. 😅\n\n` +
        `¿Nos puedes dar una *referencia* de tu ubicación o compartir tu 📍 *pin de GPS*?\n\n` +
        `_Ejemplo: "Frente a la tienda azul", "Junto al árbol grande", etc._`

      const resDir = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST',
        headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: WA_PHONE_ID,
          to: clienteTelFormateado,
          type: 'text',
          text: { body: mensaje }
        })
      }, 15000)

      if (!resDir.ok) {
        const errBody = await resDir.text()
        console.error(`[NO_ENCUENTRO] ❌ Error enviando WA al cliente: ${errBody}`)
        return new Response(JSON.stringify({ error: 'WA error', detail: errBody }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }

      // Guardar estado relay en bot_memory para interceptar la respuesta del cliente
      const clienteTel10 = pedDir.cliente_tel.replace(/\D/g, '').slice(-10)
      await supabase.from('bot_memory').upsert({
        phone: `ubicacion_relay_${clienteTel10}`,
        history: [{ pedido_id, ts: Date.now() }],
        updated_at: new Date().toISOString()
      })

      console.log(`[NO_ENCUENTRO] ✅ Aviso enviado al cliente ${pedDir.cliente_tel} para pedido ${pedido_id}`)
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    // ── Foto de evidencia del repartidor → cliente ──────────────────────────
    if (tipo === 'evidencia_foto') {
      const { pedido_id, foto_url, caption } = payload
      if (!pedido_id || !foto_url) {
        return new Response(JSON.stringify({ error: 'pedido_id y foto_url son requeridos' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }

      // Buscar datos del pedido para saber a quién enviarle
      const { data: pedEvi } = await supabase
        .from('pedidos')
        .select('cliente_tel, cliente_nombre, id')
        .eq('id', pedido_id)
        .maybeSingle()

      if (!pedEvi?.cliente_tel) {
        return new Response(JSON.stringify({ error: 'Pedido no encontrado o sin teléfono de cliente' }), { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }

      const clienteTelFormateado = formatTel(pedEvi.cliente_tel)
      const nombreCliente = pedEvi.cliente_nombre || 'Cliente'
      const captionFinal = caption || `📸 Tu repartidor de Estrella te envía una foto de evidencia del pedido.\n\n_Si tienes alguna duda, contáctanos._`

      const resEvi = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST',
        headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: WA_PHONE_ID,
          to: clienteTelFormateado,
          type: 'image',
          image: { link: foto_url, caption: captionFinal.substring(0, 1000) }
        })
      }, 15000)

      const eviBody = await resEvi.text()
      if (!resEvi.ok) {
        console.error(`[EVIDENCIA] ❌ Error enviando foto al cliente: ${eviBody}`)
        return new Response(JSON.stringify({ error: 'WA error', detail: eviBody }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }

      // Registrar en BD la foto de evidencia para auditoría
      await supabase.from('pedido_acciones').insert({
        pedido_id,
        accion: 'foto_evidencia',
        detalle: foto_url,
        created_at: new Date().toISOString()
      }).catch(() => null) // No bloquear si la tabla no existe

      console.log(`[EVIDENCIA] ✅ Foto enviada al cliente ${pedEvi.cliente_tel}`)
      return new Response(JSON.stringify({ ok: true, message: 'Foto enviada al cliente' }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    if (tipo === 'nueva_orden_admin') {
      const { restaurante, restaurante_id, descripcion, ticket_id, tipo_entrega } = payload
      const adminPhoneRaw = Deno.env.get('ADMIN_PHONE_BILLETERA') || Deno.env.get('ADMIN_PHONE') || (Deno.env.get('ADMIN_PHONES') ?? '').split(',')[0]?.trim()
      
      const icono = tipo_entrega === 'tienda' ? '🏪' : '🛵'
      const etiqueta = tipo_entrega === 'tienda' ? 'Recoger en Tienda' : 'A Domicilio'
      const mensajeAdmin = `🚨 *NUEVO PEDIDO WEB (#${ticket_id})*\n\n🏪 Restaurante: ${restaurante}\n📦 Entrega: ${etiqueta} ${icono}\n\n${descripcion}`

      // 1. Notificar al Admin
      if (adminPhoneRaw && adminPhoneRaw.length > 0) {
        const adminTelFormateado = formatTel(adminPhoneRaw)
        const resAdm = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
          method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: WA_PHONE_ID, to: adminTelFormateado, type: 'text',
            text: { body: mensajeAdmin }
          })
        }, 15000)
        if (!resAdm.ok) console.error(`WA error nueva_orden_admin (admin):`, await resAdm.text())
      }

      // 2. Notificar al Restaurante directamente (si tiene teléfono registrado y activo)
      if (restaurante || restaurante_id) {
        let query = supabase.from('restaurantes').select('telefono, es_socio').eq('activo', true)
        if (restaurante_id) {
          query = query.eq('id', restaurante_id)
        } else if (restaurante) {
          query = query.ilike('nombre', `%${restaurante}%`)
        }
        const { data: restData } = await query.limit(1).maybeSingle();

        if (restData && restData.es_socio === false) {
          console.log(`[nueva_orden_admin] 🤫 Restaurante NO OFICIAL (Concierge) detectado. Se omitirá el envío de WhatsApp al local.`);
        } else if (restData?.telefono) {
          const restTelFormateado = formatTel(restData.telefono);

          // Buscar datos faltantes del pedido para llenar la plantilla
          const { data: pData } = await supabase
            .from('pedidos')
            .select('id, metodo_pago, total')
            .eq('wb_message_id', ticket_id)
            .limit(1)
            .maybeSingle();

          const realId = pData?.id || ticket_id;
          const metodoPagoText = pData?.metodo_pago === 'en_linea' ? 'Tarjeta/Web' : (pData?.metodo_pago || 'Efectivo');
          const totalText = pData?.total ? pData.total.toString() : '0';

          const payloadTemplate = {
            from: WA_PHONE_ID,
            to: restTelFormateado,
            type: 'template',
            template: {
              name: 'pedido_nuevo_restaurante',
              language: { code: 'es_MX' },
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: ticket_id }, // {{1}} Orden
                    { type: 'text', text: pData?.metodo_pago === 'en_linea' ? 'Pagado (Tarjeta/Web)' : `Cobrar Efectivo: $${totalText}` }, // {{2}} Metodo y Cobro
                    { type: 'text', text: descripcion ? descripcion.substring(0, 800) : 'Sin detalles' } // {{3}} Platillos
                  ]
                },
                {
                  type: 'button',
                  sub_type: 'quick_reply',
                  index: '0',
                  parameters: [
                    { type: 'payload', payload: `REST_ORDER_PREPARE_${realId}` }
                  ]
                },
                {
                  type: 'button',
                  sub_type: 'quick_reply',
                  index: '1',
                  parameters: [
                    { type: 'payload', payload: `REST_ORDER_REJECT_${realId}` }
                  ]
                }
              ]
            }
          };

          const resRest = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
            method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadTemplate)
          }, 15000);
          
          if (!resRest.ok) console.error(`WA error nueva_orden_admin (restaurante):`, await resRest.text());
        }
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    if (tipo === 'preparando') {
      const { pedido_id, restaurante, tiempo_preparacion_minutos } = payload
      
      const { data: pedidoData } = await supabase
        .from('pedidos')
        .select('cliente_tel, cliente_nombre, estado')
        .eq('id', pedido_id)
        .single();
        
      if (pedidoData?.cliente_tel) {
        const telFormateado = formatTel(pedidoData.cliente_tel)
        const numeroOrden = generarNumeroOrden(pedido_id)
        const minText = tiempo_preparacion_minutos ? ` en aproximadamente *${tiempo_preparacion_minutos} minutos*` : ''
        const mensaje = `👨‍🍳 *¡Manos a la obra! (#${numeroOrden})*\n\nEl restaurante *${restaurante}* ya está preparando tu pedido y estará listo${minText}. 🍽️\n\nTe avisaremos en cuanto vaya en camino. 🛵💨`
        
        const res = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
          method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: WA_PHONE_ID, to: telFormateado, type: 'text',
            text: { body: mensaje }
          })
        }, 15000);
        
        if (!res.ok) console.error(`WA error preparando:`, await res.text());
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }
    }


    if (tipo === 'comida_lista') {
      const { pedido_id, restaurante } = payload
      
      // Obtener el teléfono del repartidor asignado y los datos del pedido
      const { data: pedidoData } = await supabase
        .from('pedidos')
        .select('repartidor_id, tipo_pedido, cliente_tel, cliente_nombre')
        .eq('id', pedido_id)
        .single();
        
      const numeroOrden = generarNumeroOrden(pedido_id);
      
      if (pedidoData?.tipo_pedido === 'tienda') {
        // Es recoger en tienda, avisarle al cliente
        if (pedidoData.cliente_tel) {
          const telFormateado = formatTel(pedidoData.cliente_tel);
          const mensajeCliente = `🛎️ *¡Tu pedido está listo, ${pedidoData.cliente_nombre}! (#${numeroOrden})*\n\nLa comida de *${restaurante}* acaba de salir de la cocina.\n\nYa puedes pasar a recogerla. ¡Que la disfrutes! 🏃‍♂️💨`;
          
          const res = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
            method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: WA_PHONE_ID, to: telFormateado, type: 'text',
              text: { body: mensajeCliente }
            })
          }, 15000);
          
          if (!res.ok) console.error(`WA error comida_lista (cliente):`, await res.text());
        }
      } else {
        // Es a domicilio, avisarle al repartidor
        let repartidorTel = null;
        if (pedidoData?.repartidor_id) {
          const { data: repData } = await supabase
            .from('repartidores')
            .select('telefono')
            .eq('user_id', pedidoData.repartidor_id)
            .single();
          repartidorTel = repData?.telefono;
        }
        
        if (repartidorTel) {
          const telFormateado = formatTel(repartidorTel)
          const mensaje = `🛎️ *¡La comida está lista! (#${numeroOrden})*\n\nEl restaurante *${restaurante || 'Asignado'}* acaba de marcar el pedido como listo para recoger.\n\nPuedes pasar directamente a la cocina por él. 🏃‍♂️💨`
          
          const res = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
            method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: WA_PHONE_ID, to: telFormateado, type: 'text',
              text: { body: mensaje }
            })
          }, 15000);
          
          if (!res.ok) console.error(`WA error comida_lista:`, await res.text());
        }
      }
      // ── Notificar también al Admin de que la comida está lista (SOLO si es a domicilio) ──
      if (pedidoData?.tipo_pedido !== 'tienda') {
        const adminPhone = Deno.env.get('ADMIN_PHONE') || (Deno.env.get('ADMIN_PHONES') ?? '').split(',')[0]?.trim();
        if (adminPhone) {
          const adminTelFormateado = formatTel(adminPhone);
          const adminMsg = `👨‍🍳 *INFO ADMIN: Pedido Listo (#${numeroOrden})*\n\nEl restaurante *${restaurante || 'No especificado'}* acaba de marcar la comida como lista para recoger.\nEl repartidor ya fue notificado.`;
          
          await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
            method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: WA_PHONE_ID, to: adminTelFormateado, type: 'text',
              text: { body: adminMsg }
            })
          }, 15000).catch(e => console.error("Error notificando al admin (comida_lista):", e));
        }
      }
      
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    if (tipo === 'canje_billetera') {
      const { cliente_tel, cliente_nombre, codigo_canje, monto, saldo_restante } = payload
      const telFormateado = formatTel(cliente_tel)
      const adminPhoneMain = Deno.env.get('ADMIN_PHONE_BILLETERA') || Deno.env.get('ADMIN_PHONE') || Deno.env.get('ADMIN_PHONES')?.split(',')[0]

      // Intentar primero con mensaje de texto libre (más amigable, funciona si hay ventana 24h)
      let resCli = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: WA_PHONE_ID, to: telFormateado, type: 'text',
          text: { body: `✅ *¡Cupón Generado!*\n\nHola ${cliente_nombre || 'Cliente'}, has canjeado saldo de tu Billetera VIP.\n\n🎯️ Código: *${codigo_canje || 'CUPON'}*\n💰 Monto: *$${monto} pesos*\n\nMuéstrale o díctale este código a tu repartidor para que aplique el descuento. ⭐️` }
        })
      }, 15000)

      if (!resCli.ok) {
        console.warn(`WA error cliente canje text, intentando fallback con plantilla...`)
        // Fallback a la plantilla oficial si falla (ej. fuera de ventana 24h)
        const fExp = 'Válido hoy'
        const strDesc = `Hasta $${monto} en pedidos/comida`
        resCli = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
          method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: WA_PHONE_ID, to: telFormateado, type: 'template',
            template: {
              name: 'estrella_cupon_generado',
              language: { code: 'en' },
              components: [
                {
                  type: 'body', parameters: [
                    { type: 'text', text: cliente_nombre || 'Cliente' }, // {{1}}
                    { type: 'text', text: codigo_canje || 'CUPON' }, // {{2}}
                    { type: 'text', text: strDesc }, // {{3}}
                    { type: 'text', text: fExp } // {{4}}
                  ]
                }
              ]
            }
          })
        }, 15000)
        if (!resCli.ok) console.error(`WA error cliente canje template fallback:`, await resCli.text())
      }

      if (adminPhoneMain && adminPhoneMain.length > 0) {
        const resAdm = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
          method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: WA_PHONE_ID, to: adminPhoneMain, type: 'text',
            text: { body: `🚨 *NUEVO CANJE DE BILLETERA*\n\n👤 Cliente: ${cliente_nombre || 'Desconocido'} (${cliente_tel})\n💰 Monto canjeado: *$${monto}*\n🎯️ Código: *${codigo_canje}*` }
          })
        }, 15000)
        const txtAdm = await resAdm.text()
        if (!resAdm.ok) console.error(`WA error admin canje:`, txtAdm)
        else console.log(`WA success admin canje:`, txtAdm)
      } else {
        console.warn('Skipping admin notification for canje_billetera: No ADMIN_PHONE set');
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    const { pedido_id, repartidor_tel, descripcion, minutos_total, minutos_estancado } = payload

    if (!pedido_id) {
      console.error("Falta pedido_id")
      return new Response(JSON.stringify({ error: 'pedido_id requerido para este tipo' }), { status: 400 })
    }

    // supabase client ya fue creado arriba
    const { data: pedido, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('id', pedido_id)
      .maybeSingle()

    if (error || !pedido) {
      console.error("Error pedido:", error)
      return new Response(JSON.stringify({ error: 'Pedido no encontrado' }), { status: 404 })
    }

    const numeroOrden = generarNumeroOrden(pedido_id)
    console.log("PEDIDO FOUND:", pedido.id, "ORDEN:", numeroOrden, "ESTADO:", pedido.estado, "TIPO_NOTIFICACION:", tipo)

    const results: string[] = []

    // ── ZOMBIE WATCHDOG (INTERVENCIÓN DEL ADMIN) ──
    if (tipo === 'alerta_zombie') {
      // 🛡️ VALIDACIÓN: Si el pedido ya fue aceptado o cancelado, ignorar la alerta zombie
      if (pedido.repartidor_id || ['asignado', 'en_camino', 'recibido', 'entregado', 'cancelado'].includes(pedido.estado)) {
        console.log(`[ZOMBIE IGNORADO] El pedido ${pedido.id} ya no es zombie. Estado actual: ${pedido.estado}`);
        return new Response(JSON.stringify({ ok: true, message: 'Pedido ya atendido' }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }

      const adminPhone = Deno.env.get('ADMIN_PHONE') || (Deno.env.get('ADMIN_PHONES') ?? '').split(',')[0]?.trim()
      if (!adminPhone) throw new Error('Missing ADMIN_PHONE en entorno')

      let repInfoTexto = '🛵 *Repartidor:* Ninguno asignado'
      if (pedido.repartidor_id) {
        const { data: rep } = await supabase.from('repartidores').select('nombre, telefono').or(`user_id.eq.${pedido.repartidor_id},id.eq.${pedido.repartidor_id}`).limit(1).maybeSingle()
        if (rep) {
          repInfoTexto = `🛵 *Repartidor:* ${rep.nombre} (wa.me/52${extract10Digits(rep.telefono)})`
        }
      }

      const clienteLink = pedido.cliente_tel ? ` (wa.me/52${extract10Digits(pedido.cliente_tel)})` : ''
      const clienteNombre = pedido.cliente_nombre || 'Cliente Anónimo'
      const restTexto = pedido.restaurante ? `🍔 *Restaurante:* ${pedido.restaurante}\n` : ''

      const msgZ = `🚨 *URGENTE: Pedido sin asignar* 🚨\n¡El pedido *${numeroOrden}* se está quedando frío! 🥶\n\n🍽️ *De:* ${pedido.restaurante || 'No especificado'}\n📦 *Lleva:* ${descripcion || pedido.descripcion}\n⏳ *Tiempo esperando:* ${minutos_estancado} min (Total: ${minutos_total}m)\n\n👤 *Cliente:* ${clienteNombre}${clienteLink}\n${repInfoTexto}\n\n🔗 *Ver en panel:* https://admin.estrella-eats.mx\n\n👇 *Acción rápida:*`

      const payloadZ = {
        from: WA_PHONE_ID,
        to: formatTel(adminPhone),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: msgZ.substring(0, 1024) },
          action: {
            buttons: [
              { type: 'reply', reply: { id: `CMD_REASIGNAR_${pedido_id}`, title: '🔄 Reasignar' } },
              { type: 'reply', reply: { id: `CMD_CANCELAR_${pedido_id}`, title: '❌ Cancelar' } }
            ]
          }
        }
      }

      const resZ = await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadZ)
      }, 15000)
      if (!resZ.ok) console.error(`Error enviando Alerta Zombie:`, await resZ.text())

      results.push(`✅ Alerta Zombie interactiva despachada al Admin: ${adminPhone}`)
      return new Response(JSON.stringify({ ok: true, actions: results }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // A. Notificar al Repartidor (Si aplica)
    const repartidorTelPayload = repartidor_tel

    if (tipo === 'asignacion' && (pedido.repartidor_id || repartidorTelPayload)) {
      let repTelefono = repartidorTelPayload
      let repNombre = 'Repartidor'

      let query = supabase.from('repartidores').select('telefono, nombre')
      
      if (pedido.repartidor_id) {
        query = query.or(`user_id.eq.${pedido.repartidor_id},id.eq.${pedido.repartidor_id}`)
      } else if (repTelefono) {
        query = query.ilike('telefono', `%${extract10Digits(repTelefono)}%`)
      }

      const { data: rep, error: repErr } = await query.limit(1).maybeSingle()
      if (repErr) console.error("Error buscando repartidor:", repErr)

      if (rep) {
        repTelefono = rep.telefono
        repNombre = rep.nombre || 'Repartidor'
      }

      // Buscar ubicación del Restaurante Origen
      let restLoc = ''
      if (pedido.restaurante) {
        const { data: rInfo } = await supabase
          .from('restaurantes')
          .select('direccion, lat, lng')
          .ilike('nombre', `%${pedido.restaurante}%`)
          .eq('activo', true)
          .limit(1)
          .maybeSingle()

        if (rInfo) {
          if (rInfo.direccion) restLoc += `\n🏠 Origen: ${rInfo.direccion}`
          if (rInfo.lat && rInfo.lng) restLoc += `\n📍 Ubicación Origen: https://maps.google.com/?q=${rInfo.lat},${rInfo.lng}`
        }
      }

      if (repTelefono) {
        let clienteFachada = ''
        if (pedido.cliente_tel) {
          const { data: cInfo } = await supabase.from('clientes').select('foto_fachada_url').eq('telefono', extract10Digits(pedido.cliente_tel)).maybeSingle()
          if (cInfo?.foto_fachada_url) {
            clienteFachada = `\n📸 Fachada: ${cInfo.foto_fachada_url}`
          }
        }

        const rawDesc = pedido.descripcion || 'Paquete'
        const descT = pedido.restaurante ? `🍽️ ${pedido.restaurante} - ${rawDesc}` : rawDesc
        const dirT = (pedido.direccion || 'Revisar detalles') + restLoc + clienteFachada

        // ── VERIFICAR CUPÓN ACTIVO ──
        let cuponInfo = ''
        let cuponBtnId = `BTN_ACEPTAR_${pedido.id}`
        let cuponBtnTitle = 'Aceptar Servicio'

        if (pedido.cliente_tel) {
          const { data: cupon } = await supabase.from('cupones')
            .select('*')
            .eq('cliente_tel', extract10Digits(pedido.cliente_tel))
            .eq('estado', 'activo')
            .limit(1)
            .maybeSingle()

          if (cupon) {
            cuponInfo = `⚠️ *CUPÓN ACTIVO: ${cupon.codigo}*\n💰 *Descuento:* $${cupon.valor_pesos} pesos\n💡 Cobra $${cupon.valor_pesos} pesos MENOS de la cuenta total.`
            // Si hay cupón, cambiamos el botón para que el repartidor confirme que lo aplicó (se maneja en rep-handler)
            // Primero debe aceptarlo normalmente, el botón de aplicar cupón se le envía cuando lo recoge o entrega.
            // Para simplificar, le mandamos el mismo botón de aceptar.
          }
        }

        const msg = buildRepartidorAsignacionText(pedido.id, descT, dirT, pedido.restaurante, pedido.cliente_nombre, cuponInfo)
        try {
          await sendInteractiveButton(formatTel(repTelefono), msg, cuponBtnId, cuponBtnTitle)
        } catch (e) { 
          console.log('El boton interactivo no pudo salir, posible ventana cerrada de 24h', e) 
        }
        results.push(`✅ WA template y/o interactivo enviado al repartidor: ${repTelefono}`)
      } else {
        results.push('⚠️ Repartidor sin teléfono o no encontrado')
      }
    }

    // B. Notificar al Cliente o al Restaurante (B2B)
    if (pedido.origen === 'b2b_moto' && pedido.restaurante && tipo !== 'asignacion') {
      const { data: rInfo } = await supabase.from('restaurantes').select('telefono').ilike('nombre', `%${pedido.restaurante}%`).eq('activo', true).limit(1).maybeSingle()
      if (rInfo?.telefono) {
        let repNom = 'un repartidor'
        if (pedido.repartidor_id) {
          const { data: r } = await supabase.from('repartidores').select('nombre').or(`user_id.eq.${pedido.repartidor_id},id.eq.${pedido.repartidor_id}`).limit(1).maybeSingle()
          if (r?.nombre) repNom = r.nombre
        }
        
        let msgB2B = ''
        if (tipo === 'recibido' || tipo === 'en_camino') {
          msgB2B = `🛵 *Actualización de Moto B2B*\n\nEl repartidor *${repNom}* acaba de recoger el pedido de *${pedido.cliente_nombre || 'Cliente'}* para *${pedido.direccion || 'destino'}* y va en camino. 💨`
        } else if (tipo === 'entregado') {
          msgB2B = `✅ *Moto B2B Completada*\n\nEl pedido para *${pedido.direccion || 'destino'}* ha sido entregado exitosamente por *${repNom}*. ¡Gracias por usar la red B2B Estrella!`
        }

        if (msgB2B) {
          await fetchWithTimeout(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
            method: 'POST', headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: WA_PHONE_ID, to: formatTel(rInfo.telefono), type: 'text', text: { body: msgB2B } })
          }, 15000)
          results.push(`✅ Notificación B2B enviada al restaurante ${pedido.restaurante}`)
        }
      } else {
        results.push(`⚠️ Restaurante B2B no encontrado o sin teléfono activo`)
      }
    } else if (tipo !== 'asignacion' && pedido.cliente_tel) {
      const tel10 = pedido.cliente_tel.replace(/\D/g, '').slice(-10)

      // REGLA ESTRICTA DE PRIVACIDAD: Solo notificar a clientes VIP (acepta_terminos = true) o a los que pidieron directamente por WhatsApp (b2c_flow)
      const { data: clInfo } = await supabase
        .from('clientes')
        .select('acepta_terminos, puntos, rango, es_vip, nombre')
        .eq('telefono', tel10)
        .maybeSingle()

      if ((!clInfo || clInfo.acepta_terminos !== true) && pedido.origen !== 'b2c_flow') {
        // En lugar de bloquear, registramos que es un cliente no VIP, pero
        // permitimos el envío de plantillas transaccionales (asignado, en_camino, etc)
        // ya que Meta permite plantillas de utilidad sin opt-in explícito en el bot (el opt-in se asume al pedir por la app).
        results.push(`⚠️ Cliente ${tel10} no tiene acepta_terminos=true, pero se enviará notificación transaccional.`)
      }
      
      if (true) { // Bypass para permitir el envío de tracking
        let repNom = 'tu repartidor'
        if (pedido.repartidor_id) {
          // Buscar por user_id O por id para cubrir repartidores sin cuenta Auth
          const { data: r } = await supabase.from('repartidores').select('nombre')
            .or(`user_id.eq.${pedido.repartidor_id},id.eq.${pedido.repartidor_id}`)
            .limit(1).maybeSingle()
          if (r?.nombre) repNom = r.nombre
        }

        const resCli = await notificarCliente(
          tipo,
          pedido.cliente_tel,
          pedido.descripcion,
          pedido.id,
          pedido.cliente_nombre ?? undefined,
          pedido.direccion ?? undefined,
          pedido.restaurante ?? undefined,
          repNom,
          supabase
        )
        results.push(resCli)

        // ── AUTO-NOTIFICAR si el cliente acaba de completar un ciclo de puntos ──
        if (tipo === 'entregado' && pedido.cliente_tel) {
          try {
            if (clInfo) {
              const meta = getMetaPuntos(clInfo.rango, clInfo.es_vip)
              // Si los puntos son múltiplo exacto de meta (ciclo completado) y tiene al menos 1 ciclo
              if (clInfo.puntos > 0 && clInfo.puntos % meta === 0) {
                await notificarCliente(
                  'punto_acumulado',
                  pedido.cliente_tel,
                  '',
                  pedido.id,
                  clInfo.nombre ?? pedido.cliente_nombre ?? undefined,
                  undefined, undefined, undefined, supabase
                )
                results.push(`🎉 Notificación de ciclo completo enviada a ${tel10}`)
              }
            }
          } catch (eP) {
            console.warn('Error en auto-notificación de ciclo:', eP)
          }
        }
      } // Fin del bloque 'else' (Si es cliente VIP)
    } else if (tipo !== 'asignacion') {
      results.push('⚠️ Cliente sin teléfono')
    }

    console.log("Final Actions:", results)
    
    // GUARDAR LOG DE NOTIFICACIÓN
    await logPedidoAccion(
      supabase, 
      pedido_id, 
      'NOTIFICACION_ENVIADA', 
      `Estado: ${tipo} | Resultados: ${results.join(' | ')}`
    )

    return new Response(JSON.stringify({ ok: true, actions: results }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })

  } catch (e: any) {
    console.error("FATAL ERROR IN NOTIFICAR-WHATSAPP:", e)
    
    // INTENTAR GUARDAR LOG DE ERROR SI ES POSIBLE
    try {
      const { pedido_id, tipo } = await req.clone().json().catch(() => ({}))
      if (pedido_id) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
        await logPedidoAccion(supabase, pedido_id, 'ERROR_NOTIFICACION', `Fallo al notificar estado ${tipo}: ${e.message}`)
      }
    } catch (_) { /* ignore */ }

    await logError(
      'notificar-whatsapp',
      `Unhandled crash: ${e.message}`,
      { stack: e.stack },
      'critical'
    );
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
