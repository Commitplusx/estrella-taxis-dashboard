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
  onEvents?: (events: any[]) => void;
};

export function useTraccarSocket({ onDevices, onPositions, onEvents }: UseTraccarSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const connect = () => {
      // Protocolo ws:// o wss:// según el host actual
      const wsUrl = import.meta.env.DEV 
        ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/socket`
        : 'wss://taxis.estrella-eats.mx/api/socket'; // Directo en Producción
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Traccar WS] Conectado');
      };

      ws.onmessage = (event) => {
        try {
          const data: SocketMessage = JSON.parse(event.data);
          if (data.devices?.length && onDevices) onDevices(data.devices);
          if (data.positions?.length && onPositions) onPositions(data.positions);
          if (data.events?.length && onEvents) onEvents(data.events);
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
      if (wsRef.current) {
        wsRef.current.onclose = null; // Evitar que se lance el reconnectTimer tras desmontar
        wsRef.current.close();
      }
    };
  }, []);
}
