// ══════════════════════════════════════════════════════════════════════════════
// media-handler.ts — Descarga de media de WhatsApp y subida a Supabase Storage
// ══════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extract10Digits } from './db.ts'
import { generateCloudinaryVIPCard } from '../_shared/utils.ts'
import { sendWA, sendWAImage, sendWATemplate } from './whatsapp.ts'

type Supa = ReturnType<typeof createClient>

const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN')!
const BUCKET = 'fachadas_clientes'

// ── Descargar media de WhatsApp Cloud API ─────────────────────────────────────
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> {
  try {
    // 1. Obtener la URL del media
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` }
    })
    if (!metaRes.ok) {
      console.error('[MEDIA] Error obteniendo URL:', await metaRes.text())
      return null
    }
    const { url, mime_type } = await metaRes.json()

    // 2. Descargar el archivo binario
    const fileRes = await fetch(url, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` }
    })
    if (!fileRes.ok) {
      console.error('[MEDIA] Error descargando archivo:', fileRes.status)
      return null
    }

    return { buffer: await fileRes.arrayBuffer(), mimeType: mime_type || 'image/jpeg' }
  } catch (e) {
    console.error('[MEDIA] Error fatal descargando media:', e)
    return null
  }
}

// ── Subir archivo a Supabase Storage ──────────────────────────────────────────
export async function uploadToStorage(
  supabase: Supa,
  bucketName: string,
  filePath: string,
  buffer: ArrayBuffer,
  contentType: string
): Promise<string | null> {
  const { error } = await supabase.storage
    .from(bucketName)
    .upload(filePath, buffer, { contentType, upsert: true })

  if (error) {
    console.error('[STORAGE] Error subiendo:', error.message)
    return null
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(filePath)
  return data?.publicUrl || null
}

// ── Handler principal: Admin/Repartidor envía foto ────────────────────────────
export async function handleAdminPhoto(
  supabase: Supa,
  fromPhone: string,
  from10: string,
  imageMsg: any,
  esAdmin: boolean = false
): Promise<Response> {
  const mediaId = imageMsg.id
  const caption = (imageMsg.caption || '').trim()

  let tel10: string | null = null
  let clienteId: string | null = null
  let clienteNombre: string = ''

  // ── 1. Revisar si hay sesión de captura activa ────────────────────────────
  const { data: sesionActiva } = await supabase.from('bot_memory')
    .select('history').eq('phone', `capture_mode_${from10}`).maybeSingle()

  if (sesionActiva?.history?.[0]) {
    tel10 = sesionActiva.history[0].clienteTel
    clienteId = sesionActiva.history[0].clienteId
    clienteNombre = sesionActiva.history[0].clienteNombre || tel10
  }

  // ── 2. Si no hay sesión, buscar número en el caption ──────────────────────
  if (!tel10) {
    const telMatch = caption.match(/(\d{10,13})/)
    tel10 = telMatch ? extract10Digits(telMatch[1]) : null
  }

  // ── 3. Si aún no hay número, buscar en contexto reciente del admin ─────────
  if (!tel10) {
    const { data: ctx } = await supabase.from('bot_memory')
      .select('history').eq('phone', `admin_last_client_${from10}`).maybeSingle()
    if (ctx?.history?.[0]?.clienteTel) {
      tel10 = extract10Digits(ctx.history[0].clienteTel)
    }
  }

  if (!tel10) {
    if (esAdmin) {
      await sendWA(fromPhone,
        `⚠️ No sé a qué cliente asociar esta foto.\n\n` +
        `Opciones:\n` +
        `📌 Activa una sesión primero: */fachada 9631234567*\n` +
        `📸 O envía la foto con el número en el caption`
      )
    } else {
      // Repartidor (BUG-06 fix: mensaje más claro y menos técnico para el mensajero)
      await sendWA(fromPhone,
        `⚠️ No pude guardar la foto porque no sé de qué cliente es.\n\n` +
        `Para guardarla, *reenvía la foto* y escribe el número de teléfono del cliente (10 dígitos) como mensaje adjunto (caption).`
      )
    }
    return new Response('OK', { status: 200 })
  }

  // ── 4. Buscar cliente si no lo tenemos de la sesión ───────────────────────
  if (!clienteId) {
    const { data: c } = await supabase.from('clientes')
      .select('id, nombre').eq('telefono', tel10).limit(1).maybeSingle()

    if (!c) {
      // Registro silencioso automático
      const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${tel10}`
      const qrCode = generateCloudinaryVIPCard(tel10, extra || 'Cliente Nuevo', 0, 0, false)

      const { data: nuevo } = await supabase.from('clientes').insert({
        telefono: tel10,
        nombre: 'Cliente Nuevo',
        puntos: 0,
        acepta_terminos: false,
        qr_code: loyaltyUrl
      }).select('id, nombre').maybeSingle()

      if (nuevo) {
        clienteId = nuevo.id
        clienteNombre = nuevo.nombre
        await sendWA(fromPhone, `ℹ️ El cliente no existía. Lo registré silenciosamente para guardar la foto.`)
      } else {
        await sendWA(fromPhone, `⚠️ No pude crear el registro para *${tel10}*.`)
        return new Response('OK', { status: 200 })
      }
    } else {
      clienteId = c.id
      clienteNombre = c.nombre
    }
  }

  await sendWA(fromPhone, `📸 Guardando foto de *${clienteNombre}*...`)

  // ── 5. Descargar de WhatsApp ──────────────────────────────────────────────
  const media = await downloadWhatsAppMedia(mediaId)
  if (!media) {
    await sendWA(fromPhone, `❌ No pude descargar la imagen. Intenta de nuevo.`)
    return new Response('OK', { status: 200 })
  }

  // ── 6. Subir a Storage ────────────────────────────────────────────────────
  const ext = media.mimeType.includes('png') ? 'png' : 'jpg'
  const filePath = `${tel10}/fachada_${Date.now()}.${ext}`
  const publicUrl = await uploadToStorage(supabase, BUCKET, filePath, media.buffer, media.mimeType)

  if (!publicUrl) {
    await sendWA(fromPhone, `❌ Error subiendo la foto al servidor. Intenta de nuevo.`)
    return new Response('OK', { status: 200 })
  }

  // ── 7. Guardar URL en clientes + nota si hay caption ─────────────────────
  const updates: Record<string, any> = { foto_fachada_url: publicUrl }
  if (caption && !caption.match(/^\d+$/)) {
    // El caption tiene texto descriptivo, guardarlo como nota
    const { data: c } = await supabase.from('clientes').select('notas_crm').eq('id', clienteId).maybeSingle()
    const notaActual = c?.notas_crm || ''
    const fecha = new Date().toLocaleDateString('es-MX')
    updates.notas_crm = notaActual
      ? `${notaActual}\n[${fecha}] 📸 ${caption}`
      : `[${fecha}] 📸 ${caption}`
  }

  await supabase.from('clientes').update(updates).eq('id', clienteId)

  const { sendInteractiveButton } = await import('./whatsapp.ts')
  await sendInteractiveButton(
    fromPhone,
    `✅ *Foto guardada* — ${clienteNombre} (${tel10})\n` +
    `${caption && !caption.match(/^\d+$/) ? `📝 Nota: _${caption}_\n` : ''}`,
    'ACT_CERRAR_SESION',
    'Cerrar Sesión'
  )
  return new Response('OK', { status: 200 })
}

// ── Enviar foto de fachada con nota como caption ──────────────────────────────
export async function enviarFotoCliente(
  fromPhone: string,
  fotoUrl: string | null,
  clienteNombre: string,
  notasCrm?: string | null
): Promise<void> {
  if (!fotoUrl) return
  try {
    // Usar la nota más reciente como caption — más útil que el nombre
    const primeraLinea = notasCrm?.split('\n').pop()?.trim() || ''
    const caption = primeraLinea.length > 0
      ? `📸 ${primeraLinea.substring(0, 900)}`
      : `📸 Fachada de ${clienteNombre}`
    await sendWAImage(fromPhone, fotoUrl, caption)
  } catch (e) {
    console.error('[MEDIA] Error enviando foto:', e)
  }
}
