import { getTaxisPrompt } from '../taxis/prompt.ts';
import { handleBookTaxi, handleCotizarViaje, handleCancelarViaje } from '../taxis/tools.ts';

import { getRestaurantePrompt } from '../restaurante/prompt.ts';
import { handleEnviarPedido, handleCotizarEnvio, handlePreguntarTipoEntrega, handleMostrarMenuLista, handleEnviarTicketFacturacion } from '../restaurante/tools.ts';

import { getFarmaciaPrompt } from '../farmacia/prompt.ts';
import { getGenericoPrompt } from '../otro/prompt.ts';

import { handleEscalarHumano, handlePedirUbicacion, handleConsultarCatalogo } from './commonTools.ts';
import { EmpresaConfig, ToolData, SupabaseAppClient, PermisosSistema } from './types.ts';

export function buildSystemPrompt(empresa: EmpresaConfig, infoViajeActivo: string = ''): string {
  const tipo = empresa.tipo_negocio || 'taxi';

  if (tipo === 'taxi') {
    return getTaxisPrompt(empresa, infoViajeActivo);
  } else if (tipo === 'restaurante' || tipo === 'comida') {
    return getRestaurantePrompt(empresa);
  } else if (tipo === 'farmacia') {
    return getFarmaciaPrompt(empresa);
  } else {
    // refaccionaria, otro, etc.
    return getGenericoPrompt(empresa);
  }
}

export async function routeToolCall(
  supabase: SupabaseAppClient,
  executedTool: string,
  toolData: ToolData,
  empresa: EmpresaConfig,
  fromNumber: string,
  toNumber: string,
  ciudadTenant: string,
  aiResponseText: string,
  permisosSistema: PermisosSistema,
  APP_URL: string
): Promise<{ finalResponse: string, trackingUrl: string | null }> {
  let finalResponse = aiResponseText;
  let trackingUrl = null;

  try {
    // 1. Herramientas de Taxis
    if (executedTool === 'book_taxi') {
      const res = await handleBookTaxi(supabase, toolData, empresa, fromNumber, toNumber, ciudadTenant, permisosSistema, APP_URL);
      finalResponse = res.aiResponse;
      trackingUrl = res.trackingUrlForCTA;
    } 
    else if (executedTool === 'cotizar_viaje') {
      finalResponse = await handleCotizarViaje(supabase, toolData, empresa, ciudadTenant);
    } 
    else if (executedTool === 'cancelar_viaje') {
      finalResponse = await handleCancelarViaje(supabase, empresa, fromNumber, toNumber);
    }
    
    else if (executedTool === 'preguntar_tipo_entrega') {
      finalResponse = await handlePreguntarTipoEntrega(fromNumber, empresa, toNumber, toolData, aiResponseText);
    }
    else if (executedTool === 'mostrar_menu_lista') {
      finalResponse = await handleMostrarMenuLista(toolData, fromNumber, toNumber, aiResponseText);
    }
    else if (executedTool === 'enviar_pedido') {
      finalResponse = await handleEnviarPedido(supabase, toolData, empresa, fromNumber, toNumber, ciudadTenant);
    } 
    else if (executedTool === 'cotizar_envio') {
      finalResponse = await handleCotizarEnvio(supabase, toolData, empresa, ciudadTenant);
    }
    else if (executedTool === 'enviar_ticket_facturacion') {
      finalResponse = await handleEnviarTicketFacturacion(toolData, empresa, fromNumber, toNumber);
    }
    
    // 3. Herramientas Genéricas / Core
    else if (executedTool === 'escalar_humano') {
      finalResponse = await handleEscalarHumano(supabase, toolData, empresa, fromNumber, toNumber);
    } 
    else if (executedTool === 'pedir_ubicacion') {
      finalResponse = await handlePedirUbicacion(aiResponseText, fromNumber, empresa, toNumber);
    }
    else if (executedTool === 'consultar_catalogo') {
      finalResponse = await handleConsultarCatalogo(supabase, toolData, empresa);
    }
  } catch (error) {
    console.error(`[ROUTER] Error ejecutando tool ${executedTool}:`, error);
    finalResponse = 'Hubo un error procesando tu solicitud. Permíteme comunicarte con un humano.';
  }

  return { finalResponse, trackingUrl };
}
