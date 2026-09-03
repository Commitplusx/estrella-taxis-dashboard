import "https://deno.land/std@0.177.0/dotenv/load.ts";

// ── 🚀 MOTOR DE SIMULACIÓN IA ─────────────────────────────────────
async function simularCriterioIA(origenInfo: string, destinoInfo: string, useMock: boolean): Promise<string> {
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
Responde ÚNICAMENTE con el texto exacto del mensaje que se enviará al cliente por WhatsApp.`;

  if (!useMock) {
    try {
      const key = Deno.env.get('DEEPSEEK_API_KEY') || Deno.env.get('OPENAI_API_KEY');
      const url = Deno.env.get('DEEPSEEK_API_KEY') ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions';
      const model = Deno.env.get('DEEPSEEK_API_KEY') ? 'deepseek-chat' : 'gpt-4o-mini';

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 150, temperature: 0.2 })
      });
      const json = await res.json();
      return json.choices?.[0]?.message?.content?.trim() || "Error en JSON";
    } catch (e: any) {
      return "Error de red: " + e.message;
    }
  } else {
    // ── RESPUESTAS MOCK (Pre-computadas por IA) ──
    if (origenInfo.includes("Domino")) return "¡Súper! 🍕 Como pasaremos a Domino's, ¿me podrías dar el nombre o número de tu orden y confirmar si hay que pagar algo al recoger? Además, ¿me pasas el celular de la persona que recibe en el Polígono 5? 📱\n_(Si no aplica, escribe 'no')_";
    if (origenInfo.includes("Bodega")) return "¡Claro que sí! 🛒 Como es compra en Aurrera, ¿el repartidor debe pagarlo, verdad? Por favor, regálame el número de celular de quien recibe en tu trabajo y a quién debe buscar. 📞\n_(Si no aplica, escribe 'no')_";
    if (origenInfo.includes("Casa de mi suegra")) return "¡Entendido! 🔑 Para que el repartidor no se pierda, ¿me das alguna seña o color de la casa en el Barrio La Cueva? 🏠 Y para la entrega en tu casa, ¿alguna referencia del portón o fachada?\n_(Si no tienes ninguna, escribe 'no')_";
    if (origenInfo.includes("oficina")) return "¡Listo! 📄 Para recoger en el centro, ¿alguna referencia de tu oficina? Y al llegar al Centro Médico Comitán, ¿por quién debe preguntar el repartidor o en qué área se entrega? 🏥\n_(Si no aplica, escribe 'no')_";
    if (origenInfo.includes("Liverpool")) return "¡Perfecto! 🛍️ Para recoger en Liverpool, ¿tienes algún número de pedido, folio de Click & Collect y el nombre de a quién está? Y para entregar en Fraccionamiento Las Palmas, ¿me pasas el número de quien recibe y alguna seña de la casa? 🏠\n_(Si no aplica, escribe 'no')_";
    if (origenInfo.includes("mi casa")) return "¡Entendido! 🛵 Para recoger en tu casa, ¿me das alguna seña de tu fachada o portón? Y para la entrega en la 4a calle sur poniente, ¿me pasas el número de celular de quien recibe? 📱\n_(Si no aplica, escribe 'no')_";
    return "📝 ¿Alguna referencia o seña para llegar en ambos puntos? También puedes contarnos qué paquete llevamos.\n\n_Escribe *no* si no tienes ninguna._";
  }
}

// ── 🧪 ESCENARIOS COMPLEJOS ──────────────────────────────────────
const escenarios = [
  {
    titulo: "1. Casa a Calle (solo calle sin número)",
    origen: "mi casa",
    destino: "4a avenida pte sur"
  },
  {
    titulo: "2. Comida rápida sin ticket ni confirmación de pago",
    origen: "Domino's Pizza a nombre de Caleb Vazquez",
    destino: "Polígono 5"
  },
  {
    titulo: "3. Compras en Supermercado (Encargo/Mandado)",
    origen: "Bodega Aurrera (comprar leche y huevos)",
    destino: "Mi trabajo (Plaza las Flores)"
  },
  {
    titulo: "4. Recoger objeto olvidado (Llaves)",
    origen: "Casa de mi suegra en Barrio La Cueva (recoger llaves)",
    destino: "Mi casa"
  },
  {
    titulo: "5. Institución a Institución (Documentos)",
    origen: "Mi oficina en el centro",
    destino: "Centro Médico Comitán"
  },
  {
    titulo: "6. Retiro de paquetería / Departamental",
    origen: "Liverpool Plaza las Flores (recoger pedido)",
    destino: "Fraccionamiento Las Palmas"
  }
];

async function correrPruebas() {
  console.log("\n===================================================================");
  console.log("🚀 SIMULADOR DE CRITERIO IA PARA MANDADITOS (ESTRELLA DELIVERY) 🚀");
  console.log("===================================================================\n");
  
  const hasKey = !!(Deno.env.get('DEEPSEEK_API_KEY') || Deno.env.get('OPENAI_API_KEY'));
  const mode = hasKey ? "🟢 MODO LIVE (API de DeepSeek/OpenAI detectada)" : "🟡 MODO MOCK (Respuestas pre-computadas simuladas)";
  console.log(`Estado: ${mode}\n`);

  for (let i = 0; i < escenarios.length; i++) {
    const esc = escenarios[i];
    console.log(`\n-------------------------------------------------------------------`);
    console.log(`▶ ESCENARIO: ${esc.titulo}`);
    console.log(`📍 Origen  : ${esc.origen}`);
    console.log(`🏁 Destino : ${esc.destino}`);
    console.log(`⏳ Analizando el viaje con la IA...`);
    
    const respuesta = await simularCriterioIA(esc.origen, esc.destino, !hasKey);
    console.log(`\n🤖 BOT ESTRELLA RESPONDERÍA:\n\x1b[36m${respuesta}\x1b[0m`);
  }
  
  console.log(`\n===================================================================\n`);
  if (!hasKey) {
    console.log("💡 Tip: Para correr la simulación real con IA, establece la variable de entorno:");
    console.log("   set DEEPSEEK_API_KEY=tu_clave");
  }
}

correrPruebas();
