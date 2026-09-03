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
  dispatcherPhoneOverride?: string; // Sobrescribe DISPATCHER_PHONE para multi-tenant
}

export async function dispatchToHuman(data: DispatchData) {
  if (!YCLOUD_API_KEY) {
    console.warn('[YCLOUD] No YCLOUD_API_KEY. No se enviará mensaje al despachador.');
    return;
  }

  // Usar el teléfono del tenant si viene, sino el global del env var
  const target = data.dispatcherPhoneOverride || DISPATCHER_PHONE;

  const dispatchExtraText = data.nearestTaxiName
    ? `\n\n🟢 *Unidad más cercana:* ${data.nearestTaxiName} (a ${data.nearestTaxiDist?.toFixed(1)} km)`
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
