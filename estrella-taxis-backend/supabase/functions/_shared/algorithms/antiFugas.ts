import { z } from "npm:zod";

/**
 * Módulo Anti-Fugas (Detección de Viajes Fantasma)
 * 
 * Nivel Enterprise (Ultra-Robusto):
 * - Zod Validation para asegurar inputs en runtime (evita basura de BD).
 * - Safe Math (evita problemas de precisión de flotantes en TS).
 */

const AntiFugasInputSchema = z.object({
  deviceId: z.number().int().positive(),
  dateStr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato debe ser YYYY-MM-DD"),
  traccarDistanceKm: z.number().min(0),
  assignedDistanceKm: z.number().min(0),
  toleranceKm: z.number().min(0).default(15)
});

export type AntiFugasInput = z.infer<typeof AntiFugasInputSchema>;

export interface GhostTripAlert {
  deviceId: number;
  dateStr: string;
  traccarDistanceKm: number;
  assignedDistanceKm: number;
  unassignedDistanceKm: number;
  hasLeak: boolean;
  leakPercentage: number;
}

export type Result<T> = { success: true; data: T } | { success: false; error: string; issues?: z.ZodIssue[] };

function safeSubtract(a: number, b: number): number {
  return Number((a - b).toFixed(3));
}

export function detectGhostTrips(input: unknown): Result<GhostTripAlert> {
  const parseResult = AntiFugasInputSchema.safeParse(input);
  
  if (!parseResult.success) {
    return { 
      success: false, 
      error: "Inputs inválidos provistos al algoritmo Anti-Fugas.",
      issues: parseResult.error.issues 
    };
  }

  const { deviceId, dateStr, traccarDistanceKm, assignedDistanceKm, toleranceKm } = parseResult.data;

  let unassignedDistanceKm = safeSubtract(traccarDistanceKm, assignedDistanceKm);
  
  if (unassignedDistanceKm < 0) {
    unassignedDistanceKm = 0;
  }

  const hasLeak = unassignedDistanceKm > toleranceKm;
  
  let leakPercentage = 0;
  if (traccarDistanceKm > 0) {
    leakPercentage = (unassignedDistanceKm / traccarDistanceKm) * 100;
  } else if (unassignedDistanceKm > 0) {
    leakPercentage = 100; 
  }

  return {
    success: true,
    data: {
      deviceId,
      dateStr,
      traccarDistanceKm: Number(traccarDistanceKm.toFixed(3)),
      assignedDistanceKm: Number(assignedDistanceKm.toFixed(3)),
      unassignedDistanceKm,
      hasLeak,
      leakPercentage: Number(leakPercentage.toFixed(2)) 
    }
  };
}
