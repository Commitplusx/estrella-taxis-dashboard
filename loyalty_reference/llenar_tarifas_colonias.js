/**
 * Asistente de Tarifas Colonia a Colonia (PILOTO AUTOMÁTICO)
 * 
 * Uso: node scripts/llenar_tarifas_colonias.js
 */

import * as fs from 'fs'
import { execSync } from 'child_process'

// ── CONFIGURACIÓN ───────────────────────────────────────────────────────────
const UMBRAL_DISTANCIA_METROS = 800
const DESCUENTO_CERCANIA = 5

// ── Ejecutar SQL de Supabase y devolver JSON ────────────────────────────────
function runSqlFile(filename) {
  const raw = execSync(
    `npx supabase db query --file ${filename} --linked --output json`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
  )
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  
  if (start === -1 || end === -1) {
    console.error("RAW OUTPUT:", raw)
    throw new Error(`Query no devolvió un array válido: ${filename}`)
  }
  
  return JSON.parse(raw.substring(start, end + 1))
}

function guardarPreciosBulk(inserts) {
  if (inserts.length === 0) return true
  
  const values = inserts.map(i => `('${i.o}', '${i.d}', ${i.p})`).join(',\n')
  const sql = `INSERT INTO colonias_tarifas (origen_colonia_id, destino_colonia_id, precio) VALUES \n${values}\nON CONFLICT (origen_colonia_id, destino_colonia_id) DO UPDATE SET precio = EXCLUDED.precio;`
  
  fs.writeFileSync('scripts/_tmp_insert.sql', sql)
  try {
    execSync('npx supabase db query --file scripts/_tmp_insert.sql --linked', { stdio: 'ignore' })
    return true
  } catch (e) {
    return false
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('===================================================')
  console.log('🤖 Piloto Automático de Tarifas (Espacial)')
  console.log('===================================================\n')
  console.log(`Aplicando descuento de $${DESCUENTO_CERCANIA} a colonias a menos de ${UMBRAL_DISTANCIA_METROS}m de la zona destino\n`)

  console.log('⏳ Descargando datos y calculando matriz espacial de cruces...')
  
  const colonias = runSqlFile('scripts/colonias_query.sql')
  const tarifasZonas = runSqlFile('scripts/zonas_query.sql')
  const distancias = runSqlFile('scripts/distancias_query.sql')

  // Mapear distancias: colonia_id -> zona_id -> distancia
  const distMap = {}
  for (const row of distancias) {
    if (!distMap[row.colonia_id]) distMap[row.colonia_id] = {}
    distMap[row.colonia_id][row.zona_id] = row.dist_metros
  }

  console.log(`✅ ${colonias.length} colonias cargadas. Analizando las 19,000 combinaciones en memoria...\n`)

  let autoSkipped = 0
  let descuentosAplicados = 0
  const inserts = []

  for (let i = 0; i < colonias.length; i++) {
    for (let j = 0; j < colonias.length; j++) {
      const o = colonias[i]
      const d = colonias[j]

      // Ignorar misma zona (el precio base por default se usa)
      if (o.zona_id && d.zona_id && o.zona_id === d.zona_id) {
        autoSkipped++
        continue
      }

      let precioBase = null
      if (o.zona_id && d.zona_id) {
        const t = tarifasZonas.find(x => x.origen_zona_id === o.zona_id && x.destino_zona_id === d.zona_id)
        if (t) precioBase = t.precio
      }

      if (precioBase !== null) {
        const distO = distMap[o.id]?.[d.zona_id] ?? Infinity
        const distD = distMap[d.id]?.[o.zona_id] ?? Infinity
        
        // Si el origen está cerca del destino, o el destino del origen
        if (distO < UMBRAL_DISTANCIA_METROS || distD < UMBRAL_DISTANCIA_METROS) {
          const precioSugerido = Math.max(0, precioBase - DESCUENTO_CERCANIA)
          inserts.push({ o: o.id, d: d.id, p: precioSugerido })
          descuentosAplicados++
        }
      }
    }
  }

  console.log(`📊 Resultados del análisis:`)
  console.log(`   - Rutas misma zona (ignoradas): ${autoSkipped}`)
  console.log(`   - Rutas lejanas (precio normal): ${(colonias.length * colonias.length) - autoSkipped - descuentosAplicados}`)
  console.log(`   - Rutas FRONTERIZAS (descuento $${DESCUENTO_CERCANIA}): ${descuentosAplicados}\n`)

  if (inserts.length > 0) {
    console.log(`💾 Subiendo ${inserts.length} excepciones a Supabase en una sola consulta...`)
    const ok = guardarPreciosBulk(inserts)
    if (ok) {
      console.log('\n🎉 ¡Tarifas fronterizas guardadas exitosamente!')
      console.log('   El bot ya usará esta información en tiempo real para cotizar más barato en fronteras.')
    } else {
      console.log('\n❌ Error al subir las tarifas a la base de datos.')
    }
  } else {
    console.log('🤷‍♂️ No se encontraron rutas fronterizas para aplicar descuento.')
  }

  try { fs.unlinkSync('scripts/_tmp_insert.sql') } catch (e) {}
}

run()
