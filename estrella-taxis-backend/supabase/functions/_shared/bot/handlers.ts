import { resolveLocation } from '../geo.ts';
import { sendWhatsApp } from '../whatsapp.ts';

/**
 * Maneja la ejecución de la herramienta "enviar_pedido" para restaurantes
 */
export async function handleEnviarPedido(
  supabase: any,
  toolData: any,
  empresa: any,
  fromNumber: string,
  toNumber: string,
  ciudadTenant: string
): Promise<string> {
  console.log(`[BOT] Ejecutando enviar_pedido para ${fromNumber}.`);
  
  const rawDireccion = (toolData.direccion || '').trim();
  const isPickup = (toolData.tipo_entrega === 'recoger') || 
                   rawDireccion.toLowerCase().includes('recoger') ||
                   rawDireccion.toLowerCase().includes('tienda') ||
                   rawDireccion.toLowerCase().includes('sucursal');

  const nombreCliente = toolData.nombre || 'Cliente';
  const pedidoTexto = toolData.pedido || 'Pedido sin especificar';
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

  const { error: insertErr } = await supabase.from('pedidos').insert({
    tenant_id: empresa.id,
    cliente_tel: fromNumber,
    cliente_nombre: nombreCliente,
    detalle_pedido: pedidoTexto,
    direccion_entrega: direccion,
    costo_envio: isPickup ? 0 : maxPrecioEnvio,
    estado: 'pendiente'
  });

  if (insertErr) {
    console.error('[HANDLERS] Error insertando pedido:', insertErr);
    return 'Hubo un problemita guardando tu pedido, pero déjame avisarle a un agente para que te atienda personalmente.';
  }

  // Avisar a la cocina
  if (empresa.dispatcher_phone) {
    const modalidadCocina = isPickup
      ? '🏬 *MODALIDAD: PASAR A RECOGER EN TIENDA*'
      : `🛵 *MODALIDAD: A DOMICILIO*\n📍 *Dirección:* ${direccion}`;

    const mensajeCocina = `🍔 *¡NUEVO PEDIDO RECIBIDO!* 🍔\n\n👤 *Cliente:* ${nombreCliente}\n📞 *Tel:* ${fromNumber}\n📋 *Pedido:* ${pedidoTexto}\n${modalidadCocina}\n\n_Gestiona el pedido o confirma con el cliente._`;
    try {
      await sendWhatsApp(empresa.dispatcher_phone, mensajeCocina, toNumber);
    } catch (waErr) {
      console.error('[HANDLERS] Error notificando a cocina:', waErr);
    }
  } else {
    console.warn(`[HANDLERS] Empresa ${empresa.id} no tiene dispatcher_phone. La cocina no fue notificada por WA.`);
  }

  if (isPickup) {
    return `¡Anotado! 📝 Acabo de mandar tu orden a la cocina.\n\n👤 *Cliente:* ${nombreCliente}\n📋 *Pedido:* ${pedidoTexto}\n🏬 *Modalidad:* Pasar a recoger en tienda\n\nEn un momento te confirmarán los detalles. ¡Gracias por pedir con ${nombreEmpresa}! 😋`;
  } else {
    return `¡Anotado! 📝 Acabo de mandar tu orden a la cocina.\n\n👤 *Cliente:* ${nombreCliente}\n📋 *Pedido:* ${pedidoTexto}\n📍 *Dirección:* ${direccion}\n\nEn un momento te confirmarán los detalles. ¡Gracias por pedir con ${nombreEmpresa}! 😋`;
  }
}

/**
 * Maneja la ejecución de la herramienta "cotizar_envio" para restaurantes
 */
export async function handleCotizarEnvio(
  supabase: any,
  toolData: any,
  empresa: any,
  ciudadTenant: string
): Promise<string> {
  const direccion = toolData.direccion || '';
  if (!direccion) {
    return '¿Me podrías decir a qué colonia o calle sería el envío para cotizarlo?';
  }

  try {
    const locEntrega = await resolveLocation(supabase, direccion, ciudadTenant, empresa.id);
    if (locEntrega && locEntrega.precio !== null && locEntrega.precio !== undefined) {
       return `El costo aproximado de envío a ${locEntrega.nombre_zona || direccion} es de $${locEntrega.precio} MXN. ¿Qué te vamos a preparar?`;
    }
  } catch (error) {
    console.error('[HANDLERS] Error cotizando envío:', error);
  }

  return `No tengo el costo exacto a esa zona ahorita, pero puedes hacer tu pedido y te confirmamos el total antes de enviarlo. ¿Qué te preparamos?`;
}
