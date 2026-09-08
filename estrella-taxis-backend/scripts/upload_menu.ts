import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

if (!SUPABASE_URL || !SUPABASE_KEY || !GEMINI_API_KEY) {
  console.error("❌ Faltan variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o GEMINI_API_KEY");
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface MenuItem {
  nombre: string;
  precio: number | null;
  detalles: Record<string, any>;
  tipo_item?: string;
}

async function getEmbedding(text: string): Promise<number[]> {
  const url = 'https://generativelanguage.googleapis.com/v1beta/openai/embeddings';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GEMINI_API_KEY}`
    },
    body: JSON.stringify({
      input: text,
      model: 'text-embedding-004'
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Error de Gemini API: ${errorText}`);
  }

  const data = await res.json();
  return data.data[0].embedding; // 768 dimensiones
}

async function uploadMenu() {
  const args = Deno.args;
  if (args.length < 2) {
    console.log("Uso: deno run --allow-net --allow-read --allow-env scripts/upload_menu.ts <TENANT_ID> <menu.json>");
    Deno.exit(1);
  }

  const tenantId = args[0];
  const filePath = args[1];

  console.log(`📖 Leyendo archivo: ${filePath}`);
  const fileContent = await Deno.readTextFile(filePath);
  const items: MenuItem[] = JSON.parse(fileContent);

  console.log(`🚀 Encontrados ${items.length} items para el tenant ${tenantId}. Generando embeddings e insertando...`);

  for (const item of items) {
    const tipo = item.tipo_item || 'comida';
    
    // El texto que Gemini usará para entender el platillo y crear el vector (RAG)
    const textToEmbed = `${item.nombre}. Precio: $${item.precio || 'Variable'}. Detalles: ${JSON.stringify(item.detalles)}`;
    
    console.log(`⏳ Procesando: ${item.nombre}...`);
    
    try {
      const embedding = await getEmbedding(textToEmbed);

      const { error } = await supabase.from('catalogos').insert({
        tenant_id: tenantId,
        tipo_item: tipo,
        nombre: item.nombre,
        precio: item.precio,
        detalles: item.detalles,
        embedding: embedding, // pgvector hace el casting automático del array
        disponible: true
      });

      if (error) {
        console.error(`❌ Error insertando ${item.nombre} en BD:`, error.message);
      } else {
        console.log(`✅ ¡Éxito! -> ${item.nombre}`);
      }
      
      // Breve pausa para no saturar el rate limit de Gemini
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (err: any) {
      console.error(`❌ Falló la generación de embedding para ${item.nombre}:`, err.message);
    }
  }

  console.log("🎉 ¡Menú subido correctamente!");
}

uploadMenu();
