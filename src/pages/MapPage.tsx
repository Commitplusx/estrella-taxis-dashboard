import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Crosshair, Filter, Zap, Power, Radio, ShieldAlert } from 'lucide-react';
import { loadGoogleMaps } from '../lib/mapsLoader';
import { api, type TraccarDevice, type TraccarPosition } from '../lib/traccarApi';
import { useTraccarSocket } from '../hooks/useTraccarSocket';
import { CommandModal } from '../components/CommandModal';

// ─── Google Maps API Key ──────────────────────────────────────────────────────
// IMPORTANTE: Reemplaza esto con tu API Key real de Google
const GOOGLE_MAPS_API_KEY = 'AIzaSyAYB_sdCTSE5kLvAz4dDXp3221SdSN91ac';

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

export default function MapPage() {
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

  // Escuchar eventos globales desde los botones del InfoWindow HTML
  useEffect(() => {
    const handleOpenCommands = (e: any) => {
      const dev = devices.find(d => d.id === e.detail);
      if (dev) setCommandDevice(dev);
    };
    const handleViewRoute = (e: any) => {
      // Navegamos a la página de reportes (se puede leer desde el estado o la URL en esa página)
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

  // Inicializar mapa
  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || googleMapRef.current) return;
    
    const savedMapType = localStorage.getItem('estrella_map_type') || 'roadmap';
    
    googleMapRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 16.2355, lng: -92.1267 }, // Comitán, Chiapas
      zoom: 13,
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: false,
      mapTypeId: savedMapType,
      gestureHandling: 'cooperative', // en móvil requiere 2 dedos para mover/hacer zoom
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    });
    infoWindowRef.current = new window.google.maps.InfoWindow();
  }, [mapsLoaded]);

  // Cargar datos iniciales
  useEffect(() => {
    async function load() {
      const [devs, pos] = await Promise.all([api.getDevices(), api.getPositions()]);
      setDevices(devs);
      const posMap = new Map<number, TraccarPosition>();
      pos.forEach(p => posMap.set(p.deviceId, p));
      setPositions(posMap);
    }
    load();
  }, []);

  // Auto-centrar el mapa en los taxis la primera vez que cargan
  useEffect(() => {
    if (!googleMapRef.current || !mapsLoaded || positions.size === 0 || initialZoomDone.current) return;
    
    const bounds = new window.google.maps.LatLngBounds();
    let hasCoords = false;
    
    positions.forEach(pos => {
      if (pos.latitude && pos.longitude) {
        bounds.extend({ lat: pos.latitude, lng: pos.longitude });
        hasCoords = true;
      }
    });

    if (hasCoords) {
      googleMapRef.current.fitBounds(bounds);
      // Evitar que haga demasiado zoom si solo hay 1 taxi
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
    if (!googleMapRef.current || !mapsLoaded) return;
    devices.forEach(device => {
      const pos = positions.get(device.id);
      if (!pos) return;

      const latLng = { lat: pos.latitude, lng: pos.longitude };
      const isMoving = (pos.speed || 0) > 0.5;
      const color = device.status === 'online' ? (isMoving ? '#1d4ed8' : '#16a34a') : '#94a3b8';

      // SVG de flecha de navegación GPS (pro)
      const svgMarker = {
        path: 'M 12 2 L 22 22 L 12 17 L 2 22 Z',
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2.5,
        scale: 1.2,
        anchor: new window.google.maps.Point(12, 12),
        rotation: pos.course || 0, // Rota apuntando hacia donde se dirige el taxi
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
            const battery = pos.attributes?.batteryLevel;
            const ignition = pos.attributes?.ignition;
            const speed = knotsToKmh(pos.speed || 0);

            let engineStatusHtml = '';
            if (ignition === true) {
              engineStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#166534; background:#dcfce7; border:1px solid #bbf7d0; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#22c55e;border-radius:50%;box-shadow:0 0 4px #22c55e"></span> MOTOR ENCENDIDO</div>`;
            } else if (ignition === false) {
              engineStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#991b1b; background:#fee2e2; border:1px solid #fecaca; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#ef4444;border-radius:50%;box-shadow:0 0 4px #ef4444"></span> MOTOR APAGADO</div>`;
            } else {
              // Si no hay datos, inferir por velocidad
              if (Number(speed) > 2) {
                engineStatusHtml = `<div style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:6px; font-size:11px; color:#166534; background:#dcfce7; border:1px solid #bbf7d0; padding:6px; border-radius:8px; font-weight:700;"><span style="width:8px;height:8px;background:#22c55e;border-radius:50%;box-shadow:0 0 4px #22c55e"></span> MOTOR EN MOVIMIENTO</div>`;
              }
            }

            const content = `
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
                  <button onclick="window.dispatchEvent(new CustomEvent('openMapCommands', {detail: ${device.id}}))" style="flex:1; background:#fee2e2; color:#b91c1c; border:none; padding:8px 0; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center;">
                    ⚡ Comandos
                  </button>
                  <button onclick="window.dispatchEvent(new CustomEvent('viewMapRoute', {detail: ${device.id}}))" style="flex:1; background:#e0e7ff; color:#4338ca; border:none; padding:8px 0; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center;">
                    🗺️ Ver Ruta
                  </button>
                </div>
              </div>
            `;
          infoWindowRef.current?.setContent(content);
          infoWindowRef.current?.open(googleMapRef.current!, marker);
        });
        markersRef.current.set(device.id, marker);
      }
    });
  }, [devices, positions, mapsLoaded]);

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

  useTraccarSocket({ onDevices: handleWsDevices, onPositions: handleWsPositions });

  const onlineCount = devices.filter(d => d.status === 'online').length;

  return (
    <div className="flex flex-col h-full gap-0">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 bg-white flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Mapa en Vivo</h1>
          <p className="text-sm text-gray-500">{onlineCount} de {devices.length} taxis en línea</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-2.5 py-1 rounded-full font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            En vivo
          </span>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {!mapsLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
              <p className="text-sm text-gray-500">Cargando mapa...</p>
            </div>
          </div>
        )}
        <div ref={mapRef} className="w-full h-full" />
      </div>

      {commandDevice && (
        <CommandModal
          device={commandDevice}
          onClose={() => setCommandDevice(null)}
        />
      )}
    </div>
  );
}
