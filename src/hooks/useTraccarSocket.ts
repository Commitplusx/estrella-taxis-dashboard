import { useEffect, useRef } from 'react';
import { type TraccarDevice, type TraccarPosition } from '../lib/traccarApi';

type SocketMessage = {
  devices?: TraccarDevice[];
  positions?: TraccarPosition[];
  events?: unknown[];
};

type UseTraccarSocketOptions = {
  onDevices?: (devices: TraccarDevice[]) => void;
  onPositions?: (positions: TraccarPosition[]) => void;
  onEvents?: (events: any[]) => void;
  onConnect?: () => void; // <--- Añadimos esto para sincronizar tras una caída
};

const MAX_RECONNECT_DELAY_MS = 30_000;// ==========================================
// ESTADO GLOBAL DEL WEBSOCKET (Fuera de React)
// ==========================================
let globalWs: WebSocket | null = null;
let globalReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let globalReconnectDelay = 3_000;
let isConnecting = false;
let forceDestroy = false;

const listeners = new Set<UseTraccarSocketOptions>();

async function connectGlobalWs() {
  if (forceDestroy) return;
  if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (isConnecting) return;
  
  isConnecting = true;
  let token = '';
  try {
    const res = await fetch('/api/session/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ expiration: new Date(Date.now() + 86400000).toISOString() })
    });
    if (res.ok) {
      token = await res.text();
    }
  } catch (e) {
    console.warn('[Traccar WS] No se pudo obtener token para el socket', e);
  }

  const isDev = import.meta.env.DEV;
  const wsHost = isDev ? window.location.host : 'taxis.estrella-eats.mx';
  const wsProtocol = isDev && window.location.protocol !== 'https:' ? 'ws:' : 'wss:';
  
  const wsUrl = `${wsProtocol}//${wsHost}/api/socket${token ? `?token=${token}` : ''}`;
  
  const ws = new WebSocket(wsUrl);
  globalWs = ws;

  ws.onopen = () => {
    isConnecting = false;
    globalReconnectDelay = 3_000;
    // Avisar a todos los componentes montados que estamos conectados
    listeners.forEach(l => l.onConnect?.());
  };

  ws.onmessage = (event) => {
    try {
      const data: SocketMessage = JSON.parse(event.data);
      if (data.devices?.length) {
        listeners.forEach(l => l.onDevices?.(data.devices!));
      }
      if (data.positions?.length) {
        listeners.forEach(l => l.onPositions?.(data.positions!));
      }
      if (data.events?.length) {
        listeners.forEach(l => l.onEvents?.(data.events as any[]));
      }
    } catch (e) {
      console.error('[Traccar WS Global] Error al procesar mensaje:', e);
    }
  };

  ws.onclose = () => {
    isConnecting = false;
    if (forceDestroy) return;
    globalReconnectTimer = setTimeout(() => {
      globalReconnectDelay = Math.min(globalReconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      connectGlobalWs();
    }, globalReconnectDelay);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleVisibilityAndOnline() {
  if (forceDestroy) return;
  if (!globalWs || globalWs.readyState === WebSocket.CLOSED) {
    if (globalReconnectTimer) clearTimeout(globalReconnectTimer);
    globalReconnectDelay = 3_000;
    connectGlobalWs();
  }
}

// Inicializar listeners del navegador a nivel global solo una vez
if (typeof window !== 'undefined') {
  window.addEventListener('online', handleVisibilityAndOnline);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) handleVisibilityAndOnline();
  });
}

// Exportamos una función por si el AuthContext decide matar el socket al cerrar sesión
export function killGlobalTraccarSocket() {
  forceDestroy = true;
  if (globalReconnectTimer) clearTimeout(globalReconnectTimer);
  if (globalWs) {
    globalWs.onclose = null;
    globalWs.close();
    globalWs = null;
  }
}

// ==========================================
// REACT HOOK (Wrapper seguro)
// ==========================================
export function useTraccarSocket({ onDevices, onPositions, onEvents, onConnect }: UseTraccarSocketOptions) {
  const onDevicesRef = useRef(onDevices);
  const onPositionsRef = useRef(onPositions);
  const onEventsRef = useRef(onEvents);
  const onConnectRef = useRef(onConnect);

  // Mantener las referencias frescas
  useEffect(() => { onDevicesRef.current = onDevices; }, [onDevices]);
  useEffect(() => { onPositionsRef.current = onPositions; }, [onPositions]);
  useEffect(() => { onEventsRef.current = onEvents; }, [onEvents]);
  useEffect(() => { onConnectRef.current = onConnect; }, [onConnect]);

  useEffect(() => {
    forceDestroy = false;
    
    // Objeto listener enlazado a las refs actuales
    const listener: UseTraccarSocketOptions = {
      onDevices: (d) => onDevicesRef.current?.(d),
      onPositions: (p) => onPositionsRef.current?.(p),
      onEvents: (e) => onEventsRef.current?.(e),
      onConnect: () => onConnectRef.current?.()
    };

    listeners.add(listener);
    connectGlobalWs();

    return () => {
      // Cuando la pantalla se destruye, solo dejamos de escuchar. 
      // NO matamos el WebSocket global.
      listeners.delete(listener);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
