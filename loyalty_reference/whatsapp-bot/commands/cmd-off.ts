import { CommandContext } from './command-router.ts'
import { sendWA } from '../whatsapp.ts'
import { extract10Digits } from '../db.ts'

export async function handleOffCommand(ctx: CommandContext): Promise<Response | null> {
  const { supabase, fromPhone, from10, slashText, esAdmin } = ctx

  const args = slashText.split(/\s+/)
  let target10 = from10
  let isTargetingAnother = false

  // Si es admin y manda un número (ej. /off 9631234567)
  if (esAdmin && args[1]) {
    const extracted = extract10Digits(args[1])
    if (extracted) {
      target10 = extracted
      isTargetingAnother = true
    }
  }

  // Eliminar el estado del agente de mandadito
  await supabase.from('bot_memory').delete().eq('phone', `mandadito_agent_${target10}`)
  
  // Limpiar otros estados por si acaso
  await supabase.from('bot_memory').delete().eq('phone', `state_${target10}`)
  await supabase.from('bot_memory').delete().eq('phone', `reg_rest_${target10}`)

  // Si el admin lo está apagando para un cliente, también lo ponemos en PAUSA global
  if (isTargetingAnother) {
    await supabase.from('bot_memory').upsert({
      phone: `bot_pausa_${target10}`,
      history: [{ paused_by: from10, ts: Date.now() }],
      updated_at: new Date().toISOString()
    })
    await sendWA(fromPhone, `🔌 *Agente apagado para el número ${target10}*.\n\nEl bot guardará silencio en ese chat para que puedas tomar el control manual.`)
  } else {
    await sendWA(fromPhone, `🔌 *Agente apagado / reiniciado*.\n\nMemoria borrada con éxito. Puedes iniciar de nuevo diciendo "Hola".`)
  }
  
  return new Response('OK', { status: 200 })
}
