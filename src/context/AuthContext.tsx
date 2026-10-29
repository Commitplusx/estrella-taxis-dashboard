import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, BASE_URL, type TraccarUser } from '../lib/traccarApi';
import { taxiAdminClient } from '../lib/taxiAdminClient';
import { issueTrackingCredential } from '../lib/trackingClient';
import { bindTaxiAccount, restoreTrackingUser } from '../lib/taxiSession';
import { useNativeApp } from '../hooks/useNativeApp';
import { taxiCoverageCache } from '../lib/taxiCoverageCache';

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
    const account = await bindTaxiAccount(u.id, {
      clearCredential: () => localStorage.removeItem('traccar_token'),
      issueCredential: () => {
        const expiration = new Date();
        expiration.setMonth(expiration.getMonth() + 6);
        return issueTrackingCredential(expiration);
      },
      saveCredential: (credential) => localStorage.setItem('traccar_token', credential),
      readContext: () => taxiAdminClient.context(),
    });
    if (u.administrator) {
      setUserRole('superadmin');
      setEmpresaId(null);
      setEmpresaData(null);
      setPaqueteActual(null);
      return;
    }
    // The private Stellar database is accessed through the verified Traccar identity.
    const company = account.tenants[0];
    if (account.tenants.length !== 1 || !company) {
      throw new Error('Tu cuenta necesita una base de taxis asignada.');
    }
    setUserRole(account.canConfigure ? 'admin_empresa' : 'operador');
    setEmpresaId(company.id);
    setEmpresaData({ id: company.id, nombre_empresa: company.name, logo_url: null, tipo_negocio: 'taxi' });
    const plan = company.plan;
    setPaqueteActual(plan ? { ...plan, permisos_sistema: {
      ...plan.permisos_sistema,
      reporte_pdf: plan.permisos_sistema.reporte_pdf === true,
      score_diario: plan.permisos_sistema.score_diario === true,
      enrutamiento_vectorial: plan.permisos_sistema.enrutamiento_vectorial === true,
      mapa_calor: plan.permisos_sistema.mapa_calor === true,
    } } : null);
  };

  // Al arrancar, verificar si ya hay sesión activa o si viene un token en la URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    const acceptUser = async (u: TraccarUser) => {
      await loadRole(u);
      setUser(u);
    };
    const failedSession = () => {
      taxiCoverageCache().clear();
      localStorage.removeItem('traccar_token');
      setUser(null); setUserRole(null); setEmpresaId(null); setEmpresaData(null); setPaqueteActual(null);
    };
    if (token) {
      // Intentar iniciar sesión usando el token
      fetch(`${BASE_URL}/session?token=${encodeURIComponent(token)}`, { credentials: 'include' })
        .then(async (res) => {
          if (!res.ok) throw new Error('Token inválido o expirado');
          const userData = await res.json();
          await acceptUser(userData);
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch(failedSession)
        .finally(() => setLoading(false));
    } else {
      // Flujo normal web: verificar sesión existente mediante cookie
      restoreTrackingUser<TraccarUser>({
        cookieUser: () => api.getSession(),
        savedCredential: () => localStorage.getItem('traccar_token'),
        resumeUser: (credential) => api.loginWithToken(credential),
      }).then(acceptUser).catch(failedSession).finally(() => setLoading(false));
    }
  }, []);

  const login = async (email: string, password: string) => {
    const loggedUser = await api.login(email, password);
    await loadRole(loggedUser);
    setUser(loggedUser);
    const appToken = localStorage.getItem('traccar_token');
    if (appToken) postMessage(`login|${appToken}`);
  };

  const logout = async () => {
    try {
      await api.logout();
      postMessage('logout');
    } catch (e) {
      console.error('Error during logout:', e);
    } finally {
      taxiCoverageCache().clear();
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
