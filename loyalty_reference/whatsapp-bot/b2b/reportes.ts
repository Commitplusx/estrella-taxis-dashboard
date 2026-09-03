import { sendWA } from '../whatsapp.ts'

const MAX_REGALOS_POR_DIA = 2

export async function handleReportes(
  supabase: any,
  fromPhone: string,
  restauranteId: string,
  nombreRest: string,
  buttonId: string
): Promise<Response | null> {
  // -- Mini-Dashboard de hoy --
  if (buttonId === 'REST_MENU_RESUMEN') {
    const tz = 'America/Mexico_City'
    const dateStr = new Date().toLocaleString('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    const [m, d, y] = dateStr.split('/')
    const hoy = new Date(`${y}-${m}-${d}T00:00:00.000-06:00`).toISOString()

    const { data: logs } = await supabase.from('restaurante_loyalty_log')
      .select('accion, valor, cliente_tel')
      .eq('restaurante_id', restauranteId)
      .gte('created_at', hoy)

    const afiliados    = logs?.filter((l: any) => l.accion === 'afiliar_cliente').length || 0
    const ptsSumados   = logs?.filter((l: any) => l.accion === 'sumar_puntos').reduce((s: number, l: any) => s + (l.valor || 0), 0) || 0
    const regalados    = logs?.filter((l: any) => l.accion === 'regalar_envio').length || 0
    const visitasUnicas = new Set(logs?.filter((l: any) => l.accion === 'sumar_puntos').map((l: any) => l.cliente_tel)).size
    const regalosQuedan = Math.max(0, MAX_REGALOS_POR_DIA - regalados)

    const fecha = new Date().toLocaleDateString('es-MX', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })
    await sendWA(fromPhone,
      `?? *Resumen de hoy — ${fecha}*\n` +
      `Restaurante: *${nombreRest}*\n` +
      `-------------------\n` +
      `? Nuevos afiliados: *${afiliados}*\n` +
      `? Puntos sumados: *${ptsSumados}*\n` +
      `?? Visitas únicas: *${visitasUnicas}*\n` +
      `?? Envíos regalados: *${regalados}/${MAX_REGALOS_POR_DIA}*` +
      (regalosQuedan > 0
        ? ` — te queda${regalosQuedan === 1 ? '' : 'n'} *${regalosQuedan}* para hoy ??`
        : ` — *límite del día alcanzado* ?`) + `\n` +
      `-------------------\n` +
      `_¡Sigue así! Cada visita cuenta._ ??`
    )
    return new Response('OK', { status: 200 })
  }

  if (buttonId === 'REST_MENU_HISTORIAL') {
    const { data: logs } = await supabase.from('restaurante_loyalty_log')
      .select('accion, valor, cliente_tel, created_at')
      .eq('restaurante_id', restauranteId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!logs || logs.length === 0) {
      await sendWA(fromPhone, `?? *Historial de Movimientos*\n\nAún no tienes movimientos registrados en tu local.`)
      return new Response('OK', { status: 200 })
    }

    const tz = 'America/Mexico_City'
    const lineas = logs.map((l: any) => {
      const fecha = new Date(l.created_at).toLocaleString('es-MX', { timeZone: tz, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      const telOculto = l.cliente_tel.slice(0, 3) + '****' + l.cliente_tel.slice(-3)
      let icono = '??'
      let desc = ''
      if (l.accion === 'sumar_puntos') { icono = '??'; desc = `+${l.valor} pts` }
      else if (l.accion === 'canjear_recompensa') { icono = '??'; desc = `-${l.valor} pts` }
      else if (l.accion === 'afiliar_cliente') { icono = '??'; desc = `Nuevo` }
      else if (l.accion === 'regalar_envio') { icono = '??'; desc = `Regalo` }
      
      return `${icono} \`${telOculto}\` — *${desc}*\n   ?? _${fecha}_`
    }).join('\n\n')

    await sendWA(fromPhone, `?? *Últimos 10 Movimientos*\nRestaurante: *${nombreRest}*\n\n${lineas}`)
    return new Response('OK', { status: 200 })
  }

  return null
}
