import { sendWA, sendInteractiveButtons, sendWADocument, sendInteractiveButton, sendInteractiveCtaUrl } from './whatsapp.ts'
import { handleAdminInteractive } from './slash-commands-handler.ts'
import { handleRepButtons } from './rep-handler.ts'
import { handleCalificacion, handleTerminos, handleAdminCommands } from './admin-handler.ts'
import { startRestaurantOnboarding } from './restaurant-onboarding.ts'
import { iniciarFlujoMandadito, avanzarFlujoMandadito, STATE_KEY } from './mandadito/handler.ts'

export async function handleButtonEvent(
  supabase: any,
  fromPhone: string,
  from10: string,
  msg: any,
  esAdmin: boolean,
  userLabel: string,
  SUPABASE_KEY: string
): Promise<Response | null> {
  const buttonId = (
    msg.interactive?.button_reply?.id  ||
    msg.interactive?.list_reply?.id    ||
    msg.button?.payload                ||
    msg.button?.text
  ) as string | undefined

  if (!buttonId) return null

  // ── Modo Supervivencia (Menú de Fallback) ──
  if (buttonId === 'MENU_MANDADITO') {
    // Cargar contexto del cliente para que el agente tenga su cerebro desde el primer mensaje
    const { data: cDB } = await supabase.from('clientes')
      .select('nombre, puntos, es_vip, reputacion, saldo_billetera, envios_totales, rango, acepta_terminos, notas_crm')
      .eq('telefono', from10).limit(1).maybeSingle()
    const { data: cUbi } = await supabase.from('cliente_ubicaciones')
      .select('tipo, colonia_nombre, lat, lng').eq('cliente_telefono', from10).not('tipo', 'in', '(origen,destino)')
    const { data: cPerfil } = cDB ? await supabase.from('cliente_perfiles')
      .select('tono_preferido, alergias_gustos, resumen_memoria, ubicaciones_semanticas, rutinas')
      .eq('cliente_telefono', from10).maybeSingle() : { data: null }
    const fallbackCtx = cDB ? { ...cDB, ubicacionesGuardadas: cUbi || [], historialPedidos: [], perfilInteligente: cPerfil } : null
    await iniciarFlujoMandadito(supabase, fromPhone, from10, '', fallbackCtx)
    return new Response('OK', { status: 200 })
  }
  
  if (buttonId === 'MENU_COMIDA') {
    const { sendCatalogMessage } = await import('./whatsapp.ts')
    await sendCatalogMessage(fromPhone, `¡Con gusto! 🍔 Aquí tienes nuestro catálogo de restaurantes 👇`)
    return new Response('OK', { status: 200 })
  }
  
  if (buttonId === 'MENU_SOPORTE') {
    const ADMIN_PHONE = Deno.env.get('ADMIN_PHONE') ?? ''
    const adminNum = ADMIN_PHONE.replace(/\D/g, '').slice(-10)
    if (adminNum) {
      await sendWA(`52${adminNum}`, `🆘 *SOPORTE REQUERIDO*\nEl cliente wa.me/${fromPhone} necesita ayuda humana urgente.`)
    }
    await sendWA(fromPhone, `👨‍💻 Un agente humano ha sido notificado y se conectará contigo en breve.`)
    return new Response('OK', { status: 200 })
  }

  // ── Agente IA: Selección de dirección guardada (lista interactiva) ──────
  // Cuando el agente muestra la lista y el cliente selecciona una dirección,
  // construimos un mensaje sintético y lo enviamos de vuelta al agente.
  if (buttonId.startsWith('AGENT_DIR_')) {
    // Formato: AGENT_DIR_ORIGEN_casa  |  AGENT_DIR_DESTINO_trabajo  |  AGENT_DIR_ORIGEN_ESCRIBIR
    const parts = buttonId.split('_') // ['AGENT', 'DIR', 'ORIGEN', 'casa']
    const paso = parts[2] // 'ORIGEN' o 'DESTINO'
    const tipo = parts.slice(3).join('_') // 'casa', 'trabajo', 'mi_local', etc.

    // Recuperar historial del agente
    const { data: agenteRow } = await supabase
      .from('bot_memory').select('history').eq('phone', `mandadito_agent_${from10}`).maybeSingle()
    const historial = agenteRow?.history || []

    let textoSimulado: string

    if (tipo === 'ESCRIBIR') {
      // El cliente eligió escribir su dirección manualmente
      textoSimulado = `Prefiero escribir la dirección de ${paso === 'ORIGEN' ? 'recogida' : 'entrega'}.`
    } else {
      // Buscar lat/lng de esa dirección guardada
      const { data: loc } = await supabase
        .from('cliente_ubicaciones')
        .select('tipo, colonia_nombre, lat, lng')
        .eq('cliente_telefono', from10)
        .eq('tipo', tipo)
        .maybeSingle()

      if (!loc) {
        await sendWA(fromPhone, `No encontré esa dirección guardada. ¿Puedes escribirla? 📝`)
        return new Response('OK', { status: 200 })
      }

      // Mensaje sintético que el agente entiende perfectamente
      textoSimulado = `[DIRECCIÓN SELECCIONADA PARA ${paso}: ${loc.colonia_nombre} (Lat: ${loc.lat}, Lng: ${loc.lng})]`
    }

    // Recuperar clienteCtx para mantener el cerebro IA activo
    const { data: clienteDB } = await supabase.from('clientes')
      .select('nombre, puntos, es_vip, reputacion, saldo_billetera, envios_totales, rango, acepta_terminos, notas_crm')
      .eq('telefono', from10).limit(1).maybeSingle()
    const { data: ubiData } = await supabase.from('cliente_ubicaciones')
      .select('tipo, colonia_nombre, lat, lng').eq('cliente_telefono', from10).not('tipo', 'in', '(origen,destino)')
    const { data: perfilData } = clienteDB ? await supabase.from('cliente_perfiles')
      .select('tono_preferido, alergias_gustos, resumen_memoria, ubicaciones_semanticas, rutinas')
      .eq('cliente_telefono', from10).maybeSingle() : { data: null }
    const clienteCtx = clienteDB
      ? { ...clienteDB, ubicacionesGuardadas: ubiData || [], historialPedidos: [], perfilInteligente: perfilData }
      : null

    // Correr el agente con la respuesta del cliente
    const { runMandaditoAgent } = await import('./mandadito/agent.ts')
    const result = await runMandaditoAgent(supabase, historial, textoSimulado, fromPhone, null, clienteCtx)

    // Guardar nuevo historial
    await supabase.from('bot_memory').upsert({
      phone: `mandadito_agent_${from10}`,
      history: result.newHistory,
      updated_at: new Date().toISOString()
    })

    if (result.action === 'FINALIZAR_COTIZACION') {
      const { cotizar_mandadito } = await import('./mandadito/handler.ts')
      await cotizar_mandadito(supabase, fromPhone, from10, result.data)
      await supabase.from('bot_memory').delete().eq('phone', `mandadito_agent_${from10}`)
    } else if (result.textResponse) {
      await sendWA(fromPhone, result.textResponse)
    }
    // Si result.pendingStep está definido y no hay textResponse, el agente ya mandó
    // una lista interactiva directamente (mostrar_direcciones_guardadas). No hay que enviar nada más.

    return new Response('OK', { status: 200 })
  }

  // ── Cliente: Aceptar Tracking de Pedido ──
  if (buttonId.toLowerCase() === 'aceptar' || buttonId === 'VER_TRACKER') {
    // Buscar el pedido más reciente activo de este cliente
    const { data: p } = await supabase
      .from('pedidos')
      .select('id, wb_message_id')
      .eq('cliente_tel', from10) // También puedes buscar por cliente_id si lo tienes
      .in('estado', ['asignado', 'en_camino', 'preparando', 'en_cocina', 'llegada_restaurante'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (p) {
      const orderId = p.wb_message_id || p.id;
      await sendInteractiveCtaUrl(
        fromPhone,
        `¡Excelente! 📍 Puedes ver la ruta de tu repartidor en tiempo real aquí 👇`,
        `Rastrear Pedido`,
        `https://estrella-eats.mx/tracker?pedido=${p.id}`
      );
      return new Response('OK', { status: 200 })
    }
  }

  // ── Admin: Control Remoto de Pausa (Watchdogs) ──
  if (esAdmin && buttonId.startsWith('ADMIN_PAUSAR_')) {
    const cTel = buttonId.replace('ADMIN_PAUSAR_', '')
    await supabase.from('bot_memory').upsert({
      phone: `bot_pausa_${cTel}`,
      history: [{ pausado_por: fromPhone, desde: new Date().toISOString() }],
      updated_at: new Date().toISOString()
    })
    await sendWA(fromPhone, `✅ *Bot PAUSADO* para \`${cTel}\`.\n\nEl bot ya no responderá a este cliente. Cuando termines de hablar con él, usa el botón de Reactivar o el comando \`/bot ${cTel}\`.`)
    return new Response('OK', { status: 200 })
  }

  if (esAdmin && buttonId.startsWith('ADMIN_REACTIVAR_')) {
    const cTel = buttonId.replace('ADMIN_REACTIVAR_', '')
    await supabase.from('bot_memory').delete().eq('phone', `bot_pausa_${cTel}`)
    await sendWA(fromPhone, `✅ *Bot REACTIVADO* para \`${cTel}\`.\n\nEl bot vuelve a tener el control de la conversación.`)
    return new Response('OK', { status: 200 })
  }

  // ── Admin / Repartidor interactive actions (ACT_) ──
  if ((esAdmin || userLabel === 'repartidor') && buttonId.startsWith('ACT_')) {
    const res = await handleAdminInteractive(supabase, fromPhone, from10, buttonId)
    if (res) return res
  }

  // ── Repartidor: menú interactivo y calificaciones ──
  if (userLabel === 'repartidor' && (buttonId.startsWith('REP_CMD_') || buttonId.startsWith('REP_SCORE_'))) {
    if (buttonId.startsWith('REP_SCORE_')) {
      // REP_SCORE_excelente_9631234567 → ejecutar directo
      const { data: repRow } = await supabase.from('repartidores').select('id, nombre, alias').eq('telefono', from10).maybeSingle()
      const repData = repRow ?? { nombre: 'Repartidor' }
      const parts = buttonId.replace('REP_SCORE_', '').split('_') // ['excelente', '9631234567']
      const rep = parts[0]
      const tel = parts[1]
      const { data: c } = await supabase.from('clientes').select('id, nombre').eq('telefono', tel).maybeSingle()
      if (!c) { await sendWA(fromPhone, `❌ No encontré al cliente.`); return new Response('OK', { status: 200 }) }
      const repIcon: Record<string, string> = { excelente: '🌟', bueno: '👍', regular: '⚠️', malo: '❌' }
      await supabase.from('clientes').update({ reputacion: rep }).eq('id', c.id)
      await sendWA(fromPhone, `${repIcon[rep] || '✅'} Calificación guardada: *${c.nombre}* → *${rep}*`)
    } else {
      // BUG-B1 fix: always fetch repData so handleRepButtons never receives undefined.
      // Without it, repData?.nombre would be undefined causing broken log entries.
      const { data: repRow } = await supabase.from('repartidores').select('id, nombre, alias').eq('telefono', from10).maybeSingle()
      const repData = repRow ?? { id: '', nombre: 'Repartidor', alias: '' }
      await handleRepButtons(supabase, fromPhone, buttonId, repData)
    }
    return new Response('OK', { status: 200 })
  }

  // ── Repartidor: Aceptar pedido de domicilio (broadcast) ──
  if (userLabel === 'repartidor' && buttonId.startsWith('REP_ACCEPT_')) {
    const ticketId = buttonId.replace('REP_ACCEPT_', '')

    // Obtener datos del repartidor
    const { data: repRow } = await supabase
      .from('repartidores')
      .select('id, nombre, telefono')
      .eq('telefono', from10)
      .maybeSingle()

    if (!repRow) {
      await sendWA(fromPhone, `❌ No te encontré como repartidor registrado.`)
      return new Response('OK', { status: 200 })
    }

    // UPDATE ATÓMICO — solo se aplica si el pedido aún no tiene repartidor asignado.
    // Si dos repartidores presionan al mismo tiempo, PostgreSQL garantiza que solo
    // una transacción modifica la fila (la primera que llega).
    const { data: pedidoAsignado, error: assignError } = await supabase
      .from('pedidos')
      .update({
        repartidor_id: repRow.id,
        estado: 'asignado'
      })
      .eq('wb_message_id', ticketId)
      .neq('estado', 'cancelado')          // Bloquear si fue cancelado
      .neq('estado', 'entregado')          // Bloquear si ya fue entregado
      .is('repartidor_id', null)           // Solo si no tiene repartidor
      .select('*')
      .maybeSingle()

    if (assignError) {
      console.error('[REP_ACCEPT] Error asignando:', assignError)
      await sendWA(fromPhone, `⚠️ Error interno al aceptar. Intenta de nuevo.`)
      return new Response('OK', { status: 200 })
    }

    if (!pedidoAsignado) {
      // Alguien más llegó primero — respuesta amigable
      await sendWA(fromPhone,
        `😅 *¡Llegaste tarde!*\n\nOtro repartidor aceptó el pedido #${ticketId} antes que tú.\n\n¡Ánimo, el siguiente es tuyo! 🛵`
      )
      return new Response('OK', { status: 200 })
    }

    // ¡Ganó! Armar confirmación detallada para el repartidor
    const mapsLink = (pedidoAsignado.lat && pedidoAsignado.lng)
      ? `\n📍 *Mapa:* https://maps.google.com/?q=${pedidoAsignado.lat},${pedidoAsignado.lng}`
      : ''
    const refStr = pedidoAsignado.referencias_entrega
      ? `\n📝 *Referencias:* ${pedidoAsignado.referencias_entrega}`
      : ''
    const pagoLabel = pedidoAsignado.metodo_pago === 'efectivo'
      ? '💵 *Pago:* Cobrar en efectivo al cliente'
      : '✅ *Pago:* Ya pagado en línea (no cobres)'

    let msg = `🎉 *¡Pedido #${ticketId} asignado a ti!*\n\n`
    msg += `🍽️ *Restaurante:* ${pedidoAsignado.restaurante || 'Ver detalles'}\n`
    msg += `👤 *Cliente:* ${pedidoAsignado.cliente_nombre || 'Sin nombre'}\n`
    if (pedidoAsignado.cliente_tel) {
      const tel10 = pedidoAsignado.cliente_tel.replace(/\D/g, '').slice(-10)
      msg += `📞 *Teléfono cliente:* wa.me/52${tel10}\n`
    }
    msg += `🛵 *Entregar en:* ${pedidoAsignado.direccion || 'Ver referencias'}${refStr}${mapsLink}\n\n`
    msg += `💰 *Total:* $${Number(pedidoAsignado.total || 0).toFixed(2)}\n`
    msg += `${pagoLabel}\n\n`
    msg += `¡Mucho éxito! 🚀`

    await sendWA(fromPhone, msg)

    // Notificar al admin que fue asignado
    const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
    const adminMain10 = ADMIN_PHONES_ENV.split(',').map((s: string) => s.replace(/\D/g, '').slice(-10)).filter((s: string) => s.length === 10)[0]
    if (adminMain10) {
      await sendWA(`52${adminMain10}`,
        `🛵 *Pedido #${ticketId} asignado*\n\n✅ Aceptado por: *${repRow.nombre}*\n🍽️ ${pedidoAsignado.restaurante || ''}\n📍 ${pedidoAsignado.direccion || ''}`
      )
    }

    return new Response('OK', { status: 200 })
  }


  // ── Admin: Estadísticas interactive actions (EST_VER_) ──
  if (esAdmin && buttonId.startsWith('EST_VER_')) {
    const { handleAdminMessage } = await import('./admin-handler.ts')
    if (buttonId === 'EST_VER_VIPS') await handleAdminMessage(supabase, fromPhone, 'VER_VIPS', null)
    else if (buttonId === 'EST_VER_REST') await handleAdminMessage(supabase, fromPhone, 'VER_RESTAURANTES', null)
    else if (buttonId === 'EST_VER_REPS') await handleAdminMessage(supabase, fromPhone, 'VER_REPARTIDORES', null)
    return new Response('OK', { status: 200 })
  }

  // ── Admin: Menú Interactivo Modo Lluvia (cmd_lluvia_) ──
  if (esAdmin && buttonId.startsWith('cmd_lluvia_')) {
    const recargoText = buttonId.replace('cmd_lluvia_', '')
    const recargo = parseInt(recargoText, 10)

    // BUG-C2 fix: validate parseInt result before writing to DB.
    // A malformed buttonId (e.g. cmd_lluvia_abc) would store NaN, causing
    // every mandadito quote to return '$NaN' to the client.
    if (isNaN(recargo) || recargo < 0) {
      await sendWA(fromPhone, '⚠️ Valor de recargo inválido. No se guardó ningún cambio.')
      return new Response('OK', { status: 200 })
    }

    const { data: config } = await supabase.from('app_config').select('configuracion_precios').eq('id', 'default').single()
    const currentConfig = config?.configuracion_precios || {}

    if (recargo === 0) {
      currentConfig.modo_lluvia = false
      currentConfig.recargo_lluvia = 15
      await supabase.from('app_config').update({ configuracion_precios: currentConfig }).eq('id', 'default')
      await sendWA(fromPhone, '✅ *Modo Lluvia desactivado.*\nLos mandaditos vuelven a su precio normal.')
    } else {
      currentConfig.modo_lluvia = true
      currentConfig.recargo_lluvia = recargo
      await supabase.from('app_config').update({ configuracion_precios: currentConfig }).eq('id', 'default')
      await sendWA(fromPhone, `✅ *Modo Lluvia activado.*\nSe cobrarán *$${recargo} extra* en todos los mandaditos.`)
    }
    return new Response('OK', { status: 200 })
  }

  // ── CONFIRMACIÓN DE PEDIDO ESTRELLA EATS (B2C) ──
  if (buttonId === 'CONFIRM_EATS_EFECTIVO' || buttonId === 'CONFIRM_EATS_TRANSF' || buttonId === 'CANCELAR_EATS') {
    const { data } = await supabase.from('bot_memory').select('history').eq('phone', `estrella_eats_draft_${from10}`).maybeSingle();
    const draft = data?.history?.[0];

    if (!draft) {
      await sendWA(fromPhone, `❌ Tu sesión expiró o el pedido ya fue procesado. Inicia de nuevo por favor.`);
      return new Response('OK', { status: 200 });
    }

    if (buttonId === 'CANCELAR_EATS') {
      await supabase.from('bot_memory').delete().eq('phone', `estrella_eats_draft_${from10}`);
      await sendWA(fromPhone, `✅ Tu orden ha sido cancelada exitosamente.`);
      return new Response('OK', { status: 200 });
    }

    const metodoPago = buttonId === 'CONFIRM_EATS_EFECTIVO' ? 'efectivo' : 'transferencia';
    
    // Obtener información del cliente
    const { data: cliente } = await supabase.from('clientes').select('nombre').eq('telefono', from10).maybeSingle();
    const clienteNombre = cliente?.nombre || 'Cliente Express';

    // Obtener coordenadas reales del restaurante para el origen
    const { data: restData } = await supabase.from('restaurantes').select('lat, lng').eq('id', draft.restaurante_id).maybeSingle();

    const estadoInicial = metodoPago === 'transferencia' ? 'pendiente_pago' : 'pendiente';
    const wbMessageId = 'b2c_' + Date.now();

    // Insertar en tabla pedidos
    const { error: errPedido, data: pedidoData } = await supabase.from('pedidos').insert({
      wb_message_id: wbMessageId,
      cliente_tel: from10,
      cliente_nombre: clienteNombre,
      restaurante: draft.restaurante_nombre,
      restaurante_id: draft.restaurante_id,
      descripcion: draft.resumen_pedido,
      direccion: draft.colonia || 'GPS',
      lat: restData?.lat || draft.lat,
      lng: restData?.lng || draft.lng,
      lat_entrega: draft.lat,
      lng_entrega: draft.lng,
      total: draft.gran_total,
      precio_entrega: draft.costo_envio,
      metodo_pago: metodoPago === 'transferencia' ? 'en_linea' : 'efectivo',
      estado: estadoInicial,
      origen: 'b2c_flow',
      tipo_pedido: 'domicilio'
    }).select('wb_message_id').single();

    if (errPedido || !pedidoData) {
      console.error('Error insertando pedido B2C:', errPedido);
      await sendWA(fromPhone, `❌ Ocurrió un error al registrar tu orden. Intenta de nuevo.`);
      return new Response('OK', { status: 200 });
    }

    await supabase.from('bot_memory').delete().eq('phone', `estrella_eats_draft_${from10}`);

    const origenTag = draft.origen === 'catalogo_nativo' ? '📲 Catálogo WA' : '📋 Flow';
    
    if (metodoPago === 'efectivo') {
      await sendWA(fromPhone,
        `🎉 *¡Orden Confirmada!*\n\n` +
        `Tu pedido en *${draft.restaurante_nombre}* está siendo procesado.\n\n` +
        `🛵 Total a pagar: *$${draft.gran_total.toFixed(2)}*\n` +
        `💳 Método: 💵 Efectivo (prepara tu cambio)\n\n` +
        `Te avisaremos en cuanto el repartidor vaya en camino. ¡Gracias por usar Estrella Delivery! 🌟`
      );
    } else {
      // Generar link de Mercado Pago
      try {
        const mpRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/mercadopago-checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pedidoId: pedidoData.wb_message_id,
            items: [{ item: { nombre: `Pedido en ${draft.restaurante_nombre}`, precio: draft.subtotal }, cantidad: 1 }],
            costo_envio: draft.costo_envio,
            descuento: 0,
            total: draft.gran_total,
            originUrl: 'https://restaurantes-app-estrella.shop'
          })
        });
        const mpData = await mpRes.json();
        
        await sendWA(fromPhone,
          `💳 *¡Pago en Línea!*\n\n` +
          `Para confirmar tu orden de *$${draft.gran_total.toFixed(2)}* por favor realiza el pago en el siguiente enlace.\n\n` +
          `Puedes pagar con Tarjeta, Mercado Pago o Transferencia SPEI:\n` +
          `👉 ${mpData.url || mpData.sandbox_url}\n\n` +
          `_En cuanto detectemos el pago, tu orden comenzará a prepararse automáticamente._`
        );
      } catch (e) {
        console.error('Error generando link MP:', e);
        await sendWA(fromPhone, `💳 Elegiste transferencia, pero hubo un error generando el link automático. Por favor transfiere a la cuenta habitual o pide apoyo aquí mismo.`);
      }
    }

    if (metodoPago === 'efectivo') {
      const adminMsg =
        `🚨 *NUEVO PEDIDO B2C (${origenTag})* 🚨\n\n` +
        `👤 Cliente: ${clienteNombre} (${from10})\n` +
        `🏪 Rest: ${draft.restaurante_nombre}\n` +
        `📍 Destino: ${draft.colonia || 'GPS'}\n` +
        `💰 Total: $${draft.gran_total.toFixed(2)} (${metodoPago})\n\n` +
        `👉 Revisa el portal de admin para procesarlo.`;

      // Notificar a todos los admins
      const ADMIN_PHONES_STR = Deno.env.get('ADMIN_PHONES') || Deno.env.get('ADMIN_PHONE') || '';
      for (const adminP of ADMIN_PHONES_STR.split(',').map((p: string) => p.replace(/\D/g, '').slice(-10)).filter(Boolean)) {
        sendWA(`52${adminP}`, adminMsg).catch(() => {});
      }

      // Notificar al restaurante si tiene teléfono guardado en el draft
      if (draft.restaurante_tel) {
        const tel10Rest = String(draft.restaurante_tel).replace(/\D/g, '').slice(-10);
        sendWA(`52${tel10Rest}`,
          `🛒 *¡NUEVO PEDIDO ENTRANTE!*\n\n` +
          `👤 Cliente: ${clienteNombre} (wa.me/52${from10})\n` +
          `📋 Pedido:\n${draft.resumen_pedido}\n` +
          `${draft.notas || ''}\n` +
          `💰 Total: *$${draft.gran_total.toFixed(2)}* (${metodoPago})\n` +
          `📍 Destino: ${draft.colonia || 'GPS'}\n\n` +
          `Un repartidor de Estrella Delivery pasará pronto a recogerlo. 🛵`
        ).catch(() => {});
      }
    }

    return new Response('OK', { status: 200 });
  }


  // 🧑‍🍳 Restaurante: Empezar a Preparar (Paso 1: Pedir Tiempo) 🧑‍🍳
  if (buttonId.startsWith('REST_ORDER_PREPARE_')) {
    const ticket_id = buttonId.replace('REST_ORDER_PREPARE_', '');
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(ticket_id);
    const { data: p, error } = await supabase.from('pedidos').select('id, restaurante, descripcion').eq(isUUID ? 'id' : 'wb_message_id', ticket_id).maybeSingle();
    
    if (error) console.error("Error buscando pedido:", error);
    
    if (p) {
      await sendInteractiveButtons(
        fromPhone,
        `¡Perfecto! ¿En cuánto tiempo estará listo el pedido para que llegue el repartidor? ⏱️`,
        [
          { id: `REST_TIME_15_${ticket_id}`, title: '15 minutos' },
          { id: `REST_TIME_30_${ticket_id}`, title: '30 minutos' },
          { id: `REST_TIME_45_${ticket_id}`, title: '45 minutos' }
        ]
      );
    } else {
      await sendWA(fromPhone, `❌ Lo siento, no encontré el pedido #${ticket_id}.`);
    }
    return new Response('OK', { status: 200 });
  }

  // 🧑‍🍳 Restaurante: Confirmar Tiempo y Preparar (Paso 2) 🧑‍🍳
  if (buttonId.startsWith('REST_TIME_')) {
    const timeMatch = buttonId.match(/REST_TIME_(\d+)_/);
    if (!timeMatch) return new Response('OK', { status: 200 });
    
    const minutes = parseInt(timeMatch[1], 10);
    const ticket_id = buttonId.replace(`REST_TIME_${minutes}_`, '');
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(ticket_id);
    const { data: p, error } = await supabase.from('pedidos').select('id, restaurante, descripcion').eq(isUUID ? 'id' : 'wb_message_id', ticket_id).maybeSingle();
    
    if (error) console.error("Error buscando pedido (tiempo):", error);
    
    if (p) {
      // 1. Actualizar estado a 'buscando_repartidor', asignar tiempo y 'en_cocina'
      const { error: updError } = await supabase.from('pedidos').update({ 
        estado_cocina: 'en_cocina',
        estado: 'buscando_repartidor',
        tiempo_preparacion_minutos: minutes
      }).eq('id', p.id);
      
      if (updError) console.error("Error al actualizar estado a buscando_repartidor:", updError);
      
      // 2. Notificar al cliente que ya se está preparando
      const edgeUrl = supabase.functionsUrl ? `${supabase.functionsUrl}/notificar-whatsapp` : Deno.env.get('SUPABASE_URL') + '/functions/v1/notificar-whatsapp';
      await fetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ tipo: 'preparando', pedido_id: p.id, restaurante: p.restaurante, tiempo_preparacion_minutos: minutes })
      }).catch(e => console.error("Error trigger preparando from WA:", e));

      // 3. El Trigger de BD 'Asignar Repartidor' detecta automáticamente el cambio de
      //    estado a 'buscando_repartidor' del paso 1 y dispara asignar-repartidor.
      //    NO llamar manualmente aquí — causaría un doble disparo y race conditions
      //    que bloquean al repartidor ganador durante 10-30s. (Eliminado jul 2026)

      // Primer burbuja: Mensaje con detalles y botón URL para abrir el monitor
      await sendInteractiveCtaUrl(
        fromPhone,
        `¡Excelente! 👨‍🍳 Ya le avisamos al cliente y estamos buscando repartidor (T. Est: ${minutes} min).\n\nAquí tienes el resumen:\n📝 *Lo que pidieron:*\n${p.descripcion || 'Sin detalles'}\n\n👇 _Toca abajo para abrirlo en tu pantalla:_`,
        'Ver pedido',
        'https://restaurantes-app-estrella.shop/portal'
      );
      
      // Segunda burbuja: Botón de respuesta rápida "Pedido Listo"
      await sendInteractiveButton(
        fromPhone,
        `Cuando tengas la comida empacada y lista, presiona este botón para mandar al repartidor 🛵💨`,
        `REST_ORDER_READY_${ticket_id}`,
        '¡Ya está listo!'
      );
    } else {
      await sendWA(fromPhone, `❌ Lo siento, no encontré el pedido #${ticket_id}.`);
    }
    return new Response('OK', { status: 200 });
  }

  // ── Restaurante: Pedido Listo (REST_ORDER_READY_) ──
  if (buttonId.startsWith('REST_ORDER_READY_')) {
    const ticket_id = buttonId.replace('REST_ORDER_READY_', '');
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(ticket_id);
    const { data: p, error } = await supabase.from('pedidos').select('id, restaurante').eq(isUUID ? 'id' : 'wb_message_id', ticket_id).maybeSingle();
    
    if (error) console.error("Error buscando pedido:", error);
    
    if (p) {
      // 1. Actualizar estado_cocina a 'listo'
      await supabase.from('pedidos').update({ estado_cocina: 'listo' }).eq('id', p.id);
      
      // 2. Notificar mediante notificar-whatsapp con tipo 'comida_lista'
      const edgeUrl = supabase.functionsUrl ? `${supabase.functionsUrl}/notificar-whatsapp` : Deno.env.get('SUPABASE_URL') + '/functions/v1/notificar-whatsapp';
      await fetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ tipo: 'comida_lista', pedido_id: p.id, restaurante: p.restaurante })
      }).catch(e => console.error("Error trigger comida_lista from WA:", e));

      await sendWA(fromPhone, `🛎️ *¡Excelente!*\nSe ha notificado que el pedido está listo para recoger.`);
    } else {
      await sendWA(fromPhone, `⚠️ Lo siento, no encontré el pedido #${ticket_id}.`);
    }
    return new Response('OK', { status: 200 });
  }

  // ── Botones del Menú Principal del Cliente ──
  if (buttonId === 'MENU_PEDIR_SERVICIO') {
    await iniciarFlujoMandadito(supabase, fromPhone, from10)
    return new Response('OK', { status: 200 })
  }

  if (buttonId === 'MENU_VER_PUNTOS') {
    const { data: cliente } = await supabase.from('clientes').select('puntos').eq('telefono', from10).maybeSingle()
    if (cliente) {
      await sendWA(fromPhone, `⭐ Tienes *${cliente.puntos || 0}* puntos Estrella.\n\nRecuerda que puedes canjearlos por recompensas geniales.`)
    }
    return new Response('OK', { status: 200 })
  }

  // ── Mandadito: Elegir rol (envía / recibe) ──
  if (buttonId === 'MAND_ROLE_ENVIO' || buttonId === 'MAND_ROLE_RECIBO') {
    const role = buttonId === 'MAND_ROLE_ENVIO' ? 'envio' : 'recibo'
    const { avanzarFlujoMandadito: avanzar } = await import('./mandadito/handler.ts')
    await avanzar(supabase, fromPhone, from10, { step: 0.5 }, { texto: role })
    return new Response('OK', { status: 200 })
  }

  // ── Mandadito: Continuar sesión (cuando el cliente manda texto fuera de contexto) ──
  if (buttonId === 'MAND_CONTINUAR_SESION') {
    const { data: mandaditoSession } = await supabase
      .from('bot_memory').select('history').eq('phone', STATE_KEY(from10)).maybeSingle()
    if (mandaditoSession?.history?.[0]) {
      const step = mandaditoSession.history[0].step
      const pregunta = step === 1 ? '¿De dónde recogemos? (escribe la dirección)' : '¿A dónde entregamos? (escribe la dirección)'
      await sendWA(fromPhone, `▶️ Continuando tu mandadito. ${pregunta}`)
    }
    return new Response('OK', { status: 200 })
  }

  // ── Mandadito: Usar dirección guardada ──
  if (buttonId.startsWith('MAND_USAR_DIR_')) {
    // Formato: MAND_USAR_DIR_{paso}_{tipo}
    const parts = buttonId.replace('MAND_USAR_DIR_', '').split('_')
    const paso = parseInt(parts[0]) as 1 | 2
    const tipo = parts.slice(1).join('_') // ej. "casa", "trabajo"
    // Obtener coords de la dirección guardada
    const { data: dirData } = await supabase
      .from('cliente_ubicaciones')
      .select('lat, lng, colonia_nombre')
      .eq('cliente_telefono', from10)
      .eq('tipo', tipo)
      .order('ultima_vez', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!dirData?.lat) {
      await sendWA(fromPhone, `⚠️ No encontré esa dirección guardada. Por favor escíbela de nuevo.`)
      return new Response('OK', { status: 200 })
    }
    const { data: estado } = await supabase
      .from('bot_memory').select('history').eq('phone', STATE_KEY(from10)).maybeSingle()
    if (estado?.history?.[0]) {
      await avanzarFlujoMandadito(supabase, fromPhone, from10, estado.history[0],
        { lat: dirData.lat, lng: dirData.lng, texto: dirData.colonia_nombre })
    }
    return new Response('OK', { status: 200 })
  }

  // ── Mandadito: Escribir dirección manualmente ──
  if (buttonId.startsWith('MAND_ESCRIBIR_')) {
    const paso = buttonId.replace('MAND_ESCRIBIR_', '')
    const pregunta = paso === '1' ? '📍 *¿De dónde recogemos?*\n_Escribe la colonia, barrio o nombre del lugar._'
                                  : '🏁 *¿A dónde entregamos?*\n_Escribe la colonia, barrio o nombre del lugar._'
    await sendWA(fromPhone, pregunta)
    return new Response('OK', { status: 200 })
  }

  // ── Mandadito: Confirmar ──
  if (buttonId === 'CONFIRMAR_MANDADITO') {
    const { data: estadoMem } = await supabase
      .from('bot_memory').select('history').eq('phone', STATE_KEY(from10)).maybeSingle()
    const cotizacion = estadoMem?.history?.[0]?.cotizacion
    if (!cotizacion) {
      await sendWA(fromPhone, `⚠️ No encontré la cotización activa. Por favor solicita el mandadito de nuevo.`)
      return new Response('OK', { status: 200 })
    }

    const descripcion = cotizacion.esMultiParada
      ? `Mandadito Multi-Parada: \n${cotizacion.paradas.map((p: any, i: number) => ` ${i+1}. ${p.tipo}: ${p.ubicacion.texto}`).join('\n')}`
      : `Mandadito: ${cotizacion.origenDisplay} -> ${cotizacion.destinoDisplay}`

    // Para multi-parada: guardar el JSON completo de paradas (con coords) en notas
    // para que la app del repartidor pueda expandir el itinerario parada por parada
    const notasParaGuardar = cotizacion.esMultiParada && cotizacion.paradas
      ? JSON.stringify(cotizacion.paradas)
      : (cotizacion.detalles || null)

    // Obtener información del cliente
    const { data: cliente } = await supabase.from('clientes').select('nombre').eq('telefono', from10).maybeSingle()
    const clienteNombre = cliente?.nombre || 'Cliente Express'

    // ─── C-1: Generar wb_message_id único antes del INSERT ───────────────────
    // Sin este ID el pedido es un "fantasma": sin ticket corto para el admin,
    // sin referencia para notificar-whatsapp y sin link de rastreo funcional.
    const wbMessageId = `MAND-${Date.now().toString(36).toUpperCase()}-${from10.slice(-4)}`

    // Crear pedido en BD
    // Los mandaditos van directo a 'buscando_repartidor' — no hay cocina de restaurante
    // que prepare nada. El trigger de BD detecta este estado y dispara asignar-repartidor v2.0.
    const descripcionGuardar = notasParaGuardar
      ? `${descripcion}\n\n[DETALLES/PARADAS]\n${notasParaGuardar}`
      : descripcion

    console.log('====== BOT CREANDO MANDADITO ======')
    console.log(`Cliente Tel: ${from10}, Nombre: ${clienteNombre}`)
    console.log(`Origen: Lat ${cotizacion.origenLat}, Lng ${cotizacion.origenLng}`)
    console.log(`Destino: Lat ${cotizacion.destinoLat}, Lng ${cotizacion.destinoLng}`)
    console.log(`Estado inicial: 'buscando_repartidor' | wb_message_id: ${wbMessageId}`)
    console.log('Insertando en BD...')

    // ─── C-4: INSERT primero, DELETE de bot_memory SOLO si el INSERT fue exitoso ─
    // Orden anterior (incorrecto): DELETE → INSERT
    //   Si el INSERT falla, el estado ya fue borrado y el cliente pierde su cotización.
    // Orden correcto: INSERT → si OK, DELETE
    //   Si el INSERT falla, el estado permanece y el cliente puede reintentar.
    const { data: pedido, error: errPedido } = await supabase.from('pedidos').insert({
      wb_message_id: wbMessageId,
      cliente_tel: from10,
      cliente_nombre: clienteNombre,
      tipo_pedido: 'mandadito',
      descripcion: descripcionGuardar,
      total: cotizacion.precioFinal,
      estado: 'buscando_repartidor',
      direccion: cotizacion.destinoDisplay,
      // GPS origen (repartidor va aquí primero a recoger)
      lat: cotizacion.origenLat || null,
      lng: cotizacion.origenLng || null,
      // GPS destino final (entrega al cliente)
      lat_entrega: cotizacion.destinoLat || null,
      lng_entrega: cotizacion.destinoLng || null,
    }).select('id').single()

    if (errPedido) {
      console.error('❌ Error insertando pedido Mandadito en BD:', errPedido)
      // El estado NO se borra — el cliente puede volver a intentar con CONFIRMAR_MANDADITO
      await sendWA(fromPhone, `❌ Ocurrió un error al registrar tu envío. Por favor, intenta de nuevo o contacta soporte.`)
      return new Response('OK', { status: 200 })
    }

    console.log(`✅ Mandadito insertado exitosamente con ID: ${pedido.id} | Ticket: ${wbMessageId}`)

    // INSERT exitoso → ahora sí podemos limpiar el estado de la conversación
    await supabase.from('bot_memory').delete().eq('phone', STATE_KEY(from10))

    // ─── M-2: Mostrar mensaje al cliente en la confirmación (Sin Costo) ───────────────────
    await sendWA(fromPhone,
      `✅ *¡Excelente ${clienteNombre}, tu mandadito está confirmado!*\n\n` +
      `📦 *De:* ${cotizacion.origenDisplay}\n` +
      `🏁 *Para:* ${cotizacion.destinoDisplay}\n\n` +
      `_En este momento estoy coordinando con nuestros repartidores. Te notificaré en cuanto uno acepte tu envío._ 🛵💨`
    )

    const adminMsg =
      `🚨 *NUEVO MANDADITO (Bot)* 🚨\n\n` +
      `👤 Cliente: ${clienteNombre} (${from10})\n` +
      `📦 De: ${cotizacion.origenDisplay}\n` +
      `🏁 Para: ${cotizacion.destinoDisplay}\n` +
      `💰 Costo: $${cotizacion.precioFinal}\n` +
      `🎫 Ticket: ${wbMessageId}\n\n` +
      `👉 Revisa la app para asignarlo.`

    // Notificar a todos los admins
    const ADMIN_PHONES_STR = Deno.env.get('ADMIN_PHONES') || Deno.env.get('ADMIN_PHONE') || ''
    for (const adminP of ADMIN_PHONES_STR.split(',').map((p: string) => p.replace(/\D/g, '').slice(-10)).filter(Boolean)) {
      sendWA(`52${adminP}`, adminMsg).catch(() => {})
    }

    // 💡 NUEVO FLUJO: Si el cliente recibe el paquete, le sugerimos guardar la dirección
    if (cotizacion.role === 'recibo' && cotizacion.destinoLat && cotizacion.destinoLng) {
      await supabase.from('bot_memory').upsert({
        phone: `save_addr_state_${from10}`,
        history: [{
          lat: cotizacion.destinoLat,
          lng: cotizacion.destinoLng,
          colonia: cotizacion.destinoDisplay,
          ts: Date.now()
        }],
        updated_at: new Date().toISOString()
      })

      await sendInteractiveButtons(fromPhone,
        `💡 *¡Oye!* Veo que recibiste este pedido en *${cotizacion.destinoDisplay}*.\n\n¿Quieres que guarde esta ubicación para que tus próximos envíos sean más rápidos?`,
        [
          { id: 'SAVE_ADDR_CASA',    title: '🏠 Guardar como Casa' },
          { id: 'SAVE_ADDR_TRABAJO', title: '💼 Trabajo' },
          { id: 'SAVE_ADDR_OTRO',    title: '📍 Otro nombre...' },
          { id: 'SAVE_ADDR_NO',      title: '❌ No, gracias' }
        ]
      )
    }

    return new Response('OK', { status: 200 })
  }

  // ── Guardado rápido de direcciones (Flujo post-confirmación) ──
  if (buttonId.startsWith('SAVE_ADDR_')) {
    const { data: addrState } = await supabase
      .from('bot_memory').select('history').eq('phone', `save_addr_state_${from10}`).maybeSingle()
    
    if (!addrState?.history?.[0]) {
      return new Response('OK', { status: 200 }) // Ya expiró o se guardó
    }

    const { lat, lng, colonia } = addrState.history[0]

    if (buttonId === 'SAVE_ADDR_NO') {
      await supabase.from('bot_memory').delete().eq('phone', `save_addr_state_${from10}`)
      await sendWA(fromPhone, `¡Sin problema! Seguimos pendientes de tu envío. 🛵`)
      return new Response('OK', { status: 200 })
    }

    if (buttonId === 'SAVE_ADDR_OTRO') {
      // Marcar estado como esperando_nombre
      await supabase.from('bot_memory').upsert({
        phone: `save_addr_state_${from10}`,
        history: [{ lat, lng, colonia, esperando_nombre: true, ts: Date.now() }],
        updated_at: new Date().toISOString()
      })
      await sendWA(fromPhone, `✍️ *¿Cómo le llamamos a esta ubicación?*\n_Ejemplo: "Escuela", "Gimnasio", "Casa de mi suegra", etc._`)
      return new Response('OK', { status: 200 })
    }

    // Para CASA o TRABAJO
    const tipo = buttonId === 'SAVE_ADDR_CASA' ? 'casa' : 'trabajo'
    
    await supabase.from('cliente_ubicaciones').upsert({
      cliente_telefono: from10,
      tipo: tipo,
      colonia_nombre: colonia,
      lat: lat,
      lng: lng,
      ultima_vez: new Date().toISOString()
    }, { onConflict: 'cliente_telefono,tipo' })

    await supabase.from('bot_memory').delete().eq('phone', `save_addr_state_${from10}`)
    await sendWA(fromPhone, `✅ ¡Listo! Ubicación guardada como *${tipo.toUpperCase()}* 🏠.\n\nLa próxima vez solo dime "mándalo a mi ${tipo}" y lo ubicaré en automático.`)
    return new Response('OK', { status: 200 })
  }

  // ── Mandadito: Cancelar ──
  if (buttonId === 'CANCELAR_MANDADITO' || buttonId === 'MENU_CANCELAR') {
    await supabase.from('bot_memory').delete().eq('phone', STATE_KEY(from10))
    await sendWA(fromPhone, `❌ *Mandadito cancelado.* \u00a1Si necesitas algo, aquí estoy!`)
    return new Response('OK', { status: 200 })
  }


  // ── Admin: Guardar Colonia Interactiva ──
  if (esAdmin && buttonId.startsWith('ADMIN_ADDCOL_')) {
    const parts = buttonId.replace('ADMIN_ADDCOL_', '').split('_')
    if (parts.length >= 2) {
      const coloniaNombre = parts[0]
      const precio = Number(parts[1])
      
      // Insertar colonia con precio
      await supabase.from('colonias').insert({ nombre: coloniaNombre, precio: precio }).catch(() => null)
      
      const { count: sinPrecio } = await supabase.from('colonias').select('*', { count: 'exact', head: true }).is('precio', null)
      
      await sendWA(fromPhone, `✅ *Colonia Guardada*\n\n📍 Colonia: *${coloniaNombre}*\n💰 Precio: *$${precio}*\n\n📌 Faltan ${sinPrecio} colonias por cotizar.`)
    }
    return new Response('OK', { status: 200 })
  }

  // ── Admin: Actualizar colonia tras múltiples coincidencias ──
  if (esAdmin && buttonId.startsWith('ADMIN_SETCOL_')) {
    const parts = buttonId.replace('ADMIN_SETCOL_', '').split('_')
    if (parts.length >= 2) {
      const colId = parts[0]
      const precio = Number(parts[1])
      
      await supabase.from('colonias').update({ precio: precio }).eq('id', colId)
      const { data: col } = await supabase.from('colonias').select('nombre').eq('id', colId).maybeSingle()
      const { count: sinPrecio } = await supabase.from('colonias').select('*', { count: 'exact', head: true }).is('precio', null)
      
      await sendWA(fromPhone, `✅ *Precio actualizado*\n\n📍 Colonia: *${col?.nombre || 'Colonia'}*\n💰 Nuevo Precio: *$${precio}*\n\n📌 Faltan ${sinPrecio} colonias por cotizar.`)
    }
    return new Response('OK', { status: 200 })
  }
  
  if (esAdmin && buttonId === 'ADMIN_IGNORAR') {
    await sendWA(fromPhone, `❌ Operación cancelada.`)
    return new Response('OK', { status: 200 })
  }

  // ── Cliente: Menú de Restaurantes (AI Waiter) ──
  if (buttonId.startsWith('CLIENT_REST_MENU_')) {
    const restId = buttonId.replace('CLIENT_REST_MENU_', '')
    const { data: rest } = await supabase.from('restaurantes').select('id, nombre, horarios').eq('id', restId).maybeSingle()
    if (!rest) {
      await sendWA(fromPhone, 'Restaurante no encontrado.')
      return new Response('OK', { status: 200 })
    }

    // ── 🏪 VERIFICAR HORARIO ────────────────────────────────────────
    if (rest.horarios) {
      const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
      const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
      const diaActual = dias[ahora.getDay()]
      const horarioDia = rest.horarios[diaActual]

      if (horarioDia && horarioDia.activo === false) {
        await sendWA(fromPhone, `🔒 *${rest.nombre}* está cerrado hoy.\n\n¿Quieres ver el menú de todos modos o buscamos otra opción?`)
        return new Response('OK', { status: 200 })
      }

      if (horarioDia?.abre && horarioDia?.cierra) {
        const [hAbre, mAbre] = horarioDia.abre.split(':').map(Number)
        const [hCierra, mCierra] = horarioDia.cierra.split(':').map(Number)
        const minActual = ahora.getHours() * 60 + ahora.getMinutes()
        const minAbre = hAbre * 60 + mAbre
        const minCierra = hCierra * 60 + mCierra

        if (minActual < minAbre || minActual > minCierra) {
          await sendWA(fromPhone, `⏰ *${rest.nombre}* está cerrado en este momento.\n\n📌 Horario de hoy: *${horarioDia.abre} — ${horarioDia.cierra}*\n\n¿Quieres que te avisemos cuando abra? Escríbeme luego 😊`)
          return new Response('OK', { status: 200 })
        }
      }
    }

    // ── OBTENER CATEGORÍAS ──
    const [ { data: categorias }, { data: menuCombos } ] = await Promise.all([
      supabase.from('menu_categorias').select('id, nombre, emoji').eq('restaurante_id', restId).order('orden'),
      supabase.from('menu_combos').select('id').eq('restaurante_id', restId).eq('disponible', true).limit(1)
    ])

    let catRows: any[] = []
    
    if (menuCombos && menuCombos.length > 0) {
      catRows.push({
        id: `CLIENT_REST_CAT_combos_${restId}`,
        title: `⭐ Combos y Promos`,
        description: `Ver paquetes especiales`
      })
    }

    if (categorias) {
      categorias.forEach((c: any) => {
        catRows.push({
          id: `CLIENT_REST_CAT_item_${c.id}`,
          title: `${c.emoji || '🍽️'} ${c.nombre}`,
          description: `Toca para ver platillos`
        })
      })
    }

    if (catRows.length === 0) {
      await sendWA(fromPhone, `😔 *${rest.nombre}* aún no ha subido productos a su menú en línea.`)
      return new Response('OK', { status: 200 })
    }

    // Paginación si hay más de 10
    let finalRows = catRows
    if (catRows.length > 10) {
      finalRows = catRows.slice(0, 9)
      finalRows.push({
        id: `CLIENT_REST_CATPAGE_1_${restId}`,
        title: `Ver más categorías ➡️`,
        description: `Página 2`
      })
    }

    // Iniciar sesión vacía para el IA Waiter — con menú real para contexto
    // Fetchar el menú real para que el IA Waiter sepa precios cuando el cliente agrega por botón
    const [ { data: menuItemsAll }, { data: menuCombosAll } ] = await Promise.all([
      supabase.from('menu_items').select('nombre, precio, descripcion').eq('restaurante_id', restId).eq('disponible', true),
      supabase.from('menu_combos').select('nombre, precio, descripcion, incluye').eq('restaurante_id', restId).eq('disponible', true)
    ])
    let menuTextReal = ''
    if (menuCombosAll?.length) {
      menuTextReal += 'COMBOS:\n' + menuCombosAll.map((c: any) => `- ${c.nombre}: $${c.precio}${c.incluye?.length ? ' (incluye: ' + c.incluye.join(', ') + ')' : ''}`).join('\n') + '\n\n'
    }
    if (menuItemsAll?.length) {
      menuTextReal += 'PLATILLOS:\n' + menuItemsAll.map((i: any) => `- ${i.nombre}: $${i.precio}`).join('\n')
    }
    if (!menuTextReal) menuTextReal = 'Sin productos disponibles aún.'

    await supabase.from('bot_memory').upsert({
      phone: `order_session_${from10}`,
      history: [{
        restauranteId: rest.id,
        restauranteNombre: rest.nombre,
        menuText: menuTextReal,
        cart: [],
        history: [],
        ts: Date.now()
      }],
      updated_at: new Date().toISOString()
    })

    const { sendInteractiveList } = await import('./whatsapp.ts')
    await sendInteractiveList(
      fromPhone,
      `👨‍🍳 *¡Bienvenido a ${rest.nombre}!*\n\nSelecciona la categoría que deseas ver:`,
      `Ver Menú 📋`,
      [{ title: 'Categorías', rows: finalRows }]
    )
    return new Response('OK', { status: 200 })
  }

  /* ── Cliente: Repetir Pedido [DESACTIVADO] ──
  if (buttonId.startsWith('REPETIR_PEDIDO_')) {
    const pedidoId = buttonId.replace('REPETIR_PEDIDO_', '')
    const { data: pedido } = await supabase.from('pedidos').select('restaurante_id, restaurante, descripcion, items').eq('id', pedidoId).maybeSingle()
    if (!pedido) {
      await sendWA(fromPhone, '❌ No pudimos encontrar el pedido anterior.')
      return new Response('OK', { status: 200 })
    }

    // Initialize session with the previous items so AI knows context
    const { data: menuCombosAll, data: menuItemsAll } = await Promise.all([
      supabase.from('menu_combos').select('nombre, precio, incluye').eq('restaurante_id', pedido.restaurante_id).eq('disponible', true).limit(50),
      supabase.from('menu_items').select('nombre, precio').eq('restaurante_id', pedido.restaurante_id).eq('disponible', true).limit(100)
    ]).then(res => ({ data: res[0].data, data2: res[1].data }))
    
    let menuTextReal = ''
    if (menuCombosAll?.length) menuTextReal += 'COMBOS:\n' + menuCombosAll.map((c: any) => `- ${c.nombre}: $${c.precio}`).join('\n') + '\n\n'
    if (menuItemsAll?.length) menuTextReal += 'PLATILLOS:\n' + menuItemsAll.map((i: any) => `- ${i.nombre}: $${i.precio}`).join('\n')
    if (!menuTextReal) menuTextReal = 'Sin productos disponibles aún.'

    // Set bot_memory so the AI waiter wakes up directly with a system prompt asking to repeat the order
    await supabase.from('bot_memory').upsert({
      phone: `order_session_${from10}`,
      history: [{
        restauranteId: pedido.restaurante_id,
        restauranteNombre: pedido.restaurante,
        menuText: menuTextReal,
        cart: [],
        history: [
          { role: 'user', content: `Quiero pedir exactamente lo que pedí la vez pasada: ${pedido.descripcion}` }
        ],
        ts: Date.now()
      }],
      updated_at: new Date().toISOString()
    })

    // Trigger AI waiter manually to respond
    const { handleClientMessage } = await import('./client-flow.ts')
    await handleClientMessage(supabase, fromPhone, from10, `Quiero pedir exactamente lo que pedí la vez pasada: ${pedido.descripcion}`, 'text')
    return new Response('OK', { status: 200 })
  }
  */

  /* ── Cliente: Menú Drill-Down (Paginación de Categorías) [DESACTIVADO] ──
  if (buttonId.startsWith('CLIENT_REST_CATPAGE_')) {
    const parts = buttonId.replace('CLIENT_REST_CATPAGE_', '').split('_')
    const page = parseInt(parts[0])
    const restId = parts.slice(1).join('_')
    const [ { data: categorias }, { data: menuCombos } ] = await Promise.all([
      supabase.from('menu_categorias').select('id, nombre, emoji').eq('restaurante_id', restId).order('orden'),
      supabase.from('menu_combos').select('id').eq('restaurante_id', restId).eq('disponible', true).limit(1)
    ])
    let catRows: any[] = []
    if (menuCombos && menuCombos.length > 0) catRows.push({ id: `CLIENT_REST_CAT_combos_${restId}`, title: `⭐ Combos y Promos`, description: `Ver paquetes especiales` })
    if (categorias) categorias.forEach((c: any) => { catRows.push({ id: `CLIENT_REST_CAT_item_${c.id}`, title: `${c.emoji || '🍽️'} ${c.nombre}`, description: `Toca para ver platillos` }) })
    const startIndex = page * 9
    let finalRows = catRows.slice(startIndex, startIndex + 9)
    if (catRows.length > startIndex + 9) finalRows.push({ id: `CLIENT_REST_CATPAGE_${page + 1}_${restId}`, title: `Ver más categorías ➡️`, description: `Página ${page + 2}` })
    finalRows.unshift({ id: page === 1 ? `CLIENT_REST_MENU_${restId}` : `CLIENT_REST_CATPAGE_${page - 1}_${restId}`, title: `⬅️ Regresar`, description: `Página anterior` })
    const { sendInteractiveList } = await import('./whatsapp.ts')
    await sendInteractiveList(fromPhone, `Página ${page + 1} de categorías:`, `Ver más 📋`, [{ title: 'Categorías', rows: finalRows.slice(0, 10) }])
    return new Response('OK', { status: 200 })
  }
  */

  /* ── Cliente: Menú Drill-Down (Ver Categoría) [DESACTIVADO] ──
  if (buttonId.startsWith('CLIENT_REST_CAT_')) {
    const parts = buttonId.replace('CLIENT_REST_CAT_', '').split('_')
    const tipoCat = parts[0]
    const catId = parts.slice(1).join('_')
    let prodRows: any[] = []
    let tituloMsg = ''
    if (tipoCat === 'combos') {
      const { data: combos } = await supabase.from('menu_combos').select('id, nombre, precio, descripcion').eq('restaurante_id', catId).eq('disponible', true)
      tituloMsg = `⭐ *Combos y Promociones*\nSelecciona un combo para ver sus detalles:`
      if (combos) prodRows = combos.map((c: any) => ({ id: `CLIENT_REST_PROD_combo_${c.id}`, title: c.nombre.substring(0, 24), description: `💰 $${c.precio} - ${c.descripcion ? c.descripcion.substring(0, 40) : 'Ver detalles'}` }))
    } else {
      const { data: items } = await supabase.from('menu_items').select('id, nombre, precio, descripcion').eq('categoria_id', catId).eq('disponible', true)
      tituloMsg = `🍽️ *Platillos*\nSelecciona una opción para ver sus detalles:`
      if (items) prodRows = items.map((i: any) => ({ id: `CLIENT_REST_PROD_item_${i.id}`, title: i.nombre.substring(0, 24), description: `💰 $${i.precio} - ${i.descripcion ? i.descripcion.substring(0, 40) : 'Ver detalles'}` }))
    }
    if (prodRows.length === 0) { await sendWA(fromPhone, `Esta categoría está vacía por el momento.`); return new Response('OK', { status: 200 }) }
    let finalRows = prodRows
    if (prodRows.length > 10) { finalRows = prodRows.slice(0, 9); finalRows.push({ id: `CLIENT_REST_PRODPAGE_1_${tipoCat}_${catId}`, title: `Ver más productos ➡️`, description: `Página 2` }) }
    const { sendInteractiveList } = await import('./whatsapp.ts')
    await sendInteractiveList(fromPhone, tituloMsg, `Elegir Opción`, [{ title: 'Productos', rows: finalRows }])
    return new Response('OK', { status: 200 })
  }
  */

  // ── Cliente: Menú Drill-Down - Paginación, Detalle y Carrito [DESACTIVADO] ──
  // if (buttonId.startsWith('CLIENT_REST_PRODPAGE_')) { ... }
  // if (buttonId.startsWith('CLIENT_REST_PROD_')) { ... }
  // if (buttonId === 'CLIENT_CATALOGO_VOLVER') { ... }
  // if (buttonId.startsWith('CLIENT_REST_ADD_')) { ... }

  // ── Registro: confirmación SI/NO ──
  if (buttonId.toUpperCase().startsWith('REG_CONFIRM_')) {
    const esSi = buttonId.toUpperCase().startsWith('REG_CONFIRM_SI_')
    const SUPABASE_PROJECT_URL = Deno.env.get('SUPABASE_URL') || ''
    const { data: regData } = await supabase.from('bot_memory')
      .select('history').eq('phone', `reg_state_${from10}`).maybeSingle()
    const regState = regData?.history?.[0] ?? { tel: from10, step: 3 }

    // @ts-ignore
    EdgeRuntime.waitUntil(
      fetch(`${SUPABASE_PROJECT_URL}/functions/v1/whatsapp-ai`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromPhone, from10, texto: esSi ? 'sí' : 'no',
          isRepartidor: false, repartidorInfo: null, isClient: true, clienteCtx: null, regState })
      }).catch(err => console.error('Error REG_CONFIRM:', err))
    )
    return new Response('OK', { status: 200 })
  }

  // ── Embudo inicial: elección de tipo de usuario ──
  if (buttonId === 'REG_TIPO_CLIENTE') {
    const { sendInteractiveFlow } = await import('./whatsapp.ts')
    const flowToken = JSON.stringify({ phone: fromPhone })
    await sendInteractiveFlow(fromPhone, `¡Genial! 🎉 Para darte de alta como Cliente VIP y enviarte tu tarjeta digital, por favor llena este rápido formulario:`, `📝 Llenar Formulario`, `1489224042353572`, flowToken, `REGISTRO_CLIENTE`)
    return new Response('OK', { status: 200 })
  }

  if (buttonId === 'REG_TIPO_RESTAURANTE') {
    const { sendInteractiveFlow } = await import('./whatsapp.ts')
    const flowToken = JSON.stringify({ phone: fromPhone })
    await sendInteractiveFlow(fromPhone, `¡Excelente decisión! 🏪 Para iniciar tu afiliación como Restaurante Aliado, por favor completa esta solicitud:`, `📝 Llenar Formulario`, `27165926819731779`, flowToken, `REGISTRO_RESTAURANTE`)
    return new Response('OK', { status: 200 })
  }

  // ── Admin: aceptar / rechazar registro ──
  if (esAdmin && (buttonId.startsWith('reg_accept_') || buttonId.startsWith('reg_reject_'))) {
    const telMatch  = buttonId.match(/(\d{10})$/)
    const clientTel = telMatch ? telMatch[1] : buttonId.replace(/^reg_(accept|reject)_/, '')
    if (!clientTel || clientTel.length < 10) {
      await sendWA(fromPhone, `⚠️ No pude identificar el teléfono del cliente desde el botón.`)
      return new Response('OK', { status: 200 })
    }

    const { data: pendingReg } = await supabase.from('bot_memory')
      .select('history').eq('phone', `pending_reg_${clientTel}`).maybeSingle()
    const regInfo = pendingReg?.history?.[0]

    if (buttonId.startsWith('reg_accept_')) {
      if (!regInfo) {
        await sendWA(fromPhone, `⚠️ No encontré la solicitud para ${clientTel}. Es posible que ya fue procesada.`)
        return new Response('OK', { status: 200 })
      }
      const rndBytes = crypto.getRandomValues(new Uint8Array(4))
      const rndHex   = Array.from(rndBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
      const qrCode   = `QR-${clientTel}-${rndHex}`

      // Generar código de referido único para el nuevo cliente
      const refBytes = crypto.getRandomValues(new Uint8Array(3))
      const refHex = Array.from(refBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
      const codigoReferido = `ESTRELLA-${refHex}`

      const { error: insertErr } = await supabase.from('clientes').upsert({
        telefono: clientTel, nombre: regInfo.nombre,
        direccion: regInfo.colonia ? `${regInfo.colonia}, ${regInfo.direccion || ''}`.trim() : (regInfo.direccion || null),
        lat_frecuente: regInfo.lat || null, lng_frecuente: regInfo.lng || null,
        puntos: 0, es_vip: false, acepta_terminos: false,
        qr_code: qrCode, codigo_referido: codigoReferido, created_at: new Date().toISOString()
      }, { onConflict: 'telefono' })

      if (insertErr) {
        console.error('[REG_ACCEPT] Error al insertar cliente:', insertErr)
        await sendWA(fromPhone, `❌ Error al registrar a ${regInfo.nombre}. Intenta con /rol ${clientTel} cliente ${regInfo.nombre}`)
      } else {
        await supabase.from('bot_memory').delete().eq('phone', `pending_reg_${clientTel}`)
        const tycUrl   = `https://www.app-estrella.shop/terminos`
        const primerNombre = regInfo.nombre.split(' ')[0]
        const tycTexto = `🎉 *¡Felicidades, ${primerNombre}!* Tu cuenta VIP ha sido aprobada con éxito. 🌟\n\nAl unirte a nuestra familia en Estrella Delivery, comienzas a disfrutar de:\n\n✨ *Puntos canjeables* por cada pedido.\n🚚 *Envíos gratis* y descuentos especiales.\n🎁 *Acceso exclusivo* a regalos y dinámicas.\n\nPara completar tu registro, solo necesitamos que confirmes nuestros términos de servicio 👇\n\n🔗 ${tycUrl}`
        await sendWA(`52${clientTel}`, tycTexto)
        await sendInteractiveButtons(`52${clientTel}`, `¿Aceptas los términos y condiciones?`, [
          { id: 'ACEPTAR_TERMINOS', title: '✅ Aceptar' },
          { id: 'RECHAZAR_TERMINOS', title: '❌ Rechazar' }
        ])
        // Enviar código de referido al cliente recién aprobado
        await sendWA(`52${clientTel}`, `🎁 *Tu código de referido personal es:*\n\n*${codigoReferido}*\n\n¡Compártelo con amigos y ambos ganan *1 punto extra* ⭐ cuando se registren!`)
        await sendWA(fromPhone, `✅ *Cliente Registrado: ${regInfo.nombre}* (${clientTel})\n\n📋 T&C enviados. Código de referido: *${codigoReferido}* ⏳`)
      }
      return new Response('OK', { status: 200 })
    } else {
      await supabase.from('bot_memory').delete().eq('phone', `pending_reg_${clientTel}`)
      await sendWA(`52${clientTel}`, `Lo sentimos 🙏 Tu solicitud no pudo ser aprobada.\nSi crees que es un error, contáctanos directamente.`)
      await sendWA(fromPhone, `❌ Solicitud de *${regInfo?.nombre || clientTel}* rechazada. El cliente fue notificado.`)
      return new Response('OK', { status: 200 })
    }
  }

  // ── Admin: Aceptar / Rechazar Restaurante (Versión Flow) ──
  if (esAdmin && (buttonId.startsWith('flow_rest_accept_') || buttonId.startsWith('flow_rest_reject_'))) {
    const restTel = buttonId.replace(/^flow_rest_(accept|reject)_/, '')
    
    // Buscar la solicitud en la base de datos
    const { data: sol, error: solErr } = await supabase.from('restaurantes_solicitudes')
      .select('*').eq('telefono', restTel).eq('estado', 'pendiente').order('creado_en', { ascending: false }).limit(1).maybeSingle()
    
    if (solErr || !sol) {
      await sendWA(fromPhone, `⚠️ No encontré una solicitud pendiente para ${restTel} o ya fue procesada.`)
      return new Response('OK', { status: 200 })
    }

    if (buttonId.startsWith('flow_rest_accept_')) {
      // Generar contraseña segura
      const rNum = Math.floor(1000 + Math.random() * 9000);
      const genPassword = `Estrella${rNum}*`;

      // EMAIL CANÓNICO: siempre derivado del teléfono, garantiza que el login del portal funcione
      const authEmail = `aliado_${restTel}@app-estrella.shop`;

      // Crear Usuario en Auth
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: authEmail,
        password: genPassword,
        email_confirm: true
      })

      let isAuthCreated = true;
      let adminId = authData?.user?.id;

      if (authErr) {
        if (authErr.message.includes('already been registered') || authErr.message.includes('already exists')) {
           isAuthCreated = false;
           const { data: existingId } = await supabase.rpc('get_user_id_by_email', { email_to_search: authEmail });
           adminId = existingId;
        } else {
           await sendWA(fromPhone, `❌ Error al crear usuario en Auth: ${authErr.message}`)
           return new Response('OK', { status: 200 })
        }
      }

      // Generar slug único (mismo algoritmo que admin-approval)
      const baseSlug = sol.nombre_restaurante.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const finalSlug = `${baseSlug}-${restTel.slice(-4)}`

      // Insertar en la tabla restaurantes
      const { error: insertErr } = await supabase.from('restaurantes').insert({
        nombre: sol.nombre_restaurante,
        telefono: sol.telefono,
        direccion: sol.direccion || null,
        activo: true,
        programa_lealtad_activo: true,
        slug: finalSlug,
        correo: sol.correo || null,  // correo real de contacto (distinto al email de Auth)
        admin_id: adminId
      })

      if (insertErr && insertErr.code !== '23505') {
         await sendWA(fromPhone, `❌ Error al insertar el restaurante: ${insertErr.message}`)
         return new Response('OK', { status: 200 })
      } else if (insertErr && insertErr.code === '23505') {
         await supabase.from('restaurantes').update({ activo: true, programa_lealtad_activo: true, slug: finalSlug }).eq('telefono', sol.telefono)
      }

      // Actualizar estado de solicitud
      await supabase.from('restaurantes_solicitudes').update({ estado: 'aprobado' }).eq('id', sol.id)

      await sendWA(fromPhone, `✅ Restaurante *${sol.nombre_restaurante}* aprobado. Se le enviarán sus accesos por WA.`)

      let msgCredenciales = `🎉 *¡Felicidades, ${sol.encargado || sol.nombre_restaurante}! Tu restaurante ha sido APROBADO.*\n\nYa puedes gestionar todo como Aliado enviándonos la palabra *Menú* o *Hola* por este mismo chat.`;
      if (isAuthCreated) {
        // Las credenciales usan el teléfono como usuario (no el correo real)
        msgCredenciales += `\n\nPara administrar tu menú e información, ingresa a:\n🌐 *https://restaurantes-app-estrella.shop*\n\n_(Usuario: tu número de teléfono *${restTel}* / Clave: ${genPassword})_`;
      }
      await sendWA(`52${restTel}`, msgCredenciales)
      
      const pdfUrl = Deno.env.get('PDF_BIENVENIDA_URL') || "https://jdrrkpvodnqoljycixbg.supabase.co/storage/v1/object/public/restaurantes/pdf-restaurantes/pdf-restaurante.pdf" 
      await sendWADocument(`52${restTel}`, pdfUrl, "Guia_Restaurantes.pdf", "📖 Te enviamos esta pequeña guía en PDF para que sepas cómo sacarle el máximo provecho a Estrella Delivery.")

      return new Response('OK', { status: 200 })

    } else {
      // Rechazar
      await supabase.from('restaurantes_solicitudes').update({ estado: 'rechazado' }).eq('telefono', restTel).eq('estado', 'pendiente')
      await sendWA(fromPhone, `❌ Solicitud de restaurante *${sol.nombre_restaurante}* rechazada.`)
      await sendWA(`52${restTel}`, `Estimado comercio, por el momento no estamos aceptando más registros en su zona o los datos proporcionados no cumplen con las políticas. Gracias por su interés en Estrella Delivery.`)
      return new Response('OK', { status: 200 })
    }
  }

  // ── Admin: aceptar / rechazar Restaurante ──
  if (esAdmin && (buttonId.startsWith('rest_accept_') || buttonId.startsWith('rest_reject_'))) {
    const restTel = buttonId.replace(/^rest_(accept|reject)_/, '')
    
    if (!restTel || restTel.length !== 10) {
      await sendWA(fromPhone, `⚠️ No pude identificar el teléfono del restaurante.`)
      return new Response('OK', { status: 200 })
    }

    const { data: pendingRest } = await supabase.from('bot_memory')
      .select('history').eq('phone', `pending_rest_${restTel}`).maybeSingle()
    const restInfo = pendingRest?.history?.[0]

    if (buttonId.startsWith('rest_accept_')) {
      if (!restInfo) {
        await sendWA(fromPhone, `⚠️ No encontré la solicitud para ${restTel}. Es posible que ya fue procesada.`)
        return new Response('OK', { status: 200 })
      }

      // Generar slug
      const baseSlug = restInfo.nombreRest.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const finalSlug = `${baseSlug}-${restTel.slice(-4)}`;
      
      // Guardar todo: telefono, nombre, foto, ubicacion y que esté activo
      const { error } = await supabase.from('restaurantes').insert({
        telefono: restTel,
        nombre: restInfo.nombreRest,
        direccion: restInfo.ubicacion,
        foto_fachada_url: restInfo.fotoUrl,
        programa_lealtad_activo: true,
        activo: true,
        slug: finalSlug
      })

      if (error) {
        if (error.code === '23505') await sendWA(fromPhone, `⚠️ El restaurante con teléfono ${restTel} ya existe en el sistema.`)
        else await sendWA(fromPhone, `❌ Error al guardar el restaurante: ${error.message}`)
        return new Response('OK', { status: 200 })
      }

      await supabase.from('bot_memory').delete().eq('phone', `pending_rest_${restTel}`)
      
      await sendWA(fromPhone, `✅ Restaurante *${restInfo.nombreRest}* aprobado y registrado en el sistema.`)
      
      const menuUrl = `https://estrella-eats.mx/menu/${finalSlug}`;
      const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(menuUrl)}&size=500&margin=2`;
      
      const { sendWAImage } = await import('./whatsapp.ts');
      await sendWAImage(
        `52${restTel}`, 
        qrUrl, 
        `🎉 *¡Felicidades, ${restInfo.responsable || 'aliado'}!*\n\n¡Tu restaurante ha sido aprobado por nuestro equipo! 🥳 Ya eres parte oficial de la familia Estrella Eats.\n\nAquí tienes tu Código QR y tu link público para que tus clientes comiencen a pedir:\n🔗 ${menuUrl}\n\nPara configurar tu menú, entra a restaurantes-app-estrella.shop con tu número de teléfono.`
      )
      
      // Enviar documento leyendo URL de variable de entorno (con fallback al actual si no existe)
      const pdfUrl = Deno.env.get('PDF_BIENVENIDA_URL') || "https://jdrrkpvodnqoljycixbg.supabase.co/storage/v1/object/public/restaurantes/pdf-restaurantes/pdf-restaurante.pdf" 
      await sendWADocument(`52${restTel}`, pdfUrl, "Guia_Restaurantes.pdf", "📖 Te enviamos esta pequeña guía en PDF para que sepas cómo sacarle el máximo provecho a tu Portal de Aliados.")

      return new Response('OK', { status: 200 })
    } else {
      await supabase.from('bot_memory').delete().eq('phone', `pending_rest_${restTel}`)
      await sendWA(`52${restTel}`, `Lo sentimos 🙏 Tu solicitud de afiliación no pudo ser aprobada.\nSi crees que es un error, contáctanos directamente.`)
      await sendWA(fromPhone, `❌ Solicitud del restaurante *${restInfo?.nombreRest || restTel}* rechazada.`)
      return new Response('OK', { status: 200 })
    }
  }

  // ── Calificación de clientes ──
  if (buttonId.startsWith('RATE_') || buttonId.startsWith('TAG_') || buttonId.startsWith('VETAR_')) {
    return await handleCalificacion(supabase, fromPhone, buttonId)
  }

  // ── Términos y Condiciones / Intercepción de Confirmación de Pedido ──
  const upId = buttonId.toUpperCase()
  if (upId === 'ACEPTAR' || upId === 'RECHAZAR' || upId === 'ACEPTAR_TERMINOS' || upId === 'RECHAZAR_TERMINOS') {
    
    // 1. Revisar si el cliente está respondiendo a una confirmación de pedido activo
    if (upId === 'ACEPTAR' || upId === 'RECHAZAR') {
      const { data: pedidoActivo } = await supabase
        .from('pedidos')
        .select('id, wb_message_id, descripcion, restaurante')
        .eq('cliente_tel', from10)
        .in('estado', ['pendiente', 'asignado', 'aceptado', 'recibido', 'en_camino'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pedidoActivo) {
        if (upId === 'ACEPTAR') {
          const detalle = pedidoActivo.descripcion || 'tus productos';
          const rest = pedidoActivo.restaurante || 'el restaurante';
          // BUG 3 fix: use wb_message_id (ticket corto) and correct URL params
          const ticketParam = pedidoActivo.wb_message_id || pedidoActivo.id;
          const link = `https://estrella-eats.mx/success?pedido=${ticketParam}&success=true`;
          const text = `✅ *¡Tu pedido va en camino, ${pedidoActivo.cliente_nombre || ''}!* 🛵💨\n\n🍽️ *Restaurante:* ${rest}\n📦 *Pedido:* ${detalle}\n\n📍 *Rastrea tu pedido en tiempo real aquí:*\n${link}`;
          await sendWA(fromPhone, text);
        } else {
          // RECHAZAR
          await supabase.from('pedidos').update({ estado: 'cancelado' }).eq('id', pedidoActivo.id);
          await sendWA(fromPhone, `❌ Tu pedido en *${pedidoActivo.restaurante || 'el restaurante'}* ha sido cancelado.`);
        }
        return new Response('OK', { status: 200 });
      }
    }

    // 2. Si no hay pedido activo, asumimos que es el flujo de Términos y Condiciones
    return await handleTerminos(supabase, fromPhone, buttonId)
  }

  // ── Comandos admin (alerta zombie) ──
  if (buttonId.startsWith('CMD_REASIGNAR_') || buttonId.startsWith('CMD_CANCELAR_')) {
    return await handleAdminCommands(supabase, fromPhone, buttonId)
  }

  // ── Repartidor (ciclo de vida del pedido) ──
  await handleRepButtons(supabase, fromPhone, buttonId)
  return new Response('OK', { status: 200 })
}
