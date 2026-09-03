import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.1'
import { sendWA, sendInteractiveButtons } from '../whatsapp-bot/whatsapp.ts'
import { handleNuevoPedidoFlow } from './pedidos-flow-handler.ts'

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const binaryDerString = atob(pemContents)
  const binaryDer = new Uint8Array(binaryDerString.length)
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i)
  }

  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  )
}

async function decryptAesKey(encryptedAesKeyBase64: string, privateKey: CryptoKey): Promise<Uint8Array> {
  const encryptedBytes = Uint8Array.from(atob(encryptedAesKeyBase64), c => c.charCodeAt(0))
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    encryptedBytes
  )
  return new Uint8Array(decryptedBuffer)
}

serve(async (req) => {
  // Health check sin encriptación (algunos BSPs y Meta en staging mandan esto)
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ version: '3.0', data: { status: 'active' } }), {
      headers: { 'Content-Type': 'application/json' }, status: 200
    })
  }

  if (req.method === 'POST') {
    try {
      const rawBody = await req.text()
      console.log("==> FLOW RAW BODY (first 500):", rawBody.substring(0, 500));

      let body: any
      try {
        body = JSON.parse(rawBody)
      } catch (parseErr) {
        console.error("==> FLOW: Body no es JSON válido:", parseErr)
        return new Response("Bad Request: invalid JSON", { status: 400 })
      }

      console.log("==> FLOW REQUEST BODY KEYS:", Object.keys(body).join(', '));

      const FLOWS_PRIVATE_KEY_B64 = Deno.env.get('FLOW_PRIVATE_KEY_B64')
      const FLOWS_PRIVATE_KEY_RAW = Deno.env.get('FLOW_PRIVATE_KEY') || Deno.env.get('FLOWS_PRIVATE_KEY')

      let FLOWS_PRIVATE_KEY: string
      if (FLOWS_PRIVATE_KEY_B64) {
        // Decodificar desde base64 para evitar corrupción de newlines en PowerShell
        FLOWS_PRIVATE_KEY = new TextDecoder().decode(Uint8Array.from(atob(FLOWS_PRIVATE_KEY_B64), c => c.charCodeAt(0)))
        console.log("==> FLOW: Usando llave privada desde base64, longitud:", FLOWS_PRIVATE_KEY.length)
      } else if (FLOWS_PRIVATE_KEY_RAW) {
        FLOWS_PRIVATE_KEY = FLOWS_PRIVATE_KEY_RAW
        console.log("==> FLOW: Usando llave privada directa, longitud:", FLOWS_PRIVATE_KEY.length)
      } else {
        throw new Error("Llave privada de Flows no configurada en las variables de entorno")
      }

      const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body

      if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
        console.error("==> FLOW: Faltan campos de encriptación. Body keys:", Object.keys(body).join(', '))
        // Responder con datos de health check en texto plano si Meta no mandó campos encriptados
        return new Response(JSON.stringify({ version: '3.0', data: { status: 'active' } }), {
          headers: { 'Content-Type': 'application/json' }, status: 200
        })
      }

      // 1. Decrypt AES key
      let privateKey: CryptoKey
      try {
        privateKey = await importPrivateKey(FLOWS_PRIVATE_KEY)
      } catch (keyErr: any) {
        console.error("==> FLOW: Error importando llave privada:", keyErr.message)
        throw new Error("Error importando llave privada: " + keyErr.message)
      }
      const aesKeyBytes = await decryptAesKey(encrypted_aes_key, privateKey)
      
      const aesKey = await crypto.subtle.importKey(
        'raw',
        aesKeyBytes,
        { name: 'AES-GCM' },
        false,
        ['decrypt', 'encrypt']
      )

      // 2. Decrypt Flow Data
      const iv = Uint8Array.from(atob(initial_vector), c => c.charCodeAt(0))
      const encryptedData = Uint8Array.from(atob(encrypted_flow_data), c => c.charCodeAt(0))
      
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encryptedData
      )
      
      const decryptedText = new TextDecoder().decode(decryptedBuffer)
      const flowData = JSON.parse(decryptedText)
      console.log("==> FLOW DECRYPTED DATA:", JSON.stringify(flowData, null, 2));
      
      let responsePayload: any = {}

      if (flowData.action === "ping") {
        responsePayload = { data: { status: "active" } }
      } 
      else if (flowData.action === "INIT") {
        responsePayload = { data: {} }
      } 
      else if (flowData.action === "data_exchange") {
        const payload = flowData.data
        const tokenData = JSON.parse(flowData.flow_token || '{}')
        const fromPhone = tokenData.phone // The phone number of the user who submitted the flow
        
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        if (payload.accion === "FETCH_RESTAURANTES") {
          const { data: restaurantes } = await supabase.from('restaurantes').select('id, nombre, descripcion_corta').eq('activo', true).is('matriz_id', null)
          const rList = (restaurantes || []).map((r: any) => ({ id: r.id, title: r.nombre, description: r.descripcion_corta || 'Toca para ver menú', metadata: " " }))
          responsePayload = { screen: "ELIGE_RESTAURANTE", data: { restaurantes: rList.length ? rList : [{id: '0', title: 'Sin restaurantes', description: 'No hay restaurantes activos', metadata: ' '}] } }
        }
        else if (payload.accion === "FETCH_MENU") {
          const restId = payload.restaurante_id
          const { data: rest } = await supabase.from('restaurantes').select('nombre').eq('id', restId).maybeSingle()
          
          const { data: menu } = await supabase.from('menu_items')
            .select('id, nombre, descripcion, precio, menu_categorias(nombre)')
            .eq('restaurante_id', restId)
            .eq('disponible', true)

          const fuertes: any[] = []
          const extras: any[] = []
          const bebidas: any[] = []

          ;(menu || []).forEach((m: any) => {
            const catName = (m.menu_categorias?.nombre || '').toLowerCase()
            const item = {
              id: m.id,
              title: m.nombre,
              description: `$${m.precio} — ${m.descripcion || ''}`.substring(0, 100),
              metadata: " "
            }
            if (catName.includes('bebida') || catName.includes('refresco')) {
              bebidas.push(item)
            } else if (catName.includes('entrada') || catName.includes('extra') || catName.includes('papa') || catName.includes('postre') || catName.includes('complemento') || catName.includes('snack')) {
              extras.push(item)
            } else {
              fuertes.push(item)
            }
          })

          const fallback = [{id: '0', title: 'N/A', description: 'No disponible por el momento', metadata: ' '}]

          responsePayload = {
            screen: "ELIGE_PLATILLOS",
            data: {
              restaurante_id: restId,
              restaurante_nombre: rest?.nombre || 'Restaurante',
              platos_fuertes: fuertes.length ? fuertes : fallback,
              entradas_y_extras: extras.length ? extras : fallback,
              bebidas: bebidas.length ? bebidas : fallback
            }
          }
        }
        else if (payload.accion === "FETCH_CARRITO") {
          const { items_fuertes, items_extras, items_bebidas, notas_cocina } = payload
          
          const parseItems = (val: any) => Array.isArray(val) ? val : (typeof val === 'string' && val ? val.split(',') : [])
          
          const arrItems = [
            ...parseItems(items_fuertes),
            ...parseItems(items_extras),
            ...parseItems(items_bebidas)
          ].filter(id => id !== '0' && id !== '')
          
          let resumen = ''
          let total = 0
          let finalRestId = payload.restaurante_id || '';
          let finalRestNombre = 'Restaurante';
          
          if (arrItems.length > 0) {
            const { data: menu } = await supabase.from('menu_items').select('id, nombre, precio, restaurante_id, restaurantes(nombre)').in('id', arrItems)
            if (menu && menu.length > 0) {
              finalRestId = menu[0].restaurante_id
              finalRestNombre = menu[0].restaurantes?.nombre || 'Restaurante'
              for (const itemId of arrItems) {
                const item = menu.find((m: any) => m.id === itemId)
                if (item) {
                  resumen += `• ${item.nombre} — $${item.precio}\n`
                  total += Number(item.precio)
                }
              }
            }
          }
          if (resumen === '') resumen = 'No agregaste platillos.'
          
          resumen += `\n(+ costo de envío)`
          
          responsePayload = {
            screen: "TU_CARRITO",
            data: {
              restaurante_id: finalRestId, 
              restaurante_nombre: finalRestNombre,
              notas_cocina: notas_cocina || '',
              resumen_texto: resumen, total_carrito: total
            }
          }
        }
        else if (payload.accion === "FETCH_COLONIAS") {
          const { restaurante_id, restaurante_nombre, items_elegidos, notas_cocina, cupon_codigo, total_carrito } = payload
          const { data: colonias } = await supabase.from('colonias').select('id, nombre, precio, etiqueta_zona').order('nombre', { ascending: true })
          const cList = (colonias || []).map((c: any) => ({
            id: c.id,
            title: c.nombre,
            description: `Envío: $${c.precio} ${c.etiqueta_zona === 'verde' ? '🟢' : c.etiqueta_zona === 'amarillo' ? '🟡' : '🔴'}`,
            metadata: `${c.precio}`
          }))
          responsePayload = {
            screen: "DONDE_ENTREGAMOS",
            data: {
              restaurante_id, restaurante_nombre, items_elegidos, notas_cocina, cupon_codigo: cupon_codigo || '', total_carrito,
              colonias: cList.length ? cList : [{id: '0', title: 'Centro', description: 'Envío: $30', metadata: '30'}]
            }
          }
        }
        else if (payload.accion === "FETCH_CONFIRMACION") {
          const { restaurante_id, restaurante_nombre, items_elegidos, notas_cocina, cupon_codigo, colonia_id, calle_numero, referencias, total_carrito } = payload
          const { data: colonia } = await supabase.from('colonias').select('nombre, precio').eq('id', colonia_id).maybeSingle()
          const envio = colonia?.precio || 0
          const granTotal = Number(total_carrito) + Number(envio)
          const resumenFinal = `✅ Subtotal: $${total_carrito}\n🛵 Envío (${colonia?.nombre || 'Colonia'}): $${envio}\n\n💵 *Total Final: $${granTotal}*`
          responsePayload = {
            screen: "CONFIRMACION_FINAL",
            data: {
              restaurante_id, restaurante_nombre, items_elegidos, notas_cocina, cupon_codigo,
              colonia_id, calle_numero, referencias,
              resumen_final: resumenFinal
            }
          }
        }
        else if (payload.accion === "REGISTRO_CLIENTE") {
          // Process Client Registration - requires Admin Approval
          const { nombre, colonia, cumpleanos } = payload
          const tel10 = fromPhone.slice(-10)
          
          await supabase.from('bot_memory').upsert({
            phone: `pending_reg_${tel10}`,
            history: [{
              nombre, telefono: tel10, colonia, cumpleanos,
              solicitado: new Date().toISOString()
            }],
            updated_at: new Date().toISOString()
          })

          // Notificar al admin
          const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
          const admin10 = (ADMIN_PHONES_ENV.split(',')[0]?.replace(/\D/g, '').slice(-10)) || ''
          if (admin10) {
            console.log("==> ENVIANDO ALERTA VIP AL ADMIN NUMERO:", admin10);
            await sendInteractiveButtons(`52${admin10}`, 
              `🔔 *Nueva Solicitud VIP (Flow)*\n\n👤 Nombre: ${nombre}\n📞 Tel: ${tel10}\n🏠 Colonia: ${colonia}\n🎂 Cumple: ${cumpleanos || 'No especificado'}`,
              [
                { id: `reg_accept_${tel10}`, title: '✅ Aprobar' },
                { id: `reg_reject_${tel10}`, title: '❌ Rechazar' }
              ]
            ).catch(err => console.error('Error sendInteractiveButtons vip:', err))
            
            await sendWA(`52${tel10}`, 
              `🎉 ¡Excelente, *${nombre.split(' ')[0]}*!\nTu solicitud VIP fue enviada. En unos minutos el equipo la aprobará y recibirás tu tarjeta digital aquí mismo. ⏳`
            ).catch(err => console.error('Error sendWA:', err))
          }

        } 
        else if (payload.accion === "REGISTRO_RESTAURANTE") {
          // Process Restaurant Registration
          const { nombre_negocio, categoria, encargado, direccion } = payload
          const tel10 = fromPhone.slice(-10)
          
          const { error: insError } = await supabase.from('restaurantes_solicitudes').insert({
            nombre_restaurante: nombre_negocio,
            categoria: categoria,
            encargado: encargado,
            direccion: direccion,
            telefono: tel10,
            correo: `aliado_${tel10}@app-estrella.shop` // Correo único usando el teléfono para evitar colisiones en Auth
          })
          
          if (insError) {
             console.error("Error insertando en restaurantes_solicitudes:", insError);
          }
          
          const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
          const admin10 = (ADMIN_PHONES_ENV.split(',')[0]?.replace(/\D/g, '').slice(-10)) || ''
          if (admin10) {
            console.log("==> ENVIANDO ALERTA RESTAURANTE AL ADMIN NUMERO:", admin10);
            await sendInteractiveButtons(`52${admin10}`, 
              `🔔 *Nueva Solicitud de Restaurante (Flow)*\nNombre: ${nombre_negocio}\nCategoría: ${categoria}\nEncargado: ${encargado}\nDirección: ${direccion}\nTel: ${tel10}`,
              [
                { id: `flow_rest_accept_${tel10}`, title: '✅ Aprobar' },
                { id: `flow_rest_reject_${tel10}`, title: '❌ Rechazar' }
              ]
            ).catch(err => console.error('Error sendInteractiveButtons rest:', err))

            await sendWA(`52${tel10}`, 
              `🎉 Solicitud de restaurante enviada con éxito. Nuestro equipo la revisará y te contactará pronto. 🏪`
            ).catch(err => console.error('Error sendWA rest:', err))
          }
        }
        else if (payload.calle_gps) {
          // Process Solicitar Moto
          const { telefono, nombre, calle_gps, colonia, referencias, pedido, cobro, pago } = payload
          // Notificar al admin
          const ADMIN_PHONES_ENV = Deno.env.get('ADMIN_PHONES') ?? Deno.env.get('ADMIN_PHONE') ?? ''
          const admin10 = (ADMIN_PHONES_ENV.split(',')[0]?.replace(/\D/g, '').slice(-10)) || ''
          if (admin10) {
            await sendWA(`52${admin10}`, 
              `🛵 *NUEVO MOTO (B2B FLOW)*\n\n🏢 De: ${nombre}\n📞 Tel: wa.me/${telefono}\n📍 Calle: ${calle_gps}\n🏠 Colonia: ${colonia}\n📝 Referencias: ${referencias || 'Ninguna'}\n📦 Pedido: ${pedido}\n💰 Cobro: $${cobro}\n💳 Pago: ${pago}`
            ).catch(err => console.error('Error sendWA admin moto:', err))
            
            await sendWA(`52${fromPhone.slice(-10)}`, 
              `🛵 Hemos recibido tu solicitud para despachar moto. ¡Vamos en camino!`
            ).catch(err => console.error('Error sendWA cli moto:', err))
          }
        }
        else if (payload.accion === "CREAR_PROMO_B2B") {
          const { titulo, mensaje, audiencia, caducidad } = payload
          const { restId, restName, phone } = tokenData
          
          if (restId) {
            // Validar límite de 1 promo al día
            const hoyInicio = new Date()
            hoyInicio.setUTCHours(0, 0, 0, 0) // Start of UTC day, or adjust to local timezone
            const { count: promosHoy } = await supabase.from('restaurante_loyalty_log')
              .select('id', { count: 'exact', head: true })
              .eq('restaurante_id', restId)
              .eq('accion', 'broadcast_promo')
              .gte('created_at', hoyInicio.toISOString())
            
            const { sendWA } = await import('../whatsapp-bot/whatsapp.ts')

            if ((promosHoy || 0) >= 1) {
              await sendWA(phone, `⚠️ Lo sentimos, ya has enviado una promoción el día de hoy.\nPor políticas de la plataforma, el límite es de *1 promoción diaria* para evitar saturar a los clientes.`)
            } else {
              // Obtener teléfonos según audiencia
              let clientPhones: string[] = []
              
              const { data: logs } = await supabase.from('restaurante_loyalty_log')
                .select('cliente_tel, created_at')
                .eq('restaurante_id', restId)
                
              if (logs) {
                const phoneCounts: Record<string, number> = {}
                const phoneLastVisit: Record<string, number> = {}
                
                logs.forEach((l: any) => {
                  phoneCounts[l.cliente_tel] = (phoneCounts[l.cliente_tel] || 0) + 1
                  const t = new Date(l.created_at).getTime()
                  if (!phoneLastVisit[l.cliente_tel] || t > phoneLastVisit[l.cliente_tel]) {
                    phoneLastVisit[l.cliente_tel] = t
                  }
                })
                
                if (audiencia === 'top_vip') {
                  const sorted = Object.keys(phoneCounts).sort((a, b) => phoneCounts[b] - phoneCounts[a])
                  clientPhones = sorted.slice(0, 20)
                } else if (audiencia === 'ausentes') {
                  const treintaDias = 30 * 24 * 60 * 60 * 1000
                  const ahora = Date.now()
                  clientPhones = Object.keys(phoneLastVisit).filter(p => (ahora - phoneLastVisit[p]) > treintaDias)
                } else {
                  // 'todos'
                  clientPhones = Object.keys(phoneCounts)
                }
              }
              
              if (clientPhones.length === 0) {
                await sendWA(phone, `⚠️ No se encontraron clientes en la categoría seleccionada (*${audiencia}*). La promoción no fue enviada.`)
              } else {
                // Registrar envío
                await supabase.from('restaurante_loyalty_log').insert({
                  restaurante_id: restId,
                  accion: 'broadcast_promo',
                  valor: clientPhones.length,
                  cliente_tel: 'MULTIPLE'
                })
                
                const caducidadTxt = caducidad ? `\n⏳ *Válida hasta:* ${caducidad}` : ''
                const msgBroadcast = `🎁 *NUEVA PROMOCIÓN* 🎁\n🏪 De: *${restName}*\n\n🔥 *${titulo}*\n${mensaje}${caducidadTxt}\n\n_Para hacerla válida, muestra tu tarjeta digital VIP al visitar el local o realizar tu pedido._`
                
                for (const clientPhone of clientPhones) {
                  // Pequeña pausa para no saturar API
                  await new Promise(r => setTimeout(r, 100))
                  await sendWA(`52${clientPhone}`, msgBroadcast).catch(console.error)
                }
                
                await sendWA(phone, `✅ *¡Promoción Enviada con Éxito!*\nSe ha despachado el mensaje a *${clientPhones.length}* clientes de la categoría *${audiencia}*.`)
              }
            }
          }
        }
        else if (payload.accion && ['afiliar_sumar', 'canjear', 'regalar', 'info', 'moto', 'promo', 'resumen', 'historial'].includes(payload.accion)) {
          // B2B Portal Routing
          console.log(`[whatsapp-flows] Routing B2B action: ${payload.accion}`);
          let nextScreen = "SCREEN_LEALTAD";
          let accionText = "";
          let showPuntos = false;

          if (payload.accion === 'moto') nextScreen = 'SCREEN_MOTO';
          else if (payload.accion === 'promo') nextScreen = 'SCREEN_PROMO';
          else if (payload.accion === 'resumen' || payload.accion === 'historial') {
            nextScreen = 'SCREEN_REPORTE';
            accionText = payload.accion === 'resumen' ? 'Resumen del Día' : 'Historial de Movimientos';
          }
          else {
            nextScreen = 'SCREEN_LEALTAD';
            if (payload.accion === 'afiliar_sumar') { accionText = 'Afiliar / Sumar Puntos'; showPuntos = true; }
            else if (payload.accion === 'canjear') { accionText = 'Canjear Puntos'; showPuntos = true; }
            else if (payload.accion === 'regalar') { accionText = 'Regalar Envío'; showPuntos = false; }
            else if (payload.accion === 'info') { accionText = 'Ver Perfil VIP'; showPuntos = false; }
          }

          responsePayload = {
            version: "3.0",
            screen: nextScreen,
            data: {
              accion: payload.accion,
              ...(nextScreen === 'SCREEN_LEALTAD' ? { accion_text: accionText, show_puntos: showPuntos } : {}),
              ...(nextScreen === 'SCREEN_REPORTE' ? { accion_text: accionText, show_telefono: false } : {})
            }
          };
          
          console.log(`[whatsapp-flows] Assigned screen: ${nextScreen}`, responsePayload);
        }
        else if (payload.accion === 'NUEVO_PEDIDO_FLOW') {
          // ── PEDIDO VÍA FLOW (terminal) ──────────────────────────────────────
          // Se ejecuta de forma asíncrona para no bloquear la respuesta a Meta (timeout < 30s)
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!
          const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
          const supabaseClient = createClient(supabaseUrl, supabaseKey)
          const phoneFromToken = tokenData.phone || fromPhone

          // Disparar async (EdgeRuntime.waitUntil si está disponible, sino fire-and-forget)
          const pedidoPromise = handleNuevoPedidoFlow(supabaseClient, phoneFromToken, payload)
          try {
            // @ts-ignore — EdgeRuntime disponible en Supabase Edge Functions
            EdgeRuntime.waitUntil(pedidoPromise)
          } catch {
            pedidoPromise.catch(e => console.error('[Flow] handleNuevoPedidoFlow error:', e))
          }

          // Respuesta inmediata a Meta (pantalla de éxito nativa del Flow)
          responsePayload = {
            version: "3.0",
            screen: "SUCCESS",
            data: {
              extension_message_response: {
                action: "complete",
                params: { response_json: '{"ok":true}' }
              }
            }
          }
          console.log('[Flow] NUEVO_PEDIDO_FLOW recibido — handler disparado async')
        }

        // --- EL ARREGLO CRUCIAL ---
        // Si no se asignó un responsePayload en ninguno de los if anteriores (porque era terminal y sólo ejecutaba lógica)
        if (Object.keys(responsePayload).length === 0) {
          responsePayload = {
            version: "3.0",
            screen: "SUCCESS",
            data: {
              extension_message_response: {
                action: "complete",
                params: {
                  response_json: JSON.stringify(payload),
                  flow_token: flowData.flow_token
                }
              }
            }
          }
        }
      }

      console.log("==> FLOW SENDING RESPONSE:", JSON.stringify(responsePayload, null, 2));

      // 3. Encrypt Response
      const responseBytes = new TextEncoder().encode(JSON.stringify(responsePayload))
      const flippedIv = new Uint8Array(iv.length)
      for (let i = 0; i < iv.length; i++) flippedIv[i] = ~iv[i]
      
      const encryptedResponseBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: flippedIv },
        aesKey,
        responseBytes
      )
      
      const encryptedResponseBase64 = btoa(String.fromCharCode(...new Uint8Array(encryptedResponseBuffer)))

      return new Response(encryptedResponseBase64, {
        headers: { 'Content-Type': 'text/plain' },
        status: 200
      })

    } catch (e: any) {
      console.error("==> FLOW FATAL ERROR:", e.message)
      console.error("==> FLOW FATAL STACK:", e.stack)
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  }

  return new Response("Method not allowed", { status: 405 })
})
