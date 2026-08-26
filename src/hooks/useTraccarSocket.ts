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

    const connect = () => {
      if (destroyed) return;

      // El WebSocket SIEMPRE debe conectarse al mismo dominio donde está hospedado el dashboard
      const wsHost = window.location.host;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${wsHost}/api/socket`;
      
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
            console.log(`[Traccar WS] 📡 Dispositivos recibidos: ${data.devices.length}`);
            if (onDevicesRef.current) onDevicesRef.current(data.devices);
          }
          if (data.positions?.length) {
            console.log(`[Traccar WS] 📍 Posiciones recibidas: ${data.positions.length}`);
            if (onPositionsRef.current) onPositionsRef.current(data.positions);
          }
          if (data.events?.length) {
            console.log(`[Traccar WS] ⚡ Eventos recibidos: ${data.events.length}`, data.events);
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
      } else if (wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send('{}'); // Traccar WS Ping
        } catch (e) {
          console.log('[Traccar WS] Ping falló, forzando reconexión');
          wsRef.current.close();
        }
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
