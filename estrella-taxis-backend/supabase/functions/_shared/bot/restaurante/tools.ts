import { resolveLocation } from '../../geo.ts';
import { sendWhatsApp, sendWhatsAppButtons, sendWhatsAppList } from '../../whatsapp.ts';
import { EmpresaConfig, ToolData, SupabaseAppClient } from '../core/types.ts';

export async function handlePreguntarTipoEntrega(
  fromNumber: string,
  empresa: EmpresaConfig,
  toNumber: string,
  toolData: ToolData,
  aiResponseText?: string
): Promise<string> {
  const nombreEmpresa = empresa.nombre_empresa || 'el restaurante';
  const cleanAi = (aiResponseText || '')
    .replace(/```(?:json)?[\s\S]*?```/gi, '')
    .replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '')
    .trim();

  // Usar lo que generó el LLM de forma natural, o el parámetro 'mensaje' de la herramienta
  const fallbackMsg = (toolData.mensaje as string) || `¿Cómo te gustaría recibir tu pedido de *${nombreEmpresa}*? Selecciona una opción abajo: 👇`;
  const texto = cleanAi.length > 0 ? cleanAi : fallbackMsg;

  await sendWhatsAppButtons(
    fromNumber,
    texto,
    [
      { id: 'order_type_domicilio', title: '🛵 A Domicilio' },
      { id: 'order_type_recoger', title: '🏬 Pasar a Recoger' }
    ],
    toNumber
  );
  return texto;
}

export async function handleEnviarPedido(
  supabase: SupabaseAppClient,
  toolData: ToolData,
  empresa: EmpresaConfig,
  fromNumber: string,
  toNumber: string,
  ciudadTenant: string
): Promise<string> {
  console.log(`[BOT] Ejecutando enviar_pedido para ${fromNumber}.`);
  
  const pedidoTexto = ((toolData.pedido as string) || '').trim();
  const lowerPedido = pedidoTexto.toLowerCase();
  
  // Guard 1: Pedido vacío o placeholder
  if (!pedidoTexto || pedidoTexto.length < 3 || lowerPedido.includes('pendiente') || lowerPedido.includes('por confirmar')) {
    return 'Por favor, dime exactamente qué te gustaría ordenar del menú para poder anotarlo correctamente.';
  }

  const rawDireccion = ((toolData.direccion as string) || '').trim();
  const lowerDir = rawDireccion.toLowerCase();
  const isPickup = (toolData.tipo_entrega === 'recoger') || 
                   lowerDir.includes('recoger') ||
                   lowerDir.includes('tienda') ||
                   lowerDir.includes('sucursal') ||
                   lowerDir.includes('llevar');

  // Guard 2: Dirección vacía o placeholder
  if (!isPickup) {
    if (rawDireccion.length < 4 || lowerDir.includes('pendiente') || lowerDir.includes('por confirmar') || lowerDir.includes('no especificada')) {
      return 'Para entrega a domicilio, por favor indícame tu calle y colonia exacta para saber a dónde llevarte tu orden 🛵.';
    }
  }

  const rawNombre = ((toolData.nombre as string) || '').trim();
  const lowerNombre = rawNombre.toLowerCase();
  
  // Guard 3: Nombre vacío o genérico
  if (!rawNombre || rawNombre.length < 2 || lowerNombre === 'cliente' || lowerNombre.includes('pendiente') || lowerNombre.includes('por confirmar')) {
    return '¿Me podrías indicar a qué nombre anoto el pedido, por favor?';
  }

  const nombreCliente = rawNombre;
  const direccion = isPickup ? 'Recoger en tienda' : rawDireccion;
  const nombreEmpresa = empresa.nombre_empresa || 'la empresa';

  let maxPrecioEnvio = null;
  if (!isPickup) {
    try {
      const locEntrega = await resolveLocation(supabase, direccion, ciudadTenant, empresa.id);
      maxPrecioEnvio = locEntrega?.precio || null;
    } catch (error) {
      console.error('[HANDLERS] Error resolviendo ubicación:', error);
    }
  }

  const { data: newPedido, error: insertErr } = await supabase.from('pedidos').insert({
    tenant_id: empresa.id,
    cliente_tel: fromNumber,
    cliente_nombre: nombreCliente,
    detalle_pedido: pedidoTexto,
    direccion_entrega: direccion,
    costo_envio: isPickup ? 0 : maxPrecioEnvio,
    estado: 'pendiente'
  }).select('id').single();

  if (insertErr || !newPedido) {
    console.error('[HANDLERS] Error insertando pedido:', insertErr);
    return 'Hubo un problemita guardando tu pedido, pero déjame avisarle a un agente para que te atienda personalmente.';
  }

  // Avisar a la cocina con BOTONES interactivos
  if (empresa.dispatcher_phone) {
    const modalidadCocina = isPickup
      ? '🏬 *RECOGER EN TIENDA*'
      : `🛵 *A DOMICILIO*\n📍 *Dirección:* ${direccion}`;

    const mensajeCocina =
`🍔 *¡NUEVO PEDIDO!*
━━━━━━━━━━━━━━━━━━━━
👤 *Cliente:* ${nombreCliente}
📞 *Tel:* ${fromNumber}
━━━━━━━━━━━━━━━━━━━━
📋 *Pedido:*
${pedidoTexto}
━━━━━━━━━━━━━━━━━━━━
${modalidadCocina}
━━━━━━━━━━━━━━━━━━━━
¿Confirmas la preparación?`;
    try {
      await sendWhatsAppButtons(
        empresa.dispatcher_phone,
        mensajeCocina,
        [
          { id: `order_accept_${newPedido.id}`, title: '✅ Confirmar' },
          { id: `order_reject_${newPedido.id}`, title: '❌ Rechazar' }
        ],
        toNumber
      );
    } catch (waErr) {
      console.error('[HANDLERS] Error notificando a cocina:', waErr);
    }
  } else {
    console.warn(`[HANDLERS] Empresa ${empresa.id} no tiene dispatcher_phone. La cocina no fue notificada por WA.`);
  }

  // Respuesta al cliente con UX cuidada (SIN dar costos ni totales de envío)
  if (isPickup) {
    return `¡Anotado! 🗒️ Tu pedido ha sido enviado a la cocina.

👤 *Cliente:* ${nombreCliente}
📋 *Orden:* ${pedidoTexto}
🏠 *Modalidad:* Recoger en *${nombreEmpresa}*

Cuando llegues pregunta por tu orden a nombre de *${nombreCliente}*. 👋
En un momento la cocina confirmará tu pedido y te avisaremos. ¡Muchas gracias! 😋`;
  } else {
    return `¡Anotado! 🗒️ Tu pedido ha sido enviado a la cocina.

👤 *Cliente:* ${nombreCliente}
📋 *Orden:* ${pedidoTexto}
🚛 *Modalidad:* Entrega a domicilio

En un momento la cocina confirmará tu pedido y te avisaremos cuando vaya en camino. ¡Muchas gracias por pedir en ${nombreEmpresa}! 😋`;
  }
}

export async function handleCotizarEnvio(
  supabase: SupabaseAppClient,
  toolData: ToolData,
  empresa: EmpresaConfig,
  ciudadTenant: string
): Promise<string> {
  const direccion = (toolData.direccion as string) || '';
  if (!direccion) {
    return '¿Me podrías decir a qué colonia o calle sería el envío para cotizarlo?';
  }

  try {
    const locEntrega = await resolveLocation(supabase, direccion, ciudadTenant, empresa.id);
    if (locEntrega && locEntrega.precio !== null && locEntrega.precio !== undefined) {
       return `El costo aproximado de envío a ${locEntrega.nombre_zona || direccion} es de $${locEntrega.precio} MXN. Recuerda que si prefieres pasar a recoger tu pedido a la sucursal, no tiene costo de envío. ¿Qué te preparamos?`;
    }
  } catch (error) {
    console.error('[HANDLERS] Error cotizando envío:', error);
  }

  return `El costo exacto de envío te lo confirma el repartidor, o también puedes pasar a recogerlo a la sucursal sin costo. ¿Qué te preparamos?`;
}

function getEmojiForMenu(texto: string): string {
  const t = texto.toLowerCase();
  if (t.includes('pollo') || t.includes('alita') || t.includes('boneless') || t.includes('nugget')) return '🍗';
  if (t.includes('hamburguesa') || t.includes('burger')) return '🍔';
  if (t.includes('taco')) return '🌮';
  if (t.includes('pizza')) return '🍕';
  if (t.includes('sushi') || t.includes('rollo')) return '🍣';
  if (t.includes('papa') || t.includes('frita')) return '🍟';
  if (t.includes('salsa') || t.includes('aderezo') || t.includes('dip')) return '🥣';
  if (t.includes('ensalada') || t.includes('vegetariano') || t.includes('coleslaw')) return '🥗';
  if (t.includes('postre') || t.includes('pastel') || t.includes('pay') || t.includes('helado')) return '🍰';
  if (t.includes('bebida') || t.includes('refresco') || t.includes('agua') || t.includes('jugo') || t.includes('coca') || t.includes('pepsi')) return '🥤';
  if (t.includes('cerveza') || t.includes('chela')) return '🍺';
  if (t.includes('combo') || t.includes('paquete') || t.includes('familiar')) return '🍱';
  return '🍽️';
}

export async function handleMostrarMenuLista(
  toolData: ToolData,
  fromNumber: string,
  toNumber: string,
  aiResponseText?: string
): Promise<string> {
  const title = (aiResponseText && aiResponseText.length > 5) ? aiResponseText : ((toolData.mensaje as string) || 'Aquí tienes nuestras opciones:');
  const buttonText = (toolData.boton as string) || 'Ver Menú';
  const items = (toolData.items as Array<{nombre: string, descripcion?: string, categoria?: string}>) || [];
  
  if (items.length === 0) {
    return 'No encontré opciones para mostrar en la lista.';
  }

  // Agrupar por categoría
  const groupedItems = items.slice(0, 10).reduce((acc: any, item, i) => {
    const cat = (item.categoria || 'Menú').substring(0, 24);
    if (!acc[cat]) acc[cat] = [];
    const emoji = getEmojiForMenu(item.nombre + ' ' + (item.descripcion || ''));
    acc[cat].push({
      id: `menu_item_${i}_${item.nombre.substring(0, 10).replace(/\s/g, '')}`,
      title: `${emoji} ${item.nombre}`.substring(0, 24),
      description: (item.descripcion || '').substring(0, 72)
    });
    return acc;
  }, {});

  const sections = Object.keys(groupedItems).map(cat => ({
    title: cat,
    rows: groupedItems[cat]
  }));

  await sendWhatsAppList(fromNumber, title, buttonText, sections, toNumber);
  return `[El menú interactivo en formato lista fue enviado al cliente con éxito. No repitas las opciones en texto, simplemente pregúntale de forma breve y amable qué se le antoja.]`;
}
