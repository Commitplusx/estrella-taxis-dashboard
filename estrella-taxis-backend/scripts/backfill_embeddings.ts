import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Claves extraídas de tu PM2
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function backfillEmbeddings() {
  console.log("🔍 Buscando productos sin vector matemático...");
  
  // Buscar productos que NO tienen embedding
  const { data: productosSinVector, error } = await supabase
    .from('catalogos')
    .select('*')
    .is('embedding', null);

  if (error) {
    console.error("❌ Error al buscar productos:", error);
    return;
  }

  if (!productosSinVector || productosSinVector.length === 0) {
    console.log("✅ Todos los productos ya tienen su vector matemático.");
    return;
  }

  console.log(`⚠️ Se encontraron ${productosSinVector.length} productos sin vector. Generando...`);

  for (const producto of productosSinVector) {
    const textoRepresentativo = `${producto.nombre}. Precio: ${producto.precio || 'No especificado'}. Detalles: ${producto.detalles?.descripcion || ''}`;
    
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: textoRepresentativo,
          dimensions: 768
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Error de OpenAI API: ${errorText}`);
      }

      const data = await res.json();
      const embedding = data.data[0].embedding;

      // Actualizar en Supabase
      const { error: updateError } = await supabase
        .from('catalogos')
        .update({ embedding })
        .eq('id', producto.id);

      if (updateError) {
        console.error(`❌ Error actualizando ${producto.nombre}:`, updateError);
      } else {
        console.log(`✅ Vector generado y guardado para: ${producto.nombre}`);
      }

      // Pequeña pausa para no saturar la API de Gemini
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.error(`❌ Falló la generación para ${producto.nombre}:`, err);
    }
  }
  
  console.log("🎉 Proceso de backfill completado.");
}

backfillEmbeddings();
