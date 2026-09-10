// src/hooks/usePushNotifications.ts
// Hook para gestionar la suscripción Web Push del usuario autenticado

import { useState, useEffect, useCallback } from 'react';
import {
  subscribeToPush,
  unsubscribeFromPush,
  isPushSubscribed,
  registerServiceWorker,
} from '../lib/pushNotifications';

interface UsePushNotificationsReturn {
  isPushEnabled: boolean;
  isPushSupported: boolean;
  isLoading: boolean;
  enablePush: () => Promise<void>;
  disablePush: () => Promise<void>;
}

export function usePushNotifications(
  empresaId: string | null,
  userId: number | null
): UsePushNotificationsReturn {
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Soporte del navegador
  const isPushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  // Al montar: registrar el SW y verificar si ya hay suscripción activa
  useEffect(() => {
    if (!isPushSupported) return;

    // Registrar SW inmediatamente (no pide permiso)
    registerServiceWorker();

    // Verificar si ya estaba suscrito
    isPushSubscribed().then(setIsPushEnabled);
  }, [isPushSupported]);

  // Auto-suscribir cuando el usuario abre la app POR PRIMERA VEZ
  // Si ya tiene permiso concedido anteriormente, renovamos silenciosamente
  useEffect(() => {
    if (!isPushSupported || !empresaId || !userId) return;
    if (Notification.permission !== 'granted') return; // No pedir permiso automáticamente

    // Renovar suscripción silenciosa si el permiso ya fue otorgado
    subscribeToPush(empresaId, userId).then((sub) => {
      if (sub) setIsPushEnabled(true);
    });
  }, [isPushSupported, empresaId, userId]);

  const enablePush = useCallback(async () => {
    if (!empresaId || !userId) return;
    setIsLoading(true);
    try {
      const sub = await subscribeToPush(empresaId, userId);
      setIsPushEnabled(sub !== null);
    } finally {
      setIsLoading(false);
    }
  }, [empresaId, userId]);

  const disablePush = useCallback(async () => {
    setIsLoading(true);
    try {
      await unsubscribeFromPush();
      setIsPushEnabled(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { isPushEnabled, isPushSupported, isLoading, enablePush, disablePush };
}
