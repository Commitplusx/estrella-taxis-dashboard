import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchWithTimeout } from '../_shared/utils.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verificar autorización (solo usuarios autenticados pueden llamar esto)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: CORS_HEADERS })
    }

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 401, headers: CORS_HEADERS })
    }

    // Verificar que el usuario autenticado sea admin
    const { data: adminRow } = await supabase
      .from('admins')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()
    
    if (!adminRow) {
      return new Response(
        JSON.stringify({ error: 'Acceso denegado: se requiere rol de administrador' }),
        { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const { type, nombre, telefono, alias, email: reqEmail, password: reqPassword, restaurante_id } = await req.json()

    // Validar tipo primero
    if (!['repartidor', 'restaurante', 'asignar_restaurante'].includes(type)) {
      return new Response(
        JSON.stringify({ error: 'Tipo de usuario inválido' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    if (type === 'asignar_restaurante') {
      if (!reqEmail || !reqPassword || !restaurante_id) {
        return new Response(JSON.stringify({ error: 'Faltan parámetros de asignación' }), { status: 400, headers: CORS_HEADERS })
      }

      // 1. Crear el usuario en Auth
      const { data: authData, error: createErr } = await supabase.auth.admin.createUser({
        email: reqEmail,
        password: reqPassword,
        email_confirm: true
      })

      let finalUserId = ''

      if (createErr) {
        // Si ya existe, usar el existente
        if (createErr.message.includes('already registered')) {
          const { data: users } = await supabase.auth.admin.listUsers()
          const existing = users.users.find((u: any) => u.email === reqEmail)
          if (!existing) throw createErr
          
          // Opcional: Actualizarle la contraseña
          await supabase.auth.admin.updateUserById(existing.id, { password: reqPassword })
          finalUserId = existing.id
        } else {
          throw createErr
        }
      } else {
        finalUserId = authData.user.id
      }

      // 2. Vincular a la tabla restaurantes
      const { error: updateErr } = await supabase
        .from('restaurantes')
        .update({ admin_id: finalUserId, correo: reqEmail })
        .eq('id', restaurante_id)

      if (updateErr) throw updateErr

      return new Response(JSON.stringify({ ok: true, user_id: finalUserId }), { headers: CORS_HEADERS })
    }

    // --- LÓGICA ORIGINAL PARA REPARTIDORES ---
    const phoneRegex = /^[\d\s\-\+\(\)]{7,20}$/
    if (!phoneRegex.test(telefono || '')) {
      return new Response(
        JSON.stringify({ error: 'Número de teléfono inválido' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }
    if (nombre && nombre.length > 100) {
      return new Response(
        JSON.stringify({ error: 'Nombre demasiado largo' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    if (!type || !nombre || !telefono) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros' }), { status: 400, headers: CORS_HEADERS })
    }

    const cleanPhone = telefono.replace(/\D/g, '')
    const email = type === 'repartidor' ? `${cleanPhone}@repartidor.com` : `${cleanPhone}@admin.com`
    
    // Generar PIN aleatorio de 6 dígitos
    const randomPin = Math.floor(100000 + Math.random() * 900000).toString()

    // 1. Crear el usuario en Auth
    const { data: authData, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password: randomPin,
      email_confirm: true
    })

    if (createErr) {
      // Si el usuario ya existe, lo buscamos
      if (createErr.message.includes('already registered')) {
        const { data: users } = await supabase.auth.admin.listUsers()
        const existing = users.users.find((u: any) => u.email === email)
        if (!existing) throw createErr
        
        // Lo insertamos directo si ya existía la cuenta
        if (type === 'repartidor') {
          await supabase.from('repartidores').insert({ nombre, telefono, alias, user_id: existing.id, activo: true })
        } else {
          // Restaurante
          // Omitido para mantenerlo simple, usualmente los restaurantes se crean via la web y admin-approval
        }
        return new Response(JSON.stringify({ ok: true, user_id: existing.id }), { headers: CORS_HEADERS })
      }
      throw createErr
    }

    const newUserId = authData.user.id

    // 2. Insertar en la tabla correspondiente
    if (type === 'repartidor') {
      const { error: dbErr } = await supabase.from('repartidores').insert({
        nombre,
        telefono,
        alias,
        user_id: newUserId,
        activo: true
      })
      if (dbErr) {
        await supabase.auth.admin.deleteUser(newUserId)
        throw dbErr
      }
    }

    // 3. Opcional: Enviar WA con el PIN
    const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN')
    const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')
    
    if (WA_TOKEN && WA_PHONE_ID) {
      const targetPhone = cleanPhone.length === 10 ? `521${cleanPhone}` : cleanPhone
      const msg = `⭐ *Estrella Delivery*\n\n¡Hola *${alias || nombre}*! 👋\nTe hemos registrado como repartidor oficial.\n\n📱 Descarga la app e ingresa con tu número.\n🔐 Tu PIN temporal es: *${randomPin}*\n\n_(Puedes cambiarlo luego desde la opción "Problemas de acceso")_`
      
      await fetchWithTimeout(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: targetPhone,
          type: 'text',
          text: { body: msg }
        })
      })
    }

    return new Response(JSON.stringify({ ok: true, user_id: newUserId }), { headers: CORS_HEADERS })

  } catch (error: any) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS })
  }
})
