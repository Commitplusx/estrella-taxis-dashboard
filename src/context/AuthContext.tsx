import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, BASE_URL, type TraccarUser } from '../lib/traccarApi';

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

  // Al arrancar, verificar si ya hay sesión activa o si viene un token en la URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      // Intentar iniciar sesión usando el token (para el ShareLink)
      // fetch directo porque necesitamos pasar el query param ?token=
      fetch(`${BASE_URL}/session?token=${encodeURIComponent(token)}`, { credentials: 'include' })
        .then(async (res) => {
          if (!res.ok) throw new Error('Token inválido o expirado');
          const userData = await res.json();
          setUser(userData);
          // Limpiar la URL para que no quede el token visible
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
  };

  const logout = async () => {
    try {
      await api.logout();
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
