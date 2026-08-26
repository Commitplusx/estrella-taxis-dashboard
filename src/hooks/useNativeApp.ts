import { useEffect, useCallback, useState } from 'react';
import { api, type TraccarUser } from '../lib/traccarApi';

export function useNativeApp(user: TraccarUser | null, setUser: (user: TraccarUser | null) => void) {
  const [fcmToken, setFcmToken] = useState<string | null>(null);

  const postMessage = useCallback((message: string) => {
    // @ts-ignore
    if (window.appInterface) {
      // @ts-ignore
      window.appInterface.postMessage(message);
    }
  }, []);

  // Escuchar eventos globales de la App Nativa
  useEffect(() => {
    // 1. Registrar listener para Push Notifications Token
    // @ts-ignore
    window.updateNotificationToken = (token: string) => {
      console.log('FCM Token received from Android App:', token);
      setFcmToken(token);
    };

    // 2. Registrar listener para Auto-Login (cuando la app arranca)
    // @ts-ignore
    window.handleLoginToken = (token: string) => {
      console.log('Login token received from Android App');
      if (!user) {
        window.location.href = `/?token=${encodeURIComponent(token)}`;
      }
    };

    // 3. Pedir el token de autenticación a la App al montar
    postMessage('authentication');

    return () => {
      // @ts-ignore
      delete window.updateNotificationToken;
      // @ts-ignore
      delete window.handleLoginToken;
    };
  }, [user, postMessage]);

  // Si tenemos usuario logueado Y tenemos el token FCM pendiente, guardarlo en la base de datos
  useEffect(() => {
    if (user && fcmToken) {
      const tokens = user.attributes.notificationTokens ? (user.attributes.notificationTokens as String).split(',') : [];
      if (!tokens.includes(fcmToken)) {
        const updatedTokens = [...tokens.slice(-2), fcmToken].join(',');
        api.updateUser(user.id, {
          ...user,
          attributes: { ...user.attributes, notificationTokens: updatedTokens }
        }).then(updatedUser => {
          setUser(updatedUser);
          console.log('FCM Token saved to user attributes!');
        }).catch(e => {
          console.error('Failed to update notification token', e);
        });
      }
      // Limpiarlo de memoria una vez procesado
      setFcmToken(null);
    }
  }, [user, fcmToken, setUser]);
  return { postMessage };
}
