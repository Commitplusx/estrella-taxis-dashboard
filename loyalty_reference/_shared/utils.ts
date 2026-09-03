// ══════════════════════════════════════════════════════════════════════════════
// _shared/utils.ts — Utilidades compartidas entre Edge Functions
// ══════════════════════════════════════════════════════════════════════════════
// Elimina código duplicado entre whatsapp-bot y notificar-whatsapp.

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || 'https://app-estrella.shop'

export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Extrae los últimos 10 dígitos de un teléfono (estándar MX) */
export function extract10Digits(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

/** Formatea un teléfono a formato internacional MX (52 + 10 dígitos) */
export function formatTel(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return `52${digits.slice(-10)}`
}

/** Genera número de orden legible: EST-00123 (últimos 5 chars del UUID) */
export function generarNumeroOrden(pedidoId: string): string {
  const shortId = pedidoId.replace(/-/g, '').slice(-5).toUpperCase()
  return `EST-${shortId}`
}

/**
 * Genera la URL de la Tarjeta VIP compuesta con Cloudinary
 * Base image: vip-nuevo (diseño horizontal Estrella Delivery)
 */
export function generateCloudinaryVIPCard(
  telefono: string,
  nombreRaw: string,
  puntos: number,
  saldo: number,
  esVip: boolean = false
): string {
  const tel10 = extract10Digits(telefono);
  const loyaltyUrl = `https://app-estrella.shop/loyalty/${tel10}`;

  // QR generado con QuickChart (sin margin para acortar URL)
  const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(loyaltyUrl)}`;

  // Codificar la URL del QR en base64url para el fetch layer de Cloudinary
  let qrB64 = btoa(qrUrl).replace(/\+/g, '-').replace(/\//g, '_');

  const baseCloudinary = `https://res.cloudinary.com/dlgcf3cht/image/upload`;

  // Escalar la imagen base a 1000px de ancho para estabilizar coordenadas.
  // El QR se posiciona sobre el recuadro blanco de la derecha.
  const transforms = [
    `c_scale,w_1000`,
    `l_fetch:${qrB64}/c_scale,w_220/fl_layer_apply,g_north_west,x_695,y_305`
  ].join('/');

  return `${baseCloudinary}/${transforms}/vip-nuevo`;
}


/**
 * Genera link al pedido.
 * NOTA: Si el pedido tiene access_token (columna UUID dedicada), úsalo.
 * Si no (registros viejos), cae al fallback del slice del UUID.
 */
export function pedidoLink(pedidoId: string, accessToken?: string): string {
  const BASE_LINK = 'https://www.estrella-eats.mx/pedido'
  const key = accessToken || pedidoId.replace(/-/g, '').slice(0, 8)
  return `${BASE_LINK}/${pedidoId}?key=${key}`
}

/** 
 * Registra un error en la base de datos y opcionalmente envía alerta a Discord
 * si la severidad es 'critical'.
 */
export async function logError(
  source: 'whatsapp-bot' | 'frontend' | 'notificar-whatsapp',
  message: string,
  metadata: Record<string, any> = {},
  severity: 'info' | 'warn' | 'error' | 'critical' = 'error'
) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

    if (supabaseUrl && supabaseKey) {
      // Intentar escribir en la tabla system_logs mediante REST
      await fetch(`${supabaseUrl}/rest/v1/system_logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ level: severity, source, message, metadata })
      }).catch(e => console.error('Failed to write to system_logs', e));
    } else {
      console.error(`[${severity.toUpperCase()}] ${source}: ${message}`, metadata);
    }

    // Alerta a Discord solo si es crítico
    if (severity === 'critical') {
      const webhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL');
      if (webhookUrl) {
        const rawContent = `🚨 **ALERTA CRÍTICA** en \`${source}\`\n**Error:** ${message}\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\``
        const discordMsg = {
          content: rawContent.substring(0, 1900) // Discord hard limit is 2000 chars
        };
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discordMsg)
        }).catch(e => console.error('Failed to send discord webhook', e));
      }
    }
  } catch (err) {
    console.error('Crash in logError helper:', err);
  }
}

/**
 * Fetch wrapper con timeout automático para prevenir cuelgues
 * @param url - URL a fetchear
 * @param options - Opciones fetch (method, headers, body, etc)
 * @param timeoutMs - Timeout en milisegundos (default: 15000ms = 15s)
 * @returns Response o throw error si timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms to ${url}`);
    }
    throw error;
  }
}

/**
 * Manejo robusto de idempotencia para mensajes de webhook
 * Estados: "processing" → "completed" | "failed" (no marked)
 * Previene procesamiento duplicado con stale lock cleanup (5 min)
 * 
 * @param supabase - Cliente Supabase
 * @param messageId - ID único del mensaje (webhook)
 * @returns { isDuplicate, shouldProcess } - Si es duplicado o debe procesarse
 */
export async function checkAndMarkProcessing(
  supabase: any,
  messageId: string
): Promise<{ isDuplicate: boolean; shouldProcess: boolean }> {
  const staleTimeMs = 5 * 60 * 1000; // 5 minutos
  const nowMs = Date.now();
  const statusKey = `msg_status:${messageId}`;

  // Buscar estado actual
  const { data: existing } = await supabase
    .from('bot_memory')
    .select('history, updated_at')
    .eq('phone', statusKey)
    .maybeSingle();

  if (existing) {
    const status = existing.history?.[0];
    const updatedAtMs = new Date(existing.updated_at).getTime();
    const ageMs = nowMs - updatedAtMs;

    // Si está "completed" → es duplicado seguro
    if (status?.state === 'completed') {
      return { isDuplicate: true, shouldProcess: false };
    }

    // Si está "processing" y es reciente (< 5min) → es duplicado
    if (status?.state === 'processing' && ageMs < staleTimeMs) {
      return { isDuplicate: true, shouldProcess: false };
    }

    // Si está "processing" pero stale (> 5min) → permitir reprocesar
    if (status?.state === 'processing' && ageMs >= staleTimeMs) {
      // Limpiar stale lock
      await supabase.from('bot_memory').delete().eq('phone', statusKey);
      // Marcar como nuevo
      await supabase.from('bot_memory').insert({
        phone: statusKey,
        history: [{ state: 'processing', startedAt: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      });
      return { isDuplicate: false, shouldProcess: true };
    }
  } else {
    // Primera vez: marcar como "processing"
    try {
      await supabase.from('bot_memory').insert({
        phone: statusKey,
        history: [{ state: 'processing', startedAt: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      });
      return { isDuplicate: false, shouldProcess: true };
    } catch (e: any) {
      // Si falla insert (duplicate key), es un race condition
      if (e.code === '23505' || e.message?.includes('duplicate key')) {
        return { isDuplicate: true, shouldProcess: false };
      }
      throw e;
    }
  }

  return { isDuplicate: false, shouldProcess: true };
}

/**
 * Marca un mensaje como completamente procesado
 * @param supabase - Cliente Supabase
 * @param messageId - ID único del mensaje
 */
export async function markProcessingComplete(supabase: any, messageId: string): Promise<void> {
  const statusKey = `msg_status:${messageId}`;
  await supabase.from('bot_memory').upsert({
    phone: statusKey,
    history: [{ state: 'completed', completedAt: new Date().toISOString() }],
    updated_at: new Date().toISOString(),
  });
}

export function normalizarAbreviaturas(texto: string): string {
  if (!texto) return "";
  let norm = texto.toLowerCase();
  norm = norm.replace(/\b1(?:ra|er)\b/g, "primera");
  norm = norm.replace(/\b2(?:da|do)\b/g, "segunda");
  norm = norm.replace(/\b3(?:ra|er)\b/g, "tercera");
  norm = norm.replace(/\b4(?:ta|to)\b/g, "cuarta");
  norm = norm.replace(/\b5(?:ta|to)\b/g, "quinta");
  norm = norm.replace(/\b6(?:ta|to)\b/g, "sexta");
  norm = norm.replace(/\b7(?:ma|mo)\b/g, "septima");
  norm = norm.replace(/\b8(?:va|vo)\b/g, "octava");
  norm = norm.replace(/\b9(?:na|no)\b/g, "novena");
  norm = norm.replace(/\b10(?:ma|mo)\b/g, "decima");
  norm = norm.replace(/\b11(?:va|vo)\b/g, "onceava");
  norm = norm.replace(/\b12(?:va|vo)\b/g, "doceava");
  norm = norm.replace(/\bav\b/g, "avenida");
  norm = norm.replace(/\bnte\b/g, "norte");
  norm = norm.replace(/\bsur\b/g, "sur"); // redundante pero bueno
  norm = norm.replace(/\bote\b/g, "oriente");
  norm = norm.replace(/\bpte\b/g, "poniente");
  norm = norm.replace(/\bblvd\b/g, "bulevar");
  norm = norm.replace(/\bfracc\b/g, "fraccionamiento");
  norm = norm.replace(/\bcol\b/g, "colonia");
  norm = norm.replace(/\bbarr\b/g, "barrio");
  norm = norm.replace(/\bprol\b/g, "prolongacion");
  norm = norm.replace(/\blib\b/g, "libramiento");
  norm = norm.replace(/\bctra\b/g, "carretera");
  norm = norm.replace(/\bcarr\b/g, "carretera");
  return norm.trim();
}

// ─── RATE LIMITING ───────────────────────────────────────────────────────────
/**
 * Rate limiter distribuido usando la tabla otp_codes como almacén de contadores.
 * Estrategia: Ventana deslizante de 60 segundos.
 * @param supabase - Cliente Supabase con service role
 * @param key - Identificador único (ej: 'otp:5219631234567', 'canjear:5219631234567')
 * @param maxRequests - Máximo de requests permitidos en la ventana
 * @param windowSeconds - Duración de la ventana en segundos (default: 60)
 * @returns { allowed: boolean, remaining: number, resetAt: string }
 */
export async function rateLimit(
  supabase: any,
  key: string,
  maxRequests: number,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString()
  const windowEnd = new Date(Date.now() + windowSeconds * 1000).toISOString()
  const rlKey = `rl:${key}`

  // Contar requests recientes en la ventana
  const { count } = await supabase
    .from('rate_limit_log')
    .select('*', { count: 'exact', head: true })
    .eq('key', rlKey)
    .gte('created_at', windowStart)

  const currentCount = count ?? 0

  if (currentCount >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: windowEnd
    }
  }

  // Registrar este request
  await supabase.from('rate_limit_log').insert({ key: rlKey })

  // Limpiar registros viejos (en background, no bloquea)
  supabase.from('rate_limit_log')
    .delete()
    .lt('created_at', new Date(Date.now() - windowSeconds * 2 * 1000).toISOString())
    .then(() => {}).catch(() => {})

  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    resetAt: windowEnd
  }
}

// ─── CORS RESTRINGIDO ────────────────────────────────────────────────────────
export function getCorsHeaders(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

/**
 * Respuesta de Rate Limit (429 Too Many Requests)
 */
export function rateLimitResponse(corsHeaders: Record<string, string>, resetAt: string): Response {
  return new Response(
    JSON.stringify({ error: 'Demasiadas solicitudes. Intenta en un momento.', resetAt }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': '60'
      }
    }
  )
}
