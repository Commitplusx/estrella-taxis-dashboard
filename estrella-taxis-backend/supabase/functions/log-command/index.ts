import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Configuración YCloud
const YCLOUD_API_KEY = Deno.env.get('YCLOUD_API_KEY') || '14fcecd949b8d1338c2fcfaa65245802';
const YCLOUD_SENDER = Deno.env.get('YCLOUD_SENDER') || '+529631367971';
const ADMIN_PHONE = '+529631539156';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { deviceName, commandType, userEmail } = await req.json();

    if (!deviceName || !commandType || !userEmail) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros' }), { status: 400, headers: corsHeaders });
    }

    // 1. Log en la base de datos
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error: dbError } = await supabase
      .from('command_logs')
      .insert([
        {
          device_name: deviceName,
          command_type: commandType,
          user_email: userEmail,
        }
      ]);

    if (dbError) {
      console.error('Error insertando log:', dbError);
    }

    // 2. Enviar Alerta por WhatsApp
    const commandName = commandType === 'engineStop' ? '*APAGADO EL MOTOR*' : (commandType === 'engineResume' ? '*RESTAURADO LA CORRIENTE*' : `enviado el comando *${commandType}*`);
    const emoji = commandType === 'engineStop' ? '⛔' : '⚡';
    
    // Obtener hora local de Chiapas
    const dateUtc = new Date();
    const timeStr = dateUtc.toLocaleString('es-MX', { 
        timeZone: 'America/Mexico_City',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true
    });

    const finalMessage = `${emoji} *ALERTA DE SEGURIDAD* ${emoji}\n\nEl usuario _${userEmail}_ ha ${commandName} del taxi *${deviceName}*.\n🕒 Hora: ${timeStr}`;

    const ycloudPayload = {
      from: YCLOUD_SENDER.replace('+', ''),
      to: ADMIN_PHONE,
      type: 'text',
      text: { body: finalMessage }
    };

    const whatsappRes = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': YCLOUD_API_KEY
      },
      body: JSON.stringify(ycloudPayload)
    });

    if (!whatsappRes.ok) {
      console.error('Error enviando WhatsApp:', await whatsappRes.text());
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error en Edge Function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
