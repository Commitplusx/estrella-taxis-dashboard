import {trackingCall}from './trackingClient';
import {parseDispatchStatus,type DispatchStatus}from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/dispatchContracts.ts';
export interface TaxiDispatchClient{
 status:(tenantId:string,waba:string,signal?:AbortSignal)=>Promise<DispatchStatus>;
 resume:(tenantId:string,waba:string,requestId:string,revision:number,signal?:AbortSignal)=>Promise<DispatchStatus>;
}
export const taxiDispatchClient:TaxiDispatchClient={
 status:async(tenantId,waba,signal)=>parseDispatchStatus(await trackingCall('taxi-bot-admin',{action:'dispatch_status',tenantId,waba},signal)),
 resume:async(tenantId,waba,requestId,revision,signal)=>parseDispatchStatus(await trackingCall('taxi-bot-admin',{action:'dispatch_resume',tenantId,waba,requestId,revision},signal)),
};
