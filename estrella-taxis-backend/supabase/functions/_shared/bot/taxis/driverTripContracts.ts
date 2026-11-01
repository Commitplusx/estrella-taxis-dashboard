import { record } from "../../tracking/contracts.ts";
export const DRIVER_TRIP_TOKEN = /^[a-f0-9]{64}$/;
export type DriverTripAction = "arrive" | "finish";
export type DriverTripStatus =
  | "en_camino"
  | "completado"
  | "cancelado"
  | "cancelado_timeout";
export type ArrivalNotice =
  | "pending"
  | "sending"
  | "uncertain"
  | "accepted"
  | "delivered"
  | "read"
  | "failed"
  | null;
export interface DriverTripPoint {
  text: string;
  lat: number | null;
  lng: number | null;
}
export interface DriverTripView {
  id: string;
  status: DriverTripStatus;
  passenger: string;
  unit: string;
  origin: DriverTripPoint;
  destination: DriverTripPoint;
  arrivedAt: string | null;
  paused: boolean;
  canArrive: boolean;
  canFinish: boolean;
  arrivalNotice: ArrivalNotice;
}
const validText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
function point(v: unknown): DriverTripPoint {
  if (
    !record(v) || !validText(v.text, 500) ||
    !(v.lat === null && v.lng === null ||
      typeof v.lat === "number" && Number.isFinite(v.lat) &&
        Math.abs(v.lat) <= 90 && typeof v.lng === "number" &&
        Number.isFinite(v.lng) && Math.abs(v.lng) <= 180)
  ) throw new TypeError("Invalid driver trip point");
  return { text: v.text, lat: v.lat, lng: v.lng };
}
export function parseDriverTrip(v: unknown): DriverTripView {
  if (
    !record(v) || !validText(v.id, 36) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      v.id,
    ) ||
    !["en_camino", "completado", "cancelado", "cancelado_timeout"].includes(
      String(v.status),
    ) || !validText(v.passenger, 120) || !validText(v.unit, 120) ||
    typeof v.paused !== "boolean" || typeof v.canArrive !== "boolean" ||
    typeof v.canFinish !== "boolean" ||
    !(v.arrivedAt === null ||
      typeof v.arrivedAt === "string" &&
        Number.isFinite(Date.parse(v.arrivedAt))) ||
    !(v.arrivalNotice === null ||
      [
        "pending",
        "sending",
        "uncertain",
        "accepted",
        "delivered",
        "read",
        "failed",
      ].includes(String(v.arrivalNotice)))
  ) throw new TypeError("Invalid driver trip");
  if (
    (v.status !== "en_camino" || v.paused) && (v.canArrive || v.canFinish) ||
    v.arrivedAt !== null && v.canArrive
  ) throw new TypeError("Invalid driver actions");
  return {
    id: v.id,
    status: v.status as DriverTripStatus,
    passenger: v.passenger,
    unit: v.unit,
    origin: point(v.origin),
    destination: point(v.destination),
    arrivedAt: v.arrivedAt,
    paused: v.paused,
    canArrive: v.canArrive,
    canFinish: v.canFinish,
    arrivalNotice: v.arrivalNotice as ArrivalNotice,
  };
}
