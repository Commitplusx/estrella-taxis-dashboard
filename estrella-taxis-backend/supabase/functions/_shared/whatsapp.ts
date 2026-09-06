// _shared/whatsapp.ts

const YCLOUD_API_KEY = Deno.env.get('YCLOUD_API_KEY') || '';
const YCLOUD_SENDER = Deno.env.get('YCLOUD_SENDER') || '';
const DISPATCHER_PHONE = Deno.env.get('DISPATCHER_PHONE') || '+529611234567';

export interface DispatchData {
  origen: string;
  destino: string;
  telefono: string;
  tarifa: number | string | null;
  nearestTaxiName?: string;
  nearestTaxiDist?: number;
  trackingUrl?: string;           // Link de seguimiento en tiempo real para el despachador
  dispatcherPhoneOverride?: string;
  isEscalation?: boolean;
}

// Enviar cualquier mensaje de WhatsApp a cualquier número — usado para el link de tracking al cliente
export async function sendWhatsApp(to: string, body: string, fromOverride?: string) {
  if (!YCLOUD_API_KEY) return;
  const sender = fromOverride || YCLOUD_SENDER;
  const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify({ from: sender, to, type: 'text', text: { body } }),
  });
  if (!res.ok) console.error('[YCLOUD SEND ERROR]', await res.text());
}

// Enviar un mensaje interactivo con botón URL nativo (CTA_URL)
export async function sendWhatsAppCTA(to: string, body: string, buttonText: string, url: string, fromOverride?: string) {
  if (!YCLOUD_API_KEY) return;
  const sender = fromOverride || YCLOUD_SENDER;
  const payload = {
    from: sender,
    to,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: body },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: buttonText,
          url: url
        }
      }
    }
  };
  const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error('[YCLOUD SEND CTA ERROR]', await res.text());
}

export interface SendTemplateOptions {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParameters: string[];
  fromOverride?: string;
  fallbackText?: string;
}

// Enviar plantilla de WhatsApp aprobada por Meta (imprescindible para llamadas de voz o fuera de ventana de 24h)
export async function sendWhatsAppTemplate(options: SendTemplateOptions) {
  if (!YCLOUD_API_KEY) return;
  const sender = options.fromOverride || YCLOUD_SENDER;
  const lang = options.languageCode || 'es_MX';

  const payload = {
    from: sender,
    to: options.to,
    type: 'template',
    template: {
      name: options.templateName,
      language: {
        code: lang,
      },
      components: [
        {
          type: 'body',
          parameters: options.bodyParameters.map((param) => ({
            type: 'text',
            text: param,
          })),
        },
      ],
    },
  };

  try {
    const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[YCLOUD TEMPLATE ERROR]', errText);
      if (options.fallbackText) {
        console.log('[YCLOUD FALLBACK] Intentando envío de texto plano como respaldo...');
        await sendWhatsApp(options.to, options.fallbackText, sender);
      }
    } else {
      console.log(`[YCLOUD TEMPLATE] Plantilla "${options.templateName}" enviada con éxito a ${options.to}`);
    }
  } catch (err) {
    console.error('[YCLOUD TEMPLATE NETWORK ERROR]', err);
    if (options.fallbackText) {
      await sendWhatsApp(options.to, options.fallbackText, sender);
    }
  }
}

export async function dispatchToHuman(data: DispatchData) {
  if (!YCLOUD_API_KEY) {
    console.warn('[YCLOUD] No YCLOUD_API_KEY. No se enviará mensaje al despachador.');
    return;
  }

  // Usar el teléfono del tenant si viene, sino el global del env var
  const target = data.dispatcherPhoneOverride || DISPATCHER_PHONE;

  const dispatchExtraText = data.nearestTaxiName
    ? `\n\n🟢 *Unidad más cercana:* ${data.nearestTaxiName} (a ${data.nearestTaxiDist?.toFixed(1)} km)${data.trackingUrl ? `\n📺 *Seguimiento en vivo:* ${data.trackingUrl}` : ''}`
    : `\n\n⚠️ *Atención:* No hay unidades disponibles cercas.`;

  const tarifaFormateada = typeof data.tarifa === 'number'
    ? `$${data.tarifa}`
    : (data.tarifa || 'N/A');

  const title = data.isEscalation 
    ? `🚨 *ATENCIÓN REQUERIDA (BOT ESCALÓ)* 🚨`
    : `🚕 *NUEVO VIAJE CONFIRMADO (BOT)* 🚕`;

  const dispatchMessage = `${title}\n\n📍 *Origen:* ${data.origen}\n🏁 *Destino:* ${data.destino}\n📞 *Teléfono:* ${data.telefono}\n💵 *Tarifa (H3):* ${tarifaFormateada}${dispatchExtraText}`;

  try {
    const waRes = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': YCLOUD_API_KEY,
      },
      body: JSON.stringify({
        from: YCLOUD_SENDER, // Para el despachador solemos usar el principal, o podrías usar fromOverride
        to: target,
        type: 'text',
        text: { body: dispatchMessage },
      }),
    });

    if (!waRes.ok) {
      console.error('[YCLOUD API ERROR]', await waRes.text());
    } else {
      console.log(`[YCLOUD] Mensaje enviado a despachador (${target})`);
    }
  } catch (err) {
    console.error('[YCLOUD NETWORK ERROR]', err);
  }
}
