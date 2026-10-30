import { fingerprint, TrackingError } from '../../tracking/contracts.ts';
import { requestJson, type Fetcher } from '../../tracking/http.ts';
import type { TrackingStore } from '../../tracking/store.ts';
import { coord, parsePlace, record, text, type TaxiChannel, type Place } from './contracts.ts';
import type { LocationResult } from './coordinator.ts';
import { normalize } from './policy.ts';
function cached(value:unknown):LocationResult{
 if(!record(value))throw new TrackingError(502,'invalid_geocode_cache','No se pudo validar la dirección guardada.');
 if(value.kind==='resolved'){const place=parsePlace(value.place);if(place)return{kind:'resolved',place};}
 if(value.kind==='ambiguous'&&Array.isArray(value.labels)&&value.labels.length<=5&&value.labels.every(label=>typeof label==='string'&&label.length<=400))return{kind:'ambiguous',labels:value.labels};
 if(value.kind==='unavailable')return{kind:'unavailable'};
 throw new TrackingError(502,'invalid_geocode_cache','No se pudo validar la dirección guardada.');
}
/** Accept a unique precise house/POI, never the first street or city centroid. */
export function parsePhotonAddress(data:unknown,address:string):LocationResult{
 if(!record(data)||data.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length>10)throw new TrackingError(502,'invalid_geocoder_response','El buscador no devolvió una dirección válida.');
 const places:Place[]=[],labels:string[]=[];
 for(const feature of data.features){
  if(!record(feature)||!record(feature.geometry)||feature.geometry.type!=='Point'||!Array.isArray(feature.geometry.coordinates)||feature.geometry.coordinates.length!==2||!coord(feature.geometry.coordinates[1],feature.geometry.coordinates[0])||!record(feature.properties))continue;
  const p=feature.properties,lat=feature.geometry.coordinates[1],lng=feature.geometry.coordinates[0];if(typeof lat!=='number'||typeof lng!=='number'||p.countrycode!=='MX'&&p.countrycode!=='mx')continue;
  const label=[text(p.name,150),text(p.street,150),text(p.housenumber,30),text(p.city,100)].filter(Boolean).join(', ').slice(0,400);if(label)labels.push(label);
  const house=text(p.housenumber,30),name=text(p.name,150),wantedNumber=/(?:\b(?:numero|num|no)\.?\s*|#\s*)(\d+[a-z]?)/.exec(normalize(address))?.[1]??/\s(\d+[a-z]?)\s*$/.exec(normalize(address))?.[1];
  const street=text(p.street,150),streetWords=street?normalize(street).split(/\W+/).filter(word=>word.length>2&&!['calle','avenida','del','las','los'].includes(word)):[];
  const preciseHouse=Boolean(house&&wantedNumber&&normalize(house)===wantedNumber&&streetWords.length&&streetWords.every(word=>normalize(address).includes(word)));
  const namedPoi=Boolean(name&&['amenity','shop','tourism','office','leisure'].includes(String(p.osm_key))&&normalize(address).includes(normalize(name))&&!wantedNumber);
  if(!preciseHouse&&!namedPoi)continue;
  places.push({text:address,lat,lng,placeId:typeof p.osm_id==='number'&&Number.isSafeInteger(p.osm_id)?'osm:'+String(p.osm_type)+':'+p.osm_id:null});
 }
 const unique=places.filter((place,index,all)=>all.findIndex(other=>other.lat===place.lat&&other.lng===place.lng)===index);
 if(unique.length===1&&labels.length===places.length)return{kind:'resolved',place:unique[0]};
 return labels.length?{kind:'ambiguous',labels:[...new Set(labels)].slice(0,5)}:{kind:'unavailable'};
}
export async function resolveOsmAddress(address:string,channel:TaxiChannel,store:TrackingStore,fetcher:Fetcher,baseUrl:string,signal?:AbortSignal):Promise<LocationResult>{
 const url=new URL(baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new TrackingError(503,'invalid_geocoder_config','El buscador de direcciones requiere una URL HTTPS válida.');
 const key=await fingerprint({version:'photon-address-v1',provider:baseUrl,tenant:channel.tenantId,address:normalize(address),city:normalize(channel.city),center:[channel.centerLat,channel.centerLng],radius:channel.radiusKm});
 const claim=await store.rpc('taxi_bot_address_lookup',{p_tenant:channel.tenantId,p_key:key,p_lease:null,p_result:null});
 if(!record(claim))throw new TrackingError(502,'invalid_geocode_claim','No se confirmó la búsqueda de dirección.');
 if(claim.state==='cached')return cached(claim.result);
 if(claim.state==='limited'||claim.state==='busy')return{kind:'unavailable'};
 if(claim.state!=='fetch'||typeof claim.lease!=='string')throw new TrackingError(502,'invalid_geocode_claim','No se confirmó la búsqueda de dirección.');
 let result:LocationResult={kind:'unavailable'};
 try{
  const dy=channel.radiusKm/110.5,dx=dy/Math.max(0.01,Math.cos(channel.centerLat*Math.PI/180));
  const bbox=[Math.max(-180,channel.centerLng-dx),Math.max(-90,channel.centerLat-dy),Math.min(180,channel.centerLng+dx),Math.min(90,channel.centerLat+dy)].join(',');
  url.search=new URLSearchParams({q:address+', '+channel.city,lat:String(channel.centerLat),lon:String(channel.centerLng),bbox,countrycode:'MX',limit:'5'}).toString();
  const response=await requestJson(fetcher,url.toString(),{signal,headers:{'User-Agent':'StellarTracking-Pompeyo/1.0 (+https://stellar.estrella-eats.mx)'}},8000,131072);
  result=parsePhotonAddress(response.data,address);
 }catch{console.warn(JSON.stringify({event:'taxi_address_lookup_unavailable',tenant:channel.tenantId}));}
 const saved=await store.rpc('taxi_bot_address_lookup',{p_tenant:channel.tenantId,p_key:key,p_lease:claim.lease,p_result:result});
 if(!record(saved)||saved.state!=='saved')throw new TrackingError(503,'geocode_result_uncertain','No se pudo conservar la búsqueda de dirección.');
 return result;
}
