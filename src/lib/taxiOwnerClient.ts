import{trackingCall}from './trackingClient';
import{parseOwnerContext,type OwnerContext}from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/ownerContracts.ts';
export interface OwnerShift{action:'owner_shift';requestId:string;contactId:string|null;expected:string|null}
export interface OwnerRegistration{action:'owner_driver_save';requestId:string;contactId:string;expected:string|null;name:string;phone:string;email:string|null;password:string}
export type OwnerCommand=OwnerShift|OwnerRegistration;
export const taxiOwnerClient={
 read:async(signal?:AbortSignal):Promise<OwnerContext>=>parseOwnerContext(await trackingCall('taxi-bot-admin',{action:'owner_context'},signal)),
 save:async(command:OwnerCommand):Promise<OwnerContext>=>parseOwnerContext(await trackingCall('taxi-bot-admin',{...command})),
};
