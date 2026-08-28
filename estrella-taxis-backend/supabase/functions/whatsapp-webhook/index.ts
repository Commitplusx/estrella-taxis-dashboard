// ⚠️ Credenciales cargadas desde Supabase Secrets (nunca hardcodear — ver arquitectura §4 Regla 3)
const YCLOUD_API_KEY = Deno.env.get('YCLOUD_API_KEY') ?? '';
const YCLOUD_SENDER  = Deno.env.get('YCLOUD_SENDER')  ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const bodyText = await req.text();
    console.log("==> Payload recibido de Traccar:", bodyText);
    
    // Traccar manda un salto de línea real al final del mensaje que rompe el JSON. Lo saneamos:
    const safeBody = bodyText.replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
    
    let phone, message;
    try {
      const parsed = JSON.parse(safeBody);
      
      // Si el JSON viene de YCloud (confirmación de lectura/entrega), lo ignoramos devolviendo 200
      if (parsed.whatsappMessage || parsed.type === 'whatsapp.message.updated') {
        return new Response('Webhook de YCloud recibido', { status: 200 });
      }
      
      phone = parsed.phone;
      message = parsed.message;
    } catch(e) {
      console.error("Error parseando JSON:", e);
      return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 });
    }

    if (!phone || !message) {
      console.error("Falta phone o message. Recibido:", {phone, message});
      return new Response(JSON.stringify({ error: 'Falta phone o message' }), { status: 400 });
    }

    // --- TRADUCCIÓN Y FORMATO BONITO ---
    let finalMessage = message.trim();
    let timeStr = '';
    
    if (finalMessage.includes('at ')) {
        const timeRaw = finalMessage.split('at ')[1].trim();
        try {
            // Traccar manda la hora en formato "YYYY-MM-DD HH:mm:ss" en UTC
            // Al añadirle "Z" forzamos a JS a interpretarlo como UTC
            const dateUtc = new Date(timeRaw.replace(' ', 'T') + 'Z');
            timeStr = dateUtc.toLocaleString('es-MX', { 
                timeZone: 'America/Mexico_City',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hour12: true
            });
        } catch (e) {
            timeStr = timeRaw;
        }
    }

    if (finalMessage.includes('ignition OFF')) {
        finalMessage = `🚨 *ALERTA STELLAR* 🚨\n\nEl motor del taxi se ha *APAGADO*.\n🕒 Hora: ${timeStr}`;
    } else if (finalMessage.includes('ignition ON')) {
        finalMessage = `🟢 *ALERTA STELLAR* 🟢\n\nEl motor del taxi se ha *ENCENDIDO*.\n🕒 Hora: ${timeStr}`;
    } else if (finalMessage.includes('offline')) {
        finalMessage = `📡 *ALERTA STELLAR* 📡\n\nSe ha *PERDIDO LA SEÑAL* del taxi.\n🕒 Hora: ${timeStr}`;
    }

    // Asegurar formato internacional +52 para el destino
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const finalTo = cleanPhone.length === 10 ? '+52' + cleanPhone : '+' + cleanPhone;

    const ycloudPayload = {
      from: YCLOUD_SENDER,
      to: finalTo,
      type: 'text',
      text: { body: finalMessage }
    };
    
    console.log("==> Enviando a YCloud:", JSON.stringify(ycloudPayload));

    const ycloudRes = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': YCLOUD_API_KEY
      },
      body: JSON.stringify(ycloudPayload)
    });

    const data = await ycloudRes.json();
    console.log("==> Respuesta de YCloud HTTP", ycloudRes.status, ":", JSON.stringify(data));
    
    if (!ycloudRes.ok) {
      console.error("YCLOUD RECHAZÓ EL MENSAJE:", data);
    }
    
    return new Response(JSON.stringify({ success: ycloudRes.ok, ycloud_response: data }), {
      headers: { 'Content-Type': 'application/json' },
      status: ycloudRes.ok ? 200 : 400
    });

  } catch (error) {
    console.error("==> Error crítico interno:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
