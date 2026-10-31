import {trackingCall} from './trackingClient';
import {parseSimulationResult,type TaxiSimulationInput} from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/simulationContracts.ts';
export async function runTaxiSimulation(tenantId:string,waba:string,requestId:string,input:TaxiSimulationInput,signal?:AbortSignal){
 const body={action:'dispatch_simulation',tenantId,waba,requestId,...input};
 if(new TextEncoder().encode(JSON.stringify(body)).byteLength>15500)throw Error('Hay demasiados cambios en esta prueba. Reduce las unidades modificadas y vuelve a simular.');
 const result=parseSimulationResult(await trackingCall('taxi-bot-admin',body,signal));
 if(result.source!=='live')throw Error('La respuesta no corresponde a la flota real. Ejecuta una simulación nueva.');return result;
}
