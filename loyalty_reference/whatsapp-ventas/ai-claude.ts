// ── Mesero IA — Motor DeepSeek-V4-Pro ─────────────────────────────────────────
// Usamos la API compatible con OpenAI de DeepSeek (mismo formato que ya usamos en el bot)
// Ventaja clave: 1M tokens de contexto = menús enormes sin problema

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

export async function procesarPedidoClaude(
  fromPhone: string,
  from10: string,
  textoUsuario: string,
  sessionData: any,
  apiKey: string
) {
  const menuText = sessionData.menuText || 'No hay menú disponible.'
  const cart: any[] = sessionData.cart || []
  // Clonar array para no mutar el sessionData original
  const history: any[] = [...(sessionData.history || [])]

  // Agregar mensaje actual del usuario
  history.push({ role: 'user', content: textoUsuario })

  // Conservar solo los últimos 20 mensajes (con 1M de contexto podríamos poner más)
  const MAX_HISTORY = 20
  const trimmed = history.slice(-MAX_HISTORY)
  // Asegurar que el primer msg siempre sea 'user' (requerido por la API)
  while (trimmed.length > 0 && trimmed[0].role !== 'user') trimmed.shift()
  history.splice(0, history.length, ...trimmed)

  const systemPrompt = `Eres el mesero virtual súper amigable y atento del restaurante "${sessionData.restauranteNombre}" atendiendo por WhatsApp.
Tu objetivo es tomar la orden del cliente usando lenguaje natural, ayudándolo a elegir y armando su carrito de compras.

MENÚ DEL RESTAURANTE:
${menuText}

CARRITO ACTUAL DEL CLIENTE (JSON):
${JSON.stringify(cart, null, 2)}

REGLAS ESTRICTAS:
1. SIEMPRE responde con un JSON válido en el siguiente formato — NADA más, sin texto extra antes o después.
2. NUNCA inventes productos o precios que no estén en el Menú. Usa EXACTAMENTE los precios del menú.
3. Si el cliente pide algo que no está en el menú, discúlpate y ofrécele algo similar.
4. Tu "respuesta_al_cliente" debe ser corta (máximo 2-3 líneas), usando emojis (estilo Uber Eats). Usa "|||" para separar en múltiples burbujas de WhatsApp.
5. Si el cliente pide agregar o quitar algo, actualiza "items_del_carrito" devolviendo el carrito completo con los cambios. Pon accion "ACTUALIZAR_CARRITO".
6. Cuando el cliente diga que ya es todo, muestra el resumen con total y pide la dirección. Pon accion "PEDIR_DIRECCION".
7. Si ya tienes la dirección y el cliente confirma, pon accion "CONFIRMAR_PEDIDO".
8. Si el cliente cancela o dice "olvídalo", pon accion "CANCELAR_PEDIDO" con el carrito vacío.
9. Si el cliente quiere usar un código de descuento o cupón, pon accion "APLICAR_CUPON" y devuelve el código en "codigo_cupon".

FORMATO DE RESPUESTA (solo JSON, sin markdown, sin bloques de código):
{
  "accion": "ACTUALIZAR_CARRITO" | "PEDIR_DIRECCION" | "CONFIRMAR_PEDIDO" | "CANCELAR_PEDIDO" | "APLICAR_CUPON" | "RESPONDER",
  "items_del_carrito": [
    { "nombre": "Nombre del producto", "cantidad": 2, "precioUnitario": 50, "notas": "sin cebolla" }
  ],
  "codigo_cupon": "CUPON123",
  "respuesta_al_cliente": "Tu respuesta aquí 😊|||Segunda burbuja si es necesario"
}`

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history
  ]

  const reqBody = {
    // deepseek-v4-pro = modelo oficial V4 con 1M contexto (deepseek-chat deprecado julio 2026)
    model: 'deepseek-v4-pro',
    messages,
    temperature: 0.3,      // Baja temperatura = más consistente para pedidos
    max_tokens: 800,
    response_format: { type: 'json_object' }  // Forzar JSON puro
  }

  // BUG FIX: Add 20s timeout to prevent edge function hangs if DeepSeek is slow
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  let res: Response
  try {
    res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    })
  } catch (fetchErr: any) {
    clearTimeout(timeout)
    if (fetchErr?.name === 'AbortError') {
      console.error('[waiter-ai] DeepSeek timeout (20s)')
      return { error: true, msg: 'Timeout calling AI' }
    }
    console.error('[waiter-ai] Fetch error:', fetchErr)
    return { error: true, msg: String(fetchErr) }
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) {
    const err = await res.text()
    console.error('❌ [waiter-ai] Error DeepSeek:', err)
    return { error: true }
  }

  const data = await res.json()
  const rawContent = data.choices?.[0]?.message?.content

  if (!rawContent) {
    console.error('❌ [waiter-ai] DeepSeek devolvió respuesta vacía:', JSON.stringify(data))
    return { error: true, msg: 'Empty response' }
  }

  // Parsear el JSON de respuesta
  let parsed: any
  try {
    parsed = JSON.parse(rawContent)
  } catch (e) {
    // Intentar extraer JSON si vino con texto extra (fallback seguro)
    const match = rawContent.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { parsed = null }
    }
    if (!parsed) {
      console.error('❌ [waiter-ai] No se pudo parsear JSON:', rawContent)
      return { error: true, msg: 'JSON parse error' }
    }
  }

  const accion = parsed.accion || 'RESPONDER'
  const nuevoCarrito = Array.isArray(parsed.items_del_carrito) ? parsed.items_del_carrito : cart
  const mensaje = parsed.respuesta_al_cliente || '¿Cómo te puedo ayudar? 😊'

  // Persistir la respuesta del asistente en el historial
  history.push({ role: 'assistant', content: mensaje })

  return {
    error: false,
    accion,
    nuevoCarrito,
    mensaje,
    nuevoHistorial: history,
    codigoCupon: parsed.codigo_cupon || null   // para el handler de cupones
  }
}
