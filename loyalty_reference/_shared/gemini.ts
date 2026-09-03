export async function callGemini(
  messages: any[],
  model: 'gemini-3.6-flash' | 'gemini-3.1-pro-preview',
  maxTokens: number = 300,
  isJson: boolean = true
): Promise<string | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    console.error('[GEMINI] Faltó GEMINI_API_KEY en variables de entorno')
    return null
  }

  let systemPrompt = ''
  const geminiContents: any[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt += msg.content + '\n'
    } else {
      // Convertir 'assistant' a 'model'
      const role = msg.role === 'assistant' ? 'model' : 'user'
      geminiContents.push({
        role,
        parts: [{ text: msg.content }]
      })
    }
  }

  // Si no hay mensajes de user/model, agregar uno vacío para que la API no rechace (requiere al menos un content)
  if (geminiContents.length === 0) {
      geminiContents.push({ role: 'user', parts: [{ text: 'Hola' }] })
  }

  const payload: any = {
    contents: geminiContents,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: maxTokens
    }
  }

  if (systemPrompt) {
    payload.systemInstruction = {
      parts: [{ text: systemPrompt.trim() }]
    }
  }

  if (isJson) {
    payload.generationConfig.responseMimeType = 'application/json'
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))])

  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await withTimeout(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }), 7000)

      if (!res || !res.ok) {
        if (!res) {
          console.error(`[GEMINI] Error timeout (intento ${intento + 1})`)
        } else {
           const errJson = await res.text()
           console.error(`[GEMINI] Error de API HTTP ${res.status}:`, errJson)
        }
        if (intento === 0) { await new Promise(r => setTimeout(r, 2000)); continue }
        return null
      }
      
      const json = await res.json()
      let text = json.candidates?.[0]?.content?.parts?.[0]?.text || ''
      if (isJson) {
        text = text.replace(/```json?/g, '').replace(/```/g, '').trim()
      }
      return text || null
    } catch (e) {
      console.error(`[GEMINI] Excepción local (intento ${intento + 1}):`, e)
      if (intento === 0) { await new Promise(r => setTimeout(r, 2000)); continue }
      return null
    }
  }
  return null
}

export async function callGeminiWithTools(
  messages: any[],
  tools: any[],
  model: string = 'gemini-3.1-pro-preview-customtools',
  maxTokens: number = 800
): Promise<any | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return null

  let systemPrompt = ''
  const geminiContents: any[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt += msg.content + '\n'
    } else if (msg.role === 'function') {
      if (msg.functionResponses) {
        geminiContents.push({
          role: 'user',
          parts: msg.functionResponses.map((r: any) => ({ functionResponse: r }))
        })
      } else {
        geminiContents.push({
          role: 'user', 
          parts: [{ functionResponse: msg.functionResponse }]
        })
      }
    } else if (msg.role === 'assistant' && (msg.functionCall || msg.functionCalls)) {
      if (msg.functionCalls) {
        geminiContents.push({
          role: 'model',
          parts: msg.functionCalls.map((c: any) => ({ functionCall: c.functionCall || c, thoughtSignature: c.thoughtSignature }))
        })
      } else {
        geminiContents.push({
          role: 'model',
          parts: [{ functionCall: msg.functionCall, thoughtSignature: msg.thoughtSignature }]
        })
      }
    } else {
      const role = msg.role === 'assistant' ? 'model' : 'user'
      if (msg.parts) {
        geminiContents.push({ role, parts: msg.parts })
      } else {
        geminiContents.push({ role, parts: [{ text: msg.content }] })
      }
    }
  }

  const payload: any = {
    contents: geminiContents,
    tools: [{ function_declarations: tools }],
    generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens }
  }

  if (systemPrompt) payload.systemInstruction = { parts: [{ text: systemPrompt.trim() }] }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))])

  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await withTimeout(
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
        25000 // 25s timeout — Gemini tools puede tardar con búsquedas
      )
      if (!res) {
        console.error(`[GEMINI TOOLS] Timeout en intento ${intento + 1}`)
        if (intento === 0) { await new Promise(r => setTimeout(r, 1000)); continue }
        return null
      }
      if (!res.ok) {
        const errText = await res.text()
        console.error(`[GEMINI TOOLS] Error HTTP ${res.status}:`, errText)
        if (intento === 0) { await new Promise(r => setTimeout(r, 2000)); continue }
        return null
      }
      const json = await res.json()
      if (json.candidates?.[0]?.content) {
        return json.candidates[0].content
      }
      console.error('[GEMINI TOOLS] Respuesta sin candidates:', JSON.stringify(json).substring(0, 300))
      return null
    } catch (e) {
      console.error('[GEMINI TOOLS] Excepción:', e)
      if (intento === 0) { await new Promise(r => setTimeout(r, 2000)); continue }
      return null
    }
  }
  return null
}
