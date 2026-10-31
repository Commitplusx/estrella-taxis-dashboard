import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import {Maximize2} from 'lucide-react';
import {openStreetMapLayer} from '../lib/openStreetMap';
import type {SimulationPoint,TaxiSimulationUnit} from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/simulationContracts.ts';
import 'leaflet/dist/leaflet.css';
export type SimulationMapTool='origin'|'destination'|'taxi';
interface Props {center:SimulationPoint;origin:SimulationPoint|null;destination:SimulationPoint|null;units:TaxiSimulationUnit[];selected:number|null;tool:SimulationMapTool;disabled:boolean;pending:boolean;onPoint:(p:SimulationPoint)=>void;onSelect:(id:number)=>void}
export default function TaxiSimulationMap(props:Props){
 const host=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),current=useRef(props),fitted=useRef(false),[tileError,setTileError]=useState(false);current.current=props;
 useEffect(()=>{
  if(!host.current)return;const m=L.map(host.current,{center:[props.center.lat,props.center.lng],zoom:15,zoomControl:false,preferCanvas:true});map.current=m;
  openStreetMapLayer(setTileError).addTo(m);L.control.zoom({position:'bottomright'}).addTo(m);layer.current=L.layerGroup().addTo(m);
  m.on('click',(event:L.LeafletMouseEvent)=>{if(!current.current.disabled)current.current.onPoint({lat:Number(event.latlng.lat.toFixed(6)),lng:Number(event.latlng.lng.toFixed(6))});});
  const resize=new ResizeObserver(()=>m.invalidateSize({pan:false}));resize.observe(host.current);
  return()=>{resize.disconnect();m.remove();map.current=null;layer.current=null;fitted.current=false;};
 },[props.center.lat,props.center.lng]);
 useEffect(()=>{
  const target=layer.current;if(!target)return;target.clearLayers();
  const label=(text:string)=>{const span=document.createElement('span');span.textContent=text;return span;};
  for(const unit of props.units){
   if(!unit.point)continue;const selected=unit.deviceId===props.selected,offered=!props.pending&&unit.reason==='selected';
   const marker=L.circleMarker([unit.point.lat,unit.point.lng],{radius:selected?10:8,color:selected?'#172337':offered?'#1d4ed8':'#536176',weight:selected?3:2,fillColor:offered?'#1d4ed8':unit.availability==='occupied'?'#b45309':unit.availability==='free'?'#fff':'#94a3b8',fillOpacity:1,bubblingMouseEvents:false});
   marker.bindTooltip(label(unit.name+(unit.changed?' · Simulada':'')),{direction:'top'});marker.on('click',()=>current.current.onSelect(unit.deviceId));marker.addTo(target);
   if(offered&&props.origin)L.polyline([[unit.point.lat,unit.point.lng],[props.origin.lat,props.origin.lng]],{color:'#1d4ed8',weight:2,dashArray:'5 7',opacity:.6,interactive:false}).addTo(target);
  }
  for(const [point,text,color]of [[props.origin,'Origen','#1d4ed8'],[props.destination,'Destino','#a42620']] as const){if(!point)continue;L.circleMarker([point.lat,point.lng],{radius:11,color:'#fff',weight:3,fillColor:color,fillOpacity:1,bubblingMouseEvents:false}).bindTooltip(label(text),{permanent:true,direction:'top',className:'taxi-sim-map-label'}).addTo(target);}
 },[props.units,props.selected,props.origin,props.destination,props.pending]);
 const fit=()=>{const points=props.units.flatMap(u=>u.point?[[u.point.lat,u.point.lng] as L.LatLngTuple]:[]);for(const p of[props.origin,props.destination])if(p)points.push([p.lat,p.lng]);if(points.length)map.current?.fitBounds(L.latLngBounds(points),{paddingTopLeft:[45,90],paddingBottomRight:[45,70],maxZoom:16});};
 useEffect(()=>{if(!fitted.current&&props.units.some(u=>u.point)){fit();fitted.current=true;}},[props.units]);
 return <div className={'taxi-sim-map-wrap mode-'+props.tool}>
  <div ref={host} className="taxi-sim-map" role="region" aria-label="Mapa de pruebas de asignación"/>
  <div className="taxi-sim-map-hint">{props.tool==='origin'?'Toca el punto donde pasaría el taxi por el cliente':props.tool==='destination'?'Toca el destino del viaje':'Toca la posición hipotética de la unidad seleccionada'}</div>
  <button type="button" className="taxi-secondary taxi-sim-fit" onClick={fit} aria-label="Ver todos los puntos de la simulación"><Maximize2 size={16} aria-hidden="true"/>Ver puntos</button>
  {tileError&&<p className="taxi-sim-map-error" role="status">No cargó el fondo del mapa. Puedes usar las coordenadas para continuar.</p>}
 </div>;
}
