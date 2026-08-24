import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { summary, events } = await req.json();

    const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY no está configurada');
    }

    // Build the prompt
    const systemPrompt = 
      Eres el Auditor Jefe de Flotilla de Taxis Estrella.
      Analiza el siguiente reporte de la flotilla y genera un resumen directivo de máximo 4 párrafos en Markdown.
      Destaca 3 puntos:
      1. Riesgos de seguridad o anomalías (ej: desconexiones de GPS frecuentes, excesos de velocidad severos).
      2. Eficiencia operativa (ej: vehículos inactivos, exceso de tiempo de motor encendido sin avanzar).
      3. Conclusión o recomendación operativa.
      
      Usa un tono profesional pero directo, en español.
      Si todo está normal, dilo claramente. Si hay un conductor que requiere atención, menciónalo.
    ;

    const userPrompt = 
      Resumen de los Taxis (Distancia, V. Promedio, V. Máx, Horas Motor):
      
      
      Eventos y Alertas Relevantes:
      
    ;

    console.log('Sending request to DeepSeek...');

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': Bearer 
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errTxt = await response.text();
      console.error('DeepSeek Error:', errTxt);
      throw new Error('Error al consultar DeepSeek: ' + response.status);
    }

    const data = await response.json();
    const aiMessage = data.choices[0].message.content;

    return new Response(JSON.stringify({ text: aiMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
