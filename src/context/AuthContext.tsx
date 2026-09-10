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

export interface EmpresaData {
  id: string;
  nombre_empresa: string;
  logo_url: string | null;
  tipo_negocio: string;
  categorias_catalogo?: string[];
}

type AuthContextType = {
  user: TraccarUser | null;
  userRole: UserRole | null;
  empresaId: string | null;
  empresaData: EmpresaData | null;
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
  const [empresaData, setEmpresaData] = useState<EmpresaData | null>(null);
  const [paqueteActual, setPaqueteActual] = useState<Paquete | null>(null);
  const [loading, setLoading] = useState(true);

  // Hook para integrar notificaciones Push y Auto-Login en la app nativa de Android
  const { postMessage } = useNativeApp(user, setUser);

  const loadRole = async (u: TraccarUser) => {
    if (u.administrator) {
      setUserRole('superadmin');
      setEmpresaId(null);
      setEmpresaData(null);
      setPaqueteActual(null);
      return;
    }
    const { data } = await supabase.from('perfiles').select('rol, empresa_id').eq('traccar_user_id', u.id).single();
    if (data) {
      setUserRole(data.rol as UserRole);
      setEmpresaId(data.empresa_id);
      if (data.empresa_id) {
        const { data: empresa } = await supabase.from('empresas').select('*, paquete:paquetes(*)').eq('id', data.empresa_id).single();
        setEmpresaData(empresa ? { id: empresa.id, nombre_empresa: empresa.nombre_empresa, logo_url: empresa.logo_url, tipo_negocio: empresa.tipo_negocio, categorias_catalogo: empresa.categorias_catalogo || [] } : null);
        setPaqueteActual(empresa?.paquete ? (empresa.paquete as Paquete) : null);
      } else {
        setEmpresaData(null);
        setPaqueteActual(null);
      }
    } else {
      setUserRole('operador');
      setEmpresaId(null);
      setEmpresaData(null);
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
        .catch(() => { setUser(null); setUserRole(null); setEmpresaId(null); setEmpresaData(null); setPaqueteActual(null); })
        .finally(() => setLoading(false));
    } else {
      // Flujo normal web: verificar sesión existente mediante cookie
      api.getSession()
        .then(async (u) => { setUser(u); await loadRole(u); setLoading(false); })
        .catch(async () => {
          // Si falló la sesión normal, intentar auto-login con token de localStorage
          const savedToken = localStorage.getItem('traccar_token');
          if (savedToken) {
            try {
              const u = await api.loginWithToken(savedToken);
              setUser(u);
              await loadRole(u);
              setLoading(false);
              return;
            } catch (e) {
              console.warn('Token persistente inválido, limpiando...', e);
              localStorage.removeItem('traccar_token');
            }
          }
          // Si no hay token o falló, resetear el estado
          setUser(null); setUserRole(null); setEmpresaId(null); setEmpresaData(null); setPaqueteActual(null);
          setLoading(false);
        });
    }
  }, []);

  const login = async (email: string, password: string) => {
    const loggedUser = await api.login(email, password);
    setUser(loggedUser);
    await loadRole(loggedUser);
    
    // Generar un token persistente para recordar la sesión por 6 meses
    try {
      const expiration = new Date();
      expiration.setMonth(expiration.getMonth() + 6); // 6 meses
      const res = await fetch(`${BASE_URL}/session/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ expiration: expiration.toISOString() }),
      });
      if (res.ok) {
        const appToken = await res.text();
        // Guardar para la web
        localStorage.setItem('traccar_token', appToken);
        
        // Si estamos en Android, enviarlo al WebView
        // @ts-ignore
        if (window.appInterface) {
          postMessage(`login|${appToken}`);
        }
      }
    } catch (e) {
      console.error('Failed to register token for persistent session', e);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
      postMessage('logout');
    } catch (e) {
      console.error('Error during logout:', e);
    } finally {
      localStorage.removeItem('traccar_token');
      setUser(null);
      setUserRole(null);
      setEmpresaId(null);
      setEmpresaData(null);
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
    <AuthContext.Provider value={{ user, userRole, empresaId, empresaData, paqueteActual, loading, login, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
