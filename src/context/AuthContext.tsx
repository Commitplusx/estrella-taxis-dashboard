import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, BASE_URL, type TraccarUser } from '../lib/traccarApi';

import { useNativeApp } from '../hooks/useNativeApp';

type AuthContextType = {
  user: TraccarUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<TraccarUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Hook para integrar notificaciones Push y Auto-Login en la app nativa de Android
  const { postMessage } = useNativeApp(user, setUser);

  // Al arrancar, verificar si ya hay sesión activa o si viene un token en la URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      // Intentar iniciar sesión usando el token
      fetch(`${BASE_URL}/session?token=${encodeURIComponent(token)}`, { credentials: 'include' })
        .then(async (res) => {
          if (!res.ok) throw new Error('Token inválido o expirado');
          const userData = await res.json();
          setUser(userData);
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    } else {
      // Flujo normal: verificar sesión existente
      api.getSession()
        .then(setUser)
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    }
  }, []);

  const login = async (email: string, password: string) => {
    const loggedUser = await api.login(email, password);
    setUser(loggedUser);
    
    // Si estamos dentro de la app Android, generar un token para que se guarde localmente (Auto-login)
    // @ts-ignore
    if (window.appInterface) {
      try {
        const expiration = new Date();
        expiration.setMonth(expiration.getMonth() + 6); // 6 meses
        const res = await fetch(`${BASE_URL}/session/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ expiration: expiration.toISOString() }),
        });
        if (res.ok) {
          const appToken = await res.text();
          postMessage(`login|${appToken}`);
        }
      } catch (e) {
        console.error('Failed to register token in Android App', e);
      }
    }
  };

  const logout = async () => {
    try {
      await api.logout();
      postMessage('logout');
    } catch (e) {
      console.error('Error during logout:', e);
    } finally {
      setUser(null);
      // Opcional: recargar la página para limpiar estados residuales
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
