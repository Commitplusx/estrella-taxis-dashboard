/**
 * calculate-driving-scores
 * 
 * Edge Function que calcula el score de manejo del día para todos los
 * vehículos de la flota usando la API de Traccar.
 * 
 * Puede llamarse:
 *   - Manualmente: POST /functions/v1/calculate-driving-scores
 *   - Con cron: configurado en supabase/config.toml (cada noche a las 23:45)
 *   - Con parámetro de fecha: { "date": "2026-08-31" }
 *   - Solo un vehículo: { "deviceId": 5 }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Configuración ────────────────────────────────────────────────────────────

const TRACCAR_BASE = 'https://taxis.estrella-eats.mx/api';
const TRACCAR_EMAIL = Deno.env.get('TRACCAR_EMAIL')!;
const TRACCAR_PASSWORD = Deno.env.get('TRACCAR_PASSWORD')!;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Umbrales del algoritmo ───────────────────────────────────────────────────

const OVERSPEED_KMH        = 90.0;   // Límite de velocidad
const IDLE_SPEED_KMH       = 3.0;    // Considera "detenido"
const IDLE_GRACE_MIN       = 3;      // Minutos de gracia antes de penalizar ralentí
const HARSH_BRAKE_RATE     = -9.0;   // km/h·s (≈ 2.5 m/s²)
const HARSH_ACCEL_RATE     = 6.0;    // km/h·s (≈ 1.7 m/s²)
const EVENT_GAP_MIN_SEC    = 2;      // Ventana mínima para detectar eventos
const EVENT_GAP_MAX_SEC    = 15;     // Ventana máxima para detectar eventos
const MAX_GAP_SEC          = 300;    // Gap > 5 min → omitir par
const COOLDOWN_SEC         = 15;     // Anti-duplicado por tipo de evento

// Penalizaciones
const PEN_HARSH_BRAKE      = 5;
const PEN_HARSH_ACCEL      = 4;
const PEN_OVERSPEED        = 3;
const PEN_IDLE_PER_5MIN    = 1;
const MIN_POSITIONS        = 8;

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Position {
  time: Date;
  lat: number;
  lon: number;
  speedKmh: number;
  ignition: boolean | null;
}

interface ScoreResult {
  deviceId: number;
  deviceName: string;
  scoreDate: string;     // 'YYYY-MM-DD'
  score: number;
  scoreLabel: string;
  harshBraking: number;
  harshAcceleration: number;
  overspeedEvents: number;
  idleMinutes: number;
  distanceKm: number;
  durationMinutes: number;
  maxSpeedKmh: number;
  positionsAnalyzed: number;
}

// ─── Traccar API ──────────────────────────────────────────────────────────────

async function traccarLogin(): Promise<string> {
  const res = await fetch(`${TRACCAR_BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(TRACCAR_EMAIL)}&password=${encodeURIComponent(TRACCAR_PASSWORD)}`,
  });
  if (!res.ok) throw new Error(`Traccar login failed: ${res.status}`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('No session cookie from Traccar');
  return cookie;
}

async function traccarGet<T>(cookie: string, path: string): Promise<T[]> {
  const res = await fetch(`${TRACCAR_BASE}${path}`, {
    headers: { Cookie: cookie, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.warn(`Traccar GET ${path} → ${res.status}`);
    return [];
  }
  return res.json();
}

interface RawTraccarDevice {
  id: number;
  name?: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidCoord(lat: number, lon: number): boolean {
  return !(lat === 0 && lon === 0) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function scoreLabel(score: number): string {
  if (score >= 85) return 'Excelente';
  if (score >= 70) return 'Bueno';
  if (score >= 50) return 'Regular';
  return 'Deficiente';
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// Chiapas es UTC-6 todo el año (desde 2022 no usa horario de verano)
// Convierte una fecha UTC a la hora local de Chiapas para mostrarla
const CHIAPAS_OFFSET_HOURS = -6;

function toLocalTimeStr(utcDate: Date): string {
  // CHIAPAS_OFFSET_HOURS = -6 → restar -6h (= sumar 6h) a UTC para obtener hora local
  const adjusted = new Date(utcDate.getTime() - CHIAPAS_OFFSET_HOURS * 3600 * 1000);
  const hh = adjusted.getUTCHours().toString().padStart(2, '0');
  const mm = adjusted.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// Construye el rango UTC correcto para un día completo en Chiapas (UTC-6).
// Ej: 2026-08-30 local → from: 2026-08-30T06:00:00Z, to: 2026-08-31T05:59:59Z
function chiapasDateRange(dateStr: string): { from: string; to: string } {
  // Medianoche local Chiapas = 06:00 UTC
  const from = `${dateStr}T06:00:00.000Z`;
  // Fin del día local (23:59:59 Chiapas) = siguiente día 05:59:59 UTC
  const startMs = new Date(`${dateStr}T06:00:00.000Z`).getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1000; // +24h - 1s
  const to = new Date(endMs).toISOString();
  return { from, to };
}

// ─── Parsing de posiciones ────────────────────────────────────────────────────

interface RawTraccarPosition {
  fixTime?: string;
  deviceTime?: string;
  serverTime?: string;
  latitude: number | string;
  longitude: number | string;
  speed?: number | string;
  attributes?: {
    ignition?: boolean;
    [key: string]: unknown;
  };
}

function parsePositions(raw: RawTraccarPosition[]): Position[] {
  const list: Position[] = [];

  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;

    const timeStr = p.fixTime ?? p.deviceTime ?? p.serverTime;
    if (!timeStr) continue;
    const time = new Date(timeStr);
    if (isNaN(time.getTime())) continue;

    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    if (isNaN(lat) || isNaN(lon) || !isValidCoord(lat, lon)) continue;

    const speedKmh = (Number(p.speed) || 0) * 1.852;

    let ignition: boolean | null = null;
    if (p.attributes && typeof p.attributes.ignition === 'boolean') {
      ignition = p.attributes.ignition;
    }

    list.push({ time, lat, lon, speedKmh, ignition });
  }

  // Ordenar y deduplicar por timestamp
  list.sort((a, b) => a.time.getTime() - b.time.getTime());

  const deduped: Position[] = [];
  let lastTs = -1;
  for (const pos of list) {
    const ts = pos.time.getTime();
    if (ts !== lastTs) {
      deduped.push(pos);
      lastTs = ts;
    }
  }

  return deduped;
}

// ─── Algoritmo principal ──────────────────────────────────────────────────────

function analyzeRoute(
  positions: Position[],
  deviceId: number,
  deviceName: string,
  scoreDate: string,
): ScoreResult {
  let harshBraking       = 0;
  let harshAcceleration  = 0;
  let overspeedEvents    = 0;
  let distanceKm         = 0;
  let maxSpeedKmh        = 0;
  let totalIdleMinutes   = 0;

  let lastBrakeMs: number | null = null;
  let lastAccelMs: number | null = null;
  let inOverspeed = false;

  // Estado ralentí
  let idleStartMs: number | null = null;
  let idlePenaltyStarted = false;

  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    const gapSec = (curr.time.getTime() - prev.time.getTime()) / 1000;

    // Distancia siempre
    distanceKm += haversineKm(prev.lat, prev.lon, curr.lat, curr.lon);
    if (curr.speedKmh > maxSpeedKmh) maxSpeedKmh = curr.speedKmh;

    // Gaps fuera de rango: resetear estado
    if (gapSec <= 0 || gapSec > MAX_GAP_SEC) {
      idleStartMs = null;
      idlePenaltyStarted = false;
      inOverspeed = false;
      continue;
    }

    // ── Frenada y aceleración brusca (solo en ventana 2–15s) ──────────────
    if (gapSec >= EVENT_GAP_MIN_SEC && gapSec <= EVENT_GAP_MAX_SEC) {
      const rate = (curr.speedKmh - prev.speedKmh) / gapSec;

      if (rate <= HARSH_BRAKE_RATE) {
        const coolOk = lastBrakeMs === null ||
          (curr.time.getTime() - lastBrakeMs) / 1000 > COOLDOWN_SEC;
        if (coolOk) { harshBraking++; lastBrakeMs = curr.time.getTime(); }
      }

      if (rate >= HARSH_ACCEL_RATE) {
        const coolOk = lastAccelMs === null ||
          (curr.time.getTime() - lastAccelMs) / 1000 > COOLDOWN_SEC;
        if (coolOk) { harshAcceleration++; lastAccelMs = curr.time.getTime(); }
      }
    }

    // ── Exceso de velocidad (contar solo entrada) ──────────────────────────
    const nowOver = curr.speedKmh > OVERSPEED_KMH;
    if (nowOver && !inOverspeed) overspeedEvents++;
    inOverspeed = nowOver;

    // ── Ralentí excesivo ───────────────────────────────────────────────────
    const isIdle = curr.speedKmh < IDLE_SPEED_KMH &&
      (curr.ignition === true || curr.ignition === null);

    if (isIdle) {
      if (idleStartMs === null) {
        idleStartMs = curr.time.getTime();
      } else {
        const graceMin = curr.ignition === true ? IDLE_GRACE_MIN : IDLE_GRACE_MIN * 3;
        const elapsedMin = (curr.time.getTime() - idleStartMs) / 60000;

        if (!idlePenaltyStarted && elapsedMin > graceMin) {
          totalIdleMinutes += elapsedMin - graceMin;
          idlePenaltyStarted = true;
        } else if (idlePenaltyStarted) {
          totalIdleMinutes += gapSec / 60;
        }
      }
    } else {
      idleStartMs = null;
      idlePenaltyStarted = false;
    }
  }

  // Duración total
  const durationMinutes =
    (positions[positions.length - 1].time.getTime() - positions[0].time.getTime()) / 60000;

  // Score
  let score = 100;
  score -= harshBraking     * PEN_HARSH_BRAKE;
  score -= harshAcceleration * PEN_HARSH_ACCEL;
  score -= overspeedEvents   * PEN_OVERSPEED;
  score -= Math.floor(totalIdleMinutes / 5) * PEN_IDLE_PER_5MIN;
  score = Math.max(0, Math.min(100, score));

  return {
    deviceId,
    deviceName,
    scoreDate,
    score,
    scoreLabel: scoreLabel(score),
    harshBraking,
    harshAcceleration,
    overspeedEvents,
    idleMinutes: totalIdleMinutes,
    distanceKm,
    durationMinutes,
    maxSpeedKmh,
    positionsAnalyzed: positions.length,
  };
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Parámetros opcionales del body
    // Cuando se llama por cron (sin parámetros), calcular para AYER en Chiapas.
    // El cron corre a las 06:05 UTC = 00:05 Chiapas, el día local ya terminó.
    let targetDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // ayer UTC
    let filterDeviceId: number | null = null;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (body?.date) targetDate = new Date(body.date); // fecha manual override
        if (body?.deviceId) filterDeviceId = Number(body.deviceId);
      } catch (_) { /* body vacío (llamada de cron) — OK */ }
    }

    const dateStr = toDateStr(targetDate);
    const { from, to } = chiapasDateRange(dateStr);
    console.log(`🕐 Rango UTC: ${from} → ${to} (Chiapas UTC-6)`);

    console.log(`🚀 Calculando scores para ${dateStr}...`);

    // Login en Traccar
    const cookie = await traccarLogin();

    // Obtener todos los dispositivos
    const devicesRaw = await traccarGet<RawTraccarDevice>(cookie, '/devices');
    let devices = filterDeviceId
      ? devicesRaw.filter((d) => d.id === filterDeviceId)
      : devicesRaw;

    // ── Feature flag: solo calcular para empresas con score_diario activo ──────
    // Si se llama con deviceId específico (manual/debug), saltarse el filtro.
    if (!filterDeviceId) {
      // 1. Obtener todas las empresas con score_diario: true en su paquete
      const { data: empresasPermitidas, error: permErr } = await supabase
        .from('empresas')
        .select(`
          id,
          traccar_device_ids,
          paquete:paquetes!inner(permisos_sistema)
        `)
        .eq('activo', true);

      if (permErr) {
        console.warn('⚠️  No se pudo leer permisos_sistema, calculando para todos:', permErr.message);
      } else {
        // 2. Construir el set de device IDs permitidos
        const allowedDeviceIds = new Set<number>();
        for (const emp of (empresasPermitidas ?? [])) {
          let permisos: Record<string, boolean> = {};
          
          if (Array.isArray(emp.paquete) && emp.paquete.length > 0) {
            const firstPaquete = emp.paquete[0] as Record<string, unknown>;
            if (firstPaquete && typeof firstPaquete === 'object') {
              permisos = (firstPaquete.permisos_sistema as Record<string, boolean>) ?? {};
            }
          } else if (emp.paquete && typeof emp.paquete === 'object' && !Array.isArray(emp.paquete)) {
             permisos = ((emp.paquete as Record<string, unknown>).permisos_sistema as Record<string, boolean>) ?? {};
          }

          if (!permisos.score_diario) continue;
          
          const ids: number[] = (emp.traccar_device_ids as number[]) ?? [];
          for (const id of ids) allowedDeviceIds.add(id);
        }

        const totalBefore = devices.length;
        devices = devices.filter((d) => allowedDeviceIds.has(d.id));
        console.log(`🔑 Feature flag score_diario: ${devices.length}/${totalBefore} vehículos permitidos`);
      }
    }

    console.log(`📡 Procesando ${devices.length} vehículo(s)`);


    const results: ScoreResult[] = [];
    const errors: string[] = [];

    for (const device of devices) {
      const deviceId   = device.id;
      const deviceName = device.name ?? `Vehículo ${deviceId}`;

      try {
        const rawRoute = await traccarGet<RawTraccarPosition>(
          cookie,
          `/reports/route?deviceId=${deviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        );

        const positions = parsePositions(rawRoute);
        if (positions.length < MIN_POSITIONS) {
          console.log(`⚠️  ${deviceName}: solo ${positions.length} posiciones, omitido`);
          continue;
        }

        const score = analyzeRoute(positions, deviceId, deviceName, dateStr);
        results.push(score);
        console.log(`✅ ${deviceName}: score=${score.score} (${score.scoreLabel})`);
      } catch (err: unknown) {
        const msg = `❌ ${deviceName}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    // Upsert masivo en Supabase
    if (results.length > 0) {
      const rows = results.map((r) => ({
        device_id:           r.deviceId,
        device_name:         r.deviceName,
        score_date:          r.scoreDate,
        score:               r.score,
        score_label:         r.scoreLabel,
        harsh_braking:       r.harshBraking,
        harsh_acceleration:  r.harshAcceleration,
        overspeed_events:    r.overspeedEvents,
        idle_minutes:        r.idleMinutes,
        distance_km:         r.distanceKm,
        duration_minutes:    r.durationMinutes,
        max_speed_kmh:       r.maxSpeedKmh,
        positions_analyzed:  r.positionsAnalyzed,
      }));

      const { error: upsertError } = await supabase
        .from('driving_scores')
        .upsert(rows, { onConflict: 'device_id,score_date' });

      if (upsertError) {
        console.error('Supabase upsert error:', upsertError);
        errors.push(`Supabase: ${upsertError.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        date:     dateStr,
        computed: results.length,
        errors:   errors.length,
        results:  results.map((r) => ({ device: r.deviceName, score: r.score, label: r.scoreLabel })),
        errorList: errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Fatal error:', errMsg);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error', details: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
