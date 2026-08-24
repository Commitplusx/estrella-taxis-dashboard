import React, { useEffect, useRef } from 'react';
import { type TraccarDevice, type TraccarPosition } from '../lib/traccarApi';

type SocketMessage = {
  devices?: TraccarDevice[];
  positions?: TraccarPosition[];
  events?: unknown[];
};

type UseTraccarSocketOptions = {
  onDevices?: (devices: TraccarDevice[]) => void;
  onPositions?: (positions: TraccarPosition[]) => void;
};

export function useTraccarSocket({ onDevices, onPositions }: UseTraccarSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const connect = () => {
      // Protocolo ws:// o wss:// según el host actual
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const host = window.location.host;
      const ws = new WebSocket(`${protocol}://${host}/api/socket`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Traccar WS] Conectado');
      };

      ws.onmessage = (event) => {
        try {
          const data: SocketMessage = JSON.parse(event.data);
          if (data.devices?.length && onDevices) onDevices(data.devices);
          if (data.positions?.length && onPositions) onPositions(data.positions);
        } catch (e) {
          console.error('[Traccar WS] Error parsing message:', e);
        }
      };

      ws.onclose = () => {
        console.log('[Traccar WS] Desconectado. Reconectando en 3s...');
        // Reconexión automática
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('[Traccar WS] Error:', err);
        ws.close();
      };
    };

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);
}
