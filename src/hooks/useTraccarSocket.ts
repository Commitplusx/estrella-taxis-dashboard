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
};

const MAX_RECONNECT_DELAY_MS = 30_000; // Tope máximo de espera (30 segundos)

export function useTraccarSocket({ onDevices, onPositions, onEvents }: UseTraccarSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(3_000); // Empezamos intentando reconectar a los 3s

  // Guardamos las funciones que vienen de los componentes en referencias.
  // Así el WebSocket siempre usa la versión más reciente sin tener que desconectarse.
  const onDevicesRef = useRef(onDevices);
  const onPositionsRef = useRef(onPositions);
  const onEventsRef = useRef(onEvents);

  // Mantener las referencias al día en cada render
  useEffect(() => { onDevicesRef.current = onDevices; }, [onDevices]);
  useEffect(() => { onPositionsRef.current = onPositions; }, [onPositions]);
  useEffect(() => { onEventsRef.current = onEvents; }, [onEvents]);

  useEffect(() => {
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;

      // Protocolo ws:// o wss:// según si estamos en local o producción
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/socket`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Traccar WS] Conectado');
        reconnectDelay.current = 3_000; // Volvemos al delay normal si hay éxito
      };

      ws.onmessage = (event) => {
        try {
          const data: SocketMessage = JSON.parse(event.data);
          // Avisar a los componentes que llegaron datos frescos
          if (data.devices?.length && onDevicesRef.current) onDevicesRef.current(data.devices);
          if (data.positions?.length && onPositionsRef.current) onPositionsRef.current(data.positions);
          if (data.events?.length && onEventsRef.current) onEventsRef.current(data.events as any[]);
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

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Evitar que se lance el reconnectTimer tras desmontar
        wsRef.current.close();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
