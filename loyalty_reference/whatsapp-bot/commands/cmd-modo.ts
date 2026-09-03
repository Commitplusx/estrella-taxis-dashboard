import { CommandContext } from './command-router.ts'
import { extract10Digits } from '../db.ts'
import { sendWA } from '../whatsapp.ts'

export async function handleModoCommand(ctx: CommandContext): Promise<Response | null> {
  const { supabase, fromPhone, from10, slashText } = ctx
  const args = slashText.slice(6).trim().split(/\s+/)
  const cTel = extract10Digits(args[0])
  const nuevoModo = (args[1] || '').toLowerCase()

  if (!cTel || cTel.length !== 10 || !['cliente', 'restaurante', 'repartidor', 'auto'].includes(nuevoModo)) {
    await sendWA(fromPhone,
      `⚠️ Uso: */modo 9631234567 [modo]*\n\n` +
      `Modos disponibles:\n` +
      `👤 *cliente* — fuerza modo cliente\n` +
      `🏪 *restaurante* — fuerza modo restaurante\n` +
      `🛵 *repartidor* — fuerza modo repartidor\n` +
      `🔄 *auto* — quitar override, vuelve al rol normal`
    )
    return new Response('OK', { status: 200 })
  }

  const memKey = `modo_activo_${cTel}`
  if (nuevoModo === 'auto') {
    await supabase.from('bot_memory').delete().eq('phone', memKey)
    await sendWA(fromPhone,
      `🔄 *MODO AUTOMÁTICO RESTABLECIDO*\n───────────────────\n\n` +
      `👤 *Número:* \`${cTel}\`\n\n` +
      `_El bot ahora usará el rol original registrado en la base de datos._`
    )
  } else {
    await supabase.from('bot_memory').upsert({
      phone: memKey,
      history: [{ modo: nuevoModo, forzado_por: from10, at: new Date().toISOString() }],
      updated_at: new Date().toISOString()
    })
    await sendWA(fromPhone,
      `✅ *MODO FORZADO APLICADO*\n───────────────────\n\n` +
      `👤 *Número:* \`${cTel}\`\n` +
      `🔧 *Rol Forzado:* ${nuevoModo.toUpperCase()}\n\n` +
      `_El bot atenderá este número como ${nuevoModo} temporalmente._\n\n` +
      `Para revertir: */modo ${cTel} auto*`
    )
  }
  return new Response('OK', { status: 200 })
}
