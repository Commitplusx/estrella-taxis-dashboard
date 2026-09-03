require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;
// Google Cloud API Key
const GCP_API_KEY = process.env.GCP_API_KEY || 'AIzaSyDNUFSH8YkrRFjupn1jW3LgQNrY5qKw-is';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '075728a03c7b37229fe8a9b6d4dad4e6500c833a45ade5fcc6ddae9cf5074f17';
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;

// ─────────────────────────────────────────────────────────────────────────────
// Mapa de llamadas activas: callControlId → WebSocket de Telnyx
// ─────────────────────────────────────────────────────────────────────────────
const activeCalls = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Cola de audio por llamada: evita que el bot hable encima de sí mismo.
// Cada SPEAK espera a que el anterior termine antes de reproducirse.
// ─────────────────────────────────────────────────────────────────────────────
const speakQueues = new Map(); // callControlId → Promise (la última en la cola)

function enqueueSpeak(callControlId, fn) {
  const prev = speakQueues.get(callControlId) || Promise.resolve();
  const next = prev.then(() => fn()).catch(() => {});
  speakQueues.set(callControlId, next);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs WebSocket Streaming → audio directo a Telnyx (sin Storage)
// ─────────────────────────────────────────────────────────────────────────────
async function streamTextToCall(callControlId, text) {
  let callData = activeCalls.get(callControlId);
  
  // SOLUCIÓN ROBUSTA: Esperar hasta 6 segundos a que Telnyx conecte el WebSocket
  // Esto absorbe la condición de carrera si Supabase manda el texto muy rápido
  let retries = 60;
  while (!callData && retries > 0) {
    await new Promise(r => setTimeout(r, 100));
    callData = activeCalls.get(callControlId);
    retries--;
  }

  if (!callData) {
    console.log(`[ERROR] No hay WS activo para ${callControlId} después de 3s de espera`);
    return false;
  }
  const telnyxWs = callData.ws;
  return new Promise(async (resolve) => {
    const callData = activeCalls.get(callControlId);
    if (!callData || callData.ws.readyState !== WebSocket.OPEN) {
      console.error('[GCP TTS] No hay WS activo para', callControlId);
      return resolve(false);
    }

    try {
      console.log(`[GCP TTS] Solicitando audio a Google Cloud...`);
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GCP_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: text },
          voice: { languageCode: "es-US", name: "es-US-Chirp3-HD-Aoede" }, // Chirp3 HD - voz más natural de Google
          audioConfig: { audioEncoding: "MULAW", sampleRateHertz: 8000 }
        })
      });

      if (!res.ok) {
        console.error('[GCP TTS ERROR]', await res.text());
        return resolve(false);
      }

      const data = await res.json();
      if (!data.audioContent) {
        console.error('[GCP TTS ERROR] Sin audioContent');
        return resolve(false);
      }

      const audioBuffer = Buffer.from(data.audioContent, 'base64');
      
      // PARSEO CORRECTO DEL HEADER WAV:
      // No asumimos que son siempre 44 bytes. Buscamos el marcador "data" del WAV
      // para extraer el audio puro independientemente del tamaño del header.
      let dataOffset = 44; // Valor por defecto para PCM
      for (let i = 0; i < Math.min(audioBuffer.length - 4, 100); i++) {
        if (audioBuffer[i] === 0x64 && audioBuffer[i+1] === 0x61 &&
            audioBuffer[i+2] === 0x74 && audioBuffer[i+3] === 0x61) { // "data"
          dataOffset = i + 8; // +4 para "data", +4 para el chunk size
          break;
        }
      }
      console.log(`[GCP TTS] Header WAV: ${dataOffset} bytes. Audio: ${audioBuffer.length - dataOffset} bytes`);
      const pcmBuffer = audioBuffer.subarray(dataOffset);

      // TURBO STREAMING: Mandamos el audio 10x más rápido que tiempo real.
      // Telnyx tiene un buffer interno y lo reproduce a velocidad normal.
      // Esto reduce el lag de ~4s a ~400ms por respuesta.
      const CHUNK_SIZE = 3200; // 400ms de audio por paquete (50x más rápido que real-time)
      const CHUNK_DELAY = 5;   // 5ms entre paquetes
      for (let i = 0; i < pcmBuffer.length; i += CHUNK_SIZE) {
        const chunk = pcmBuffer.subarray(i, i + CHUNK_SIZE);
        if (callData.ws.readyState !== WebSocket.OPEN) break;
        callData.ws.send(JSON.stringify({
          event: 'media',
          stream_id: callData.streamId,
          media: { payload: chunk.toString('base64') }
        }));
        if (i + CHUNK_SIZE < pcmBuffer.length) {
          await new Promise(r => setTimeout(r, CHUNK_DELAY));
        }
      }

      // Ahora que mandamos en TURBO (todo en ~200ms), necesitamos esperar la duración
      // REAL del audio para no liberar el micrófono antes de que Telnyx termine de reproducirlo.
      const durationMs = Math.round((pcmBuffer.length / 8000) * 1000);
      console.log(`[GCP TTS] Turbo stream completo. Esperando ${durationMs}ms (duración real) antes de liberar micrófono...`);
      await new Promise(r => setTimeout(r, durationMs));
      resolve(true);

    } catch (e) {
      console.error('[GCP TTS CATCH ERROR]', e);
      resolve(false);
    }
  }).then((success) => {
    // Cuando el timer de duración termina, avisamos a Supabase que ya puede escuchar al cliente.
    console.log(`[VPS] Google Cloud TTS terminó físicamente para ${callControlId}, liberando Supabase...`);
    fetch('https://knghdwpxheenkpuajkxl.supabase.co/functions/v1/telnyx-voice-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { event_type: "vps.speak.ended", payload: { call_control_id: callControlId } } })
    }).catch(err => console.error('[VPS -> SUPABASE ALERT ERROR]', err));
    
    return success;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor HTTP + REST API (para que Supabase nos mande texto)
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    activeCalls: activeCalls.size,
    uptime: process.uptime()
  });
});

// POST /speak — Supabase llama esto con el texto a reproducir
// Protegido por API key interna
app.post('/speak', async (req, res) => {
  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { callControlId, text, hangupAfter } = req.body;

  if (!callControlId || !text) {
    return res.status(400).json({ error: 'callControlId y text son requeridos' });
  }

  console.log(`[SPEAK] callControlId=${callControlId} hangupAfter=${hangupAfter}`);

  // FIRE AND FORGET con cola: No esperamos, pero garantizamos orden de reproducción.
  enqueueSpeak(callControlId, () => streamTextToCall(callControlId, text)).then((success) => {
    // Si se debe colgar después de hablar (ej. despedida)
    if (hangupAfter && success) {
      setTimeout(async () => {
        try {
          await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${TELNYX_API_KEY}`,
              'Content-Type': 'application/json',
            }
          });
          console.log(`[HANGUP] Colgando ${callControlId} después de despedida`);
        } catch (err) {
          console.error('[HANGUP ERROR]', err.message);
        }
      }, hangupAfter); // hangupAfter en ms (ej. 3000)
    }
  }).catch(console.error);

  res.json({ success: true, activeCalls: activeCalls.size, async: true });
});

// POST /transfer — Transferir llamada a humano
app.post('/transfer', async (req, res) => {
  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { callControlId, to } = req.body;
  try {
    await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to })
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Servidor WebSocket — Telnyx Media Streaming
// ─────────────────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/media' });

wss.on('connection', (ws, req) => {
  console.log('[WS] Nueva conexión de Telnyx desde:', req.socket.remoteAddress);
  let callControlId = null;

  ws.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());

      switch (msg.event) {
        case 'start':
          console.log('[WS RAW START EVENT]', JSON.stringify(msg, null, 2));
          // Telnyx nos dice qué llamada es esta
          callControlId = msg.start?.call_control_id || msg.call_control_id;
          // Telnyx puede mandar el stream_id en la raíz o dentro de start
          const streamId = msg.stream_id || msg.start?.stream_id;
          if (callControlId) {
            // Guardamos tanto el WebSocket como el streamId
            activeCalls.set(callControlId, { ws, streamId });
            console.log(`[WS START] Llamada registrada: ${callControlId} (stream: ${streamId}) | Total activas: ${activeCalls.size}`);
          }
          break;

        case 'media':
          // Audio del cliente — lo ignoramos aquí porque Telnyx ya lo manda
          // a Deepgram vía transcription_start (webhook). No necesitamos procesarlo.
          break;

        case 'stop':
          console.log(`[WS STOP] Llamada terminada: ${callControlId}`);
          if (callControlId) {
            activeCalls.delete(callControlId);
            console.log(`[WS] Llamadas activas restantes: ${activeCalls.size}`);
          }
          break;

        default:
          // connected, mark, etc.
          break;
      }
    } catch (err) {
      console.error('[WS MESSAGE ERROR]', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    if (callControlId) {
      activeCalls.delete(callControlId);
      console.log(`[WS CLOSED] ${callControlId} | Código: ${code} | Activas: ${activeCalls.size}`);
    }
  });

  ws.on('error', (err) => {
    console.error('[WS ERROR]', err.message);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Limpiar llamadas muertas cada 5 minutos (si el WebSocket ya cerró)
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  for (const [cid, callData] of activeCalls.entries()) {
    if (callData.ws.readyState === WebSocket.CLOSED || callData.ws.readyState === WebSocket.CLOSING) {
      activeCalls.delete(cid);
      console.log(`[GC] Llamada limpiada: ${cid}`);
    }
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`🚕 Pompeyo Express WebSocket Server corriendo en puerto ${PORT}`);
  console.log(`   REST: http://localhost:${PORT}/`);
  console.log(`   WS:   ws://localhost:${PORT}/media`);
});
