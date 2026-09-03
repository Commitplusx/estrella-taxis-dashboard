import "https://deno.land/std@0.177.0/dotenv/load.ts";

async function generarPreguntaReferenciasIA(origenInfo: string, destinoInfo: string): Promise<string> {
  try {
    const key = Deno.env.get('DEEPSEEK_API_KEY') || Deno.env.get('OPENAI_API_KEY')
    if (!key) throw new Error("Falta API KEY")
    
    const url = Deno.env.get('DEEPSEEK_API_KEY') ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions'
    const model = Deno.env.get('DEEPSEEK_API_KEY') ? 'deepseek-chat' : 'gpt-4o-mini'
    
    const prompt = `Eres un asistente logístico experto. Tu objetivo es preguntarle al cliente los detalles finales de su envío (mandadito) de forma MUY CORTA, amable y usando emojis.
Origen: ${origenInfo}
Destino: ${destinoInfo}

Reglas de deducción ("Criterio"):
1. Si el origen parece un restaurante, taquería o comercio (ej. Domino's), debes pedir a nombre de quién está el pedido, si hay número de ticket/orden, y si el repartidor debe pagarlo al recoger.
2. Si el origen es una casa, pide alguna referencia para encontrarla.
3. Si el destino es una casa o colonia, pide el número de celular de quien recibe (si no lo han dado) y referencias del color/portón.
4. Si el destino es un comercio o lugar público, pide a quién debe buscar el repartidor.
5. Integra todo en UNA SOLA pregunta natural y concisa (máximo 2-3 renglones).
6. Agrega al final "(Si no aplica, escribe 'no')".
Responde ÚNICAMENTE con el texto exacto del mensaje que se enviará al cliente por WhatsApp.`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.2
      })
    })
    
    const json = await res.json()
    return json.choices?.[0]?.message?.content?.trim() || "Error en JSON"
  } catch (e: any) {
    return "Error: " + e.message
  }
}

const escenarios = [
  {
    desc: "1. Casa a Calle (solo calle sin número)",
    origen: "mi casa",
    destino: "4a avenida pte sur"
  },
  {
    desc: "2. Compras en Supermercado",
    origen: "Bodega Aurrera",
    destino: "Fraccionamiento Las Palmas"
  },
  {
    desc: "3. Comida ya mencionando a quién está (Debería notar que falta si se paga)",
    origen: "Domino's Pizza a nombre de Caleb Vazquez",
    destino: "Centro Médico Comitán"
  },
  {
    desc: "4. Recoger objeto olvidado (Llaves)",
    origen: "Casa de mi suegra en Barrio La Cueva (recoger llaves)",
    destino: "Mi casa"
  },
  {
    desc: "5. Negocio Local (Carnicería)",
    origen: "Carnicería el Torito",
    destino: "Colonia Miguel Alemán"
  }
];

async function correrPruebas() {
  console.log("🚀 INICIANDO SIMULACIÓN DEL CRITERIO DE IA 🚀\n");
  for (const esc of escenarios) {
    console.log(`\n======================================================`);
    console.log(`▶ ESCENARIO: ${esc.desc}`);
    console.log(`📍 Origen  : ${esc.origen}`);
    console.log(`🏁 Destino : ${esc.destino}`);
    console.log(`⏳ Analizando con IA...`);
    
    const respuesta = await generarPreguntaReferenciasIA(esc.origen, esc.destino);
    console.log(`\n🤖 BOT RESPONDERÍA:\n${respuesta}`);
  }
  console.log(`\n======================================================\n`);
}

correrPruebas();
