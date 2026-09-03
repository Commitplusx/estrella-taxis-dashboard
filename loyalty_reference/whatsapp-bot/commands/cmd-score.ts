import { CommandContext } from './command-router.ts'
import { extract10Digits } from '../db.ts'
import { sendWA, sendInteractiveList } from '../whatsapp.ts'

export async function handleScoreCommand(ctx: CommandContext): Promise<Response | null> {
  const { supabase, fromPhone, slashText } = ctx
  const rest = slashText.slice(7).trim()
  const match = rest.match(/^(\d[\d\s\-]{8,}\d)(?:\s+(.+))?$/)
  const cTel = match ? extract10Digits(match[1]) : null
  const califStr = match && match[2] ? match[2].trim().toLowerCase() : null

  if (!cTel || cTel.length !== 10) {
    await sendWA(fromPhone, `⚠️ Formato: */score 9631234567 [excelente, bueno...]* o solo */score 9631234567* para ver opciones.`)
    return new Response('OK', { status: 200 })
  }

  if (!califStr) {
    await sendInteractiveList(
      fromPhone,
      `⭐ *Calificar Cliente* — \`${cTel}\`\nPor favor selecciona la reputación que le asignarás:`,
      `Elegir Reputación`,
      [{
        title: 'Reputaciones',
        rows: [
          { id: `RATE_EXC_${cTel}`, title: '⭐ Excelente' },
          { id: `RATE_BUE_${cTel}`, title: '👍 Bueno' },
          { id: `RATE_REG_${cTel}`, title: '⚠️ Regular' },
          { id: `RATE_MAL_${cTel}`, title: '❌ Malo' },
          { id: `VETAR_${cTel}`, title: '🚫 Vetado' }
        ]
      }]
    )
    return new Response('OK', { status: 200 })
  }

  const { data: cli } = await supabase.from('clientes')
    .select('id, nombre, reputacion').eq('telefono', cTel).limit(1).maybeSingle()
  if (!cli) {
    await sendWA(fromPhone, `❌ Cliente ${cTel} no encontrado.`)
    return new Response('OK', { status: 200 })
  }

  // Mapear el texto a una de las opciones válidas
  let rep: 'excelente' | 'bueno' | 'regular' | 'malo' | 'vetado' = 'bueno'
  if (califStr.includes('excelente') || califStr.includes('bien') || califStr.includes('genial') || califStr.includes('top')) rep = 'excelente'
  else if (califStr.includes('bueno') || califStr.includes('buena')) rep = 'bueno'
  else if (califStr.includes('regular') || califStr.includes('media') || califStr.includes('medio')) rep = 'regular'
  else if (califStr.includes('malo') || califStr.includes('mala') || califStr.includes('mal')) rep = 'malo'
  else if (califStr.includes('vetado') || califStr.includes('bloquear')) rep = 'vetado'

  const REP_ICON = { excelente: '🌟', bueno: '👍', regular: '⚠️', malo: '❌', vetado: '🚫' }

  await supabase.from('clientes').update({ reputacion: rep }).eq('id', cli.id)
  await sendWA(fromPhone, `✅ *REPUTACIÓN ACTUALIZADA*\n───────────────────\n\n${REP_ICON[rep]} *${cli.nombre || cTel}* → *${rep.toUpperCase()}*`)

  return new Response('OK', { status: 200 })
}
