import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, Navigation, Clock, CheckCircle, AlertCircle } from 'lucide-react';

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
  origen_lat: number | null;
  origen_lng: number | null;
  estado: string;
  createdAt: string;
}

const SUPABASE_FN = 'https://knghdwpxheenkpuajkxl.supabase.co/functions/v1/track-position';

// Convierte grados de heading a una flecha visual
function headingToArrow(deg: number): string {
  const dirs = ['↑','↗','→','↘','↓','↙','←','↖'];
  return dirs[Math.round(deg / 45) % 8];
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
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const taxiMarkerRef = useRef<google.maps.Marker | null>(null);
  const origenMarkerRef = useRef<google.maps.Marker | null>(null);

  // Inicializar el mapa de Google Maps una vez que el div esté listo
  useEffect(() => {
    if (!mapRef.current) return;
    if ((window as any).google?.maps) {
      initMap();
    } else {
      // Cargar el script de Google Maps dinámicamente
      const script = document.createElement('script');
      const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=__initTrackMap`;
      (window as any).__initTrackMap = initMap;
      document.head.appendChild(script);
    }
  }, []);

  function initMap() {
    if (!mapRef.current) return;
    const map = new (window as any).google.maps.Map(mapRef.current, {
      center: { lat: 16.25, lng: -92.13 }, // Centro en Comitán de respaldo
      zoom: 14,
      mapTypeId: 'roadmap',
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ]
    });
    mapInstanceRef.current = map;
  }

  // Polling: consulta la posición cada 5 segundos
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

        // Actualizar marcador del taxi en el mapa
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
                scale: 5,
                fillColor: '#4F46E5',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 2,
                rotation: data.taxi.course || 0,
              },
              zIndex: 10,
            });
            mapInstanceRef.current.setCenter(pos);
          } else {
            taxiMarkerRef.current.setPosition(pos);
            const icon: any = taxiMarkerRef.current.getIcon();
            taxiMarkerRef.current.setIcon({ ...icon, rotation: data.taxi.course || 0 });
          }
        }

        // Marcador del origen del cliente (se pone solo la primera vez)
        if (data.viaje.origen_lat && data.viaje.origen_lng && mapInstanceRef.current && !origenMarkerRef.current) {
          const G = (window as any).google.maps;
          origenMarkerRef.current = new G.Marker({
            position: { lat: data.viaje.origen_lat, lng: data.viaje.origen_lng },
            map: mapInstanceRef.current,
            title: 'Tu ubicación',
            icon: {
              path: G.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#EF4444',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            },
          });
        }
      } catch {
        // Red caída o función no disponible, ignorar silenciosamente
      }
    };

    poll(); // Primera vez inmediato
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [token]);

  const isCompleted = viaje?.estado === 'completado';

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", minHeight: '100dvh', background: '#0F172A', color: '#fff', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px', background: '#1E293B', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #4F46E5, #7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Navigation size={18} color="#fff" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {taxi ? `🚕 ${taxi.name}` : 'Seguimiento de Taxi'}
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
            {isCompleted ? '✅ Viaje completado' : taxi ? 'En camino a recogerte' : 'Localizando unidad...'}
          </div>
        </div>
        {lastPoll && (
          <div style={{ marginLeft: 'auto', fontSize: 11, color: '#64748B', textAlign: 'right' }}>
            Actualizado<br />{tiempoTranscurrido(lastPoll.toISOString())}
          </div>
        )}
      </div>

      {/* Mapa */}
      <div ref={mapRef} style={{ flex: 1, minHeight: 320, background: '#1E293B' }} />

      {/* Panel inferior */}
      <div style={{ background: '#1E293B', borderTop: '1px solid #334155', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#FEF2F2', borderRadius: 12, padding: '12px 16px', color: '#B91C1C' }}>
            <AlertCircle size={18} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{error}</span>
          </div>
        ) : isCompleted ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F0FDF4', borderRadius: 12, padding: '12px 16px', color: '#166534' }}>
            <CheckCircle size={18} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Viaje completado. ¡Que te vaya bien!</span>
          </div>
        ) : (
          <>
            {/* Velocidad y heading */}
            {taxi && taxi.lat && (
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, background: '#0F172A', borderRadius: 12, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#818CF8' }}>{Math.round(taxi.speed || 0)} <span style={{ fontSize: 12, fontWeight: 400 }}>km/h</span></div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Velocidad</div>
                </div>
                <div style={{ flex: 1, background: '#0F172A', borderRadius: 12, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#34D399' }}>{headingToArrow(taxi.course || 0)}</div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Dirección</div>
                </div>
                <div style={{ flex: 1, background: '#0F172A', borderRadius: 12, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ width: 8, height: 8, background: '#22C55E', borderRadius: '50%', display: 'inline-block', marginRight: 6, boxShadow: '0 0 0 3px rgba(34,197,94,0.3)', animation: 'pulse 1.5s infinite' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#22C55E' }}>VIVO</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>GPS activo</div>
                </div>
              </div>
            )}

            {/* Ruta */}
            {viaje && (
              <div style={{ background: '#0F172A', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <MapPin size={15} color="#EF4444" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recoge en</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0' }}>{viaje.origen}</div>
                  </div>
                </div>
                <div style={{ height: 1, background: '#1E293B', marginLeft: 25 }} />
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 15, height: 15, border: '2px solid #4F46E5', borderRadius: 3, flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Destino</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0' }}>{viaje.destino}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Pulsando mientras espera */}
            {!taxi?.lat && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#94A3B8', fontSize: 13 }}>
                <div className="animate-spin" style={{ width: 16, height: 16, border: '2px solid #4F46E5', borderTopColor: 'transparent', borderRadius: '50%' }} />
                Localizando al conductor...
              </div>
            )}
          </>
        )}

        <div style={{ fontSize: 10, color: '#334155', textAlign: 'center' }}>
          Powered by Stellar Tracking • Actualización automática cada 5s
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
        @keyframes pulse { 0%,100%{box-shadow:0 0 0 3px rgba(34,197,94,0.3)} 50%{box-shadow:0 0 0 6px rgba(34,197,94,0.1)} }
      `}</style>
    </div>
  );
}
