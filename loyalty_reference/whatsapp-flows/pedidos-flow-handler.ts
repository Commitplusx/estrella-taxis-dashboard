/**
 * pedidos-flow-handler.ts
 * Handler dedicado para procesar pedidos que llegan vía WhatsApp Flows.
 * Se llama desde whatsapp-flows/index.ts cuando payload.accion === "NUEVO_PEDIDO_FLOW"
 *
 * Flujo:
 * 1. Extraer ítems del carrito y resolver precios reales desde menu_items en BD
 * 2. Validar y aplicar cupón si existe
 * 3. Calcular total real con precio de envío (GuardRail Financiero)
 * 4. Insertar pedido en tabla `pedidos`
 * 5. Notificar al cliente con confirmación y número de pedido
 * 6. Notificar al admin con el detalle completo
 */

import { sendWA, sendInteractiveButtons } from '../whatsapp-bot/whatsapp.ts'

const ADMIN_PHONES_ENV = () => Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''

// ── Helper: obtener el primer admin phone ─────────────────────────────────────
function getAdmin10(): string {
  return ADMIN_PHONES_ENV().split(',')[0]?.replace(/\D/g, '').slice(-10) || ''
}

// ── Helper: formatear lista de ítems para el mensaje de WhatsApp ──────────────
function formatearItems(items: ItemResuelto[]): string {
  return items.map(i => `  • ${i.nombre} x${i.cantidad} = $${(i.precio * i.cantidad).toFixed(0)}`).join('\n')
}

interface ItemResuelto {
  nombre: string
  precio: number
  cantidad: number
  itemId: string
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export async function handleNuevoPedidoFlow(
  supabase: any,
  fromPhone: string,
  payload: {
    restaurante_id: string
    restaurante_nombre: string
    items_elegidos: string[]         // Array de item IDs del flow
    notas_cocina: string
    cupon_codigo: string
    colonia_id: string
    calle_numero: string
    referencias: string
  }
): Promise<void> {
  const from10 = fromPhone.replace(/\D/g, '').slice(-10)
  const admin10 = getAdmin10()

  try {
    // ── 1. Resolver el restaurante real desde BD ──────────────────────────────
    const { data: restauranteDB, error: errRest } = await supabase
      .from('restaurantes')
      .select('id, nombre, telefono, lat, lng, activo')
      .eq('id', payload.restaurante_id)
      .eq('activo', true)
      .maybeSingle()

    if (errRest || !restauranteDB) {
      await sendWA(`52${from10}`,
        `⚠️ El restaurante seleccionado no está disponible en este momento. Intenta de nuevo más tarde o escribe al 963 153 9156 para ordenar por chat.`
      )
      return
    }

    // ── 2. Resolver precios REALES de los ítems seleccionados desde BD ────────
    // Los IDs del flow pueden ser IDs reales de menu_items o IDs de ejemplo.
    // Si son IDs reales, buscamos en BD. Si no existen, notificamos error.
    const itemIds = payload.items_elegidos.filter(Boolean)

    if (!itemIds || itemIds.length === 0) {
      await sendWA(`52${from10}`, `⚠️ No se recibieron ítems en tu pedido. Por favor inténtalo de nuevo.`)
      return
    }

    const { data: menuItemsDB } = await supabase
      .from('menu_items')
      .select('id, nombre, precio, disponible, agotado_hoy')
      .in('id', itemIds)
      .eq('restaurante_id', payload.restaurante_id)
      .eq('activo', true)

    // Construir el carrito resuelto (cantidad 1 por ítem seleccionado, ya que
    // el Flow usa checkboxes, no inputs numéricos)
    const itemsResueltos: ItemResuelto[] = []
    const itemsNoDisponibles: string[] = []

    // Mapear los IDs del flow con los ítems de la BD
    const menuMap: Record<string, any> = {}
    if (menuItemsDB) {
      for (const item of menuItemsDB) {
        menuMap[item.id] = item
      }
    }

    for (const itemId of itemIds) {
      const item = menuMap[itemId]
      if (!item) {
        // Ítem no encontrado en BD (puede ser ID de ejemplo del flow)
        console.warn(`[FlowPedido] Ítem ${itemId} no encontrado en BD — saltando`)
        continue
      }
      if (item.agotado_hoy || !item.disponible) {
        itemsNoDisponibles.push(item.nombre)
        continue
      }
      itemsResueltos.push({
        itemId: item.id,
        nombre: item.nombre,
        precio: parseFloat(item.precio),
        cantidad: 1
      })
    }

    // Si algunos ítems están agotados, informar pero continuar con los disponibles
    if (itemsNoDisponibles.length > 0) {
      await sendWA(`52${from10}`,
        `⚠️ Los siguientes productos se agotaron hoy y fueron removidos de tu pedido:\n${itemsNoDisponibles.map(n => `  • ${n}`).join('\n')}\n\n¡Pero tranquilo, seguimos con el resto! 😊`
      )
    }

    if (itemsResueltos.length === 0) {
      await sendWA(`52${from10}`,
        `😔 Todos los productos que elegiste se agotaron por hoy. Prueba mañana o elige otro restaurante.`
      )
      return
    }

    // ── 3. Resolver precio de envío por colonia ───────────────────────────────
    let precioEnvio = 35 // Precio default si no encontramos la colonia
    let coloniaNombre = 'Sin especificar'

    const { data: coloniaDB } = await supabase
      .from('colonias')
      .select('nombre, precio')
      .eq('id', payload.colonia_id)
      .maybeSingle()

    if (coloniaDB) {
      coloniaNombre = coloniaDB.nombre
      precioEnvio = coloniaDB.precio || 35
    }

    // ── 4. Calcular total de productos ────────────────────────────────────────
    let subtotalProductos = 0
    for (const item of itemsResueltos) {
      subtotalProductos += item.precio * item.cantidad
    }

    // ── 5. Aplicar cupón si existe (GuardRail Anti-Fraude) ────────────────────
    let descuentoCupon = 0
    let cuponUsadoId: string | null = null
    let cuponInfo: any = null
    const cuponCodigo = payload.cupon_codigo?.toUpperCase()?.trim()

    if (cuponCodigo) {
      const ahora = new Date().toISOString()
      const { data: cupon } = await supabase
        .from('cupones')
        .select('id, tipo, valor_pesos, usos_maximos, usos_actuales, expira_en, estado')
        .eq('codigo', cuponCodigo)
        .eq('cliente_tel', from10)
        .eq('estado', 'activo')
        .maybeSingle()

      if (!cupon) {
        await sendWA(`52${from10}`, `⚠️ El cupón *${cuponCodigo}* no es válido para tu número. Tu pedido continúa sin descuento.`)
      } else if (cupon.expira_en && cupon.expira_en < ahora) {
        await sendWA(`52${from10}`, `⏰ El cupón *${cuponCodigo}* ya venció. Tu pedido continúa sin descuento.`)
      } else if (cupon.usos_actuales >= cupon.usos_maximos) {
        await sendWA(`52${from10}`, `😔 El cupón *${cuponCodigo}* ya alcanzó su límite de usos. Tu pedido continúa sin descuento.`)
      } else {
        // Cupón válido → aplicar descuento según tipo
        cuponInfo = cupon
        cuponUsadoId = cupon.id
        if (cupon.tipo === 'envio_normal' || cupon.tipo === 'envio_vip') {
          // Descuento en envío (máximo el precio real del envío)
          descuentoCupon = Math.min(cupon.valor_pesos, precioEnvio)
        } else if (cupon.tipo === 'billetera') {
          // Descuento en productos
          descuentoCupon = Math.min(cupon.valor_pesos, subtotalProductos)
        }
      }
    }

    // ── 6. Total final ────────────────────────────────────────────────────────
    const totalFinal = Math.max(0, subtotalProductos + precioEnvio - descuentoCupon)

    // ── 7. Construir descripción del pedido (texto para `pedidos.descripcion`) ─
    const descripcionItems = itemsResueltos
      .map(i => `${i.nombre} x${i.cantidad}`)
      .join(', ')

    const descripcionCompleta = [
      descripcionItems,
      payload.notas_cocina ? `Notas: ${payload.notas_cocina}` : null,
    ].filter(Boolean).join(' | ')

    // ── 8. Insertar pedido en la BD ───────────────────────────────────────────
    const idempotencyKey = crypto.randomUUID()
    const { data: nuevoPedido, error: errInsert } = await supabase
      .from('pedidos')
      .insert({
        cliente_tel:           from10,
        restaurante:           restauranteDB.nombre,
        restaurante_id:        restauranteDB.id,
        descripcion:           descripcionCompleta,
        direccion:             `${payload.calle_numero}, Col. ${coloniaNombre}`,
        referencias_entrega:   payload.referencias || null,
        zona_entrega:          coloniaNombre,
        estado:                'pendiente',
        estado_cocina:         'pendiente',
        metodo_pago:           'efectivo',
        origen:                'whatsapp_flow',
        items:                 itemsResueltos.map(i => ({
          nombre: i.nombre,
          precio: i.precio,
          cantidad: i.cantidad,
          subtotal: i.precio * i.cantidad
        })),
        total:                 totalFinal,
        precio_entrega:        precioEnvio - descuentoCupon > 0 ? precioEnvio - descuentoCupon : 0,
        descuento_plataforma:  descuentoCupon,
        cupon_plataforma_id:   null, // Cupones de plataforma tienen tabla separada
        idempotency_key:       idempotencyKey,
      })
      .select('id')
      .single()

    if (errInsert || !nuevoPedido) {
      console.error('[FlowPedido] Error insertando pedido:', errInsert)
      await sendWA(`52${from10}`,
        `⚠️ Hubo un error al registrar tu pedido. Por favor escríbenos aquí mismo en WhatsApp y te atenderemos al instante. Disculpa el inconveniente. 🌟`
      )
      return
    }

    // ── 9. Marcar cupón como usado (SOLO después de insertar el pedido) ────────
    if (cuponUsadoId) {
      await supabase
        .from('cupones')
        .update({
          estado: 'usado',
          used_at: new Date().toISOString(),
          pedido_id: nuevoPedido.id,
          usos_actuales: (cuponInfo.usos_actuales || 0) + 1
        })
        .eq('id', cuponUsadoId)
    }

    // ── 10. Confirmación al cliente ───────────────────────────────────────────
    const pedidoShortId = nuevoPedido.id.substring(0, 8).toUpperCase()
    const lineaCupon = descuentoCupon > 0 ? `\n🏷️ Descuento cupón: -$${descuentoCupon.toFixed(0)}` : ''

    await sendWA(`52${from10}`,
      `✅ *¡Pedido #${pedidoShortId} confirmado!*\n\n` +
      `🏪 *${restauranteDB.nombre}* ya recibió tu orden y está cocinando. 🍳\n\n` +
      `📦 Tu pedido:\n${formatearItems(itemsResueltos)}\n\n` +
      `📍 Entrega en: ${payload.calle_numero}, Col. ${coloniaNombre}\n` +
      (payload.referencias ? `🔖 Refs: ${payload.referencias}\n` : '') +
      (payload.notas_cocina ? `📝 Notas: ${payload.notas_cocina}\n` : '') +
      `\n🛵 Envío: $${precioEnvio}` +
      lineaCupon +
      `\n💵 *Total a pagar en efectivo: $${totalFinal.toFixed(0)}*\n\n` +
      `⏱️ Tiempo estimado: 30 – 45 min.\nTe avisamos aquí mismo cuando el repartidor salga. ¡Gracias por pedir en Estrella Eats! 🌟`
    )

    // ── 11. Notificación detallada al Admin ────────────────────────────────────
    if (admin10) {
      await sendWA(`52${admin10}`,
      `🛒 *NUEVO PEDIDO — Estrella Eats (Flow)*\n\n` +
      `📋 ID: *#${pedidoShortId}*\n` +
      `📞 Cliente: wa.me/52${from10}\n` +
      `🏪 Restaurante: ${restauranteDB.nombre}\n\n` +
      `🍽️ Items:\n${formatearItems(itemsResueltos)}\n\n` +
      `📍 ${payload.calle_numero}, Col. ${coloniaNombre}\n` +
      (payload.referencias ? `🔖 Refs: ${payload.referencias}\n` : '') +
      (payload.notas_cocina ? `📝 Notas cocina: ${payload.notas_cocina}\n` : '') +
      `\n💰 Subtotal: $${subtotalProductos.toFixed(0)}\n` +
      `🛵 Envío: $${precioEnvio}` +
      lineaCupon +
      `\n💵 *TOTAL EFECTIVO: $${totalFinal.toFixed(0)}*\n\n` +
      `⚡ Ya está en la Torre de Control listo para asignar.`
      )
    }

    console.log(`[FlowPedido] ✅ Pedido ${nuevoPedido.id} creado | Cliente: ${from10} | Total: $${totalFinal}`)

  } catch (err: any) {
    console.error('[FlowPedido] Error inesperado:', err)
    await sendWA(`52${from10}`,
      `⚠️ Algo salió mal procesando tu pedido. Por favor escríbenos aquí mismo o escribe "Quiero pedir" para intentarlo de nuevo. ¡Disculpa! 🙏`
    ).catch(() => {})

    if (getAdmin10()) {
      await sendWA(`52${getAdmin10()}`,
        `🚨 [ERROR Flow Pedido] Cliente ${from10}: ${err?.message || 'Error desconocido'}`
      ).catch(() => {})
    }
  }
}
