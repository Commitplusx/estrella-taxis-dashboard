// ═══════════════════════════════════════════════════════════════════════════
// mandadito/multi-stop.ts — Máquina de estados para rutas Multi-Parada
// ═══════════════════════════════════════════════════════════════════════════

import { sendWA, sendInteractiveButtons, sendLocationRequest } from '../whatsapp.ts'
import { resolverUbicacion } from './geo.ts'
import { calcularPrecioMultiParada } from './pricing.ts'
import type { UbicacionMandadito, EstadoMandadito, UbicacionResuelta, ParadaMandadito } from './types.ts'

export async function avanzarMultiParada(
  supabase: any,
  fromPhone: string,
  from10: string,
  currentState: EstadoMandadito,
  ubicacionRecibida?: UbicacionMandadito
): Promise<void> {
  // 🚨 ESCAPE: cancelar en cualquier paso del multi-stop
  const PALABRAS_ESCAPE = new Set(['cancelar', 'cancel', 'salir', 'exit', 'no quiero', 'olvida', 'olídalo', 'olvidalo', 'stop', 'parar'])
  const txtEscape = ubicacionRecibida?.texto?.trim().toLowerCase() || ''
  if (PALABRAS_ESCAPE.has(txtEscape)) {
    await supabase.from('bot_memory').delete().eq('phone', `mandadito_state_${from10}`)
    await sendWA(fromPhone, `✅ Solicitud cancelada. ¡Cuando quieras cotizar un envío, aquí estoy! 🛵`)
    return
  }

  // 🔧 VALIDACIÓN: Estado corrupto → recuperar y notificar admin
  const hasParadas = currentState.paradas || currentState.originalState?.paradas;
  if (!hasParadas && (currentState.step === 10 || currentState.step === 10.5 || currentState.step === 10.6)) {
    await supabase.from('bot_memory').delete().eq('phone', `mandadito_state_${from10}`)
    await sendWA(fromPhone, `🔄 Ocurrió un pequeño error en tu sesión. No te preocupes, vamos de nuevo.\n\n¿En qué te puedo ayudar? 😊`)
    const ADMIN_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
    const adminPhones = ADMIN_ENV.split(',').map((p: string) => p.replace(/\D/g, '').slice(-10)).filter(Boolean)
    for (const ap of adminPhones) {
      sendWA(`52${ap}`, `⚠️ *Multi-stop corrupto* para wa.me/${fromPhone}\nEstado: ${JSON.stringify(currentState).substring(0, 200)}`).catch(() => {})
    }
    return
  }

  let step = currentState.step
  let paradas = currentState.paradas || []
  let resolvingIndex = currentState.resolvingIndex || 0

  // 1. Procesar respuesta del cliente si venimos de un sub-estado
  if (ubicacionRecibida && (step === 10.5 || step === 10.6)) {
    // Aquí el cliente está aclarando una parada
    if (step === 10.5) {
      // Aclaración de opciones (Mapas)
      const txtResp = ubicacionRecibida.texto?.toLowerCase() || ''
      const match = txtResp.match(/(?:opcion|opción|numero|número|\b)\s*(\d+)/) || txtResp.match(/\d+/)
      const num = match ? parseInt(match[match.length - 1], 10) : 0
      const opciones = currentState.opciones || []
      
      // Intentar hacer match por texto de la opción si no hay número
      let selIndex = -1
      if (num >= 1 && num <= opciones.length + 1) {
        selIndex = num - 1
      } else {
        // Fallback: buscar si el texto contiene el nombre de alguna opción
        for (let i = 0; i < opciones.length; i++) {
          if (opciones[i].name && txtResp.includes(opciones[i].name.toLowerCase())) {
            selIndex = i
            break
          }
        }
      }

      if (selIndex === -1) {
        await sendWA(fromPhone, `⚠️ Responde con el número de la opción deseada (del 1 al ${opciones.length + 1}).`)
        return
      }
      
      if (selIndex === opciones.length) {
        // Ninguna de las anteriores, pedir que la escriba de nuevo
        const newState = { ...currentState.originalState! }
        newState.paradas![resolvingIndex].ubicacion = { texto: '' } // para forzar repregunta
        await avanzarMultiParada(supabase, fromPhone, from10, { step: 10, ...newState })
        return
      }
      
      const sel = opciones[selIndex]
      currentState = { ...currentState.originalState! }
      currentState.paradas![resolvingIndex].ubicacion = { lat: sel.lat, lng: sel.lng, texto: sel.name }
      currentState.step = 10
    }

    if (step === 10.6) {
      // Aclaración de referencia / calle
      // 🛡️ FIX #4: Leer coloniaAnterior ANTES de sobreescribir con originalState
      const colAnterior = currentState.coloniaAnterior || ''
      currentState = { ...currentState.originalState! }
      const prefix = colAnterior ? `${colAnterior}, ` : ''
      currentState.paradas![resolvingIndex].ubicacion.texto = `${prefix}${ubicacionRecibida.texto}`
      currentState.step = 10
    }
    
    // Sincronizar variables locales con el nuevo currentState
    step = currentState.step
    paradas = currentState.paradas || []
    resolvingIndex = currentState.resolvingIndex || 0
    
  } else if (ubicacionRecibida && step === 10) {
    const paradaActual = paradas[resolvingIndex]
    const paradaVacia = !paradaActual.ubicacion.texto && !paradaActual.ubicacion.lat
    const tieneTexto = ubicacionRecibida.texto && ubicacionRecibida.texto !== ''
    const tieneGPS = ubicacionRecibida.lat && ubicacionRecibida.lng

    // Aceptar tanto texto como pin GPS para rellenar una parada vacía
    if (paradaVacia && (tieneTexto || tieneGPS)) {
      currentState.paradas![resolvingIndex].ubicacion = ubicacionRecibida
    }
  }

  // 2. Loop de resolución de paradas
  while (resolvingIndex < paradas.length) {
    const paradaActual = paradas[resolvingIndex]
    
    // Si la parada NO tiene texto ni coordenadas (ej. destino implícito que falló), preguntar
    if (!paradaActual.ubicacion.texto && !paradaActual.ubicacion.lat) {
      const { sendLocationRequest } = await import('../whatsapp.ts')
      
      const { generarAclaracionConversacional } = await import('./ai.ts')
      const msg = await generarAclaracionConversacional('', [paradaActual.tipo], 'pedir_ubicacion_vacia')
      await sendWA(fromPhone, msg)
      
      // Guardar estado esperando
      await supabase.from('bot_memory').upsert({
        phone: `mandadito_state_${from10}`,
        history: [{ step: 10, paradas, resolvingIndex, ts: Date.now() }],
        updated_at: new Date().toISOString()
      })
      return
    }

    // Intentar resolver la ubicación
    const textoParada = paradaActual.ubicacion.texto || `Parada #${resolvingIndex + 1}`
    console.log(`📍 [MULTI-STOP] Resolviendo parada ${resolvingIndex + 1}/${paradas.length} (${paradaActual.tipo}): "${textoParada}"`)
    const resolucion = await resolverUbicacion(supabase, paradaActual.ubicacion, from10)

    if (resolucion?.requiereAclaracion) {
      console.log(`🔀 [MULTI-STOP] Múltiples opciones para "${textoParada}": ${resolucion.opciones!.map(o => o.name).join(', ')}`)
      const { generarAclaracionConversacional } = await import('./ai.ts')
      const nombresOpciones = resolucion.opciones!.map(o => o.name)
      const msg = await generarAclaracionConversacional(paradaActual.ubicacion.texto || '', nombresOpciones, 'multiples_opciones')
      await sendWA(fromPhone, msg)
      await supabase.from('bot_memory').upsert({
        phone: `mandadito_state_${from10}`,
        history: [{ step: 10.5, opciones: resolucion.opciones, resolvingIndex, originalState: { step: 10, paradas, resolvingIndex }, ts: Date.now() }],
        updated_at: new Date().toISOString()
      })
      return
    }

    if (resolucion?.requiereAclaracionReferencia) {
      console.log(`🏘️ [MULTI-STOP] Solo colonia detectada para "${textoParada}", pidiendo calle/referencia.`)
      const { generarAclaracionConversacional } = await import('./ai.ts')
      const msg = await generarAclaracionConversacional(resolucion.coloniaFaltante || '', [], 'pedir_calle')
      await sendWA(fromPhone, msg)
      await supabase.from('bot_memory').upsert({
        phone: `mandadito_state_${from10}`,
        history: [{ step: 10.6, coloniaAnterior: resolucion.coloniaFaltante, resolvingIndex, originalState: { step: 10, paradas, resolvingIndex }, ts: Date.now() }],
        updated_at: new Date().toISOString()
      })
      return
    }

    if (!resolucion?.colonia) {
      const intentos = (currentState.intentosFallidos || 0) + 1
      console.warn(`❌ [MULTI-STOP] No se pudo resolver "${textoParada}" (intento ${intentos}/2)`)      
      if (intentos >= 2) {
        // 🚀 GRACEFUL DEGRADATION: Fallback usando AI para limpiar la letanía.
        // ─── C-3: NO asignar coords hardcodeadas del centro de Comitán ─────────
        // Correcto: lat/lng quedan null → el repartidor usa SOLO el texto de la parada.
        currentState.intentosFallidos = 0
        const { limpiarTextoFallback } = await import('./ai.ts')
        const { nombreCorto, instruccionExtra } = await limpiarTextoFallback(paradaActual.ubicacion.texto || '')

        console.log(`🔧 [MULTI-STOP] Fallback AI activado para "${textoParada}" → nombre corto: "${nombreCorto}"`)

        paradas[resolvingIndex].ubicacion = {
          lat: null as any,
          lng: null as any,
          texto: nombreCorto
        }

        if (instruccionExtra && instruccionExtra !== nombreCorto) {
          paradas[resolvingIndex].instruccion = paradas[resolvingIndex].instruccion
            ? `${paradas[resolvingIndex].instruccion}\n(Nota: ${instruccionExtra})`
            : instruccionExtra
        }

        ;(paradas[resolvingIndex] as any)._coloniaObj = { lat: null, lng: null, nombre: nombreCorto }
        resolvingIndex++
        continue // Avanzar a la siguiente parada sin retornar

      }

      const { generarAclaracionConversacional } = await import('./ai.ts')
      const msg = await generarAclaracionConversacional(paradaActual.ubicacion.texto || '', [], 'ubicacion_no_encontrada')
      await sendLocationRequest(fromPhone, msg)
      
      // Limpiar texto para forzar que la vuelva a escribir
      paradas[resolvingIndex].ubicacion.texto = ''
      await supabase.from('bot_memory').upsert({
        phone: `mandadito_state_${from10}`,
        history: [{ step: 10, paradas, resolvingIndex, intentosFallidos: intentos, ts: Date.now() }],
        updated_at: new Date().toISOString()
      })
      return
    }

    // Resetear intentos al tener éxito
    currentState.intentosFallidos = 0

    // Si pasamos las aclaraciones, la parada está resuelta
    paradas[resolvingIndex].ubicacion = {
      lat: resolucion.colonia.lat,
      lng: resolucion.colonia.lng,
      texto: resolucion.colonia.nombre // Normalizado
    }
    console.log(`✅ [MULTI-STOP] Parada ${resolvingIndex + 1} resuelta → "${resolucion.colonia.nombre}" (lat:${resolucion.colonia.lat.toFixed(4)}, lng:${resolucion.colonia.lng.toFixed(4)}, precio:$${resolucion.colonia.precio})`)
    
    // Inyectar el precio h3 en la parada temporalmente
    ;(paradas[resolvingIndex] as any)._coloniaObj = resolucion.colonia
    
    resolvingIndex++
  }

  // 3. Si salimos del loop, todas las paradas están resueltas!
  console.log(`🎯 [MULTI-STOP] Todas las paradas resueltas (${paradas.length}). Procediendo a cotización.`)
  
  // 🛡️ FIX #2: Validar que el viaje termina con un destino de entrega
  const ultimaParada = paradas[paradas.length - 1]
  if (ultimaParada && ultimaParada.tipo !== 'entregar' && ultimaParada.tipo !== 'destino') {
    const { generarAclaracionConversacional } = await import('./ai.ts')
    const msg = await generarAclaracionConversacional('', [], 'pedir_destino')
    await sendWA(fromPhone, msg)
    
    // Inyectar parada vacía de tipo 'entregar' para forzar la resolución en el siguiente ciclo
    paradas.push({ tipo: 'entregar', ubicacion: { texto: '' } })
    
    await supabase.from('bot_memory').upsert({
      phone: `mandadito_state_${from10}`,
      history: [{ step: 10, paradas, resolvingIndex, ts: Date.now() }],
      updated_at: new Date().toISOString()
    })
    return
  }

  // ─── C-2: Propagar el role real del cliente, no asumir siempre 'recibo' ──
  const roleCliente = currentState.role || 'envio'
  await cotizarMultiParadaFinal(supabase, fromPhone, from10, paradas, roleCliente)
}

async function cotizarMultiParadaFinal(
  supabase: any,
  fromPhone: string,
  from10: string,
  paradas: any[],
  role: 'envio' | 'recibo' = 'envio'
): Promise<void> {
  await sendWA(fromPhone, `🗺️ *Un momento, estoy calculando tu envío...* 🚀`)

  // Extraer las colonias resueltas
  const coloniasResueltas: UbicacionResuelta[] = paradas.map(p => p._coloniaObj)
  
  // Calcular precio H3 Multi-Stop
  const { precioFinal, lluviaActiva, recargoLluvia } = await calcularPrecioMultiParada(supabase, coloniasResueltas)

  // Resumen visual
  let msg = `🧾 *RESUMEN DE TU SERVICIO* 🧾\n`
  
  const paradasCerradas = paradas.filter(p => p._coloniaObj?.estaCerrado)
  if (paradasCerradas.length > 0) {
    const lugaresCerrados = paradasCerradas.map(p => p.ubicacion.texto).join(', ')
    msg = `⚠️ *¡Ojo!* Detecto que *${lugaresCerrados}* podrían estar cerrados ahorita. Confirma solo si estás seguro que atienden.\n\n` + msg
  }

  msg += `───────────────\n`

  for (let i = 0; i < paradas.length; i++) {
    const p = paradas[i]
    const icono = p.tipo === 'comprar' ? '🛒' : p.tipo === 'recoger' ? '📦' : '🏁'
    
    const isFirst = i === 0
    const isLast = i === paradas.length - 1
    
    if (isFirst) {
      msg += `📍 *Punto de recolección:* ${p.ubicacion.texto}\n`
    } else if (isLast) {
      msg += `🏁 *Punto de entrega:* ${p.ubicacion.texto}\n`
    } else {
      msg += `${icono} *Parada intermedia:* ${p.ubicacion.texto}\n`
    }
    
    if (p.instruccion) msg += `   └ _"${p.instruccion}"_\n`
  }

  msg += `───────────────\n`

  if (lluviaActiva) msg += `☔ _+ $${recargoLluvia} por alta demanda/lluvia_\n`
  // El cliente pidió quitar el precio de la cotización
  // msg += `💵 *Costo aproximado:* ~$${precioFinal} MXN\n`
  // msg += `_(Puede bajar si los lugares están muy cerca)_\n`
  
  const compras = paradas.filter(p => p.tipo === 'comprar')
  if (compras.length > 0) {
    msg += `\n_Nota: El costo de los productos se te cobrará en efectivo al entregarte._`
  }

  // 🛡️ FIX #3: Guardar origenDisplay/destinoDisplay para que CONFIRMAR_MANDADITO los muestre
  const origenDisplay = paradas[0]?.ubicacion?.texto || 'Origen'
  const destinoDisplay = paradas[paradas.length - 1]?.ubicacion?.texto || 'Destino'

  // Guardar estado de confirmación
  await supabase.from('bot_memory').upsert({
    phone: `mandadito_state_${from10}`,
    history: [{
      step: 4,
      v: 2,
      ts: Date.now(),
      cotizacion: {
        precioFinal,
        origenDisplay,
        destinoDisplay,
        origenLat: paradas[0]?._coloniaObj?.lat,
        origenLng: paradas[0]?._coloniaObj?.lng,
        destinoLat: paradas[paradas.length - 1]?._coloniaObj?.lat,
        destinoLng: paradas[paradas.length - 1]?._coloniaObj?.lng,
        esMultiParada: true,
        paradas,
        telefono: from10,
        role // ─── C-2: Role real del cliente (no hardcodeado a 'recibo')
      }
    }],
    updated_at: new Date().toISOString()
  })

  await sendInteractiveButtons(fromPhone, msg, [
    { id: 'CONFIRMAR_MANDADITO', title: '✅ Confirmar viaje' },
    { id: 'CANCELAR_MANDADITO',  title: '❌ Cancelar'  }
  ])
}
