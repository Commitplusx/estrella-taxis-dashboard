// src/lib/soundNotification.ts
// Sistema de alerta auditiva para nuevos pedidos en restaurantes y comercios

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Desbloquear audio automáticamente al primer clic o toque en cualquier parte de la ventana
if (typeof window !== 'undefined') {
  const unlock = () => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
    } catch {}
    window.removeEventListener('click', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('click', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/**
 * Toca un tono con caída exponencial y armónicos tipo campana de recepción / restaurante
 */
function playBellTone(ctx: AudioContext, freq: number, startTime: number, duration: number, volume = 0.5) {
  // 1. Tono fundamental
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration);

  // 2. Armónico superior para brillo metálico de campana (2.76x frecuencia)
  const oscHarmonic = ctx.createOscillator();
  const gainHarmonic = ctx.createGain();

  oscHarmonic.type = 'triangle';
  oscHarmonic.frequency.setValueAtTime(freq * 2.76, startTime);

  gainHarmonic.gain.setValueAtTime(0.0001, startTime);
  gainHarmonic.gain.linearRampToValueAtTime(volume * 0.35, startTime + 0.01);
  gainHarmonic.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.6);

  oscHarmonic.connect(gainHarmonic);
  gainHarmonic.connect(ctx.destination);

  oscHarmonic.start(startTime);
  oscHarmonic.stop(startTime + duration * 0.6);
}

/**
 * Reproduce el sonido alegre y llamativo de nuevo pedido (estilo UberEats / Rappi)
 */
export function playNewOrderSound() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Secuencia de campana armónica doble:
    // Ding-dong-ding ascendente (Mi -> Sol -> Do alto)
    playBellTone(ctx, 659.25, now + 0.0, 0.45, 0.6);  // E5
    playBellTone(ctx, 783.99, now + 0.15, 0.45, 0.7); // G5
    playBellTone(ctx, 1046.50, now + 0.30, 0.85, 0.85); // C6

    // Segunda repetición de confirmación (medio segundo después para que se escuche en cocina)
    playBellTone(ctx, 783.99, now + 0.65, 0.4, 0.65);  // G5
    playBellTone(ctx, 1046.50, now + 0.80, 1.1, 0.9);  // C6
  } catch (err) {
    console.warn('[AUDIO NOTIFICATION] Error reproduciendo timbre de pedido:', err);
  }
}
