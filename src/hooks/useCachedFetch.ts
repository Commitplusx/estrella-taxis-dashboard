import { useState, useEffect, useCallback } from 'react';
import { dataCache } from '../lib/cache';

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
  url: string,
  options: UseCachedFetchOptions = {}
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const { ttlMs = 30_000, autoRefresh = false } = options;
  const [data, setData] = useState<T | null>(() => dataCache.get<T>(url, ttlMs));
  const [loading, setLoading] = useState<boolean>(!dataCache.get<T>(url, ttlMs));
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    // Revisar caché primero
    const cached = dataCache.get<T>(url, ttlMs);
    if (cached !== null) {
      setData(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: T = await res.json();
      dataCache.set(url, json);
      setData(json);
    } catch (e: any) {
      setError(e.message || 'Error de red');
    } finally {
      setLoading(false);
    }
  }, [url, ttlMs]);

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, ttlMs);
    return () => clearInterval(interval);
  }, [fetchData, autoRefresh, ttlMs]);

  return { data, loading, error, refetch: fetchData };
}
