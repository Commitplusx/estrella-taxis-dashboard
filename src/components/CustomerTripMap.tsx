import { useEffect, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { PublicTaxiTracking } from "../lib/taxiTrackingContracts";
import "leaflet/dist/leaflet.css";
function View(
  { snapshot, follow, focus, onDrag }: {
    snapshot: PublicTaxiTracking;
    follow: boolean;
    focus: number;
    onDrag: () => void;
  },
) {
  const map = useMap(), fitted = useRef(false);
  const taxi = snapshot.taxi,
    { origen_lat: lat, origen_lng: lng } = snapshot.viaje;
  useMapEvents({ dragstart: onDrag });
  useEffect(() => {
    const points: [number, number][] = [];
    if (lat !== null && lng !== null) points.push([lat, lng]);
    if (taxi) points.push([taxi.lat, taxi.lng]);
    if (!fitted.current && points.length) {
      map.fitBounds(points, { padding: [45, 45], maxZoom: 16 });
      fitted.current = true;
    } else if (follow && taxi) {
      map.panTo([taxi.lat, taxi.lng], { animate: false });
    }
  }, [map, taxi, lat, lng, follow, focus]);
  return null;
}
export default function CustomerTripMap(
  { snapshot, follow, focus, onDrag, onTileError }: {
    snapshot: PublicTaxiTracking;
    follow: boolean;
    focus: number;
    onDrag: () => void;
    onTileError: (error: boolean) => void;
  },
) {
  const { taxi, viaje } = snapshot;
  return (
    <MapContainer
      center={[viaje.origen_lat ?? 16.25, viaje.origen_lng ?? -92.13]}
      zoom={16}
      scrollWheelZoom={false}
      className="customer-trip-map"
      aria-label="Mapa de tu taxi en OpenStreetMap"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        referrerPolicy="strict-origin"
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
        eventHandlers={{ tileerror: () => onTileError(true) }}
      />
      <View snapshot={snapshot} follow={follow} focus={focus} onDrag={onDrag} />
      {viaje.origen_lat !== null && viaje.origen_lng !== null && (
        <CircleMarker
          center={[viaje.origen_lat, viaje.origen_lng]}
          radius={9}
          pathOptions={{
            color: "#fff",
            weight: 3,
            fillColor: "#167347",
            fillOpacity: 1,
          }}
        >
          <Tooltip permanent direction="bottom">Pasamos por ti aquí</Tooltip>
        </CircleMarker>
      )}
      {taxi && (
        <CircleMarker
          center={[taxi.lat, taxi.lng]}
          radius={13}
          pathOptions={{
            color: "#fff",
            weight: 3,
            fillColor: "#1d4ed8",
            fillOpacity: 1,
          }}
        >
          <Tooltip permanent direction="top">
            {viaje.unitLabel ?? "Tu taxi"}
          </Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
