/**
 * Cache global en memoria para las peticiones a Traccar.
 * Evita re-fetches innecesarios cuando el usuario navega entre páginas.
 * Solo se invalida cuando el usuario hace una mutación (POST/PUT/DELETE).
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// TTL por defecto: 30 segundos. El WebSocket mantiene los datos de posición
// actualizados en tiempo real, así que solo necesitamos TTL para los datos
// "estáticos" como dispositivos, usuarios, grupos, etc.
const DEFAULT_TTL_MS = 30_000;

class DataCache {
  private store = new Map<string, CacheEntry<any>>();

  get<T>(key: string, ttlMs = DEFAULT_TTL_MS): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttlMs) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.store.set(key, { data, timestamp: Date.now() });
  }

  /** Invalida una clave específica (tras una mutación) */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Invalida todas las claves que empiecen con un prefijo */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}

export const dataCache = new DataCache();
