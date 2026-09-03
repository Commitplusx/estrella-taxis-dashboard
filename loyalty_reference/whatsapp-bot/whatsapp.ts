// â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
// whatsapp.ts â€” Helpers para enviar mensajes via WhatsApp Cloud API
// â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 

import { logError } from '../_shared/utils.ts'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
export const WA_TOKEN = Deno.env.get('YCLOUD_API_KEY') || Deno.env.get('WHATSAPP_TOKEN')!
export const WA_PHONE_ID = Deno.env.get('YCLOUD_SENDER_PHONE') || Deno.env.get('WHATSAPP_PHONE_ID')!

const WA_VERSION = Deno.env.get('WA_API_VERSION') || 'v22.0'
const WA_BASE = `https://api.ycloud.com/v2/whatsapp/messages/sendDirectly`
const WA_HEADERS = () => ({
  'X-API-Key': WA_TOKEN,
  'Content-Type': 'application/json',
})

// ── Realizamos la petición con reintentos para manejar fallos temporales de la red ──
export async function fetchConReintento(url: string, options: RequestInit, retries = 5): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeoutId)

      if (res.ok) return res
      if (res.status >= 500 || res.status === 429) {
        console.warn(`⚠️ [REINTENTO ${i + 1}/${retries}] WA API HTTP ${res.status}`)
        // Backoff exponencial: 1s, 2s, 4s, 8s, 10s
        const delay = Math.min(1000 * Math.pow(2, i), 10000)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      return res
    } catch (err: any) {
      console.warn(`âš ï¸ [REINTENTO ${i + 1}/${retries}] Network error: ${err.message}`)
      if (i === retries - 1) throw err
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
  throw new Error('Agotado máximo de reintentos WA')
}
// ── Descarga media de YCloud (usa la URL directa que YCloud incluye en el webhook) ──
export async function downloadYCloudMedia(mediaUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    // YCloud provee una URL temporal directa en msg.image.link / msg.audio.link
    // Intento 1: con X-API-Key header
    let res = await fetch(mediaUrl, {
      headers: { 'X-API-Key': WA_TOKEN },
      redirect: 'follow'
    })
    // Intento 2: sin auth (algunas URLs de YCloud son pre-firmadas y no necesitan header)
    if (!res.ok) {
      console.warn(`[downloadYCloudMedia] Intento 1 HTTP ${res.status}, reintentando sin auth header...`)
      res = await fetch(mediaUrl, { redirect: 'follow' })
    }
    if (!res.ok) {
      const body = await res.text()
      console.error(`[downloadYCloudMedia] HTTP ${res.status} - Body: ${body.slice(0, 200)}`)
      return null
    }
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    console.log(`[downloadYCloudMedia] ✅ OK content-type=${contentType}`)
    const mimeType = contentType.split(';')[0].trim()
    // Si YCloud devuelve JSON en lugar de binario, significa que hay un error
    if (mimeType === 'application/json' || mimeType === 'text/plain') {
      const text = await res.text()
      console.error(`[downloadYCloudMedia] YCloud devolvio texto/JSON en vez de binario: ${text.slice(0, 200)}`)
      return null
    }
    const buffer = await res.arrayBuffer()
    console.log(`[downloadYCloudMedia] Descargados ${buffer.byteLength} bytes, mimeType=${mimeType}`)
    if (buffer.byteLength === 0) {
      console.error('[downloadYCloudMedia] Archivo descargado esta vacio')
      return null
    }
    // encodeBase64 de Deno std es confiable y rápido
    const base64 = encodeBase64(new Uint8Array(buffer))
    console.log(`[downloadYCloudMedia] base64 generado: ${base64.length} chars`)
    return { base64, mimeType }
  } catch (e) {
    console.error('[downloadYCloudMedia] Error:', e)
    return null
  }
}

// ── Typing Indicator ──
export async function sendTypingIndicator(messageId: string): Promise<boolean> {
  try {
    const url = `https://api.ycloud.com/v2/whatsapp/inboundMessages/${messageId}/typingIndicator`
    console.log(`[sendTypingIndicator] Intentando para ID: ${messageId}`)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': WA_TOKEN,
        'Content-Type': 'application/json'
      }
    })
    
    if (!res.ok) {
      const errText = await res.text()
      console.error(`[sendTypingIndicator] Fallo HTTP ${res.status}: ${errText}`)
      return false
    }
    
    console.log(`[sendTypingIndicator] ✅ Exitoso para ${messageId}`)
    return true
  } catch (e) {
    console.error('[sendTypingIndicator] Error:', e)
    return false
  }
}

// ── QA INTERCEPTOR ──
function logQAInterceptor(to: string, bodyText: string, type: string) {
  if (to === '5215659515982') {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const promise = fetch(`${SUPABASE_URL}/rest/v1/bot_memory?on_conflict=phone`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          phone: 'qa_logs_5215659515982',
          history: [{ timestamp: Date.now(), from: 'bot', text: bodyText, type }]
        })
      }).catch(err => console.error('QA Interceptor Fetch Error:', err));
      
      try {
        // @ts-ignore
        if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(promise);
        else promise;
      } catch(e) {}
    }
  }
}

// ── Mark as Read ──
export async function markAsRead(messageId: string): Promise<boolean> {
  try {
    const url = `https://api.ycloud.com/v2/whatsapp/inboundMessages/${messageId}/markAsRead`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': WA_TOKEN,
        'Content-Type': 'application/json'
      }
    })
    if (!res.ok) {
      console.error(`[markAsRead] Fallo HTTP ${res.status}: ${await res.text()}`)
      return false
    }
    return true
  } catch (e) {
    console.error('[markAsRead] Error:', e)
    return false
  }
}

// ── Enviar Mensaje de Texto Simple ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function sendWA(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify({
        from: WA_PHONE_ID,
        to,
        type: 'text',
        text: { preview_url: true, body },
      }),
    })
    if (!res.ok) {
      const errText = await res.text();
      console.error('WA Error:', errText);
      await logError('whatsapp-bot', `WhatsApp API Error (Text)`, { phone: to, error: errText }, 'error');
      return { ok: false, error: errText }
    }
    else {
      logQAInterceptor(to, body, 'text');
      return { ok: true }
    }
  } catch (e: any) {
    console.error('WA Fatal Net Error:', e)
    await logError('whatsapp-bot', `WhatsApp Fatal Net Error (Text)`, { phone: to, error: String(e) }, 'critical');
    return { ok: false, error: e.message }
  }
}


// ── Imagen con caption ────────────────────────────────────────────────────────────────────────────────────────────────────
export async function sendWAImage(to: string, url: string, caption?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify({
        from: WA_PHONE_ID,
        to,
        type: 'image',
        image: { link: url, caption: caption?.substring(0, 1000) },
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('WA Image Error:', errText)
      return { ok: false, error: errText }
    }
    else {
      return { ok: true }
    }
  } catch (e) {
    console.error('WA Fatal Net Error (Image):', e)
    return { ok: false, error: String(e) }
  }
}



// ── Documento (PDF) ───────────────────────────────────────────────────────────────────────────────────────────────────────
export async function sendWADocument(to: string, url: string, filename: string, caption: string = ''): Promise<void> {
  try {
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify({
        from: WA_PHONE_ID,
        to,
        type: 'document',
        document: { link: url, caption: caption.substring(0, 1024), filename }
      })
    })
    if (!res.ok) console.error('WA Document Error:', await res.text())
  } catch (e) {
    console.error('WA Fatal Net Error (Document):', e)
  }
}

// ── Ubicación GPS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function sendWALocation(to: string, lat: number, lng: number, name: string, address: string): Promise<void> {
  try {
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify({
        from: WA_PHONE_ID,
        to,
        type: 'location',
        location: {
          latitude: lat,
          longitude: lng,
          name: name.substring(0, 1000),
          address: address.substring(0, 1000),
        },
      }),
    })
    if (!res.ok) console.error('WA Location Error:', await res.text())
  } catch (e) {
    console.error('WA Fatal Net Error (Location):', e)
  }
}

// ── Pedir Ubicación (Location Request Message) ────────────────────────────────────────────────────────────────────────────
export async function sendLocationRequest(to: string, text: string): Promise<void> {
  try {
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify({
        from: WA_PHONE_ID,
        to,
        type: 'interactive',
        interactive: {
          type: 'location_request_message',
          body: { text: text.substring(0, 1024) },
          action: { name: 'send_location' }
        },
      }),
    })
    if (!res.ok) console.error('WA Location Request Error:', await res.text())
    else logQAInterceptor(to, text, 'location_request')
  } catch (e) {
    console.error('WA Fatal Net Error (Location Request):', e)
  }
}

// ── Botón interactivo ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function sendInteractiveButton(
  to: string,
  text: string,
  buttonId: string,
  buttonTitle: string,
): Promise<void> {
  try {
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify({
        from: WA_PHONE_ID,
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: text.substring(0, 1024) },
          action: { buttons: [{ type: 'reply', reply: { id: buttonId, title: buttonTitle } }] },
        },
      }),
    })
    if (!res.ok) console.error('WA Interactive Error:', await res.text())
  } catch (e) {
    console.error('WA Fatal Net Error (Interactive):', e)
  }
}

// ── Botón CTA URL (Abrir Navegador dentro de WA) ──────────────────────────────────────────────────────────────────────────
export async function sendInteractiveCTAUrl(
  to: string,
  text: string,
  buttonTitle: string,
  url: string,
): Promise<void> {
  try {
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify({
        from: WA_PHONE_ID,
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: text.substring(0, 1024) },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: buttonTitle.substring(0, 20),
              url: url
            }
          }
        },
      }),
    })
    if (!res.ok) console.error('WA CTA URL Error:', await res.text())
  } catch (e) {
    console.error('WA Fatal Net Error (Interactive):', e)
  }
}

// ── Múltiples botones interactivos (hasta 3) ──────────────────────────────────────────────────────────────────────────────
// Intento 1: con imagen en header (si aplica)
// Intento 2: sin imagen en header
// Intento 3: texto plano con las opciones escritas
export async function sendInteractiveButtons(
  to: string,
  text: string,
  buttons: { id: string; title: string }[],
  headerImageUrl?: string
): Promise<boolean> {
  const btns = buttons.slice(0, 3).map(b => ({
    type: 'reply',
    reply: { id: b.id.substring(0, 256), title: b.title.substring(0, 20) }
  }))

  if (btns.length === 0) {
    console.warn('⚠️ sendInteractiveButtons: botones vacíos, mandando como texto.')
    await sendWA(to, text)
    return true
  }

  const buildPayload = (withImage: boolean): any => {
    const payload: any = {
      from: WA_PHONE_ID,
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: text.substring(0, 1024) },
        action: { buttons: btns },
      },
    }
    if (withImage && headerImageUrl) {
      payload.interactive.header = { type: 'image', image: { link: headerImageUrl } }
    }
    return payload
  }

  // Intento 1: con imagen
  if (headerImageUrl) {
    try {
      const res = await fetchConReintento(WA_BASE, { method: 'POST', headers: WA_HEADERS(), body: JSON.stringify(buildPayload(true)) })
      if (res.ok) {
        logQAInterceptor(to, text, 'interactive_buttons')
        return true
      }
      console.warn('WA Buttons+Image failed:', await res.text())
    } catch (e) { console.error('WA Buttons+Image exception:', e) }
  }

  // Intento 2: sin imagen
  try {
    const res = await fetchConReintento(WA_BASE, { method: 'POST', headers: WA_HEADERS(), body: JSON.stringify(buildPayload(false)) })
    if (res.ok) {
      logQAInterceptor(to, text, 'interactive_buttons')
      return true
    }
    console.warn('WA Buttons failed:', await res.text())
  } catch (e) { console.error('WA Buttons exception:', e) }

  // Intento 3: texto plano con las opciones
  console.warn('⚠️ Botones interactivos fallaron en todos los intentos. Mandando como texto plano.')
  try {
    const opts = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n')
    await sendWA(to, `${text}\n\n${opts}`)
    return true
  } catch (e) {
    console.error('WA Fallback text also failed:', e)
    return false
  }
}

// ── Lista interactiva (hasta 10 opciones) ─────────────────────────────────────────────────────────────────────────────────
export async function sendInteractiveList(
  to: string,
  text: string,
  buttonText: string,
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]
): Promise<void> {
  try {
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify({
        from: WA_PHONE_ID,
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: text.substring(0, 1024) },
          action: {
            button: buttonText.substring(0, 20),
            sections: sections.map(s => ({
              title: s.title.substring(0, 24),
              rows: s.rows.slice(0, 10).map(r => ({
                id: r.id.substring(0, 200),
                title: r.title.substring(0, 24),
                description: (r.description || '').substring(0, 72)
              }))
            }))
          },
        },
      }),
    })
    if (!res.ok) console.error('WA InteractiveList Error:', await res.text())
    else logQAInterceptor(to, text, 'interactive_list')
  } catch (e) {
    console.error('WA Fatal Net Error (InteractiveList):', e)
  }
}

// ── CTA URL Button (Abrir enlace) ─────────────────────────────────────────────────────────────────────────────────────────
export async function sendInteractiveCtaUrl(
  to: string,
  text: string,
  buttonText: string,
  url: string,
  headerText?: string
): Promise<void> {
  try {
    const payload: any = {
      from: WA_PHONE_ID,
      to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: text.substring(0, 1024) },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: buttonText.substring(0, 20),
            url: url
          }
        }
      }
    }
    
    if (headerText) {
      payload.interactive.header = {
        type: 'text',
        text: headerText.substring(0, 60)
      }
    }

    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify(payload),
    })
    if (!res.ok) console.error('WA CTA URL Error:', await res.text())
  } catch (e) {
    console.error('WA Fatal Net Error (CTA URL):', e)
  }
}

// ── Flow Button (Abrir Formulario Nativo) ─────────────────────────────────────────────────────────────────────────────────
export async function sendInteractiveFlow(
  to: string,
  text: string,
  buttonText: string,
  flowId: string,
  flowToken: string = 'FLOW_TOKEN',
  screenName: string,
  headerText?: string
): Promise<void> {
  try {
    const payload: any = {
      from: WA_PHONE_ID,
      to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: text.substring(0, 1024) },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: flowToken,
            flow_id: flowId,
            flow_cta: buttonText.substring(0, 20),
            flow_action: 'navigate',
            flow_action_payload: {
              screen: screenName
            }
          }
        }
      }
    }
    
    if (headerText) {
      payload.interactive.header = {
        type: 'text',
        text: headerText.substring(0, 60)
      }
    }

    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify(payload),
    })
    if (!res.ok) console.error('WA Flow Error:', await res.text())
  } catch (e) {
    console.error('WA Fatal Net Error (Flow):', e)
  }
}

// ── Plantilla Meta (WhatsApp Template) ────────────────────────────────────────────────────────────────────────────────────
export async function sendWATemplate(
  to: string,
  templateName: string,
  params: string[],
  mediaUrl?: string,
  buttonParam?: string,
  language: string = 'es_MX'
): Promise<{ ok: boolean; error?: string }> {
  try {
    const components: any[] = []

    // Si hay imagen (Header)
    if (mediaUrl) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: mediaUrl } }]
      })
    }

    // Cuerpo (Body Params)
    if (params.length > 0) {
      components.push({
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: p }))
      })
    }

    // BotÃ³n URL dinÃ¡mico (Opcional)
    if (buttonParam) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: buttonParam }]
      })
    }

    const payload = {
      from: WA_PHONE_ID,
      to,
      type: 'template',
      template: { name: templateName, language: { code: language }, components }
    }
    console.log(`[TEMPLATE] Enviando '${templateName}' a ${to} | componentes: ${JSON.stringify(components)}`)

    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify(payload),
    })

    const respText = await res.text()
    if (!res.ok) {
      console.error(`[TEMPLATE] âŒ '${templateName}' HTTP ${res.status} â†’ ${respText}`)
      await logError('whatsapp-bot', `WhatsApp Template Error: ${templateName}`, { phone: to, error: respText }, 'critical');
      return { ok: false, error: respText }
    }
    console.log(`[TEMPLATE] âœ… '${templateName}' enviada â†’ ${respText.substring(0, 120)}`)
    return { ok: true }
  } catch (e: any) {
    console.error(`[TEMPLATE] ðŸ’¥ Error fatal '${templateName}':`, e)
    await logError('whatsapp-bot', `WhatsApp Template Fatal Error: ${templateName}`, { phone: to, error: String(e) }, 'critical');
    return { ok: false, error: e.message }
  }
}

// â”€â”€ Smart VIP Card Sender (Try Free-Form, Fallback to Template) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function sendVIPCardSmart(
  to: string, // format 529631444160
  qrImageUrl: string,
  nombre: string,
  puntos: number,
  cTel: string
): Promise<{ ok: boolean; error?: string }> {
  // 1. Try sending as Free-Form Image message first (Requires 24h window open)
  const loyaltyUrl = `https://www.app-estrella.shop/loyalty/${cTel}`
  const caption = `ðŸŒŸ *Â¡Hola, ${nombre}!* AquÃ­ tienes tu *Tarjeta VIP Digital* actualizada.\n\nâ­ Puntos actuales: *${puntos}*\n\nðŸ”— *Abre tu Tarjeta VIP interactiva aquÃ­:* ${loyaltyUrl}`
  
  const freeFormResult = await sendWAImage(to, qrImageUrl, caption)
  
  if (freeFormResult.ok) {
    console.log(`[VIP_SMART] âœ… Imagen VIP enviada como texto libre a ${to}. (Ventana 24h abierta)`)
    return { ok: true }
  }

  // 2. If it fails (probably due to 24h window, error 131047), fallback to Template
  console.warn(`[VIP_SMART] âš ï¸ EnvÃ­o libre fallÃ³. Intentando con plantilla estrella_loyalty_welcome...`)
  const templateResult = await sendWATemplate(
    to,
    'estrella_loyalty_welcome',
    [nombre, puntos.toString()],
    qrImageUrl,
    cTel
  )

  return templateResult
}

// â”€â”€ Marcar mensaje como leÃ­do (Double Blue Ticks) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function markMessageAsRead(messageId: string, to: string): Promise<void> {
  try {
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify({
        from: WA_PHONE_ID,
        to,
        type: 'read',
        message_id: messageId,
      }),
    })
    if (!res.ok) console.error('WA Read Receipt Error:', await res.text())
  } catch (e) {
    console.error('WA Fatal Net Error (Read Receipt):', e)
  }
}

// â”€â”€ Notificar al Admin (Alertas de B2B y CrÃ­ticas) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function notifyAdmin(message: string): Promise<void> {
  const adminPhonesStr = Deno.env.get('ADMIN_PHONES') || Deno.env.get('ADMIN_PHONE') || ''
  const adminPhones = adminPhonesStr.split(',').map(p => p.trim()).filter(Boolean)
  
  if (adminPhones.length === 0) {
    console.warn('âš ï¸ No hay ADMIN_PHONES/ADMIN_PHONE configurados para notifyAdmin')
    return
  }

  // Solo notificamos al primer admin para evitar spam
  const primaryAdmin = adminPhones[0]
  let admin10 = primaryAdmin
  if (primaryAdmin.length > 10) admin10 = primaryAdmin.slice(-10)

  try {
    await sendWA(`52${admin10}`, `ðŸš¨ *ALERTA DEL SISTEMA*\n\n${message}`)
  } catch (e) {
    console.error('Error enviando notifyAdmin:', e)
  }
}

// â”€â”€ Mensaje de CatÃ¡logo Nativo (Ver CatÃ¡logo) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function sendCatalogMessage(
  to: string,
  text: string,
  thumbnailUrl?: string
): Promise<void> {
  try {
    const payload: any = {
      from: WA_PHONE_ID,
      to,
      type: 'interactive',
      interactive: {
        type: 'catalog_message',
        body: { text: text.substring(0, 1024) },
        action: {
          name: 'catalog_message',
          parameters: {
            thumbnail_product_retailer_id: 'jmc2srsjum'
          }
        }
      }
    };
    
    const res = await fetchConReintento(WA_BASE, {
      method: 'POST',
      headers: WA_HEADERS(),
      body: JSON.stringify(payload),
    });
    
    if (!res.ok) console.error('WA Catalog Message Error:', await res.text());
  } catch (e) {
    console.error('WA Fatal Net Error (Catalog Message):', e);
  }
}

