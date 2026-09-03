import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) throw new Error('Falta el id del pedido');

      const { data, error } = await supabase
        .from('pedidos')
        .select(`
          id,
          created_at,
          descripcion,
          direccion,
          estado,
          total,
          metodo_pago,
          lat,
          lng,
          notas,
          cliente_nombre,
          cliente_tel,
          restaurantes (
            nombre_comercial,
            direccion,
            lat,
            lng,
            foto_fachada_url
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      // Solo devolvemos info si es un estado válido para externos
      if (!['externo', 'en_camino', 'entregado', 'cancelado'].includes(data.estado)) {
        throw new Error('El pedido no está asignado a externos o ya fue procesado.');
      }

      return new Response(JSON.stringify(data), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (req.method === 'POST') {
      const { id, action } = await req.json();
      if (!id || !action) throw new Error('Faltan datos');
      if (!['en_camino', 'entregado'].includes(action)) {
        throw new Error('Acción no permitida');
      }

      const { data: current, error: checkError } = await supabase
        .from('pedidos')
        .select('estado')
        .eq('id', id)
        .single();

      if (checkError) throw checkError;

      const allowedFrom = action === 'en_camino' ? ['externo'] : ['en_camino', 'externo'];
      if (!allowedFrom.includes(current.estado)) {
        throw new Error('Transición de estado inválida');
      }

      const { error: updateError } = await supabase
        .from('pedidos')
        .update({ estado: action })
        .eq('id', id);

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('Error en tracker-api:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
