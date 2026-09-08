import { resolveLocation } from '../../geo.ts';
import { getNearestTaxi } from '../../traccar.ts';
import { sendWhatsApp, dispatchToHuman, sendWhatsAppButtons } from '../../whatsapp.ts';

import { EmpresaConfig, ToolData, SupabaseAppClient, PermisosSistema } from '../core/types.ts';

function generarToken(): string {
  const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 8; i++) {
    token += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return token;
}

export async function handleCotizarViaje(
  supabase: SupabaseAppClient,
  toolData: ToolData,
  empresa: EmpresaConfig,
  ciudadTenant: string
): Promise<string> {
  const origen = (toolData.origen as string) || '';
  const destino = (toolData.destino as string) || '';
  console.log(`[BOT] Cotizando viaje para. Origen: ${origen}, Destino: ${destino}`);
  const locOrigen = await resolveLocation(supabase, origen, ciudadTenant, empresa.id);
  const locDestino = await resolveLocation(supabase, destino, ciudadTenant, empresa.id);
  
  if (locOrigen?.lat && locDestino?.lat) {
    const precioNum = locOrigen.precio || locDestino.precio;
    const precioStr = precioNum ? `$${precioNum}` : "$40 - $60";
    return `🚕 El viaje te saldría en aprox ${precioStr} MXN. ¿Te mando la unidad de una vez?`;
  } else {
    return `🚕 Híjole, no pude encontrar bien esa dirección en el mapa. ¿Me das una calle de referencia o colonia?`;
  }
}

export async function handleCancelarViaje(
  supabase: SupabaseAppClient,
  empresa: EmpresaConfig,
  fromNumber: string,
  toNumber: string
): Promise<string> {
  console.log(`[BOT] Cancelando viaje para ${fromNumber}`);
  const { data: activeTrip } = await supabase.from('viajes')
    .select('id, device_id, taxi_name, estado')
    .eq('cliente_tel', fromNumber)
    .in('estado', ['buscando_conductor', 'en_camino'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeTrip) {
    await supabase.from('viajes').update({ estado: 'cancelado' }).eq('id', activeTrip.id);

    if (activeTrip.device_id) {
      const { data: conductor } = await supabase.from('conductores').select('telefono_whatsapp').eq('device_id', activeTrip.device_id).maybeSingle();
      if (conductor && conductor.telefono_whatsapp) {
        await sendWhatsApp(conductor.telefono_whatsapp, `❌ *VIAJE CANCELADO* ❌\n\nEl pasajero ha cancelado el viaje. Ya no es necesario que te dirijas al punto.`, toNumber);
      }
    }

    dispatchToHuman({
      origen: "Cancelación",
      destino: `El cliente canceló su viaje. Unidad afectada: ${activeTrip.taxi_name || 'Ninguna (Estaba buscando)'}.`,
      telefono: fromNumber,
      tarifa: null,
      dispatcherPhoneOverride: empresa.dispatcher_phone,
      isEscalation: true
    });

    return "✅ Tu viaje ha sido cancelado exitosamente. Quedo a tus órdenes para cuando necesites otro taxi.";
  } else {
    return "No encontré ningún viaje en curso para cancelar en este momento. ¿Te puedo ayudar pidiendo un taxi?";
  }
}

export async function handleBookTaxi(
  supabase: SupabaseAppClient,
  toolData: ToolData,
  empresa: EmpresaConfig,
  fromNumber: string,
  toNumber: string,
  ciudadTenant: string,
  permisosSistema: PermisosSistema,
  APP_URL: string
): Promise<{ aiResponse: string, trackingUrlForCTA: string | null }> {
  const origen = (toolData.origen as string) || '';
  const destino = (toolData.destino as string) || '';
  const nombre = (toolData.nombre as string) || 'Pasajero';
  console.log(`[BOT] Ejecutando book_taxi para ${fromNumber}. Origen: ${origen}, Destino: ${destino}`);

  const locOrigen = await resolveLocation(supabase, origen, ciudadTenant, empresa.id);
  const locDestino = await resolveLocation(supabase, destino, ciudadTenant, empresa.id);
  const maxPrecio = Math.max(locOrigen?.precio || 0, locDestino?.precio || 0) || null;

  let nearbyTaxis: Array<{ name: string; distanceKm: number; deviceId: number; phone?: string }> | null = null;
  if (locOrigen?.lat && locOrigen?.lng) {
    try {
      nearbyTaxis = await getNearestTaxi(locOrigen.lat, locOrigen.lng, permisosSistema);
    } catch (err) {
      console.error('[TRACCAR ERROR]', err);
    }
  }

  let newViajeId: string | null = null;
  let trackingUrlForCTA: string | null = null;
  let aiResponse = "";

  if (nearbyTaxis && nearbyTaxis.length > 0) {
    const token = generarToken();

    const { data: newViaje, error: insertErr } = await supabase.from('viajes').insert({
      token, tenant_id: empresa.id,
      cliente_tel: fromNumber, cliente_nombre: nombre, origen: origen, destino: destino,
      origen_lat: locOrigen?.lat, origen_lng: locOrigen?.lng,
      estado: 'buscando_conductor',
      conductores_contactados: []
    }).select().single();

    if (!insertErr && newViaje) {
      newViajeId = newViaje.id;
      trackingUrlForCTA = `${APP_URL}/track/${token}`;

      const topTaxis = nearbyTaxis.slice(0, 3);
      const tarifa = maxPrecio ? `$${maxPrecio}` : "A consultar";
      const wabaNumber = empresa.waba_number || '';

      // Notificar a todos los taxis en PARALELO (sin polling bloqueante).
      // La aceptación es manejada de forma asíncrona en index.ts vía isDriverAccepting.
      await Promise.allSettled(topTaxis.map(async (taxi) => {
        try {
          const { data: conductor } = await supabase.from('conductores').select('telefono_whatsapp').eq('device_id', taxi.deviceId).maybeSingle();
          const telefonoDestino = conductor?.telefono_whatsapp || taxi.phone;
          if (!telefonoDestino) return;

          await supabase.rpc('array_append_viaje_conductores', { v_id: newViajeId, d_id: taxi.deviceId });
          await sendWhatsAppButtons(
            telefonoDestino,
            `🚕 *¡NUEVA SOLICITUD DE VIAJE!* 🚕\n\n📍 *Origen:* ${locOrigen?.nombre_zona || origen}\n🏁 *Destino:* ${locDestino?.nombre_zona || destino}\n💵 *Tarifa (aprox):* ${tarifa}`,
            [{ id: `accept_${taxi.deviceId}_${taxi.name}`, title: '✅ Aceptar Viaje' }],
            wabaNumber
          );
        } catch (e) {
          console.error('[YCLOUD] Fallo notificando taxi:', e);
        }
      }));

    }
  }

  let numTaxisContactados = 0;
  if (newViajeId) {
    const { data: checkViaje } = await supabase.from('viajes').select('conductores_contactados').eq('id', newViajeId).maybeSingle();
    if (checkViaje && checkViaje.conductores_contactados) {
      numTaxisContactados = checkViaje.conductores_contactados.length;
    }
  }

  // assignedTaxi es siempre null porque la aceptación es asíncrona (isDriverAccepting en index.ts)
  aiResponse = `Listo, ya estamos contactando a las unidades más cercanas. Dame un momentito mientras me confirman quién va por ti.`;
  trackingUrlForCTA = null;

  const dispatchTaxiName = nearbyTaxis && nearbyTaxis.length > 0 && numTaxisContactados === 0
    ? `Por confirmar ⚠️ (Hay taxis a ${nearbyTaxis[0].distanceKm.toFixed(1)}km pero NO tienen WhatsApp registrado en BD)`
    : 'Por confirmar';
  const dispatchTaxiDist = nearbyTaxis && nearbyTaxis.length > 0 ? nearbyTaxis[0].distanceKm : undefined;

  dispatchToHuman({
    origen: origen, destino: destino, telefono: fromNumber,
    tarifa: maxPrecio,
    nearestTaxiName: dispatchTaxiName, nearestTaxiDist: dispatchTaxiDist,
    trackingUrl: trackingUrlForCTA || undefined, dispatcherPhoneOverride: empresa.dispatcher_phone
  });

  return { aiResponse, trackingUrlForCTA };
}
