/**
 * Módulo de Mapas de Calor (K-Means Clustering)
 * 
 * Versión Robusta:
 * - Algoritmo K-Means++ para inicialización inteligente (evita óptimos locales y clusters vacíos).
 * - Epsilon (ε) para tolerancia de movimiento (previene ciclos infinitos por flotantes).
 * - Protección contra sets de datos vacíos o menores a K.
 * - Validación de puntos inválidos.
 */

export interface Point {
  lat: number;
  lng: number;
}

export interface Cluster {
  centroid: Point;
  points: Point[];
  weight: number; 
}

function isValidPoint(p: Point): boolean {
  if (!p) return false;
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && 
         p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
}

// Distancia al cuadrado (más rápida para comparar sin Math.sqrt)
function getDistanceSquared(p1: Point, p2: Point): number {
  return Math.pow(p1.lat - p2.lat, 2) + Math.pow(p1.lng - p2.lng, 2);
}

/**
 * Algoritmo K-Means++ (K-Means Robusto) para encontrar zonas calientes de demanda.
 * @param rawData Puntos de demanda (ej. coordenadas de los viajes de hoy)
 * @param k Número de zonas calientes a identificar (ej. 3)
 * @param maxIterations Límite de iteraciones para forzar la salida
 */
export function calculateKMeans(rawData: Point[], k: number = 3, maxIterations: number = 50): Cluster[] {
  // 1. Limpieza de datos robusta
  if (!Array.isArray(rawData)) return [];
  const data = rawData.filter(isValidPoint);
  
  if (data.length === 0) return [];
  
  // Si pedimos más clusters que puntos, cada punto es su propio cluster
  if (data.length <= k) {
    return data.map(p => ({ centroid: p, points: [p], weight: 1 }));
  }

  // 2. Inicialización K-Means++ (Elegir centroides separados inteligentemente)
  let centroids: Point[] = [];
  
  // El primer centroide es totalmente aleatorio
  centroids.push(data[Math.floor(Math.random() * data.length)]);
  
  for (let i = 1; i < k; i++) {
    let sumDistances = 0;
    const distances: number[] = new Array(data.length);
    
    // Calcular distancia de cada punto al centroide más cercano ya elegido
    for (let j = 0; j < data.length; j++) {
      let minDistSq = Infinity;
      for (const c of centroids) {
        const dSq = getDistanceSquared(data[j], c);
        if (dSq < minDistSq) minDistSq = dSq;
      }
      distances[j] = minDistSq;
      sumDistances += minDistSq;
    }
    
    // Elegir el siguiente centroide con probabilidad proporcional a la distancia al cuadrado
    let target = Math.random() * sumDistances;
    let selectedIndex = 0;
    for (let j = 0; j < data.length; j++) {
      target -= distances[j];
      if (target <= 0) {
        selectedIndex = j;
        break;
      }
    }
    centroids.push(data[selectedIndex]);
  }

  let clusters: Cluster[] = [];
  let iterations = 0;
  let centroidsMoved = true;
  
  // EPSILON: Tolerancia mínima de movimiento para considerar que convergió
  // 1e-10 es menos de un milímetro en la vida real. Evita loops infinitos de flotantes.
  const EPSILON = 1e-10;

  while (centroidsMoved && iterations < maxIterations) {
    clusters = centroids.map(c => ({ centroid: { ...c }, points: [], weight: 0 }));

    // Asignar puntos al cluster más cercano
    for (const point of data) {
      let minDistanceSq = Infinity;
      let closestIdx = 0;

      for (let i = 0; i < centroids.length; i++) {
        const dSq = getDistanceSquared(point, centroids[i]);
        if (dSq < minDistanceSq) {
          minDistanceSq = dSq;
          closestIdx = i;
        }
      }
      clusters[closestIdx].points.push(point);
      clusters[closestIdx].weight++;
    }

    centroidsMoved = false;

    // Recalcular centroides
    for (let i = 0; i < k; i++) {
      const cluster = clusters[i];
      
      if (cluster.points.length === 0) {
        // TRUCO ROBUSTO: Si un cluster quedó vacío, le asignamos un punto aleatorio nuevo
        // para que no se desperdicie el cluster ni genere NaN
        const randomFallback = data[Math.floor(Math.random() * data.length)];
        centroids[i] = { lat: randomFallback.lat, lng: randomFallback.lng };
        centroidsMoved = true;
        continue;
      }

      let sumLat = 0;
      let sumLng = 0;
      for (const p of cluster.points) {
        sumLat += p.lat;
        sumLng += p.lng;
      }
      
      const newLat = sumLat / cluster.points.length;
      const newLng = sumLng / cluster.points.length;

      // Evaluar movimiento contra EPSILON en vez de estricta igualdad (===)
      if (
        Math.abs(newLat - centroids[i].lat) > EPSILON || 
        Math.abs(newLng - centroids[i].lng) > EPSILON
      ) {
        centroidsMoved = true;
        centroids[i] = { lat: newLat, lng: newLng };
      }
    }

    iterations++;
  }

  // Devolver clusters filtrando los que hayan quedado en 0 a pesar del fallback
  // y ordenados de mayor a menor peso (demanda)
  return clusters
    .filter(c => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}
