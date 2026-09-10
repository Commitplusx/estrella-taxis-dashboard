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
  if (!YCLOUD_API_KEY) {
    console.error('[YCLOUD SEND] ABORTADO: YCLOUD_API_KEY no está configurada.');
    return;
  }
  const sender = fromOverride || YCLOUD_SENDER;
  console.log(`[YCLOUD SEND] Enviando a ${to} desde ${sender}. Longitud mensaje: ${body?.length ?? 0}`);
  const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify({ from: sender, to, type: 'text', text: { body } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[YCLOUD SEND ERROR] HTTP ${res.status} al enviar a ${to}:`, errText);
    // No lanzamos excepción para que el bot no se rompa, pero sí logueamos completo
  } else {
    console.log(`[YCLOUD SEND] ✅ Mensaje enviado exitosamente a ${to}`);
  }
}

// Marcar un mensaje entrante como leído (muestra las dos palomitas azules al cliente)
export async function markAsRead(messageId: string) {
  if (!YCLOUD_API_KEY || !messageId) return;
  try {
    await fetch(`https://api.ycloud.com/v2/whatsapp/inboundMessages/${messageId}/markAsRead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    });
  } catch (e) {
    console.warn('[YCLOUD] markAsRead falló (no crítico):', e);
  }
}

// Mostrar indicador de "escribiendo..." al cliente.
// Ycloud no expone un endpoint nativo de typing, pero marcamos como leído + delay,
// lo que genera la percepción de "escribiendo" antes de la respuesta real.
export async function sendTypingIndicator(to: string, fromOverride?: string) {
  if (!YCLOUD_API_KEY) return;
  // El typing se percibe visualmente cuando el usuario ve leído (palomitas azules)
  // y después recibe la respuesta — el delay de 600ms crea esa ventana natural.
  await new Promise(r => setTimeout(r, 600));
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

// Enviar un mensaje interactivo con botones rápidos (hasta 3)
export async function sendWhatsAppButtons(to: string, body: string, buttons: {id: string, title: string}[], fromOverride?: string) {
  if (!YCLOUD_API_KEY) return;
  const sender = fromOverride || YCLOUD_SENDER;
  const payload = {
    from: sender,
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.substring(0, 20) } // YCloud WhatsApp limit is 20 chars
        }))
      }
    }
  };
  const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error('[YCLOUD SEND BUTTONS ERROR]', await res.text());
}

// Enviar un mensaje con botón nativo para solicitar la ubicación
export async function sendWhatsAppLocationRequest(to: string, body: string, fromOverride?: string) {
  if (!YCLOUD_API_KEY) return;
  const sender = fromOverride || YCLOUD_SENDER;
  const payload = {
    from: sender,
    to,
    type: 'interactive',
    interactive: {
      type: 'location_request_message',
      body: { text: body },
      action: {
        name: 'send_location'
      }
    }
  };
  const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error('[YCLOUD LOCATION REQUEST ERROR]', await res.text());
}

// Enviar un mensaje interactivo con lista nativa (hasta 10 elementos)
export async function sendWhatsAppList(to: string, body: string, buttonText: string, sections: any[], fromOverride?: string) {
  if (!YCLOUD_API_KEY) {
    console.error('[YCLOUD LIST] ❌ YCLOUD_API_KEY no está definida. Mensaje de lista NO enviado.');
    return;
  }
  const sender = fromOverride || YCLOUD_SENDER;
  console.log(`[YCLOUD LIST] Enviando lista interactiva a ${to} desde ${sender}. Secciones: ${sections.length}, items: ${sections.reduce((a, s) => a + s.rows.length, 0)}`);
  const payload = {
    from: sender,
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonText.substring(0, 20),
        sections: sections
      }
    }
  };
  const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify(payload),
  });
  const resText = await res.text();
  if (!res.ok) {
    console.error(`[YCLOUD LIST] ❌ Error ${res.status}:`, resText);
  } else {
    console.log(`[YCLOUD LIST] ✅ Lista enviada. Status: ${res.status}`);
  }
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

  const distText = data.nearestTaxiDist !== undefined ? ` (a ${data.nearestTaxiDist.toFixed(1)} km)` : '';
  const dispatchExtraText = data.nearestTaxiName
    ? `\n\n🟢 *Unidad más cercana:* ${data.nearestTaxiName}${distText}${data.trackingUrl ? `\n📺 *Seguimiento en vivo:* ${data.trackingUrl}` : ''}`
    : (data.isEscalation ? '' : `\n\n⚠️ *Atención:* No hay unidades disponibles cercas.`);

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

// Enviar un archivo multimedia (imagen, documento) usando un media ID existente de YCloud
export async function sendWhatsAppMediaId(to: string, mediaType: 'image' | 'document', mediaId: string, caption?: string, fromOverride?: string) {
  if (!YCLOUD_API_KEY) return;
  const sender = fromOverride || YCLOUD_SENDER;
  
  const payload: any = {
    from: sender,
    to,
    type: mediaType
  };
  
  // Si mediaId empieza con http, es una URL pública (link), de lo contrario es un ID interno.
  if (mediaId.startsWith('http')) {
    payload[mediaType] = { link: mediaId };
  } else {
    payload[mediaType] = { id: mediaId };
  }
  
  if (caption && caption.trim().length > 0) {
    payload[mediaType].caption = caption;
  }

  const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify(payload),
  });
  
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[YCLOUD SEND MEDIA ERROR] HTTP ${res.status} al enviar a ${to}:`, errText);
  } else {
    console.log(`[YCLOUD SEND MEDIA] ✅ Multimedia enviado a ${to} (ID: ${mediaId})`);
  }
}
