// _shared/whatsapp.ts

const YCLOUD_API_KEY  = Deno.env.get('YCLOUD_API_KEY') || '';
const YCLOUD_SENDER   = Deno.env.get('YCLOUD_SENDER') || '';
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
}

// Enviar cualquier mensaje de WhatsApp a cualquier número — usado para el link de tracking al cliente
export async function sendWhatsApp(to: string, body: string) {
  if (!YCLOUD_API_KEY) return;
  const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify({ from: YCLOUD_SENDER, to, type: 'text', text: { body } }),
  });
  if (!res.ok) console.error('[YCLOUD SEND ERROR]', await res.text());
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
    : `\n\n⚠️ *Atención:* No hay unidades disponibles cerca en Traccar.`;

  const tarifaFormateada = typeof data.tarifa === 'number'
    ? `$${data.tarifa}`
    : (data.tarifa || 'Cotizar al abordar');

  const dispatchMessage = `🚕 *NUEVO VIAJE CONFIRMADO (BOT)* 🚕\n\n📍 *Origen:* ${data.origen}\n🏁 *Destino:* ${data.destino}\n📞 *Teléfono:* ${data.telefono}\n💵 *Tarifa (H3):* ${tarifaFormateada}${dispatchExtraText}`;

  try {
    const waRes = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': YCLOUD_API_KEY,
      },
      body: JSON.stringify({
        from: YCLOUD_SENDER,
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
