import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WA_TOKEN = Deno.env.get('YCLOUD_API_KEY') || Deno.env.get('WHATSAPP_TOKEN')!
const WA_PHONE_ID = Deno.env.get('YCLOUD_SENDER_PHONE') || Deno.env.get('WHATSAPP_PHONE_ID')!
const ADMIN_PHONES = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''

// ============================================================================
// LOGICA DE VALIDACIÓN ROBUSTA (ANTI-FRAUDE ZERO TRUST)
// ============================================================================
async function validarEInsertarPedido(supabase: any, payload: any, carrito: any[]) {
  if (!payload || !carrito || !Array.isArray(carrito) || carrito.length === 0) {
    throw new Error('Payload o carrito inválidos')
  }

  const restauranteId = payload.restaurante_id
  if (!restauranteId) throw new Error('Falta restaurante_id')

  // 1. Extraer todos los IDs únicos de items, combos y promos
  const itemIds = carrito.filter(c => c.item.tipo === 'item').map(c => c.item.id)
  const comboIds = carrito.filter(c => c.item.tipo === 'combo').map(c => c.item.id)
  const promoIds = carrito.filter(c => c.item.tipo === 'promo').map(c => c.item.id)

  // 2. Fetch de precios reales en paralelo
  const [itemsRes, combosRes, promosRes, restRes] = await Promise.all([
    itemIds.length > 0 ? supabase.from('menu_items').select('id, precio, opciones').in('id', itemIds) : { data: [] },
    comboIds.length > 0 ? supabase.from('menu_combos').select('id, precio, opciones').in('id', comboIds) : { data: [] },
    promoIds.length > 0 ? supabase.from('menu_promociones').select('id, precio_especial, opciones').in('id', promoIds) : { data: [] },
    supabase.from('restaurantes').select('envio_gratis_monto_minimo, envio_gratis_tope, cupon_activo, cupon_codigo, cupon_descuento, cupon_tipo').eq('id', restauranteId).single()
  ])

  const dbItems = itemsRes.data || []
  const dbCombos = combosRes.data || []
  const dbPromos = promosRes.data || []
  const restauranteData = restRes.data || {}

  // 3. Recalcular el subtotal real basándonos estrictamente en los precios de la BD
  let subtotalReal = 0

  for (const c of carrito) {
    const qty = c.cantidad || 1
    let precioBase = 0
    let dbProduct: any = null

    if (c.item.tipo === 'item') {
      dbProduct = dbItems.find((p: any) => p.id === c.item.id)
      if (dbProduct) precioBase = Number(dbProduct.precio)
    } else if (c.item.tipo === 'combo') {
      dbProduct = dbCombos.find((p: any) => p.id === c.item.id)
      if (dbProduct) precioBase = Number(dbProduct.precio)
    } else if (c.item.tipo === 'promo') {
      dbProduct = dbPromos.find((p: any) => p.id === c.item.id)
      if (dbProduct) precioBase = Number(dbProduct.precio_especial)
    }

    if (!dbProduct) {
      throw new Error(`Producto no encontrado en BD: ${c.item.id}`)
    }

    // Sumar opciones
    let extraPorOpciones = 0
    if (c.item.opcionesSeleccionadas && Array.isArray(c.item.opcionesSeleccionadas) && dbProduct.opciones) {
      for (const opcSel of c.item.opcionesSeleccionadas) {
        // Encontrar el grupo en la DB
        const grupoDb = (dbProduct.opciones as any[]).find(g => g.titulo === opcSel.grupo)
        if (grupoDb && grupoDb.opciones) {
          const opcionDb = grupoDb.opciones.find((o: any) => o.nombre === opcSel.opcion)
          if (opcionDb) {
            extraPorOpciones += Number(opcionDb.precio_extra || 0)
          }
        }
      }
    }

    subtotalReal += (precioBase + extraPorOpciones) * qty
  }

  // 4. Calcular el Costo de Envío Real con H3 y Bolsa de Subsidio
  let costoEnvioReal = 0
  let isFreeDelivery = false
  let tarifaBaseEnvio = 0

  if (payload.tipo_pedido === 'domicilio' && payload.lat && payload.lng) {
    try {
      const h3 = await import('https://esm.sh/h3-js')
      const hexIndex = h3.latLngToCell(payload.lat, payload.lng, 10)
      
      const { data: h3Data } = await supabase.from('h3_zonas').select('precio').eq('h3_index', hexIndex).maybeSingle()
      tarifaBaseEnvio = h3Data?.precio || 0
      
      // Aplicar reglas VIP si el cliente tiene puntos suficientes y no es VIP de saldo (es VIP normal)
      // Necesitamos validar si califica (lo hace el cliente, pero el backend lo verifica si confiamos en el puntaje de la BD)
      let puntosCliente = 0
      let enviosGratisDisponibles = 0
      let esVip = false
      if (payload.cliente_tel) {
        const { data: clientData } = await supabase.from('clientes').select('puntos, envios_gratis_disponibles, es_vip').eq('telefono', payload.cliente_tel).maybeSingle()
        if (clientData) {
          puntosCliente = clientData.puntos || 0
          enviosGratisDisponibles = clientData.envios_gratis_disponibles || 0
          esVip = clientData.es_vip || false
        }
      }

      if (esVip) {
        tarifaBaseEnvio = (puntosCliente < 26) ? 10 : 7
      }

      // Calcular subsidio (Bolsa Subsidio)
      let itemsSubsidio = 0
      for (const c of carrito) {
        if (c.item.aplica_subsidio !== false && String(c.item.aplica_subsidio).toLowerCase() !== 'false') {
          itemsSubsidio += (c.cantidad || 1)
        }
      }
      const bolsaSubsidio = itemsSubsidio * 8

      costoEnvioReal = Math.max(0, tarifaBaseEnvio - bolsaSubsidio)

      // Aplicar beneficio de envío gratis de lealtad si el cliente lo solicitó y califica
      if (payload.usar_beneficio_fidelidad && !esVip && (enviosGratisDisponibles > 0 || puntosCliente >= 6)) {
        costoEnvioReal = 0
      }

      isFreeDelivery = !!(restauranteData.envio_gratis_monto_minimo && subtotalReal >= restauranteData.envio_gratis_monto_minimo)
      if (isFreeDelivery) {
        costoEnvioReal = Math.max(0, costoEnvioReal - (restauranteData.envio_gratis_tope || 0))
      }
    } catch (e) {
      console.error("Error H3:", e)
      // Fallback a lo que envia el cliente si H3 falla, aunque no es ideal
      costoEnvioReal = Number(payload.precio_entrega || 0)
    }
  }

  // 5. Validar Cupones (Plataforma y Restaurante) y VIP
  let descuentoTotal = 0

  // 5.1 Cupón Plataforma
  if (payload.cupon_plataforma_id) {
    const { data: cupon } = await supabase.from('cupones_plataforma').select('tipo, valor, codigo').eq('id', payload.cupon_plataforma_id).single()
    if (cupon) {
      if (cupon.tipo === 'porcentaje') descuentoTotal += subtotalReal * (cupon.valor / 100)
      else if (cupon.tipo === 'fijo') descuentoTotal += cupon.valor
      else if (cupon.tipo === 'envio_gratis') costoEnvioReal = 0
    }
  }

  // 5.2 Cupón Restaurante
  if (payload.cupon_cliente && restauranteData.cupon_activo && restauranteData.cupon_codigo === payload.cupon_cliente) {
    if (restauranteData.cupon_tipo === 'porcentaje') {
      descuentoTotal += subtotalReal * (Number(restauranteData.cupon_descuento) / 100)
    } else if (restauranteData.cupon_tipo === 'fijo') {
      descuentoTotal += Number(restauranteData.cupon_descuento)
    } else if (restauranteData.cupon_tipo === 'envio_gratis') {
      costoEnvioReal = 0
    }
  }

  // 5.3 Descuento VIP (Saldo Billetera)
  let descuentoVip = 0
  if (payload.usar_saldo_vip && payload.monto_saldo_vip > 0 && payload.cliente_tel && payload.pin_vip) {
    const { data: vipData } = await supabase.from('clientes').select('saldo_billetera, es_vip, pin_seguridad').eq('telefono', payload.cliente_tel).maybeSingle()
    if (vipData && vipData.es_vip && vipData.pin_seguridad === payload.pin_vip) {
      const montoSolicitado = Number(payload.monto_saldo_vip)
      if (montoSolicitado <= Number(vipData.saldo_billetera || 0)) {
        descuentoVip = montoSolicitado
      }
    }
  }

  // Descuento aplicable no puede superar el subtotal + envio
  const descuentoAplicable = Math.min(descuentoTotal + descuentoVip, subtotalReal + costoEnvioReal)
  
  // 6. Calcular el TOTAL FINAL de forma precisa (como en el frontend)
  const rawTotal = Math.max(0, subtotalReal + costoEnvioReal - descuentoAplicable)
  const totalReal = Math.round(rawTotal * 100) / 100

  // 7. Comparar con el total enviado por el frontend (tolerancia de centavos)
  const frontendTotal = Number(payload.total || 0)
  if (Math.abs(totalReal - frontendTotal) > 0.5) {
    throw new Error(`Inconsistencia de precios (Fraude Detectado). Total calculado: ${totalReal}, Enviado: ${frontendTotal}`)
  }

  // 8. Insertar el pedido usando SERVICE ROLE (pasa por encima de RLS)
  // Forzamos que el payload tenga el total estrictamente recalculado para máxima seguridad
  payload.total = totalReal

  // Eliminar campos auxiliares que no existen en la tabla pedidos
  delete payload.cupon_cliente
  delete payload.usar_saldo_vip
  delete payload.monto_saldo_vip
  delete payload.pin_vip
  delete payload.usar_beneficio_fidelidad

  const { data: pedidoData, error: insertError } = await supabase.from('pedidos').insert([payload]).select().single()
  if (insertError) throw insertError

  return pedidoData
}

// ============================================================================
// LÓGICA DE VALIDACIÓN PARA MANDADITOS (USA EL RPC DE LA BD)
// ============================================================================
async function validarEInsertarMandadito(supabase: any, payload: any) {
  if (!payload || !payload.lat || !payload.lng || !payload.lat_entrega || !payload.lng_entrega) {
    throw new Error('Faltan coordenadas de origen o destino para el mandadito');
  }

  // 1. Llamar a la función RPC de la base de datos para calcular el precio exacto
  const { data: tarifaData, error: rpcError } = await supabase.rpc('calcular_precio_mandadito', {
    p_lat_origen: payload.lat,
    p_lng_origen: payload.lng,
    p_lat_destino: payload.lat_entrega,
    p_lng_destino: payload.lng_entrega
  });

  if (rpcError) {
    console.error("Error al calcular tarifa mandadito:", rpcError);
    throw new Error('No se pudo calcular la tarifa del mandadito.');
  }

  let tarifaFinal = 45; // Fallback
  if (tarifaData && tarifaData.length > 0 && tarifaData[0].precio_final) {
    tarifaFinal = tarifaData[0].precio_final;
  }

  // 2. Sumar extras si es un paquete mediano o grande, o si tiene presupuesto
  let finalTotal = tarifaFinal;
  
  if (payload.extra_paquete) {
    finalTotal += Number(payload.extra_paquete);
  }
  
  if (payload.extra_compras) {
    finalTotal += Number(payload.extra_compras);
  }

  payload.total = finalTotal;

  // Eliminar campos auxiliares antes de insertar
  delete payload.extra_paquete;
  delete payload.extra_compras;

  const { data: pedidoData, error: insertError } = await supabase.from('pedidos').insert([payload]).select().single();
  if (insertError) throw insertError;

  return pedidoData;
}


serve(async (req) => {
  let cors: Record<string, string> = CORS_HEADERS
  try {
    const utils = await import('../_shared/utils.ts')
    cors = utils.getCorsHeaders(req)
  } catch(e) {}

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const { rateLimit, rateLimitResponse } = await import('../_shared/utils.ts')
    const body = await req.json()
    const { action, telefono, codigo, nuevaPassword, payload, carrito } = body

    let cleanPhone = telefono ? telefono.replace(/\D/g, '') : ''

    if (action === 'request' && cleanPhone) {
      const rl = await rateLimit(supabase, `otp:${cleanPhone}`, 5, 600)
      if (!rl.allowed) return rateLimitResponse(cors, rl.resetAt)
    }

    if ((action === 'verify-code' || action === 'set-password' || action === 'verify-and-order') && cleanPhone) {
      const rl = await rateLimit(supabase, `otp-verify:${cleanPhone}`, 10, 600)
      if (!rl.allowed) return rateLimitResponse(cors, rl.resetAt)
    }

    // ── ACCIÓN: REQUEST OTP ──
    if (action === 'request') {
      const extract10 = (p: string) => {
        const c = p.replace(/\D/g, '')
        return c.length >= 10 ? c.slice(-10) : c
      }
      
      const adminsEnv10 = ADMIN_PHONES.split(',').map((n: string) => extract10(n)).filter(Boolean)
      const cleanPhone10 = extract10(cleanPhone)
      
      let targetPhone = cleanPhone
      let isAuthorized = false
      let role = 'admin'

      if (adminsEnv10.includes(cleanPhone10)) {
        isAuthorized = true
        const originalEnv = ADMIN_PHONES.split(',').find(n => extract10(n) === cleanPhone10)
        targetPhone = originalEnv ? originalEnv.trim().replace(/\D/g, '') : cleanPhone
      }

      if (!isAuthorized) {
        const { data: adminData } = await supabase.from('admins').select('id, telefono').like('telefono', `%${cleanPhone10}`).maybeSingle()
        if (adminData) {
          isAuthorized = true
          targetPhone = adminData.telefono || cleanPhone
        } else {
          const { data: repData } = await supabase.from('repartidores').select('id, telefono').like('telefono', `%${cleanPhone10}`).eq('activo', true).maybeSingle()
          if (repData) {
            isAuthorized = true
            role = 'repartidor'
            targetPhone = repData.telefono || cleanPhone
          }
        }
      }

      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: 'Número no autorizado o inactivo' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      if (targetPhone.length === 10 && targetPhone.startsWith('963')) {
        targetPhone = `521${targetPhone}`
      }

      const pin = Math.floor(100000 + Math.random() * 900000).toString()
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

      await supabase.from('otp_codes').delete().eq('telefono', cleanPhone)
      const { error: dbError } = await supabase.from('otp_codes').insert({ telefono: cleanPhone, codigo: pin, expires_at: expiresAt })
      if (dbError) throw dbError

      const waRes = await fetch(`https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`, {
        method: 'POST',
        headers: { 'X-API-Key': WA_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: targetPhone,
          type: 'text',
          text: { body: `⭐ *Estrella Delivery*\n\n🔐 Tu código de acceso es: *${pin}*\n\nIngresa este PIN en la aplicación. Caduca en 5 minutos.` }
        })
      })

      if (!waRes.ok) console.error('WhatsApp Error:', waRes.status, waRes.statusText)

      return new Response(JSON.stringify({ ok: true, role }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // ── ACCIÓN: REQUEST CLIENT OTP (Pagos Efectivo) ──
    if (action === 'request-client-otp') {
      const pin = Math.floor(1000 + Math.random() * 9000).toString()
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      
      let targetPhone = cleanPhone
      if (targetPhone.length === 10) targetPhone = `521${targetPhone}`

      await supabase.from('otp_codes').delete().eq('telefono', cleanPhone)
      const { error: dbError } = await supabase.from('otp_codes').insert({ telefono: cleanPhone, codigo: pin, expires_at: expiresAt })
      if (dbError) throw dbError

      // ── Enviar plantilla por Meta (Cuenta Anterior) ──
      // Usamos explícitamente las credenciales antiguas de Meta (WHATSAPP_TOKEN y WHATSAPP_PHONE_ID)
      // ya que la nueva cuenta en YCloud aún no tiene permisos para enviar plantillas de auth.
      const oldWaToken = Deno.env.get('WHATSAPP_TOKEN')
      const oldWaPhoneId = Deno.env.get('WHATSAPP_PHONE_ID')
      
      if (!oldWaToken || !oldWaPhoneId) {
        throw new Error('Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID (Cuenta anterior) en los secretos de Supabase.')
      }

      const waRes = await fetch(`https://graph.facebook.com/v22.0/${oldWaPhoneId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${oldWaToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: targetPhone,
          type: 'template',
          template: {
            name: 'auth_codigo_efectivo',
            language: { code: 'es_MX' },
            components: [
              { type: 'body', parameters: [{ type: 'text', text: pin }] },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: pin }] }
            ]
          }
        })
      })

      if (!waRes.ok) {
        const errText = await waRes.text();
        console.error('Meta WhatsApp Template Error:', waRes.status, errText);
        return new Response(JSON.stringify({ error: `Meta API Error: ${errText}` }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // ── ACCIÓN: VERIFY CODE ONLY ──
    if (action === 'verify-code') {
      if (!codigo || !/^\d{4,6}$/.test(codigo)) return new Response(JSON.stringify({ error: 'Falta o formato inválido' }), { status: 400, headers: cors })
      
      const { data: otpRecords } = await supabase.from('otp_codes').select('id').eq('telefono', cleanPhone).eq('codigo', codigo).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1)
      if (!otpRecords || otpRecords.length === 0) return new Response(JSON.stringify({ error: 'Código inválido' }), { status: 400, headers: cors })

      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // ── ACCIÓN: DIRECT ORDER (CLIENTES RECURRENTES Y MERCADOPAGO) ──
    // Salta la validación OTP, asume que el frontend ya validó al cliente o Mercadopago.
    if (action === 'direct-order') {
      try {
        const pedidoData = await validarEInsertarPedido(supabase, payload, carrito)
        return new Response(JSON.stringify({ ok: true, pedido: pedidoData }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      } catch (err: any) {
        console.error('ERROR EN DIRECT ORDER:', err)
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
    }

    // ── ACCIÓN: VERIFY & CREATE ORDER (NUEVOS EN EFECTIVO) ──
    if (action === 'verify-and-order') {
      if (!codigo || !payload) return new Response(JSON.stringify({ error: 'Faltan datos' }), { status: 400, headers: cors })
      
      const { data: otpRecords } = await supabase.from('otp_codes').select('id').eq('telefono', cleanPhone).eq('codigo', codigo).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1)
      if (!otpRecords || otpRecords.length === 0) return new Response(JSON.stringify({ error: 'Código inválido o expirado' }), { status: 400, headers: cors })

      await supabase.from('otp_codes').delete().eq('id', otpRecords[0].id)

      try {
        const pedidoData = await validarEInsertarPedido(supabase, payload, carrito)
        return new Response(JSON.stringify({ ok: true, pedido: pedidoData }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      } catch (err: any) {
        console.error('ERROR EN VERIFY AND ORDER:', err)
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
    }

    // ── ACCIÓN: VERIFY & CREATE MANDADITO ──
    if (action === 'verify-and-order-mandadito') {
      if (!codigo || !payload) return new Response(JSON.stringify({ error: 'Faltan datos' }), { status: 400, headers: cors })
      
      const { data: otpRecords } = await supabase.from('otp_codes').select('id').eq('telefono', cleanPhone).eq('codigo', codigo).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1)
      if (!otpRecords || otpRecords.length === 0) return new Response(JSON.stringify({ error: 'Código inválido o expirado' }), { status: 400, headers: cors })

      await supabase.from('otp_codes').delete().eq('id', otpRecords[0].id)

      try {
        const pedidoData = await validarEInsertarMandadito(supabase, payload)
        return new Response(JSON.stringify({ ok: true, pedido: pedidoData }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      } catch (err: any) {
        console.error('ERROR EN VERIFY AND ORDER MANDADITO:', err)
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
    }

    // ── ACCIÓN: VERIFY & SET PASSWORD ──
    if (action === 'set-password') {
      if (!codigo || !nuevaPassword) return new Response(JSON.stringify({ error: 'Falta código o password' }), { status: 400, headers: cors })
      const { data: otpRecords } = await supabase.from('otp_codes').select('*').eq('telefono', cleanPhone).eq('codigo', codigo).gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1)
      if (!otpRecords || otpRecords.length === 0) return new Response(JSON.stringify({ error: 'Inválido' }), { status: 400, headers: cors })

      const extract10 = (p: string) => { const c = p.replace(/\D/g, ''); return c.length >= 10 ? c.slice(-10) : c }
      const adminsEnv10 = ADMIN_PHONES.split(',').map((n: string) => extract10(n)).filter(Boolean)
      let isAdmin = adminsEnv10.includes(extract10(cleanPhone))
      if (!isAdmin) {
        const { data: aData } = await supabase.from('admins').select('id').like('telefono', `%${extract10(cleanPhone)}`).maybeSingle()
        if (aData) isAdmin = true
      }

      const dummyEmail = isAdmin ? `${cleanPhone}@admin.com` : `${cleanPhone}@repartidor.com`
      const { data: users, error: listErr } = await supabase.auth.admin.listUsers()
      if (listErr) throw listErr

      let targetUser = users.users.find((u: any) => u.email === dummyEmail)
      if (targetUser) {
        const { error: updErr } = await supabase.auth.admin.updateUserById(targetUser.id, { password: nuevaPassword }); 
        if (isAdmin) { await supabase.from('admins').update({id: targetUser.id}).like('telefono', `%${extract10(cleanPhone)}`); } else { await supabase.from('repartidores').update({user_id: targetUser.id}).like('telefono', `%${extract10(cleanPhone)}`); }
        if (updErr) throw updErr
      } else {
        const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({ email: dummyEmail, password: nuevaPassword, email_confirm: true })
        if (createErr) throw createErr
        targetUser = newUser.user; 
        if (isAdmin) { await supabase.from('admins').update({id: targetUser.id}).like('telefono', `%${extract10(cleanPhone)}`); } else { await supabase.from('repartidores').update({user_id: targetUser.id}).like('telefono', `%${extract10(cleanPhone)}`); }
      }
      await supabase.from('otp_codes').delete().eq('id', otpRecords[0].id)
      return new Response(JSON.stringify({ ok: true, email: dummyEmail }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Acción inválida' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error('Error in auth-otp:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
