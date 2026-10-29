import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  cellToBoundary,
  cellToLatLng,
  latLngToCell,
  polygonToCells,
} from "h3-js";
import { Check, Crosshair, Hexagon, Maximize2, X, ZoomIn } from "lucide-react";
import { zoneColor } from "../lib/taxiZoneColors";
import { openStreetMapLayer } from "../lib/openStreetMap";
import type { AdminZone } from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";
import "leaflet/dist/leaflet.css";
export type MapTool = "select" | "area" | "origin" | "destination";
export interface MapPoint {
  lat: number;
  lng: number;
}
interface Props {
  channelKey: string;
  focusCell: string | null;
  center: MapPoint;
  zones: AdminZone[];
  zoneColors: ReadonlyMap<string, string>;
  selected: string[];
  tool: MapTool;
  origin: MapPoint | null;
  destination: MapPoint | null;
  onSelect: (cells: string[]) => void;
  onPoint: (point: MapPoint) => void;
  disabled: boolean;
}
export function boundedCells(points: number[][], max = 400): string[] {
  if (points.length < 3) return [];
  const lats = points.map((p) => p[0]), lngs = points.map((p) => p[1]);
  if (
    (Math.max(...lats) - Math.min(...lats)) *
        (Math.max(...lngs) - Math.min(...lngs)) > .004
  ) throw new Error("Marca un área más pequeña para editarla de una vez.");
  const result = polygonToCells(points, 10);
  if (result.length > max) {
    throw new Error(
      "El área tiene más de " + max + " celdas. Divide la zona en partes.",
    );
  }
  return result;
}
export default function TaxiZoneMap(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layer = useRef<L.LayerGroup | null>(null),
    pointsLayer = useRef<L.LayerGroup | null>(null),
    latest = useRef(props);
  latest.current = props;
  const [hint, setHint] = useState(
      "Acércate para seleccionar una zona; al alejarte se conserva toda la cobertura.",
    ),
    [drawing, setDrawing] = useState<MapPoint[]>([]),
    [tileError, setTileError] = useState(false);
  const drawingRef = useRef<MapPoint[]>([]);
  const fitted = useRef(false);
  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, {
      center: [props.center.lat, props.center.lng],
      zoom: 16,
      zoomControl: false,
      preferCanvas: true,
      trackResize: false,
    });
    map.current = m;
    fitted.current = false;
    let logicalCenter = m.getCenter();
    m.on("moveend", () => {
      logicalCenter = m.getCenter();
    });
    L.control.zoom({ position: "bottomright" }).addTo(m);
    openStreetMapLayer(setTileError).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    pointsLayer.current = L.layerGroup().addTo(m);
    m.on("click", (event: L.LeafletMouseEvent) => {
      const p = latest.current;
      if (p.disabled) return;
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      if (p.tool === "area") {
        const next = [...drawingRef.current, point];
        drawingRef.current = next;
        setDrawing(next);
      } else if (p.tool === "select") {
        const cell = latLngToCell(point.lat, point.lng, 10);
        p.onSelect(
          p.selected.includes(cell)
            ? p.selected.filter((c) => c !== cell)
            : [...p.selected, cell],
        );
      } else p.onPoint(point);
    });
    const resize = new ResizeObserver(() => {
      const center = logicalCenter;
      m.invalidateSize({ pan: false });
      m.setView(center, m.getZoom(), { animate: false });
    });
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, [props.channelKey]);
  const showCoverage = useCallback(() => {
    if (!map.current || !props.zones.length) return;
    const bounds = L.latLngBounds(props.zones.flatMap((z) =>
      cellToBoundary(z.cell).map((p): L.LatLngTuple => [p[0], p[1]])));
    map.current.fitBounds(bounds, { padding: [28, 70], maxZoom: 15, animate: false });
  }, [props.zones]);
  useEffect(() => {
    if (!fitted.current && props.zones.length && map.current) {
      showCoverage();
      fitted.current = true;
    }
  }, [showCoverage, props.channelKey]);
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    const selected = new Set(props.selected),
      known = new Map(props.zones.map((z) => [z.cell, z]));
    for (const cell of new Set([...known.keys(), ...selected])) {
      const active = selected.has(cell),
        z = known.get(cell),
        color = z ? zoneColor(z.label, props.zoneColors) : "#64748b",
        points = cellToBoundary(cell).map((p): L.LatLngTuple => [p[0], p[1]]);
      const polygon = L.polygon(points, {
        interactive: false,
        color: active ? "#0f172a" : color,
        fillColor: color,
        fillOpacity: active ? 0.7 : z?.assigned ? 0.44 : 0.25,
        weight: active ? 3 : 1,
        dashArray: !active && !z?.assigned ? "4 3" : undefined,
      });
      if (z) {
        polygon.bindTooltip(
          z.label + " · " +
            (z.cents === null
              ? "Tarifa pendiente"
              : "$" + (z.cents / 100).toFixed(2)),
          { sticky: true },
        );
      }
      polygon.addTo(group);
    }
  }, [props.zones, props.selected, props.zoneColors, props.channelKey]);
  useEffect(() => {
    const group = pointsLayer.current;
    if (!group) return;
    group.clearLayers();
    const marker = (point: MapPoint, label: string, color: string) =>
      L.circleMarker([point.lat, point.lng], {
        radius: 9,
        color: "#fff",
        weight: 3,
        fillColor: color,
        fillOpacity: 1,
      }).bindTooltip(label, { permanent: true, direction: "top" }).addTo(group);
    if (props.origin) marker(props.origin, "Recogida", "#1d4ed8");
    if (props.destination) marker(props.destination, "Destino", "#9333ea");
    if (drawing.length) {
      L.polyline(drawing.map((p): L.LatLngTuple => [p.lat, p.lng]), {
        color: "#1d4ed8",
        dashArray: "6 6",
        interactive: false,
      }).addTo(group);
    }
  }, [props.origin, props.destination, drawing, props.channelKey]);
  useEffect(() => {
    drawingRef.current = [];
    setDrawing([]);
  }, [props.tool, props.channelKey]);
  useEffect(() => {
    map.current?.setView([props.center.lat, props.center.lng], 16, {
      animate: false,
    });
  }, [props.center.lat, props.center.lng]);
  useEffect(() => {
    if (props.focusCell) {
      map.current?.setView(cellToLatLng(props.focusCell), 16, {
        animate: false,
      });
    }
  }, [props.focusCell]);
  const finish = () => {
    try {
      const selected = boundedCells(drawing.map((p) => [p.lat, p.lng]));
      if (!selected.length) {
        throw new Error("El área es muy pequeña. Marca al menos una celda.");
      }
      props.onSelect(selected);
      drawingRef.current = [];
      setDrawing([]);
    } catch (error: unknown) {
      setHint(
        error instanceof Error
          ? error.message
          : "No pudimos seleccionar el área.",
      );
    }
  };
  const selectCenter = () => {
    const point = map.current?.getCenter();
    if (!point) return;
    if (props.tool === "origin" || props.tool === "destination") {
      props.onPoint({ lat: point.lat, lng: point.lng });
    } else {
      const cell = latLngToCell(point.lat, point.lng, 10);
      props.onSelect([...new Set([...props.selected, cell])]);
    }
  };
  return (
    <div className="taxi-map-wrap">
      <div
        ref={host}
        className="taxi-zone-map"
        role="region"
        aria-label="Mapa de zonas y tarifas de la base"
      />
      <div className="taxi-map-legend">
        <Hexagon size={16} />
        {props.tool === "area"
          ? "Marca los bordes del área"
          : props.tool === "origin"
          ? "Marca dónde empieza el viaje"
          : props.tool === "destination"
          ? "Marca a dónde va el pasajero"
          : "Toca una celda para seleccionarla"}
      </div>
      <button className="taxi-map-overview" onClick={showCoverage} disabled={!props.zones.length}>
        <Maximize2 size={17} />Ver toda la cobertura
      </button>
      <button
        className="taxi-map-center"
        onClick={selectCenter}
        disabled={props.disabled}
        title="Seleccionar el punto del centro del mapa"
      >
        <Crosshair size={19} />
        <span>Elegir centro</span>
      </button>
      {drawing.length > 0 && (
        <div className="taxi-drawing">
          <span>{drawing.length} puntos marcados</span>
          <button onClick={finish} disabled={drawing.length < 3}>
            <Check size={16} />Cerrar área
          </button>
          <button
            onClick={() => {
              drawingRef.current = [];
              setDrawing([]);
            }}
            aria-label="Cancelar área"
          >
            <X size={17} />
          </button>
        </div>
      )}
      <div className="taxi-coverage-key">
        <span>Cada color representa una zona</span>
        <span>Borde oscuro: selección</span>
        <span>Borde discontinuo: falta habilitar</span>
      </div>
      <p className="taxi-map-hint" role="status">
        <ZoomIn size={16} />
        {tileError
          ? "El fondo del mapa no cargó. Revisa la conexión; tus zonas siguen guardadas."
          : hint}
      </p>
    </div>
  );
}
export function zoneCenter(cell: string): MapPoint {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}
