const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent`;

/**
 * Verifica con Gemini Vision si una IMAGEN es un ticket/comprobante de consumo válido.
 *
 * Nota: Para documentos PDF se retorna `true` directamente sin consultar Gemini.
 * La validación visual está diseñada para filtrar fotos fraudulentas (selfies, memes, billetes, etc.).
 * Los PDFs en contexto de facturación son casi siempre documentos fiscales legítimos;
 * la validación real la realiza el contador humano al revisar el documento.
 */
export async function verifyImageWithGemini(base64Data: string, mimeType: string = 'image/jpeg'): Promise<boolean> {
  if (!GEMINI_API_KEY) {
    console.warn('[GEMINI VISION] No GEMINI_API_KEY configurada. Imagen rechazada.');
    return false;
  }

  // PDFs: aceptar directamente, sin llamar a Gemini.
  if (mimeType.includes('pdf')) {
    console.log('[GEMINI VISION] PDF detectado — aceptado automáticamente.');
    return true;
  }

  const prompt = "¿Esta imagen parece ser un ticket de caja, nota de venta o factura de consumo (físico impreso o captura digital) que muestra productos/precios? Responde estrictamente con 'true' si es un comprobante de consumo válido para facturar, o 'false' si es cualquier otra cosa (receta médica, selfie, meme, perro, billete, etc).";

  const payload = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
  };

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error('[GEMINI VISION] Error API:', await res.text());
      return false;
    }

    const data = await res.json();
    const textResult = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().toLowerCase();
    console.log(`[GEMINI VISION] Resultado (${mimeType}):`, textResult);

    return textResult.includes('true');
  } catch (err) {
    console.error('[GEMINI VISION] Network error:', err);
    return false;
  }
}

/**
 * Lee un PDF con Gemini y extrae los datos fiscales que contenga
 * (RFC, Razón Social, Código Postal, Régimen Fiscal, Uso de CFDI).
 *
 * Útil cuando el cliente envía su Constancia de Situación Fiscal del SAT.
 * Retorna un string con los datos extraídos, o null si el PDF no los contiene.
 */
export async function extractFiscalDataFromPdf(base64Data: string): Promise<string | null> {
  if (!GEMINI_API_KEY) {
    console.warn('[GEMINI FISCAL] No GEMINI_API_KEY configurada.');
    return null;
  }

  const prompt = `Analiza este documento fiscal. Extrae los datos y devuélvelos en texto plano. No importa si no encuentras todos, extrae los que puedas de esta lista, uno por línea:
RFC: [valor]
RazonSocial: [valor]
CodigoPostal: [valor]
RegimenFiscal: [valor]
UsoCFDI: [valor]

Si es un comprobante sin datos fiscales reales, responde NO_FISCAL.`;

  const payload = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'application/pdf', data: base64Data } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
  };

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error('[GEMINI FISCAL] Error API:', await res.text());
      return null;
    }

    const data = await res.json();
    let textResult = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    console.log('[GEMINI FISCAL] Datos crudos:', textResult.slice(0, 300));

    if (!textResult || textResult.toUpperCase().includes('NO_FISCAL')) return null;

    // Extracción resiliente por Regex, aunque el modelo se corte a la mitad, rescatamos lo que haya
    const extract = (key: string) => {
      const match = textResult.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
      return match ? match[1].trim() : 'No encontrado';
    };

    const rfc = extract('RFC');
    if (rfc === 'No encontrado') return null; // RFC es el único vital

    const razon = extract('RazonSocial');
    const cp = extract('CodigoPostal');
    const reg = extract('RegimenFiscal');
    const uso = extract('UsoCFDI');

    // Retornamos el formato limpio exacto que espera GPT-4o
    return `RFC: ${rfc}\nRazón Social: ${razon}\nCódigo Postal: ${cp}\nRégimen Fiscal: ${reg}\nUso de CFDI: ${uso}`;
  } catch (err) {
    console.error('[GEMINI FISCAL] Network error:', err);
    return null;
  }
}
