import { dispatchToHuman, sendWhatsAppLocationRequest } from '../../whatsapp.ts';
import { EmpresaConfig, ToolData, SupabaseAppClient } from './types.ts';

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
  empresa: EmpresaConfig
): Promise<string> {
  const cleanAi = (aiResponseText || '')
    .replace(/```(?:json)?[\s\S]*?```/gi, '')
    .replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '')
    .trim();

  const combinedText = cleanAi
    ? `${cleanAi}\n\n📍 Si lo prefieres, solo toca este botón para enviarnos tu GPS exacto:`
    : `Por favor indícame tu calle y colonia para saber a dónde llevar tu orden 🛵.\n\n📍 Si lo prefieres, solo toca este botón para enviarnos tu GPS exacto:`;

  await sendWhatsAppLocationRequest(fromNumber, combinedText, empresa.waba_number || '');
  return combinedText;
}

export async function handleConsultarCatalogo(
  supabase: SupabaseAppClient,
  toolData: ToolData,
  empresa: EmpresaConfig
): Promise<string> {
  const query = (toolData.query || '').trim().toLowerCase();
  
  try {
    // Buscar todos los platillos/productos activos del comercio ordenados por categoría
    const { data: allItems, error: dbErr } = await supabase
      .from('catalogos')
      .select('nombre, precio, detalles, tipo_item')
      .eq('tenant_id', empresa.id)
      .eq('disponible', true)
      .order('tipo_item', { ascending: true, nullsFirst: false })
      .order('nombre', { ascending: true })
      .limit(60);

    if (dbErr) {
      console.error('[HANDLERS] Error consultando catalogo en DB:', dbErr);
      return 'Actualmente estamos actualizando el menú en sistema.';
    }

    if (!allItems || allItems.length === 0) {
      return `El restaurante no tiene productos cargados en el menú todavía.`;
    }

    // Siempre devolver todo el catálogo (hasta 60 items)
    // El LLM hará un mucho mejor trabajo encontrando lo que necesita si tiene todo el contexto,
    // y 60 items caben perfectamente en su ventana de contexto.
    let matches = allItems;

    // Formatear la respuesta para el LLM
    const itemsText = matches.map((m: any) => {
      let desc = `- ${m.nombre}`;
      if (m.precio !== null && m.precio !== undefined) desc += ` ($${m.precio} MXN)`;
      if (m.tipo_item) desc += ` | Categoría: ${m.tipo_item}`;
      if (m.detalles && m.detalles.descripcion) {
         desc += ` | Desc: ${m.detalles.descripcion}`;
      }
      return desc;
    }).join('\n');

    return `Catálogo de ${empresa.nombre_empresa || 'la empresa'}:\n${itemsText}\n\n(INSTRUCCIÓN: NO envíes esta lista completa ni uses viñetas. Responde en máximo 2 líneas súper breves y haz UNA sola pregunta para que el cliente decida. No desgloses precios a menos que te hayan preguntado cuánto cuesta.)`;

  } catch (err) {
    console.error('[HANDLERS] Excepción en consultar_catalogo:', err);
    return 'Actualmente estamos actualizando el menú en sistema.';
  }
}

