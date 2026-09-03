import { createClient } from 'npm:@supabase/supabase-js@2'
import * as path from 'https://deno.land/std@0.188.0/path/mod.ts'
import { config } from 'https://deno.land/std@0.168.0/dotenv/mod.ts'
import { procesarPerfilCliente } from '../supabase/functions/whatsapp-bot/mandadito/extractor_memoria.ts'

// Cargar variables de entorno desde el .env raíz del proyecto
const env = await config({ path: '../.env' })
let SUPABASE_URL = env.SUPABASE_URL || Deno.env.get('SUPABASE_URL') || env.VITE_SUPABASE_URL || Deno.env.get('VITE_SUPABASE_URL') || ''
let SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

if (!SUPABASE_URL) {
  SUPABASE_URL = prompt('❌ No encontré SUPABASE_URL. Por favor pégalo aquí (ej. https://xxx.supabase.co):') || ''
}
if (!SUPABASE_KEY) {
  SUPABASE_KEY = prompt('❌ No encontré SUPABASE_SERVICE_ROLE_KEY. Pégalo aquí (tu secret role key):') || ''
}
if (!Deno.env.get('DEEPSEEK_API_KEY') && !Deno.env.get('OPENAI_API_KEY') && !env.DEEPSEEK_API_KEY) {
  const aiKey = prompt('❌ No encontré tu llave de IA. Pega tu DEEPSEEK_API_KEY aquí:') || ''
  if (aiKey) Deno.env.set('DEEPSEEK_API_KEY', aiKey)
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Faltan credenciales de Supabase. Abortando.")
  Deno.exit(1)
}

// Inyectamos las credenciales al entorno para que extractor_memoria.ts las lea
Deno.env.set('SUPABASE_URL', SUPABASE_URL)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_KEY)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const CHATS_DIR = 'C:/Users/Kaleb/Desktop/chats ia'

async function getFolders(dir: string): Promise<string[]> {
  const folders: string[] = []
  try {
    for await (const dirEntry of Deno.readDir(dir)) {
      if (dirEntry.isDirectory) {
        folders.push(dirEntry.name)
      }
    }
  } catch (err) {
    console.error(`Error leyendo directorio ${dir}:`, err)
  }
  return folders
}

function extractPhoneFromName(name: string): string | null {
  // Ej: "Chat de WhatsApp con +52 963 269 6276" -> "9632696276"
  const digits = name.replace(/\D/g, '')
  if (digits.length >= 10) {
    return digits.slice(-10) // Toma los últimos 10 (ignora código de país)
  }
  return null
}

async function getOrCreateClient(phone: string, rawName: string): Promise<boolean> {
  // Verifica si el cliente ya existe
  const { data, error } = await supabase.from('clientes').select('id, nombre').eq('telefono', phone).maybeSingle()
  if (error) {
    console.error(`Error consultando cliente ${phone}:`, error)
    return false
  }

  if (data) {
    console.log(`✅ Cliente encontrado en DB: ${data.nombre} (${phone})`)
    return true
  }

  // No existe, crearlo
  let nombreLimpio = rawName.replace('Chat de WhatsApp con ', '').trim()
  if (nombreLimpio.startsWith('+')) nombreLimpio = `Cliente ${phone}`

  console.log(`➕ Creando nuevo cliente: ${nombreLimpio} (${phone})...`)
  const fakeQrCode = `QR-${crypto.randomUUID()}`
  const { error: insertError } = await supabase.from('clientes').insert({
    telefono: phone,
    nombre: nombreLimpio,
    qr_code: fakeQrCode,
    acepta_terminos: false
  })

  if (insertError) {
    console.error("Error insertando cliente:", insertError)
    return false
  }
  return true
}

async function run() {
  console.log("=====================================================")
  console.log("🚀 INICIANDO PROCESADOR MASIVO DE CHATS (MODO IA)")
  console.log("=====================================================")
  
  const folders = await getFolders(CHATS_DIR)
  if (folders.length === 0) {
    console.log("No se encontraron carpetas en", CHATS_DIR)
    return
  }
  
  console.log(`Encontradas ${folders.length} carpetas. Empezando revisión...\n`)

  for (const folder of folders) {
    console.log(`\n📂 Evaluando: ${folder}`)
    let phone = extractPhoneFromName(folder)

    // Interacción manual si no se encuentra número
    if (!phone) {
      const nombreContacto = folder.replace('Chat de WhatsApp con ', '').trim()
      const answer = prompt(`[?] No detecté número para "${nombreContacto}". Ingresa su número a 10 dígitos (o dale Enter para saltarlo):`)
      
      if (!answer || answer.trim() === '') {
        console.log(`⏭️  Saltando "${nombreContacto}"...`)
        continue
      }
      
      const cleanAnswer = answer.replace(/\D/g, '')
      if (cleanAnswer.length >= 10) {
        phone = cleanAnswer.slice(-10)
      } else {
        console.log(`⚠️ Número inválido, saltando...`)
        continue
      }
    }

    // Ya tenemos un número válido de 10 dígitos
    const successClient = await getOrCreateClient(phone, folder)
    if (!successClient) continue

    // Buscar archivo .txt
    const folderPath = path.join(CHATS_DIR, folder)
    let txtContent = ""
    try {
      for await (const fileEntry of Deno.readDir(folderPath)) {
        if (fileEntry.isFile && fileEntry.name.endsWith('.txt')) {
          const txtPath = path.join(folderPath, fileEntry.name)
          const rawText = await Deno.readTextFile(txtPath)
          
          // Tomar solo los últimos 150 mensajes para ahorrar tokens
          const lines = rawText.split('\n')
          const recentLines = lines.slice(-150)
          txtContent = recentLines.join('\n')
          break
        }
      }
    } catch (e) {
      console.error(`Error leyendo archivo en ${folderPath}:`, e)
    }

    if (!txtContent) {
      console.log(`⚠️ No se encontró texto o archivo .txt en ${folder}, saltando...`)
      continue
    }

    console.log(`🧠 Enviando a Cerebro IA (${phone}) - Historial de ${txtContent.split('\n').length} líneas...`)
    
    // Llamamos al extractor
    try {
      await procesarPerfilCliente(phone, txtContent)
      console.log(`✅ ¡Perfil de ${phone} guardado exitosamente!`)
    } catch (e) {
      console.error(`❌ Error procesando IA para ${phone}:`, e)
    }

    // Sleep 3 segundos (Rate limit mitigation)
    console.log("⏳ Pausa de 3 segundos para no saturar la API...")
    await new Promise(r => setTimeout(r, 3000))
  }

  console.log("\n=====================================================")
  console.log("🎉 TODOS LOS CHATS HAN SIDO PROCESADOS")
  console.log("=====================================================")
}

run()
