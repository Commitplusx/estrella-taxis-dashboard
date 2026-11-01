import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { DriverTripView } from "../lib/driverTripClient";
import "leaflet/dist/leaflet.css";
function Bounds({ trip }: { trip: DriverTripView }) {
  const map = useMap(),
    { lat: originLat, lng: originLng } = trip.origin,
    { lat: destinationLat, lng: destinationLng } = trip.destination;
  useEffect(() => {
    const points: [number, number][] = [];
    if (originLat !== null && originLng !== null) {
      points.push([originLat, originLng]);
    }
    if (destinationLat !== null && destinationLng !== null) {
      points.push([destinationLat, destinationLng]);
    }
    if (points.length > 1) {
      map.fitBounds(points, { padding: [35, 35], maxZoom: 16 });
    } else if (points[0]) map.setView(points[0], 17);
  }, [map, originLat, originLng, destinationLat, destinationLng]);
  return null;
}
export default function DriverTripMap({ trip }: { trip: DriverTripView }) {
  if (trip.origin.lat === null || trip.origin.lng === null) return null;
  return (
    <MapContainer
      center={[trip.origin.lat, trip.origin.lng]}
      zoom={16}
      scrollWheelZoom={false}
      className="driver-trip-map"
      aria-label="Mapa del punto de recogida y destino"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        referrerPolicy="strict-origin"
      />
      <Bounds trip={trip} />
      <CircleMarker
        center={[trip.origin.lat, trip.origin.lng]}
        radius={12}
        pathOptions={{
          color: "#fff",
          weight: 3,
          fillColor: "#1d4ed8",
          fillOpacity: 1,
        }}
      >
        <Popup>Pasas por el pasajero aquí</Popup>
      </CircleMarker>
      {trip.destination.lat !== null && trip.destination.lng !== null && (
        <CircleMarker
          center={[trip.destination.lat, trip.destination.lng]}
          radius={10}
          pathOptions={{
            color: "#fff",
            weight: 3,
            fillColor: "#166534",
            fillOpacity: 1,
          }}
        >
          <Popup>Destino del pasajero</Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
