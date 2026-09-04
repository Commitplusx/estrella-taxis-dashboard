import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, BASE_URL, type TraccarUser } from '../lib/traccarApi';
import { supabase } from '../lib/supabase';
import { useNativeApp } from '../hooks/useNativeApp';

export type UserRole = 'superadmin' | 'admin_empresa' | 'operador';

export interface PermisosSistema {
  reporte_pdf: boolean;
  score_diario: boolean;
  enrutamiento_vectorial: boolean;
  mapa_calor: boolean;
  [key: string]: boolean;
}

export interface Paquete {
  id: string;
  nombre: string;
  precio_mensual: number;
  incluye_bot: boolean;
  incluye_whatsapp: boolean;
  permisos_sistema: PermisosSistema;
}

type AuthContextType = {
  user: TraccarUser | null;
  userRole: UserRole | null;
  empresaId: string | null;
  paqueteActual: Paquete | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<TraccarUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [paqueteActual, setPaqueteActual] = useState<Paquete | null>(null);
  const [loading, setLoading] = useState(true);

  // Hook para integrar notificaciones Push y Auto-Login en la app nativa de Android
  const { postMessage } = useNativeApp(user, setUser);

  const loadRole = async (u: TraccarUser) => {
    if (u.administrator) {
      setUserRole('superadmin');
      setEmpresaId(null);
      setPaqueteActual(null);
      return;
    }
    const { data } = await supabase.from('perfiles').select('rol, empresa_id').eq('traccar_user_id', u.id).single();
    if (data) {
      setUserRole(data.rol as UserRole);
      setEmpresaId(data.empresa_id);
      if (data.empresa_id) {
        const { data: empresa } = await supabase.from('empresas').select('*, paquete:paquetes(*)').eq('id', data.empresa_id).single();
        setPaqueteActual(empresa?.paquete ? (empresa.paquete as Paquete) : null);
      } else {
        setPaqueteActual(null);
      }
    } else {
      setUserRole('operador');
      setEmpresaId(null);
      setPaqueteActual(null);
    }
  };

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
          await loadRole(userData);
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch(() => { setUser(null); setUserRole(null); setEmpresaId(null); setPaqueteActual(null); })
        .finally(() => setLoading(false));
    } else {
      // Flujo normal: verificar sesión existente
      api.getSession()
        .then(async (u) => { setUser(u); await loadRole(u); })
        .catch(() => { setUser(null); setUserRole(null); setEmpresaId(null); setPaqueteActual(null); })
        .finally(() => setLoading(false));
    }
  }, []);

  const login = async (email: string, password: string) => {
    const loggedUser = await api.login(email, password);
    setUser(loggedUser);
    await loadRole(loggedUser);
    
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
      setUserRole(null);
      setEmpresaId(null);
      setPaqueteActual(null);
      // Opcional: recargar la página para limpiar estados residuales
      window.location.href = '/login';
    }
  };

  const resetPassword = async (email: string) => {
    // LLamamos a la API de traccar que envía el correo
    await api.resetPassword(email);
  };

  return (
    <AuthContext.Provider value={{ user, userRole, empresaId, paqueteActual, loading, login, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
