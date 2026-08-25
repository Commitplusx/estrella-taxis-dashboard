import React, { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { dataCache } from '../lib/cache';
import { BASE_URL } from '../lib/traccarApi';
import { useAuth } from '../context/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Map as MapIcon, Plus, Trash2, Edit2, X, Save, Hexagon, Circle as CircleIcon, GitCommit } from 'lucide-react';

export interface TraccarGeofence {
  id?: number;
  name: string;
  description?: string;
  area: string;
  attributes?: Record<string, any>;
}

// ─── WKT Parser / Stringifier ────────────────────────────────────────────────
const parseWkt = (wkt: string) => {
  if (wkt.startsWith('CIRCLE')) {
    const match = wkt.match(/CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
    if (match) return { type: 'circle', lat: +match[1], lng: +match[2], radius: +match[3] };
  }
  if (wkt.startsWith('POLYGON')) {
    const match = wkt.match(/POLYGON\s*\(\((.*?)\)\)/);
    if (match) {
      const points = match[1].split(',').map(p => {
        const [lat, lng] = p.trim().split(/\s+/);
        return { lat: +lat, lng: +lng };
      });
      return { type: 'polygon', path: points };
    }
  }
  if (wkt.startsWith('LINESTRING')) {
    const match = wkt.match(/LINESTRING\s*\((.*?)\)/);
    if (match) {
      const points = match[1].split(',').map(p => {
        const [lat, lng] = p.trim().split(/\s+/);
        return { lat: +lat, lng: +lng };
      });
      return { type: 'polyline', path: points };
    }
  }
  return null;
};

// ─── Página Principal ───────────────────────────────────────────────────────
export default function GeofencesPage() {
  const { user } = useAuth();
  const isReadonly = user?.readonly ?? false;

  const { data, loading, refetch } = useCachedFetch<TraccarGeofence[]>('/api/geofences', { ttlMs: 60_000 });
  const geofences = data ?? [];
  
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<any>(null);
  const currentOverlayRef = useRef<any>(null); // La figura que el usuario dibujó o editó
  const drawingModeRef = useRef<'polygon' | 'circle' | 'polyline' | null>(null);
  const clickListenerRef = useRef<any>(null);
  
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [editingGeofence, setEditingGeofence] = useState<Partial<TraccarGeofence> | null>(null);
  const [drawnShapes, setDrawnShapes] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  
  // Cargar Google Maps
  useEffect(() => {
    import('../lib/mapsLoader').then(({ loadGoogleMaps }) => {
      loadGoogleMaps().then(() => setMapsLoaded(true)).catch(console.error);
    });
  }, []);

  // Inicializar Mapa
  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || googleMapRef.current) return;
    if (!window.google || !window.google.maps) {
      console.warn("Google Maps no está disponible aún en window.google");
      return;
    }
    
    const savedMapType = localStorage.getItem('estrella_map_type') || 'roadmap';

    googleMapRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 16.753, lng: -93.115 }, // Tuxtla por defecto
      zoom: 12,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      mapTypeId: savedMapType,
      gestureHandling: 'greedy',
    });

    // Lógica manual de dibujo (reemplazo de DrawingManager obsoleto)
    clickListenerRef.current = googleMapRef.current.addListener('click', (e: any) => {
      const mode = drawingModeRef.current;
      if (!mode) return;

      const commonOpts = { map: googleMapRef.current, editable: true, draggable: true, fillColor: '#3b82f6', fillOpacity: 0.3, strokeColor: '#2563eb', strokeWeight: 2 };

      if (mode === 'circle') {
        if (!currentOverlayRef.current) {
          currentOverlayRef.current = new window.google.maps.Circle({ ...commonOpts, center: e.latLng, radius: 200 });
          drawingModeRef.current = null; // Círculo completado en el primer clic (se puede arrastrar)
          setActiveMode(null);
        }
      } else if (mode === 'polygon') {
        if (!currentOverlayRef.current) {
          currentOverlayRef.current = new window.google.maps.Polygon({ ...commonOpts, paths: [e.latLng] });
        } else {
          currentOverlayRef.current.getPath().push(e.latLng);
        }
      } else if (mode === 'polyline') {
        if (!currentOverlayRef.current) {
          currentOverlayRef.current = new window.google.maps.Polyline({ ...commonOpts, path: [e.latLng], fillOpacity: 0 });
        } else {
          currentOverlayRef.current.getPath().push(e.latLng);
        }
      }
    });

    return () => {
      if (clickListenerRef.current) window.google.maps.event.removeListener(clickListenerRef.current);
    };
  }, [mapsLoaded]);

  // Dibujar las geocercas existentes en el mapa (modo solo lectura)
  useEffect(() => {
    if (!googleMapRef.current) return;
    
    // Limpiar previas
    drawnShapes.forEach(shape => shape.setMap(null));
    const newShapes: any[] = [];
    
    geofences.forEach(gf => {
      // Si estamos editando esta geocerca, no la dibujamos como "solo lectura"
      if (editingGeofence?.id === gf.id) return;
      
      const parsed = parseWkt(gf.area);
      if (!parsed) return;
      
      const commonOpts = { map: googleMapRef.current, clickable: true, strokeColor: '#94a3b8', fillColor: '#cbd5e1', fillOpacity: 0.3, strokeWeight: 2 };
      let shape;
      
      if (parsed.type === 'circle') {
        shape = new window.google.maps.Circle({ ...commonOpts, center: { lat: parsed.lat, lng: parsed.lng }, radius: parsed.radius });
      } else if (parsed.type === 'polygon') {
        shape = new window.google.maps.Polygon({ ...commonOpts, paths: parsed.path });
      } else if (parsed.type === 'polyline') {
        shape = new window.google.maps.Polyline({ ...commonOpts, path: parsed.path, fillOpacity: 0 });
      }
      
      if (shape) {
        newShapes.push(shape);
        // Tooltip básico
        const info = new window.google.maps.InfoWindow({ content: `<div class="text-xs font-bold text-gray-800 p-1">${gf.name}</div>` });
        shape.addListener('mouseover', (e: any) => info.setPosition(e.latLng) || info.open(googleMapRef.current));
        shape.addListener('mouseout', () => info.close());
      }
    });
    setDrawnShapes(newShapes);
  }, [geofences, editingGeofence, mapsLoaded]);

  // Funciones de dibujo
  const startDrawing = (mode: 'polygon' | 'circle' | 'polyline') => {
    if (currentOverlayRef.current) {
      currentOverlayRef.current.setMap(null);
      currentOverlayRef.current = null;
    }
    drawingModeRef.current = mode;
    setActiveMode(mode);
  };

  const handleEditGeofence = (gf: TraccarGeofence) => {
    setEditingGeofence(gf);
    if (currentOverlayRef.current) currentOverlayRef.current.setMap(null);
    drawingModeRef.current = null;
    setActiveMode(null);
    
    // Le damos un respiro al navegador para que alcance a pintar el cambio de estado (abrir el panel de edición)
    // antes de atorarse parseando un polígono gigante
    setTimeout(() => {
      const parsed = parseWkt(gf.area);
      if (!parsed || !googleMapRef.current) return;
      
      const commonOpts = { map: googleMapRef.current, editable: true, draggable: true, fillColor: '#3b82f6', fillOpacity: 0.3, strokeColor: '#2563eb', strokeWeight: 2 };
      
      let shape;
      let bounds = new window.google.maps.LatLngBounds();
      
      if (parsed.type === 'circle') {
        shape = new window.google.maps.Circle({ ...commonOpts, center: { lat: parsed.lat, lng: parsed.lng }, radius: parsed.radius });
        bounds = shape.getBounds();
      } else if (parsed.type === 'polygon') {
        shape = new window.google.maps.Polygon({ ...commonOpts, paths: parsed.path });
        parsed.path.forEach(p => bounds.extend(p));
      } else if (parsed.type === 'polyline') {
        shape = new window.google.maps.Polyline({ ...commonOpts, path: parsed.path, fillOpacity: 0 });
        parsed.path.forEach(p => bounds.extend(p));
      }
      
      currentOverlayRef.current = shape;
      if (bounds && !bounds.isEmpty()) googleMapRef.current.fitBounds(bounds);
    }, 10);
  };

  const handleDelete = async (id: number) => {
    setConfirmDeleteId(id);
  };

  const executeDelete = async (id: number) => {
    try {
      const res = await fetch(`${BASE_URL}/geofences/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      dataCache.invalidatePrefix('/api/geofences');
      refetch();
      if (editingGeofence?.id === id) cancelEdit();
    } catch (e: any) {
      toast.error(`Error al eliminar: ${e.message}`);
    }
  };

  const cancelEdit = () => {
    setEditingGeofence(null);
    if (currentOverlayRef.current) currentOverlayRef.current.setMap(null);
    currentOverlayRef.current = null;
    drawingModeRef.current = null;
    setActiveMode(null);
  };

  const buildWktFromOverlay = (overlay: any): string => {
    if (overlay instanceof window.google.maps.Circle) {
      const center = overlay.getCenter();
      return `CIRCLE (${center.lat()} ${center.lng()}, ${Math.round(overlay.getRadius())})`;
    }
    if (overlay instanceof window.google.maps.Polygon) {
      const path = overlay.getPath();
      const points: string[] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        points.push(`${p.lat()} ${p.lng()}`);
      }
      // Cerrar polígono
      if (points.length > 0) points.push(points[0]);
      return `POLYGON ((${points.join(', ')}))`;
    }
    if (overlay instanceof window.google.maps.Polyline) {
      const path = overlay.getPath();
      const points: string[] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        points.push(`${p.lat()} ${p.lng()}`);
      }
      return `LINESTRING (${points.join(', ')})`;
    }
    return '';
  };

  const handleSave = async () => {
    if (!editingGeofence?.name?.trim()) return toast.error('Ponle un nombre a la geocerca');
    if (!currentOverlayRef.current) return toast.error('Dibuja la geocerca en el mapa primero');
    
    const wkt = buildWktFromOverlay(currentOverlayRef.current);
    if (!wkt) return;
    
    setSaving(true);
    try {
      const payload = { ...editingGeofence, area: wkt };
      const method = payload.id ? 'PUT' : 'POST';
      const path = payload.id ? `/geofences/${payload.id}` : '/geofences';
      
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      
      dataCache.invalidatePrefix('/api/geofences');
      refetch();
      cancelEdit();
    } catch (e: any) {
      setSaveError(e.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 fade-in flex flex-col gap-4 pb-32 md:pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Geocercas</h1>
          <p className="text-sm text-gray-500 mt-1">Delimita zonas de operación y recibe alertas.</p>
        </div>
        {!editingGeofence && !isReadonly && (
          <button onClick={() => setEditingGeofence({ name: '', description: '' })}
            className="btn-primary">
            <Plus size={16} /> Nueva Geocerca
          </button>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        
        {/* Panel lateral: Lista o Formulario */}
        <div className="w-full lg:w-80 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col h-auto max-h-[50vh] lg:max-h-none lg:h-full shrink-0 overflow-hidden">
          {editingGeofence ? (
            <div className="p-4 lg:p-5 flex flex-col gap-3 lg:gap-4 h-full overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-gray-900">{editingGeofence.id ? 'Editar' : 'Nueva'} Geocerca</h2>
                <button onClick={cancelEdit} className="p-1 hover:bg-gray-100 rounded text-gray-400">
                  <X size={16} />
                </button>
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
                <input value={editingGeofence.name || ''} onChange={e => setEditingGeofence(p => ({ ...p!, name: e.target.value }))}
                  placeholder="Ej: Base Centro"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
                <input value={editingGeofence.description || ''} onChange={e => setEditingGeofence(p => ({ ...p!, description: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {!currentOverlayRef.current && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mt-2">
                  <p className="text-xs text-blue-700 font-medium mb-3">Elige una forma y dibuja en el mapa:</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => startDrawing('polygon')} className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition ${activeMode === 'polygon' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-blue-200 hover:border-blue-400 text-blue-600'}`}>
                      <Hexagon size={18} />
                      <span className="text-[10px] font-bold">Polígono</span>
                    </button>
                    <button onClick={() => startDrawing('circle')} className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition ${activeMode === 'circle' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-blue-200 hover:border-blue-400 text-blue-600'}`}>
                      <CircleIcon size={18} />
                      <span className="text-[10px] font-bold">Círculo</span>
                    </button>
                    <button onClick={() => startDrawing('polyline')} className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition ${activeMode === 'polyline' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-blue-200 hover:border-blue-400 text-blue-600'}`}>
                      <GitCommit size={18} />
                      <span className="text-[10px] font-bold">Ruta</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-auto pt-4 flex gap-2">
                <button onClick={cancelEdit} className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50">Cancelar</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  <Save size={16} /> Guardar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-100 bg-gray-50">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <MapIcon size={16} className="text-blue-600" />
                  Zonas ({geofences.length})
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {loading ? (
                  <p className="text-xs text-center text-gray-400 p-4">Cargando...</p>
                ) : geofences.length === 0 ? (
                  <p className="text-xs text-center text-gray-400 p-8">No hay geocercas creadas.</p>
                ) : (
                  geofences.map(gf => (
                    <div key={gf.id} className="p-3 border-b border-gray-50 hover:bg-gray-50 flex items-center justify-between group transition">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{gf.name}</p>
                        <p className="text-xs text-gray-400">{gf.area.split(' ')[0]}</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                        {!isReadonly && (
                          <>
                            <button onClick={() => handleEditGeofence(gf)} className="p-1.5 hover:bg-blue-100 text-blue-600 rounded-md"><Edit2 size={14} /></button>
                            <button onClick={() => gf.id && handleDelete(gf.id)} className="p-1.5 hover:bg-red-100 text-red-600 rounded-md"><Trash2 size={14} /></button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Mapa */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden relative min-h-[350px] lg:min-h-0">
          {!mapsLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 text-gray-400 text-sm">
              Cargando editor de mapas...
            </div>
          )}
          <div ref={mapRef} className="w-full h-full" />
        </div>
      </div>

      {/* Modal para confirmar antes de eliminar */}
      {confirmDeleteId !== null && (
        <ConfirmDialog
          title="Eliminar geocerca"
          message="¿Estás seguro de que quieres eliminar esta geocerca? Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={() => {
            executeDelete(confirmDeleteId);
            setConfirmDeleteId(null);
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {/* Aviso si algo falla al guardar */}
      {saveError && (
        <ConfirmDialog
          title="Error al guardar"
          message={saveError}
          confirmLabel="Entendido"
          confirmClass="bg-gray-700 hover:bg-gray-800 text-white"
          onConfirm={() => setSaveError(null)}
          onCancel={() => setSaveError(null)}
        />
      )}
    </div>
  );
}
