import { CommandContext } from './command-router.ts'
import { extract10Digits } from '../db.ts'
import { sendWA } from '../whatsapp.ts'

export async function handleInfoCommand(ctx: CommandContext): Promise<Response | null> {
  const { supabase, fromPhone, slashText } = ctx
  const cTel = extract10Digits(slashText.slice(6).trim())
  
  if (!cTel || cTel.length !== 10) {
    await sendWA(fromPhone, `⚠️ Formato: */info 9631234567*`)
    return new Response('OK', { status: 200 })
  }

  const { data: c } = await supabase.from('clientes').select('*').eq('telefono', cTel).limit(1).maybeSingle()
  if (c) {
    const repIcon = c.reputacion === 'excelente' ? '🌟' : c.reputacion === 'bueno' ? '👍' : c.reputacion === 'malo' ? '❌' : c.reputacion === 'regular' ? '⚠️' : '➖'
    let msg = `🔍 *FICHA DE CLIENTE*\n───────────────────\n`
    msg += `👤 *${c.nombre || 'Sin nombre'}*\n`
    msg += `📱 ${c.telefono}\n`
    msg += `⭐ Puntos: *${c.puntos}* | Rango: *${c.rango || 'bronce'}*\n`

    const enviosGratisPorPuntos = Math.floor((c.puntos || 0) / 5)
    const enviosGratisExtra = c.envios_gratis_disponibles || 0
    const totalGratis = enviosGratisPorPuntos + enviosGratisExtra

    if (totalGratis > 0) {
      msg += `🎁 *¡TIENE ${totalGratis} ENVÍO(S) GRATIS DISPONIBLE(S)!* 🎁\n`
    } else {
      msg += `🛵 Entregas: ${c.envios_totales || 0} | Envíos gratis extra: 0\n`
    }

    msg += `${c.es_vip ? '👑 *VIP*\n' : ''}`
    msg += `${repIcon} Reputación: *${c.reputacion || 'sin calificar'}*\n`
    msg += `💰 Billetera: *$${c.saldo_billetera || 0}*\n`
    if (c.direccion) msg += `🏠 Dirección: ${c.direccion}\n`
    if (c.lat_frecuente && c.lng_frecuente) {
      msg += `📍 GPS: https://maps.google.com/?q=${c.lat_frecuente},${c.lng_frecuente}\n`
    }
    if (c.cupon_activo) msg += `🎟️ Cupón: ${c.cupon_activo}\n`
    if (c.notas_crm) msg += `📝 ${c.notas_crm.slice(0, 200)}\n`
    msg += `📋 T&C: ${c.acepta_terminos ? '✅ Aceptados' : '❌ Pendientes'}`

    // ── Loyalty en restaurantes ──
    const { data: restPts } = await supabase
      .from('restaurante_clientes_puntos')
      .select('puntos, visitas, restaurante_id')
      .eq('cliente_tel', cTel)

    if (restPts && restPts.length > 0) {
      const restIds = restPts.map((r: any) => r.restaurante_id)
      const { data: restNames } = await supabase
        .from('restaurantes').select('id, nombre').in('id', restIds)
      const nameMap: Record<string, string> = {}
      restNames?.forEach((r: any) => { nameMap[r.id] = r.nombre })

      msg += `\n\n🏪 *Lealtad en Restaurantes:*\n`
      restPts.forEach((r: any) => {
        const nombre = nameMap[r.restaurante_id] || 'Restaurante'
        msg += `  • *${nombre}*: ⭐ ${r.puntos} pts | 👁️ ${r.visitas} visitas\n`
      })
    }

    await sendWA(fromPhone, msg)

    // Enviar foto si existe
    if (c.foto_fachada_url) {
      const { enviarFotoCliente } = await import('../media-handler.ts')
      await enviarFotoCliente(fromPhone, c.foto_fachada_url, c.nombre || cTel)
    }

    // Guardar contexto último cliente
    const admin10 = extract10Digits(fromPhone)
    await supabase.from('bot_memory').upsert({
      phone: `admin_last_client_${admin10}`,
      history: [{ clienteTel: cTel, nombre: c.nombre }],
      updated_at: new Date().toISOString()
    })
  } else {
    await sendWA(fromPhone, `🔍 Cliente ${cTel} no encontrado.`)
  }
  return new Response('OK', { status: 200 })
}
