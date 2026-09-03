import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { procesarPedidoClaude } from './ai-claude.ts'
import { sendWA } from '../whatsapp-bot/whatsapp.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Reutilizamos la misma API Key de DeepSeek que ya usa el bot principal
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') ?? Deno.env.get('OPENAI_API_KEY') ?? ''

const sendWAMulti = async (to: string, texto: string) => {
  const partes = texto.split('|||').map(p => p.trim()).filter(Boolean)
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 600))
    await sendWA(to, partes[i])
  }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  try {
    const body = await req.json()
    const { fromPhone, from10, texto, sessionData } = body

    if (!DEEPSEEK_API_KEY) {
      await sendWA(fromPhone, `⚠️ El servicio de pedidos automáticos está en mantenimiento. Por favor contacta directo al local.`)
      return new Response('OK', { status: 200 })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // 1. Procesar con DeepSeek-V4-Pro (Mesero IA)
    const claudeRes = await procesarPedidoClaude(fromPhone, from10, texto, sessionData, DEEPSEEK_API_KEY)

    if (claudeRes.error || !claudeRes.mensaje) {
      await sendWA(fromPhone, `⚠️ Hubo un pequeño error procesando tu pedido. ¿Me repites qué deseabas?`)
      return new Response('OK', { status: 200 })
    }

    const { accion, nuevoCarrito, mensaje, nuevoHistorial } = claudeRes

    // BUG FIX: Manejar CANCELAR_PEDIDO explícitamente
    if (accion === 'CANCELAR_PEDIDO') {
      await supabase.from('bot_memory').delete().eq('phone', `order_session_${from10}`)
      await sendWAMulti(fromPhone, mensaje || '❌ Tu pedido ha sido cancelado. ¡Cuando quieras pedir de nuevo, aquí estaremos! 😊')
      return new Response('OK', { status: 200 })
    }

    // ── 🎁 APLICAR_CUPON: Validar en BD y guardar en sesión ─────────────────
    if (accion === 'APLICAR_CUPON') {
      const codigo = (claudeRes as any).codigoCupon?.toUpperCase()?.trim()
      if (!codigo) {
        await sendWAMulti(fromPhone, mensaje)
        await supabase.from('bot_memory').upsert({ phone: `order_session_${from10}`, history: [{ ...sessionData, cart: nuevoCarrito, history: nuevoHistorial, ts: Date.now() }], updated_at: new Date().toISOString() })
        return new Response('OK', { status: 200 })
      }
      const ahora = new Date().toISOString()
      const { data: cupon } = await supabase.from('cupones')
        .select('id, descuento_porcentaje, usos_maximos, usos_actuales, expira_en')
        .eq('codigo', codigo).eq('activo', true).maybeSingle()

      if (!cupon) {
        await sendWAMulti(fromPhone, `❌ El cupón *${codigo}* no es válido o ya expiró. Continúa tu pedido sin él 😊`)
      } else if (cupon.expira_en && cupon.expira_en < ahora) {
        await sendWAMulti(fromPhone, `⏰ El cupón *${codigo}* ya venció. ¡Sigue pendiente de nuestras próximas promos!`)
      } else if (cupon.usos_actuales >= cupon.usos_maximos) {
        await sendWAMulti(fromPhone, `😔 El cupón *${codigo}* ya alcanzó su límite de usos.`)
      } else {
        // BUG FIX: Do NOT increment usos_actuales here. Wait until CONFIRMAR_PEDIDO.
        const nextSession = { ...sessionData, cart: nuevoCarrito, history: nuevoHistorial, cupon: { id: cupon.id, codigo, descuento: cupon.descuento_porcentaje }, ts: Date.now() }
        await supabase.from('bot_memory').upsert({ phone: `order_session_${from10}`, history: [nextSession], updated_at: new Date().toISOString() })
        await sendWAMulti(fromPhone, `🎁 ¡Cupón *${codigo}* aplicado! Tienes *${cupon.descuento_porcentaje}% de descuento* en tu pedido 🎉|||¿Algo más o confirmamos tu orden?`)
      }
      return new Response('OK', { status: 200 })
    }

    // 2. Guardar el nuevo estado en bot_memory
    if (accion !== 'CONFIRMAR_PEDIDO') {
      const nextSession = {
        ...sessionData,
        cart: nuevoCarrito,
        history: nuevoHistorial,
        ts: Date.now()
      }
      await supabase.from('bot_memory').upsert({
        phone: `order_session_${from10}`,
        history: [nextSession],
        updated_at: new Date().toISOString()
      })
      await sendWAMulti(fromPhone, mensaje)
    } else {
      // 3. CONFIRMAR_PEDIDO: Calcular total en backend (GuardRail Financiero)
      let total = 0
      const itemsGuardados = (nuevoCarrito || []).map((item: any) => {
        // BUG FIX: Ensure price is > 0 and quantity is an integer >= 1
        const precio = Math.max(0.01, item.precioUnitario || 0)
        const qty = Math.max(1, Math.floor(item.cantidad || 1))
        const sub = qty * precio
        total += sub
        const notaStr = item.notas ? ` (${item.notas})` : ''
        return `${qty}x ${item.nombre}${notaStr} — $${sub.toFixed(2)}`
      })

      // Aplicar cupón si existe en la sesión
      const cuponSesion = sessionData.cupon
      let descuento = 0
      if (cuponSesion?.descuento) {
        descuento = Math.round(total * (Number(cuponSesion.descuento) || 0) / 100)
        total = Math.max(0, total - descuento)
        
        // BUG FIX: Increment coupon usage ONLY upon confirmation
        if (cuponSesion.id) {
          // Fire and forget (or await) the usage increment. 
          await supabase.rpc('increment_cupon_uso', { p_cupon_id: cuponSesion.id }).catch(e => console.error("Error incrementing coupon:", e))
          // Fallback to manual update if RPC doesn't exist
          const { data: cData } = await supabase.from('cupones').select('usos_actuales').eq('id', cuponSesion.id).maybeSingle()
          if (cData) {
             await supabase.from('cupones').update({ usos_actuales: cData.usos_actuales + 1 }).eq('id', cuponSesion.id)
          }
        }
      }

      const ticketText = [
        '🔔 *NUEVO PEDIDO CONFIRMADO (IA)*',
        '',
        `🏪 *Restaurante:* ${sessionData.restauranteNombre}`,
        `📱 *Cliente:* wa.me/${fromPhone}`,
        '',
        '*Detalle del pedido:*',
        ...itemsGuardados,
        '',
        cuponSesion ? `🎁 Cupón ${cuponSesion.codigo}: -$${descuento} (${cuponSesion.descuento}% dto.)` : '',
        `💰 *TOTAL: $${total}*`,
        '',
        '_Pedido tomado 100% por Inteligencia Artificial._'
      ].filter(Boolean).join('\n')

      // Notificar a TODOS los admins
      const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
      const adminPhones = ADMIN_PHONES_ENV.split(',').map((p: string) => p.trim()).filter(Boolean)
      for (const adminPhone of adminPhones) {
        await sendWA(`52${adminPhone}`, ticketText)
      }

      // Notificar al restaurante
      const { data: restDB } = await supabase.from('restaurantes').select('telefono').eq('id', sessionData.restauranteId).maybeSingle()
      if (restDB?.telefono) {
        await sendWA(`52${restDB.telefono.slice(-10)}`, ticketText)
      }

      // Persistir pedido en BD para reportes semanales
      await supabase.from('pedidos').insert({
        cliente_tel: from10,
        descripcion: itemsGuardados.join(', '),
        restaurante: sessionData.restauranteNombre,
        restaurante_id: sessionData.restauranteId || null,
        estado: 'confirmado',
        total: total,
        items: nuevoCarrito,
        origen: 'ia_waiter'
      }).catch((e: any) => console.error('[whatsapp-ventas] Error guardando pedido:', e))

      // Borrar la sesión de pedido
      await supabase.from('bot_memory').delete().eq('phone', `order_session_${from10}`)

      // Responder al cliente
      await sendWAMulti(fromPhone, `${mensaje}|||✅ *¡Pedido enviado!* Tu orden ya fue recibida en el restaurante. Pronto te contactarán para confirmar detalles. 🛵`)
    }

    return new Response('OK', { status: 200 })

  } catch (error: any) {
    console.error(`❌ [whatsapp-ventas] Error:`, error)
    return new Response('Internal Server Error', { status: 500 })
  }
})
