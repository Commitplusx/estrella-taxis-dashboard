import { CommandContext } from './command-router.ts'
import { sendWA } from '../whatsapp.ts'

export async function handleSaldoCommand(ctx: CommandContext): Promise<Response | null> {
  const { supabase, fromPhone, from10, slashText, esAdmin } = ctx
  if (!esAdmin) {
    await sendWA(fromPhone, `🚫 No tienes permiso para recargar saldo.`);
    return new Response('OK', { status: 200 })
  }
  // Formato: /saldo 9631234567 150.50
  const args = slashText.slice(7).trim().split(/\s+/)
  const cTel = args[0]?.replace(/\D/g, '').slice(-10)
  const monto = parseFloat(args[1] || '0')
  if (!cTel || cTel.length !== 10 || isNaN(monto) || monto <= 0) {
    await sendWA(fromPhone, `⚠️ Formato: */saldo 9631234567 150.50*`)
    return new Response('OK', { status: 200 })
  }
  if (monto > 10000) {
    await sendWA(fromPhone, `⚠️ El máximo permitido por carga es *$10,000*. Contacta al desarrollador si necesitas más.`)
    return new Response('OK', { status: 200 })
  }

  // Incremento ATÓMICO: evita race condition si dos admins cargan saldo al mismo tiempo
  const { data: rpcRes, error: rpcErr } = await supabase.rpc('increment_cliente_saldo', {
    p_tel: cTel,
    p_monto: monto
  })

  if (rpcErr || !rpcRes?.ok) {
    if (rpcRes?.error === 'NO_VIP') {
      await sendWA(fromPhone, `⚠️ *ACCIÓN DENEGADA*\n───────────────────\n\nEl cliente aún no es usuario VIP. No cuenta con una billetera activa para recibir saldo.`)
      return new Response('OK', { status: 200 })
    }
    // Fallback si el RPC no existe todavía — carga no atómica con aviso
    console.warn('[/saldo] RPC atómico falló, usando fallback:', rpcErr?.message || rpcRes?.error)
    const { data: c } = await supabase.from('clientes').select('id, nombre, saldo_billetera, es_vip').eq('telefono', cTel).limit(1).maybeSingle()
    if (c) {
      if (!c.es_vip) {
        await sendWA(fromPhone, `⚠️ *ACCIÓN DENEGADA*\n───────────────────\n\nEl cliente aún no es usuario VIP. No cuenta con una billetera activa para recibir saldo.`)
        return new Response('OK', { status: 200 })
      }
      const nuevoSaldo = (c.saldo_billetera || 0) + monto
      await supabase.from('clientes').update({ saldo_billetera: nuevoSaldo }).eq('id', c.id)
      await supabase.from('registros_puntos').insert({
        cliente_id: c.id, tipo: 'acumulacion', puntos: 0, monto_saldo: monto,
        descripcion: `Carga manual de saldo por admin (${from10})`, created_by: null
      })
      await sendWA(fromPhone,
        `✅ *SALDO RECARGADO*\n───────────────────\n\n` +
        `👤 *Cliente:* ${c.nombre || cTel}\n` +
        `➕ *Monto Recargado:* $${monto}\n\n` +
        `💰 *Saldo Anterior:* $${c.saldo_billetera || 0}\n` +
        `💳 *Nuevo Saldo:* *$${nuevoSaldo}*`
      )
      try { await sendWA(`52${cTel}`, `💰 ¡Hola ${c.nombre || 'Cliente'}! Se han cargado *$${monto}* a tu Billetera VIP.\n💳 Saldo actual: *$${nuevoSaldo}*\n\n¡Gracias por ser parte de Estrella Delivery! ⭐️`) } catch (_) { console.error('Error WA Billetera'); }
    } else { await sendWA(fromPhone, `❌ Cliente no encontrado.`) }
  } else {
    await supabase.from('registros_puntos').insert({
      cliente_id: rpcRes.cliente_id, tipo: 'acumulacion', puntos: 0, monto_saldo: monto,
      descripcion: `Carga manual de saldo por admin (${from10})`, created_by: null
    })
    await sendWA(fromPhone,
      `✅ *SALDO RECARGADO*\n───────────────────\n\n` +
      `👤 *Cliente:* ${rpcRes.nombre || cTel}\n` +
      `➕ *Monto Recargado:* $${monto}\n` +
      `💳 *Nuevo Saldo:* *$${rpcRes.nuevo_saldo}*`
    )
    try { await sendWA(`52${cTel}`, `💰 ¡Hola ${rpcRes.nombre || 'Cliente'}! Se han cargado *$${monto}* a tu Billetera VIP.\n💳 Saldo actual: *$${rpcRes.nuevo_saldo}*\n\n¡Gracias por ser parte de Estrella Delivery! ⭐️`) } catch (_) { console.error('Error WA Billetera nuevo'); }
  }
  return new Response('OK', { status: 200 })
}
