// admin-handler.ts — Manejador de las acciones del Administrador (Comandante Alpha)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendWA, sendWAImage, sendWALocation, sendWATemplate, sendInteractiveButtons } from './whatsapp.ts'
import { extract10Digits, guardarMemoria, limpiarMemoria, buscarRepartidor } from './db.ts'
import { generateCloudinaryVIPCard } from '../_shared/utils.ts'
import { getMetaPuntos } from '../_shared/constants.ts'
import { conversacionDeepSeek } from './ai.ts'

type Supa = ReturnType<typeof createClient>

const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
const ADMIN_PHONE_MAIN = (() => {
  const n = ADMIN_PHONES_ENV.split(',')[0]?.replace(/\D/g, '').slice(-10)
  return n ? `52${n}` : ''
})()

// --- PEDIDOS DESHABILITADO ---
/*
export async function handleAdminGPS(
  supabase: Supa, fromPhone: string, admin10: string,
  lat: number, lng: number, contextText: string, messageId: string
): Promise<Response> {
  // Verificamos si hay un pedido pendiente del restaurante que el administrador esté procesando.
  // Si encontramos uno, asociamos estas coordenadas al pedido.
  const pData = {
    clienteTel: '9999999999', clienteNombre: null, restaurante: null,
    descripcion: contextText || 'Entrega en coordenadas GPS',
    direccion: null, repartidorAlias: null,
  }
  const r = await crearPedidoDesdeBot(supabase, pData, lat, lng, messageId)
  if (r.ok && r.pedidoId) {
    await sendWA(fromPhone, `✅ Mapa 📍 recibido.\n\n*Pedido creado en GPS local.*\n⚠️ *[SISTEMA]*: Alerta: El pedido quedó sin número de cliente. Por favor asigna uno con la web app.\n🔗 ${pedidoLink(r.pedidoId)}`)
  }
  return new Response('OK', { status: 200 })
}
*/

// --- PEDIDOS DESHABILITADO ---
/*
export async function handleAdminAssignRest(
  supabase: Supa, fromPhone: string, admin10: string, textoAdmin: string, pendingState: any
): Promise<Response | null> {
  const pedidosPendientes: any[] = pendingState.pedidos
  // Solo hace match si hay "todos" o empieza con "1 jorge", etc., y nada más que eso.
  const esAsignacion = /^(todos\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]+([\s][a-zA-ZáéíóúÁÉÍÓÚñÑ]+)*|(\d+\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]+([\s][a-zA-ZáéíóúÁÉÍÓÚñÑ]+)*(,\s*\d+\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]+([\s][a-zA-ZáéíóúÁÉÍÓÚñÑ]+)*)*))$/i.test(textoAdmin.trim())

  if (!esAsignacion) return null // Pasa al flujo de DeepSeek

  const asignaciones: Record<number, string> = {}
  if (/^todos\s+\w+/i.test(textoAdmin)) {
    const nombreRep = textoAdmin.replace(/^todos\s+/i, '').trim()
    pedidosPendientes.forEach((_, i) => asignaciones[i + 1] = nombreRep)
  } else {
    const partes = textoAdmin.split(',')
    for (const parte of partes) {
      const match = parte.trim().match(/^(\d+)\s+(\w+)/)
      if (match) asignaciones[parseInt(match[1])] = match[2]
    }
  }

  if (Object.keys(asignaciones).length === 0) {
    await sendWA(fromPhone, `🤔 No entendí la asignación.\nUsa: *"todos Jorge"* o *"1 Jorge, 2 María"*.`)
    return new Response('OK', { status: 200 })
  }

  let resumen = `📋 *PEDIDOS ASIGNADOS — ${pendingState.restaurante_nombre}*\n\n`
  let errores = 0

  for (const [idxStr, repAlias] of Object.entries(asignaciones)) {
    const idx = parseInt(idxStr) - 1
    const pedido = pedidosPendientes[idx]
    if (!pedido) continue

    const rep = await buscarRepartidor(supabase, repAlias)
    if (!rep) {
      resumen += `${idx + 1}️⃣ ❌ Repartidor *${repAlias}* no encontrado.\n`
      errores++
      continue
    }

    // CACHÉ GPS: Buscar coordenadas frecuentes del cliente
    const telLimpio = extract10Digits(pedido.clienteTel || '0000000000')
    const { data: clienteCache } = await supabase.from('clientes').select('lat_frecuente, lng_frecuente').eq('telefono', telLimpio).maybeSingle()

    const finalLat = pedido.lat || clienteCache?.lat_frecuente || null
    const finalLng = pedido.lng || clienteCache?.lng_frecuente || null

    const { data: nuevo, error: pedErr } = await supabase.from('pedidos').insert({
      cliente_tel: pedido.clienteTel || '0000000000',
      descripcion: pedido.descripcion || 'Pedido de restaurante',
      direccion: pedido.direccion || null,
      restaurante: pendingState.restaurante_nombre,
      repartidor_id: rep.user_id || null,
      estado: 'asignado',
      lat: finalLat,
      lng: finalLng
    }).select('id').maybeSingle()

    if (pedErr || !nuevo) {
      resumen += `${idx + 1}️⃣ ❌ Error guardando: ${pedErr?.message}\n`; errores++
      continue
    }
    // Nota: Las notificaciones a los repartidores ahora se disparan automáticamente 
    // mediante Triggers en la base de datos (PostgreSQL) cuando cambia el estado.

    resumen += `${idx + 1}️⃣ ✅ a *${rep.nombre}* → Cliente ${pedido.clienteTel}\n`
  }
  resumen += errores > 0 ? `\n⚠️ ${errores} error(es).` : `\n🚀 Notificaciones enviadas.`
  // Eliminamos el registro de pedidos pendientes una vez que han sido asignados correctamente.
  await supabase.from('bot_memory').delete().eq('phone', `admin_rest_pending_${admin10}`)
  await sendWA(fromPhone, resumen)
  return new Response('OK', { status: 200 })
}
*/

export async function handleAdminMessage(
  supabase: Supa, fromPhone: string, messageId: string, texto: string
): Promise<Response> {
  const chat = await conversacionDeepSeek(supabase, fromPhone, texto, false, null)
  return await executeAdminAction(supabase, fromPhone, messageId, chat)
}

export async function executeAdminAction(
  supabase: Supa, fromPhone: string, messageId: string, chat: any
): Promise<Response> {
  if (!chat) {
    await sendWA(fromPhone, '❌ Cerebro AI devolvió un valor nulo.')
    return new Response('OK', { status: 200 })
  }
  if (chat.errorObj) {
    await sendWA(fromPhone, `❌ *Error DeepSeek API:*\n${chat.errorObj}`)
    return new Response('OK', { status: 200 })
  }

  if (!chat.respuesta) {
    await sendWA(fromPhone, '❌ Sin respuesta de IA. Intente de nuevo.')
    return new Response('OK', { status: 200 })
  }
  const { accion, mensajeUsuario } = chat.respuesta
  const d: any = chat.respuesta.datosAExtraer || {}

  // Flujos simples que solo responden — guardan historial para continuidad
  if (['RESPONDER', 'CONSULTA_GENERAL'].includes(accion)) {
    await guardarMemoria(supabase, fromPhone, chat.nuevoHistorial || [])
    await sendWA(fromPhone, mensajeUsuario || '¿Me lo repites?')
    return new Response('OK', { status: 200 })
  }

  // Para TODAS las demás acciones: limpiar historial ANTES de ejecutar
  // Evita que el admin quede en loop pidiendo datos ya dados
  await limpiarMemoria(supabase, fromPhone)

  // Ejecución de acciones específicas
  switch (accion) {
    case 'VER_RESTAURANTES': {
      const { data: locals } = await supabase
        .from('restaurantes')
        .select('nombre, telefono, activo')
        .eq('activo', true)
        .order('nombre')

      if (!locals?.length) {
        await sendWA(fromPhone, '📍 *RESTAURANTES*\n\n⚠️ No hay locales activos registrados actualmente.')
        break
      }

      let msg = '📊 *REPORTE DE RESTAURANTES B2B*\n'
      msg += '═════════════════════════\n\n'
      locals.forEach((l: any, i: number) => {
        msg += `🏪 *${l.nombre.toUpperCase()}*\n`
        msg += l.telefono ? `   📞 \`52${extract10Digits(l.telefono)}\`\n` : '   📞 _Sin teléfono_\n'
        msg += '\n'
      })
      msg += '═════════════════════════\n'
      msg += '💡 _Tip: Para ver la ubicación de uno, escribe: "Mapa de [Nombre]"_'
      await sendWA(fromPhone, msg)
      break
    }
    case 'VER_VIPS': {
      const { data: vips } = await supabase.from('clientes').select('nombre, telefono, puntos, es_vip')
        .order('puntos', { ascending: false }).limit(10)

      if (!vips?.length) {
        await sendWA(fromPhone, '🏆 *RANKING VIP*\n\n⚠️ No hay clientes registrados con puntos actualmente.')
        break
      }

      let msg = '🏆 *RANKING TOP 10 VIP*\n'
      msg += '═════════════════════════\n\n'
      vips.forEach((v: any, i: number) => {
        const icon = v.es_vip ? '⭐' : '👤'
        const ranking = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `*#${i + 1}*`
        msg += `${ranking} ${icon} *${v.nombre?.toUpperCase() || 'SIN NOMBRE'}*\n`
        msg += `   🌟 ${v.puntos} pts | 📱 \`${extract10Digits(v.telefono)}\`\n\n`
      })
      msg += '═════════════════════════\n'
      msg += '💡 _Tip: Para buscar a alguien específico usa: "Resumen de [Teléfono]"_'
      await sendWA(fromPhone, msg)
      break
    }
    case 'SUMAR_PUNTOS': {
      const tel10 = extract10Digits(d.clienteTel)
      const { data: c } = await supabase.from('clientes').select('id, puntos, acepta_terminos, nombre, rango, es_vip').eq('telefono', tel10).limit(1).maybeSingle()

      if (c) {
        if (c.acepta_terminos === false) {
          // No ha aceptado términos: Enviar plantilla de términos primero
          await sendWATemplate(`52${tel10}`, 'estrella_terminos_condiciones', [c.nombre || 'Cliente'])
          await sendWA(fromPhone, `⏳ El cliente *${tel10}* aún no acepta los términos y condiciones.\nLe he enviado la solicitud de aceptación. Los puntos se sumarán automáticamente cuando acepte.`)

          // Guardar en memoria que hay una suma pendiente
          await supabase.from('bot_memory').upsert({
            phone: `pending_pts_${tel10}`,
            history: [{ puntos: d.puntosASumar, admin: fromPhone }],
            updated_at: new Date().toISOString()
          })
          return new Response('OK', { status: 200 })
        }

        const cant = Number(d.puntosASumar) || 1
        let lastRes: any = null
        let rpcError: any = null
        // BUGFIX: Rastrear si se activó el ascenso VIP.
        let vipAscendidoEnAlgunaIter = false

        const { data, error } = await supabase.rpc('fn_registrar_entrega_bulk', {
          p_cliente_tel: tel10,
          p_cantidad: cant
        })

        if (error) { rpcError = error; console.error(`[SUMAR_PUNTOS] RPC error bulk:`, error) }
        else if (data?.ok) {
          lastRes = data
          if (data.recien_ascendido) vipAscendidoEnAlgunaIter = true
        }
        else { console.warn(`[SUMAR_PUNTOS] RPC bulk retornó ok=false:`, data) }

        if (!lastRes) {
          const errMsg = rpcError?.message || 'La función retornó ok=false'
          console.error(`[SUMAR_PUNTOS] RPC falló: ${errMsg}`)
          await sendWA(fromPhone, `❌ No pude sumar los puntos a *${c.nombre || tel10}*.\nError interno: ${errMsg}`)
          await limpiarMemoria(supabase, fromPhone)
          return new Response('OK', { status: 200 })
        }

        // El RPC fn_registrar_entrega ya actualiza clientes.puntos atómicamente.
        // NO hacemos update manual aquí para evitar race conditions.

        
        try {
        } catch (e) {
          console.error('[CW Sync] Error post-sumar:', e)
        }

        const saldoInfo = lastRes.saldo_billetera > 0 ? `\n💳 Saldo en billetera: *$${lastRes.saldo_billetera}*` : ''
        let promoAviso = ''
        const meta = getMetaPuntos(c.rango, c.es_vip)
        const enviosGratisPorPuntos = Math.floor(lastRes.puntos / meta)
        if (enviosGratisPorPuntos > 0) {
          promoAviso += `\n\n🎉 *¡TIENE ${enviosGratisPorPuntos} ENVÍO(S) GRATIS DISPONIBLE(S)!* 🎉\n(Gracias a sus puntos acumulados).`
        }
        if (vipAscendidoEnAlgunaIter) {
          promoAviso += `\n\n👑 *¡NUEVO VIP!* 👑\nEl cliente completó 3 ciclos (15 envíos) y ahora es VIP.`
          // Notificar al CLIENTE que ahora es VIP (texto libre, funciona si hay ventana 24h)
          try {
            await sendWA(`52${tel10}`, `👑 *¡Felicidades, ${c.nombre || 'Cliente'}!* 👑\n\nHas sido promovido a *Cliente VIP* ⭐ de Estrella Delivery.\n\nA partir de ahora, por cada envío que pidas acumularás *saldo real en pesos* en tu billetera digital. 💰\n\n¡Gracias por tu gran lealtad! 🌟`)
          } catch (e) {
            console.error('[SUMAR_PUNTOS] Error enviando bienvenida VIP al cliente:', e)
          }
        }

        await sendWA(fromPhone, `🌟 Sumados *${cant} pts* a ${c.nombre || tel10}.\nTotal: *${lastRes.puntos} pts* ✅${saldoInfo}${promoAviso}`)
        const ptsResult = await sendWATemplate(
          `52${tel10}`,
          'estrella_puntos_acumulados',
          [c.nombre || 'Cliente', cant.toString(), lastRes.puntos.toString()],
          undefined, tel10
        )
        if (ptsResult?.ok === false) {
          console.error(`[SUMAR_PUNTOS] Template error:`, ptsResult.error)
          await sendWA(fromPhone, `⚠️ Los puntos se sumaron correctamente, pero Meta rechazó el envío de la plantilla al cliente.\n\n*Error de Meta:*\n_${ptsResult.error}_`)
        }
      } else {
        // Cliente no encontrado: ofrecer registrarlo en loyalty
        await sendWA(fromPhone,
          `❌ El número *${tel10}* no está registrado en el sistema.\n\n¿Deseas registrarlo ahora?\n\n📝 Escribe su *nombre completo* para iniciar el registro, o escribe *cancelar* para salir.`
        )
        // Guardar estado de wizard para el siguiente paso
        const adminFrom10 = extract10Digits(fromPhone)
        await supabase.from('bot_memory').upsert({
          phone: `admin_action_state_${adminFrom10}`,
          history: [{ action: 'LOYALTY_STEP_NOMBRE', tel: tel10 }],
          updated_at: new Date().toISOString()
        })
      }
      await limpiarMemoria(supabase, fromPhone)
      return new Response('OK', { status: 200 })
    }
    case 'ENVIAR_QR': {
      const tel10 = extract10Digits(d.clienteTel)
      const { data: cli } = await supabase.from('clientes').select('nombre, puntos, acepta_terminos').eq('telefono', tel10).limit(1).maybeSingle()

      if (cli && cli.acepta_terminos === false) {
        await sendWATemplate(`52${tel10}`, 'estrella_terminos_condiciones', [cli.nombre || 'Cliente'])
        await sendWA(fromPhone, `⏳ El cliente *${tel10}* aún no acepta los términos.\nLe he enviado la solicitud. El QR se enviará automáticamente cuando acepte.`)

        await supabase.from('bot_memory').upsert({
          phone: `pending_qr_${tel10}`,
          history: [{ admin: fromPhone }],
          updated_at: new Date().toISOString()
        })
        break
      }

      const nombreCli = cli?.nombre ? cli.nombre.split(' ')[0] : 'Cliente'
      const qrImageUrl = generateCloudinaryVIPCard(tel10, nombreCli, cli?.puntos || 0, 0, false)
      const { sendVIPCardSmart } = await import('./whatsapp.ts')
      const result = await sendVIPCardSmart(`52${tel10}`, qrImageUrl, cli?.nombre || 'Cliente', cli?.puntos || 0, tel10)

      if (result && result.ok === false) {
        console.error(`[ENVIAR_QR] Error enviando QR a ${tel10}:`, result.error)
        await sendWA(fromPhone, `❌ Error enviando QR al ${tel10}. Meta API lo rechazó.`)
      } else {
        await sendWA(fromPhone, `✅ QR enviado a *${tel10}* mediante plantilla segura.`)
      }
      break
    }
    case 'ENVIAR_TERMINOS': {
      const tel10 = extract10Digits(d.clienteTel)
      const { data: cli } = await supabase.from('clientes').select('nombre').eq('telefono', tel10).limit(1).maybeSingle()
      if (!cli) {
        await sendWA(fromPhone, `⚠️ El cliente *${tel10}* no está registrado.\nRegístralo primero con "Agregar cliente" antes de enviar los términos, de lo contrario la aceptación se perdería.`)
        break
      }
      const result = await sendWATemplate(`52${tel10}`, 'estrella_terminos_condiciones', [cli.nombre || 'Cliente'])
      if (result?.ok === false) {
        await sendWA(fromPhone, `❌ Error enviando términos a ${tel10}: ${result.error}`)
      } else {
        await sendWA(fromPhone, `✅ Términos y condiciones enviados a *${tel10}*.\n`)
      }
      break
    }
    case 'VER_PEDIDOS': {
      await sendWA(fromPhone, '❌ El sistema de pedidos está deshabilitado. Solo funciona Loyalty.');
      break
    }
    case 'BUSCAR_CLIENTE': {
      const tel10 = extract10Digits(d.clienteTel)
      const { data: c } = await supabase.from('clientes').select('*').eq('telefono', tel10).limit(1).maybeSingle()
      if (c) {
        const repIcon = c.reputacion === 'excelente' ? '🌟' : c.reputacion === 'bueno' ? '👍' : c.reputacion === 'malo' ? '⚠️' : '➖'
        let msg = `🔍 *FICHA DE CLIENTE*\n───────────────────\n`
        msg += `👤 *${c.nombre || 'Sin nombre'}*\n`
        msg += `📱 ${c.telefono}\n`
        msg += `⭐ Puntos: *${c.puntos}* | Rango: *${c.rango || 'bronce'}*\n`
        msg += `${c.es_vip ? '👑 *VIP*\n' : ''}`
        msg += `${repIcon} Reputación: *${c.reputacion || 'sin calificar'}*\n`
        msg += `🛵 Entregas: ${c.envios_totales || 0} | Envíos gratis: ${c.envios_gratis_disponibles || 0}\n`
        msg += `💰 Billetera: *$${c.saldo_billetera || 0}*\n`
        if (c.direccion) msg += `🏠 Dirección: ${c.direccion}\n`
        if (c.lat_frecuente && c.lng_frecuente) {
          msg += `📍 GPS: https://maps.google.com/?q=${c.lat_frecuente},${c.lng_frecuente}\n`
        }
        if (c.cupon_activo) msg += `🎟️ Cupón: ${c.cupon_activo}\n`
        if (c.notas_crm) msg += `📝 ${c.notas_crm.slice(0, 200)}\n`
        msg += `📋 T&C: ${c.acepta_terminos ? '✅ Aceptados' : '❌ Pendientes'}`

        const { sendInteractiveList } = await import('./whatsapp.ts')
        await sendInteractiveList(
          fromPhone,
          msg,
          'Editar Perfil',
          [
            {
              title: '📝 Opciones de Edición',
              rows: [
                { id: `EDIT_NOM_${tel10}`, title: '✏️ Cambiar Nombre' },
                { id: `EDIT_DIR_${tel10}`, title: '🏠 Cambiar Dirección' },
                { id: `EDIT_NOT_${tel10}`, title: '📝 Editar Notas CRM' },
                { id: `EDIT_SCO_${tel10}`, title: '⭐ Calificar' }
              ]
            }
          ]
        )

        // Enviar foto si existe
        if (c.foto_fachada_url) {
          const { enviarFotoCliente } = await import('./media-handler.ts')
          await enviarFotoCliente(fromPhone, c.foto_fachada_url, c.nombre || tel10)
        }

        // Guardar último cliente consultado (contexto para fotos)
        const admin10 = extract10Digits(fromPhone)
        await supabase.from('bot_memory').upsert({
          phone: `admin_last_client_${admin10}`,
          history: [{ clienteTel: tel10, nombre: c.nombre }],
          updated_at: new Date().toISOString()
        })
      } else { await sendWA(fromPhone, `🔍 No encontrado.`) }
      break
    }
    case 'VER_REPARTIDORES': {
      const { data: reps } = await supabase
        .from('repartidores')
        .select('nombre, alias, telefono')
        .eq('activo', true)
        .order('nombre')
        .limit(20)
      if (!reps?.length) {
        await sendWA(fromPhone, '🛵 *EQUIPO*\n\n⚠️ No hay personal activo registrado en este momento.')
        break
      }
      let msgRep = '🛵 *EQUIPO ACTIVO*\n'
      msgRep += '───────────────────\n\n'
      reps.forEach((r: any, i: number) => {
        const alias = r.alias ? ` (${r.alias})` : ''
        msgRep += `${i + 1}️⃣ *${r.nombre.toUpperCase()}*${alias}\n`
        msgRep += r.telefono ? `📱 \`52${extract10Digits(r.telefono)}\`\n` : '📱 _Sin teléfono_\n'
        msgRep += '\n'
      })
      msgRep += '───────────────────\n'
      msgRep += '_¿Deseas enviar un anuncio a todos? Escribe: "Anuncio: [mensaje]"_'
      await sendWA(fromPhone, msgRep)
      break
    }
    case 'AGREGAR_CLIENTE': {
      const tel10 = extract10Digits(d.clienteTel)
      if (!tel10 || tel10.length < 10) {
        await sendWA(fromPhone, '⚠️ El número de teléfono es inválido o no tiene 10 dígitos.')
        break
      }

      // 1. Verificar si ya existe
      // URL canónica que identifica al cliente en la Web y se almacena en DB
      const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${tel10}`
      const { data: existente } = await supabase.from('clientes').select('id, nombre, acepta_terminos').eq('telefono', tel10).limit(1).maybeSingle()

      let clientId = existente?.id
      let yaAceptoTerminos = existente?.acepta_terminos === true

      if (existente) {
        await sendWA(fromPhone, `ℹ️ El cliente *${existente.nombre}* ya estaba registrado. Actualizando datos...`)
        await supabase.from('clientes').update({
          nombre: d.clienteNombre || existente.nombre,
          direccion: d.colonia || undefined,
          qr_code: loyaltyUrl
        }).eq('id', existente.id)
      } else {
        // 2. Crear nuevo cliente con acepta_terminos = false
        const { data: nuevo, error } = await supabase.from('clientes').insert({
          nombre: d.clienteNombre || 'Cliente Nuevo',
          telefono: tel10,
          direccion: d.colonia || null,
          puntos: 0,
          acepta_terminos: false,
          qr_code: loyaltyUrl
        }).select().maybeSingle()

        if (error) {
          await sendWA(fromPhone, `❌ Error al crear cliente: ${error.message}`)
          break
        }
        clientId = nuevo.id
        yaAceptoTerminos = false
      }

      // 3. Si ya aceptó T&C → enviar QR directo y sumar puntos
      if (yaAceptoTerminos) {
        const qrImageUrl = generateCloudinaryVIPCard(tel10, d.clienteNombre || 'Cliente', d.puntosASumar || 0, d.saldoBilletera || 0, d.esVip || false)
        const result = await sendWATemplate(
          `52${tel10}`, 'estrella_loyalty_welcome',
          [d.clienteNombre || 'Cliente', d.puntosASumar > 0 ? d.puntosASumar.toString() : '¡Empieza hoy!'],
          qrImageUrl, tel10
        )
        if (result?.ok === false) {
          await sendWA(fromPhone, `✅ *Cliente Registrado: ${d.clienteNombre}*\n📱 ${tel10}\n\n⚠️ Error enviando QR: ${result.error}`)
        } else {
          await sendWA(fromPhone, `✅ *Cliente Registrado: ${d.clienteNombre}*\n📱 ${tel10}\n\nQR de bienvenida enviado. ✅`)
        }
        if (d.puntosASumar > 0 && clientId) {
          const cant = Number(d.puntosASumar) || 1
          await supabase.rpc('fn_registrar_entrega_bulk', { p_cliente_tel: tel10, p_cantidad: cant })
        }
      } else {
        // 4. No ha aceptado T&C → Enviar T&C
        // Detectar si el cliente vino del flujo del bot (ventana de 24h activa)
        const { data: pendingReg } = await supabase.from('bot_memory')
          .select('phone').eq('phone', `pending_reg_${tel10}`).maybeSingle()
        const clienteVinoBotFlow = !!pendingReg

        if (clienteVinoBotFlow) {
          // ── Texto libre + botones interactivos (gratis, 24h window activa) ──
          const tycUrl = `https://www.app-estrella.shop/terminos`
          const tycTexto = `🌟 *¡Bienvenido a Estrella Delivery, ${d.clienteNombre || 'Cliente'}!* 🌟

Al registrarte:
✅ Acumulas puntos con cada entrega y al ser *cliente VIP* accedes a beneficios exclusivos.
📋 Puedes revisar los detalles aquí:
👉 ${tycUrl}`

          await sendWA(`52${tel10}`, tycTexto)
          await new Promise(r => setTimeout(r, 800))
          await sendInteractiveButtons(
            `52${tel10}`,
            `¿Aceptas los términos y condiciones?`,
            [
              { id: 'ACEPTAR_TERMINOS', title: '✅ Aceptar' },
              { id: 'RECHAZAR_TERMINOS', title: '❌ Rechazar' }
            ]
          )
          // Limpiar pending_reg ya que el cliente fue procesado
          await supabase.from('bot_memory').delete().eq('phone', `pending_reg_${tel10}`)
          await sendWA(fromPhone, `✅ *Cliente Registrado: ${d.clienteNombre}*\n📱 ${tel10}\n\n📋 T&C enviados. ⏳ Cuando acepte, recibirá su QR automáticamente.`)
        } else {
          // ── Plantilla Meta (necesaria cuando no hay ventana de conversación) ──
          const tycResult = await sendWATemplate(`52${tel10}`, 'estrella_terminos_condiciones', [d.clienteNombre || 'Cliente'])
          if (tycResult?.ok === false) {
            console.error(`[AGREGAR_CLIENTE] Error enviando T&C a ${tel10}:`, tycResult.error)
            await sendWA(fromPhone, `✅ *Cliente Registrado: ${d.clienteNombre}*\n📱 ${tel10}\n\n⚠️ No pude enviar los T&C. Envíalos manualmente: "envía términos a ${tel10}"`)
          } else {
            await sendWA(fromPhone, `✅ *Cliente Registrado: ${d.clienteNombre}*\n📱 ${tel10}\n\n📋 Se enviaron los *Términos y Condiciones* (plantilla Meta).\n⏳ Cuando acepte, se le enviará su QR y puntos automáticamente.`)
          }
        }

        // 5. Guardar QR como pendiente → handleTerminos lo envía al aceptar
        await supabase.from('bot_memory').upsert({
          phone: `pending_qr_${tel10}`,
          history: [{ admin: fromPhone }],
          updated_at: new Date().toISOString()
        })

        // 6. Si hay puntos, guardarlos como pendientes
        if (d.puntosASumar > 0 && clientId) {
          const cant = Number(d.puntosASumar) || 1
          await supabase.from('bot_memory').upsert({
            phone: `pending_pts_${tel10}`,
            history: [{ puntos: cant, admin: fromPhone }],
            updated_at: new Date().toISOString()
          })
        }
      }

      await limpiarMemoria(supabase, fromPhone)
      return new Response('OK', { status: 200 })
    }
    case 'CANCELAR_PEDIDO': {
      await sendWA(fromPhone, `❌ Los pedidos están deshabilitados.`)
      break
    }
    case 'REASIGNAR_PEDIDO': {
      await sendWA(fromPhone, `❌ Los pedidos están deshabilitados.`)
      break
    }
    case 'AGREGAR_NOTA_CLIENTE': {
      const { data: cli } = await supabase.from('clientes').select('id, nombre').eq('telefono', extract10Digits(d.clienteTel)).limit(1).maybeSingle()
      if (cli) {
        // Concatenar notas en vez de sobreescribir para mantener historial
        const { data: cliNotas } = await supabase.from('clientes').select('notas_crm').eq('id', cli.id).maybeSingle()
        const notaExistente = cliNotas?.notas_crm || ''
        const fecha = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })
        const nuevaNota = notaExistente
          ? `${notaExistente}\n[${fecha}] ${d.descripcion}`
          : `[${fecha}] ${d.descripcion}`
        await supabase.from('clientes').update({ notas_crm: nuevaNota }).eq('id', cli.id)
        await sendWA(fromPhone, `📝 *Nota a ${cli.nombre || d.clienteTel}*\n✅ Anotado.`)
      } else { await sendWA(fromPhone, `🔍 No encontrado.`) }
      break
    }
    case 'MARCAR_VIP': {
      const tel10Vip = extract10Digits(d.clienteTel)
      const { data: cli } = await supabase.from('clientes').select('id, nombre, es_vip, telefono').eq('telefono', tel10Vip).limit(1).maybeSingle()
      if (cli) {
        const nuevoEstado = !cli.es_vip
        await supabase.from('clientes').update({
          es_vip: nuevoEstado,
          // Si lo subimos a VIP, iniciar su ciclo VIP
          ...(nuevoEstado ? { entregas_ciclo: 0, ciclo_inicio_at: new Date().toISOString() } : {})
        }).eq('id', cli.id)

        if (nuevoEstado) {
          // Notificar al cliente que ahora es VIP
          try {
            await sendWA(`52${tel10Vip}`, `👑 *¡Felicidades, ${cli.nombre || 'Cliente'}!* 👑\n\nHas sido promovido a *Cliente VIP* ⭐ de Estrella Delivery.\n\nA partir de ahora, por cada envío que pidas acumularás *saldo real en pesos* en tu billetera digital. 💰\n\n¡Gracias por tu gran lealtad! 🌟`)
          } catch (e) {
            console.error('[MARCAR_VIP] Error enviando bienvenida VIP al cliente:', e)
          }
          await sendWA(fromPhone, `👑 *${cli.nombre || tel10Vip}* ahora es *VIP*. ✅\nSe le notificó por WhatsApp.`)
        } else {
          await sendWA(fromPhone, `⭐ *${cli.nombre || tel10Vip}* ya *no es VIP*.`)
        }
      } else { await sendWA(fromPhone, `🔍 No encontrado.`) }
      break
    }
    case 'CALIFICAR_CLIENTE': {
      const { handleCalificarCliente } = await import('./client-profile-handler.ts')
      await handleCalificarCliente(supabase, fromPhone, d.clienteTel, d.descripcion || '')
      break
    }
    case 'GESTIONAR_COLONIAS': {
      const coloniaNombre = d.colonia?.trim()
      const nuevoPrecio = d.precioRuta ? Number(d.precioRuta) : null

      if (!coloniaNombre) {
        await sendWA(fromPhone, `⚠️ Faltan datos. Necesito el nombre de la colonia.`)
        break
      }

      // Reemplazar vocales con comodín _ para ignorar acentos de forma casera en ILIKE
      const safeNombre = coloniaNombre.replace(/[aeiouáéíóú]/gi, '_')

      // Buscar colonia (insensible a mayúsculas/minúsculas y acentos básicos)
      const { data: cols } = await supabase.from('colonias')
        .select('id, nombre, precio')
        .ilike('nombre', `%${safeNombre}%`)
        .limit(3)

      // Saber cuántas faltan
      const { count: sinPrecio } = await supabase.from('colonias').select('*', { count: 'exact', head: true }).is('precio', null)
      const faltanText = `\n\n📌 *Faltan ${sinPrecio} colonias por cotizar.*`

      if (!cols || cols.length === 0) {
        // La colonia no existe en absoluto
        if (nuevoPrecio) {
          const payload = `ADMIN_ADDCOL_${coloniaNombre.substring(0,40)}_${nuevoPrecio}`
          await sendInteractiveButtons(fromPhone, `⚠️ No encontré *${coloniaNombre}* en el sistema.\n\n¿Quieres que la agregue con el precio de *$${nuevoPrecio}*?`, [
            { id: payload.substring(0, 255), title: '✅ Sí, agregar' },
            { id: 'ADMIN_IGNORAR', title: '❌ Cancelar' }
          ])
        } else {
          await sendWA(fromPhone, `⚠️ No encontré *${coloniaNombre}* en el sistema.\n\nSi quieres agregarla, dime su precio. Ej: *"${coloniaNombre} 50"*`)
        }
        break
      }

      // Si hay más de una coincidencia, preguntarle cuál quiso decir
      if (cols.length > 1) {
        if (nuevoPrecio) {
          const botones = cols.map((c: any) => ({
            id: `ADMIN_SETCOL_${c.id}_${nuevoPrecio}`,
            title: c.nombre.substring(0, 20)
          }))
          
          const { sendInteractiveList } = await import('./whatsapp.ts')
          await sendInteractiveList(
            fromPhone,
            `🤔 Encontré varias colonias que coinciden con *${coloniaNombre}*.\n\n¿A cuál le quieres poner *$${nuevoPrecio}*?`,
            'Seleccionar colonia',
            [{ title: 'Coincidencias', rows: botones.map((b: any) => ({ id: b.id, title: b.title, description: `Guardar $${nuevoPrecio}` })) }]
          )
        } else {
          await sendWA(fromPhone, `🤔 Encontré varias colonias que coinciden con *${coloniaNombre}*:\n${cols.map((c: any) => `- ${c.nombre}`).join('\n')}\n\nPor favor sé un poco más específico.`)
        }
        break
      }

      // Si hay exactamente 1 coincidencia
      const col = cols[0]
      if (nuevoPrecio) {
        await supabase.from('colonias').update({ precio: nuevoPrecio }).eq('id', col.id)
        await sendWA(fromPhone, `✅ *Precio actualizado*\n\n📍 Colonia: *${col.nombre}*\n💰 Nuevo Precio: *$${nuevoPrecio}*${faltanText}`)
      } else {
        const precioText = col.precio ? `$${col.precio}` : `*SIN PRECIO ASIGNADO*`
        await sendWA(fromPhone, `📍 *Colonia:* ${col.nombre}\n💰 *Precio actual:* ${precioText}\n\nPara actualizarlo dime: *"${col.nombre} 45"*${faltanText}`)
      }
      break
    }
    case 'ACTUALIZAR_DIRECCION': {
      const { handleActualizarDireccion } = await import('./client-profile-handler.ts')
      await handleActualizarDireccion(supabase, fromPhone, d.clienteTel, d.descripcion || (d as any).direccion || '')
      break
    }
    case 'VER_HISTORIAL_CLIENTE': {
      const { data: hist } = await supabase.from('pedidos').select('descripcion, estado, created_at')
        .eq('cliente_tel', extract10Digits(d.clienteTel)).order('created_at', { ascending: false }).limit(7)
      let msg = `📄 *HISTORIAL*\n\n`
      hist?.forEach((h: any) => msg += `- [${h.estado}] ${h.descripcion?.slice(0, 40)}\n`)
      await sendWA(fromPhone, hist?.length ? msg : 'Sin pedidos.')
      break
    }
    case 'RECORDATORIO_REPARTIDOR': {
      const rep = await buscarRepartidor(supabase, d.repartidorAlias)
      if (rep?.telefono) {
        await sendWA(`52${extract10Digits(rep.telefono)}`, `📩 *Central:*\n_${d.descripcion}_`)
        await sendWA(fromPhone, `✅ Enviado a *${rep.nombre}*.`)
      } else { await sendWA(fromPhone, `⚠️ Repartidor no hallado.`) }
      break
    }
    case 'REVISAR_ENTREGADOS': {
      await sendWA(fromPhone, `❌ Los pedidos están deshabilitados.`)
      break
    }
    case 'ENTREGAR_TODOS': {
      await sendWA(fromPhone, `❌ Los pedidos están deshabilitados.`)
      break
    }
    case 'CANCELAR_TODOS': {
      await sendWA(fromPhone, `❌ Los pedidos están deshabilitados.`)
      break
    }
    case 'ESTADISTICAS': {
      const { count: totalClientes } = await supabase.from('clientes').select('*', { count: 'exact', head: true })
      const { count: totalVIP } = await supabase.from('clientes').select('*', { count: 'exact', head: true }).eq('es_vip', true)
      const { count: totalRestaurantes } = await supabase.from('restaurantes').select('*', { count: 'exact', head: true })
      const { count: totalRepartidores } = await supabase.from('repartidores').select('*', { count: 'exact', head: true })

      const msg = `📊 *Resumen de Estadísticas*\n\n`
        + `Hola, aquí tienes las métricas actuales del sistema Estrella:\n\n`
        + `👥 *Clientes:* ${totalClientes || 0}\n`
        + `⭐ *VIPs:* ${totalVIP || 0}\n`
        + `🍔 *Restaurantes:* ${totalRestaurantes || 0}\n`
        + `🛵 *Flotilla:* ${totalRepartidores || 0}\n\n`
        + `¿Qué detalle te gustaría revisar? 👇`

      await sendInteractiveButtons(fromPhone, msg, [
        { id: 'EST_VER_VIPS', title: '⭐ VIPs' },
        { id: 'EST_VER_REST', title: '🍔 Restaurantes' },
        { id: 'EST_VER_REPS', title: '🛵 Repartidores' }
      ])
      break
    }
    case 'REPORTE_SEMANAL': {
      await sendWA(fromPhone, `❌ Reportes de pedidos deshabilitados.`)
      break
    }
    case 'AGREGAR_REPARTIDOR': {
      const nombre = d?.clienteNombre ? String(d.clienteNombre).trim() : null
      if (!nombre) {
        await sendWA(fromPhone, `🛵 Para agregar personal necesito el *nombre completo*.\n\nEjemplo: _"Agregar a Juan González, tel 5541234567"_`)
        break
      }
      const tel = d.clienteTel ? extract10Digits(String(d.clienteTel)) : null
      const alias = d.repartidorAlias ? String(d.repartidorAlias).trim() : null
      const { error: insErr } = await supabase.from('repartidores').insert({
        nombre,
        telefono: tel || null,
        alias: alias || null,
        activo: true,
      })
      if (insErr) {
        await sendWA(fromPhone, `❌ Error al registrar: ${insErr.message}`)
      } else {
        const telInfo = tel ? `\n📱 Tel: *${tel}*` : '\n⚠️ Sin teléfono — puedes agregarlo luego desde Herramientas en la app.'
        await sendWA(fromPhone, `🛵✨ *Repartidor Registrado*\n👤 Nombre: *${nombre}*${telInfo}\n\nYa está activo para recibir pedidos.`)
      }
      break
    }
    case 'ELIMINAR_REPARTIDOR': {
      let q = supabase.from('repartidores').select('id, nombre').eq('activo', true)
      if (d?.repartidorAlias) q = q.or(`alias.ilike.%${d.repartidorAlias}%,nombre.ilike.%${d.repartidorAlias}%`) as any
      else if (d?.clienteTel) q = q.eq('telefono', extract10Digits(d.clienteTel)) as any
      const { data: rep } = await q.order('creado_en', { ascending: false }).limit(1).maybeSingle() as any
      if (rep) {
        await supabase.from('repartidores').update({ activo: false }).eq('id', rep.id)
        await sendWA(fromPhone, `🛵❌ *Desactivado*\nAl repartidor *${rep.nombre}*`)
      } else { await sendWA(fromPhone, `⚠️ No encontré a ese repartidor activo.`) }
      break
    }
    case 'CARGAR_SALDO': {
      const tel10 = extract10Digits(d.clienteTel)
      const monto = parseFloat(String(d.montoSaldo)) || 0
      if (monto <= 0) { await sendWA(fromPhone, `⚠️ Monto inválido.`); break }

      // Incremento ATÓMICO: evita race condition si dos admins cargan saldo al mismo tiempo.
      // La función suma directamente en la DB: saldo_billetera = saldo_billetera + p_monto
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('increment_cliente_saldo', {
        p_tel: tel10,
        p_monto: monto
      })

      if (rpcErr || !rpcRes?.ok) {
        // Fallback: si el RPC no existe aún, usar el update directo con aviso
        console.warn('[CARGAR_SALDO] RPC atómico falló, usando fallback:', rpcErr?.message || rpcRes?.error)
        const { data: cli } = await supabase.from('clientes').select('id, nombre, saldo_billetera').eq('telefono', tel10).limit(1).maybeSingle()
        if (cli) {
          const ns = (parseFloat(String(cli.saldo_billetera)) || 0) + monto
          await supabase.from('clientes').update({ saldo_billetera: ns }).eq('id', cli.id)
          await supabase.from('registros_puntos').insert({ cliente_id: cli.id, tipo: 'acumulacion', puntos: 0, monto_saldo: monto, descripcion: `Ajuste admin: $${monto}` })
          await sendWA(fromPhone, `💲 *Billetera*\nCargado $${monto} al cliente ${cli.nombre || tel10}.\nSaldo final: *$${ns}*`)
        } else { await sendWA(fromPhone, `🔍 No encontrado.`) }
      } else {
        await supabase.from('registros_puntos').insert({ cliente_id: rpcRes.cliente_id, tipo: 'acumulacion', puntos: 0, monto_saldo: monto, descripcion: `Ajuste admin: $${monto}` })
        await sendWA(fromPhone, `💲 *Billetera*\nCargado $${monto} al cliente ${rpcRes.nombre || tel10}.\nSaldo final: *$${rpcRes.nuevo_saldo}*`)
      }
      break
    }
    case 'VER_ATRASOS': {
      await sendWA(fromPhone, `❌ Los pedidos están deshabilitados.`)
      break
    }
    case 'ESTADO_REPARTIDOR': {
      await sendWA(fromPhone, `❌ Los pedidos están deshabilitados.`)
      break
    }
    case 'UBICACION_RESTAURANTE': {
      const { data: res } = await supabase.from('restaurantes').select('nombre, lat, lng, direccion').or(`nombre.ilike.%${d.restaurante}%,direccion.ilike.%${d.restaurante}%`).order('lat', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
      if (res?.lat && res?.lng) await sendWALocation(fromPhone, Number(res.lat), Number(res.lng), res.nombre, res.direccion || 'Ubicación')
      else if (res) await sendWA(fromPhone, `Ubicación de *${res.nombre}* no registrada (Dirección txt: ${res.direccion || 'N/A'})`)
      else await sendWA(fromPhone, `🔍 No encontré el restaurante.`)
      break
    }
    case 'ANUNCIO_REPARTIDORES': {
      const { data: ra } = await supabase.from('repartidores').select('telefono').eq('activo', true).not('telefono', 'is', null)
      if (ra?.length) {
        let sent = 0
        for (const r of ra) {
          await sendWA(`52${extract10Digits(r.telefono)}`, `📢 *ANUNCIO DE BASE*\n\n${d.descripcion}`)
          await new Promise(res => setTimeout(res, 350)) // throttle para no saturar Meta API
          sent++
        }
        await sendWA(fromPhone, `✅ Radiado a *${sent}* miembros activos.`)
      } else { await sendWA(fromPhone, `⚠️ Ningún repartidor con tel válido.`) }
      break
    }
    case 'CREAR_PEDIDO': {
      // DESHABILITADO: El proyecto actualmente solo maneja el programa de lealtad (Loyalty).
      // Los pedidos se toman manualmente a través del número 963 153 9156.
      await sendWA(fromPhone, `❌ La recepción de pedidos por bot está deshabilitada. Atiende los pedidos manualmente.`)
      return new Response('OK', { status: 200 })
      /*
      const result = await crearPedidoDesdeBot(supabase, d, undefined, undefined, messageId)
      if (result.ok && result.pedidoId) {
        await limpiarMemoria(supabase, fromPhone)
        await sendWA(fromPhone, `✅ *Pedido Asignado*\n${mensajeUsuario}\n\n📦 *Detalle:* ${d.descripcion}\n🔗 ${pedidoLink(result.pedidoId)}`)
      } else { await sendWA(fromPhone, `❌ Error: ${result.error}`) }
      return new Response('OK', { status: 200 })
      */
    }
    case 'USAR_CUPON': {
      const code = String(d.codigoCupon).trim().toUpperCase()
      const { data, error } = await supabase.rpc('usar_cupon', { p_codigo: code })

      if (error) {
        await sendWA(fromPhone, `❌ *Error al usar cupón:*\n${error.message}`)
      } else if (data?.ok) {
        await sendWA(fromPhone, `✅ *CUPÓN APLICADO*\n🎟️ Código: *${code}*\n👤 Cliente: ${data.cliente_nombre || 'Desconocido'}\n📱 Tel: ${data.cliente_tel || '-'}\n\nEl cupón ha sido marcado como usado exitosamente.`)
      } else {
        await sendWA(fromPhone, `⚠️ *Cupón no válido:*\n${data?.error || 'No se pudo aplicar el cupón.'}`)
      }
      break
    }
    case 'CANCELAR_CUPON': {
      const code = String(d.codigoCupon).trim().toUpperCase()
      const { data: admin } = await supabase.from('admins').select('id').eq('telefono', extract10Digits(fromPhone)).maybeSingle()

      const { data, error } = await supabase.rpc('cancelar_cupon', {
        p_codigo: code,
        p_admin_id: admin?.id || null
      })

      if (error) {
        await sendWA(fromPhone, `❌ *Error al cancelar cupón:*\n${error.message}`)
      } else if (data?.ok) {
        await sendWA(fromPhone, `🚫 *CUPÓN CANCELADO*\n🎟️ Código: *${code}*\n👤 Cliente: ${data.cliente_nombre}\n💰 Reembolsado: *$${data.monto_reembolsado}*\n\nEl saldo ha sido devuelto a la billetera del cliente.`)
      } else {
        await sendWA(fromPhone, `⚠️ *No se pudo cancelar:*\n${data?.error || 'Error desconocido.'}`)
      }
      break
    }
  }

  await guardarMemoria(supabase, fromPhone, chat.nuevoHistorial || [])
  return new Response('OK', { status: 200 })
}

// ─── Buró de Clientes: Procesar botones de calificación ───────────────────────
export async function handleCalificacion(supabase: Supa, fromPhone: string, buttonId: string): Promise<Response> {
  // Formatos de buttonId:
  //   RATE_EXC_9631234567  → reputacion = 'excelente'
  //   RATE_BUE_9631234567  → reputacion = 'bueno'
  //   RATE_PRB_9631234567  → Pedir segunda ronda de etiquetas
  //   TAG_DEMORA_9631234567, TAG_GROSERO_9631234567, etc. → añadir etiqueta
  //   VETAR_9631234567     → reputacion = 'vetado'

  const parts = buttonId.split('_')
  const tel10 = parts[parts.length - 1]  // Último segmento siempre es el teléfono

  if (!tel10 || tel10.length < 10) {
    await sendWA(fromPhone, `⚠️ No pude identificar el número del cliente del botón.`)
    return new Response('OK', { status: 200 })
  }

  // Buscar cliente
  const { data: cli } = await supabase.from('clientes').select('id, nombre, etiquetas, reputacion').eq('telefono', tel10).limit(1).maybeSingle()
  const clienteId = cli?.id
  const clienteNombre = cli?.nombre || `Cliente ${tel10}`
  const etiquetasActuales: string[] = cli?.etiquetas || []

  // ── RATE: Calificación general ──
  if (buttonId.startsWith('RATE_EXC_')) {
    if (clienteId) {
      await supabase.from('clientes').update({ reputacion: 'excelente' }).eq('id', clienteId)
    } else {
      await supabase.from('clientes').upsert({ telefono: tel10, nombre: clienteNombre, reputacion: 'excelente', puntos: 0 }, { onConflict: 'telefono' })
    }
    // Borrar calificación pendiente si existe
    await supabase.from('calificaciones_pendientes').delete().eq('cliente_tel', tel10)
    await sendWA(fromPhone, `⭐ *${clienteNombre}* → Reputación: *Excelente*\n¡Registrado!`)
    return new Response('OK', { status: 200 })
  }

  if (buttonId.startsWith('RATE_BUE_')) {
    if (clienteId) {
      await supabase.from('clientes').update({ reputacion: 'bueno' }).eq('id', clienteId)
    } else {
      await supabase.from('clientes').upsert({ telefono: tel10, nombre: clienteNombre, reputacion: 'bueno', puntos: 0 }, { onConflict: 'telefono' })
    }
    await supabase.from('calificaciones_pendientes').delete().eq('cliente_tel', tel10)
    await sendWA(fromPhone, `👍 *${clienteNombre}* → Reputación: *Bueno*\n¡Registrado!`)
    return new Response('OK', { status: 200 })
  }

  if (buttonId.startsWith('RATE_PRB_')) {
    // Segunda ronda: enviar botones de etiquetas (máx 3 por mensaje, enviamos 2 mensajes)
    const { sendInteractiveButtons } = await import('./whatsapp.ts')
    await sendInteractiveButtons(fromPhone,
      `¿Qué pasó con *${clienteNombre}*?\nElige la etiqueta que mejor describe el problema:`,
      [
        { id: `TAG_DEMORA_${tel10}`, title: '⏱️ Tardó mucho' },
        { id: `TAG_GROSERO_${tel10}`, title: '😤 Fue grosero' },
        { id: `TAG_NOATIENDE_${tel10}`, title: '📵 No contestó' },
      ]
    )
    await sendInteractiveButtons(fromPhone,
      `Más opciones:`,
      [
        { id: `TAG_DIRMAL_${tel10}`, title: '🏠 Dirección mal' },
        { id: `TAG_PEDFALSO_${tel10}`, title: '🚫 Pedido falso' },
        { id: `VETAR_${tel10}`, title: '🔴 Vetar cliente' },
      ]
    )
    return new Response('OK', { status: 200 })
  }

  // ── TAG: Etiquetas específicas ──
  const TAG_MAP: Record<string, { etiqueta: string; reputacion: string; emoji: string }> = {
    'TAG_DEMORA': { etiqueta: 'demora', reputacion: 'regular', emoji: '⏱️' },
    'TAG_GROSERO': { etiqueta: 'grosero', reputacion: 'malo', emoji: '😤' },
    'TAG_NOATIENDE': { etiqueta: 'no_atiende', reputacion: 'regular', emoji: '📵' },
    'TAG_DIRMAL': { etiqueta: 'direccion_mal', reputacion: 'regular', emoji: '🏠' },
    'TAG_PEDFALSO': { etiqueta: 'pedido_falso', reputacion: 'malo', emoji: '🚫' },
  }

  const tagPrefix = Object.keys(TAG_MAP).find(k => buttonId.startsWith(k + '_'))
  if (tagPrefix) {
    const { etiqueta, reputacion, emoji } = TAG_MAP[tagPrefix]
    const nuevasEtiquetas = [...new Set([...etiquetasActuales, etiqueta])]
    if (clienteId) {
      await supabase.from('clientes').update({ reputacion, etiquetas: nuevasEtiquetas }).eq('id', clienteId)
    } else {
      await supabase.from('clientes').upsert({ telefono: tel10, nombre: clienteNombre, reputacion, etiquetas: nuevasEtiquetas, puntos: 0 }, { onConflict: 'telefono' })
    }

    await supabase.from('calificaciones_pendientes').delete().eq('cliente_tel', tel10)
    await sendWA(fromPhone, `${emoji} *${clienteNombre}* → Reputación: *${reputacion}*\nEtiqueta añadida: *${etiqueta}*\n🏷️ Historial: ${nuevasEtiquetas.join(', ')}`)
    return new Response('OK', { status: 200 })
  }

  // ── VETAR ──
  if (buttonId.startsWith('VETAR_')) {
    const nuevasEtiquetas = [...new Set([...etiquetasActuales, 'vetado'])]
    if (clienteId) {
      await supabase.from('clientes').update({ reputacion: 'vetado', etiquetas: nuevasEtiquetas }).eq('id', clienteId)
    } else {
      await supabase.from('clientes').upsert({ telefono: tel10, nombre: clienteNombre, reputacion: 'vetado', etiquetas: nuevasEtiquetas, puntos: 0 }, { onConflict: 'telefono' })
    }

    await supabase.from('calificaciones_pendientes').delete().eq('cliente_tel', tel10)
    await sendWA(fromPhone, `🔴 *${clienteNombre}* → *VETADO*\nEste cliente ya no recibirá servicio. Los restaurantes serán alertados automáticamente.`)
    return new Response('OK', { status: 200 })
  }

  return new Response('OK', { status: 200 })
}

// ─── Términos y Condiciones: Procesar aceptación ──────────────────────────────
export async function handleTerminos(supabase: Supa, fromPhone: string, buttonId: string): Promise<Response> {
  const tel10 = extract10Digits(fromPhone)
  const upId = buttonId.toUpperCase()

  if (upId === 'ACEPTAR_TERMINOS' || upId === 'ACEPTAR') {
    // 1. Marcar en DB
    console.log(`✅ [T&C] Cliente ${tel10} HA ACEPTADO los términos.`)
    await supabase.from('clientes').update({ acepta_terminos: true }).eq('telefono', tel10)

    // 2. Enviar QR y mensaje de Bienvenida incondicional
    const { data: cli } = await supabase.from('clientes').select('nombre, puntos, saldo_billetera, es_vip').eq('telefono', tel10).limit(1).maybeSingle()
    const nombreCli = cli?.nombre ? cli.nombre.split(' ')[0] : 'Cliente'
    const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${tel10}`
    const qrImageUrl = generateCloudinaryVIPCard(tel10, nombreCli, cli?.puntos || 0, cli?.saldo_billetera || 0, cli?.es_vip || false)

    const mensajeBienvenida = `🎉 *¡Excelente, ${nombreCli}! Bienvenido a la familia Estrella* 🎉

Tu registro está 100% completado. Aquí tienes tu *Tarjeta de Lealtad Digital* (QR). 🎟️

Guárdala muy bien en tus favoritos. Con ella irás acumulando recompensas en cada pedido que hagas. 🍔🍣

🌐 *Revisa tu perfil y beneficios aquí:*
👉 ${loyaltyUrl}

¡Gracias por preferir Estrella Delivery! 🛵💨`

    await sendWAImage(`52${tel10}`, qrImageUrl, mensajeBienvenida)
    

    // Notificar al admin si había un pendiente de admin en cache
    const { data: pendingQR } = await supabase.from('bot_memory').select('history').eq('phone', `pending_qr_${tel10}`).maybeSingle()
    if (pendingQR?.history?.[0]?.admin) {
      await sendWA(pendingQR.history[0].admin, `✅ El cliente *${tel10}* aceptó términos. Le envié su QR y mensaje de bienvenida.`)
    }
    // Siempre intentamos limpiarlo por si había uno
    await supabase.from('bot_memory').delete().eq('phone', `pending_qr_${tel10}`)

    // 3.B Puntos Pendientes
    const { data: pendingPts } = await supabase.from('bot_memory').select('history').eq('phone', `pending_pts_${tel10}`).maybeSingle()
    if (pendingPts?.history?.[0]) {
      console.log(`🔄 [T&C] Ejecutando SUMA DE PUNTOS PENDIENTE para ${tel10}...`)
      const { puntos, admin } = pendingPts.history[0]
      const { data: cli } = await supabase.from('clientes').select('id, nombre, puntos').eq('telefono', tel10).limit(1).maybeSingle()
      if (cli) {
        const cant = Number(puntos) || 1
        let lastRes: any = null
        let rpcErrTerminos: any = null
        let vipAscendidoEnAlgunaIter = false

        const { data, error } = await supabase.rpc('fn_registrar_entrega_bulk', {
          p_cliente_tel: tel10,
          p_cantidad: cant
        })

        if (error) { rpcErrTerminos = error }
        if (data?.ok) {
          lastRes = data
          if (data.recien_ascendido) vipAscendidoEnAlgunaIter = true
        }
        if (!lastRes) {
          console.error(`[T&C PUNTOS] RPC falló para ${tel10}:`, rpcErrTerminos?.message)
          if (admin) await sendWA(admin, `⚠️ El cliente *${tel10}* aceptó términos pero no pude sumar los ${puntos} pts pendientes.\nError: ${rpcErrTerminos?.message || 'RPC ok=false'}`)
        } else {
          // El RPC ya actualiza clientes.puntos atómicamente — no hacemos update manual
          await sendWATemplate(`52${tel10}`, 'estrella_puntos_acumulados', [cli.nombre || 'Cliente', puntos.toString(), lastRes.puntos.toString()], undefined, tel10)

          if (vipAscendidoEnAlgunaIter) {
            try {
              await sendWA(`52${tel10}`, `👑 *¡Felicidades, ${cli.nombre || 'Cliente'}!* 👑\n\nHas sido promovido a *Cliente VIP* ⭐ de Estrella Delivery.\n\nA partir de ahora, por cada envío que pidas acumularás *saldo real en pesos* en tu billetera digital. 💰\n\n¡Gracias por tu gran lealtad! 🌟`)
            } catch (e) {
              console.error('[T&C PUNTOS] Error enviando bienvenida VIP:', e)
            }
          }

          if (admin) await sendWA(admin, `✅ El cliente *${tel10}* aceptó términos. Le sumé los ${puntos} pts pendientes. Total: *${lastRes.puntos} pts*.`)
        }
      }
      await supabase.from('bot_memory').delete().eq('phone', `pending_pts_${tel10}`)
    }

    // 4. Notificar al admin principal (siempre, aunque no haya pendientes)
    const { data: cliAcep } = await supabase.from('clientes').select('nombre').eq('telefono', tel10).limit(1).maybeSingle()
    if (ADMIN_PHONE_MAIN) {
      await sendWA(ADMIN_PHONE_MAIN, `✅ *${cliAcep?.nombre || tel10}* (${tel10}) *aceptó* los términos y condiciones.`)
    }

    // 5. Notificar al Restaurante (si fue invitado por uno)
    const { data: pendingRestInvite } = await supabase.from('bot_memory').select('history').eq('phone', `pending_rest_invite_${tel10}`).maybeSingle()
    if (pendingRestInvite?.history?.[0]?.restPhone) {
      await sendWA(pendingRestInvite.history[0].restPhone, `✅ ¡Excelentes noticias! El cliente *${cliAcep?.nombre || tel10}* aceptó tu invitación VIP y ya está afiliado formalmente a tu local. 🎉`)
      await supabase.from('bot_memory').delete().eq('phone', `pending_rest_invite_${tel10}`)
    }

  } else if (upId === 'RECHAZAR_TERMINOS' || upId === 'RECHAZAR') {
    console.warn(`❌ [T&C] Cliente ${tel10} RECHAZÓ los términos.`)
    await sendWA(fromPhone, "Lamentablemente, para poder usar el sistema de lealtad y beneficios de Estrella Delivery, es necesario aceptar los términos y condiciones. Si cambias de opinión, puedes volver a intentarlo más tarde. ¡Saludos! 👋")
    // Notificar al admin
    if (ADMIN_PHONE_MAIN) {
      const { data: cliRec } = await supabase.from('clientes').select('nombre').eq('telefono', tel10).limit(1).maybeSingle()
      await sendWA(ADMIN_PHONE_MAIN, `❌ *${cliRec?.nombre || tel10}* (${tel10}) *rechazó* los términos y condiciones.`)
    }
  }

  return new Response('OK', { status: 200 })
}

export async function handleAdminCommands(supabase: Supa, fromPhone: string, buttonId: string): Promise<Response> {
  const { sendWA } = await import('./whatsapp.ts')

  // ── Parsear el comando y número de orden ──
  const isReasignar = buttonId.startsWith('CMD_REASIGNAR_')
  const isCancelar  = buttonId.startsWith('CMD_CANCELAR_')

  if (!isReasignar && !isCancelar) {
    await sendWA(fromPhone, '❌ Comando desconocido.')
    return new Response('OK', { status: 200 })
  }

  const prefix = isReasignar ? 'CMD_REASIGNAR_' : 'CMD_CANCELAR_'
  const pedidoId = buttonId.replace(prefix, '')

  // ── Buscar el pedido por número de orden ──
  const { data: pedido } = await supabase
    .from('pedidos')
    .select('id, estado, repartidor_id, descripcion, direccion, cliente_tel, cliente_nombre, wb_message_id')
    .eq('id', pedidoId)
    .maybeSingle()

  if (!pedido) {
    await sendWA(fromPhone, `❌ No encontré el pedido. Puede que ya fue procesado o eliminado.`)
    return new Response('OK', { status: 200 })
  }

  const ticketStr = pedido.wb_message_id || pedidoId.slice(0, 8)

  if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') {
    await sendWA(fromPhone, `⚠️ El pedido *#${ticketStr}* ya está en estado *${pedido.estado.toUpperCase()}*. No se puede modificar.`)
    return new Response('OK', { status: 200 })
  }

  // ── CMD: CANCELAR ──
  if (isCancelar) {
    const { error: updateError } = await supabase
      .from('pedidos')
      .update({ estado: 'cancelado' })
      .eq('id', pedido.id)

    if (updateError) {
      await sendWA(fromPhone, `❌ Error al cancelar el pedido *#${ticketStr}*.`)
      return new Response('OK', { status: 200 })
    }

    try {
      await supabase.from('pedido_logs').insert({
        pedido_id: pedido.id,
        accion: 'CANCELADO',
        detalles: 'Cancelado por admin vía alerta zombie en WhatsApp',
      })
    } catch (_) {}

    await sendWA(fromPhone, `✅ Pedido *#${ticketStr}* cancelado correctamente.`)

    // Notificar al cliente si tenemos su teléfono
    if (pedido.cliente_tel) {
      const tel = pedido.cliente_tel.replace(/\D/g, '').slice(-10)
      await sendWA(`52${tel}`, `😔 Hola ${pedido.cliente_nombre || 'cliente'}, lamentamos informarte que tu pedido *#${ticketStr}* fue cancelado. Puedes contactarnos para más información. ¡Disculpa los inconvenientes! 🙏`)
    }

    return new Response('OK', { status: 200 })
  }

  // ── CMD: REASIGNAR ──
  // Buscar repartidor activo con cuenta que no sea el actual, con menos pedidos activos
  const { data: repartidores } = await supabase
    .from('repartidores')
    .select('id, user_id, nombre, telefono')
    .eq('activo', true)
    .not('user_id', 'is', null)
    .neq('user_id', pedido.repartidor_id ?? '')

  if (!repartidores || repartidores.length === 0) {
    await sendWA(fromPhone, `⚠️ No hay otros repartidores disponibles en este momento para reasignar el pedido *#${ticketStr}*.\n\nPuedes cancelarlo respondiendo con *CMD_CANCELAR_${ticketStr}* o reasignarlo manualmente desde la app.`)
    return new Response('OK', { status: 200 })
  }

  // Elegir el repartidor con menos pedidos activos (menor carga)
  const { data: pedidosActivos } = await supabase
    .from('pedidos')
    .select('repartidor_id')
    .in('estado', ['asignado', 'en_camino', 'recogido'])

  const cargaPorRep: Record<string, number> = {}
  for (const rep of repartidores) {
    cargaPorRep[rep.user_id] = 0
  }
  for (const p of pedidosActivos ?? []) {
    if (p.repartidor_id && cargaPorRep[p.repartidor_id] !== undefined) {
      cargaPorRep[p.repartidor_id]++
    }
  }

  const repElegido = repartidores.sort((a, b) => (cargaPorRep[a.user_id] ?? 0) - (cargaPorRep[b.user_id] ?? 0))[0]

  // Actualizar el pedido
  await supabase
    .from('pedidos')
    .update({ repartidor_id: repElegido.user_id, estado: 'asignado' })
    .eq('id', pedido.id)

  try {
    await supabase.from('pedido_logs').insert({
      pedido_id: pedido.id,
      accion: 'REASIGNADO',
      detalles: `Reasignado a ${repElegido.nombre} vía alerta zombie en WhatsApp`,
    })
  } catch (_) {}

  await sendWA(fromPhone, `✅ Pedido *#${ticketStr}* reasignado a *${repElegido.nombre}* (${cargaPorRep[repElegido.user_id] ?? 0} pedidos activos).\n\n🛵 Se le notificará automáticamente.`)

  // Notificar al nuevo repartidor
  if (repElegido.telefono) {
    const tel = repElegido.telefono.replace(/\D/g, '').slice(-10)
    await sendWA(`52${tel}`, `🛵 *¡Pedido Reasignado!*\n\n📦 *#${ticketStr}*\n📝 ${pedido.descripcion || 'Sin descripción'}\n📍 ${pedido.direccion || 'Dirección no especificada'}\n\nEl admin te asignó este pedido. ¡Mucho éxito! 💪`)
  }

  return new Response('OK', { status: 200 })
}
