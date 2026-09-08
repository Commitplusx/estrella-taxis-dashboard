import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Manejo de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; // Acceso con service role para realizar operaciones
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { id, tenant_id, nombre, tipo_item, precio, detalles, disponible } = body;

    if (!tenant_id || !nombre) {
      throw new Error('tenant_id y nombre son obligatorios');
    }

    // 1. Generar texto representativo para el embedding
    const textoRepresentativo = `${nombre}. Precio: ${precio || 'No especificado'}. Detalles: ${detalles?.descripcion || ''}`;

    // 2. Llamar a text-embedding-004 (el modelo actual de Google Gemini para embeddings)
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('No GEMINI_API_KEY configured');
    }

    // DEBUG: Consultar la lista de modelos disponibles para ver cómo se llama realmente el de embeddings
    const debugRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
    const debugData = await debugRes.json();
    console.log("Modelos disponibles:", JSON.stringify(debugData.models.map((m: any) => m.name)));

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: textoRepresentativo }] }
      })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error("Gemini Error:", err);
      throw new Error("Failed to generate embedding: " + err);
    }

    const geminiData = await geminiRes.json();
    const embedding = geminiData.embedding.values;
    console.log("Embedding generado con éxito, longitud:", embedding.length);

    // 3. Upsert en Supabase
    const itemData: any = {
      tenant_id,
      nombre,
      tipo_item: tipo_item || 'General',
      precio: precio || null,
      detalles: detalles || {},
      disponible: disponible ?? true,
      embedding
    };

    if (id) {
      itemData.id = id;
    }

    const { data, error } = await supabase
      .from('catalogos')
      .upsert(itemData)
      .select()
      .single();

    if (error) {
      console.error("Supabase Upsert Error:", error);
      throw new Error("Error inserting into catalogos: " + error.message);
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error en manage-catalog:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
