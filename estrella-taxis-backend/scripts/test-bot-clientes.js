#!/usr/bin/env node
/**
 * 🤖 BOT STRESS TEST — Simulador de Clientes con DeepSeek
 * =========================================================
 * Simula conversaciones de distintos tipos de clientes para
 * detectar bugs, respuestas inesperadas y comportamientos raros.
 *
 * Uso:
 *   node scripts/test-bot-clientes.js
 *   node scripts/test-bot-clientes.js normal prisa
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/test-bot-clientes.js
 *
 * Requiere Node 18+ (fetch nativo)
 */

// ─── CONFIGURACIÓN ────────────────────────────────────────────────
const CONFIG = {
  BOT_URL: process.env.BOT_URL || 'http://74.208.153.209:3002',
  WABA_NUMBER: process.env.WABA_NUMBER || '+529632361353',
  DEEPSEEK_KEY: process.env.DEEPSEEK_API_KEY || '',
  SUPABASE_URL: 'https://knghdwpxheenkpuajkxl.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuZ2hkd3B4aGVlbmtwdWFqa3hsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQxNDk4OCwiZXhwIjoyMTAwOTkwOTg4fQ.7LCj557N2vdnORKI3J0DLcZJz-Reb_goCmzM4dOOqqM',
  BOT_WAIT_MS: 5000,
  TEST_PHONE_PREFIX: '+5296310000',
};

// ─── PERSONAS ─────────────────────────────────────────────────────
const PERSONAS = [
  {
    id: 'normal',
    nombre: 'Roberto (Normal)',
    phone: CONFIG.TEST_PHONE_PREFIX + '01',
    maxTurnos: 10,
    prompt: `Eres Roberto, 28 años, hambriento después del trabajo.
Quieres pedir ALITAS 10 piezas a domicilio.
Tu dirección: "Belisario Domínguez 45, Colonia Centro".
Tu nombre: Roberto.
Eres amable, directo, sin complicaciones.
Cuando el bot confirme tu pedido, termina la conversación respondiendo SOLO: LISTO`,
  },
  {
    id: 'indeciso',
    nombre: 'Ana (Indecisa)',
    phone: CONFIG.TEST_PHONE_PREFIX + '02',
    maxTurnos: 14,
    prompt: `Eres Ana, 22 años, tienes hambre pero no te decides.
Empieza preguntando "qué tienen", luego pide alitas, luego cambias a boneless, luego preguntas el precio de todo, luego preguntas si hay paquetes, luego te decides por un paquete y decides pasar a recoger.
Sé dubitativa, usa "hmm", "no sé", "espera", "mejor...".
Cuando el bot confirme tu pedido, termina la conversación respondiendo SOLO: LISTO`,
  },
  {
    id: 'problematico',
    nombre: 'Carlos (Problemático)',
    phone: CONFIG.TEST_PHONE_PREFIX + '03',
    maxTurnos: 12,
    prompt: `Eres Carlos, 45 años, cliente difícil y exigente.
Primero preguntas si hay descuentos, luego te quejas que está caro, amenazas con ir a otro lugar, preguntas si te pueden dar algo gratis, finalmente haces tu pedido (boneless 15 piezas, domicilio, calle Reforma 10).
Sé brusco pero no vulgar.
Cuando el bot confirme tu pedido, termina la conversación respondiendo SOLO: LISTO`,
  },
  {
    id: 'spam',
    nombre: 'Troll (Spam/Confuso)',
    phone: CONFIG.TEST_PHONE_PREFIX + '04',
    maxTurnos: 8,
    prompt: `Eres un usuario confundido que no sabe bien qué quiere.
Mandas mensajes sin sentido: "holaa", "???", emojis solos.
Luego preguntas si hacen pizzas (no), luego sushi (tampoco).
Luego preguntas qué sí venden. Si el bot te da el menú, haz un pedido real de lo que encuentres.
Cuando el bot confirme tu pedido, termina la conversación respondiendo SOLO: LISTO`,
  },
  {
    id: 'prisa',
    nombre: 'Miguel (Con prisa)',
    phone: CONFIG.TEST_PHONE_PREFIX + '05',
    maxTurnos: 7,
    prompt: `Eres Miguel, ejecutivo con 5 minutos. Mensajes ultrabreves.
Ejemplo de cómo escribes: "10 alitas" / "domicilio" / "Insurgentes 200" / "miguel" / "cuanto tarda"
Sin saludos, sin puntos, todo en minúsculas.
Cuando el bot confirme tu pedido, termina la conversación respondiendo SOLO: LISTO`,
  },
  {
    id: 'ubicacion',
    nombre: 'Laura (GPS)',
    phone: CONFIG.TEST_PHONE_PREFIX + '06',
    maxTurnos: 8,
    prompt: `Eres Laura, 30 años. Quieres boneless 5 piezas a domicilio.
Cuando el bot te pida tu dirección, dices "te mando mi ubicación" y en tu siguiente mensaje escribe exactamente: GPS: 16.7503,-93.1163
El bot debería aceptar esas coordenadas como tu dirección.
Cuando el bot confirme tu pedido, termina la conversación respondiendo SOLO: LISTO`,
  },
];

// ─── COLORES ANSI ─────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', magenta: '\x1b[35m', gray: '\x1b[90m',
  white: '\x1b[97m', bgBlue: '\x1b[44m', bgGreen: '\x1b[42m',
};

const log = {
  header: (msg) => console.log(`\n${C.bgBlue}${C.white}${C.bold}  ${msg}  ${C.reset}`),
  cliente: (name, msg) => console.log(`${C.cyan}${C.bold}👤 ${name}:${C.reset} ${C.white}${msg}${C.reset}`),
  bot: (msg) => console.log(`${C.green}🤖 Bot:${C.reset} ${C.gray}${msg.substring(0, 250)}${msg.length > 250 ? '...' : ''}${C.reset}`),
  info: (msg) => console.log(`${C.yellow}   ℹ ${msg}${C.reset}`),
  error: (msg) => console.log(`${C.red}   ❌ ${msg}${C.reset}`),
  success: (msg) => console.log(`${C.green}   ✅ ${msg}${C.reset}`),
  divider: () => console.log(`${C.gray}${'─'.repeat(65)}${C.reset}`),
};

// ─── FUNCIONES CORE ───────────────────────────────────────────────

async function enviarAlBot(phone, texto, msgId) {
  const payload = {
    type: 'whatsapp.inbound_message',
    whatsappInboundMessage: {
      from: phone,
      to: CONFIG.WABA_NUMBER,
      type: 'text',
      text: { body: texto },
      id: msgId || `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    },
  };
  try {
    const res = await fetch(CONFIG.BOT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, body: err.message };
  }
}

async function leerRespuestaBot(phone) {
  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/whatsapp_sessions?phone=eq.${encodeURIComponent(phone)}&select=historial_json&limit=1`,
      { headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_KEY}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.length === 0) return null;
    const historial = data[0]?.historial_json;
    if (!Array.isArray(historial) || historial.length === 0) return null;
    const mensajesBot = historial.filter((m) => m.role === 'assistant');
    return mensajesBot[mensajesBot.length - 1]?.content || null;
  } catch (_) { return null; }
}

async function limpiarSesion(phone) {
  try {
    await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/whatsapp_sessions?phone=eq.${encodeURIComponent(phone)}`,
      {
        method: 'DELETE',
        headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`, Prefer: 'return=minimal' },
      }
    );
  } catch (_) {}
}

async function deepseekResponde(systemPrompt, historial) {
  if (!CONFIG.DEEPSEEK_KEY) {
    const fallback = ['Hola, quiero pedir algo', 'Sí perfecto', 'Ok, gracias', 'Bien', 'LISTO'];
    return historial.length < fallback.length ? fallback[Math.floor(historial.length / 2)] : 'LISTO';
  }
  const messages = [
    {
      role: 'system',
      content: `${systemPrompt}

REGLAS:
- Responde ÚNICAMENTE como el cliente, nunca como el bot
- Máximo 2 oraciones cortas, como WhatsApp real
- Español mexicano coloquial
- Si completaste el objetivo (pedido confirmado por el bot), responde SOLO: LISTO
- Si el bot te preguntó algo, respóndele directamente`,
    },
    ...historial,
  ];
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.DEEPSEEK_KEY}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: 120, temperature: 0.85 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    log.error(`DeepSeek: ${err.message}`);
    return 'Ok, gracias';
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── SIMULACIÓN DE UNA PERSONA ────────────────────────────────────
async function simularPersona(persona) {
  log.header(`SIMULANDO: ${persona.nombre} | 📞 ${persona.phone}`);

  await limpiarSesion(persona.phone);
  log.info('Sesión previa limpiada en Supabase');
  await sleep(500);

  const historialDS = [];
  let turno = 0;
  let terminado = false;
  const stats = { enviados: 0, errores: 0, leidos: 0 };

  while (turno < persona.maxTurnos && !terminado) {
    turno++;
    log.divider();

    // 1. DeepSeek genera mensaje del cliente
    const msgCliente = await deepseekResponde(persona.prompt, historialDS);

    if (!msgCliente || msgCliente.toUpperCase().includes('LISTO')) {
      log.success(`Objetivo alcanzado en turno ${turno - 1}`);
      terminado = true;
      break;
    }

    log.cliente(persona.nombre, msgCliente);

    // 2. Enviar al bot
    const res = await enviarAlBot(persona.phone, msgCliente, `test_${persona.id}_t${turno}_${Date.now()}`);

    if (res.ok) {
      log.info(`Bot recibió el mensaje (HTTP ${res.status})`);
      stats.enviados++;
    } else {
      log.error(`Bot ERROR (HTTP ${res.status}): ${res.body}`);
      stats.errores++;
      if (res.status === 0) {
        log.error('¿El bot está corriendo? Verifica: pm2 status 4');
        break;
      }
    }

    // 3. Esperar procesamiento
    log.info(`Esperando ${CONFIG.BOT_WAIT_MS / 1000}s...`);
    await sleep(CONFIG.BOT_WAIT_MS);

    // 4. Leer respuesta real del bot desde Supabase
    const respuestaBot = await leerRespuestaBot(persona.phone);
    if (respuestaBot) {
      log.bot(respuestaBot);
      stats.leidos++;
      historialDS.push({ role: 'user', content: msgCliente });
      historialDS.push({ role: 'assistant', content: `[Bot dijo]: ${respuestaBot}` });
    } else {
      log.info('(Respuesta del bot no disponible aún en Supabase — ver PM2 logs)');
      historialDS.push({ role: 'user', content: msgCliente });
      historialDS.push({ role: 'assistant', content: '[Bot respondió algo, continúa la conversación]' });
    }
  }

  if (turno >= persona.maxTurnos && !terminado) {
    log.info(`Máximo de turnos (${persona.maxTurnos}) alcanzado`);
  }

  log.divider();
  log.success(`${persona.nombre}: ${stats.enviados} msgs | ${stats.errores} errores | ${stats.leidos} respuestas leídas`);
  return stats;
}

// ─── MAIN ─────────────────────────────────────────────────────────
async function main() {
  console.clear();
  console.log(`${C.bold}${C.magenta}`);
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     🤖 BOT STRESS TEST — SIMULADOR DE CLIENTES  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`${C.reset}`);
  console.log(`  Bot URL  : ${CONFIG.BOT_URL}`);
  console.log(`  WABA     : ${CONFIG.WABA_NUMBER}`);
  console.log(`  DeepSeek : ${CONFIG.DEEPSEEK_KEY ? '✅ Configurado' : '⚠️  Sin key (usa mensajes de fallback)'}`);
  console.log();

  const args = process.argv.slice(2);
  const personas = args.length > 0
    ? PERSONAS.filter((p) => args.includes(p.id))
    : PERSONAS;

  if (personas.length === 0) {
    console.log(`IDs disponibles: ${PERSONAS.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`  Personas  : ${personas.map((p) => p.nombre).join(' | ')}`);
  console.log(`\n  🔍 Monitorea en tiempo real:`);
  console.log(`${C.cyan}     ssh root@74.208.153.209 "pm2 logs 4 --lines 0"${C.reset}\n`);
  await sleep(2000);

  for (const persona of personas) {
    await simularPersona(persona);
    if (persona !== personas[personas.length - 1]) {
      log.info('Pausa 8s entre personas...\n');
      await sleep(8000);
    }
  }

  console.log(`\n${C.bgGreen}${C.bold}  🎉 SIMULACIÓN COMPLETA  ${C.reset}`);
  console.log(`${C.gray}  Ver logs: ssh root@74.208.153.209 "cat /var/log/bot-worker/out.log | tail -300"${C.reset}\n`);
}

main().catch((err) => {
  console.error(`${C.red}Error fatal: ${err.message}${C.reset}`);
  process.exit(1);
});
