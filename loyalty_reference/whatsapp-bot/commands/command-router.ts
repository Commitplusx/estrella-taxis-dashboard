import { handleInfoCommand } from './cmd-info.ts'
import { handleScoreCommand } from './cmd-score.ts'
import { handleQrCommand } from './cmd-qr.ts'
import { handleSaldoCommand } from './cmd-saldo.ts'
import { handleModoCommand } from './cmd-modo.ts'
import { handleOffCommand } from './cmd-off.ts'

// Interfaz estándar para todos los comandos
export interface CommandContext {
  supabase: any;
  fromPhone: string;
  from10: string;
  slashText: string; // El texto completo, ej: "/info 123"
  args: string[];    // Argumentos separados por espacio, ej: ["123"]
  messageId: string;
  esAdmin: boolean;
}

export type CommandHandler = (ctx: CommandContext) => Promise<Response | null>;

// Registro centralizado de comandos migrados
const commandRegistry: Record<string, CommandHandler> = {
  '/info': handleInfoCommand,
  '/score': handleScoreCommand,
  '/qr': handleQrCommand,
  '/saldo': handleSaldoCommand,
  '/modo': handleModoCommand,
  '/off': handleOffCommand,
  '/reset': handleOffCommand,
}

export async function routeCommand(ctx: CommandContext): Promise<Response | null> {
  const baseCmd = ctx.slashText.split(' ')[0].toLowerCase()
  
  // Buscar en el registro
  const handler = commandRegistry[baseCmd]
  if (handler) {
    return await handler(ctx)
  }
  
  // Si no está migrado, retorna null para que el handler antiguo lo procese
  return null
}
