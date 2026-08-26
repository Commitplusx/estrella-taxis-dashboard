import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Crosshair, Filter, Zap, Power, Radio, ShieldAlert, Car, Bell, Battery, Activity, Route, Map as MapIcon } from 'lucide-react';
import { loadGoogleMaps } from '../lib/mapsLoader';
import { api, type TraccarDevice, type TraccarPosition } from '../lib/traccarApi';
import { useTraccarSocket } from '../hooks/useTraccarSocket';
import { CommandModal } from '../components/CommandModal';
import { useAuth } from '../context/AuthContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function knotsToKmh(knots: number) {
  return (knots * 1.852).toFixed(0);
}

function getBatteryColor(level: number | undefined) {
  if (!level) return '#94a3b8';
  if (level > 50) return '#16a34a';
  if (level > 20) return '#f59e0b';
  return '#dc2626';
}

function getStatusColor(device: TraccarDevice) {
  if (device.status === 'online') return '#16a34a';
  if (device.status === 'offline') return '#94a3b8';
  return '#f59e0b';
}

function generateInfoWindowContent(device: TraccarDevice, pos: TraccarPosition, isReadonly: boolean = false) {
  const battery = pos.attributes?.batteryLevel;
  const ignition = pos.attributes?.ignition;
  const speed = knotsToKmh(pos.speed || 0);

  let engineStatusHtml = '';
  if (ignition === true) {
    engineStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#166534; background:#dcfce7; border:1px solid #bbf7d0; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#22c55e;border-radius:50%;box-shadow:0 0 4px #22c55e"></span> MOTOR ENCENDIDO</div>`;
  } else if (ignition === false) {
    engineStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#991b1b; background:#fee2e2; border:1px solid #fecaca; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#ef4444;border-radius:50%;box-shadow:0 0 4px #ef4444"></span> MOTOR APAGADO</div>`;
  } else if (Number(speed) > 2) {
    engineStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#166534; background:#dcfce7; border:1px solid #bbf7d0; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#22c55e;border-radius:50%;box-shadow:0 0 4px #22c55e"></span> MOTOR EN MOVIMIENTO</div>`;
  }

  return `
    <div style="font-family:Inter,sans-serif;min-width:220px;padding:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <strong style="font-size:15px;color:#0f172a">${device.name}</strong>
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

      ${pos.address ? `<div style="margin-top:10px;font-size:11px;color:#64748b;line-height:1.4"><strong style="color:#475569">📍 Dirección:</strong><br/>${pos.address.split(',')[0]}</div>` : ''}
      
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;font-size:10px;color:#94a3b8">
        Última señal: ${new Date(pos.fixTime).toLocaleTimeString()}
      </div>
      
      <div style="display:flex;gap:6px;margin-top:12px">
        ${!isReadonly ? `
        <button onclick="window.dispatchEvent(new CustomEvent('openMapCommands', {detail: ${device.id}}))" style="flex:1; background:#fee2e2; color:#b91c1c; border:none; padding:8px 0; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center;">
          ⚡ Comandos
        </button>
        ` : ''}
        <button onclick="window.dispatchEvent(new CustomEvent('viewMapRoute', {detail: ${device.id}}))" style="flex:1; background:#e0e7ff; color:#4338ca; border:none; padding:8px 0; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center;">
          🗺️ Ver Ruta
        </button>
      </div>
    </div>
  `;
}

export default function MapPage() {
  const { user } = useAuth();
  const isReadonly = user?.readonly ?? false;

  const navigate = useNavigate();
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const initialZoomDone = useRef(false);

  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [positions, setPositions] = useState<Map<number, TraccarPosition>>(new Map());
  const [selectedDevice, setSelectedDevice] = useState<TraccarDevice | null>(null);
  const [commandDevice, setCommandDevice] = useState<TraccarDevice | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showMobileEvents, setShowMobileEvents] = useState(false);
  
  // Events Drawer
  const [realtimeEvents, setRealtimeEvents] = useState<any[]>([]);
  const [toastEvent, setToastEvent] = useState<{ id: string, title: string, message: string } | null>(null);

  // Escuchar eventos globales desde los botones del InfoWindow HTML
  useEffect(() => {
    const handleOpenCommands = (e: any) => {
      const dev = devices.find(d => d.id === e.detail);
      if (dev) setCommandDevice(dev);
    };
    const handleViewRoute = (e: any) => {
      navigate('/reports?deviceId=' + e.detail);
    };
    window.addEventListener('openMapCommands', handleOpenCommands);
    window.addEventListener('viewMapRoute', handleViewRoute);
    return () => {
      window.removeEventListener('openMapCommands', handleOpenCommands);
      window.removeEventListener('viewMapRoute', handleViewRoute);
    };
  }, [devices, navigate]);

  // Cargar Google Maps
  useEffect(() => {
    loadGoogleMaps().then(() => setMapsLoaded(true)).catch(console.error);
  }, []);

  // Inicializar mapa: registramos el evento de cierre del popup una sola vez
  // para que no se acumulen y alenten la página
  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || googleMapRef.current) return;
    if (!window.google || !window.google.maps) {
      console.warn("Google Maps no está disponible aún en window.google");
      return;
    }
    
    const savedMapType = localStorage.getItem('estrella_map_type') || 'roadmap';
    
    googleMapRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 16.2355, lng: -92.1267 }, // Comitán, Chiapas
      zoom: 13,
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: false,
      mapTypeId: savedMapType,
      gestureHandling: 'greedy',
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    });
    infoWindowRef.current = new window.google.maps.InfoWindow();

    // Cuando se cierre la tarjetita de información, quitamos la selección
    window.google.maps.event.addListener(infoWindowRef.current, 'closeclick', () => {
      setSelectedDevice(null);
    });

    // Clic en el mapa (fondo): cerrar sheet y hacer zoom out en móvil
    googleMapRef.current.addListener('click', () => {
      setSelectedDevice(null);
      infoWindowRef.current?.close();
      if (window.innerWidth < 640 && googleMapRef.current) {
        const currentZoom = googleMapRef.current.getZoom();
        if (currentZoom) {
          googleMapRef.current.setZoom(Math.max(currentZoom - 1, 12));
        }
      }
    });
  }, [mapsLoaded]);

  // Traer los taxis y sus posiciones desde el servidor
  const loadFullState = useCallback(async () => {
    try {
      const [devs, pos] = await Promise.all([api.getDevices(), api.getPositions()]);
      setDevices(devs);
      const posMap = new Map<number, TraccarPosition>();
      pos.forEach(p => posMap.set(p.deviceId, p));
      setPositions(posMap);
    } catch (e: any) {
      setLoadError(e.message || 'Error al cargar los datos del mapa.');
    }
  }, []);

  // Cargar una vez al inicio por si el websocket tarda
  useEffect(() => {
    loadFullState();
  }, [loadFullState]);

  // Auto-ajustar mapa a los marcadores
  useEffect(() => {
    if (!googleMapRef.current || !mapsLoaded || !window.google || !window.google.maps) return;
    if (initialZoomDone.current) return;
    
    const validPositions = devices
      .map(d => positions.get(d.id))
      .filter((p): p is TraccarPosition => p != null && p.latitude !== 0 && p.longitude !== 0);

    if (validPositions.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      validPositions.forEach(pos => {
        bounds.extend({ lat: pos.latitude, lng: pos.longitude });
      });

      googleMapRef.current.fitBounds(bounds);
      const listener = window.google.maps.event.addListener(googleMapRef.current, 'idle', () => {
        if (googleMapRef.current!.getZoom()! > 16) {
          googleMapRef.current!.setZoom(16);
        }
        window.google.maps.event.removeListener(listener);
      });
      initialZoomDone.current = true;
    }
  }, [positions, mapsLoaded]);

  // Actualizar marcadores cuando hay datos
  useEffect(() => {
    if (!googleMapRef.current || !mapsLoaded || !window.google || !window.google.maps) return;
    devices.forEach(device => {
      const pos = positions.get(device.id);
      if (!pos) return;

      const latLng = { lat: pos.latitude, lng: pos.longitude };
      const isMoving = (pos.speed || 0) > 0.5;
      const color = device.status === 'online' ? (isMoving ? '#1d4ed8' : '#16a34a') : '#94a3b8';

      const svgMarker = {
        path: 'M 12 2 L 22 22 L 12 17 L 2 22 Z',
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2.5,
        scale: 1.2,
        anchor: new window.google.maps.Point(12, 12),
        rotation: pos.course || 0,
      };

      if (markersRef.current.has(device.id)) {
        const marker = markersRef.current.get(device.id)!;
        marker.setPosition(latLng);
        marker.setIcon(svgMarker);
      } else {
        const marker = new window.google.maps.Marker({
          position: latLng,
          map: googleMapRef.current!,
          icon: svgMarker,
          title: device.name,
        });
        marker.addListener('click', () => {
          setSelectedDevice(device);
          if (window.innerWidth >= 640) {
            infoWindowRef.current?.setContent(generateInfoWindowContent(device, pos, isReadonly));
            infoWindowRef.current?.open(googleMapRef.current!, marker);
          } else {
            // Ensure any open InfoWindow is closed on mobile when switching markers
            infoWindowRef.current?.close();
            // Eliminamos el panTo para evitar que el mapa se mueva bruscamente
          }
        });
        markersRef.current.set(device.id, marker);
      }
    });
  }, [devices, positions, mapsLoaded]);

  // Actualizar la ventana de info en tiempo real si el coche se mueve
  useEffect(() => {
    if (!selectedDevice || !infoWindowRef.current) return;
    const pos = positions.get(selectedDevice.id);
    if (pos) {
      infoWindowRef.current.setContent(generateInfoWindowContent(selectedDevice, pos, isReadonly));
    }
  }, [positions, selectedDevice, isReadonly]);

  // Manejar visibilidad del BottomNav en móviles cuando se abre/cierra una tarjeta
  useEffect(() => {
    if (selectedDevice && window.innerWidth < 640) {
      window.dispatchEvent(new CustomEvent('hideBottomNav'));
    } else {
      window.dispatchEvent(new CustomEvent('showBottomNav'));
    }
    return () => {
      window.dispatchEvent(new CustomEvent('showBottomNav'));
    };
  }, [selectedDevice]);

  // WebSocket — actualizaciones en tiempo real
  const handleWsDevices = useCallback((updated: TraccarDevice[]) => {
    setDevices(prev => {
      const map = new Map(prev.map(d => [d.id, d]));
      updated.forEach(d => map.set(d.id, d));
      return Array.from(map.values());
    });
  }, []);

  const handleWsPositions = useCallback((updated: TraccarPosition[]) => {
    setPositions(prev => {
      const map = new Map(prev);
      updated.forEach(p => map.set(p.deviceId, p));
      return map;
    });
  }, []);

  const handleWsEvents = useCallback((newEvents: any[]) => {
    setRealtimeEvents(prev => {
      const next = [...newEvents, ...prev];
      return next.slice(0, 50); // Keep last 50 events
    });
    
    // Disparar una notificación visual (Toast) si hay un evento importante
    if (newEvents.length > 0) {
      const ev = newEvents[0];
      const device = devices.find(d => d.id === ev.deviceId);
      const taxiName = device?.name || `Taxi #${ev.deviceId}`;
      
      let title = 'Evento';
      let message = '';
      
      if (ev.type === 'deviceStopped') {
        title = 'Motor Apagado';
        message = `${taxiName} se ha detenido.`;
      } else if (ev.type === 'deviceMoving') {
        title = 'En Movimiento';
        message = `${taxiName} empezó a moverse.`;
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
      }

      if (message) {
        const id = Date.now().toString();
        setToastEvent({ id, title, message });
        // Auto-ocultar el aviso después de 4 segundos
        setTimeout(() => {
          setToastEvent(prev => prev?.id === id ? null : prev);
        }, 4000);
      }
    }
  }, [devices]);

  useTraccarSocket({ 
    onDevices: handleWsDevices, 
    onPositions: handleWsPositions,
    onEvents: handleWsEvents,
    onConnect: loadFullState
  });

  const onlineCount = devices.filter(d => d.status === 'online').length;
  
  const movingCount = devices.filter(d => {
    const p = positions.get(d.id);
    return d.status === 'online' && p && (p.speed || 0) > 0.5;
  }).length;
  
  const stoppedCount = onlineCount - movingCount;

  return (
    <div className="absolute inset-0 p-2 sm:p-4 view-panel fade-in flex flex-col">
      {/* Estadísticas Rápidas flotantes */}
      <div className="hidden sm:grid grid-cols-3 gap-4 mb-4 z-10 relative">
          <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-row items-start gap-4 text-left">
              <div className="w-10 h-10 rounded-full bg-blue-100 text-primary flex items-center justify-center text-lg shrink-0"><Car size={20} /></div>
              <div><p className="text-xs text-gray-500 font-medium leading-normal">Total Taxis</p><p className="text-xl font-bold text-gray-800">{devices.length}</p></div>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-row items-start gap-4 text-left">
              <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-lg shrink-0"><Zap size={20} /></div>
              <div><p className="text-xs text-gray-500 font-medium leading-normal">En Movimiento</p><p className="text-xl font-bold text-gray-800">{movingCount}</p></div>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex flex-row items-start gap-4 text-left">
              <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-lg shrink-0"><Power size={20} /></div>
              <div><p className="text-xs text-gray-500 font-medium leading-normal">Detenidos</p><p className="text-xl font-bold text-gray-800">{stoppedCount}</p></div>
          </div>
      </div>

      {/* Contenedor del Mapa */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden relative">
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-10">
            <div className="text-center p-6">
              <p className="text-red-600 font-bold text-sm mb-1">Error al cargar el mapa</p>
              <p className="text-red-400 text-xs">{loadError}</p>
            </div>
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
        <div ref={mapRef} className="w-full h-full" />

        {/* Panel lateral flotante de info del mapa */}
        <div className={`absolute top-2 sm:top-4 right-2 sm:right-4 left-2 sm:left-auto sm:w-72 bg-white/95 backdrop-blur-sm p-4 rounded-xl shadow-lg border border-gray-200 z-[10] max-h-[45%] sm:max-h-[80%] overflow-y-auto transition-all duration-300 ease-out ${showMobileEvents ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-4 pointer-events-none sm:opacity-100 sm:translate-y-0 sm:pointer-events-auto'}`}>
            <h3 className="font-bold text-gray-800 mb-3 text-sm flex justify-between items-center">
                Actividad Reciente <Radio size={16} className="text-primary animate-pulse" />
            </h3>
            <div className="space-y-3">
              {realtimeEvents.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4">Esperando eventos...</p>
              ) : (
                realtimeEvents.slice(0, 10).map((ev, i) => {
                  const device = devices.find(d => d.id === ev.deviceId);
                  const isAlarm = ev.type === 'alarm';
                  return (
                    <div key={i} className="flex items-start gap-3 border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                        <div className={`w-7 h-7 rounded-full ${isAlarm ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'} flex items-center justify-center shrink-0 mt-0.5`}>
                          {isAlarm ? <ShieldAlert size={12} /> : <Zap size={12} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-800 truncate">
                              {ev.type === 'deviceOnline' ? 'Señal recuperada' : 
                               ev.type === 'deviceOffline' ? 'Señal perdida' :
                               ev.type === 'deviceMoving' ? 'Comenzó a moverse' :
                               ev.type === 'deviceStopped' ? 'Motor apagado/detenido' : ev.type}
                            </p>
                            <p className="text-[10px] text-gray-500">{device?.name || 'ID: ' + ev.deviceId} • {new Date(ev.eventTime || Date.now()).toLocaleTimeString()}</p>
                        </div>
                    </div>
                  );
                })
              )}
            </div>
        </div>

        {/* Botón de Campanita (Solo móvil) para abrir el panel */}
        <button
          onClick={() => setShowMobileEvents(!showMobileEvents)}
          className="absolute bottom-6 right-2 sm:hidden w-12 h-12 bg-white rounded-full shadow-xl border border-gray-100 flex items-center justify-center text-gray-700 hover:text-blue-600 z-10"
        >
          <div className="relative">
             <Bell size={22} className={showMobileEvents ? 'text-blue-600' : ''} />
             {realtimeEvents.length > 0 && !showMobileEvents && (
               <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
             )}
          </div>
        </button>
      </div>

      {commandDevice && (
        <CommandModal
          device={commandDevice}
          onClose={() => setCommandDevice(null)}
        />
      )}

      {/* Toast de Eventos Recientes */}
      {toastEvent && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in pointer-events-none">
          <div className="bg-gray-900/90 backdrop-blur-sm text-white px-4 py-3 rounded-2xl shadow-xl border border-gray-700/50 flex flex-col items-center min-w-[200px]">
            <span className="text-xs font-bold text-gray-400 mb-0.5">{toastEvent.title}</span>
            <span className="text-sm font-semibold">{toastEvent.message}</span>
          </div>
        </div>
      )}

      {/* ─── Bottom Sheet for Mobile Info Window ─── */}
      <div 
        className={`sm:hidden fixed inset-x-0 bottom-0 z-[40] transform transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${selectedDevice ? 'translate-y-0' : 'translate-y-[150%]'}`}
      >
        {selectedDevice && (
          <div className="bg-white rounded-t-3xl shadow-[0_-8px_30px_rgba(0,0,0,0.12)] border-t border-gray-100 p-5 pb-8 relative">
            {/* Handle / Drag bar */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-gray-200 rounded-full"></div>
            
            {/* Close button */}
            <button 
              onClick={() => { 
                setSelectedDevice(null); 
                infoWindowRef.current?.close(); 
                if (window.innerWidth < 640 && googleMapRef.current) {
                  const currentZoom = googleMapRef.current.getZoom();
                  if (currentZoom) googleMapRef.current.setZoom(Math.max(currentZoom - 1, 12));
                }
              }}
              className="absolute top-4 right-4 w-8 h-8 bg-gray-50 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

            {(() => {
              const pos = positions.get(selectedDevice.id);
              if (!pos) return null;
              const battery = pos.attributes?.batteryLevel;
              const ignition = pos.attributes?.ignition;
              const speed = knotsToKmh(pos.speed || 0);
              const isMoving = Number(speed) > 2;
              
              return (
                <div className="mt-2">
                  <div className="flex items-start justify-between pr-8 mb-3">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900 leading-tight">{selectedDevice.name}</h3>
                      <p className="text-xs font-medium text-slate-500 mt-1">
                        Última señal: {new Date(pos.fixTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </p>
                    </div>
                  </div>

                  {/* Status Tags Row */}
                  <div className="flex flex-wrap items-center gap-2 mb-5">
                    {/* Online Status */}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-600 uppercase">
                      <span className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: getStatusColor(selectedDevice)}}></span>
                      {selectedDevice.status}
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
                      <Battery size={12} style={{color: getBatteryColor(battery)}} /> 
                      {battery ?? '--'}%
                    </span>
                  </div>

                  {/* Speed Highlight */}
                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 mb-5">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black text-slate-800 tracking-tight">{speed}</span>
                      <span className="text-xs font-bold text-slate-400">km/h</span>
                    </div>
                    {pos.address && (
                      <div className="flex-1 text-right text-[11px] text-slate-500 leading-tight border-l border-slate-200 pl-4 line-clamp-2">
                        <strong className="text-slate-700 block mb-0.5">📍 Ubicación</strong>
                        {pos.address.split(',')[0]}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    {!isReadonly && (
                      <button onClick={() => setCommandDevice(selectedDevice)} className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-[13px] py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm">
                        <Zap size={16} className="text-yellow-500 fill-yellow-500" /> Comandos
                      </button>
                    )}
                    <button onClick={() => window.dispatchEvent(new CustomEvent('viewMapRoute', {detail: selectedDevice.id}))} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[13px] py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm shadow-blue-600/20">
                      <Route size={16} /> Ver Ruta
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
