import { FleetApi } from '../../tracking/auth.ts';
import { requestJson, type Fetcher } from '../../tracking/http.ts';
import type { TrackingStore } from '../../tracking/store.ts';
import { findOptimalTaxi, getDistanceFromLatLonInKm } from '../../algorithms/headingMatcher.ts';
import type { TraccarDevice, TraccarPosition } from '../../tracking/fleetTypes.ts';
import { flag, positiveId, TrackingError } from '../../tracking/contracts.ts';
import { record, text, coord, type Place, type TaxiChannel } from './contracts.ts';
import type { TaxiServices, LocationResult } from './coordinator.ts';
import { createTaxiInterpreter } from './interpreter.ts';
import { taxiH3Scope } from './h3.ts';
export function createTaxiServices(store:TrackingStore,fetcher:Fetcher,config:{mapsKey:string;modelKey:string;traccarUrl:string;traccarEmail:string;traccarPassword:string}):TaxiServices {
  async function resolve(address:string,c:TaxiChannel,signal?:AbortSignal):Promise<LocationResult>{
    const gps=/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(address);
    if(gps&&coord(Number(gps[1]),Number(gps[2])))return {kind:'resolved',place:{text:address,lat:Number(gps[1]),lng:Number(gps[2]),placeId:null}};
    // No redirects or user-supplied URLs are fetched. Native location is the fallback for short links.
    if(/https?:\/\//i.test(address)||/[%*_]/.test(address))return {kind:'unavailable'};
    const aliases=await store.read('lugares_frecuentes',new URLSearchParams({select:'nombre,lat,lng',tenant_id:'eq.'+c.tenantId,activo:'eq.true',alias:'ilike.'+address,limit:'3'}));
    const known:Place[]=[];
    for(const a of aliases){if(!record(a)||!text(a.nombre,400)||!coord(a.lat,a.lng)||typeof a.lng!=='number')throw new TrackingError(502,'taxi_bad_alias','Referencia local no válida.');known.push({text:String(a.nombre),lat:a.lat,lng:a.lng,placeId:null});}
    const unique=known.filter((p,i,all)=>all.findIndex((q)=>q.lat===p.lat&&q.lng===p.lng)===i);
    if(unique.length>1)return {kind:'ambiguous',labels:unique.map((p)=>p.text)};
    if(unique.length===1)return {kind:'resolved',place:unique[0]};
    if(!config.mapsKey)return {kind:'unavailable'};
    const query=new URLSearchParams({address:address+', '+c.city,language:'es',key:config.mapsKey});
    const data=(await requestJson(fetcher,'https://maps.googleapis.com/maps/api/geocode/json?'+query,{signal},8000,262144)).data;
    if(!record(data)||data.status!=='OK'||!Array.isArray(data.results)||data.results.length!==1)return {kind:'unavailable'};
    const r=data.results[0];if(!record(r)||r.partial_match===true||!record(r.geometry)||!record(r.geometry.location)||!coord(r.geometry.location.lat,r.geometry.location.lng)||typeof r.geometry.location.lng!=='number'||!text(r.formatted_address,400)||!text(r.place_id,256))return {kind:'unavailable'};
    if(!['ROOFTOP','RANGE_INTERPOLATED'].includes(String(r.geometry.location_type)))return {kind:'ambiguous',labels:[String(r.formatted_address)]};
    const p:Place={text:String(r.formatted_address),lat:r.geometry.location.lat,lng:r.geometry.location.lng,placeId:String(r.place_id)};
    return getDistanceFromLatLonInKm(p.lat,p.lng,c.centerLat,c.centerLng)<=c.radiusKm?{kind:'resolved',place:p}:{kind:'unavailable'};
  }
  return {
    interpret:(current,session,c,signal,observe)=>createTaxiInterpreter(fetcher,config.modelKey,c.model,observe)(current,session,c,signal),resolve,
    quote:async(origin,destination,c,signal)=>{
      if(!coord(origin.lat,origin.lng)||!coord(destination.lat,destination.lng)||getDistanceFromLatLonInKm(origin.lat,origin.lng,c.centerLat,c.centerLng)>c.radiusKm||getDistanceFromLatLonInKm(destination.lat,destination.lng,c.centerLat,c.centerLng)>c.radiusKm)return null;
      if(c.pricingMode==='h3_zone_max'){
        const scope=taxiH3Scope(origin,destination);
        const quote=await store.rpc('taxi_bot_h3_quote',{p_tenant:c.tenantId,p_waba:c.waba,p_origin:scope.originCell,p_destination:scope.destinationCell});
        if(!record(quote)||!['priced','uncovered','invalid_zone','channel_unavailable'].includes(String(quote.state))||quote.mode!=='h3_zone_max')throw new TrackingError(502,'taxi_h3_contract','No se pudo validar la tarifa H3.');
        if(quote.state==='channel_unavailable')throw new TrackingError(503,'taxi_h3_channel_changed','El canal cambió mientras se consultaba la tarifa.');
        if(quote.state!=='priced')return null;
        if(quote.originCell!==scope.originCell||quote.destinationCell!==scope.destinationCell||typeof quote.cents!=='number'||!Number.isSafeInteger(quote.cents)||quote.cents<=0||quote.cents>10000000)throw new TrackingError(502,'taxi_h3_contract','La tarifa H3 no corresponde al recorrido.');
        return quote.cents;
      }
      if(c.pricingMode!=='road_distance')throw new TrackingError(503,'taxi_pricing_not_configured','La tarifa requiere configuración de la base.');
      if(c.baseCents===null||c.perKmCents===null||!config.mapsKey)return null;
      const params=new URLSearchParams({origin:`${origin.lat},${origin.lng}`,destination:`${destination.lat},${destination.lng}`,mode:'driving',key:config.mapsKey});
      const data=(await requestJson(fetcher,'https://maps.googleapis.com/maps/api/directions/json?'+params,{signal},8000,262144)).data;
      if(!record(data)||data.status!=='OK'||!Array.isArray(data.routes)||data.routes.length!==1||!record(data.routes[0])||!Array.isArray(data.routes[0].legs)||data.routes[0].legs.length!==1||!record(data.routes[0].legs[0])||!record(data.routes[0].legs[0].distance))return null;
      const meters=data.routes[0].legs[0].distance.value;if(typeof meters!=='number'||!Number.isFinite(meters)||meters<=0||meters>500000)return null;
      return Math.round(c.baseCents+c.perKmCents*meters/1000);
    },
    candidates:async(origin,c,signal)=>{
      const rows=await store.read('conductores',new URLSearchParams({select:'device_id,nombre,telefono_whatsapp',tenant_id:'eq.'+c.tenantId,activo:'eq.true',limit:'501'}));
      if(rows.length>500)throw new TrackingError(413,'taxi_fleet_limit','La flota supera el límite del selector actual.');
      const allowed=new Set<number>();for(const r of rows){if(!record(r)||!positiveId(r.device_id))throw new TrackingError(502,'taxi_bad_driver','La base tiene una unidad no válida.');allowed.add(r.device_id);}
      if(!allowed.size)return [];
      const fleet=new FleetApi(config.traccarUrl,fetcher),session=await fleet.jobSession(config.traccarEmail,config.traccarPassword,signal);
      const devices:TraccarDevice[]=session.devices.filter((d)=>allowed.has(d.id)&&d.status==='online').map((d)=>({...d,uniqueId:String(d.id)}));
      const raw=await fleet.get('/positions',session.cookie,signal);
      if(!Array.isArray(raw)||raw.length>10000)throw new TrackingError(502,'taxi_bad_positions','No se pudo validar la flota.');
      const positions:TraccarPosition[]=[];
      for(const p of raw){if(!record(p)||!positiveId(p.id)||!positiveId(p.deviceId)||!allowed.has(p.deviceId)||!coord(p.latitude,p.longitude)||typeof p.longitude!=='number'||typeof p.fixTime!=='string')continue;
        if(p.valid!==true||p.outdated===true)continue;
        const ignition=record(p.attributes)?flag(p.attributes.ignition):null,occupied=record(p.attributes)?flag(p.attributes.occupied):null;
        positions.push({id:p.id,deviceId:p.deviceId,latitude:p.latitude,longitude:p.longitude,fixTime:p.fixTime,valid:true,speed:typeof p.speed==='number'&&Number.isFinite(p.speed)?p.speed:undefined,course:typeof p.course==='number'&&Number.isFinite(p.course)?p.course:undefined,attributes:{ignition,occupied}});
      }
      const ranked=findOptimalTaxi(devices,positions,origin.lat,origin.lng,Math.min(10,c.radiusKm));
      return ranked.success?ranked.data.map((d)=>({deviceId:d.deviceId,name:d.name})):[];
    }
  };
}
