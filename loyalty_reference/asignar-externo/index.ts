import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN')!;
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const { pedido_id, telefono, nombre, restaurante, descripcion, base_url } = await req.json();

    if (!pedido_id || !telefono) {
      return new Response(JSON.stringify({ error: 'Faltan datos' }), { status: 400, headers: CORS_HEADERS });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Actualizar el pedido en la base de datos a estado 'externo'
    const { error: dbError } = await supabase
      .from('pedidos')
      .update({ estado: 'externo', repartidor_id: null })
      .eq('id', pedido_id);

    if (dbError) throw dbError;

    // 2. Formatear el teléfono para México (+52)
    let formatTel = telefono.replace(/\D/g, '');
    if (formatTel.length === 10) formatTel = '52' + formatTel;
    
    // 3. Enviar plantilla de WhatsApp
    const trackerUrl = `https://admin.estrella-eats.mx/tracker/${pedido_id}`;
    const bodyParams = [
      nombre || 'Repartidor',
      restaurante || 'El restaurante',
      descripcion || 'Pedido',
      trackerUrl
    ];

    const components = [
      {
        type: 'body',
        parameters: bodyParams.map(t => ({ type: 'text', text: t }))
      }
    ];

    const url = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formatTel,
      type: 'template',
      template: { 
        name: 'estrella_delivery__nueva_orden', 
        language: { code: 'es_MX' }, 
        components 
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const textBody = await res.text();
    if (!res.ok) {
      console.error(`WhatsApp API error: ${textBody}`);
      // No lanzamos throw para no romper si Meta falla, pero logueamos
    }

    return new Response(JSON.stringify({ success: true, message: 'Asignado a externo y notificado' }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Error en asignar-externo:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
