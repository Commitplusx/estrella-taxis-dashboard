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

const MAX_RECONNECT_DELAY_MS = 30_000;

export function useTraccarSocket({ onDevices, onPositions, onEvents, onConnect }: UseTraccarSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectDelay = useRef(3_000);

  const onDevicesRef = useRef(onDevices);
  const onPositionsRef = useRef(onPositions);
  const onEventsRef = useRef(onEvents);
  const onConnectRef = useRef(onConnect);

  useEffect(() => { onDevicesRef.current = onDevices; }, [onDevices]);
  useEffect(() => { onPositionsRef.current = onPositions; }, [onPositions]);
  useEffect(() => { onEventsRef.current = onEvents; }, [onEvents]);
  useEffect(() => { onConnectRef.current = onConnect; }, [onConnect]);

  useEffect(() => {
    let destroyed = false;

    const connect = async () => {
      if (destroyed) return;

      let token = '';
      try {
        // Obtenemos un token temporal del backend (Vercel nos lo da por REST que sí funciona)
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

      // Vercel NO soporta WebSockets. Tenemos que saltarnos el proxy y apuntar directo al backend.
      // Como apuntamos a otro dominio, las cookies no viajan solas, por eso le inyectamos el ?token=
      const isDev = import.meta.env.DEV;
      const wsHost = isDev ? window.location.host : 'taxis.estrella-eats.mx';
      const wsProtocol = isDev && window.location.protocol !== 'https:' ? 'ws:' : 'wss:';
      
      const wsUrl = `${wsProtocol}//${wsHost}/api/socket${token ? `?token=${token}` : ''}`;
      
      console.log(`[Traccar WS] Intentando conectar a: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Traccar WS] Conectado');
        reconnectDelay.current = 3_000;
        if (onConnectRef.current) onConnectRef.current(); // Pedir datos frescos al servidor!
      };

      ws.onmessage = (event) => {
        try {
          const data: SocketMessage = JSON.parse(event.data);
          
          if (data.devices?.length) {
            if (onDevicesRef.current) onDevicesRef.current(data.devices);
          }
          if (data.positions?.length) {
            if (onPositionsRef.current) onPositionsRef.current(data.positions);
          }
          if (data.events?.length) {
            if (onEventsRef.current) onEventsRef.current(data.events as any[]);
          }
        } catch (e) {
          console.error('[Traccar WS] Error al procesar mensaje:', e);
        }
      };

      ws.onclose = () => {
        if (destroyed) return;
        // Si se cae, esperamos cada vez más tiempo para no saturar a Traccar
        console.log(`[Traccar WS] Desconectado. Reconectando en ${reconnectDelay.current / 1000}s...`);
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY_MS);
          connect();
        }, reconnectDelay.current);
      };

      ws.onerror = (err) => {
        console.error('[Traccar WS] Error:', err);
        ws.close();
      };
    };

    const handleVisibilityAndOnline = () => {
      if (destroyed) return;
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectDelay.current = 3_000;
        connect();
      }
    };

    window.addEventListener('online', handleVisibilityAndOnline);
    
    const onVisibilityChange = () => {
      if (!document.hidden) handleVisibilityAndOnline();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    connect();

    return () => {
      destroyed = true;
      window.removeEventListener('online', handleVisibilityAndOnline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Evitar que se lance el reconnectTimer tras desmontar
        wsRef.current.close();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
