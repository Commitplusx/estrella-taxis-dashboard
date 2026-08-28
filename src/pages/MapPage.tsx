import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Crosshair, Filter, Zap, Power, Radio, ShieldAlert, Car, Bell, Battery, Activity, Route, Map as MapIcon, MapPin, X, Wifi, WifiOff, Play, Square, Terminal, CheckCircle2, Key, Plus, Minus, List, Ruler } from 'lucide-react';
import toast from 'react-hot-toast';
import { loadGoogleMaps } from '../lib/mapsLoader';
import { api, type TraccarDevice, type TraccarPosition } from '../lib/traccarApi';
import { useTraccarSocket } from '../hooks/useTraccarSocket';
import { CommandModal } from '../components/CommandModal';
import { useAuth } from '../context/AuthContext';
import { getMarkerIcon } from '../lib/mapIcons';

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

function formatRelativeTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMins = Math.round((now.getTime() - d.getTime()) / 60000);

  if (diffMins < 1) return 'Hace unos segundos';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  return `Hace ${Math.floor(diffHours / 24)} días`;
}

export function generateInfoWindowContent(device: TraccarDevice, pos: TraccarPosition, isReadonly: boolean = false, isFollowing: boolean = false) {
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
      
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between;">
        <span>Última señal:</span>
        <strong style="color:#475569">${formatRelativeTime(pos.serverTime)}</strong>
      </div>
      
      <div style="display:flex;gap:6px;margin-top:12px">
        ${!isReadonly ? `
        <button onclick="window.dispatchEvent(new CustomEvent('openMapCommands', {detail: ${device.id}}))" style="flex:1; background:#fee2e2; color:#b91c1c; border:none; padding:8px 0; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center;">
          ⚡ Comandos
        </button>
        ` : ''}
        <button onclick="window.dispatchEvent(new CustomEvent('followDevice', {detail: ${device.id}}))" style="flex:1; background:${isFollowing ? '#fee2e2' : '#e0e7ff'}; color:${isFollowing ? '#b91c1c' : '#4338ca'}; border:none; padding:8px 0; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center;">
          ${isFollowing ? '✋ Dejar de seguir' : '📍 Seguir Taxi'}
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
  // Ref en espejo del state, para leer datos frescos dentro de callbacks imperativos sin stale closure
  const positionsRef = useRef<Map<number, TraccarPosition>>(new Map());
  const devicesRef = useRef<TraccarDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<TraccarDevice | null>(null);
  const [commandDevice, setCommandDevice] = useState<TraccarDevice | null>(null);
  const [followingDeviceId, setFollowingDeviceId] = useState<number | null>(null);
  const followingDeviceIdRef = useRef<number | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [showMobileEvents, setShowMobileEvents] = useState(false);
  const [streetViewActive, setStreetViewActive] = useState(false);

  // Events Drawer
  const [realtimeEvents, setRealtimeEvents] = useState<any[]>([]);
  const [toastEvent, setToastEvent] = useState<{ id: string, title: string, message: string } | null>(null);

  // Measurement Tool
  const [isMeasuring, setIsMeasuring] = useState(false);
  const isMeasuringRef = useRef(false);
  useEffect(() => { isMeasuringRef.current = isMeasuring; }, [isMeasuring]);
  
  const measurePathRef = useRef<google.maps.LatLngLiteral[]>([]);
  const measurePolylineRef = useRef<any>(null);
  const measureMarkersRef = useRef<any[]>([]);
  const measureLabelRef = useRef<any>(null);

  // Sincronizar state con ref para usarlo dentro del websocket callback
  useEffect(() => {
    followingDeviceIdRef.current = followingDeviceId;
  }, [followingDeviceId]);

  // Escuchar eventos globales desde los botones del InfoWindow HTML
  useEffect(() => {
    const handleOpenCommands = (e: any) => {
      const dev = devices.find(d => d.id === e.detail);
      if (dev) setCommandDevice(dev);
    };
    const handleFollowDevice = (e: any) => {
      if (followingDeviceId === e.detail) {
        setFollowingDeviceId(null);
      } else {
        setFollowingDeviceId(e.detail);
        const pos = positionsRef.current.get(e.detail);
        if (pos && googleMapRef.current) {
          const map = googleMapRef.current;
          map.panTo({ lat: pos.latitude, lng: pos.longitude });
          map.setHeading(pos.course || 0);
          map.setTilt(60);
          setTimeout(() => map.setZoom(18), 300);
        }
      }
      // Cerrar la ventana de info para dejar la vista limpia
      infoWindowRef.current?.close();
      setSelectedDevice(null);
    };
    window.addEventListener('openMapCommands', handleOpenCommands);
    window.addEventListener('followDevice', handleFollowDevice);
    return () => {
      window.removeEventListener('openMapCommands', handleOpenCommands);
      window.removeEventListener('followDevice', handleFollowDevice);
    };
  }, [devices, navigate]);

  // Cargar Google Maps y Ticker
  useEffect(() => {
    // Solicitar permisos para Push Notifications Nativas
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    loadGoogleMaps().then(() => setMapsLoaded(true)).catch(console.error);
    const interval = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(interval);
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
      mapId: '4e5716e8dc53e17ddbdcd5ef', // ID Vectorial de Estrella Taxis
      tilt: 45,
      heading: 0,
      tiltInteractionEnabled: true,
      headingInteractionEnabled: true,
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: false,
      zoomControl: false,
      rotateControl: false,
      clickableIcons: false, // Ocultar flechita de "Cómo llegar" al tocar negocios
      mapTypeId: savedMapType,
      gestureHandling: 'greedy'
      // NOTA: No usar `styles` array en código cuando se usa mapId vector, 
      // ya que fuerza a Google Maps a volver al motor viejo 2D (raster) desactivando Tilt y Rotación.
    });
    infoWindowRef.current = new window.google.maps.InfoWindow();

    // Manejar visibilidad de Street View para mostrar botón de salir
    const panorama = googleMapRef.current.getStreetView();
    window.google.maps.event.addListener(panorama, 'visible_changed', () => {
      setStreetViewActive(panorama.getVisible());
    });

    // Cuando se cierre la tarjetita de información, quitamos la selección
    window.google.maps.event.addListener(infoWindowRef.current, 'closeclick', () => {
      setSelectedDevice(null);
    });

    // Clic en el mapa (fondo): cerrar sheet o medir distancia
    googleMapRef.current.addListener('click', (e: any) => {
      if (isMeasuringRef.current && e.latLng) {
        const latLng = e.latLng.toJSON();
        measurePathRef.current.push(latLng);
        
        // Draw marker
        const marker = new window.google.maps.Marker({
          position: latLng,
          map: googleMapRef.current,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 4,
            fillColor: '#3b82f6',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          }
        });
        measureMarkersRef.current.push(marker);

        // Draw or update Polyline
        if (!measurePolylineRef.current) {
          measurePolylineRef.current = new window.google.maps.Polyline({
            path: measurePathRef.current,
            map: googleMapRef.current,
            strokeColor: '#3b82f6',
            strokeWeight: 3,
            strokeOpacity: 0.8,
          });
        } else {
          measurePolylineRef.current.setPath(measurePathRef.current);
        }

        // Calculate Distance
        if (measurePathRef.current.length > 1) {
          const length = window.google.maps.geometry.spherical.computeLength(measurePathRef.current);
          const distanceStr = length > 1000 ? (length/1000).toFixed(2) + ' km' : Math.round(length) + ' m';
          
          if (!measureLabelRef.current) {
            measureLabelRef.current = new window.google.maps.InfoWindow({ disableAutoPan: true });
          }
          measureLabelRef.current.setContent(`<div style="padding: 2px 4px; font-weight: bold; color: #1e3a8a;">${distanceStr}</div>`);
          measureLabelRef.current.setPosition(latLng);
          measureLabelRef.current.open(googleMapRef.current);
        }
        return; // Detener flujo normal
      }

      setSelectedDevice(null);
      infoWindowRef.current?.close();
      if (window.innerWidth < 640 && googleMapRef.current) {
        const currentZoom = googleMapRef.current.getZoom();
        if (currentZoom) {
          googleMapRef.current.setZoom(Math.max(currentZoom - 1, 12));
        }
      }
    });

    // Ocultar etiquetas si hay mucho zoom out para no amontonar
    const zoomListener = googleMapRef.current.addListener('zoom_changed', () => {
      const zoom = googleMapRef.current?.getZoom() || 13;
      if (mapRef.current) {
        if (zoom < 14) {
          mapRef.current.classList.add('hide-marker-labels');
        } else {
          mapRef.current.classList.remove('hide-marker-labels');
        }
      }
    });

    return () => {
      window.google.maps.event.removeListener(zoomListener);
    };
  }, [mapsLoaded]);

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
    } catch (e: any) {
      setLoadError(e.message || 'Error al cargar los datos del mapa.');
    } finally {
      isFetchingRef.current = false;
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
        if (googleMapRef.current!.getZoom()! > 14) {
          googleMapRef.current!.setZoom(14);
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
      const icon = getMarkerIcon(device.category, device.status, pos.speed || 0, pos.course || 0, window.google.maps);

      if (markersRef.current.has(device.id)) {
        // OPTIMIZACIÓN DE RENDIMIENTO: 
        // El WebSocket (updateMarkerImperative) ya actualizó la posición en tiempo real.
        // No hacer nada aquí salva cientos de re-renders innecesarios en la API de Google Maps.
      } else {
        const isSelected = selectedDevice?.id === device.id;
        const zIndex = isSelected ? 1000 : (device.status === 'online' ? (pos.speed && pos.speed > 0 ? 500 : 400) : 300);

        const marker = new window.google.maps.Marker({
          position: latLng,
          map: googleMapRef.current!,
          icon,
          title: device.name,
          zIndex,
          label: {
            text: device.name || 'Taxi',
            color: '#1e293b',
            fontSize: '11px',
            fontWeight: '600',
            className: 'marker-label'
          },
        });
        marker.addListener('click', () => {
          setSelectedDevice(device);
          if (window.innerWidth >= 640) {
            // Usamos positionsRef para garantizar que usamos los datos más frescos al hacer click (evitar stale closure)
            const freshPos = positionsRef.current.get(device.id) || pos;
            infoWindowRef.current?.setContent(generateInfoWindowContent(device, freshPos, isReadonly, followingDeviceIdRef.current === device.id));
            infoWindowRef.current?.open(googleMapRef.current!, marker);
          } else {
            // Ensure any open InfoWindow is closed on mobile when switching markers
            infoWindowRef.current?.close();
          }
        });
        markersRef.current.set(device.id, marker);
      }
    });
  }, [devices, positions, mapsLoaded]);

  // Derived state: siempre usar la versión más fresca del dispositivo para evitar closures viejos
  const currentSelectedDevice = selectedDevice
    ? (devices.find(d => d.id === selectedDevice.id) || selectedDevice)
    : null;

  // Actualizar z-index y ventana de info en tiempo real si el coche se mueve o cambia la selección
  useEffect(() => {
    // 1. Actualizar zIndex de los marcadores para que el seleccionado quede arriba
    devices.forEach(d => {
      const marker = markersRef.current.get(d.id);
      if (marker) {
        const isSelected = currentSelectedDevice?.id === d.id;
        const pos = positions.get(d.id);
        const zIndex = isSelected ? 1000 : (d.status === 'online' ? (pos?.speed && pos.speed > 0 ? 500 : 400) : 300);
        marker.setZIndex(zIndex);
      }
    });

    // 2. Actualizar InfoWindow
    if (!currentSelectedDevice || !infoWindowRef.current) return;
    const pos = positions.get(currentSelectedDevice.id);
    if (pos && window.innerWidth >= 640) {
      infoWindowRef.current.setContent(generateInfoWindowContent(currentSelectedDevice, pos, isReadonly, followingDeviceId === currentSelectedDevice.id));
    }
  }, [positions, currentSelectedDevice, isReadonly, devices, nowTick, followingDeviceId]);

  // Función auxiliar para animación suave de salida (Fly-out)
  const animationFrameRef = useRef<number | null>(null);
  const smoothCameraReset = useCallback(() => {
    const map = googleMapRef.current;
    if (!map) return;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    let tilt = map.getTilt() || 0;
    let zoom = map.getZoom() || 18;
    const targetZoom = 13;

    const animate = () => {
      let changed = false;
      if (tilt > 0) {
        tilt = Math.max(0, tilt - 2);
        map.setTilt(tilt);
        changed = true;
      }
      if (zoom > targetZoom) {
        zoom = Math.max(targetZoom, zoom - 0.25);
        map.setZoom(zoom);
        changed = true;
      }
      if (changed) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        map.setHeading(0);
        animationFrameRef.current = null;
      }
    };
    animationFrameRef.current = requestAnimationFrame(animate);
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
  }, [selectedDevice]);

  // WebSocket — actualizaciones en tiempo real
  // Función auxiliar: actualiza UN marcador de Google Maps de forma imperativa (sin pasar por React)
  const updateMarkerImperative = useCallback((device: TraccarDevice, pos: TraccarPosition) => {
    if (!googleMapRef.current || !window.google?.maps) return;
    const latLng = { lat: pos.latitude, lng: pos.longitude };
    const icon = getMarkerIcon(device.category, device.status, pos.speed || 0, pos.course || 0, window.google.maps);
    const marker = markersRef.current.get(device.id);
    if (marker) {
      marker.setPosition(latLng);
      marker.setIcon(icon);
    }
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
        // Mover el marcador de Google Maps INMEDIATAMENTE, sin esperar a React
        const device = devicesRef.current.find(d => d.id === p.deviceId);
        if (device) updateMarkerImperative(device, p);

        // Seguir al taxi si está en modo follow
        if (followingDeviceIdRef.current === p.deviceId && googleMapRef.current) {
          // Usamos panTo en lugar de moveCamera durante la actualización en tiempo real.
          // Esto mantiene centrado el taxi, pero PERMITE al usuario girar, inclinar y hacer zoom libremente sin que se le sobreescriba.
          googleMapRef.current.panTo({ lat: p.latitude, lng: p.longitude });
        }
      });
      return next;
    });
  }, [updateMarkerImperative]);

  const handleWsEvents = useCallback((newEvents: any[]) => {
    setRealtimeEvents(prev => {
      const next = [...newEvents, ...prev];
      return next.slice(0, 50); // Keep last 50 events
    });

    // Si hay eventos de encendido/apagado, parchar la posición en memoria para que la UI se actualice instantáneamente
    let ignitionChanged = false;
    newEvents.forEach(ev => {
      if (ev.type === 'ignitionOn' || ev.type === 'ignitionOff') {
        setPositions(prev => {
          const pos = prev.get(ev.deviceId);
          if (pos) {
            const updatedPos = { ...pos, attributes: { ...pos.attributes, ignition: ev.type === 'ignitionOn' } };
            const nextMap = new Map(prev);
            nextMap.set(ev.deviceId, updatedPos);
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
        if (marker && window.google?.maps) {
          marker.setAnimation(window.google.maps.Animation.BOUNCE);
          setTimeout(() => marker.setAnimation(null), 3000);
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
      }

      if (message) {
        const id = Date.now().toString();
        setToastEvent({ id, title, message });
        // Auto-ocultar el aviso después de 4 segundos
        setTimeout(() => {
          setToastEvent(prev => prev?.id === id ? null : prev);
        }, 4000);

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

  const onlineCount = devices.filter(d => d.status === 'online').length;

  const movingCount = devices.filter(d => {
    const p = positions.get(d.id);
    return d.status === 'online' && p && (p.speed || 0) > 0.5;
  }).length;

  const stoppedCount = onlineCount - movingCount;

  const handleZoomIn = () => {
    if (googleMapRef.current) {
      googleMapRef.current.setZoom((googleMapRef.current.getZoom() || 13) + 1);
    }
  };

  const handleZoomOut = () => {
    if (googleMapRef.current) {
      googleMapRef.current.setZoom((googleMapRef.current.getZoom() || 13) - 1);
    }
  };

  const handleFitBounds = () => {
    if (googleMapRef.current && markersRef.current.size > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      markersRef.current.forEach(marker => {
        const pos = marker.getPosition();
        if (pos) bounds.extend(pos);
      });
      googleMapRef.current.fitBounds(bounds);
    } else {
      toastEvent?.id && setToastEvent(null);
    }
  };

  const handleToggleMapType = () => {
    if (googleMapRef.current) {
      const current = googleMapRef.current.getMapTypeId();
      const nextType = current === 'satellite' ? 'roadmap' : 'satellite';
      googleMapRef.current.setMapTypeId(nextType);
      localStorage.setItem('estrella_map_type', nextType);
    }
  };

  const clearMeasure = () => {
    measurePathRef.current = [];
    if (measurePolylineRef.current) measurePolylineRef.current.setMap(null);
    measureMarkersRef.current.forEach(m => m.setMap(null));
    measureMarkersRef.current = [];
    if (measureLabelRef.current) measureLabelRef.current.close();
  };

  const handleToggleMeasure = () => {
    const newMeasuring = !isMeasuring;
    setIsMeasuring(newMeasuring);
    if (!newMeasuring) {
      clearMeasure();
      if (googleMapRef.current) googleMapRef.current.setOptions({ draggableCursor: null });
    } else {
      if (googleMapRef.current) googleMapRef.current.setOptions({ draggableCursor: 'crosshair' });
      toast.success('Modo medición activo. Haz clics en el mapa.');
    }
  };

  return (
    <div className="absolute inset-0 fade-in">
      {/* Contenedor Principal del Mapa (Pantalla Completa) */}
      <div className="w-full h-full bg-white relative">

        {/* Stats eliminadas para un diseño más limpio */}

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
        <div ref={mapRef} className="w-full h-full hide-marker-labels" />

        {/* Gran Botón para salir de Street View */}
        {streetViewActive && (
          <button
            onClick={() => {
              if (googleMapRef.current) {
                googleMapRef.current.getStreetView().setVisible(false);
              }
            }}
            className="absolute top-20 sm:top-6 left-1/2 -translate-x-1/2 z-[100] bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-full shadow-2xl shadow-red-600/40 flex items-center gap-3 animate-fade-in border-2 border-red-500 active:scale-95 transition-all outline-none"
          >
            <X size={20} className="drop-shadow-sm" strokeWidth={3} />
            <span className="text-sm tracking-wide drop-shadow-sm">Cerrar Street View</span>
          </button>
        )}

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
        <div className={`absolute top-2 sm:top-4 right-2 sm:right-4 left-2 sm:left-auto sm:w-72 bg-white/95 backdrop-blur-sm p-4 rounded-xl shadow-lg border border-gray-200 z-[10] max-h-[45%] sm:max-h-[80%] overflow-y-auto transition-all duration-300 ease-out ${showMobileEvents ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-4 pointer-events-none sm:opacity-100 sm:translate-y-0 sm:pointer-events-auto'}`}>
          <h3 className="font-bold text-gray-800 mb-3 text-sm flex justify-between items-center">
            Actividad Reciente <Radio size={16} className="text-primary animate-pulse" />
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
                const isAlarm = ev.type === 'alarm';

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
                      <p className="text-[10px] text-gray-500">{device?.name || 'ID: ' + ev.deviceId} • {new Date(ev.eventTime || ev.serverTime || Date.now()).toLocaleTimeString()}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ─── Toolbar Flotante Estilo Traccar (Derecha) ─── */}
      <div className="absolute top-24 right-4 z-[30] flex flex-col gap-2">
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

        {/* Cambiar Capa */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 flex flex-col overflow-hidden">
          <button onClick={handleToggleMapType} className="w-10 h-10 flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-slate-50 transition-colors" title="Cambiar tipo de mapa">
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
                      <h3 className="text-xl font-bold text-slate-900 leading-tight">{currentSelectedDevice.name}</h3>
                      <p className="text-xs font-medium text-slate-500 mt-1">
                        Última señal: {formatRelativeTime(pos.serverTime)}
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
                          if (googleMapRef.current) {
                            const map = googleMapRef.current;
                            map.panTo({ lat: pos.latitude, lng: pos.longitude });
                            map.setHeading(pos.course || 0);
                            map.setTilt(60);
                            setTimeout(() => map.setZoom(18), 300);
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
