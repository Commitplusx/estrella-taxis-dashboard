import { sendWA, sendInteractiveList, sendInteractiveButton, sendWADocument } from './whatsapp.ts'
import { extract10Digits, crearPedidoDesdeBot } from './db.ts'
import { pedidoLink, logError, generateCloudinaryVIPCard } from '../_shared/utils.ts'

export async function handleSlashCommands(
  supabase: any,
  fromPhone: string,
  from10: string,
  slashText: string,
  messageId: string,
  esAdmin: boolean = true
): Promise<Response | null> {

  if (slashText.startsWith('/force_loyalty')) {
    if (!esAdmin) return null
    const { error } = await supabase.from('restaurantes').update({ programa_lealtad_activo: true }).neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) {
      await sendWA(fromPhone, `âŒ Error: ${error.message}`)
    } else {
      await sendWA(fromPhone, `âœ… Programa de lealtad activado para TODOS los restaurantes en la base de datos.`)
    }
    return new Response('OK', { status: 200 })
  }

  if (slashText.startsWith('/test_typing')) {
    if (!esAdmin) return null
    const token = Deno.env.get('WHATSAPP_TOKEN')
    const phoneId = Deno.env.get('WHATSAPP_PHONE_ID')
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: fromPhone,
          type: 'typing_indicator',
          typing_indicator: {
            type: 'text'
          }
        })
      })
      const text = await res.text()
      await sendWA(fromPhone, `ðŸ“¡ *Meta Typing Response:*\n\nHTTP ${res.status}\n${text}`)
    } catch (e: any) {
      await sendWA(fromPhone, `âŒ Error: ${e.message}`)
    }
    return new Response('OK', { status: 200 })
  }

  if (slashText.startsWith('/force_key')) {
    if (!esAdmin) return null
    const token = Deno.env.get('WHATSAPP_TOKEN')
    const phoneId = '1155044321029650'
    const publicKey = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtx6Q5hLj8g+mW5Lnv04/\ncNxckCQJFeXAj5AvUNrQwAq/3/PASv0ZUsNJbQcQ2DiomtH4kUPT6YFAx76IWFFf\nR49slxEd1+lIl6t/CmLeYrHXg8gNCrVNDeESWDy0w4Cz8RJGDmKd/qV2PCJdaPB3\nhaMqGNHRU6VxN5vFtxir7HL3Bkm+qyJftHmZQHml0CBclYYtx0V45FYjyvbLN+F0\nl51egwdaXtQQQcGJs8h1ukouGKer082Ff/tjTbQe2SOZ/GPTY8UAUHVYtTcpbiDF\nKXTNb+kGvZYOGdAYiWTcUbwrTGiHmY3m3mC+DcfHCppF+Rox2PSFCOybiJs/ccjY\n6QIDAQAB\n-----END PUBLIC KEY-----`
    
    try {
      const data = new URLSearchParams({ business_public_key: publicKey }).toString()
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/whatsapp_business_encryption`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: data
      })
      const text = await res.text()
      await sendWA(fromPhone, `ðŸ“¡ *Meta API Response (Key):*\n\nHTTP ${res.status}\n${text}`)
    } catch (e: any) {
      await sendWA(fromPhone, `âŒ Error: ${e.message}`)
    }
    return new Response('OK', { status: 200 })
  }

  if (slashText.startsWith('/wa_register ')) {
    if (!esAdmin) return null
    const parts = slashText.split(' ')
    const phoneId = parts[1]
    const pin = parts[2] || '123456'
    
    const token = Deno.env.get('WHATSAPP_TOKEN')
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/register`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          pin: pin
        })
      })
      const text = await res.text()
      await sendWA(fromPhone, `ðŸ“¡ *Meta API Response:*\n\n${text}`)
    } catch (e: any) {
      await sendWA(fromPhone, `âŒ Error: ${e.message}`)
    }
    return new Response('OK', { status: 200 })
  }

  if (slashText === '/repartidor') {
    if (!esAdmin) return null
    await supabase.from('bot_memory').upsert({
      phone: `admin_mode_${from10}`,
      history: [{ mode: 'repartidor', activado: Date.now() }],
      updated_at: new Date().toISOString()
    })
    await sendWA(fromPhone, `ðŸ›µ *Modo Repartidor activado.*\nAhora recibirÃ¡s pedidos como mensajero y puedes aceptarlos con el botÃ³n.\n\nEscribe */admin* para regresar a modo administrador.`)
    return new Response('OK', { status: 200 })
  }

  if (slashText === '/admin') {
    if (!esAdmin) return null
    await supabase.from('bot_memory').delete().eq('phone', `admin_mode_${from10}`)
    await sendWA(fromPhone, `ðŸ‘” *Modo Admin activado.*\nYa tienes acceso completo al panel de administraciÃ³n.`)
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /reset â€” Reinicia la sesiÃ³n actual del usuario (sin afectar Loyalty) â”€â”€
  if (slashText === '/reset' || slashText === '/reiniciar') {
    // Borra todas las claves de estado que contengan su nÃºmero (mandadito_state, capture_mode, etc)
    await supabase.from('bot_memory').delete().like('phone', `%${from10}%`)
    await sendWA(fromPhone, `ðŸ§¹ *SesiÃ³n reiniciada.*\nHe borrado mi memoria a corto plazo sobre lo que estÃ¡bamos haciendo. Â¡Empecemos de cero!\n_(Tus datos, perfil y puntos de Loyalty estÃ¡n intactos)_.`)
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /reset_cache â€” Borra la cachÃ© de Maps (solo admins) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText === '/reset_cache' || slashText === '/limpiar_cache') {
    if (!esAdmin) return null
    await supabase.from('bot_memory').delete().like('phone', `mandadito_txt_%`)
    await sendWA(fromPhone, `ðŸ§  *CachÃ© de inteligencia artificial y Maps borrada masivamente.*\nTodo texto nuevo se procesarÃ¡ desde cero.`)
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /fin â€” Cerrar sesiÃ³n de captura activa â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText === '/fin' || slashText === '/listo' || slashText === '/salir') {
    // Cerrar captura (fachada)
    const { data: capSesion } = await supabase.from('bot_memory').select('history').eq('phone', `capture_mode_${from10}`).maybeSingle()
    if (capSesion?.history?.[0]) {
      const { clienteNombre, clienteTel } = capSesion.history[0]
      await supabase.from('bot_memory').delete().eq('phone', `capture_mode_${from10}`)
      await sendWA(fromPhone, `âœ… *SESIÃ“N CERRADA*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\nðŸ“‹ *Cliente:* ${clienteNombre || clienteTel}\n\n_Todo el contenido enviado ha sido guardado exitosamente._ ðŸ‘`)
      return new Response('OK', { status: 200 })
    }
    
    // Cerrar mapeo
    const { data: mapSesion } = await supabase.from('bot_memory').select('history').eq('phone', `mapear_mode_${from10}`).maybeSingle()
    if (mapSesion?.history?.[0]) {
      await supabase.from('bot_memory').delete().eq('phone', `mapear_mode_${from10}`)
      await sendWA(fromPhone, `âœ… *Modo Mapeo Finalizado.*`)
      return new Response('OK', { status: 200 })
    }
    
    await sendWA(fromPhone, `â„¹ï¸ No hay ninguna sesiÃ³n activa.`)
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /mapear â€” Iniciar sesiÃ³n de mapeo de precios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText === '/mapear') {
    if (!esAdmin) return null
    const { data: col } = await supabase.from('colonias').select('id, nombre').is('precio', null).limit(1).maybeSingle()
    const { count: faltan } = await supabase.from('colonias').select('*', { count: 'exact', head: true }).is('precio', null)
    
    if (!col) {
      await sendWA(fromPhone, `ðŸŽ‰ Â¡Excelente! No hay colonias pendientes por mapear. Todas tienen precio.`)
      return new Response('OK', { status: 200 })
    }

    await supabase.from('bot_memory').upsert({
      phone: `mapear_mode_${from10}`,
      history: [{ coloniaId: col.id, coloniaNombre: col.nombre }],
      updated_at: new Date().toISOString()
    })

    await sendWA(fromPhone, `ðŸ“ *MODO MAPEO INICIADO*\n_Faltan ${faltan} colonias._\n\nPara salir escribe */salir*.\n\nÂ¿CuÃ¡nto cuesta el envÃ­o para:\nðŸ™ï¸ *${col.nombre}*?`)
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /mis_pedidos â€” Ver pedidos activos de un repartidor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText === '/mis_pedidos') {
    const { data: repData } = await supabase.from('repartidores')
      .select('id, user_id, nombre').eq('telefono', from10).limit(1).maybeSingle()
    if (repData) {
      // Buscar por user_id O por id (fallback para repartidores sin Auth)
      const repIdFilter = repData.user_id
        ? `repartidor_id.eq.${repData.user_id},repartidor_id.eq.${repData.id}`
        : `repartidor_id.eq.${repData.id}`
      const { data: activos } = await supabase.from('pedidos')
        .select('id, descripcion, estado, cliente_nombre, cliente_tel, direccion')
        .or(repIdFilter)
        .in('estado', ['asignado', 'recibido', 'en_camino'])
        .order('created_at', { ascending: true })
        .limit(10)
      if (!activos?.length) {
        await sendWA(fromPhone, `âœ… *${repData.nombre}*, no tienes pedidos activos ahora. Â¡Quedas libre!`)
      } else {
        const icons: Record<string, string> = { asignado: 'ðŸ•˜', recibido: 'ðŸ›ï¸', en_camino: 'ðŸš€' }
        let msg = `ðŸ“‹ *TUS PEDIDOS ACTIVOS (${activos.length})*\n\n`
        ;(activos as any[]).forEach((p: any, i: number) => {
          msg += `${i + 1}ï¸âƒ£ ${icons[p.estado] || 'ðŸ“¦'} *${p.estado.toUpperCase()}*\n`
          msg += `   ðŸ“¦ ${(p.descripcion || 'Sin descripciÃ³n').slice(0, 40)}\n`
          if (p.cliente_nombre) msg += `   ðŸ‘¤ ${p.cliente_nombre}\n`
          if (p.cliente_tel) msg += `   ðŸ“ž ${p.cliente_tel}\n`
          if (p.direccion) msg += `   ðŸ“ ${p.direccion.slice(0, 50)}\n`
          msg += '\n'
        })
        await sendWA(fromPhone, msg.trimEnd())
      }
    } else {
      await sendWA(fromPhone, 'âŒ No encontrÃ© tus datos de repartidor. Contacta al admin.')
    }
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /libre â€” Notificar disponibilidad â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText === '/libre') {
    const { data: rep } = await supabase.from('repartidores')
      .select('nombre').eq('telefono', from10).limit(1).maybeSingle()
    const repNombre = rep?.nombre || 'Repartidor'

    const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
    const _adminMain10 = ADMIN_PHONES_ENV.split(',').map((s: string) => extract10Digits(s)).filter(Boolean)[0] ?? ''
    const ADMIN_PHONE_MAIN = _adminMain10 ? `52${_adminMain10}` : ''

    if (ADMIN_PHONE_MAIN) {
      await sendWA(ADMIN_PHONE_MAIN, `ðŸŸ¢ *${repNombre}* estÃ¡ libre y disponible para el prÃ³ximo pedido.`)
    }
    await sendWA(fromPhone, `âœ… Le avisÃ© al admin que quedas libre. Â¡Espera el prÃ³ximo pedido!`)
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /set_field â€” Comando interno para ediciÃ³n desde botones â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText.startsWith('/set_field ')) {
    // /set_field EDIT_NOM 9631234567 Juan Perez
    // /set_field EDIT_NOT 9631234567 borrar
    const parts = slashText.split(' ')
    const fieldAction = parts[1]
    const tel10 = parts[2]
    const val = parts.slice(3).join(' ').trim()
    
    let updateData: any = {}
    let successMsg = ''
    if (fieldAction === 'EDIT_NOM') { updateData = { nombre: val }; successMsg = `Nombre actualizado a *${val}*` }
    else if (fieldAction === 'EDIT_DIR') { updateData = { direccion: val }; successMsg = `DirecciÃ³n actualizada` }
    else if (fieldAction === 'EDIT_NOT') { 
      const isBorrar = val.toLowerCase() === 'borrar' || val.toLowerCase() === 'eliminar'
      updateData = { notas_crm: isBorrar ? null : val }
      successMsg = isBorrar ? `Notas CRM borradas` : `Notas CRM actualizadas` 
    }
    
    await supabase.from('clientes').update(updateData).eq('telefono', tel10)
    await sendWA(fromPhone, `âœ… ${successMsg}.\n_Tip: EnvÃ­a /info ${tel10} para ver los cambios._`)
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /opciones â€” MenÃº principal interactivo del administrador/repartidor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText === '/opciones' || slashText === '/menu') {
    const listTitle = esAdmin ? 'âš™ï¸ *MENÃš DE ADMINISTRADOR*' : 'âš™ï¸ *MENÃš DE OPCIONES*'
    await sendInteractiveList(
      fromPhone,
      `${listTitle}\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nBienvenido a tu panel de control.\nSelecciona la acciÃ³n rÃ¡pida que deseas realizar:`,
      `Elegir AcciÃ³n`,
      [
        {
          title: 'Loyalty VIP',
          rows: [
            { id: 'ACT_MENU_LOYALTY', title: 'ðŸ“± Registro Loyalty', description: 'Crea y envÃ­a invitaciÃ³n T&C (SesiÃ³n)' },
            { id: 'ACT_MENU_QR', title: 'ðŸŽŸï¸ Enviar Tarjeta VIP', description: 'Manda el QR de lealtad por WA' },
            { id: 'ACT_MENU_SUMAR', title: 'â­ Sumar Puntos', description: 'AÃ±adir puntos manualmente' }
          ]
        },
        {
          title: 'GestiÃ³n CRM',
          rows: [
            { id: 'ACT_MENU_INFO', title: 'ðŸ“Š Ver Ficha del Cliente', description: 'Puntos, reputaciÃ³n, notas' },
            { id: 'ACT_MENU_SCORE', title: 'ðŸ† Calificar Cliente', description: 'Asignar Excelente, Bueno, Malo' },
            { id: 'ACT_MENU_NOREGO', title: 'ðŸ‘» Registro Silencioso', description: 'Crea cliente sin notificar' }
          ]
        },
        ...(esAdmin ? [{
          title: 'Operaciones Especiales',
          rows: [
            { id: 'ACT_MENU_REGALAR', title: 'ðŸŽ Regalar EnvÃ­o', description: 'Patrocinar un envÃ­o gratis' },
            { id: 'ACT_MENU_REST', title: 'ðŸª Ver Clientes Restaurante', description: 'Consulta clientes B2B' }
          ]
        }] : [])
      ]
    )
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /fachada â€” Activar sesiÃ³n de captura de fachada â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Uso: /fachada 9631234567
  // DespuÃ©s: manda foto â†’ se guarda como fachada del cliente
  //          manda texto â†’ se guarda como nota_crm
  //          manda /fin  â†’ cierra la sesiÃ³n

  // â”€â”€ /rest_accept â€” Aprobar solicitud B2B por texto (fallback de botones) â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText.startsWith('/rest_accept_') && esAdmin) {
    const restTel = slashText.replace('/rest_accept_', '').trim()
    
    if (!restTel || restTel.length !== 10) {
      await sendWA(fromPhone, `âš ï¸ Formato incorrecto. El telÃ©fono debe ser de 10 dÃ­gitos.`)
      return new Response('OK', { status: 200 })
    }

    const { data: pendingRest } = await supabase.from('bot_memory')
      .select('history').eq('phone', `pending_rest_${restTel}`).maybeSingle()
    const restInfo = pendingRest?.history?.[0]

    if (!restInfo) {
      await sendWA(fromPhone, `âš ï¸ No encontrÃ© la solicitud para ${restTel}. Es posible que ya fue procesada.`)
      return new Response('OK', { status: 200 })
    }

    // Insertar con todos los datos
    const { error } = await supabase.from('restaurantes').insert({
      telefono: restTel,
      nombre: restInfo.nombreRest,
      direccion: restInfo.ubicacion,
      foto_fachada_url: restInfo.fotoUrl,
      programa_lealtad_activo: true,
      activo: true
    })

    if (error) {
      if (error.code === '23505') await sendWA(fromPhone, `âš ï¸ El restaurante con telÃ©fono ${restTel} ya existe.`)
      else await sendWA(fromPhone, `âŒ Error al guardar el restaurante: ${error.message}`)
      return new Response('OK', { status: 200 })
    }

    await supabase.from('bot_memory').delete().eq('phone', `pending_rest_${restTel}`)
    
    await sendWA(fromPhone, `âœ… Restaurante *${restInfo.nombreRest}* aprobado y registrado (vÃ­a comando de texto).`)
    await sendWA(`52${restTel}`, `ðŸŽ‰ *Â¡Felicidades, ${restInfo.responsable || 'aliado'}!*\n\nTu restaurante ha sido aprobado por la administraciÃ³n. Ya eres parte oficial de Estrella Delivery.\n\nEnvÃ­a la palabra *Hola* o *MenÃº* para abrir tu Portal de Aliados B2B.`)
    
    const pdfUrl = Deno.env.get('PDF_BIENVENIDA_URL') || "https://jdrrkpvodnqoljycixbg.supabase.co/storage/v1/object/public/restaurantes/pdf-restaurantes/pdf-restaurante.pdf"
    await sendWADocument(`52${restTel}`, pdfUrl, "Guia_Restaurantes.pdf", "ðŸ“– Te enviamos esta pequeÃ±a guÃ­a en PDF para que sepas cÃ³mo sacarle el mÃ¡ximo provecho a tu Portal de Aliados.")

    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /rest_reject â€” Rechazar solicitud B2B por texto (fallback de botones) â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText.startsWith('/rest_reject_') && esAdmin) {
    const restTel = slashText.replace('/rest_reject_', '').trim()
    
    if (!restTel || restTel.length !== 10) {
      await sendWA(fromPhone, `âš ï¸ Formato incorrecto. El telÃ©fono debe ser de 10 dÃ­gitos.`)
      return new Response('OK', { status: 200 })
    }

    const { data: pendingRest } = await supabase.from('bot_memory')
      .select('history').eq('phone', `pending_rest_${restTel}`).maybeSingle()
    const restInfo = pendingRest?.history?.[0]

    await supabase.from('bot_memory').delete().eq('phone', `pending_rest_${restTel}`)
    await sendWA(`52${restTel}`, `Lo sentimos ðŸ™ Tu solicitud de afiliaciÃ³n no pudo ser aprobada.\nSi crees que es un error, contÃ¡ctanos directamente.`)
    await sendWA(fromPhone, `âŒ Solicitud del restaurante *${restInfo?.nombreRest || restTel}* rechazada (vÃ­a comando de texto).`)
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /pausa â€” Silencia el bot para un cliente (admin habla directo con el cliente) â”€â”€â”€â”€
  // Uso: /pausa 9631234567
  if (slashText.startsWith('/pausa ') && esAdmin) {
    const cTel = extract10Digits(slashText.replace('/pausa ', '').trim())
    if (!cTel || cTel.length !== 10) {
      await sendWA(fromPhone, `âš ï¸ Uso: */pausa 9631234567*`)
      return new Response('OK', { status: 200 })
    }
    await supabase.from('bot_memory').upsert({
      phone: `bot_pausa_${cTel}`,
      history: [{ pausado_por: fromPhone, desde: new Date().toISOString() }],
      updated_at: new Date().toISOString()
    })
    await sendWA(fromPhone,
      `⭕ *Bot PAUSADO* para \`${cTel}\`.\n\nEl bot ya no responderá a este cliente.\nPuedes hablar con él directamente.\n\n_Usa */bot ${cTel}* para reactivarlo cuando termines._`
    )
    return new Response('OK', { status: 200 })
  }

  // ——— /bot — Reactiva el bot para un cliente ——————————————————————————————————————
  // Uso: /bot 9631234567
  if (slashText.startsWith('/bot ') && esAdmin) {
    const cTel = extract10Digits(slashText.replace('/bot ', '').trim())
    if (!cTel || cTel.length !== 10) {
      await sendWA(fromPhone, `âš ï¸ Uso: */bot 9631234567*`)
      return new Response('OK', { status: 200 })
    }
    await supabase.from('bot_memory').delete().eq('phone', `bot_pausa_${cTel}`)
    await sendWA(fromPhone,
      `ðŸŸ¢ *Bot REACTIVADO* para \`${cTel}\`.\n\nEl bot volverÃ¡ a responder automÃ¡ticamente a este cliente.`
    )
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /noregistrado, /fachada y /loyalty â€” Activar sesiÃ³n de captura de fachada â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText.startsWith('/fachada ') || slashText.startsWith('/noregistrado ') || slashText.startsWith('/loyalty ')) {
    const isLoyalty = slashText.startsWith('/loyalty ');
    const isNoregistrado = slashText.startsWith('/noregistrado ');
    const param = slashText.replace(isLoyalty ? '/loyalty ' : (isNoregistrado ? '/noregistrado ' : '/fachada '), '').trim();
    const cTel = extract10Digits(param);
    if (!cTel || cTel.length !== 10) {
      await sendWA(fromPhone, `âš ï¸ Formato: */fachada 9631234567*`)
      return new Response('OK', { status: 200 })
    }
    let { data: cliente } = await supabase.from('clientes')
      .select('id, nombre, foto_fachada_url, notas_crm, acepta_terminos')
      .eq('telefono', cTel).limit(1).maybeSingle()

    let clienteId = cliente?.id
    let clienteNombre = cliente?.nombre
    let tieneFotoMsg = cliente?.foto_fachada_url ? `âœ… Ya tiene foto guardada.` : `ðŸ“· Sin foto aÃºn.`
    let tieneNotaMsg = cliente?.notas_crm ? `ðŸ“ Nota actual: _${cliente.notas_crm.slice(0, 80)}_` : `ðŸ“ Sin notas.`

    if (!cliente) {
      const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${cTel}`

      if (isLoyalty) {
        // â”€â”€ Loyalty: registrar con nombre genÃ©rico pero NO mostrar "REGISTRO SILENCIOSO"
        // El cliente recibirÃ¡ los T&C y su nombre real se guardarÃ¡ cuando acepte.
        const { data: nuevo, error } = await supabase.from('clientes').insert({
          telefono: cTel,
          nombre: 'Nuevo Cliente',
          puntos: 0,
          acepta_terminos: false,
          qr_code: loyaltyUrl
        }).select('id, nombre').maybeSingle()

        if (nuevo) {
          clienteId = nuevo.id
          clienteNombre = nuevo.nombre
          tieneFotoMsg = `ðŸ“· Sin foto aÃºn.`
          tieneNotaMsg = `ðŸ“ Sin notas.`
          // SIN mensaje de "Registro Silencioso" â€” el aviso Loyalty viene mÃ¡s abajo
        } else {
          await sendWA(fromPhone, `âŒ Error al crear el cliente: ${error?.message}`)
          return new Response('OK', { status: 200 })
        }
      } else {
        // â”€â”€ Silencioso (/noregistrado o /fachada): crear como "Cliente Express" sin notificar al cliente
        const { data: nuevo, error } = await supabase.from('clientes').insert({
          telefono: cTel,
          nombre: 'Cliente Express',
          puntos: 0,
          acepta_terminos: false,
          qr_code: loyaltyUrl
        }).select('id, nombre').maybeSingle()

        if (nuevo) {
          clienteId = nuevo.id
          clienteNombre = nuevo.nombre
          tieneFotoMsg = `ðŸ“· Sin foto aÃºn.`
          tieneNotaMsg = `ðŸ“ Sin notas.`
          await sendWA(fromPhone, `â„¹ï¸ *REGISTRO SILENCIOSO*\nEl cliente no existÃ­a, lo he registrado automÃ¡ticamente como *Cliente Express* para poder guardar sus datos. No se le enviÃ³ ningÃºn mensaje.`)
        } else {
          await sendWA(fromPhone, `âŒ Error al crear el cliente: ${error?.message}`)
          return new Response('OK', { status: 200 })
        }
      }
    }


    if (isLoyalty && (!cliente || cliente?.acepta_terminos === false)) {
      const { sendWATemplate } = await import('./whatsapp.ts')
      await sendWATemplate(`52${cTel}`, 'estrella_terminos_condiciones', [clienteNombre || 'Cliente'])
      await sendWA(fromPhone, `ðŸ“¤ Se ha enviado la invitaciÃ³n del programa Loyalty a *${clienteNombre}*. Cuando acepte, recibirÃ¡ su QR.`)
    }

    // Guardar sesiÃ³n de captura con TTL
    const SESION_TTL_MS = 2 * 60 * 60 * 1000 // 2 horas
    await supabase.from('bot_memory').upsert({
      phone: `capture_mode_${from10}`,
      history: [{
        mode: 'fachada',
        clienteTel: cTel,
        clienteId: clienteId,
        clienteNombre: clienteNombre,
        capturedBy: from10,      // quiÃ©n activÃ³ la sesiÃ³n
        iniciado: Date.now(),    // timestamp para TTL
        expira: Date.now() + SESION_TTL_MS
      }],
      updated_at: new Date().toISOString()
    })

    await sendWA(fromPhone,
      `ðŸ“¸ *SESIÃ“N DE CAPTURA ACTIVA*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
      `ðŸ‘¤ *Cliente:* ${clienteNombre} (\`${cTel}\`)\n` +
      `${tieneFotoMsg}\n${tieneNotaMsg}\n\n` +
      `*ðŸ“Œ OPCIONES:*\n` +
      `ðŸ“· *EnvÃ­a una foto:* Se guardarÃ¡ como fachada.\n` +
      `ðŸ’¬ *EnvÃ­a texto:* Se guardarÃ¡ como nota CRM.\n` +
      `ðŸ“ *DirecciÃ³n:* Pide a la IA: _"Actualiza la direcciÃ³n de ${cTel} a..."_\n` +
      `â­ *ReputaciÃ³n:* Escribe: _/score ${cTel} excelente_ (O regular, malo)\n` +
      `âŒ *Escribe /fin:* Para cerrar la sesiÃ³n.`
    )
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /nota â€” Guardar nota directa sin sesiÃ³n â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText.startsWith('/nota ')) {
    const rest = slashText.slice(6).trim()
    const match = rest.match(/^(\d[\d\s\-]{8,}\d)\s+(.+)$/s)
    const cTel = match ? extract10Digits(match[1]) : null
    const nota = match ? match[2].trim() : null
    if (!cTel || cTel.length !== 10 || !nota) {
      await sendWA(fromPhone, `âš ï¸ Formato: */nota 9631234567 texto de la nota*`)
      return new Response('OK', { status: 200 })
    }
    const { data: c } = await supabase.from('clientes')
      .select('id, nombre, notas_crm').eq('telefono', cTel).limit(1).maybeSingle()
    if (!c) {
      await sendWA(fromPhone, `âŒ Cliente ${cTel} no encontrado.`)
      return new Response('OK', { status: 200 })
    }
    const notaFinal = c.notas_crm
      ? `${c.notas_crm}\n[${new Date().toLocaleDateString('es-MX')}] ${nota}`
      : `[${new Date().toLocaleDateString('es-MX')}] ${nota}`
    await supabase.from('clientes').update({ notas_crm: notaFinal }).eq('id', c.id)
    await sendWA(fromPhone,
      `âœ… *NOTA GUARDADA*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
      `ðŸ‘¤ *Cliente:* ${c.nombre} (\`${cTel}\`)\n\n` +
      `ðŸ“ *Contenido:*\n_${nota}_`
    )
    return new Response('OK', { status: 200 })
  }





  // â”€â”€ /rest_clientes â€” Ver clientes afiliados a un restaurante â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Uso: /rest_clientes 9631234567
  if (slashText.startsWith('/rest_clientes ')) {
    if (!esAdmin) return null
    const cTel = extract10Digits(slashText.slice(15).trim())
    if (!cTel || cTel.length !== 10) {
      await sendWA(fromPhone, `âš ï¸ Formato: */rest_clientes 9631234567* (telÃ©fono del restaurante)`)
      return new Response('OK', { status: 200 })
    }

    const { data: rest, error: restErr } = await supabase.from('restaurantes')
      .select('id, nombre, activo')
      .eq('telefono', cTel)
      .limit(1)
      .maybeSingle()

    if (restErr) {
      console.error(`[rest_clientes] DB Error al buscar ${cTel}:`, restErr)
      await sendWA(fromPhone, `âŒ Error en DB buscando el restaurante: ${restErr.message}`)
      return new Response('OK', { status: 200 })
    }

    if (!rest) {
      console.log(`[rest_clientes] Restaurante no encontrado para ${cTel}`)
      await sendWA(fromPhone, `âŒ No encontrÃ© ningÃºn restaurante registrado con el nÃºmero *${cTel}*.`)
      return new Response('OK', { status: 200 })
    }

    console.log(`[rest_clientes] Restaurante encontrado: ${rest.nombre} (${rest.id})`)

    const { data: clientes } = await supabase
      .from('restaurante_clientes_puntos')
      .select('cliente_tel, puntos, visitas')
      .eq('restaurante_id', rest.id)
      .order('puntos', { ascending: false })
      .limit(10)

    if (!clientes?.length) {
      await sendWA(fromPhone,
        `ðŸª *${rest.nombre}*\n` +
        `${rest.activo ? 'âœ… Restaurante Activo' : 'âš ï¸ Restaurante Inactivo'}\n\n` +
        `ðŸ‘¥ AÃºn no tiene clientes afiliados.`
      )
      return new Response('OK', { status: 200 })
    }

    // Enriquecer con nombres
    const tels = clientes.map((c: any) => c.cliente_tel)
    const { data: clientesInfo } = await supabase.from('clientes')
      .select('telefono, nombre').in('telefono', tels)
    const nameMap: Record<string, string> = {}
    clientesInfo?.forEach((c: any) => { nameMap[c.telefono] = c.nombre })

    let msg = `ðŸª *${rest.nombre}*\n`
    msg += `${rest.activo ? 'âœ… Restaurante Activo' : 'âš ï¸ Restaurante Inactivo'}\n`
    msg += `â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n`
    msg += `ðŸ‘¥ *Top ${clientes.length} Clientes afiliados:*\n\n`
    clientes.forEach((c: any, i: number) => {
      const nombre = nameMap[c.cliente_tel] || c.cliente_tel
      msg += `${i + 1}ï¸âƒ£ *${nombre}*\n`
      msg += `   â­ ${c.puntos} pts â€¢ ðŸ‘ï¸ ${c.visitas} visitas â€¢ \`${c.cliente_tel}\`\n\n`
    })
    await sendWA(fromPhone, msg)

    // Lista interactiva para ver ficha individual
    const rows = clientes.slice(0, 10).map((c: any) => ({
      id: `ADMIN_REST_CLI_${c.cliente_tel}`,
      title: (nameMap[c.cliente_tel] || c.cliente_tel).slice(0, 24),
      description: `â­ ${c.puntos} pts â€¢ ðŸ‘ï¸ ${c.visitas} visitas`
    }))
    await sendInteractiveList(
      fromPhone,
      `Â¿Deseas ver la ficha de alguno?`,
      'Ver Cliente',
      [{ title: 'Clientes del Restaurante', rows }]
    )

    return new Response('OK', { status: 200 })
  }





  if (slashText.startsWith('/usar ')) {
    const codigo = slashText.replace('/usar ', '').trim().toUpperCase()
    const { data, error } = await supabase.rpc('usar_cupon', { p_codigo: codigo })
    if (error) await sendWA(fromPhone, `âŒ Error interno: ${error.message}`)
    else if (!data?.ok) await sendWA(fromPhone, `âŒ Error: ${data?.error || 'CupÃ³n no encontrado'}`)
    else await sendWA(fromPhone,
      `âœ… *CUPÃ“N APLICADO*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
      `ðŸŽŸï¸ *CÃ³digo:* \`${codigo}\`\n` +
      `ðŸ‘¤ *Cliente:* ${data.cliente_nombre} (\`${data.cliente_tel}\`)\n\n` +
      `_El cupÃ³n se ha marcado como USADO exitosamente._`
    )
    return new Response('OK', { status: 200 })
  }

  if (slashText.startsWith('/cancelar ')) {
    const codigo = slashText.replace('/cancelar ', '').trim().toUpperCase()
    const { data: adminUser } = await supabase.from('admins').select('id').eq('telefono', from10).maybeSingle()
    const { data, error } = await supabase.rpc('cancelar_cupon', {
      p_codigo: codigo,
      p_admin_id: adminUser?.id || null
    })
    if (error) await sendWA(fromPhone, `âŒ Error interno: ${error.message}`)
    else if (!data?.ok) await sendWA(fromPhone, `âŒ Error: ${data?.error || 'CupÃ³n no encontrado'}`)
    else await sendWA(fromPhone,
      `âœ… *CUPÃ“N CANCELADO*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
      `ðŸŽŸï¸ *CÃ³digo:* \`${codigo}\`\n` +
      `ðŸ‘¤ *Cliente:* ${data.cliente_nombre}\n` +
      `ðŸ’µ *Reembolso:* $${data.monto_reembolsado} a billetera\n\n` +
      `_El cupÃ³n fue invalidado y el saldo regresÃ³ al cliente._`
    )
    return new Response('OK', { status: 200 })
  }

  if (slashText === '/testdiscord') {
    await logError(
      'whatsapp-bot',
      'ðŸ”¥ Prueba manual de Webhook iniciada por el administrador',
      { user: fromPhone, test: true, timestamp: new Date().toISOString() },
      'critical'
    );
    await sendWA(fromPhone, `ðŸ“¡ *Test Enviado*\nAcabo de disparar un error crÃ­tico de prueba. Si configuraste bien el \`DISCORD_WEBHOOK_URL\` en Supabase, el mensaje debiÃ³ llegar al canal de Discord ahora mismo.`);
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ COMANDOS DE EMERGENCIA (funcionan SIN DeepSeek) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (slashText.startsWith('/pedido ')) {
    // Formato: /pedido 9631234567 2 tacos pastor de Makitan
    const args = slashText.slice(8).trim()
    const telMatch = args.match(/^(\d{10})\s+(.+)$/s)
    if (!telMatch) {
      await sendWA(fromPhone, `âš ï¸ Formato: */pedido 9631234567 descripciÃ³n del pedido*`)
      return new Response('OK', { status: 200 })
    }
    const [, cTel, desc] = telMatch
    const pData = { clienteTel: cTel, clienteNombre: null, restaurante: null, descripcion: desc, direccion: null, repartidorAlias: null }
    const r = await crearPedidoDesdeBot(supabase, pData, undefined, undefined, messageId)
    if (r.ok && r.pedidoId) {
      await sendWA(fromPhone,
        `âœ… *PEDIDO CREADO (MANUAL)*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
        `ðŸ“ž *Cliente:* \`${cTel}\`\n` +
        `ðŸ“¦ *DescripciÃ³n:*\n_${desc}_\n\n` +
        `ðŸ”— *Enlace:* ${pedidoLink(r.pedidoId)}`
      )
    } else {
      await sendWA(fromPhone, `âŒ Error: ${r.error || 'No se pudo crear el pedido'}`)
    }
    return new Response('OK', { status: 200 })
  }

  if (slashText.startsWith('/puntos ')) {
    // Formato: /puntos 9631234567 [cantidad]
    const args = slashText.slice(8).trim().split(/\s+/)
    const cTel = args[0]?.replace(/\D/g, '').slice(-10)
    const cant = parseInt(args[1] || '1') || 1
    if (!cTel || cTel.length !== 10) {
      await sendWA(fromPhone, `âš ï¸ Formato: */puntos 9631234567* o */puntos 9631234567 3*`)
      return new Response('OK', { status: 200 })
    }
    const { data, error } = await supabase.rpc('fn_registrar_entrega_bulk', { p_cliente_tel: cTel, p_cantidad: cant })
    if (data?.ok) {
      await sendWA(fromPhone, `âœ… *PUNTOS AÃ‘ADIDOS*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\nðŸ‘¤ *Cliente:* \`${cTel}\`\nâž• *Agregados:* ${cant} punto(s)\nâ­ *Total Actual:* ${data.puntos} pts\n\n_Los puntos ya estÃ¡n reflejados en su cuenta._`)
      if (data.recien_ascendido) {
        try {
          await sendWA(`52${cTel}`, `ðŸ‘‘ *Â¡Felicidades!* ðŸ‘‘\n\nHas sido promovido a *Cliente VIP* â­ de Estrella Delivery.\n\nA partir de ahora acumularÃ¡s *saldo real* en tu billetera. ðŸ’°`)

          // Enviar la nueva tarjeta digital con el diseÃ±o VIP
          const { data: c } = await supabase.from('clientes').select('nombre, puntos, saldo_billetera').eq('telefono', cTel).maybeSingle()
          if (c) {
            const qrCode = generateCloudinaryVIPCard(cTel, c.nombre || 'Cliente VIP', c.puntos, c.saldo_billetera || 0, true)
            const { sendWAImage } = await import('./whatsapp.ts')
            const captionVip = `ðŸŒŸ *Â¡AquÃ­ tienes tu nueva Tarjeta Digital VIP!* ðŸŒŸ\n\nMuestra este cÃ³digo QR a nuestros repartidores al recibir tus pedidos para seguir acumulando saldo en tu billetera.`
            await sendWAImage(`52${cTel}`, qrCode, captionVip)
            
          }
        } catch (e) {
          console.error('[PUNTOS MANUALES] Error enviando bienvenida VIP al cliente:', e)
        }
      }
    } else {
      await sendWA(fromPhone, `âŒ Error: ${error?.message || data?.error || 'Cliente no encontrado'}`)
    }
    return new Response('OK', { status: 200 })
  }

  if (slashText.startsWith('/buscar ')) {
    const cTel = slashText.slice(8).trim().replace(/\D/g, '').slice(-10)
    if (!cTel || cTel.length !== 10) {
      await sendWA(fromPhone, `âš ï¸ Formato: */buscar 9631234567*`)
      return new Response('OK', { status: 200 })
    }
    const { data: c } = await supabase.from('clientes')
      .select('nombre, telefono, puntos, es_vip, rango, saldo_billetera, envios_totales, envios_gratis_disponibles, cupon_activo, notas_crm')
      .eq('telefono', cTel).limit(1).maybeSingle()
    if (c) {
      const cuponTxt = c.cupon_activo ? `\nðŸŽŸï¸ *CupÃ³n Activo:* \`${c.cupon_activo}\`` : ''
      const notasTxt = c.notas_crm ? `\n\nðŸ“ *Notas CRM:*\n_${c.notas_crm.slice(0, 200)}_` : ''
      const vipTxt = c.es_vip ? `ðŸ‘‘ *NIVEL VIP* ðŸ‘‘\n` : ''

      await sendWA(fromPhone,
        `ðŸ” *INFORMACIÃ“N DEL CLIENTE*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
        `ðŸ‘¤ *Nombre:* ${c.nombre || 'Sin registrar'}\n` +
        `ðŸ“ž *TelÃ©fono:* \`${c.telefono}\`\n\n` +
        vipTxt +
        `â­ *Puntos:* ${c.puntos}\n` +
        `ðŸ“Š *Rango:* ${String(c.rango || 'bronce').toUpperCase()}\n` +
        `ðŸ’° *Billetera:* $${c.saldo_billetera || 0}\n` +
        `ðŸŽ *EnvÃ­os Gratis:* ${c.envios_gratis_disponibles}\n` +
        `ðŸ›µ *Total Entregas:* ${c.envios_totales}` +
        cuponTxt + notasTxt
      )
    } else {
      await sendWA(fromPhone, `âŒ Cliente no encontrado con ese nÃºmero.`)
    }
    return new Response('OK', { status: 200 })
  }



  // â”€â”€ /rol â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Formato: /rol 9631234567 restaurante [Nombre Opcional]
  //          /rol 9631234567 cliente
  //          /rol 9631234567 repartidor [Nombre] [Alias]
  if (slashText.startsWith('/rol ')) {
    if (!esAdmin) {
      await sendWA(fromPhone, `ðŸš« Solo los administradores pueden asignar roles.`);
      return new Response('OK', { status: 200 })
    }
    const args = slashText.slice(5).trim().split(/\s+/)
    const cTel = extract10Digits(args[0])
    const nuevoRol = (args[1] || '').toLowerCase()
    const extra = slashText.slice(5).trim().split(/\s+/).slice(2).join(' ').trim() // nombre extra

    if (!cTel || cTel.length !== 10 || !['cliente', /*'restaurante',*/ 'repartidor'].includes(nuevoRol)) {
      await sendWA(fromPhone,
        `âš ï¸ Formato: */rol 9631234567 [rol] [nombre opcional]*\n\n` +
        `Roles disponibles:\n` +
        `ðŸ‘¤ *cliente* â€” usuario normal del programa\n` +
        /*`ðŸª *restaurante* â€” acceso al portal B2B\n` +*/
        `ðŸ›µ *repartidor* â€” recibe y gestiona pedidos\n\n` +
        `Ejemplo: /rol 9631112233 cliente Maria`
      )
      return new Response('OK', { status: 200 })
    }

    // Leer estado actual del nÃºmero en las 3 tablas en paralelo
    const [{ data: cli }, { data: rest }, { data: rep }] = await Promise.all([
      supabase.from('clientes').select('id, nombre').eq('telefono', cTel).maybeSingle(),
      supabase.from('restaurantes').select('id, nombre').eq('telefono', cTel).maybeSingle(),
      supabase.from('repartidores').select('id, nombre').eq('telefono', cTel).maybeSingle(),
    ])

    const nombreDetectado = cli?.nombre || rest?.nombre || rep?.nombre || extra || `Usuario ${cTel}`

    if (nuevoRol === 'cliente') {
      if (cli) {
        await sendWA(fromPhone,
          `â„¹ï¸ *ROL EXISTENTE*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
          `ðŸ‘¤ *NÃºmero:* \`${cTel}\`\n` +
          `_Ya es un cliente (${cli.nombre})._`
        )
      } else {
        const nombreCli = extra || nombreDetectado
        const qrCode = generateCloudinaryVIPCard(cTel, nombreCli, 0, 0, false)
        const { error } = await supabase.from('clientes').insert({
          telefono: cTel,
          nombre: nombreCli,
          acepta_terminos: false,
          puntos: 0,
          qr_code: qrCode
        })
        if (error) {
          await sendWA(fromPhone, `âŒ Error al crear cliente: ${error.message}`)
        } else {
          await sendWA(fromPhone,
            `âœ… *ROL ASIGNADO*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
            `ðŸ‘¤ *NÃºmero:* \`${cTel}\`\n` +
            `ðŸ‘¤ *Rol:* Cliente\n` +
            `ðŸ“ *Nombre:* ${nombreCli}`
          )
        }
      }
    } else if (nuevoRol === 'repartidor') {
      if (rep) {
        await sendWA(fromPhone,
          `â„¹ï¸ *ROL EXISTENTE*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
          `ðŸ‘¤ *NÃºmero:* \`${cTel}\`\n` +
          `_Ya es un repartidor (${rep.nombre})._`
        )
      } else {
        const nombreRep = extra || nombreDetectado
        const aliasRep = nombreRep.split(' ')[0].toLowerCase()
        const { error } = await supabase.from('repartidores').insert({
          telefono: cTel,
          nombre: nombreRep,
          alias: aliasRep,
          activo: true
        })
        if (error) {
          await sendWA(fromPhone, `âŒ Error al crear repartidor: ${error.message}`)
        } else {
          await sendWA(fromPhone,
            `âœ… *ROL ASIGNADO*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
            `ðŸ‘¤ *NÃºmero:* \`${cTel}\`\n` +
            `ðŸ›µ *Rol:* Repartidor\n` +
            `ðŸ“ *Nombre:* ${nombreRep}\n` +
            `ðŸ·ï¸ *Alias:* ${aliasRep}`
          )
          await sendWA(`52${cTel}`, `ðŸ›µ *Estrella Delivery* te ha registrado como repartidor.\n\nEscrÃ­benos para activar tu cuenta y comenzar a recibir pedidos.`)
        }
      }
    }
    return new Response('OK', { status: 200 })
  }

  // â”€â”€ /quitar-rol â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Formato: /quitar-rol 9631234567 restaurante
  if (slashText.startsWith('/quitar-rol ')) {
    if (!esAdmin) {
      await sendWA(fromPhone, `ðŸš« Solo los administradores pueden quitar roles.`);
      return new Response('OK', { status: 200 })
    }
    const args = slashText.slice(12).trim().split(/\s+/)
    const cTel = extract10Digits(args[0])
    const rolAQuitar = (args[1] || '').toLowerCase()

    if (!cTel || cTel.length !== 10 || !['cliente', /*'restaurante',*/ 'repartidor'].includes(rolAQuitar)) {
      await sendWA(fromPhone, `âš ï¸ Formato: */quitar-rol 9631234567 [rol]*\nRoles: cliente, /*restaurante,*/ repartidor`)
      return new Response('OK', { status: 200 })
    }

    let tabla = rolAQuitar === 'cliente' ? 'clientes' : /*rolAQuitar === 'restaurante' ? 'restaurantes' :*/ 'repartidores'
    const { data: existe } = await supabase.from(tabla).select('id, nombre').eq('telefono', cTel).maybeSingle()

    if (!existe) {
      await sendWA(fromPhone,
        `âš ï¸ *ERROR*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
        `El nÃºmero *\`${cTel}\`* no tiene el rol de *${rolAQuitar}*.`
      )
    } else {
      if (rolAQuitar === 'repartidor') {
        await supabase.from('repartidores').update({ activo: false }).eq('id', existe.id)
      } else {
        // Para clientes solo desactivamos tÃ©rminos y puntos (nunca se borra historial)
        await sendWA(fromPhone,
          `âš ï¸ *ACCIÃ“N DENEGADA*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
          `Los clientes no se pueden eliminar para preservar el historial.\n` +
          `_Si quieres bloquearlo, usa:_ */vetar ${cTel}*`
        )
        return new Response('OK', { status: 200 })
      }
      await sendWA(fromPhone,
        `âœ… *ROL DESACTIVADO*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\n` +
        `ðŸ‘¤ *NÃºmero:* \`${cTel}\` (${existe.nombre})\n` +
        `âŒ *Rol quitado:* ${rolAQuitar.toUpperCase()}\n\n` +
        `_El registro histÃ³rico se ha conservado._`
      )
    }
    return new Response('OK', { status: 200 })
  }

  // /ayuda y /help ya se manejan al inicio del archivo (lÃ­neas 14 y 24)
  // No duplicar aquÃ­.

  return null
}

// â”€â”€ Procesador de botones/listas interactivas para Administrador â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleAdminInteractive(
  supabase: any,
  fromPhone: string,
  from10: string,
  buttonId: string
): Promise<Response | null> {

  // â”€â”€ MenÃº JerÃ¡rquico de GestiÃ³n (Interceptor NumÃ©rico) â”€â”€
  if (buttonId.startsWith('ACT_CLI_')) {
    const actionParts = buttonId.split('_')
    const actionType = actionParts[2]
    const telReal = buttonId.match(/(\d{10})$/)?.[1] || ''
    
    switch (actionType) {
      case 'INFO': return await handleSlashCommands(supabase, fromPhone, from10, `/info ${telReal}`, 'btn_' + Date.now(), true)
      case 'QR': return await handleSlashCommands(supabase, fromPhone, from10, `/qr ${telReal}`, 'btn_' + Date.now(), true)
      case 'SESS': return await handleSlashCommands(supabase, fromPhone, from10, `/fachada ${telReal}`, 'btn_' + Date.now(), true)
      
      case 'SUBPTS':
        await sendInteractiveList(
          fromPhone, `*Recargas y Puntos* para ${telReal}`, 'Seleccionar',
          [{ title: 'Abonos', rows: [
            { id: `ACT_CLI_ADDPT_${telReal}`, title: 'âž• Sumar 1 Punto' },
            { id: `ACT_CLI_ADDSALDO_${telReal}`, title: 'ðŸ’° Cargar Saldo VIP' },
            { id: `ACT_CLI_GIVENV_${telReal}`, title: 'ðŸŽ Regalar EnvÃ­o Gratis' }
          ]}]
        )
        return new Response('OK', { status: 200 })
      
      case 'SUBPAY':
        await sendInteractiveList(
          fromPhone, `*Cobros y Canjes* para ${telReal}`, 'Seleccionar',
          [{ title: 'Descuentos', rows: [
            { id: `ACT_CLI_SUBSALDO_${telReal}`, title: 'ðŸ“‰ Descontar Saldo VIP' },
            { id: `ACT_CLI_RMVENV_${telReal}`, title: 'ðŸŽŸï¸ Quitar EnvÃ­o Gratis' }
          ]}]
        )
        return new Response('OK', { status: 200 })

      case 'SUBREP':
        await sendInteractiveList(
          fromPhone, `*ReputaciÃ³n* para ${telReal}`, 'Seleccionar',
          [{ title: 'Asignar', rows: [
            { id: `ACT_CLI_SETREP_EXC_${telReal}`, title: 'â­ Excelente' },
            { id: `ACT_CLI_SETREP_REG_${telReal}`, title: 'âš ï¸ Regular' },
            { id: `ACT_CLI_SETREP_VET_${telReal}`, title: 'ðŸš« Vetar' }
          ]}]
        )
        return new Response('OK', { status: 200 })

      case 'SUBROL':
        await sendInteractiveList(
          fromPhone, `*Roles y Accesos* para ${telReal}`, 'Seleccionar',
          [{ title: 'Modificar Rol', rows: [
            { id: `ACT_CLI_TOGVIP_${telReal}`, title: 'ðŸ‘‘ Hacer VIP / Quitar' },
            { id: `ACT_CLI_SETREPART_${telReal}`, title: 'ðŸ›µ Hacer Repartidor' },
            { id: `ACT_CLI_RMVROL_${telReal}`, title: 'âŒ Limpiar Roles' }
          ]}]
        )
        return new Response('OK', { status: 200 })
      
      // -- ACCIONES DIRECTAS DESDE SUBMENUS --
      case 'ADDPT':
        return await handleSlashCommands(supabase, fromPhone, from10, `/puntos ${telReal} 1`, 'btn_' + Date.now(), true)
      case 'GIVENV': {
        const { data: c } = await supabase.from('clientes').select('nombre').eq('telefono', telReal).maybeSingle()
        if (c) {
          const { error } = await supabase.rpc('increment_cliente_envios_gratis', { p_tel: telReal, p_amount: 1 })
          if (!error) {
            await sendWA(fromPhone, `âœ… *EnvÃ­o gratis regalado* a ${c.nombre} (${telReal}).`)
            await sendWA(`52${telReal}`, `ðŸŽ‰ *Â¡Sorpresa!*\n\nEl equipo de Estrella Delivery te acaba de obsequiar un *EnvÃ­o Gratis*. ðŸŽ`)
          } else await sendWA(fromPhone, `âŒ Error: ${error.message}`)
        } else await sendWA(fromPhone, `âŒ Cliente no encontrado.`)
        return new Response('OK', { status: 200 })
      }
      case 'RMVENV': {
        const { error } = await supabase.rpc('increment_cliente_envios_gratis', { p_tel: telReal, p_amount: -1 })
        if (!error) await sendWA(fromPhone, `âœ… Se ha descontado 1 envÃ­o gratis a ${telReal}.`)
        else await sendWA(fromPhone, `âŒ Error: ${error.message}`)
        return new Response('OK', { status: 200 })
      }
      case 'ADDSALDO':
        await supabase.from('bot_memory').upsert({ phone: `admin_action_state_${from10}`, history: [{ action: `ESPERANDO_SALDO_SUMA_${telReal}` }], updated_at: new Date().toISOString() })
        await sendWA(fromPhone, `ðŸ’° *Recargar Saldo*\nEscribe la cantidad en MXN a recargar a ${telReal} (ej. \`50\`):`)
        return new Response('OK', { status: 200 })
      case 'SUBSALDO':
        await supabase.from('bot_memory').upsert({ phone: `admin_action_state_${from10}`, history: [{ action: `ESPERANDO_SALDO_RESTA_${telReal}` }], updated_at: new Date().toISOString() })
        await sendWA(fromPhone, `ðŸ“‰ *Descontar Saldo*\nEscribe la cantidad en MXN a descontar a ${telReal} (ej. \`50\`):`)
        return new Response('OK', { status: 200 })
        
      case 'SETREP': {
        const rptType = buttonId.split('_')[3]
        if (rptType === 'EXC') return await handleSlashCommands(supabase, fromPhone, from10, `/score ${telReal} excelente`, 'btn_' + Date.now(), true)
        if (rptType === 'REG') return await handleSlashCommands(supabase, fromPhone, from10, `/score ${telReal} regular`, 'btn_' + Date.now(), true)
        if (rptType === 'VET') return await handleSlashCommands(supabase, fromPhone, from10, `/vetar ${telReal}`, 'btn_' + Date.now(), true)
        return new Response('OK', { status: 200 })
      }
      case 'TOGVIP': return await handleSlashCommands(supabase, fromPhone, from10, `/score ${telReal} vip`, 'btn_' + Date.now(), true)
      case 'SETREPART': return await handleSlashCommands(supabase, fromPhone, from10, `/rol ${telReal} repartidor`, 'btn_' + Date.now(), true)
      case 'RMVROL': return await handleSlashCommands(supabase, fromPhone, from10, `/rol ${telReal} quitar`, 'btn_' + Date.now(), true)
    }
  }

  const actionsMap: Record<string, { cmd: string; desc: string }> = {
    'ACT_MENU_NOREGO': { cmd: 'Registro Silencioso', desc: 'iniciar la sesiÃ³n de captura silenciosa' },
    'ACT_MENU_LOYALTY': { cmd: 'Registro Loyalty', desc: 'enviar invitaciÃ³n y abrir captura' },
    'ACT_MENU_INFO': { cmd: 'Ficha de Cliente', desc: 'ver su perfil completo' },
    'ACT_MENU_QR': { cmd: 'Enviar Tarjeta VIP', desc: 'enviarle su QR' },
    'ACT_MENU_SCORE': { cmd: 'Calificar Cliente', desc: 'asignarle una reputaciÃ³n' },
    'ACT_MENU_SUMAR': { cmd: 'Sumar Puntos', desc: 'sumarle 1 punto (o mÃ¡s con /puntos 963... 3)' },
    'ACT_MENU_REGALAR': { cmd: 'Regalar EnvÃ­o', desc: 'obsequiarle un envÃ­o gratis' },
    'ACT_MENU_REST': { cmd: 'Ver Clientes de Restaurante', desc: 'escribir el telÃ©fono del restaurante a consultar' },
  }

  const actionInfo = actionsMap[buttonId]
  if (actionInfo) {
    // Guardar estado en memoria
    await supabase.from('bot_memory').upsert({
      phone: `admin_action_state_${from10}`,
      history: [{ action: buttonId }],
      updated_at: new Date().toISOString()
    })

    await sendWA(
      fromPhone,
      `ðŸ“ *${actionInfo.cmd}*\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n\nPor favor, escribe el *nÃºmero a 10 dÃ­gitos* del cliente para ${actionInfo.desc}:`
    )
    return new Response('OK', { status: 200 })
  }

  // Editar campos especÃ­ficos de cliente
  if (buttonId.startsWith('EDIT_')) {
    const action = buttonId.slice(0, 8) // e.g., EDIT_NOM, EDIT_SCO
    const tel10 = buttonId.slice(9)
    
    // Si la acciÃ³n es SCORE, mostrar directamente la lista de calificaciones
    if (action === 'EDIT_SCO') {
      await sendInteractiveList(
        fromPhone,
        `â­ *Calificar Cliente* â€” \`${tel10}\`\nPor favor selecciona la reputaciÃ³n que le asignarÃ¡s:`,
        `Elegir ReputaciÃ³n`,
        [{
          title: 'Reputaciones',
          rows: [
            { id: `RATE_EXC_${tel10}`, title: 'â­ Excelente' },
            { id: `RATE_BUE_${tel10}`, title: 'ðŸ‘ Bueno' },
            { id: `RATE_REG_${tel10}`, title: 'âš ï¸ Regular' },
            { id: `RATE_MAL_${tel10}`, title: 'âŒ Malo' },
            { id: `VETAR_${tel10}`, title: 'ðŸš« Vetado' }
          ]
        }]
      )
      return new Response('OK', { status: 200 })
    }

    let desc = ''
    if (action === 'EDIT_NOM') desc = 'el nuevo NOMBRE del cliente'
    else if (action === 'EDIT_DIR') desc = 'la nueva DIRECCIÃ“N (colonia, calle, ref)'
    else if (action === 'EDIT_NOT') desc = 'las nuevas NOTAS CRM (o escribe "borrar" para eliminarlas)'
    
    if (desc) {
      await supabase.from('bot_memory').upsert({
        phone: `admin_action_state_${from10}`,
        history: [{ action, tel: tel10 }],
        updated_at: new Date().toISOString()
      })
      await sendWA(fromPhone, `âœï¸ Escribe ${desc}:`)
      return new Response('OK', { status: 200 })
    }
  }

  // Drill-down: el admin seleccionÃ³ un cliente de la lista del restaurante
  if (buttonId.startsWith('ADMIN_REST_CLI_')) {
    const tel10 = buttonId.replace('ADMIN_REST_CLI_', '').trim()
    // Redirige al mismo flujo que /info
    return await handleSlashCommands(supabase, fromPhone, from10, `/info ${tel10}`, 'btn_' + Date.now(), true)
  }

  // Cerrar SesiÃ³n (viniendo del botÃ³n)
  if (buttonId === 'ACT_CERRAR_SESION') {
    return await handleSlashCommands(supabase, fromPhone, from10, '/fin', 'btn_' + Date.now(), true)
  }

  return null
}
