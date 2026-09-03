// ══════════════════════════════════════════════════════════════════════════════
// client-profile-handler.ts — Gestión de perfil del cliente (reputación, dirección)
// Separado de admin-handler.ts para mantener responsabilidades únicas.
// ══════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extract10Digits } from './db.ts'
import { sendWA } from './whatsapp.ts'

type Supa = ReturnType<typeof createClient>

// Valores válidos de reputación en la BD
type Reputacion = 'excelente' | 'bueno' | 'regular' | 'malo' | 'vetado'

// ── Mapear texto natural a valor de BD ────────────────────────────────────────
function parsearReputacion(texto: string): Reputacion {
  const t = texto.toLowerCase()
  if (t.includes('excelente') || t.includes('muy bien') || t.includes('genial') || t.includes('top')) return 'excelente'
  if (t.includes('bueno') || t.includes('bien') || t.includes('buena')) return 'bueno'
  if (t.includes('regular') || t.includes('mas o menos') || t.includes('más o menos')) return 'regular'
  if (t.includes('malo') || t.includes('mala') || t.includes('mal')) return 'malo'
  if (t.includes('vetado') || t.includes('vetar') || t.includes('bloquear')) return 'vetado'
  return 'bueno' // default
}

const REP_ICON: Record<Reputacion, string> = {
  excelente: '🌟',
  bueno: '👍',
  regular: '⚠️',
  malo: '❌',
  vetado: '🚫',
}

// ── Guardar contexto último cliente (para handler de fotos) ───────────────────
async function guardarContextoCliente(supabase: Supa, fromPhone: string, tel10: string, nombre: string) {
  const admin10 = extract10Digits(fromPhone)
  await supabase.from('bot_memory').upsert({
    phone: `admin_last_client_${admin10}`,
    history: [{ clienteTel: tel10, nombre }],
    updated_at: new Date().toISOString()
  })
}

// ── CALIFICAR_CLIENTE ─────────────────────────────────────────────────────────
export async function handleCalificarCliente(
  supabase: Supa,
  fromPhone: string,
  clienteTel: string,
  descripcion: string
): Promise<void> {
  const tel10 = extract10Digits(clienteTel)
  if (!tel10) { await sendWA(fromPhone, '⚠️ Teléfono inválido.'); return }

  const { data: cli } = await supabase.from('clientes')
    .select('id, nombre')
    .eq('telefono', tel10)
    .limit(1).maybeSingle()

  if (!cli) { await sendWA(fromPhone, `🔍 No encontré al cliente ${tel10}.`); return }

  const rep = parsearReputacion(descripcion)
  const icon = REP_ICON[rep]

  await supabase.from('clientes')
    .update({ reputacion: rep })
    .eq('id', cli.id)

  await sendWA(fromPhone, `${icon} *${cli.nombre}* → Reputación: *${rep}*`)
  await guardarContextoCliente(supabase, fromPhone, tel10, cli.nombre)
}

// ── ACTUALIZAR_DIRECCION ──────────────────────────────────────────────────────
export async function handleActualizarDireccion(
  supabase: Supa,
  fromPhone: string,
  clienteTel: string,
  direccion: string
): Promise<void> {
  const tel10 = extract10Digits(clienteTel)
  if (!tel10) { await sendWA(fromPhone, '⚠️ Teléfono inválido.'); return }
  if (!direccion?.trim()) {
    await sendWA(fromPhone, `⚠️ No recibí la dirección. Dime: _"la dirección de ${tel10} es [dirección]"_`)
    return
  }

  const { data: cli } = await supabase.from('clientes')
    .select('id, nombre')
    .eq('telefono', tel10)
    .limit(1).maybeSingle()

  let cliId = cli?.id
  let cliNombre = cli?.nombre

  if (!cli) {
    const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${tel10}`
    const { data: nuevo } = await supabase.from('clientes').insert({
      telefono: tel10,
      nombre: 'Cliente Express',
      direccion: direccion.trim(),
      puntos: 0,
      acepta_terminos: false,
      qr_code: loyaltyUrl
    }).select('id, nombre').maybeSingle()
    
    if (nuevo) {
      cliId = nuevo.id
      cliNombre = nuevo.nombre
      await sendWA(fromPhone, `ℹ️ El número *${tel10}* no estaba registrado. Lo he agregado silenciosamente a la base de datos.`)
    } else {
      await sendWA(fromPhone, `❌ Error creando al cliente silencioso ${tel10}.`)
      return
    }
  } else {
    await supabase.from('clientes')
      .update({ direccion: direccion.trim() })
      .eq('id', cliId)
  }

  await sendWA(fromPhone, `🏠 *Dirección guardada*\n👤 ${cliNombre}\n📍 ${direccion.trim()}`)
  await guardarContextoCliente(supabase, fromPhone, tel10, cliNombre || 'Cliente')
}
