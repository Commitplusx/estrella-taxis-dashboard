import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
    const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error("Faltan las llaves VAPID en los secretos de Supabase.")
    }

    webpush.setVapidDetails(
      'mailto:soporte@estrella-eats.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    )

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // Obtener título y cuerpo desde la petición (del admin web o de AI Marketing)
    const { title, body, target_phones } = await req.json()

    if (!title || !body) {
      throw new Error("Se requiere título y cuerpo para la notificación")
    }

    // Obtener las suscripciones de la base de datos
    let query = supabase.from('push_subscriptions').select('*')
    
    // Si se enviaron teléfonos específicos, filtrar por ellos (Modo Francotirador)
    if (target_phones && Array.isArray(target_phones) && target_phones.length > 0) {
      query = query.in('telefono', target_phones)
    }

    const { data: subscriptions, error } = await query

    if (error) throw error

    let exitos = 0
    let errores = 0

    // Enviar push en paralelo a todos
    const promesas = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({
            title,
            body,
            icon: '/estrella-circle.png',
            badge: '/estrella-circle.png',
            data: {
              url: '/'
            }
          })
        )
        exitos++
      } catch (err: any) {
        // Si el estado es 410 (Gone) o 404 (Not Found), la suscripción ya no sirve y debemos borrarla
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        }
        errores++
      }
    })

    await Promise.all(promesas)

    return new Response(
      JSON.stringify({ success: true, exitos, errores, total: subscriptions.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
