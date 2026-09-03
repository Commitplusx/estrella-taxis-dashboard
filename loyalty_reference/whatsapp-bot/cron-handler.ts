import { sendWAImage, sendWATemplate } from './whatsapp.ts'

export async function handleCronEvent(supabase: any, body: any): Promise<Response | null> {
  // ── Promo a clientes nuevos (5 horas despues del registro) ──
  if (body.event === 'CRON_PROMO') {
    const limiteSuperior = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
    const limiteInferior  = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

    const { data: clientes } = await supabase.from('clientes')
      .select('id, telefono, nombre')
      .gte('created_at', limiteInferior)
      .lte('created_at', limiteSuperior)
      .eq('acepta_terminos', true)
      .limit(100)

    if (clientes) {
      for (const c of clientes) {
        // ✅ Deduplicar con cliente_eventos (antes usaba [PROMO_5H] en notas_crm)
        const { data: yaEnviado } = await supabase
          .from('cliente_eventos')
          .select('id')
          .eq('cliente_id', c.id)
          .eq('tipo', 'PROMO_5H')
          .maybeSingle()
        if (yaEnviado) continue

        const promoImg = body.promoUrl || 'https://res.cloudinary.com/dlgcf3cht/image/upload/v1731610444/promo_doble_puntos.png'
        const nombre   = c.nombre ? c.nombre.split(' ')[0] : 'Cliente'
        const caption  = `🎁 *¡Hola ${nombre}!* Queremos darte una bienvenida especial.\n\nSolo por HOY, si haces tu primer pedido a través de *Estrella Delivery*, ganarás el **DOBLE DE PUNTOS** ⭐⭐ en tu Tarjeta VIP.\n\n¿Qué se te antoja pedir? 🛵💨`

        const res = await sendWAImage(`52${c.telefono}`, promoImg, caption)

        // ✅ Registrar en cliente_eventos (ya no se toca notas_crm)
        await supabase.from('cliente_eventos').insert({
          cliente_id: c.id,
          tipo: 'PROMO_5H',
          metadata: { status: res.ok ? 'Enviada' : 'Fallida' }
        })
      }
    }
    return new Response('Cron Processed', { status: 200 })
  }

  // ── Reactivación de clientes inactivos (20+ días sin sumar puntos) ──
  if (body.event === 'CRON_REACTIVACION') {
    const hace20Dias = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    const hace7Dias  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString()

    // Clientes que aceptaron T&C
    const { data: clientesInactivos } = await supabase.from('clientes')
      .select('id, telefono, nombre, puntos')
      .eq('acepta_terminos', true)
      .not('telefono', 'is', null)
      .limit(50) // BUG FIX: Prevent function timeout

    if (!clientesInactivos?.length) return new Response('OK', { status: 200 })

    // Obtener última actividad de TODOS en una sola query (evita N+1)
    const telefonos = clientesInactivos.map((c: any) => c.telefono).filter(Boolean)
    const { data: todasActividades } = telefonos.length > 0
      ? await supabase
          .from('restaurante_clientes_puntos')
          .select('cliente_tel, updated_at')
          .in('cliente_tel', telefonos)
          .order('updated_at', { ascending: false })
      : { data: [] }

    // Mapa de última actividad por teléfono
    const ultimaActividadMap: Record<string, string> = {}
    for (const act of (todasActividades || [])) {
      if (!ultimaActividadMap[act.cliente_tel]) {
        ultimaActividadMap[act.cliente_tel] = act.updated_at
      }
    }

    let enviados = 0
    for (const c of clientesInactivos) {
      // ✅ Deduplicar con cliente_eventos (antes parseaba [REACTIV fecha] de notas_crm)
      const { data: ultimoReactiv } = await supabase
        .from('cliente_eventos')
        .select('created_at')
        .eq('cliente_id', c.id)
        .eq('tipo', 'REACTIV')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (ultimoReactiv && new Date(ultimoReactiv.created_at) > new Date(hace7Dias)) continue

      // Verificar inactividad usando el mapa pre-cargado (sin N+1)
      const ultimaFecha = ultimaActividadMap[c.telefono] || null
      if (ultimaFecha && new Date(ultimaFecha) > new Date(hace20Dias)) continue

      const nombre = c.nombre?.split(' ')[0] || 'Cliente'
      const puntos = c.puntos || 0
      const tel    = c.telefono

      try {
        const tplRes = await sendWATemplate(
          `52${tel}`,
          'estrella_puntos_acumulados',
          [nombre, '0', puntos.toString()],
          undefined,
          tel
        )
        if (!tplRes.ok) {
          await sendWAImage(
            `52${tel}`,
            'https://res.cloudinary.com/dlgcf3cht/image/upload/v1731610444/promo_doble_puntos.png',
            `👋 *¡${nombre}, te extrañamos!*\n\nLleva un tiempo que no acumulas puntos en el programa VIP de *Estrella Delivery* 🌟\n\n¡Visita uno de nuestros restaurantes aliados esta semana y gana el *doble de puntos*! ⭐⭐\n\n💳 Tus puntos actuales: *${puntos} pts*`
          )
        }

        // ✅ Registrar en cliente_eventos (ya no se toca notas_crm)
        await supabase.from('cliente_eventos').insert({
          cliente_id: c.id,
          tipo: 'REACTIV',
          metadata: { puntos: puntos }
        })
        enviados++

        // Throttle: 400ms entre mensajes para no saturar Meta API
        await new Promise(r => setTimeout(r, 400))
      } catch (e) {
        console.error(`[CRON_REACTIVACION] Error enviando a ${tel}:`, e)
      }
    }

    console.log(`[CRON_REACTIVACION] Completada. Mensajes enviados: ${enviados}`)
    return new Response(`Reactivación procesada: ${enviados} mensajes`, { status: 200 })
  }

  // ── 📊 Reporte Semanal Automático (Lunes 9 AM México) ──────────────────────
  if (body.event === 'CRON_REPORTE_SEMANAL') {
    const hace7Dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: restaurantes } = await supabase
      .from('restaurantes')
      .select('id, nombre, telefono')
      .eq('activo', true)
      .not('telefono', 'is', null)

    if (!restaurantes?.length) return new Response('Sin restaurantes activos', { status: 200 })

    const { sendWA } = await import('./whatsapp.ts')

    for (const rest of restaurantes) {
      // Métricas de pedidos Y lealtad en paralelo
      const [{ data: pedidos }, { data: logs }] = await Promise.all([
        supabase.from('pedidos').select('id, estado, total')
          .eq('restaurante_id', rest.id).gte('created_at', hace7Dias),
        supabase.from('restaurante_loyalty_log').select('accion, valor, cliente_tel')
          .eq('restaurante_id', rest.id).gte('created_at', hace7Dias)
      ])

      // Si no hubo actividad alguna esa semana, saltar
      if (!pedidos?.length && !logs?.length) continue

      // Métricas de lealtad
      const nuevosAfiliados = logs?.filter((l: any) => l.accion === 'afiliar_cliente').length || 0
      const ptsSumados      = logs?.filter((l: any) => l.accion === 'sumar_puntos').reduce((s: number, l: any) => s + (l.valor || 0), 0) || 0
      const enviosRegalados = logs?.filter((l: any) => l.accion === 'regalar_envio').length || 0
      const visitasUnicas   = new Set(logs?.filter((l: any) => l.accion === 'sumar_puntos').map((l: any) => l.cliente_tel)).size

      // Top 3 clientes más frecuentes de la semana
      const frecuencia: Record<string, number> = {}
      logs?.filter((l: any) => l.accion === 'sumar_puntos').forEach((l: any) => {
        frecuencia[l.cliente_tel] = (frecuencia[l.cliente_tel] || 0) + 1
      })
      const top3 = Object.entries(frecuencia)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([tel, visitas], i) => `  ${['🥇','🥈','🥉'][i]} \`${tel}\` — ${visitas} visita${visitas > 1 ? 's' : ''}`)
        .join('\n')

      // Métricas de pedidos (delivery)
      const totalFacturado = pedidos?.reduce((acc: number, p: any) => acc + (Number(p.total) || 0), 0) || 0
      const entregados = pedidos?.filter((p: any) => p.estado === 'entregado').length || 0

      const fechaInicio = new Date(hace7Dias).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
      const fechaFin    = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })

      const reporte = [
        `📊 *REPORTE SEMANAL*`,
        `🏪 *${rest.nombre.toUpperCase()}*`,
        `📅 ${fechaInicio} — ${fechaFin}`,
        `═══════════════════════════`,
        ``,
        `⭐ *Programa de Lealtad:*`,
        `   👥 Visitas únicas: *${visitasUnicas}*`,
        `   🆕 Nuevos clientes: *${nuevosAfiliados}*`,
        `   🏆 Puntos sumados: *${ptsSumados}*`,
        `   🎁 Envíos regalados: *${enviosRegalados}*`,
        pedidos?.length ? `\n🛵 *Delivery:* ${pedidos.length} pedidos — ${entregados} entregados` + (totalFacturado > 0 ? ` — $${totalFacturado.toFixed(0)}` : '') : '',
        top3 ? `\n🏆 *Top clientes de la semana:*\n${top3}` : '',
        ``,
        `═══════════════════════════`,
        `💡 _Reporte automático de Estrella Delivery_`
      ].filter(Boolean).join('\n')

      const tel10 = rest.telefono.slice(-10)
      await sendWA(`52${tel10}`, reporte)
      await new Promise(r => setTimeout(r, 500))
    }

    return new Response('Reportes semanales enviados', { status: 200 })
  }

  // ── 🌧️ Detección automática de lluvia (Open-Meteo) ──────────────────────────
  if (body.event === 'CRON_CLIMA') {
    const lat = 16.2516
    const lng = -92.1332
    
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=precipitation`
      const res = await fetch(url, { headers: { 'User-Agent': 'EstrellaBot/1.0' } })
      
      if (!res.ok) {
        const errText = await res.text()
        console.error(`[CRON_CLIMA] Error de Open-Meteo HTTP ${res.status}: ${errText.substring(0, 100)}`)
        return new Response('Error consultando API clima', { status: 500 })
      }
      
      const data = await res.json()
      const precip = data.current?.precipitation || 0

      // Consideramos lluvia si precipitación > 0.1mm o si estamos en modo prueba
      if (precip > 0.1 || body.testMode) {
        const { data: configRow } = await supabase.from('app_config').select('configuracion_precios').eq('id', 'default').maybeSingle()
        const config = configRow?.configuracion_precios || {}
        
        // Si no está activo el modo lluvia
        if (config.modo_lluvia !== true) {
          const lastAlert = config.ultima_alerta_lluvia
          const twoHours = 2 * 60 * 60 * 1000
          
          if (!lastAlert || (Date.now() - new Date(lastAlert).getTime()) > twoHours || body.testMode) {
            const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
            const adminPhoneMain = ADMIN_PHONES_ENV.split(',')[0]?.replace(/\D/g, '').slice(-10)
            
            if (adminPhoneMain) {
              const { sendInteractiveList } = await import('./whatsapp.ts')
              await sendInteractiveList(
                `52${adminPhoneMain}`,
                `🌧️ *Alerta de Lluvia:* El sistema detectó lluvia en Comitán (${precip} mm).\n\nElige de la lista de abajo de cuánto quieres que sea el recargo para los mandaditos:`,
                'Activar Modo Lluvia',
                [{
                  title: 'Opciones de Recargo',
                  rows: [
                    { id: 'cmd_lluvia_10', title: '+$10 Pesos', description: 'Lluvia ligera' },
                    { id: 'cmd_lluvia_15', title: '+$15 Pesos', description: 'Lluvia moderada' },
                    { id: 'cmd_lluvia_20', title: '+$20 Pesos', description: 'Lluvia fuerte' },
                    { id: 'cmd_lluvia_0',  title: 'Apagar', description: 'Desactivar recargo' }
                  ]
                }]
              )
              
              config.ultima_alerta_lluvia = new Date().toISOString()
              await supabase.from('app_config').update({ configuracion_precios: config }).eq('id', 'default')
              console.log(`[CRON_CLIMA] Alerta de lluvia enviada al admin (${precip}mm).`)
            }
          } else {
            console.log(`[CRON_CLIMA] Lluvia detectada (${precip}mm), pero ya se avisó hace menos de 2h.`)
          }
        } else {
          console.log(`[CRON_CLIMA] Lluvia detectada (${precip}mm), pero el modo lluvia ya está activo.`)
        }
      } else {
        console.log(`[CRON_CLIMA] Clima despejado (${precip}mm).`)
      }
      return new Response('Cron Clima procesado', { status: 200 })
    } catch (e) {
      console.error('[CRON_CLIMA] Error consultando clima:', e)
      return new Response('Error interno', { status: 500 })
    }
  }

  // ── 🧪 TEST IA REAL (DESHABILITADO — mandadito-handler.ts eliminado mientras el feature está en pausa) ──────────────────────────
  if (body.event === 'CRON_TEST_IA') {
    return new Response('Test de mandaditos deshabilitado temporalmente (feature en pausa).', { status: 200 })
  }



  // ── ⏱️ Vigía de Logística (SLA Watchdog) ──────────────────────────
  if (body.event === 'CRON_VIGIA_LOGISTICA') {
    const ahora = Date.now()
    const hace10Min = new Date(ahora - 10 * 60 * 1000).toISOString()
    const hace30Min = new Date(ahora - 30 * 60 * 1000).toISOString()
    const hace2Horas = new Date(ahora - 120 * 60 * 1000).toISOString()

    try {
      const { data: pedidos } = await supabase
        .from('pedidos')
        .select('id, estado, updated_at, repartidor_id, repartidores(nombre, telefono)')
        .in('estado', ['buscando_repartidor', 'asignado', 'en_camino'])
        .gte('created_at', hace2Horas)

      if (pedidos && pedidos.length > 0) {
        const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
        const adminPhoneMain = ADMIN_PHONES_ENV.split(',')[0]?.replace(/\D/g, '').slice(-10)
        const { sendWA } = await import('./whatsapp.ts')

        for (const p of pedidos) {
          const estadoDate = new Date(p.updated_at).getTime()
          
          // 1. Buscando repartidor por >10 min
          if (p.estado === 'buscando_repartidor' && estadoDate < new Date(hace10Min).getTime()) {
             if (adminPhoneMain) await sendWA(`52${adminPhoneMain}`, `🚨 *Vigía Logística:* El pedido #${p.id} lleva más de 10 min "Buscando Repartidor". ¡Revisa el tablero!`)
             await supabase.from('pedidos').update({ updated_at: new Date().toISOString() }).eq('id', p.id)
             await new Promise(r => setTimeout(r, 400))
          }
          
          // 2. Asignado / En camino por >30 min sin entregar
          if ((p.estado === 'asignado' || p.estado === 'en_camino') && estadoDate < new Date(hace30Min).getTime()) {
             const repName = p.repartidores?.nombre || 'Repartidor'
             const repPhone = p.repartidores?.telefono
             if (repPhone) {
               await sendWA(`52${repPhone.slice(-10)}`, `⚠️ *Vigía Logística:* Hola ${repName}, llevas más de 30 minutos con el pedido #${p.id}. ¿Tuviste algún problema? Responde aquí o avisa a base.`)
               await new Promise(r => setTimeout(r, 400))
             }
             if (adminPhoneMain) {
               await sendWA(`52${adminPhoneMain}`, `🚨 *Vigía Logística:* El repartidor ${repName} lleva más de 30 min con el pedido #${p.id}.`)
               await new Promise(r => setTimeout(r, 400))
             }
             await supabase.from('pedidos').update({ updated_at: new Date().toISOString() }).eq('id', p.id)
          }
        }
      }
      return new Response('Cron Vigía Logística procesado', { status: 200 })
    } catch (e) {
      console.error('[CRON_VIGIA_LOGISTICA] Error:', e)
      return new Response('Error interno', { status: 500 })
    }
  }

  // ── 🎂 Felicitaciones de Cumpleaños (9 AM cada día) ──────────────────────────
  if (body.event === 'CRON_CUMPLEANOS') {
    const { sendWA } = await import('./whatsapp.ts')
    const hoy = new Date()
    // Extraer mes y día en formato MM-DD para matchear cualquier año
    const mes = String(hoy.getMonth() + 1).padStart(2, '0')
    const dia = String(hoy.getDate()).padStart(2, '0')
    const patronFecha = `%-${mes}-${dia}`

    const { data: cumpleaneros } = await supabase
      .from('clientes')
      .select('id, telefono, nombre, puntos, cumpleanos')
      .like('cumpleanos', patronFecha)
      .eq('acepta_terminos', true)
      .not('telefono', 'is', null)

    if (!cumpleaneros?.length) {
      console.log('[CRON_CUMPLEANOS] Sin cumpleaños hoy.')
      return new Response('Sin cumpleaños hoy', { status: 200 })
    }

    let enviados = 0
    for (const c of cumpleaneros) {
      const nombre = c.nombre?.split(' ')[0] || 'Cliente'
      const puntosBono = 50 // Regalo de 50 puntos en cumpleaños
      const tel = c.telefono

      try {
        // Verificar que no se haya enviado ya hoy (evitar duplicados si el cron se dispara 2 veces)
        const { data: yaEnviado } = await supabase
          .from('cliente_eventos')
          .select('id')
          .eq('cliente_id', c.id)
          .eq('tipo', 'FELICITACION_CUMPLE')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .maybeSingle()

        if (yaEnviado) continue

        // Sumar puntos de regalo
        await supabase.from('clientes').update({ puntos: (c.puntos || 0) + puntosBono }).eq('id', c.id)

        // Enviar mensaje de felicitación
        const msg = [
          `🎂 *¡Feliz Cumpleaños, ${nombre}!* 🎉`,
          ``,
          `Hoy es tu día especial y en *Estrella Delivery* queremos celebrarlo contigo.`,
          ``,
          `🎁 *REGALO:* Te hemos sumado *${puntosBono} puntos extra* a tu Tarjeta VIP como obsequio de cumpleaños.`,
          `⭐ Puntos actuales: *${(c.puntos || 0) + puntosBono} pts*`,
          ``,
          `¡Que tengas un día increíble! 🥳🎊`,
          `_— El equipo de Estrella Delivery_`
        ].join('\n')

        await sendWA(`52${tel}`, msg)

        // Registrar el evento para evitar duplicados
        await supabase.from('cliente_eventos').insert({
          cliente_id: c.id,
          tipo: 'FELICITACION_CUMPLE',
          metadata: { puntos_regalados: puntosBono, telefono: tel }
        })

        enviados++
        await new Promise(r => setTimeout(r, 400)) // throttle
      } catch (e) {
        console.error(`[CRON_CUMPLEANOS] Error con ${tel}:`, e)
      }
    }

    console.log(`[CRON_CUMPLEANOS] Completado. Mensajes enviados: ${enviados}`)
    return new Response(`Cumpleaños procesados: ${enviados}`, { status: 200 })
  }

  // ── 📊 Resumen Diario a Discord (10 PM cada día) ────────────────────────────
  if (body.event === 'CRON_RESUMEN_DISCORD') {
    const webhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL')
    if (!webhookUrl) {
      console.warn('[CRON_RESUMEN_DISCORD] DISCORD_WEBHOOK_URL no configurado.')
      return new Response('Sin webhook Discord', { status: 200 })
    }

    const inicioDia = new Date()
    inicioDia.setHours(0, 0, 0, 0)
    const inicioDiaISO = inicioDia.toISOString()
    const hoy = inicioDia.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

    // Obtener métricas del día en paralelo
    const [{ data: pedidosHoy }, { data: clientesNuevos }, { data: erroresCriticos }, { data: logsLealtad }] = await Promise.all([
      supabase.from('pedidos').select('id, estado').gte('created_at', inicioDiaISO),
      supabase.from('clientes').select('id').gte('created_at', inicioDiaISO),
      supabase.from('system_logs').select('id, message').eq('level', 'critical').gte('created_at', inicioDiaISO),
      supabase.from('restaurante_loyalty_log').select('accion').gte('created_at', inicioDiaISO)
    ])

    const totalPedidos   = pedidosHoy?.length || 0
    const entregados     = pedidosHoy?.filter((p: any) => p.estado === 'entregado').length || 0
    const cancelados     = pedidosHoy?.filter((p: any) => p.estado === 'cancelado').length || 0
    const clientesNuevosCount = clientesNuevos?.length || 0
    const erroresCount   = erroresCriticos?.length || 0
    const puntosLogCount = logsLealtad?.filter((l: any) => l.accion === 'sumar_puntos').length || 0

    const estadoEmoji = erroresCount > 3 ? '🔴' : erroresCount > 0 ? '🟡' : '🟢'

    const discordMsg = {
      embeds: [{
        title: `📊 Resumen Diario — ${hoy}`,
        color: erroresCount > 3 ? 0xff0000 : erroresCount > 0 ? 0xffa500 : 0x00c851,
        fields: [
          { name: '🛵 Pedidos Totales', value: `**${totalPedidos}**`, inline: true },
          { name: '✅ Entregados', value: `**${entregados}**`, inline: true },
          { name: '❌ Cancelados', value: `**${cancelados}**`, inline: true },
          { name: '👥 Clientes Nuevos', value: `**${clientesNuevosCount}**`, inline: true },
          { name: '⭐ Transacciones Lealtad', value: `**${puntosLogCount}**`, inline: true },
          { name: `${estadoEmoji} Errores Críticos`, value: `**${erroresCount}**`, inline: true },
        ],
        footer: { text: 'Estrella Delivery — Bot Automático' },
        timestamp: new Date().toISOString()
      }]
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordMsg)
    })

    console.log('[CRON_RESUMEN_DISCORD] Resumen enviado a Discord.')
    return new Response('Resumen Discord enviado', { status: 200 })
  }

  // ⏱️ REINTENTOS DE LA COLA ASÍNCRONA DE WHATSAPP ⏱️
  if (body.event === 'CRON_WHATSAPP_QUEUE') {
    const hace2Minutos = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    
    // Buscar mensajes atorados en 'procesando' (crasheados por timeout) o 'pendiente' que no se lanzaron
    const { data: atorados } = await supabase.from('whatsapp_queue')
      .select('id, payload')
      .in('estado', ['pendiente', 'procesando', 'error'])
      .lt('reintentos', 3)
      .lt('updated_at', hace2Minutos)
      .limit(10)

    if (atorados && atorados.length > 0) {
      console.log(`[CRON QUEUE] Reintentando ${atorados.length} mensajes atorados...`)
      const { processQueueItem } = await import('./queue-processor.ts')
      
      for (const item of atorados) {
        // Bloquear temporalmente sumando intento
        await supabase.from('whatsapp_queue').update({ 
          estado: 'procesando', 
          reintentos: item.reintentos + 1,
          updated_at: new Date().toISOString()
        }).eq('id', item.id)

        try {
          await processQueueItem(supabase, JSON.stringify(item.payload))
          await supabase.from('whatsapp_queue').update({ estado: 'completado' }).eq('id', item.id)
        } catch (e) {
          console.error(`[CRON QUEUE ERROR] ID ${item.id}:`, e)
          await supabase.from('whatsapp_queue').update({ estado: 'error', error_log: String(e) }).eq('id', item.id)
        }
      }
    }
    return new Response('Queue Retries Processed', { status: 200 })
  }

  return null
}

