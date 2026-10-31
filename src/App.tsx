import React, {lazy,Suspense} from 'react';
import {taxiAppAccess} from './lib/taxiAppAccess';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import MapPage from './pages/MapPage';
import DevicesPage from './pages/DevicesPage';
import UsersPage from './pages/UsersPage';
import ReportsPage from './pages/ReportsPage';
import ReplayPage from './pages/ReplayPage';
import NotificationsPage from './pages/NotificationsPage';
import GroupsPage from './pages/GroupsPage';
import DriversPage from './pages/DriversPage';
import GeofencesPage from './pages/GeofencesPage';
import MaintenancePage from './pages/MaintenancePage';
import SettingsPage from './pages/SettingsPage';
import DeviceConnectionsPage from './pages/DeviceConnectionsPage';
import BotPage from './pages/BotPage';
import PackagesPage from './pages/PackagesPage';
import CatalogPage from './pages/CatalogPage';
import OrdersPage from './pages/OrdersPage';
import InvoicesPage from './pages/InvoicesPage';
import TrackPage from './pages/TrackPage';
const TaxiBotAdminPage=lazy(()=>import('./pages/TaxiBotAdminPage'));

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, userRole } = useAuth();
  const location = useLocation();
  if(user&&!taxiAppAccess(userRole).canOpen(location.pathname))return <Navigate to={taxiAppAccess(userRole).home} replace/>;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function TaxiOnlyRoute({ children }: { children: React.ReactNode }) {
  const { userRole, empresaData } = useAuth();
  if (userRole !== 'superadmin' && empresaData && empresaData.tipo_negocio !== 'taxi') {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-400">Restaurando sesión...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster 
        position="bottom-center"
        toastOptions={{
          style: {
            background: '#333',
            color: '#fff',
            borderRadius: '16px',
            fontSize: '14px',
            fontWeight: '500',
            marginBottom: '80px', // Above bottom nav
          },
          success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
        }}
      />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/map" element={<TaxiOnlyRoute>{null}</TaxiOnlyRoute>} />
          <Route path="/devices" element={<TaxiOnlyRoute><DevicesPage /></TaxiOnlyRoute>} />
          <Route path="/connections" element={<TaxiOnlyRoute><DeviceConnectionsPage /></TaxiOnlyRoute>} />
          <Route path="/reports" element={<TaxiOnlyRoute><ReportsPage /></TaxiOnlyRoute>} />
          <Route path="/replay" element={<TaxiOnlyRoute><ReplayPage /></TaxiOnlyRoute>} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/groups" element={<TaxiOnlyRoute><GroupsPage /></TaxiOnlyRoute>} />
          <Route path="/drivers" element={<TaxiOnlyRoute><DriversPage /></TaxiOnlyRoute>} />
          <Route path="/geofences" element={<TaxiOnlyRoute><GeofencesPage /></TaxiOnlyRoute>} />
          <Route path="/maintenance" element={<TaxiOnlyRoute><MaintenancePage /></TaxiOnlyRoute>} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/bot" element={<BotPage />} />
          <Route path="/taxi-bot" element={<TaxiOnlyRoute><Suspense fallback={<p className="p-8">Cargando panel del bot…</p>}><TaxiBotAdminPage/></Suspense></TaxiOnlyRoute>} />
          <Route path="/zonas-tarifas" element={<TaxiOnlyRoute><Suspense fallback={<p className="p-8">Cargando zonas y tarifas…</p>}><TaxiBotAdminPage zoneEditor/></Suspense></TaxiOnlyRoute>} />
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
        </Route>
        {/* Ruta pública de seguimiento — no requiere login, el cliente la abre desde el WhatsApp */}
        <Route path="/track/:token" element={<TrackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  if(import.meta.env.DEV&&window.location.pathname==='/conductores-diseno')return <DriversPage preview/>;
  if(import.meta.env.DEV&&window.location.pathname==='/zonas-tarifas-diseno')return <Suspense fallback={<p className="p-8">Cargando zonas y tarifas…</p>}><TaxiBotAdminPage preview zoneEditor/></Suspense>;
  if(import.meta.env.DEV&&window.location.pathname==='/taxi-bot-diseno')return <Suspense fallback={<p className="p-8">Cargando vista de diseño…</p>}><TaxiBotAdminPage preview/></Suspense>;
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
