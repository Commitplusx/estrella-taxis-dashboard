import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, type TraccarUser } from '../lib/traccarApi';

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

  // Al arrancar, verificar si ya hay sesión activa en Traccar
  useEffect(() => {
    api.getSession()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const loggedUser = await api.login(email, password);
    setUser(loggedUser);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
