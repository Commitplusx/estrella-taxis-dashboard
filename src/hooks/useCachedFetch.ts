import { useState, useEffect, useCallback } from 'react';
import { dataCache } from '../lib/cache';
import { BASE_URL } from '../lib/traccarApi';

interface UseCachedFetchOptions {
  /** Tiempo de vida del cache en ms. Por defecto 30s */
  ttlMs?: number;
  /** Si es true, re-fetches automáticamente cada `ttlMs` */
  autoRefresh?: boolean;
}

/**
 * Hook que hace fetch con caché en memoria.
 * Si los datos ya están en cache y no expiraron, los devuelve inmediatamente
 * sin hacer una nueva petición al servidor.
 */
export function useCachedFetch<T>(
  path: string,
  options: UseCachedFetchOptions = {}
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const { ttlMs = 30_000, autoRefresh = false } = options;
  const fullUrl = path.startsWith('/api') ? path.replace('/api', BASE_URL) : path;
  
  const [data, setData] = useState<T | null>(() => dataCache.get<T>(fullUrl, ttlMs));
  const [loading, setLoading] = useState<boolean>(!dataCache.get<T>(fullUrl, ttlMs));
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    // Revisar caché primero
    const cached = dataCache.get<T>(fullUrl, ttlMs);
    if (cached !== null) {
      setData(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(fullUrl, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: T = await res.json();
      dataCache.set(fullUrl, json);
      setData(json);
    } catch (e: any) {
      setError(e.message || 'Error de red');
    } finally {
      setLoading(false);
    }
  }, [fullUrl, ttlMs]);

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, ttlMs);
    return () => clearInterval(interval);
  }, [fetchData, autoRefresh, ttlMs]);

  return { data, loading, error, refetch: fetchData };
}
