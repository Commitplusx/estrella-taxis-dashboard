import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import 'https://deno.land/std@0.168.0/dotenv/load.ts'
import { procesarPerfilCliente } from './extractor_memoria.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Script de Backfill: Carga el historial de pedidos y ubicaciones de clientes frecuentes,
 * y los manda a la IA para poblar `cliente_perfiles`.
 */
async function runBackfill() {
  console.log("Iniciando script de Backfill histórico...")

  // 1. Obtener clientes con historial de pedidos (limitamos a los que tienen al menos 1 pedido para la prueba)
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('cliente_telefono, descripcion, total, created_at, notas, direccion_entrega')
    .order('created_at', { ascending: false })

  if (error || !pedidos) {
    console.error("Error obteniendo pedidos:", error)
    return
  }

  // Agrupar por cliente
  const historialPorCliente: Record<string, any[]> = {}
  for (const p of pedidos) {
    if (!p.cliente_telefono) continue
    if (!historialPorCliente[p.cliente_telefono]) historialPorCliente[p.cliente_telefono] = []
    historialPorCliente[p.cliente_telefono].push(p)
  }

  // 2. Obtener ubicaciones guardadas
  const { data: ubicaciones } = await supabase
    .from('cliente_ubicaciones')
    .select('cliente_telefono, lat, lng, colonia_nombre, tipo, notas')

  const ubiPorCliente: Record<string, any[]> = {}
  if (ubicaciones) {
    for (const u of ubicaciones) {
      if (!u.cliente_telefono) continue
      if (!ubiPorCliente[u.cliente_telefono]) ubiPorCliente[u.cliente_telefono] = []
      ubiPorCliente[u.cliente_telefono].push(u)
    }
  }

  // 3. Procesar cada cliente
  for (const [telefono, pedidosCliente] of Object.entries(historialPorCliente)) {
    // Si tiene menos de 2 pedidos, lo saltamos (opcional, para ahorrar tokens)
    if (pedidosCliente.length < 2 && !ubiPorCliente[telefono]) continue;

    console.log(`\nArmando expediente para ${telefono}...`)
    
    let expediente = `--- HISTORIAL DE PEDIDOS ---\n`
    for (const p of pedidosCliente.slice(0, 10)) { // Max 10 pedidos recientes
      expediente += `- Fecha: ${p.created_at}\n`
      expediente += `  Desc: ${p.descripcion}\n`
      expediente += `  Total: $${p.total}\n`
      if (p.notas) expediente += `  Notas: ${p.notas}\n`
      if (p.direccion_entrega) expediente += `  Dirección: ${p.direccion_entrega}\n`
    }

    if (ubiPorCliente[telefono]) {
      expediente += `\n--- UBICACIONES GUARDADAS ---\n`
      for (const u of ubiPorCliente[telefono]) {
        expediente += `- Alias: ${u.tipo}\n`
        expediente += `  Coords: ${u.lat}, ${u.lng}\n`
        expediente += `  Nombre: ${u.colonia_nombre}\n`
        if (u.notas) expediente += `  Notas: ${u.notas}\n`
      }
    }

    // 4. Enviar a procesar a la IA
    await procesarPerfilCliente(telefono, expediente)
    
    // Pequeño delay para no saturar la API
    await new Promise(res => setTimeout(res, 1000))
  }

  console.log("\n✅ Backfill completado.")
}

// Ejecutar si se llama directamente (ej. deno run)
if (import.meta.main) {
  runBackfill()
}
