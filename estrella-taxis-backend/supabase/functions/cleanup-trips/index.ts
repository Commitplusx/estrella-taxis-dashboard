import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

interface ViajeRow {
  id: string;
  cliente_tel: string | null;
  origen: string;
  destino: string;
  tenant_id: string | null;
}

interface EmpresaRow {
  telefono_whatsapp: string | null;
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

// Tiempo maximo (minutos) que un viaje puede estar buscando conductor
const TIMEOUT_MINUTOS = 12;

serve(async (_req) => {
  try {
    const cutoffTime = new Date(Date.now() - TIMEOUT_MINUTOS * 60 * 1000).toISOString();

    const { data: zombieTrips, error } = await supabase
      .from('viajes')
      .select('id, cliente_tel, origen, destino, tenant_id')
      .eq('estado', 'buscando_conductor')
      .lt('created_at', cutoffTime);

    if (error) {
      console.error('[ZOMBIE] Error consultando viajes:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    if (!zombieTrips || zombieTrips.length === 0) {
      console.log('[ZOMBIE] Sin viajes zombie. Sistema limpio.');
      return new Response(JSON.stringify({ cleaned: 0 }), { status: 200 });
    }

    console.log(`[ZOMBIE] ${zombieTrips.length} viajes zombie encontrados. Cerrando en paralelo...`);

    // Bug 16 Fix: Procesar en paralelo con Promise.allSettled en lugar de await secuencial.
    // Con 50 viajes zombie, reduce de ~100 ops en serie a 1 batch paralelo.
    const results = await Promise.allSettled(
      (zombieTrips as ViajeRow[]).map(async (viaje) => {
        // 1. Marcar como cancelado por timeout
        await supabase
          .from('viajes')
          .update({ estado: 'cancelado_timeout' })
          .eq('id', viaje.id);

        // 2. Notificar al cliente
        if (viaje.cliente_tel && viaje.tenant_id) {
          const clientPhone = viaje.cliente_tel.startsWith('+')
            ? viaje.cliente_tel
            : `+${viaje.cliente_tel}`;

          const { data: empresa } = await supabase
            .from('empresas')
            .select('telefono_whatsapp')
            .eq('id', viaje.tenant_id)
            .maybeSingle<EmpresaRow>();

          if (empresa?.telefono_whatsapp) {
            await sendWhatsApp(
              clientPhone,
              `😔 Lo sentimos, no encontramos unidades disponibles en tu zona para tu viaje de *${viaje.origen}* a *${viaje.destino}*.\n\n¿Deseas intentarlo de nuevo? Solo escríbenos y con gusto te buscamos otro taxi.`,
              empresa.telefono_whatsapp
            );
          }
        }

        console.log(`[ZOMBIE] Viaje ${viaje.id} cerrado y cliente notificado.`);
      })
    );

    const cleaned = results.filter(r => r.status === 'fulfilled').length;
    const failed  = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) console.error(`[ZOMBIE] ${failed} viajes fallaron al cerrarse.`);

    return new Response(JSON.stringify({ cleaned, failed }), { status: 200 });

  } catch (err) {
    console.error('[ZOMBIE] Error inesperado:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
