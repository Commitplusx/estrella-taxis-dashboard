/**
 * importar_kml.js
 * Lee "mapa comitan 2.kml", extrae los polígonos por zona,
 * los sube a zonas_gps (con ST_Union por zona) y reconstruye
 * zonas_tarifas con la lógica: precio = max(precio_origen, precio_destino)
 *
 * Uso: node scripts/importar_kml.js
 */

import * as fs from 'fs'
import { execSync } from 'child_process'

const KML_PATH = 'C:/Users/asus_/Downloads/mapa comitan 2(1).kml'

// ── Precios definidos por el usuario ─────────────────────────────────────────
const ZONA_PRECIOS = {
  'zona verde':    45,
  'zona azul':     50,
  'zona amarilla': 60,
  'zona naranja':  70,
  'zona roja':     80,
  'zona morada':   85,
  'zona negra':   100,
  'zona gris':    120,
}

// Normalizar nombre de zona
function normalizarZona(nombre) {
  return nombre.trim().toLowerCase()
    .replace(/^zona\s+/, 'zona ')
    .replace(/\s+/g, ' ')
}

// ── Parsear KML ───────────────────────────────────────────────────────────────
function parsearKML(kmlPath) {
  const kml = fs.readFileSync(kmlPath, 'utf-8')
  
  // Extraer todos los Placemarks con Polygon (incluyendo MultiGeometry)
  const zonas = {}  // nombre → [lista de coordinate strings]
  
  // Regex para extraer placemarks
  const pmRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g
  let pm
  while ((pm = pmRegex.exec(kml)) !== null) {
    const block = pm[1]
    
    // Nombre
    const nameMatch = block.match(/<name>(.*?)<\/name>/)
    if (!nameMatch) continue
    const nombre = normalizarZona(nameMatch[1])
    if (!ZONA_PRECIOS[nombre]) continue  // Solo procesamos zonas conocidas
    
    // Extraer todas las coordenadas de <outerBoundaryIs> (puede haber MultiGeometry)
    const coordRegex = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/outerBoundaryIs>/g
    let coordMatch
    while ((coordMatch = coordRegex.exec(block)) !== null) {
      const rawCoords = coordMatch[1].trim()
      // Convertir "lng,lat,alt" a "lng lat" para WKT
      const points = rawCoords.split(/\s+/).filter(Boolean).map(c => {
        const [lng, lat] = c.split(',')
        return `${parseFloat(lng).toFixed(7)} ${parseFloat(lat).toFixed(7)}`
      })
      if (points.length < 3) continue
      // Cerrar el polígono si no está cerrado
      if (points[0] !== points[points.length - 1]) points.push(points[0])
      
      if (!zonas[nombre]) zonas[nombre] = []
      zonas[nombre].push(points.join(', '))
    }
  }
  
  return zonas
}

// ── Ejecutar SQL ──────────────────────────────────────────────────────────────
function runSQL(sql, label) {
  const tmpFile = 'scripts/_kml_tmp.sql'
  fs.writeFileSync(tmpFile, sql, 'utf-8')
  try {
    execSync(`npx supabase db query --file ${tmpFile} --linked`, { stdio: 'ignore' })
    console.log(`  ✅ ${label}`)
    return true
  } catch (e) {
    console.error(`  ❌ Error en ${label}:`, e.message)
    return false
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('🗺️  Importando KML: mapa comitan 2.kml\n')

  // 1. Parsear KML
  console.log('1️⃣  Parseando polígonos...')
  const zonas = parsearKML(KML_PATH)
  const zonasEncontradas = Object.keys(zonas)
  console.log(`   Zonas encontradas: ${zonasEncontradas.join(', ')}\n`)

  // 2. Limpiar zonas_gps y recrear
  console.log('2️⃣  Actualizando zonas_gps en Supabase...')
  runSQL('DELETE FROM zonas_tarifas;', 'Limpiar zonas_tarifas')
  runSQL('DELETE FROM zonas_gps;', 'Limpiar zonas_gps')

  // 3. Insertar cada zona (uniendo todos sus polígonos con ST_Union)
  const zonaIds = {}
  for (const [nombre, polygons] of Object.entries(zonas)) {
    const nombreDB = nombre.toUpperCase().replace('zona ', 'ZONA ')
    
    // Construir WKT union de todos los polígonos
    const polysWKT = polygons.map(coords => `ST_GeomFromText('POLYGON((${coords}))', 4326)`).join(', ')
    const geomExpr = polygons.length === 1
      ? polysWKT
      : `ST_Union(ARRAY[${polysWKT}])`
    
    const sql = `
      INSERT INTO zonas_gps (nombre, geom)
      VALUES ('${nombreDB}', ${geomExpr})
      RETURNING id;
    `
    // Hacemos el insert y luego consultamos el ID
    const insertSQL = `
      INSERT INTO zonas_gps (nombre, geom)
      VALUES ('${nombreDB}', ${geomExpr});
    `
    runSQL(insertSQL, `Zona: ${nombreDB} (${polygons.length} polígono${polygons.length > 1 ? 's' : ''})`)
  }

  // 4. Leer IDs recién insertados
  console.log('\n3️⃣  Leyendo IDs de las zonas insertadas...')
  const raw = execSync(
    `npx supabase db query "SELECT id, nombre FROM zonas_gps ORDER BY nombre" --linked --output json`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
  )
  const startR = raw.indexOf('"rows"')
  const arrStart = raw.indexOf('[', startR)
  let depth = 0, arrEnd = -1
  for (let k = arrStart; k < raw.length; k++) {
    if (raw[k] === '[') depth++
    else if (raw[k] === ']') { depth--; if (depth === 0) { arrEnd = k; break } }
  }
  const rows = JSON.parse(raw.substring(arrStart, arrEnd + 1))
  console.log(`   Zonas en BD: ${rows.map(r => r.nombre).join(', ')}\n`)

  // Mapear nombre normalizado → ID
  for (const row of rows) {
    const key = row.nombre.toLowerCase().replace('zona_', 'zona ').replace('_', ' ')
    zonaIds[row.nombre] = row.id
  }

  // 5. Construir matriz 7×7 de zonas_tarifas
  console.log('4️⃣  Generando matriz de tarifas (7×7)...')
  
  const insertsTarifa = []
  for (const origenRow of rows) {
    for (const destinoRow of rows) {
      const oNombre = origenRow.nombre.toLowerCase().replace('zona ', 'zona ')
      const dNombre = destinoRow.nombre.toLowerCase().replace('zona ', 'zona ')
      
      // Normalizar para buscar en ZONA_PRECIOS
      const oKey = oNombre.replace('zona_', 'zona ').toLowerCase()
      const dKey = dNombre.replace('zona_', 'zona ').toLowerCase()
      
      const oPrecio = ZONA_PRECIOS[oKey] ?? ZONA_PRECIOS[`zona ${oKey.split(' ').pop()}`] ?? 100
      const dPrecio = ZONA_PRECIOS[dKey] ?? ZONA_PRECIOS[`zona ${dKey.split(' ').pop()}`] ?? 100
      
      // Precio = máximo de los dos
      const precio = Math.max(oPrecio, dPrecio)
      
      insertsTarifa.push(
        `('${origenRow.id}', '${destinoRow.id}', ${precio})`
      )
    }
  }

  const tarifaSQL = `INSERT INTO zonas_tarifas (origen_zona_id, destino_zona_id, precio) VALUES\n${insertsTarifa.join(',\n')};`
  runSQL(tarifaSQL, `Insertar ${insertsTarifa.length} tarifas`)

  // Cleanup
  try { fs.unlinkSync('scripts/_kml_tmp.sql') } catch (e) {}

  console.log('\n🎉 ¡Importación completada!')
  console.log('   Las zonas_gps y zonas_tarifas han sido actualizadas.')
  console.log('   El bot ya puede calcular rutas con las 7 nuevas zonas.\n')
  
  // Mostrar resumen de precios
  console.log('📋 Resumen de precios por zona destino:')
  for (const [zona, precio] of Object.entries(ZONA_PRECIOS)) {
    console.log(`   ${zona}: $${precio}`)
  }
  console.log('\n   (Precio de un viaje = max(precio origen, precio destino))')
}

run()
