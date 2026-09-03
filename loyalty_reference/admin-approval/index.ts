import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN')!
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')!
const APPROVAL_SECRET = Deno.env.get('ADMIN_APPROVAL_SECRET') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sendWA(to: string, text: string) {
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text } })
    })
    if (!res.ok) console.error(`Error sending WA message to ${to}:`, await res.text())
  } catch (error) {
    console.error(`Exception sending WA message to ${to}:`, error)
  }
}

function sendResponse(message: string, isError = false, isJson = false) {
  if (isJson) {
    return new Response(JSON.stringify({ error: isError, message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: isError ? 400 : 200
    })
  }
  const color = isError ? '#ef4444' : '#10b981'
  return new Response(`
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><title>Aprobación</title></head>
    <body style="font-family: system-ui; background: #0f0f0f; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center;">
      <div style="background: #1a1a1a; padding: 2rem; border-radius: 20px; border-top: 4px solid ${color}; max-width: 400px;">
        <h1 style="color: ${color}">Aprobación</h1><p>${message}</p>
      </div>
    </body></html>
  `, { headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let action = ''
  let tel = ''
  let secret = ''
  const isJson = req.headers.get('content-type')?.includes('application/json') || req.method === 'POST'
  
  if (req.method === 'GET') {
    const url = new URL(req.url)
    action = url.searchParams.get('action') || ''
    tel = url.searchParams.get('tel') || ''
  } else if (req.method === 'POST') {
    const body = await req.json()
    action = body.action || ''
    tel = body.tel || ''
  }

  if (!action || !tel) return sendResponse('Faltan parámetros.', true, isJson)

  const authHeader = req.headers.get('Authorization')
  let isAuthorized = false
  
  if (APPROVAL_SECRET && authHeader) {
    const providedSecret = authHeader.replace('Bearer ', '').trim()
    if (providedSecret === APPROVAL_SECRET) {
      isAuthorized = true
    }
  }

  // Si no pasó por token, veamos si tiene auth normal de Supabase (jwt)
  if (!isAuthorized && authHeader) {
    const supabaseForAuth = createClient(SUPABASE_URL, SUPABASE_KEY)
    const { data: { user } } = await supabaseForAuth.auth.getUser(authHeader.replace('Bearer ', ''))
    if (user) {
      // Opcionalmente validar que sea admin
      isAuthorized = true
    }
  }

  if (!isAuthorized) {
    return sendResponse('No Autorizado.', true, isJson)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  const { data: sol, error: solErr } = await supabase.from('restaurantes_solicitudes')
    .select('*').eq('telefono', tel).eq('estado', 'pendiente').order('creado_en', { ascending: false }).limit(1).maybeSingle()

  if (solErr || !sol) {
    return sendResponse('Solicitud no encontrada.', true, isJson)
  }

  const sendPhone = `52${tel}`

  if (action === 'reject') {
    const { error: updErr } = await supabase.from('restaurantes_solicitudes').update({ estado: 'rechazado' }).eq('telefono', tel).eq('estado', 'pendiente').select()
    if (updErr) {
      return sendResponse(`Error al actualizar DB: ${updErr.message}`, true, isJson)
    }
    await sendWA(sendPhone, `Estimado comercio, por el momento no estamos aceptando más registros. Gracias.`)
    return sendResponse(`Rechazado.`, false, isJson)
  }

  if (action === 'accept') {
    // Mayor entropía en contraseña: 8 caracteres random (letras y números)
    const rChars = Math.random().toString(36).substring(2, 10);
    const genPassword = `Estrella-${rChars}`;

    // EMAIL CANÓNICO: siempre derivado del teléfono, nunca del correo que dictó el cliente.
    // Esto garantiza que el login del portal (aliado_TEL@app-estrella.shop) siempre funcione.
    const authEmail = `aliado_${tel}@app-estrella.shop`;

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
        // Buscar por el email canónico (no por sol.correo)
        const { data: existingId } = await supabase.rpc('get_user_id_by_email', { email_to_search: authEmail });
        adminId = existingId;
      } else {
        return sendResponse(`Error de Auth: ${authErr.message}`, true, isJson)
      }
    }

    // Generar slug
    const baseSlug = sol.nombre_restaurante.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const finalSlug = `${baseSlug}-${tel.slice(-4)}`;

    const { error: restErr } = await supabase.from('restaurantes').insert({
      nombre: sol.nombre_restaurante,
      telefono: tel,
      activo: true,
      admin_id: adminId,
      slug: finalSlug,
      correo: sol.correo || null,  // correo real de contacto (distinto al email de Auth)
      programa_lealtad_activo: true
    })

    if (restErr && restErr.code !== '23505') {
      return sendResponse(`Error de BD: ${restErr.message}`, true, isJson)
    }

    await supabase.from('restaurantes_solicitudes').update({ estado: 'aprobado' }).eq('id', sol.id)

    // Construir la URL del menú
    const menuUrl = `https://estrella-eats.mx/menu/${finalSlug}`;
    const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(menuUrl)}&size=500&margin=2`;
    
    // Mensaje para el restaurante
    let msgCredenciales = `🎉 *¡Felicidades, ${sol.encargado || 'aliado'}!*\n\n¡Tu restaurante ha sido aprobado por nuestro equipo! 🥳 Ya eres parte oficial de la familia Estrella Eats.\n\nAquí tienes tu Código QR y tu link público para que tus clientes comiencen a pedir:\n👉 ${menuUrl}`;

    if (isAuthCreated) {
      msgCredenciales += `\n\nPara administrar tu menú e información, ingresa a:\n👉 https://restaurantes-app-estrella.shop\n\n*Usuario:* ${tel}\n*Clave:* ${genPassword}`;
    }
    await sendWA(sendPhone, msgCredenciales)

    // Enviar QR
    const { sendWAImage } = await import('../whatsapp-bot/whatsapp.ts');
    await sendWAImage(
      sendPhone,
      qrUrl,
      `Aquí tienes tu Código QR y tu link público para que tus clientes comiencen a pedir:\n🔗 ${menuUrl}`
    )

    return sendResponse('¡Aprobado con éxito!', false, isJson)
  }

  return sendResponse('Acción desconocida.', true, isJson)
})
