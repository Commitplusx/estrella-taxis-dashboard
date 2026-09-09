const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

export async function verifyImageWithGemini(base64Data: string, mimeType: string = 'image/jpeg'): Promise<boolean> {
  if (!GEMINI_API_KEY) {
    console.warn('[GEMINI VISION] No GEMINI_API_KEY configurada. Fallback: imagen rechazada.');
    return false;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const payload = {
    contents: [{
      parts: [
        { text: "¿Esta imagen parece ser un ticket de caja, nota de venta o factura de consumo (físico impreso o captura digital) que muestra productos/precios? Responde estrictamente con 'true' si es un comprobante de consumo válido para facturar, o 'false' si es cualquier otra cosa (receta médica, selfie, meme, perro, billete, etc)." },
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Data
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 10
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error('[GEMINI VISION] Error API:', await res.text());
      return false;
    }

    const data = await res.json();
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text?.toLowerCase().trim() || '';
    
    console.log('[GEMINI VISION] Resultado de evaluación:', textResult);
    return textResult.includes('true');

  } catch (err) {
    console.error('[GEMINI VISION] Network error:', err);
    return false;
  }
}
