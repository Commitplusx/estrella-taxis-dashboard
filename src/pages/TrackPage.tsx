import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, CheckCircle, AlertCircle, Car, Activity, ChevronUp, ChevronDown } from 'lucide-react';

interface TaxiPosition {
  name: string;
  lat: number | null;
  lng: number | null;
  speed: number;
  course: number;
  lastUpdate: string | null;
}

interface ViajeInfo {
  origen: string;
  destino: string;
  origen_lng: number | null;
  estado: string;
  createdAt: string;
  empresaName?: string;
  clienteNombre?: string;
}

const SUPABASE_FN = 'https://knghdwpxheenkpuajkxl.supabase.co/functions/v1/track-position';

// Math utils for ETA
function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calcularETA(taxiLat: number, taxiLng: number, userLat: number, userLng: number, speedKmh: number): number {
  const distanceKm = getDistanceKm(taxiLat, taxiLng, userLat, userLng);
  // Multiplicador urbano (manhattan distance ~1.4x)
  const urbanDistance = distanceKm * 1.4;
  
  // Si va muy lento o parado, asume velocidad media de ciudad de 30 km/h
  const effectiveSpeed = (speedKmh > 10) ? speedKmh : 30;
  
  const timeHours = urbanDistance / effectiveSpeed;
  let timeMins = Math.ceil(timeHours * 60);
  
  if (timeMins < 1) timeMins = 1;
  if (timeMins > 60) timeMins = 60; // Cap
  
  return timeMins;
}

function tiempoTranscurrido(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `hace ${secs}s`;
  if (secs < 3600) return `hace ${Math.floor(secs / 60)} min`;
  return `hace ${Math.floor(secs / 3600)} h`;
}

export default function TrackPage() {
  const { token } = useParams<{ token: string }>();
  const [taxi, setTaxi] = useState<TaxiPosition | null>(null);
  const [viaje, setViaje] = useState<ViajeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  
  const touchStartY = useRef<number | null>(null);
  
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const taxiMarkerRef = useRef<google.maps.Marker | null>(null);
  const origenMarkerRef = useRef<google.maps.Marker | null>(null);
  const hasFitBoundsRef = useRef(false);

  // Inicializar el mapa de Google Maps
  useEffect(() => {
    if (!mapRef.current) return;
    if ((window as any).google?.maps) {
      initMap();
    } else {
      const existingScript = document.getElementById('google-maps-script');
      if (!existingScript) {
        const script = document.createElement('script');
        script.id = 'google-maps-script';
        const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
        script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=__initTrackMap&loading=async`;
        script.async = true;
        script.defer = true;
        (window as any).__initTrackMap = initMap;
        document.head.appendChild(script);
      } else {
        (window as any).__initTrackMap = initMap;
      }
    }
  }, []);

  function initMap() {
    if (!mapRef.current) return;
    const map = new (window as any).google.maps.Map(mapRef.current, {
      center: { lat: 16.25, lng: -92.13 },
      zoom: 15,
      mapTypeId: 'roadmap',
      disableDefaultUI: true,
      zoomControl: false,
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ]
    });
    mapInstanceRef.current = map;
  }

  // Polling
  useEffect(() => {
    if (!token) return;

    const poll = async () => {
      try {
        const res = await fetch(`${SUPABASE_FN}?token=${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Viaje no encontrado');
          return;
        }
        const data = await res.json();
        setTaxi(data.taxi);
        setViaje(data.viaje);
        setLastPoll(new Date());
        setError(null);

        // Marker Taxi
        if (data.taxi.lat && data.taxi.lng && mapInstanceRef.current) {
          const G = (window as any).google.maps;
          const pos = { lat: data.taxi.lat, lng: data.taxi.lng };

          if (!taxiMarkerRef.current) {
            taxiMarkerRef.current = new G.Marker({
              position: pos,
              map: mapInstanceRef.current,
              title: data.taxi.name,
              icon: {
                path: G.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 6,
                fillColor: '#2563EB',
                fillOpacity: 1,
                strokeColor: '#FFFFFF',
                strokeWeight: 2,
                rotation: data.taxi.course || 0,
              },
              zIndex: 10,
            });
            if (!data.viaje.origen_lat) mapInstanceRef.current.setCenter(pos);
          } else {
            taxiMarkerRef.current.setPosition(pos);
            const icon: any = taxiMarkerRef.current.getIcon();
            taxiMarkerRef.current.setIcon({ ...icon, rotation: data.taxi.course || 0 });
          }
        }

        // Marker Origen
        if (data.viaje.origen_lat && data.viaje.origen_lng && mapInstanceRef.current && !origenMarkerRef.current) {
          const G = (window as any).google.maps;
          origenMarkerRef.current = new G.Marker({
            position: { lat: data.viaje.origen_lat, lng: data.viaje.origen_lng },
            map: mapInstanceRef.current,
            title: 'Tu ubicación',
            icon: {
              path: G.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#10B981',
              fillOpacity: 1,
              strokeColor: '#FFFFFF',
              strokeWeight: 2,
            },
          });
        }

        // Auto-enfocar cámara en Taxi y Cliente la primera vez
        if (taxiMarkerRef.current && origenMarkerRef.current && mapInstanceRef.current && !hasFitBoundsRef.current) {
          const G = (window as any).google.maps;
          const bounds = new G.LatLngBounds();
          bounds.extend(taxiMarkerRef.current.getPosition());
          bounds.extend(origenMarkerRef.current.getPosition());
          // Evita que la tarjeta blanca tape los marcadores
          mapInstanceRef.current.fitBounds(bounds, { bottom: 250, top: 100, left: 50, right: 50 });
          hasFitBoundsRef.current = true;
        }

      } catch {
        // Red caída ignorar silenciosamente
      }
    };

    poll(); 
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [token]);

  const isCompleted = viaje?.estado === 'completado';
  
  useEffect(() => {
    if (viaje?.empresaName) {
      document.title = `${viaje.empresaName} - Tracker`;
    }
  }, [viaje?.empresaName]);

  let etaMins = null;
  if (taxi?.lat && taxi?.lng && viaje?.origen_lat && viaje?.origen_lng && !isCompleted) {
    etaMins = calcularETA(taxi.lat, taxi.lng, viaje.origen_lat, viaje.origen_lng, taxi.speed || 0);
  }

  // Gestos para móvil
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };
  
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartY.current) return;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    if (deltaY > 40) setIsExpanded(false); // Swipe hacia abajo
    else if (deltaY < -40) setIsExpanded(true); // Swipe hacia arriba
    touchStartY.current = null;
  };

  return (
    <div className="font-sans h-[100dvh] w-full relative bg-gray-100 overflow-hidden">
      
      {/* Mapa en fondo completo (El wrapper evita que G.Maps rompa el absolute) */}
      <div className="absolute inset-0 z-0">
        <div ref={mapRef} className="w-full h-full" />
      </div>

      {/* Header Flotante Arriba Derecha */}
      <div className="absolute top-4 right-4 md:top-8 md:right-8 z-10 pointer-events-none">
        <div className="bg-white/90 backdrop-blur-xl rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.08)] border border-white/50 p-2 pr-5 flex items-center gap-4 pointer-events-auto transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center text-white shadow-md shrink-0">
              <Car size={18} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-gray-900 text-sm leading-tight">
                {taxi ? taxi.name : (viaje?.empresaName || 'Stellar Tracker')}
              </span>
              <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider">
                {viaje?.estado === 'cancelado' ? 'Viaje cancelado' : isCompleted ? 'Viaje completado' : taxi ? 'En camino' : 'Buscando unidad'}
              </span>
            </div>
          </div>
          {taxi?.lastUpdate && (
            <div className="text-[10px] text-gray-400 font-medium text-right leading-tight border-l border-gray-200 pl-3">
              Actualizado<br/>{tiempoTranscurrido(taxi.lastUpdate)}
            </div>
          )}
        </div>
      </div>

      {/* Tarjeta Principal (Bottom Sheet en Móvil / Panel Izquierdo en Desktop) */}
      <div className="absolute bottom-0 w-full z-20 md:top-8 md:bottom-auto md:left-8 md:w-[400px]">
        <div className="bg-white w-full rounded-t-[32px] md:rounded-[32px] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-[0_20px_60px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden border-t md:border border-gray-100 transition-all duration-300">
          
          {/* Zona de Arrastre (solo móvil) */}
          <div 
            className="w-full pt-3 pb-0 cursor-grab active:cursor-grabbing md:hidden flex justify-center text-gray-300"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronDown size={28} /> : <ChevronUp size={28} className="animate-bounce" />}
          </div>

          <div className="px-5 pb-5 pt-1 md:p-8 flex flex-col gap-4 md:gap-6">
            
            {/* Nombre de la Empresa */}
            {viaje?.empresaName && (
              <div className="text-center md:text-left text-xs font-extrabold text-blue-600/80 uppercase tracking-widest -mb-2 md:-mb-4">
                {viaje.empresaName}
              </div>
            )}

            {/* Saludo Personalizado */}
            {viaje?.clienteNombre && !isCompleted && !error && (
              <div className="text-center md:text-left text-gray-500 font-medium text-sm md:text-base -mt-1 md:-mt-3">
                ¡Hola, <span className="text-gray-900 font-bold">{viaje.clienteNombre.split(' ')[0]}</span>! Tu viaje está en proceso.
              </div>
            )}

            {/* Estado / Errores */}
            {error ? (
              <div className="flex items-start gap-3 bg-red-50 text-red-700 p-4 rounded-2xl">
                <AlertCircle size={20} className="shrink-0 mt-0.5" />
                <span className="text-sm font-medium leading-relaxed">{error}</span>
              </div>
            ) : isCompleted ? (
              <div className="flex items-center gap-3 bg-gray-900 text-white p-5 rounded-3xl shadow-lg">
                <CheckCircle size={24} className="shrink-0 text-emerald-400" />
                <span className="text-[15px] font-semibold">Viaje completado. ¡Gracias!</span>
              </div>
            ) : (
              <>
                {/* Gran ETA */}
                <div className="flex flex-col items-center md:items-start text-center md:text-left py-1"
                     onTouchStart={handleTouchStart}
                     onTouchEnd={handleTouchEnd}
                     onClick={() => setIsExpanded(!isExpanded)}>
                  <div className="flex items-baseline justify-center md:justify-start gap-1">
                    <span className="text-6xl md:text-7xl font-black text-gray-900 tracking-tighter">
                      {etaMins ? etaMins : '-'}
                    </span>
                    <span className="text-2xl font-bold text-gray-400 mb-1">min</span>
                  </div>
                  <div className="text-sm font-semibold text-gray-500 uppercase tracking-widest mt-1">
                    Tiempo de llegada
                  </div>
                </div>

                {/* Contenido Colapsable */}
                <div className={`flex flex-col gap-4 md:gap-6 transition-all duration-500 ease-in-out ${isExpanded ? 'max-h-[500px] opacity-100 mt-2' : 'max-h-0 opacity-0 md:max-h-[500px] md:opacity-100 md:mt-2'}`}>
                  <hr className="border-gray-100/80" />

                {/* Línea de tiempo de la Ruta */}
                {viaje && (
                  <div className="flex items-stretch gap-4 px-1">
                    {/* Conectores visuales */}
                    <div className="flex flex-col items-center pt-1.5 pb-1">
                      <div className="w-4 h-4 rounded-full bg-black flex items-center justify-center shrink-0 z-10 shadow-sm">
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      </div>
                      <div className="w-0.5 flex-1 bg-gray-200 my-1 rounded-full" />
                      <div className="w-4 h-4 rounded-sm bg-gray-900 shrink-0 z-10 flex items-center justify-center shadow-sm">
                         <div className="w-1.5 h-1.5 bg-emerald-400 rounded-sm" />
                      </div>
                    </div>
                    
                    {/* Textos de Ruta */}
                    <div className="flex-1 flex flex-col justify-between py-0.5 gap-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold text-gray-800">
                        {viaje.estado === 'buscando_conductor' ? 'Buscando conductor ideal...' : `Taxi: ${taxi?.name}`}
                      </h2>
                      {viaje.clienteNombre && (
                        <p className="text-sm text-gray-500">
                          Pasajero: {viaje.clienteNombre}
                        </p>
                      )}
                      <p className="text-sm text-gray-500">
                        {viaje.estado === 'buscando_conductor' ? 'Enviando alerta a unidades cercanas' : `Placas: ${taxi?.deviceId || 'N/A'}`}
                      </p>
                    </div>
                  </div>
                      <div>
                        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Punto de encuentro</div>
                        <div className="text-[16px] font-bold text-gray-900 leading-snug truncate pr-4">{viaje.origen}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Destino</div>
                        <div className="text-[16px] font-bold text-gray-900 leading-snug truncate pr-4">{viaje.destino}</div>
                      </div>
                    </div>
                  </div>
                )}

                <hr className="border-gray-100/80" />

                {/* Footer del Tracker */}
                <div className="flex items-center justify-between px-1">
                  {taxi && taxi.lat ? (
                    <>
                      <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100/50">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider mt-px">GPS Vivo</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full">
                        <Activity size={14} />
                        <span className="text-[13px] font-bold text-gray-700">
                          {Math.round(taxi.speed || 0)} <span className="text-[11px] font-semibold text-gray-400">km/h</span>
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-3 text-gray-500 text-sm font-medium py-2 mx-auto">
                      <div className="animate-spin w-5 h-5 border-2 border-gray-300 border-t-black rounded-full" />
                      Localizando unidad...
                    </div>
                  )}
                </div>
                </div> {/* End Contenido Colapsable */}

              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
