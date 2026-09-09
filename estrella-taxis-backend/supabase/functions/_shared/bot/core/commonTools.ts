import { dispatchToHuman, sendWhatsAppLocationRequest } from '../../whatsapp.ts';
import { EmpresaConfig, ToolData, SupabaseAppClient } from './types.ts';

export interface CatalogoItem {
  nombre: string;
  precio?: number | null;
  tipo_item?: string | null;
  detalles?: {
    descripcion?: string;
    [key: string]: unknown;
  } | null;
}

export async function handleEscalarHumano(
  supabase: SupabaseAppClient,
  toolData: ToolData,
  empresa: EmpresaConfig,
  fromNumber: string,
  toNumber: string
): Promise<string> {
  console.log(`[BOT] Escalando a humano para ${fromNumber}. Motivo: ${toolData.motivo}`);

  // Cambiar estado a human en DB para silenciar al bot
  await supabase.from('whatsapp_sessions').update({ estado: 'human' }).eq('phone', fromNumber).eq('waba_number', toNumber);

  // Notificamos al humano
  dispatchToHuman({
    origen: "No aplica (Escalamiento)", destino: (toolData.motivo as string) || (toolData.resumen as string) || 'Escalamiento', telefono: fromNumber,
    tarifa: null,
    dispatcherPhoneOverride: empresa.dispatcher_phone,
    isEscalation: true
  });

  return "Te comunico con un agente humano en un momento para que te apoye con esto. 🧑‍💻";
}

export async function handlePedirUbicacion(
  aiResponseText: string,
  fromNumber: string,
  empresa: EmpresaConfig,
  toNumber?: string  // ← toNumber explícito del webhook (más confiable que empresa.waba_number)
): Promise<string> {
  const cleanAi = (aiResponseText || '')
    .replace(/```(?:json)?[\s\S]*?```/gi, '')
    .replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '')
    .trim();

  const combinedText = cleanAi
    ? `${cleanAi}\n\n📍 Si lo prefieres, solo toca este botón para enviarnos tu GPS exacto:`
    : `Por favor indícame tu calle y colonia para saber a dónde llevar tu orden 🛵.\n\n📍 Si lo prefieres, solo toca este botón para enviarnos tu GPS exacto:`;

  // Priorizar toNumber del webhook — es el número WABA real que recibió el mensaje.
  // empresa.waba_number puede estar desactualizado si el tenant cambió de número.
  const wabaNumber = toNumber || empresa.waba_number || '';
  await sendWhatsAppLocationRequest(fromNumber, combinedText, wabaNumber);
  return combinedText;
}

export async function handleConsultarCatalogo(
  supabase: SupabaseAppClient,
  toolData: ToolData,
  empresa: EmpresaConfig
): Promise<string> {
  const query = (toolData.query || '').trim().toLowerCase();

  try {
    let matches: CatalogoItem[] = [];

    // Si la query es muy corta o está vacía, devolvemos un top 60 básico
    if (!query || query.length <= 2) {
      const { data, error } = await supabase
        .from('catalogos')
        .select('nombre, precio, detalles, tipo_item')
        .eq('tenant_id', empresa.id)
        .eq('disponible', true)
        .order('tipo_item', { ascending: true, nullsFirst: false })
        .order('nombre', { ascending: true })
        .limit(60);

      if (error) throw error;
      matches = data as CatalogoItem[];
    } else {
      // 1. OPCIÓN 1: BÚSQUEDA SEMÁNTICA VECTORIAL (RAG)
      // Generar Embedding con OpenAI
      let queryEmbedding: number[] = [];
      try {
        const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
        if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
        
        const url = `https://api.openai.com/v1/embeddings`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: query,
            dimensions: 768
          })
        });

        if (!res.ok) throw new Error(`OpenAI API Error: ${await res.text()}`);
        const data = await res.json();
        queryEmbedding = data.data[0].embedding;
      } catch (embErr) {
        console.error('[CATALOGO DEBUG] Error generando embedding, cayendo a búsqueda vacía:', embErr);
        // Si falla el embedding, no devolvemos nada para evitar alucinaciones masivas
        return `Ocurrió un error al procesar tu búsqueda. Por favor intenta de nuevo.`;
      }

      // 2. Buscar usando pgvector
      const { data: vectorData, error: rpcErr } = await supabase.rpc('match_catalogos', {
        query_embedding: queryEmbedding,
        match_threshold: 0.30, // Umbral más estricto para evitar traer todo el menú
        match_count: 10, // Top 10 resultados es suficiente
        p_tenant_id: empresa.id
      });

      if (rpcErr) throw rpcErr;

      if (vectorData && vectorData.length > 0) {
        matches = vectorData as CatalogoItem[];
      } else {
        console.warn(`[CATALOGO DEBUG] Búsqueda semántica "${query}" no obtuvo resultados de pgvector.`);
        return `No se encontraron productos en el sistema que coincidan semánticamente con "${query}". \n\nINSTRUCCIÓN PARA EL LLM: Dile al cliente que no encuentras ese producto o paquete, y pregúntale si gusta ver otra categoría. NUNCA inventes el contenido.`;
      }
    }

    if (!matches || matches.length === 0) {
      console.warn(`[CATALOGO] Empresa ${empresa.id} no tiene productos.`);
      return `[CATÁLOGO VACÍO] Este restaurante aún no tiene productos cargados.`;
    }

    // Formatear con bloques claros por producto para que el LLM no mezcle datos entre productos
    const itemsText = matches.map((m: CatalogoItem) => {
      const precio = (m.precio !== null && m.precio !== undefined) ? `$${m.precio} MXN` : 'Precio no disponible';
      const contenido = (m.detalles?.descripcion) ? m.detalles.descripcion : 'Sin descripción en sistema.';
      const categoria = m.tipo_item || 'Sin categoría';
      return `---\nNOMBRE: ${m.nombre}\nCATEGORÍA: ${categoria}\nPRECIO: ${precio}\nCONTENIDO: ${contenido}\n---`;
    }).join('\n');

    const finalResponse = `Catálogo de ${empresa.nombre_empresa || 'la empresa'}:\n${itemsText}\n\n⚠️ INSTRUCCIÓN CRÍTICA PARA EL LLM:\n- Usa ÚNICAMENTE los datos de arriba. NUNCA inventes, supongas ni completes información que no esté explícitamente en el campo CONTENIDO.\n- Si el cliente preguntó por un producto específico, busca el bloque que MEJOR COINCIDA con su petición (sé inteligente: si pide "paquete 4", asume que se refiere a "Combo 4") y respóndele con su PRECIO y CONTENIDO tal como aparece arriba.\n- Si el campo CONTENIDO dice "Sin descripción en sistema.", responde honestamente: "No tengo el detalle exacto, pero te lo confirmo con la cocina."\n- Si el cliente solo quiere ver opciones en general, menciona las categorías disponibles y pregúntale qué le interesa.`;

    console.log(`[CATALOGO DEBUG] Tool called with query: "${query}"`);
    console.log(`[CATALOGO DEBUG] Devueltos ${matches.length} productos al LLM.`);

    return finalResponse;

  } catch (err: any) {
    console.error('[HANDLERS] Excepción en consultar_catalogo:', err);
    return 'Actualmente estamos actualizando el menú en sistema.';
  }
}
