/**
 * Agrupación de actividad histórica (K-Means).
 *
 * - Inicialización determinista por puntos separados, reproducible para auditoría.
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
 * K-Means con semillas deterministas por máxima separación.
 * @param rawData Observaciones históricas; no prueban demanda de pasajeros.
 * @param k Número máximo de zonas a identificar.
 * @param maxIterations Límite de iteraciones para forzar la salida
 */
export function calculateKMeans(rawData: Point[], k: number = 3, maxIterations: number = 50): Cluster[] {
  // 1. Limpieza de datos robusta
  if (!Array.isArray(rawData)) return [];
  if (!Number.isInteger(k) || k < 1 || k > 20 || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 100 || rawData.length > 20000) return [];
  const data = rawData.filter(isValidPoint).sort((a,b) => a.lat-b.lat || a.lng-b.lng);
  
  if (data.length === 0) return [];
  
  // Agrupar coordenadas idénticas también cuando hay menos observaciones que k.
  if (data.length <= k) {
    const groups=new Map<string,Cluster>();
    for(const point of data){const key=point.lat+','+point.lng;const group=groups.get(key);if(group){group.points.push(point);group.weight++;}else groups.set(key,{centroid:point,points:[point],weight:1});}
    return [...groups.values()].sort((a,b)=>b.weight-a.weight || a.centroid.lat-b.centroid.lat || a.centroid.lng-b.centroid.lng);
  }

  // Deterministic farthest-first initialization, without a random winning zone.
  const centroids: Point[] = [];
  
  // Primera coordenada en el orden estable.
  centroids.push(data[0]);
  
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
    
    // Elegir la observación más alejada de las semillas existentes.
    if (sumDistances === 0) break;
    let selectedIndex = 0;
    for (let j = 1; j < data.length; j++) if (distances[j] > distances[selectedIndex]) selectedIndex = j;
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
    for (let i = 0; i < centroids.length; i++) {
      const cluster = clusters[i];
      
      if (cluster.points.length === 0) {
        // Una zona vacía no participa en el resultado; conservar su semilla evita NaN.
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
      cluster.centroid={lat:newLat,lng:newLng};

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

  // Zonas con observaciones, ordenadas por peso y coordenadas estables.
  return clusters
    .filter(c => c.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.centroid.lat-b.centroid.lat || a.centroid.lng-b.centroid.lng);
}
