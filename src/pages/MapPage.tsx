import React, { useEffect, useRef, useState, useCallback } from 'react';

import { Layers, Crosshair, Zap, Power, Radio, ShieldAlert, Bell, Battery, Activity, MapPin, X, Wifi, WifiOff, Play, Square, Terminal, CheckCircle2, Key, Plus, Minus, Ruler, Loader2, Brain, Search } from 'lucide-react';
import { toast } from 'react-hot-toast';
import L from 'leaflet';
import { openStreetMapLayer } from '../lib/openStreetMap';
import { fleetMarkerHtml, validFleetPoint, type FleetMapPoint } from '../lib/fleetMapPresentation';
import { fleetMapQuote } from '../lib/fleetMapQuote';
import { taxiAdminClient } from '../lib/taxiAdminClient';
import 'leaflet/dist/leaflet.css';
import './fleetMap.css';
import { api, type TraccarDevice, type TraccarPosition } from '../lib/traccarApi';


import { useTraccarSocket } from '../hooks/useTraccarSocket';
import { RequireFeature } from '../components/RequireFeature';
import { CommandModal } from '../components/CommandModal';
import { useAuth } from '../context/AuthContext';

import FleetSimulationPanel from '../components/FleetSimulationPanel';
import type {SimulationMapTool} from '../components/TaxiSimulationMap';
import type {TaxiSimulationResult} from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/simulationContracts.ts';
import{gpsOccupancy}from'../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/gpsOccupancy.ts';
import { loadFleetActivity } from '../lib/fleetActivity';
import { distanceKm } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/scoring.ts';
import { positiveId } from '../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts';
import { escapeHtml } from '../lib/escapeHtml';

interface MapTelemetryEvent {id:number;deviceId:number;type:string;eventTime?:string;serverTime?:string;attributes?:{alarm?:string;result?:string}}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function knotsToKmh(knots: number) {
  return (knots * 1.852).toFixed(0);
}

function getBatteryColor(level: number | undefined) {
  if (level===undefined || !Number.isFinite(level)) return '#94a3b8';
  if (level > 50) return '#16a34a';
  if (level > 20) return '#f59e0b';
  return '#dc2626';
}

function getStatusColor(device: TraccarDevice) {
  if (device.status === 'online') return '#16a34a';
  if (device.status === 'offline') return '#94a3b8';
  return '#f59e0b';
}

function formatRelativeTime(dateStr: string, nowMs: number = Date.now()) {
  const d = new Date(dateStr);
  const diffMs = nowMs - d.getTime();
  const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
  const diffMins = Math.floor(diffSecs / 60);

  if (diffSecs < 10) return 'Hace un momento';
  if (diffSecs < 60) return `Hace ${diffSecs} segs`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Hace ${diffMins} min`;
  return `Hace ${Math.floor(diffHours / 24)} días`;
}

export function generateInfoWindowContent(device: TraccarDevice, pos: TraccarPosition, isReadonly: boolean = false, isFollowing: boolean = false, liveAddress: string = '', nowMs: number = Date.now()) {
  const rawBattery=pos.attributes?.batteryLevel;
  const battery=typeof rawBattery==='number' && Number.isFinite(rawBattery) && rawBattery>=0 && rawBattery<=100?rawBattery:undefined;
  const deviceId=positiveId(device.id)?device.id:0;
  const ignition = pos.attributes?.ignition;
  const speed = knotsToKmh(pos.speed || 0);
  const isMoving = Number(speed) > 2;

  let engineStatusHtml = '';
  if (ignition === true) {
    engineStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#166534; background:#dcfce7; border:1px solid #bbf7d0; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#22c55e;border-radius:50%;box-shadow:0 0 4px #22c55e"></span> MOTOR ENCENDIDO</div>`;
  } else if (ignition === false) {
    engineStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#991b1b; background:#fee2e2; border:1px solid #fecaca; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#ef4444;border-radius:50%;box-shadow:0 0 4px #ef4444"></span> MOTOR APAGADO</div>`;
  } else if (isMoving) {
    engineStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#166534; background:#dcfce7; border:1px solid #bbf7d0; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#22c55e;border-radius:50%;box-shadow:0 0 4px #22c55e"></span> MOTOR EN MOVIMIENTO</div>`;
  }

  const finalAddress = escapeHtml(liveAddress || (pos.address ? pos.address.split(',')[0] : ''));
  const timeText = formatRelativeTime(pos.serverTime, nowMs);
  const occupation = gpsOccupancy(pos.attributes);

  let occupiedStatusHtml = '';
  if (occupation===true) {
    occupiedStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#991b1b; background:#fee2e2; border:1px solid #fecaca; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#ef4444;border-radius:50%;box-shadow:0 0 4px #ef4444"></span> GPS MARCA OCUPADO</div>`;
  } else if(occupation===false) {
    occupiedStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#166534; background:#dcfce7; border:1px solid #bbf7d0; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#22c55e;border-radius:50%;box-shadow:0 0 4px #22c55e"></span> GPS MARCA LIBRE</div>`;
  } else {
    occupiedStatusHtml='<div style="margin-top:8px;color:#475569;font-size:12px;text-align:center">Ocupación sin dato</div>';
  }

  return `
    <div style="font-family:Inter,sans-serif;min-width:220px;padding:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <strong style="font-size:15px;color:#0f172a">${escapeHtml(device.name)}</strong>
        <span style="width:8px;height:8px;border-radius:50%;background:${getStatusColor(device)};display:inline-block;box-shadow:0 0 4px ${getStatusColor(device)}"></span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:#f8fafc;border-radius:8px;padding:8px;text-align:center;border:1px solid #f1f5f9">
          <div style="font-size:20px;font-weight:800;color:#1d4ed8">${speed}</div>
          <div style="font-size:10px;color:#64748b;font-weight:600;letter-spacing:0.5px">KM/H</div>
        </div>
        <div style="background:#f8fafc;border-radius:8px;padding:8px;text-align:center;border:1px solid #f1f5f9">
          <div style="font-size:20px;font-weight:800;color:${getBatteryColor(battery)}">${battery ?? '--'}${battery != null ? '%' : ''}</div>
          <div style="font-size:10px;color:#64748b;font-weight:600;letter-spacing:0.5px">BATERÍA</div>
        </div>
      </div>

      ${engineStatusHtml}
      ${occupiedStatusHtml}

      ${finalAddress ? `<div style="margin-top:10px;font-size:11px;color:#64748b;line-height:1.4"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;"><strong style="color:#475569">📍 Dirección:</strong> ${device.status === 'online' ? `<span style="display:flex;align-items:center;color:#059669;font-weight:700;font-size:9px;background:#ecfdf5;padding:2px 6px;border-radius:4px;border:1px solid #a7f3d0;">${isMoving ? '<svg class="animate-spin" style="width:10px;height:10px;margin-right:4px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>' : '<span style="width:6px;height:6px;background:#10b981;border-radius:50%;margin-right:4px;"></span>'} EN VIVO</span>` : ''}</div>${finalAddress}</div>` : ''}

      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between;">
        <span>Última señal:</span>
        <strong style="color:#475569">${timeText}</strong>
      </div>

      <div style="display:flex;gap:6px;margin-top:12px">
        ${!isReadonly && deviceId ? `
        <button onclick="window.dispatchEvent(new CustomEvent('openMapCommands', {detail: ${deviceId}}))" style="flex:1; background:#fee2e2; color:#b91c1c; border:none; padding:8px 0; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center;">
          ⚡ Comandos
        </button>
        ` : ''}
        <button onclick="window.dispatchEvent(new CustomEvent('followDevice', {detail: ${deviceId}}))" style="flex:1; background:${isFollowing ? '#fee2e2' : '#e0e7ff'}; color:${isFollowing ? '#b91c1c' : '#4338ca'}; border:none; padding:8px 0; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center;">
          ${isFollowing ? '✋ Dejar de seguir' : '📍 Seguir Taxi'}
        </button>
      </div>
    </div>
  `;
}

export default function MapPage() {
  const { user, empresaId, userRole } = useAuth();
  const canSimulate=(userRole==='superadmin'||userRole==='admin_empresa')&&!user?.readonly;
  const companyRef = useRef(empresaId);

  const isReadonly = user?.readonly ?? false;


  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const infoWindowRef = useRef<L.Popup | null>(null);
  const initialZoomDone = useRef(false);

  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [positions, setPositions] = useState<Map<number, TraccarPosition>>(new Map());
  // Ref en espejo del state, para leer datos frescos dentro de callbacks imperativos sin stale closure
  const positionsRef = useRef<Map<number, TraccarPosition>>(new Map());
  const devicesRef = useRef<TraccarDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<TraccarDevice | null>(null);
  const [liveAddress, setLiveAddress] = useState<string>('');

  const [commandDevice, setCommandDevice] = useState<TraccarDevice | null>(null);
  const [followingDeviceId, setFollowingDeviceId] = useState<number | null>(null);
  const followingDeviceIdRef = useRef<number | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [showMobileEvents, setShowMobileEvents] = useState(false);
  const [showEventsPanel, setShowEventsPanel] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [tileError, setTileError] = useState(false);
  const [mutedMap, setMutedMap] = useState(true);
  const alertTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Heatmap
  const [showHeatmap, setShowHeatmap] = useState(false);
  const activityCircles=useRef<L.Circle[]>([]);

  // Escuchar el evento de renderizado forzado (ej: cuando un canvas termina de tintar el taxi PNG)
  useEffect(() => {
    const handleForceRender = () => setNowTick(Date.now());
    window.addEventListener('forceMapRender', handleForceRender);
    return () => window.removeEventListener('forceMapRender', handleForceRender);
  }, []);

  // Measurement Tool
  const [isMeasuring, setIsMeasuring] = useState(false);
  const isMeasuringRef = useRef(false);
  useEffect(() => { isMeasuringRef.current = isMeasuring; }, [isMeasuring]);

  const measurePathRef = useRef<FleetMapPoint[]>([]);
  const measureLayerRef = useRef<L.LayerGroup | null>(null);
  const measureLabelRef = useRef<L.Popup | null>(null);
  const measureGeneration = useRef(0);

  useEffect(() => {
    companyRef.current = empresaId;
    measureGeneration.current++;
    measurePathRef.current = [];
    measureLayerRef.current?.clearLayers();
    measureLabelRef.current?.remove();
  }, [empresaId]);

  // ─── Simulador de Asignación IA ───
  const [isSimulatorActive, setIsSimulatorActive] = useState(false);
  const isSimulatorActiveRef = useRef(false);
  useEffect(() => { isSimulatorActiveRef.current = isSimulatorActive; }, [isSimulatorActive]);

  const [simulationPoint,setSimulationPoint]=useState<FleetMapPoint|null>(null);
  const simulationTool=useRef<SimulationMapTool>('origin');
  const simElementsRef = useRef<L.LayerGroup | null>(null);
  const clearSimElements = useCallback(() => { simElementsRef.current?.clearLayers(); }, []);
  const runAiSimulator=useCallback((point:FleetMapPoint)=>{setSimulationPoint(point);const group=simElementsRef.current;if(group)L.circleMarker(point,{radius:9,color:'#fff',weight:3,fillColor:simulationTool.current==='destination'?'#a42620':'#1d4ed8',fillOpacity:1}).bindTooltip(simulationTool.current==='destination'?'Destino de prueba':simulationTool.current==='taxi'?'Posición simulada':'Origen de prueba').addTo(group);},[]);
  const simulationResult=useCallback((result:TaxiSimulationResult|null)=>{
    clearSimElements();const group=simElementsRef.current;if(!group||!result)return;
    L.circleMarker(result.origin,{radius:9,color:'#fff',weight:3,fillColor:'#1d4ed8',fillOpacity:1}).bindTooltip('Origen',{permanent:true}).addTo(group);
    if(result.destination)L.circleMarker(result.destination,{radius:9,color:'#fff',weight:3,fillColor:'#a42620',fillOpacity:1}).bindTooltip('Destino',{permanent:true}).addTo(group);
    for(const unit of result.scenario.units){if(!unit.point)continue;
      const label=document.createElement('span');label.textContent=unit.name+(unit.changed?' · Simulada':'');
      if(unit.changed)L.circleMarker(unit.point,{radius:10,color:'#172337',weight:3,fillColor:'#dbeafe',fillOpacity:1}).bindTooltip(label).addTo(group);
      if(unit.reason==='selected')L.polyline([[unit.point.lat,unit.point.lng],[result.origin.lat,result.origin.lng]],{color:'#2563eb',weight:3,opacity:.8,dashArray:'6 6',interactive:false,className:'fleet-sim-offer-line'}).addTo(group);
    }
  },[clearSimElements]);
  const simulationToolChanged=useCallback((tool:SimulationMapTool)=>{simulationTool.current=tool;},[]);
  useEffect(()=>{if(!canSimulate){setIsSimulatorActive(false);setSimulationPoint(null);clearSimElements();}},[canSimulate,empresaId,clearSimElements]);
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !mapsLoaded) return;
    const click = (event: L.LeafletMouseEvent) => {
      if (isSimulatorActiveRef.current) runAiSimulator({ lat: event.latlng.lat, lng: event.latlng.lng });
    };
    if (isSimulatorActive) {
      setIsMeasuring(false);
      isMeasuringRef.current = false;
      measureGeneration.current++;
      measurePathRef.current = [];
      measureLayerRef.current?.clearLayers();
      measureLabelRef.current?.remove();
      setShowEventsPanel(false);setSelectedDevice(null);infoWindowRef.current?.remove();toast('Marca el origen en el mapa y pulsa Simular viaje.', { id: 'sim-instruct', duration: 4000 });
      map.on('click', click);
    } else {
      clearSimElements();
      setSimulationPoint(null);
      toast.dismiss('sim-instruct');
    }
    return () => { map.off('click', click); };
  }, [isSimulatorActive, mapsLoaded, runAiSimulator, clearSimElements]);

  // Events Drawer
  const [realtimeEvents, setRealtimeEvents] = useState<MapTelemetryEvent[]>([]);
  const [toastEvent, setToastEvent] = useState<{ id: string, title: string, message: string } | null>(null);

  // Sincronizar state con ref para usarlo dentro del websocket callback
  useEffect(() => {
    followingDeviceIdRef.current = followingDeviceId;
  }, [followingDeviceId]);

  // Escuchar eventos globales desde los botones del InfoWindow HTML
  useEffect(() => {
    const handleOpenCommands = (event: Event) => {
      if(!(event instanceof CustomEvent) || !positiveId(event.detail))return;
      const dev = devices.find(d => d.id === event.detail);
      if (dev) setCommandDevice(dev);
    };
    const handleFollowDevice = (event: Event) => {
      if(!(event instanceof CustomEvent) || !positiveId(event.detail))return;
      const id=event.detail;
      if (followingDeviceIdRef.current === id) {
        setFollowingDeviceId(null);
      } else {
        setFollowingDeviceId(id);
        const pos = positionsRef.current.get(id);
        if (pos && validFleetPoint(pos.latitude, pos.longitude) && leafletMapRef.current) {
          const map = leafletMapRef.current;
          map.panTo({ lat: pos.latitude, lng: pos.longitude });
          map.setZoom(17);
        }
      }
      // Cerrar la ventana de info para dejar la vista limpia
      infoWindowRef.current?.remove();
      setSelectedDevice(null);
    };
    window.addEventListener('openMapCommands', handleOpenCommands);
    window.addEventListener('followDevice', handleFollowDevice);
    return () => {
      window.removeEventListener('openMapCommands', handleOpenCommands);
      window.removeEventListener('followDevice', handleFollowDevice);
    };
  }, [devices]);

  // Historical activity is sampled per unit/time bucket, then clustered. It does not predict passenger demand.
  useEffect(()=>{
    activityCircles.current.forEach((circle)=>circle.remove());activityCircles.current=[];
    if (!showHeatmap || !mapsLoaded || !leafletMapRef.current) return;
    const controller=new AbortController();
    const now=new Date(),from=new Date(now.getTime()-7*86400000);
    const task='fleet-activity';
    toast.loading('Revisando actividad registrada de los últimos siete días…',{id:task});
    loadFleetActivity(devicesRef.current.map((device)=>device.id),from.toISOString(),now.toISOString(),
      (id)=>api.getRoute({deviceIds:[id],from:from.toISOString(),to:now.toISOString()},controller.signal)).then((activity)=>{
      if (controller.signal.aborted || !leafletMapRef.current) return;
      if (!activity.clusters.length) {toast('No hay recorridos suficientes para mostrar zonas de actividad.',{id:task});return;}
      for(const cluster of activity.clusters) {
        const spread=cluster.points.map((point)=>distanceKm(cluster.centroid,point)*1000).sort((a,b)=>a-b);
        const radius=Math.min(1200,Math.max(80,spread[Math.floor(spread.length*.8)] ?? 80));
        const circle=L.circle(cluster.centroid,{radius,color:'#b45309',weight:1,opacity:.6,fillColor:'#f59e0b',fillOpacity:.12+.2*cluster.weight/activity.sampledPoints,interactive:false}).addTo(leafletMapRef.current);
        activityCircles.current.push(circle);
      }
      toast.success(activity.sampledPoints.toLocaleString('es-MX')+' observaciones de actividad'+(activity.missingUnits?' · '+activity.missingUnits+' unidades sin ruta':''),{id:task});
    }).catch((error:unknown)=>{if(!controller.signal.aborted)toast.error(error instanceof Error?error.message:'No pudimos cargar la actividad histórica.',{id:task});});
    return ()=>{controller.abort();toast.dismiss(task);activityCircles.current.forEach((circle)=>circle.remove());activityCircles.current=[];};
  },[showHeatmap,mapsLoaded]);

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = L.map(mapRef.current, { center: [16.2355, -92.1267], zoom: 13, zoomControl: false, attributionControl: false, preferCanvas: true });
    L.control.attribution({ position: 'bottomleft' }).addTo(map);
    leafletMapRef.current = map;
    initialZoomDone.current = false;
    openStreetMapLayer(setTileError).addTo(map);
    infoWindowRef.current = L.popup({ maxWidth: 330, autoPanPadding: [30, 40] });
    map.on('popupclose', (event: L.PopupEvent) => {
      if (event.popup === infoWindowRef.current) setSelectedDevice(null);
    });
    simElementsRef.current = L.layerGroup().addTo(map);
    measureLayerRef.current = L.layerGroup().addTo(map);
    const click = async (event: L.LeafletMouseEvent) => {
      if (isSimulatorActiveRef.current) return;
      if (!isMeasuringRef.current) {
        setSelectedDevice(null);
        infoWindowRef.current?.remove();
        return;
      }
      if (measurePathRef.current.length >= 2) {
        measureGeneration.current++;
        measurePathRef.current = [];
        measureLayerRef.current?.clearLayers();
        measureLabelRef.current?.remove();
      }
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      measurePathRef.current.push(point);
      if (measureLayerRef.current) L.circleMarker(point, { radius: 7, color: '#fff', fillColor: '#16a34a', fillOpacity: 1 }).addTo(measureLayerRef.current);
      if (measurePathRef.current.length !== 2) return;
      const [origin, destination] = measurePathRef.current;
      const generation = ++measureGeneration.current;
      const company = companyRef.current;
      if (measureLayerRef.current) L.polyline([origin, destination], { color: '#2563eb', weight: 3, dashArray: '6 6', interactive: false }).addTo(measureLayerRef.current);
      const label = L.popup({ autoClose: false, closeOnClick: false }).setLatLng(destination);
      measureLabelRef.current = label;
      const distance = distanceKm(origin, destination).toFixed(2) + ' km en línea recta';
      label.setContent('<div style="padding:4px;font:13px/1.5 sans-serif">' + distance + '<br>Consultando tarifa de la base…</div>').openOn(map);
      try {
        const result = await fleetMapQuote(taxiAdminClient, company, origin, destination);
        if (measureGeneration.current !== generation || !isMeasuringRef.current || companyRef.current !== company) return;
        label.setContent('<div style="padding:4px;max-width:250px;font:13px/1.5 sans-serif">' + distance + '<br>' + escapeHtml(result) + '</div>');
      } catch {
        if (measureGeneration.current === generation && isMeasuringRef.current && companyRef.current === company) label.setContent('<div style="padding:4px;max-width:250px;font:13px/1.5 sans-serif">' + distance + '<br>No pudimos consultar la tarifa. Intenta de nuevo.</div>');
      }
    };
    map.on('click', click);
    const zoom = () => mapRef.current?.classList.toggle('hide-marker-labels', map.getZoom() < 14);
    map.on('zoomend', zoom);
    zoom();
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resize.observe(mapRef.current);
    setMapsLoaded(true);
    return () => {
      measureGeneration.current++;
      resize.disconnect();
      for (const timer of alertTimers.current.values()) clearTimeout(timer);
      alertTimers.current.clear();
      map.off('click', click);
      map.remove();
      markersRef.current.clear();
      leafletMapRef.current = null;
      infoWindowRef.current = null;
      simElementsRef.current = null;
      measureLayerRef.current = null;
    };
  }, []);

  // Traer los taxis y sus posiciones desde el servidor
  const isFetchingRef = useRef(false);
  const loadFullState = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const [devs, pos] = await Promise.all([api.getDevices(), api.getPositions()]);
      devicesRef.current = devs;
      const posMap = new Map<number, TraccarPosition>();
      pos.forEach(p => posMap.set(p.deviceId, p));
      positionsRef.current = posMap;
      setDevices(devs);
      setPositions(posMap);
      setLoadError(null);

      // Precargar los últimos eventos (ej. últimas 12 horas) para que el panel no esté vacío
      if (devs.length > 0) {
        const d = new Date();
        const to = d.toISOString();
        d.setHours(d.getHours() - 12);
        const from = d.toISOString();
        const deviceIds = devs.slice(0, 40).map(d => d.id); // Límite de 40 para no saturar la URL
        api.getEvents({ from, to, deviceIds, type: 'allEvents' })
          .then(events => {
            // Ordenar del más reciente al más antiguo
            const sorted = events.sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime());
            setRealtimeEvents(sorted.slice(0, 5));
          })
          .catch(err => console.error('Error precargando eventos:', err));
      }
    } catch (error: unknown) {
      setLoadError(error instanceof Error?error.message:'Error al cargar los datos del mapa.');
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  // Cargar una vez al inicio por si el websocket tarda
  useEffect(() => {
    loadFullState();
  }, [loadFullState]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !mapsLoaded || initialZoomDone.current) return;
    const points = devices.flatMap((device): L.LatLngTuple[] => {
      const p = positions.get(device.id);
      return p && validFleetPoint(p.latitude, p.longitude) ? [[p.latitude, p.longitude]] : [];
    });
    if (points.length) { map.fitBounds(points, { padding: [40, 40], maxZoom: 14 }); initialZoomDone.current = true; }
  }, [devices, positions, mapsLoaded]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !mapsLoaded) return;
    const visibleIds = new Set(devices.filter((device) => {
      const p = positions.get(device.id);
      return p && validFleetPoint(p.latitude, p.longitude);
    }).map((device) => device.id));
    for (const [id, marker] of markersRef.current) {
      if (!visibleIds.has(id)) { marker.remove(); markersRef.current.delete(id); }
    }
    devices.forEach((device) => {
      const p = positions.get(device.id);
      if (!p || !validFleetPoint(p.latitude, p.longitude)) return;
      const icon = L.divIcon({ className: 'fleet-vehicle-marker', html: fleetMarkerHtml({ name: device.name, category: device.category, status: device.status, speed: p.speed || 0, course: p.course || 0, occupied: gpsOccupancy(p.attributes) }), iconSize: [36, 36], iconAnchor: [18, 18] });
      const existing = markersRef.current.get(device.id);
      if (existing) { existing.setLatLng([p.latitude, p.longitude]).setIcon(icon); return; }
      const marker = L.marker([p.latitude, p.longitude], { icon, title: device.name, keyboard: true }).addTo(map);
      marker.on('click', () => {
        const freshDevice = devicesRef.current.find((d) => d.id === device.id);
        const freshPos = positionsRef.current.get(device.id);
        if (!freshDevice || !freshPos) return;
        setSelectedDevice(freshDevice);
        if (window.innerWidth >= 640) {
          infoWindowRef.current?.setLatLng(marker.getLatLng()).setContent(generateInfoWindowContent(freshDevice, freshPos, isReadonly, followingDeviceIdRef.current === device.id)).openOn(map);
        } else infoWindowRef.current?.remove();
      });
      markersRef.current.set(device.id, marker);
    });
  }, [devices, positions, mapsLoaded, isReadonly]);

  // Derived state: siempre usar la versión más fresca del dispositivo para evitar closures viejos
  const currentSelectedDevice = selectedDevice
    ? (devices.find(d => d.id === selectedDevice.id) || selectedDevice)
    : null;

  useEffect(() => {
    const position = currentSelectedDevice ? positions.get(currentSelectedDevice.id) : null;
    // Traccar already supplies addresses. Do not reverse-geocode every GPS tick against a public service.
    setLiveAddress(position?.address ?? '');
  }, [currentSelectedDevice, positions]);

  // Actualizar z-index y ventana de info en tiempo real si el coche se mueve o cambia la selección
  useEffect(() => {
    // 1. Actualizar zIndex de los marcadores para que el seleccionado quede arriba
    devices.forEach(d => {
      const marker = markersRef.current.get(d.id);
      if (marker) {
        const isSelected = currentSelectedDevice?.id === d.id;
        const pos = positions.get(d.id);
        const zIndex = isSelected ? 1000 : (d.status === 'online' ? (pos?.speed && pos.speed > 0 ? 500 : 400) : 300);
        marker.setZIndexOffset(zIndex);
      }
    });

    // 2. Actualizar InfoWindow
    if (!currentSelectedDevice || !infoWindowRef.current) return;
    const pos = positions.get(currentSelectedDevice.id);
    if (pos && window.innerWidth >= 640) {
      infoWindowRef.current.setLatLng([pos.latitude, pos.longitude]).setContent(generateInfoWindowContent(currentSelectedDevice, pos, isReadonly, followingDeviceId === currentSelectedDevice.id, liveAddress));
    }
  }, [positions, currentSelectedDevice, isReadonly, devices, nowTick, followingDeviceId, liveAddress]);

  const smoothCameraReset = useCallback(() => {
    const map = leafletMapRef.current;
    if (map) map.flyTo(map.getCenter(), 13, { duration: .45 });
  }, []);

  // Alternar el panel móvil desde el Layout
  useEffect(() => {
    const handleToggle = () => setShowMobileEvents(prev => !prev);
    window.addEventListener('toggleMobileEvents', handleToggle);
    return () => window.removeEventListener('toggleMobileEvents', handleToggle);
  }, []);

  // Sincronizar el badge rojo global (de Layout) con los eventos del mapa
  useEffect(() => {
    const badge = document.getElementById('global-bell-badge');
    if (badge) {
      if (realtimeEvents.length > 0 && !showMobileEvents) {
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }, [realtimeEvents.length, showMobileEvents]);

  // Manejar visibilidad del BottomNav en móviles cuando se abre/cierra una tarjeta
  useEffect(() => {
    if (currentSelectedDevice && window.innerWidth < 640) {
      window.dispatchEvent(new CustomEvent('hideBottomNav'));
    } else {
      window.dispatchEvent(new CustomEvent('showBottomNav'));
    }
    return () => {
      window.dispatchEvent(new CustomEvent('showBottomNav'));
    };
  }, [currentSelectedDevice]);

  // Move live markers without recreating the map or waiting for a full data reload.
  const updateMarkerImperative = useCallback((device: TraccarDevice, pos: TraccarPosition) => {
    if (!validFleetPoint(pos.latitude, pos.longitude)) { markersRef.current.get(device.id)?.remove(); markersRef.current.delete(device.id); return; }
    const marker = markersRef.current.get(device.id);
    if (!marker) return;
    marker.setLatLng([pos.latitude, pos.longitude]);
    marker.setIcon(L.divIcon({ className: 'fleet-vehicle-marker', html: fleetMarkerHtml({ name: device.name, category: device.category, status: device.status, speed: pos.speed || 0, course: pos.course || 0, occupied: gpsOccupancy(pos.attributes) }), iconSize: [36, 36], iconAnchor: [18, 18] }));
  }, []);

  const handleWsDevices = useCallback((updated: TraccarDevice[]) => {
    setDevices(prev => {
      const map = new Map(prev.map(d => [d.id, d]));
      updated.forEach(d => map.set(d.id, d));
      const next = Array.from(map.values());
      devicesRef.current = next;
      // Actualizar color de marcadores inmediatamente (estado online/offline cambia color)
      updated.forEach(d => {
        const pos = positionsRef.current.get(d.id);
        if (pos) updateMarkerImperative(d, pos);
      });
      return next;
    });
  }, [updateMarkerImperative]);

  const handleWsPositions = useCallback((updated: TraccarPosition[]) => {
    setPositions(prev => {
      const next = new Map(prev);
      updated.forEach(p => {
        next.set(p.deviceId, p);
        positionsRef.current.set(p.deviceId, p);
        // Mover el marcador de Leaflet INMEDIATAMENTE, sin esperar a React
        const device = devicesRef.current.find(d => d.id === p.deviceId);
        if (device) updateMarkerImperative(device, p);

        // Seguir al taxi si está en modo follow
        if (followingDeviceIdRef.current === p.deviceId && leafletMapRef.current && validFleetPoint(p.latitude, p.longitude)) {
          // Usamos panTo en lugar de moveCamera durante la actualización en tiempo real.
          // Esto mantiene centrado el taxi y conserva el zoom del usuario.
          leafletMapRef.current.panTo({ lat: p.latitude, lng: p.longitude });
        }
      });
      return next;
    });
  }, [updateMarkerImperative]);

  const handleWsEvents = useCallback((newEvents: MapTelemetryEvent[]) => {
    setRealtimeEvents(prev => {
      const next = [...newEvents, ...prev];
      return next.slice(0, 50); // Keep last 50 events
    });

    // Si hay eventos de encendido/apagado, parchar la posición en memoria para que la UI se actualice instantáneamente

    newEvents.forEach(ev => {
      if (ev.type === 'ignitionOn' || ev.type === 'ignitionOff') {
        setPositions(prev => {
          const pos = prev.get(ev.deviceId);
          if (pos) {
            const updatedPos = { ...pos, attributes: { ...pos.attributes, ignition: ev.type === 'ignitionOn' } };
            const nextMap = new Map(prev);
            nextMap.set(ev.deviceId, updatedPos);
            positionsRef.current.set(ev.deviceId, updatedPos);
            // Actualizar Marcador Imperativamente aquí para mantener sincronía 100% sin React
            const device = devicesRef.current.find(d => d.id === ev.deviceId);
            if (device) updateMarkerImperative(device, updatedPos);
            return nextMap;
          }
          return prev;
        });
      }
      // Aplicar animación BOUNCE en alertas importantes
      if (['alarm', 'geofenceEnter', 'geofenceExit', 'deviceOffline', 'ignitionOn', 'deviceMoving'].includes(ev.type)) {
        const marker = markersRef.current.get(ev.deviceId);
        if (marker) {
          const element = marker.getElement();
          element?.classList.add('is-alert');
          clearTimeout(alertTimers.current.get(ev.deviceId));
          alertTimers.current.set(ev.deviceId, setTimeout(() => { element?.classList.remove('is-alert'); alertTimers.current.delete(ev.deviceId); }, 3000));
        }
      }
    });

    // Disparar una notificación visual (Toast) si hay un evento importante
    if (newEvents.length > 0) {
      const ev = newEvents[0];
      const device = devices.find(d => d.id === ev.deviceId);
      const taxiName = device?.name || `Taxi #${ev.deviceId}`;

      let title = 'Evento';
      let message = '';

      if (ev.type === 'deviceStopped') {
        title = 'Vehículo Detenido';
        message = `${taxiName} se ha detenido.`;
      } else if (ev.type === 'deviceMoving') {
        title = 'En Movimiento';
        message = `${taxiName} empezó a moverse.`;
      } else if (ev.type === 'ignitionOn') {
        title = 'Motor Encendido';
        message = `Se encendió el motor de ${taxiName}.`;
      } else if (ev.type === 'ignitionOff') {
        title = 'Motor Apagado';
        message = `Se apagó el motor de ${taxiName}.`;
      } else if (ev.type === 'geofenceEnter') {
        title = 'Entrada a Zona';
        message = `${taxiName} entró a una geocerca.`;
      } else if (ev.type === 'geofenceExit') {
        title = 'Salida de Zona';
        message = `${taxiName} salió de una geocerca.`;
      } else if (ev.type === 'deviceOffline') {
        title = 'Señal Perdida';
        message = `${taxiName} se desconectó.`;
      } else if (ev.type === 'deviceOnline') {
        title = 'Señal Recuperada';
        message = `${taxiName} volvió a conectarse.`;
      } else if (ev.type === 'alarm') {
        title = '🚨 ALARMA';
        message = `${taxiName} reportó una alerta (${ev.attributes?.alarm || ''}).`;
      } else if (ev.type === 'commandResult') {
        title = '✅ Comando Ejecutado';
        message = `El taxi ${taxiName} confirmó el comando: ${ev.attributes?.result || 'Exitoso'}`;
      }

      if (message) {
        const id = Date.now().toString();
        toast.custom(() => (
          <div className="bg-gray-900/90 backdrop-blur-sm text-white px-4 py-3 rounded-2xl shadow-xl border border-gray-700/50 flex flex-col items-center min-w-[200px] pointer-events-auto">
            <span className="text-xs font-bold text-gray-400 mb-0.5">{title}</span>
            <span className="text-sm font-semibold">{message}</span>
          </div>
        ), { id, duration: 4000 });

        // Disparar Notificación Push NATIVA de HTML5 (si hay permisos)
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            // Tratar de evitar saturación de sonido si llegan muchas alarmas juntas
            new Notification(title, {
              body: message,
              icon: '/vite.svg', // Reemplazar en un futuro por logo de Estrella
              silent: false,
              tag: 'estrella-event' // Agrupa notificaciones
            });
          } catch (e) {
            console.error('Push Notification Error:', e);
          }
        }
      }
    }
  }, [devices]);

  useTraccarSocket({
    onDevices: handleWsDevices,
    onPositions: handleWsPositions,
    onEvents: handleWsEvents,
    onConnect: loadFullState
  });

  const handleZoomIn = () => {
    if (leafletMapRef.current) {
      leafletMapRef.current.setZoom((leafletMapRef.current.getZoom() || 13) + 1);
    }
  };

  const handleZoomOut = () => {
    if (leafletMapRef.current) {
      leafletMapRef.current.setZoom((leafletMapRef.current.getZoom() || 13) - 1);
    }
  };

  const handleFitBounds = () => {
    if (leafletMapRef.current && markersRef.current.size > 0) {
      const bounds = L.latLngBounds([]);
      markersRef.current.forEach(marker => {
        const pos = marker.getLatLng();
        if (pos) bounds.extend(pos);
      });
      leafletMapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    } else {
      if (toastEvent?.id) setToastEvent(null);
    }
  };

  const handleToggleMapType = () => setMutedMap((current) => !current);

  const clearMeasure = () => {
    measureGeneration.current++;
    measurePathRef.current = [];
    measureLayerRef.current?.clearLayers();
    measureLabelRef.current?.remove();
  };

  const handleToggleMeasure = () => {
    const newMeasuring = !isMeasuring;
    setIsMeasuring(newMeasuring);
    isMeasuringRef.current = newMeasuring;
    if (newMeasuring) { isSimulatorActiveRef.current = false; setIsSimulatorActive(false); clearSimElements(); setSimulationPoint(null); }
    if (!newMeasuring) {
      clearMeasure();
      if (leafletMapRef.current) leafletMapRef.current.getContainer().style.cursor = '';
    } else {
      if (leafletMapRef.current) leafletMapRef.current.getContainer().style.cursor = 'crosshair';
      toast('Marca dos puntos: verás la distancia en línea recta y la tarifa de la base si está disponible.');
    }
  };

  return (
    <div className="absolute inset-0 fade-in">
      {/* Contenedor Principal del Mapa (Pantalla Completa) */}
      <div className="w-full h-full bg-white relative">

        {/* Stats eliminadas para un diseño más limpio */}

        {loadError && (
          <div role="alert" className="absolute top-4 left-4 max-w-[70%] bg-white text-slate-800 rounded-xl shadow-md p-3 z-[20]">
            <p className="font-semibold text-sm">No pudimos actualizar los taxis.</p>
            <p className="text-xs mt-1">{loadError}</p>
            <button onClick={() => void loadFullState()} className="text-sm text-blue-700 underline underline-offset-4 mt-2">Reintentar</button>
          </div>
        )}
        {!mapsLoaded && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
              <p className="text-sm text-gray-500">Cargando mapa...</p>
            </div>
          </div>
        )}
        <div ref={mapRef} className={`fleet-osm-map w-full h-full hide-marker-labels ${mutedMap ? 'is-muted' : ''}`} role="region" aria-label="Mapa de seguimiento de taxis · OpenStreetMap" />
        {tileError && <p role="status" className="absolute bottom-7 left-3 z-[20] bg-white text-slate-800 text-xs rounded-lg px-3 py-2 max-w-[75%]">No cargó parte del mapa. Revisa la conexión; las posiciones GPS siguen disponibles.</p>}

        {/* Pill flotante para detener el modo seguimiento */}
        {followingDeviceId && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[20] flex items-center justify-center animate-fade-in pointer-events-none">
            <div className="bg-red-600 text-white rounded-full pl-4 pr-2 py-1.5 shadow-lg shadow-red-600/30 flex items-center gap-3 pointer-events-auto backdrop-blur-md bg-opacity-90 border border-red-500">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
              </span>
              <span className="text-sm font-bold tracking-wide">
                Siguiendo a {devices.find(d => d.id === followingDeviceId)?.name}
              </span>
              <button
                onClick={() => {
                  setFollowingDeviceId(null);
                  smoothCameraReset();
                }}
                className="ml-1 bg-white/20 hover:bg-white/30 rounded-full p-1.5 transition-colors"
                title="Dejar de seguir"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Panel lateral flotante de info del mapa */}
        {showEventsPanel && (
        <div className={`absolute top-2 sm:top-4 right-2 sm:right-4 left-2 sm:left-auto sm:w-72 bg-white/95 backdrop-blur-sm p-4 rounded-xl shadow-lg border border-gray-200 z-[10] max-h-[45%] sm:max-h-[80%] overflow-y-auto transition-all duration-300 ease-out ${showMobileEvents ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-4 pointer-events-none sm:opacity-100 sm:translate-y-0 sm:pointer-events-auto'}`}>
          <h3 className="font-bold text-gray-800 mb-3 text-sm flex justify-between items-center">
            <span className="flex items-center gap-2">Actividad Reciente <Radio size={16} className="text-primary animate-pulse" /></span>
            <button onClick={() => setShowEventsPanel(false)} className="text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-200 p-1 rounded-full transition-colors" title="Ocultar Notificaciones"><X size={14} /></button>
          </h3>
          <div className="space-y-3">
            {realtimeEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Activity size={24} className="text-gray-300 mb-2" />
                <p className="text-xs font-semibold text-gray-700">Esperando eventos en vivo</p>
                <p className="text-[10px] text-gray-500 mt-1 max-w-[200px]">
                  Aquí aparecerán automáticamente los encendidos, movimientos y alertas de los taxis activos.
                </p>
              </div>
            ) : (
              realtimeEvents.slice(0, 5).map((ev, i) => {
                const device = devices.find(d => d.id === ev.deviceId);


                let title = ev.type;
                let icon = <Zap size={12} />;
                let bgClass = 'bg-blue-50 text-blue-500';

                switch (ev.type) {
                  case 'deviceOnline': title = 'Señal recuperada'; icon = <Wifi size={12} />; bgClass = 'bg-green-50 text-green-600'; break;
                  case 'deviceOffline': title = 'Señal perdida'; icon = <WifiOff size={12} />; bgClass = 'bg-slate-100 text-slate-500'; break;
                  case 'deviceUnknown': title = 'Señal inestable (Desconocida)'; icon = <WifiOff size={12} />; bgClass = 'bg-yellow-50 text-yellow-600'; break;
                  case 'deviceMoving': title = 'Comenzó a moverse'; icon = <Play size={12} />; bgClass = 'bg-indigo-50 text-indigo-500'; break;
                  case 'deviceStopped': title = 'Se detuvo'; icon = <Square size={12} />; bgClass = 'bg-gray-100 text-gray-500'; break;
                  case 'ignitionOn': title = 'Motor Encendido'; icon = <Key size={12} />; bgClass = 'bg-orange-50 text-orange-600'; break;
                  case 'ignitionOff': title = 'Motor Apagado'; icon = <Power size={12} />; bgClass = 'bg-gray-50 text-gray-600'; break;
                  case 'geofenceEnter': title = 'Entró a zona'; icon = <MapPin size={12} />; break;
                  case 'geofenceExit': title = 'Salió de zona'; icon = <MapPin size={12} />; break;
                  case 'queuedCommandSent': title = 'Comando enviado al GPS'; icon = <Terminal size={12} />; bgClass = 'bg-purple-50 text-purple-600'; break;
                  case 'commandResult': title = ev.attributes?.result ? `Respuesta: ${ev.attributes.result}` : 'Respuesta de comando'; icon = <CheckCircle2 size={12} />; bgClass = 'bg-emerald-50 text-emerald-600'; break;
                  case 'alarm': title = `Alarma: ${ev.attributes?.alarm || ''}`; icon = <ShieldAlert size={12} />; bgClass = 'bg-red-50 text-red-500'; break;
                }

                return (
                  <div key={i} className="flex items-start gap-3 border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                    <div className={`w-7 h-7 rounded-full ${bgClass} flex items-center justify-center shrink-0 mt-0.5`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">
                        {title}
                      </p>
                      <p className="text-[10px] text-gray-500">{device?.name || 'ID: ' + ev.deviceId} • {new Date(ev.eventTime || ev.serverTime || nowTick).toLocaleTimeString()}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        )}
      </div>

      {/* ─── Toolbar Flotante Estilo Traccar (Derecha) ─── */}
      <div className="absolute top-24 right-4 z-[30] flex flex-col gap-2">
        {/* Buscar Taxi */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col group relative">
          <button onClick={() => setShowSearch(!showSearch)} className={`w-10 h-10 flex items-center justify-center transition-colors ${showSearch ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:text-blue-600 hover:bg-slate-50'}`} title="Buscar Taxi">
            <Search size={18} />
          </button>
          {showSearch && (
            <div className="absolute right-12 top-0 bg-white shadow-xl rounded-xl border border-gray-200 p-2 w-64 pointer-events-auto">
              <input
                ref={searchInputRef}
                autoFocus
                type="text"
                placeholder="Escribe el nombre del taxi..."
                className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <div className="max-h-48 overflow-y-auto custom-scrollbar">
                {devices.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 10).map(d => (
                  <button
                    key={d.id}
                    onClick={() => {
                      // 1. Empezar a seguirlo
                      setFollowingDeviceId(d.id);
                      // 2. Seleccionar para que abra el modal en móvil
                      setSelectedDevice(d);
                      // 3. Centrar el mapa
                      const pos = positions.get(d.id);
                      if (pos && leafletMapRef.current) {
                        leafletMapRef.current.panTo({ lat: pos.latitude, lng: pos.longitude });
                        leafletMapRef.current.setZoom(16);
                      }
                      // 4. Disparar el click del marcador para abrir el InfoWindow en desktop
                      const marker = markersRef.current.get(d.id);
                      if (marker) marker.fire('click');
                      // 5. Cerrar el buscador
                      setShowSearch(false);
                      setSearchQuery('');
                    }}
                    className="w-full text-left px-2 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 rounded-md truncate transition-colors flex items-center justify-between"
                  >
                    <span>{d.name}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${d.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                  </button>
                ))}
                {devices.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                  <p className="text-xs text-gray-500 text-center py-2">No se encontraron taxis.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mostrar Notificaciones Toggle */}
        {!showEventsPanel && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-300">
            <button onClick={() => setShowEventsPanel(true)} className="w-10 h-10 flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-slate-50 transition-colors" title="Mostrar Notificaciones">
              <Bell size={18} />
            </button>
          </div>
        )}
        {/* Acercar / Alejar */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden">
          <button onClick={handleZoomIn} className="w-10 h-10 flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-slate-50 transition-colors border-b border-gray-100" title="Acercar">
            <Plus size={20} />
          </button>
          <button onClick={handleZoomOut} className="w-10 h-10 flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-slate-50 transition-colors" title="Alejar">
            <Minus size={20} />
          </button>
        </div>

        {/* Centrar Mapa (Fit Bounds) */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden">
          <button onClick={handleFitBounds} className="w-10 h-10 flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-slate-50 transition-colors" title="Centrar todos los taxis">
            <Crosshair size={18} />
          </button>
        </div>

        {/* Medir Distancia */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden">
          <button onClick={handleToggleMeasure} className={`w-10 h-10 flex items-center justify-center transition-colors ${isMeasuring ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:text-blue-600 hover:bg-slate-50'}`} title="Medir distancia">
            <Ruler size={18} />
          </button>
        </div>

        {/* Mapa de Calor Predictivo */}
        <RequireFeature feature="mapa_calor">
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden group relative">
            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`w-10 h-10 flex items-center justify-center transition-all duration-300 ${showHeatmap ? 'text-red-600 bg-red-50' : 'text-gray-600 hover:text-red-500 hover:bg-slate-50'}`}
              title="Zonas de actividad de los últimos siete días"
            >
              <Activity size={18} className={showHeatmap ? 'animate-pulse' : ''} />
            </button>
            <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              Mapa de Calor (Plan Enterprise)
            </div>
          </div>
        </RequireFeature>

        {/* Simulador de asignación de la base */}
        {canSimulate && <RequireFeature feature="enrutamiento_vectorial">
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden group relative">
            <button
              onClick={() => setIsSimulatorActive(v => !v)}
              className={`w-10 h-10 flex items-center justify-center transition-all duration-300 ${isSimulatorActive ? 'text-purple-600 bg-purple-50' : 'text-gray-600 hover:text-purple-500 hover:bg-slate-50'}`}
              title="Comparar taxis disponibles"
            >
              <Brain size={18} className={isSimulatorActive ? 'animate-pulse' : ''} />
            </button>
            <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              Comparar taxis
            </div>
          </div>
        </RequireFeature>}

        {/* Cambiar Capa */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden">
          <button onClick={handleToggleMapType} className="w-10 h-10 flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-slate-50 transition-colors" title={mutedMap ? "Ver mapa a color" : "Ver mapa en gris"} aria-label={mutedMap ? "Ver mapa a color" : "Ver mapa en gris"}>
            <Layers size={18} />
          </button>
        </div>
      </div>

      {commandDevice && (
        <CommandModal
          device={commandDevice}
          onClose={() => setCommandDevice(null)}
        />
      )}

      {/* Toast de Eventos Recientes eliminado por react-hot-toast */}

      {isSimulatorActive && canSimulate && <aside className="fleet-simulation-drawer taxi-admin" aria-label="Simulador de asignación en el mapa">
        <div className="fleet-simulation-toolbar"><strong>Comparar taxis de la base</strong><button type="button" aria-label="Cerrar simulador" onClick={()=>setIsSimulatorActive(false)}><X size={20}/></button></div>
        <FleetSimulationPanel tenantId={empresaId} point={simulationPoint} onTool={simulationToolChanged} onResult={simulationResult}/>
      </aside>}

      {/* ─── Bottom Sheet for Mobile Info Window ─── */}
      <div
        className={`sm:hidden fixed inset-x-0 bottom-0 z-[40] transform transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${currentSelectedDevice ? 'translate-y-0' : 'translate-y-[150%]'}`}
      >
        {currentSelectedDevice && (
          <div className="bg-white rounded-t-3xl shadow-[0_-8px_30px_rgba(0,0,0,0.12)] border-t border-gray-100 p-5 pb-8 relative">
            {/* Handle / Drag bar */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-gray-200 rounded-full"></div>

            {/* Close button */}
            <button
              onClick={() => {
                setSelectedDevice(null);
                infoWindowRef.current?.remove();
                if (window.innerWidth < 640 && leafletMapRef.current) {
                  const currentZoom = leafletMapRef.current.getZoom();
                  if (currentZoom) leafletMapRef.current.setZoom(Math.max(currentZoom - 1, 12));
                }
              }}
              className="absolute top-4 right-4 w-8 h-8 bg-gray-50 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

            {(() => {
              const pos = positions.get(currentSelectedDevice.id);
              if (!pos) return null;
              const battery = pos.attributes?.batteryLevel;
              const ignition = pos.attributes?.ignition;
              const speed = knotsToKmh(pos.speed || 0);
              const isMoving = Number(speed) > 2;

              return (
                <div className="mt-2">
                  <div className="flex items-start justify-between pr-8 mb-3">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900 leading-tight flex items-center gap-2">
                        {currentSelectedDevice.name}
                        {currentSelectedDevice.status === 'online' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200">
                            {isMoving ? <Loader2 size={12} className="animate-spin text-emerald-600" /> : <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>}
                            EN VIVO
                          </span>
                        )}
                      </h3>
                      <p className="text-xs font-medium text-slate-500 mt-1">
                        Última señal: <strong className="text-slate-700">{formatRelativeTime(pos.serverTime, nowTick)}</strong>
                      </p>
                    </div>
                  </div>

                  {/* Status Tags Row */}
                  <div className="flex flex-wrap items-center gap-2 mb-5">
                    {/* Online Status */}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-600 uppercase">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getStatusColor(currentSelectedDevice) }}></span>
                      {currentSelectedDevice.status}
                    </span>

                    {/* Engine/Movement Status */}
                    {ignition === true ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700">
                        <Power size={12} /> Motor Encendido
                      </span>
                    ) : ignition === false ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 border border-red-200 text-[11px] font-bold text-red-700">
                        <Power size={12} /> Motor Apagado
                      </span>
                    ) : isMoving ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-[11px] font-bold text-blue-700">
                        <Activity size={12} /> En Movimiento
                      </span>
                    ) : null}

                    {/* Battery */}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-600">
                      <Battery size={12} style={{ color: getBatteryColor(battery) }} />
                      {battery ?? '--'}%
                    </span>
                  </div>

                  {/* Speed Highlight */}
                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 mb-5">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black text-slate-800 tracking-tight">{speed}</span>
                      <span className="text-xs font-bold text-slate-400">km/h</span>
                    </div>
                    {(liveAddress || pos.address) && (
                      <div className="flex-1 text-right text-[11px] text-slate-500 leading-tight border-l border-slate-200 pl-4 line-clamp-2">
                        <strong className="text-slate-700 block mb-0.5">📍 Ubicación</strong>
                        {liveAddress || pos.address?.split(',')[0]}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    {!isReadonly && (
                      <button onClick={() => setCommandDevice(currentSelectedDevice)} className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-[13px] py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm">
                        <Zap size={16} className="text-yellow-500 fill-yellow-500" /> Comandos
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (followingDeviceId === currentSelectedDevice.id) {
                          setFollowingDeviceId(null);
                          smoothCameraReset();
                        } else {
                          setFollowingDeviceId(currentSelectedDevice.id);
                          if (leafletMapRef.current) {
                            const map = leafletMapRef.current;
                            map.panTo({ lat: pos.latitude, lng: pos.longitude });
                            map.setZoom(17);
                          }
                        }
                        // Ocultar panel para dejar vista limpia
                        setSelectedDevice(null);
                      }}
                      className={`flex-1 text-white font-semibold text-[13px] py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm ${followingDeviceId === currentSelectedDevice.id ? 'bg-red-600 hover:bg-red-700 shadow-red-600/20' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'}`}
                    >
                      <MapPin size={16} /> {followingDeviceId === currentSelectedDevice.id ? 'Detener Seguimiento' : 'Seguir Taxi'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
