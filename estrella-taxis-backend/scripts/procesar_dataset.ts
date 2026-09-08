// Leer el JSON raw
const rawData = JSON.parse(Deno.readTextFileSync('./historial_ycloud_raw.json'));

// Agrupar por número
const sessions = new Map<string, any[]>();

for (const msg of rawData) {
  let clienteNum = '';
  let role = '';
  let text = '';
  
  const WABA_NUMBER = '+529632361353';
  
  if (msg.to === WABA_NUMBER) { 
     // El cliente lo envía al bot
     clienteNum = msg.from;
     role = 'user';
  } else if (msg.from === WABA_NUMBER) {
     // El bot lo envía al cliente
     clienteNum = msg.to;
     role = 'assistant';
  }
  
  if (!clienteNum) continue;

  if (msg.type === 'text' && msg.text && msg.text.body) {
    text = msg.text.body;
  } else if (msg.type === 'interactive' && msg.interactive) {
    if (msg.interactive.type === 'button_reply') {
       text = msg.interactive.button_reply?.title || '';
    } else if (msg.interactive.type === 'list_reply') {
       text = msg.interactive.list_reply?.title || '';
    } else if (msg.interactive.type === 'list') {
       text = msg.interactive.body?.text || 'Aquí tienes nuestras opciones';
    } else {
       text = msg.interactive.body?.text || '';
    }
  } else if (msg.type === 'location') {
    text = '[Envié mi ubicación GPS]';
  }

  if (text.trim() === '') continue;

  if (!sessions.has(clienteNum)) {
    sessions.set(clienteNum, []);
  }
  
  sessions.get(clienteNum)!.push({ role, content: text, sendTime: new Date(msg.sendTime || msg.createTime).getTime() });
}

let jsonlRows = "";
let markdownTop = "# Top Casos Reales (Para Few-Shot)\n\n";
let contadorConversaciones = 0;

for (const [phone, history] of sessions.entries()) {
  history.sort((a, b) => a.sendTime - b.sendTime);
  
  let currentSession: any[] = [];
  
  for (let i = 0; i < history.length; i++) {
     currentSession.push({ role: history[i].role, content: history[i].content });
     
     const diffHrs = i < history.length - 1 ? (history[i+1].sendTime - history[i].sendTime) / 3600000 : 999;
     
     if (diffHrs > 6) {
        if (currentSession.length >= 4) {
           const collapsed: any[] = [];
           for (const msg of currentSession) {
             if (collapsed.length > 0 && collapsed[collapsed.length - 1].role === msg.role) {
                collapsed[collapsed.length - 1].content += "\n" + msg.content;
             } else {
                collapsed.push({ role: msg.role, content: msg.content });
             }
           }

           // Buscar el primer mensaje de usuario para que tenga sentido
           let startIndex = 0;
           while (startIndex < collapsed.length && collapsed[startIndex].role !== 'user') {
             startIndex++;
           }
           
           const finalThread = collapsed.slice(startIndex);
           console.log(`Thread for ${phone}: length ${finalThread.length}`);

           if (finalThread.length >= 4) {
             const sysPrompt = "Eres un asistente virtual de Pollo Robins. Tomas órdenes de forma ultra breve, sin desglosar el menú a menos que te lo pidan. Respondes a quejas y haces preguntas concisas de domicilio.";
             const messages = [ { role: 'system', content: sysPrompt }, ...finalThread ];
             jsonlRows += JSON.stringify({ messages }) + "\n";
             
             if (contadorConversaciones < 15 && finalThread.length >= 6) {
               markdownTop += `## Ejemplo ${contadorConversaciones + 1}\n`;
               for (const m of finalThread) {
                 markdownTop += `${m.role === 'user' ? 'Cliente' : 'Asistente'}: "${m.content}"\n`;
               }
               markdownTop += `\n`;
               contadorConversaciones++;
             }
           }
        }
        currentSession = [];
     }
  }
}

Deno.writeTextFileSync('./entrenamiento.jsonl', jsonlRows);
Deno.writeTextFileSync('./top_casos.md', markdownTop);

console.log("¡Procesamiento completo!");
console.log(`- entrenamiento.jsonl generado`);
console.log(`- top_casos.md generado con los 15 mejores ejemplos`);
