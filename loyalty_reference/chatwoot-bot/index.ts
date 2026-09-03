// ══════════════════════════════════════════════════════════════════════════════
// chatwoot-bot/index.ts — Agente IA para Chatwoot CRM (Estrella Delivery)
// Recibe webhooks de Chatwoot Agent Bot, procesa con DeepSeek y responde
// via API de Chatwoot. Misma lógica admin que el bot de WhatsApp.
// ══════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extract10Digits, generateCloudinaryVIPCard, fetchWithTimeout } from '../_shared/utils.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')!
const CHATWOOT_BOT_TOKEN = Deno.env.get('CHATWOOT_BOT_TOKEN')!
const CHATWOOT_API_TOKEN = Deno.env.get('CHATWOOT_API_TOKEN') ?? CHATWOOT_BOT_TOKEN
const CHATWOOT_SECRET = Deno.env.get('CHATWOOT_WEBHOOK_SECRET') ?? ''
const CHATWOOT_ACCOUNT_ID = Deno.env.get('CHATWOOT_ACCOUNT_ID')
if (!CHATWOOT_ACCOUNT_ID) throw new Error('Missing CHATWOOT_ACCOUNT_ID en entorno')
const CHATWOOT_BASE_URL = Deno.env.get('CHATWOOT_BASE_URL') ?? 'https://app.chatwoot.com'
const CHATWOOT_INBOX_ID = parseInt(Deno.env.get('CHATWOOT_INBOX_ID') ?? '0')
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? ''
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID') ?? ''
const BASE_LINK = 'https://www.estrella-eats.mx/pedido'

type Supa = ReturnType<typeof createClient>

// ── Tipos IA ──────────────────────────────────────────────────────────────────

type AIAction =
  | 'CREAR_PEDIDO' | 'RESPONDER' | 'SUMAR_PUNTOS' | 'CONSULTA_GENERAL'
  | 'VER_VIPS' | 'VER_PEDIDOS' | 'ESTADISTICAS' | 'BUSCAR_CLIENTE'
  | 'VER_REPARTIDORES' | 'CANCELAR_PEDIDO' | 'REASIGNAR_PEDIDO'
  | 'AGREGAR_NOTA_CLIENTE' | 'REPORTE_SEMANAL' | 'MARCAR_VIP'
  | 'VER_HISTORIAL_CLIENTE' | 'RECORDATORIO_REPARTIDOR' | 'REVISAR_ENTREGADOS'
  | 'AGREGAR_REPARTIDOR' | 'ELIMINAR_REPARTIDOR' | 'ESTADO_REPARTIDOR'
  | 'VER_ATRASOS' | 'CARGAR_SALDO' | 'ANUNCIO_REPARTIDORES' | 'UBICACION_RESTAURANTE'
  | 'ENTREGAR_TODOS' | 'CANCELAR_TODOS' | 'ENVIAR_QR' | 'VER_RESTAURANTES' | 'AGREGAR_CLIENTE'

interface AIResponse {
  accion: AIAction
  mensajeUsuario: string
  datosAExtraer?: Record<string, any>
}

const VALID_ACTIONS: AIAction[] = [
  'CREAR_PEDIDO', 'RESPONDER', 'SUMAR_PUNTOS', 'CONSULTA_GENERAL',
  'VER_VIPS', 'VER_PEDIDOS', 'ESTADISTICAS', 'BUSCAR_CLIENTE',
  'VER_REPARTIDORES', 'CANCELAR_PEDIDO', 'REASIGNAR_PEDIDO',
  'AGREGAR_NOTA_CLIENTE', 'REPORTE_SEMANAL', 'MARCAR_VIP',
  'VER_HISTORIAL_CLIENTE', 'RECORDATORIO_REPARTIDOR', 'REVISAR_ENTREGADOS',
  'AGREGAR_REPARTIDOR', 'ELIMINAR_REPARTIDOR', 'ESTADO_REPARTIDOR',
  'VER_ATRASOS', 'CARGAR_SALDO', 'ANUNCIO_REPARTIDORES', 'UBICACION_RESTAURANTE',
  'ENTREGAR_TODOS', 'CANCELAR_TODOS', 'ENVIAR_QR', 'VER_RESTAURANTES', 'AGREGAR_CLIENTE',
]

// ── Chatwoot API ──────────────────────────────────────────────────────────────

async function replyChat(accountId: number, convId: number, content: string, isPrivate = false): Promise<void> {
  const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}/conversations/${convId}/messages`
  console.log(`[Chatwoot] Intentando POST a: ${url}`)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'api_access_token': CHATWOOT_BOT_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, message_type: 'outgoing', private: isPrivate }),
    }, 10000)
    if (!res.ok) console.error(`[Chatwoot] Error replyChat (${res.status}):`, await res.text())
  } catch (e) {
    console.error('[Chatwoot] Fatal replyChat:', e)
  }
}

// Agrega etiqueta de Chatwoot a la conversación
async function labelConversation(accountId: number, convId: number, labels: string[]): Promise<void> {
  const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}/conversations/${convId}/labels`
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'api_access_token': CHATWOOT_BOT_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels }),
    }, 10000)
    if (!res.ok) console.error(`[Chatwoot] Error labelConv (${res.status}):`, await res.text())
  } catch (_) { /* silencioso */ }
}

async function updateContactAttributes(accountId: number, contactId: number, attributes: Record<string, any>): Promise<void> {
  const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}/contacts/${contactId}`
  console.log(`[CW Sync] Enviando PUT a ${url} con:`, JSON.stringify(attributes))
  try {
    const res = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: { 'api_access_token': CHATWOOT_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_attributes: attributes }),
    }, 10000)
    const resText = await res.text()
    if (!res.ok) {
      console.error(`[CW Sync] Error PUT Atributos (${res.status}):`, resText)
    } else {
      console.log(`[CW Sync] Éxito. Respuesta Chatwoot: ${resText.substring(0, 100)}...`)
    }
  } catch (e) { console.error(`[CW Sync] Error fatal en PUT:`, e) }
}

async function findContactIdByPhone(accountId: number, phone: string): Promise<number | null> {
  const p10 = phone.replace(/\D/g, '').slice(-10)
  const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}/contacts/search?q=${p10}`
  console.log(`[CW Sync] Buscando contacto en API: ${url}`)
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'api_access_token': CHATWOOT_API_TOKEN },
    }, 10000)
    const data = await res.json()
    const id = data.payload?.[0]?.id || null
    console.log(`[CW Sync] Resultado búsqueda API: ${id ? `ID ${id}` : 'No encontrado'}`)
    return id
  } catch (e) {
    console.error(`[CW Sync] Error buscando contacto:`, e)
    return null
  }
}

async function syncProfileToAttributes(supabase: Supa, accountId: number, contactId: number, conversationId: number, phone: string): Promise<void> {
  const p10 = phone.replace(/\D/g, '').slice(-10)
  console.log(`[CW Sync] Iniciando sincronización para ${p10}...`)

  // 1. Verificar/Obtener el Contact ID real por API (más seguro que el del webhook)
  const realContactId = await findContactIdByPhone(accountId, p10) || contactId

  const { data: c, error } = await supabase.from('clientes')
    .select('puntos, es_vip, saldo_billetera, reputacion')
    .eq('telefono', p10).limit(1).maybeSingle()

  if (error) console.error(`[CW Sync] Error DB:`, error)
  if (!c) {
    console.warn(`[CW Sync] Cliente ${p10} no existe en Supabase.`)
    return
  }

  // 2. Sincronizar Atributos
  console.log(`[CW Sync] Datos (como String): pts=${c.puntos}, vip=${c.es_vip}, rep=${c.reputacion}`)
  await updateContactAttributes(accountId, realContactId, {
    puntos_lealtad: String(c.puntos || 0),
    es_vip: c.es_vip ? 'Sí ⭐' : 'No',
    saldo_billetera: String(c.saldo_billetera || 0),
    reputacion: String(c.reputacion || 'Sin calificar')
  })

  // 3. Sincronizar Etiquetas de Rol
  let roleLabel = 'cliente'
  const [resRep, resRest] = await Promise.all([
    supabase.from('repartidores').select('id').eq('telefono', p10).limit(1).maybeSingle(),
    supabase.from('restaurantes').select('id').eq('telefono', p10).limit(1).maybeSingle()
  ])
  if (resRep.data) roleLabel = 'repartidor'
  else if (resRest.data) roleLabel = 'restaurante'
  await labelConversation(accountId, conversationId, [roleLabel])
  console.log(`[CW Sync] Finalizado para ${p10}`)
}

// ── WhatsApp (para notificar repartidores/clientes desde Chatwoot) ────────────

async function sendWA(to: string, text: string): Promise<void> {
  if (!WA_TOKEN || !WA_PHONE_ID) return
  const url = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`
  try {
    await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
    })
  } catch (e) {
    console.error('[WA Notif] Error:', e)
  }
}

// ── Utilidades ────────────────────────────────────────────────────────────────

function d10(phone: string | null | undefined): string {
  return String(phone || '').replace(/\D/g, '').slice(-10)
}

function barChart(label: string, value: number, max: number, width = 10): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0
  return `${label.padEnd(12)} |${'█'.repeat(filled)}${'░'.repeat(width - filled)}| ${value}`
}

async function buscarRepartidor(supabase: Supa, alias: string | null) {
  if (!alias) return null
  const clean = alias.trim().split(' ')[0]
  const { data } = await supabase
    .from('repartidores').select('id, user_id, telefono, nombre')
    .or(`alias.ilike.%${clean}%,nombre.ilike.%${clean}%`)
    .eq('activo', true).limit(1).maybeSingle()
  return data
}

async function crearPedido(supabase: Supa, datos: any): Promise<{ ok: boolean; pedidoId?: string; error?: string }> {
  try {
    const rep = await buscarRepartidor(supabase, datos.repartidorAlias)
    if (datos.repartidorAlias && !rep) return { ok: false, error: `Repartidor "${datos.repartidorAlias}" no encontrado.` }

    const tel = d10(datos.clienteTel || '0000000000')
    const { data: cache } = await supabase.from('clientes').select('lat_frecuente, lng_frecuente').eq('telefono', tel).maybeSingle()

    const insert: Record<string, unknown> = {
      cliente_tel: datos.clienteTel ?? '0000000000',
      descripcion: datos.descripcion,
    }
    if (datos.clienteNombre) insert.cliente_nombre = datos.clienteNombre
    if (datos.restaurante) insert.restaurante = datos.restaurante
    if (datos.direccion) insert.direccion = datos.direccion
    if (cache?.lat_frecuente) insert.lat = cache.lat_frecuente
    if (cache?.lng_frecuente) insert.lng = cache.lng_frecuente
    if (rep?.user_id) insert.repartidor_id = rep.user_id

    const { data: row, error } = await supabase.from('pedidos').insert(insert).select('id').maybeSingle()
    if (error) throw error

    if (rep?.telefono) {
      await supabase.functions.invoke('notificar-whatsapp', { body: { pedido_id: row.id, tipo: 'asignacion', repartidor_tel: rep.telefono } })
    }
    return { ok: true, pedidoId: row.id }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

// ── Sistema prompt para DeepSeek ──────────────────────────────────────────────

function adminPrompt(): string {
  return `Eres el "Asistente Virtual de Estrella Delivery" integrado en el CRM Chatwoot del administrador.
Eres una IA profesional y eficiente para gestión logística y administrativa de la empresa.

⚠️ REGLA ABSOLUTA: Tu respuesta COMPLETA debe ser ÚNICAMENTE un objeto JSON válido.
Sin texto antes ni después. Sin bloques markdown. Sin explicaciones fuera del JSON.

HERRAMIENTAS DISPONIBLES:
- CREAR_PEDIDO: Requiere restaurante, clienteTel (10 dígitos), descripcion.
- SUMAR_PUNTOS: Requiere clienteTel (10 dígitos), puntosASumar.
- BUSCAR_CLIENTE: Requiere clienteTel.
- CANCELAR_PEDIDO: Requiere clienteTel.
- REASIGNAR_PEDIDO: Requiere clienteTel, repartidorAlias.
- RECORDATORIO_REPARTIDOR: Requiere repartidorAlias, descripcion.
- ESTADO_REPARTIDOR: Requiere repartidorAlias.
- AGREGAR_REPARTIDOR: Requiere clienteNombre, clienteTel.
- ELIMINAR_REPARTIDOR: Requiere repartidorAlias.
- AGREGAR_CLIENTE: Requiere clienteNombre, clienteTel.
- CARGAR_SALDO: Requiere clienteTel, montoSaldo.
- UBICACION_RESTAURANTE: Requiere restaurante.
- ANUNCIO_REPARTIDORES: Requiere descripcion.
- REVISAR_ENTREGADOS: diasAtras (0=hoy, 1=ayer, N=hace N días).
- AGREGAR_NOTA_CLIENTE: Requiere clienteTel, descripcion.
- MARCAR_VIP: Requiere clienteTel.
- VER_HISTORIAL_CLIENTE: Requiere clienteTel.
- ENVIAR_QR: Requiere clienteTel.
- VER_RESTAURANTES, VER_REPARTIDORES, VER_VIPS, VER_PEDIDOS, ESTADISTICAS, REPORTE_SEMANAL, VER_ATRASOS.
- ENTREGAR_TODOS, CANCELAR_TODOS.
- RESPONDER: Para charlar, confirmar, o pedir datos faltantes.

REGLAS:
1. NUNCA inventes datos (nombres, teléfonos, estados).
2. TELÉFONO siempre 10 dígitos. Si falta, usa RESPONDER para pedirlo.
3. Responde profesional, directo, en español.
4. Si preguntan algo con "todos" (ej: "cancela todos"), pide confirmación primero con RESPONDER.

FORMATO (solo este JSON):
{"accion":"UNA_ACCION","mensajeUsuario":"Texto breve.","datosAExtraer":{"clienteTel":null,"puntosASumar":null,"diasAtras":null,"clienteNombre":null,"restaurante":null,"descripcion":null,"direccion":null,"repartidorAlias":null,"montoSaldo":null}}`
}

// ── Enforcement Validator ─────────────────────────────────────────────────────

function enforcer(resp: AIResponse): AIResponse {
  const d: Record<string, any> = resp.datosAExtraer || {}
  if (d.clienteTel) {
    const n = String(d.clienteTel).replace(/\D/g, '')
    d.clienteTel = n.length >= 10 ? n.slice(-10) : undefined
  }
  if (d.puntosASumar != null) d.puntosASumar = parseInt(String(d.puntosASumar), 10)
  if (d.montoSaldo != null) d.montoSaldo = parseInt(String(d.montoSaldo), 10)

  let blocked = false
  switch (resp.accion) {
    case 'CREAR_PEDIDO':
      if (!d.clienteTel || d.clienteTel.length !== 10) { blocked = true; resp.mensajeUsuario = 'Necesito el teléfono del cliente (10 dígitos) para crear el pedido.' }
      else if (!d.descripcion?.trim()) { blocked = true; resp.mensajeUsuario = 'Necesito la descripción del pedido.' }
      break
    case 'SUMAR_PUNTOS':
      if (!d.clienteTel || d.clienteTel.length !== 10) { blocked = true; resp.mensajeUsuario = 'Faltan los 10 dígitos del teléfono del cliente.' }
      else if (d.puntosASumar != null && d.puntosASumar < 0) { blocked = true; resp.mensajeUsuario = 'Los puntos no pueden ser negativos.' }
      break
    case 'BUSCAR_CLIENTE': case 'VER_HISTORIAL_CLIENTE':
    case 'MARCAR_VIP': case 'CANCELAR_PEDIDO': case 'AGREGAR_NOTA_CLIENTE': case 'ENVIAR_QR':
      if (!d.clienteTel || d.clienteTel.length !== 10) { blocked = true; resp.mensajeUsuario = 'Faltan los 10 dígitos del teléfono del cliente.' }
      break
    case 'CARGAR_SALDO':
      if (!d.clienteTel || d.clienteTel.length !== 10 || isNaN(d.montoSaldo) || d.montoSaldo <= 0) { blocked = true; resp.mensajeUsuario = 'Necesito teléfono (10 dígitos) y monto mayor a 0.' }
      break
    case 'ESTADO_REPARTIDOR': case 'RECORDATORIO_REPARTIDOR': case 'ELIMINAR_REPARTIDOR':
      if (!d.repartidorAlias) { blocked = true; resp.mensajeUsuario = 'Necesito el nombre o alias del repartidor.' }
      break
    case 'ANUNCIO_REPARTIDORES':
      if (!d.descripcion) { blocked = true; resp.mensajeUsuario = 'Indique el mensaje a enviar a todos los repartidores.' }
      break
    case 'REASIGNAR_PEDIDO':
      if (!d.clienteTel || d.clienteTel.length !== 10 || !d.repartidorAlias) { blocked = true; resp.mensajeUsuario = 'Necesito teléfono del cliente y nombre del repartidor.' }
      break
    case 'AGREGAR_REPARTIDOR': case 'AGREGAR_CLIENTE':
      if (!d.clienteNombre || !d.clienteTel || d.clienteTel.length !== 10) { blocked = true; resp.mensajeUsuario = 'Necesito nombre y teléfono (10 dígitos).' }
      break
  }
  if (blocked) resp.accion = 'RESPONDER'
  return resp
}

// ── Llamar a DeepSeek ─────────────────────────────────────────────────────────

async function callAI(
  supabase: Supa,
  memKey: string,
  userText: string,
): Promise<{ response?: AIResponse; history?: any[]; error?: string }> {
  const { data: mem } = await supabase.from('bot_memory').select('history').eq('phone', memKey).maybeSingle()
  const history = mem?.history || []

  const formatted = history
    .filter((h: any) => h.content?.trim())
    .map((h: any) => ({ role: h.role === 'model' ? 'assistant' : 'user', content: String(h.content).trim() }))

  const messages = [
    { role: 'system', content: adminPrompt() },
    ...formatted,
    { role: 'user', content: userText.substring(0, 500) },
  ]

  let res: Response
  try {
    res = await fetchWithTimeout('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', response_format: { type: 'json_object' }, messages, max_tokens: 2048, temperature: 0.0 }),
    }, 20000)  // 20s timeout for AI processing
  } catch (e: any) {
    return { error: e.message?.includes('timeout') ? 'DeepSeek no respondió a tiempo.' : String(e) }
  }

  if (!res.ok) return { error: `DeepSeek HTTP ${res.status}` }

  const data = await res.json()
  console.log(`🤖 [DeepSeek] Tokens: input=${data.usage?.prompt_tokens} output=${data.usage?.completion_tokens}`)

  let raw = (data.choices?.[0]?.message?.content || '').trim()
  if (!raw) return { error: 'Respuesta vacía de DeepSeek.' }

  let clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const fb = clean.indexOf('{'), lb = clean.lastIndexOf('}')
  if (fb !== -1 && lb !== -1) clean = clean.substring(fb, lb + 1)

  let parsed: AIResponse
  try {
    const p = JSON.parse(clean)
    if (!p.accion || !VALID_ACTIONS.includes(p.accion)) throw new Error('Acción inválida')
    parsed = p
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    try { parsed = JSON.parse(m?.[0] ?? '') }
    catch { parsed = { accion: 'RESPONDER', mensajeUsuario: '⚠️ Error procesando respuesta IA. Reintente.' } }
  }

  parsed = enforcer(parsed)

  const newHistory = [
    ...history.slice(-6),
    { role: 'user', content: userText.substring(0, 300) },
    ...(parsed.mensajeUsuario?.trim() ? [{ role: 'model', content: parsed.mensajeUsuario.trim().substring(0, 300) }] : []),
  ]

  return { response: parsed, history: newHistory }
}

// ── Ejecutar acciones admin ────────────────────────────────────────────────────

async function executeAction(supabase: Supa, accountId: number, convId: number, accion: AIAction, mensaje: string, d: Record<string, any>): Promise<void> {
  // Acciones simples: solo responder
  if (accion === 'RESPONDER' || accion === 'CONSULTA_GENERAL') {
    await replyChat(accountId, convId, mensaje || '¿Me lo repites?')
    return
  }

  switch (accion) {
    case 'VER_RESTAURANTES': {
      const { data } = await supabase.from('restaurantes').select('nombre, telefono, activo').eq('activo', true).order('nombre')
      if (!data?.length) { await replyChat(accountId, convId, '📍 *RESTAURANTES*\n\nNo hay locales activos registrados.'); break }
      let msg = '📍 *RESTAURANTES ASOCIADOS*\n───────────────────\n\n'
      data.forEach((l: any, i: number) => {
        msg += `${i + 1}️⃣ *${l.nombre.toUpperCase()}*\n`
        msg += l.telefono ? `📞 \`52${d10(l.telefono)}\`\n\n` : '📞 _Sin teléfono_\n\n'
      })
      await replyChat(accountId, convId, msg)
      break
    }

    case 'VER_VIPS': {
      const { data: vips } = await supabase.from('clientes').select('nombre, telefono, puntos, es_vip').order('puntos', { ascending: false }).limit(15)
      if (!vips?.length) { await replyChat(accountId, convId, '🏆 *RANKING VIP*\n\nNo hay clientes con puntos aún.'); break }
      let msg = '🏆 *RANKING VIP (Top 15)*\n───────────────────\n\n'
      vips.forEach((v: any, i: number) => {
        const icon = v.es_vip ? '⭐' : '👤'
        msg += `${i + 1}️⃣ ${icon} *${(v.nombre || 'SIN NOMBRE').toUpperCase()}*\n`
        msg += `   🌟 ${v.puntos} pts | \`${d10(v.telefono)}\`\n\n`
      })
      await replyChat(accountId, convId, msg)
      break
    }

    case 'VER_PEDIDOS': {
      const { data: activos } = await supabase.from('pedidos')
        .select('id, descripcion, estado, cliente_nombre, cliente_tel, created_at')
        .in('estado', ['asignado', 'recibido', 'en_camino'])
        .order('created_at', { ascending: false }).limit(10)
      if (!activos?.length) { await replyChat(accountId, convId, '📦 *OPERACIÓN DE HOY*\n\n✅ Sin pedidos activos pendientes.'); break }
      let msg = '📦 *PEDIDOS EN CURSO*\n───────────────────\n\n'
      const emo: Record<string, string> = { asignado: '🕘', recibido: '🛍️', en_camino: '🚀' }
      activos.forEach((p: any) => {
        msg += `${emo[p.estado] || '📦'} *${p.descripcion?.toUpperCase().slice(0, 30)}*\n`
        msg += `   ↳ ${p.cliente_nombre || p.cliente_tel || '?'} | *${p.estado.toUpperCase()}*\n`
        msg += `   🔗 ${BASE_LINK}/${p.id}\n\n`
      })
      await replyChat(accountId, convId, msg)
      break
    }

    case 'BUSCAR_CLIENTE': {
      const { data: c } = await supabase.from('clientes').select('*').eq('telefono', d10(d.clienteTel)).limit(1).maybeSingle()
      if (c) {
        const msg = `🔍 *CLIENTE ENCONTRADO*\n───────────────────\n\n👤 *${c.nombre || 'Sin nombre'}*\n📱 \`${c.telefono}\`\n⭐ Puntos: *${c.puntos}*\n🏆 VIP: ${c.es_vip ? '✅ Sí' : '❌ No'}\n🏅 Ranking: ${c.ranking_nivel || '-'}\n📝 Nota CRM: ${c.notas_crm || '_Sin notas_'}\n💳 Saldo: $${c.saldo_billetera || 0}\n📊 Rep: ${c.reputacion || '-'}`
        await replyChat(accountId, convId, msg)
        await labelConversation(accountId, convId, ['cliente-encontrado'])
      } else {
        await replyChat(accountId, convId, `🔍 No encontré cliente con tel: \`${d.clienteTel}\``)
      }
      break
    }

    case 'VER_REPARTIDORES': {
      const { data: reps } = await supabase.from('repartidores').select('nombre, alias, telefono').eq('activo', true).order('nombre').limit(20)
      if (!reps?.length) { await replyChat(accountId, convId, '🛵 *EQUIPO*\n\nNo hay repartidores activos.'); break }
      let msg = '🛵 *EQUIPO ACTIVO*\n───────────────────\n\n'
      reps.forEach((r: any, i: number) => {
        const alias = r.alias ? ` (${r.alias})` : ''
        msg += `${i + 1}️⃣ *${r.nombre.toUpperCase()}*${alias}\n`
        msg += r.telefono ? `📱 \`52${d10(r.telefono)}\`\n\n` : '📱 _Sin teléfono_\n\n'
      })
      await replyChat(accountId, convId, msg)
      break
    }

    case 'SUMAR_PUNTOS': {
      const tel10 = d10(d.clienteTel)
      const { data: c } = await supabase.from('clientes').select('id, puntos, nombre').eq('telefono', tel10).limit(1).maybeSingle()
      if (c) {
        const cant = Number(d.puntosASumar) || 1
        let lastRes: any = null
        const { data, error } = await supabase.rpc('fn_registrar_entrega_bulk', {
          p_cliente_tel: tel10,
          p_cantidad: cant
        })
        if (!error && data?.ok) lastRes = data
        const total = lastRes ? lastRes.puntos : ((c.puntos || 0) + cant)
        try {
          const resolvedContactId = await findContactIdByPhone(accountId, tel10)
          if (resolvedContactId) {
            await syncProfileToAttributes(supabase, accountId, resolvedContactId, convId, tel10)
          }
        } catch (e) {
          console.error('[CW Sync] Error post-sumar en chatwoot:', e)
        }
        const saldoInfo = lastRes?.saldo_billetera > 0 ? `\n💳 Saldo en billetera: *$${lastRes.saldo_billetera}*` : ''
        await replyChat(accountId, convId, `🌟 *Puntos actualizados*\n\n👤 ${c.nombre || tel10}\n+${cant} pts → Total: *${total} pts*${saldoInfo}`)
      } else {
        await replyChat(accountId, convId, `🔍 No encontré cliente con tel: \`${d.clienteTel}\``)
      }
      break
    }

    case 'AGREGAR_CLIENTE': {
      const tel10 = d10(d.clienteTel)
      const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${tel10}`
      const { data: existente } = await supabase.from('clientes').select('id, nombre').eq('telefono', tel10).limit(1).maybeSingle()
      if (existente) {
        await supabase.from('clientes').update({ nombre: d.clienteNombre || existente.nombre, qr_code: loyaltyUrl }).eq('id', existente.id)
        await replyChat(accountId, convId, `ℹ️ Cliente *${existente.nombre}* ya existía. Datos actualizados.\n🔗 ${loyaltyUrl}`)
      } else {
        const { error } = await supabase.from('clientes').insert({
          nombre: d.clienteNombre || 'Cliente Nuevo', telefono: tel10, puntos: 0, qr_code: loyaltyUrl
        })
        if (error) {
          await replyChat(accountId, convId, `❌ Error al crear cliente: ${error.message}`)
        } else {
          await replyChat(accountId, convId, `✅ *Cliente Registrado*\n\n👤 ${d.clienteNombre}\n📱 \`${tel10}\`\n🔗 ${loyaltyUrl}`)
          await labelConversation(accountId, convId, ['nuevo-cliente'])
        }
      }
      break
    }

    case 'CANCELAR_PEDIDO': {
      const tel10 = d10(d.clienteTel)
      const { data: peds } = await supabase.from('pedidos').select('id, descripcion').eq('cliente_tel', tel10).in('estado', ['asignado', 'recibido']).order('created_at', { ascending: false })
      if (peds?.length) {
        await supabase.from('pedidos').update({ estado: 'cancelado' }).in('id', peds.map((p: any) => p.id))
        await replyChat(accountId, convId, `❌ *Cancelado*\n${peds.length} pedido(s) de \`${tel10}\`\n📦 _${peds[0].descripcion?.slice(0, 60)}_`)
      } else {
        await replyChat(accountId, convId, `🔍 No encontré pedidos activos para: \`${tel10}\``)
      }
      break
    }

    case 'REASIGNAR_PEDIDO': {
      const { data: peds } = await supabase.from('pedidos').select('id').eq('cliente_tel', d10(d.clienteTel)).in('estado', ['asignado', 'recibido']).order('created_at', { ascending: false })
      const rep = await buscarRepartidor(supabase, d.repartidorAlias)
      if (peds?.length && rep) {
        await supabase.from('pedidos').update({ repartidor_id: rep.user_id }).in('id', peds.map((p: any) => p.id))
        for (const p of peds) {
          await supabase.functions.invoke('notificar-whatsapp', { body: { pedido_id: p.id, tipo: 'asignacion' } })
        }
        await replyChat(accountId, convId, `🔀 *Reasignado*\n${peds.length} pedido(s) → *${rep.nombre}* 🛵`)
      } else {
        await replyChat(accountId, convId, `⚠️ No encontré pedido activo o repartidor "${d.repartidorAlias}".`)
      }
      break
    }

    case 'AGREGAR_NOTA_CLIENTE': {
      const { data: cli } = await supabase.from('clientes').select('id, nombre').eq('telefono', d10(d.clienteTel)).limit(1).maybeSingle()
      if (cli) {
        await supabase.from('clientes').update({ notas_crm: d.descripcion }).eq('id', cli.id)
        await replyChat(accountId, convId, `📝 *Nota guardada*\n\n👤 ${cli.nombre || d.clienteTel}\n_"${d.descripcion}"_`)
      } else {
        await replyChat(accountId, convId, `🔍 No encontré al cliente con tel: \`${d.clienteTel}\``)
      }
      break
    }

    case 'MARCAR_VIP': {
      const { data: cli } = await supabase.from('clientes').select('id, nombre, es_vip').eq('telefono', d10(d.clienteTel)).limit(1).maybeSingle()
      if (cli) {
        await supabase.from('clientes').update({ es_vip: !cli.es_vip }).eq('id', cli.id)
        await replyChat(accountId, convId, `⭐ *${cli.nombre || d.clienteTel}* → ${!cli.es_vip ? 'Ahora es VIP ✅' : 'Ya no es VIP ❌'}`)
        
        // Si lo acaba de hacer VIP, le mandamos su nueva tarjeta por WhatsApp
        if (!cli.es_vip) {
          try {
            const { data: cInfo } = await supabase.from('clientes').select('nombre, puntos, saldo_billetera, telefono').eq('id', cli.id).maybeSingle()
            if (cInfo) {
              const { sendWA } = await import('../whatsapp-bot/whatsapp.ts')
              const qrCode = generateCloudinaryVIPCard(cInfo.telefono, cInfo.nombre || 'Cliente VIP', cInfo.puntos, cInfo.saldo_billetera || 0, true)
              await sendWA(`52${cInfo.telefono}`, `👑 *¡Felicidades!* 👑\n\nHas sido promovido a *Cliente VIP* ⭐ de Estrella Delivery.\n\nA partir de ahora acumularás *saldo real* en tu billetera. 💰\n\n🌟 *¡Aquí tienes tu nueva Tarjeta Digital VIP!* 🌟`, qrCode)
            }
          } catch (e) {
            console.error('[CHATWOOT] Error enviando tarjeta VIP al cliente:', e)
          }
        }
      } else {
        await replyChat(accountId, convId, `🔍 No encontré al cliente con tel: \`${d.clienteTel}\``)
      }
      break
    }

    case 'VER_HISTORIAL_CLIENTE': {
      const { data: hist } = await supabase.from('pedidos').select('descripcion, estado, created_at').eq('cliente_tel', d10(d.clienteTel)).order('created_at', { ascending: false }).limit(7)
      if (hist?.length) {
        let msg = `📄 *HISTORIAL* \`${d.clienteTel}\`\n───────────────────\n\n`
        hist.forEach((h: any) => {
          const fecha = new Date(h.created_at).toLocaleDateString('es-MX')
          msg += `• [${h.estado}] ${h.descripcion?.slice(0, 40)} — _${fecha}_\n`
        })
        await replyChat(accountId, convId, msg)
      } else {
        await replyChat(accountId, convId, `📄 Sin historial para \`${d.clienteTel}\``)
      }
      break
    }

    case 'RECORDATORIO_REPARTIDOR': {
      const rep = await buscarRepartidor(supabase, d.repartidorAlias)
      if (rep?.telefono) {
        await sendWA(`52${d10(rep.telefono)}`, `📩 *Mensaje de base:*\n_${d.descripcion}_`)
        await replyChat(accountId, convId, `✅ Recordatorio enviado a *${rep.nombre}* por WhatsApp.`)
      } else {
        await replyChat(accountId, convId, `⚠️ Repartidor "${d.repartidorAlias}" no encontrado o sin teléfono.`)
      }
      break
    }

    case 'REVISAR_ENTREGADOS': {
      const dias = d.diasAtras || 0
      const dIni = new Date(); dIni.setDate(dIni.getDate() - dias); dIni.setHours(0, 0, 0, 0)
      const dFin = new Date(dIni); dFin.setHours(23, 59, 59, 999)
      const { data: e } = await supabase.from('pedidos').select('descripcion, cliente_nombre, updated_at').eq('estado', 'entregado').gte('updated_at', dIni.toISOString()).lte('updated_at', dFin.toISOString()).order('updated_at', { ascending: false })
      const label = dias === 0 ? 'HOY' : dias === 1 ? 'AYER' : `HACE ${dias} DÍA(S)`
      let msg = `✅ *ENTREGADOS — ${label}* (${e?.length || 0})\n\n`
      e?.forEach((p: any) => msg += `💚 [${new Date(p.updated_at).toTimeString().slice(0, 5)}] ${p.cliente_nombre || ''} — ${p.descripcion?.slice(0, 35)}\n`)
      await replyChat(accountId, convId, msg)
      break
    }

    case 'ENTREGAR_TODOS': {
      let q = supabase.from('pedidos').update({ estado: 'entregado' }).in('estado', ['pendiente', 'en_camino', 'asignado', 'recibido'])
      if (d?.restaurante) q = q.ilike('restaurante', `%${d.restaurante}%`)
      const { error } = await q
      await replyChat(accountId, convId, error ? `❌ Error: ${error.message}` : '✅ Todos los pedidos activos marcados como entregados.')
      break
    }

    case 'CANCELAR_TODOS': {
      let q = supabase.from('pedidos').update({ estado: 'cancelado' }).in('estado', ['pendiente', 'en_camino', 'asignado', 'recibido'])
      if (d?.restaurante) q = q.ilike('restaurante', `%${d.restaurante}%`)
      const { error } = await q
      await replyChat(accountId, convId, error ? `❌ Error: ${error.message}` : '🚫 Todos los pedidos activos cancelados.')
      break
    }

    case 'ESTADISTICAS': {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
      const { data: today } = await supabase.from('pedidos').select('estado').gte('created_at', hoy.toISOString())
      const t = today?.length || 0
      const e = today?.filter((x: any) => x.estado === 'entregado').length || 0
      const c = today?.filter((x: any) => x.estado === 'en_camino').length || 0
      const { count: tc } = await supabase.from('clientes').select('*', { count: 'exact', head: true })
      const { count: reps } = await supabase.from('repartidores').select('*', { count: 'exact', head: true }).eq('activo', true)
      let msg = `📊 *ESTADÍSTICAS HOY*\n\`\`\`\n`
      msg += `${barChart('Entregados', e, t)}\n`
      msg += `${barChart('En Camino', c, t)}\n`
      msg += `${barChart('Pendiente', t - e - c, t)}\n\`\`\`\n`
      msg += `👥 Clientes: *${tc || '?'}*  |  🛵 Repartidores: *${reps || '?'}*`
      await replyChat(accountId, convId, msg)
      break
    }

    case 'REPORTE_SEMANAL': {
      const hace7 = new Date(); hace7.setDate(hace7.getDate() - 6); hace7.setHours(0, 0, 0, 0)
      const { data: semana } = await supabase.from('pedidos').select('estado, created_at').gte('created_at', hace7.toISOString())
      if (!semana) { await replyChat(accountId, convId, '⚠️ No pude obtener datos de la semana.'); break }
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
      const diasMap: Record<string, { total: number; entregados: number }> = {}
      semana.forEach((p: any) => {
        const key = dayNames[new Date(p.created_at).getDay()]
        if (!diasMap[key]) diasMap[key] = { total: 0, entregados: 0 }
        diasMap[key].total++
        if (p.estado === 'entregado') diasMap[key].entregados++
      })
      const mx = Math.max(...Object.values(diasMap).map(v => v.total), 1)
      const ts = semana.length
      const es = semana.filter((p: any) => p.estado === 'entregado').length
      let msg = '📈 *REPORTE SEMANAL*\n\n```\n'
      Object.entries(diasMap).forEach(([day, v]) => msg += barChart(day, v.total, mx, 8) + '\n')
      msg += `\`\`\`\n\n📦 Total: *${ts}*  |  ✅ Entregados: *${es}*  |  📉 Tasa: *${ts > 0 ? Math.round((es / ts) * 100) : 0}%*`
      await replyChat(accountId, convId, msg)
      break
    }

    case 'AGREGAR_REPARTIDOR': {
      const nombre = String(d.clienteNombre || '').trim()
      const tel = d.clienteTel ? d10(String(d.clienteTel)) : null
      const { error } = await supabase.from('repartidores').insert({ nombre, telefono: tel || null, alias: d.repartidorAlias || null, activo: true })
      if (error) {
        await replyChat(accountId, convId, `❌ Error al registrar repartidor: ${error.message}`)
      } else {
        await replyChat(accountId, convId, `🛵✨ *Repartidor Registrado*\n👤 *${nombre}*${tel ? `\n📱 \`${tel}\`` : '\n⚠️ Sin teléfono'}\n\nYa está activo para recibir pedidos.`)
      }
      break
    }

    case 'ELIMINAR_REPARTIDOR': {
      let q = supabase.from('repartidores').select('id, nombre').eq('activo', true)
      if (d?.repartidorAlias) q = q.or(`alias.ilike.%${d.repartidorAlias}%,nombre.ilike.%${d.repartidorAlias}%`) as any
      const { data: rep } = await q.limit(1).maybeSingle()
      if (rep) {
        await supabase.from('repartidores').update({ activo: false }).eq('id', rep.id)
        await replyChat(accountId, convId, `🛵❌ *Repartidor desactivado:* ${rep.nombre}`)
      } else {
        await replyChat(accountId, convId, `⚠️ No encontré al repartidor "${d.repartidorAlias}" activo.`)
      }
      break
    }

    case 'ESTADO_REPARTIDOR': {
      const rep = await buscarRepartidor(supabase, d.repartidorAlias || d.clienteTel)
      if (!rep) { await replyChat(accountId, convId, `🔍 No encontré al repartidor "${d.repartidorAlias}".`); break }
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
      const orFilter = rep.user_id ? `repartidor_id.eq.${rep.user_id},repartidor_id.eq.${rep.id}` : `repartidor_id.eq.${rep.id}`
      const { data: pt } = await supabase.from('pedidos').select('estado').or(orFilter).gte('created_at', hoy.toISOString())
      const entregados = pt?.filter((p: any) => p.estado === 'entregado').length || 0
      const pendientes = pt?.filter((p: any) => !['entregado', 'cancelado'].includes(p.estado)).length || 0
      await replyChat(accountId, convId, `📋 *ESTADO: ${rep.nombre.toUpperCase()}*\n${rep.telefono ? `📱 \`${rep.telefono}\`` : ''}\n\n✅ Entregados hoy: *${entregados}*\n⏳ En curso: *${pendientes}*\n📦 Total: *${pt?.length || 0}*`)
      break
    }

    case 'UBICACION_RESTAURANTE': {
      const { data: res } = await supabase.from('restaurantes').select('nombre, lat, lng, direccion').or(`nombre.ilike.%${d.restaurante}%,direccion.ilike.%${d.restaurante}%`).limit(1).maybeSingle()
      if (res) {
        let msg = `📍 *${res.nombre.toUpperCase()}*\n`
        if (res.direccion) msg += `🏠 ${res.direccion}\n`
        if (res.lat && res.lng) msg += `🗺️ https://maps.google.com/?q=${res.lat},${res.lng}`
        await replyChat(accountId, convId, msg)
      } else {
        await replyChat(accountId, convId, `🔍 No encontré restaurante: "${d.restaurante}"`)
      }
      break
    }

    case 'ANUNCIO_REPARTIDORES': {
      const { data: ra } = await supabase.from('repartidores').select('telefono').eq('activo', true).not('telefono', 'is', null)
      if (ra?.length) {
        let sent = 0
        for (const r of ra) {
          await sendWA(`52${d10(r.telefono)}`, `📢 *ANUNCIO DE BASE*\n\n${d.descripcion}`)
          sent++
        }
        await replyChat(accountId, convId, `✅ Anuncio enviado por WhatsApp a *${sent}* repartidores activos.`)
      } else {
        await replyChat(accountId, convId, `⚠️ No hay repartidores activos con teléfono registrado.`)
      }
      break
    }

    case 'CARGAR_SALDO': {
      const tel10 = d10(d.clienteTel)
      const { data: cli } = await supabase.from('clientes').select('id, nombre, saldo_billetera').eq('telefono', tel10).limit(1).maybeSingle()
      if (cli) {
        const ns = (parseFloat(cli.saldo_billetera) || 0) + (d.montoSaldo || 0)
        await supabase.from('clientes').update({ saldo_billetera: ns }).eq('id', cli.id)
        await supabase.from('registros_puntos').insert({ cliente_id: cli.id, tipo: 'acumulacion', puntos: 0, monto_saldo: d.montoSaldo, descripcion: `Recarga Chatwoot CRM: $${d.montoSaldo}` })
        await replyChat(accountId, convId, `💳 *Billetera actualizada*\n\n👤 ${cli.nombre || tel10}\n+$${d.montoSaldo} → Saldo: *$${ns}*`)
      } else {
        await replyChat(accountId, convId, `🔍 No encontré cliente con tel: \`${d.clienteTel}\``)
      }
      break
    }

    case 'VER_ATRASOS': {
      const cutoff = new Date(Date.now() - 45 * 60000).toISOString()
      const { data: at } = await supabase.from('pedidos').select('descripcion, estado, created_at').not('estado', 'in', '("entregado","cancelado")').lt('created_at', cutoff)
      if (at?.length) {
        let msg = `🚨 *ATRASOS (+45 min)* — ${at.length} pedido(s)\n\n`
        at.forEach((p: any) => {
          const mins = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 60000)
          msg += `⏱️ *${mins}m* — ${p.descripcion?.substring(0, 30)} | Estado: ${p.estado}\n`
        })
        await replyChat(accountId, convId, msg)
        await labelConversation(accountId, convId, ['atrasos'])
      } else {
        await replyChat(accountId, convId, '✅ Sin atrasos. Operación al día.')
      }
      break
    }

    case 'ENVIAR_QR': {
      const tel10 = d10(d.clienteTel)
      const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${tel10}`
      const qrUrl = generateCloudinaryVIPCard(tel10, d.clienteNombre || existente.nombre, existente.puntos, existente.saldo_billetera || 0, existente.es_vip || false)
      const { data: cli } = await supabase.from('clientes').select('nombre, puntos').eq('telefono', tel10).limit(1).maybeSingle()
      await replyChat(accountId, convId, `📱 *QR de Lealtad*\n\n👤 ${cli?.nombre || tel10}\n🌟 ${cli?.puntos || 0} pts\n🔗 ${loyaltyUrl}\n🖼️ QR: ${qrUrl}\n\n_Para enviar al cliente directamente, usa el bot de WhatsApp._`)
      break
    }

    case 'CREAR_PEDIDO': {
      const result = await crearPedido(supabase, d)
      if (result.ok && result.pedidoId) {
        await replyChat(accountId, convId, `✅ *Pedido Creado*\n\n📦 ${d.descripcion}\n👤 Cliente: \`${d.clienteTel}\`\n🔗 ${BASE_LINK}/${result.pedidoId}`)
        await labelConversation(accountId, convId, ['pedido-creado'])
      } else {
        await replyChat(accountId, convId, `❌ Error al crear pedido: ${result.error}`)
      }
      break
    }

    default:
      await replyChat(accountId, convId, mensaje || '¿En qué puedo ayudarte?')
  }
}

// ── Main webhook ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let bodyText = ''
  try { bodyText = await req.text() }
  catch { return new Response('Bad Request', { status: 400 }) }

  // Verificación HMAC-SHA512 (si está configurado el secret)
  if (CHATWOOT_SECRET) {
    const sig = req.headers.get('x-chatwoot-hmac-sha512') ?? ''
    if (sig) {
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey('raw', encoder.encode(CHATWOOT_SECRET), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
      const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText))
      const expected = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, '0')).join('')
      if (sig !== expected) {
        console.error('⛔ Firma Chatwoot inválida')
        return new Response('Unauthorized', { status: 401 })
      }
    }
  }

  let body: any
  try { body = JSON.parse(bodyText) }
  catch { return new Response('Bad JSON', { status: 400 }) }

  const accountId = body.account?.id || parseInt(CHATWOOT_ACCOUNT_ID)

  // Solo procesar message_created con contenido
  if (body.event !== 'message_created') return new Response('OK', { status: 200 })
  if (!body.content?.trim()) return new Response('OK', { status: 200 })

  const msgType = body.message_type          // 'incoming' | 'outgoing'
  const senderType = body.sender?.type ?? '' // 'agent' | 'user' | 'agent_bot' | 'contact'
  const isPrivate = body.private === true
  const msgInboxId = body.conversation?.inbox_id ?? body.inbox?.id
  const convId = body.conversation?.id as number

  console.log(`[Webhook] type=${msgType} sender=${senderType} private=${isPrivate} conv=${convId} inbox=${msgInboxId}`)

  // ── FILTRO: Ignorar mensajes del propio bot (agent_bot) ──
  // Cuando el bot responde via BOT_TOKEN, sender.type === 'agent_bot'.
  // Cuando respondemos via API_TOKEN, sender.type podría ser 'user'.
  // Usamos un tag especial en el contenido para detectar nuestras propias respuestas.
  if (senderType === 'agent_bot') {
    return new Response('OK', { status: 200 })
  }

  // ── MENSAJES SALIENTES (outgoing) ──
  if (msgType === 'outgoing') {
    // Solo procesar mensajes de agentes humanos reales
    const isHuman = senderType === 'agent' || senderType === 'user'
    if (!isHuman) return new Response('OK', { status: 200 })

    // Extraer teléfono del cliente de la conversación
    const identifier = body.conversation?.meta?.sender?.identifier as string | undefined
    const phoneRaw = body.conversation?.meta?.sender?.phone_number as string | undefined
    const customerPhone = (identifier || phoneRaw || '').replace(/\D/g, '')

    // ── Comandos IA por Notas Privadas (empiezan con /) ──
    if (isPrivate && body.content.trim().startsWith('/')) {
      const cmdText = body.content.trim()
      console.log(`[CMD] Comando: "${cmdText}" | Cliente: ${customerPhone} | Conv: ${convId}`)

      if (customerPhone.length < 10 || !convId) {
        console.warn(`[CMD] Teléfono o conversación inválidos. Ignorando.`)
        return new Response('OK', { status: 200 })
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      const memKey = `chatwoot_admin_cmd_${convId}`
      const prompt = `El administrador ha ejecutado un comando en el CRM sobre el cliente con teléfono ${customerPhone}. El comando es: "${cmdText}". Actúa sobre el cliente ${customerPhone}.`

      try {
        console.log(`[CMD] Llamando IA...`)
        const aiResult = await callAI(supabase, memKey, prompt)

        if (aiResult.response) {
          const accion = aiResult.response.accion
          const mensaje = aiResult.response.mensajeUsuario
          const datos = aiResult.response.datosAExtraer || {}
          console.log(`[CMD] IA respondió: ${accion}`)

          // Ejecutar acción
          await executeAction(supabase, accountId, convId, accion, mensaje, datos)

          // Sincronizar atributos del contacto
          const contactId = body.conversation?.contact_id
          if (contactId) {
            console.log(`[CMD] Sincronizando atributos para contactId=${contactId}...`)
            try {
              await syncProfileToAttributes(supabase, accountId, contactId, convId, customerPhone)
            } catch (syncErr) {
              console.error(`[CMD] Error sync:`, syncErr)
            }
          }

          // Responder con nota privada (usa BOT token para no re-disparar el webhook como humano)
          await replyChat(accountId, convId, `🤖 Comando: *${accion}*\n\nResultado: ${mensaje}`, true)
        } else if (aiResult.error) {
          await replyChat(accountId, convId, `⚠️ Error IA: ${aiResult.error}`, true)
        }
      } catch (err: any) {
        console.error(`[CMD] Error fatal:`, err)
        await replyChat(accountId, convId, `⚠️ Error: ${err?.message || String(err)}`, true)
      }

      return new Response('OK', { status: 200 })
    }

    // ── Reenvío a WhatsApp (solo mensajes públicos del agente, en el inbox correcto) ──
    if (!isPrivate && CHATWOOT_INBOX_ID && msgInboxId === CHATWOOT_INBOX_ID && WA_TOKEN && WA_PHONE_ID) {
      if (customerPhone.length >= 10) {
        await sendWA(customerPhone, body.content.trim())
        console.log(`[CW→WA] Agente → WhatsApp ${customerPhone}`)
      }
    }

    return new Response('OK', { status: 200 })
  }

  // ── MENSAJES ENTRANTES (incoming) ──

  // Mensajes del inbox de WhatsApp → ya los maneja whatsapp-bot, no duplicar
  if (CHATWOOT_INBOX_ID && msgInboxId === CHATWOOT_INBOX_ID) {
    return new Response('OK', { status: 200 })
  }

  // Solo procesar incoming (no activity, etc.)
  if (msgType !== 'incoming') return new Response('OK', { status: 200 })
  if (!convId) return new Response('OK', { status: 200 })

  const content: string = body.content.trim()
  console.log(`[Chatwoot] Conv #${convId}: "${content.substring(0, 80)}"`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  const memKey = `chatwoot_conv_${convId}`

  // Llamar a la IA
  const aiResult = await callAI(supabase, memKey, content)
  if (aiResult.error) {
    await replyChat(accountId, convId, `⚠️ Error IA: ${aiResult.error}`)
    return new Response('OK', { status: 200 })
  }

  const { response: aiResp, history: newHistory } = aiResult
  if (!aiResp) return new Response('OK', { status: 200 })

  // Ejecutar la acción
  await executeAction(supabase, accountId, convId, aiResp.accion, aiResp.mensajeUsuario, aiResp.datosAExtraer || {})

  // Sincronizar perfil a Atributos Personalizados
  const contactId = body.conversation?.contact_id
  const phoneRaw2 = body.conversation?.meta?.sender?.phone_number || body.conversation?.meta?.sender?.identifier || ''
  const phone10 = phoneRaw2.replace(/\D/g, '').slice(-10)
  if (contactId && phone10.length === 10) {
    try {
      await syncProfileToAttributes(supabase, accountId, contactId, convId, phone10)
    } catch (_) { /* silencioso */ }
  }

  // Guardar memoria de conversación
  if (newHistory) {
    await supabase.from('bot_memory').upsert({
      phone: memKey,
      history: newHistory.slice(-35),
      updated_at: new Date().toISOString(),
    })
  }

  return new Response('OK', { status: 200 })
})
