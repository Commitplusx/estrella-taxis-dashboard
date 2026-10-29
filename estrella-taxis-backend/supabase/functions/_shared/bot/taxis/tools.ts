import type {EmpresaConfig,ToolData,SupabaseAppClient,PermisosSistema}from'../core/types.ts';
/**
 * Legacy router adapters. Taxi mutations now run before the model router through
 * runtime.ts → coordinator.ts → taxi_bot_commit. A model tool call has neither a
 * verified inbound event nor a current passenger confirmation and cannot dispatch.
 */
export function handleCotizarViaje(_supabase:SupabaseAppClient,_toolData:ToolData,_empresa:EmpresaConfig,_ciudad:string):Promise<string>{
  return Promise.resolve('No tengo una tarifa confirmada en esta ruta. La base debe revisar el recorrido; no se ha solicitado ninguna unidad.');
}
export function handleCancelarViaje(_supabase:SupabaseAppClient,_empresa:EmpresaConfig,_from:string,_to:string):Promise<string>{
  return Promise.resolve('No pude confirmar una cancelación por esta ruta. Revisa tu viaje con la base antes de darlo por cancelado.');
}
export function handleBookTaxi(_supabase:SupabaseAppClient,_toolData:ToolData,_empresa:EmpresaConfig,_from:string,_to:string,_ciudad:string,_permisos:PermisosSistema,_url:string):Promise<{aiResponse:string;trackingUrlForCTA:string|null}>{
  return Promise.resolve({aiResponse:'Este canal necesita completar la configuración del bot de taxis. No se creó un viaje ni se solicitó una unidad.',trackingUrlForCTA:null});
}
