import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6"

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Pedidos que llevan más de 2 minutos estancados en estado 'pendiente'
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select('id, updated_at')
      .in('estado', ['pendiente', 'buscando_repartidor'])
      .lt('updated_at', twoMinutesAgo)

    if (error) {
      console.error('[CRON-RESCATE] Error fetch pedidos:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    if (!pedidos || pedidos.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Ningún pedido estancado.' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    let rescued = 0;
    for (const pedido of pedidos) {
      console.log(`[CRON-RESCATE] 🚑 Rescatando pedido estancado: ${pedido.id}`);
      
      // Actualizamos el updated_at para que no vuelva a ser barrido en los próximos 2 min
      await supabase
          .from('pedidos')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', pedido.id);
      
      // Re-inyectamos al sistema de asignación
      try {
        await supabase.functions.invoke('asignar-repartidor', {
          body: { id: pedido.id }
        })
        rescued++;
      } catch(e) {
        console.error(`[CRON-RESCATE] Error invocando asignar-repartidor para ${pedido.id}:`, e);
      }
    }

    return new Response(JSON.stringify({ success: true, rescued_count: rescued }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
