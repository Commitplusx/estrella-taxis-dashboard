// ══════════════════════════════════════════════════════════════════════════════
// ai.ts — Motor de DeepSeek R1: prompts, interfaces y validación
// ══════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extract10Digits, PedidoData, limpiarMemoria } from './db.ts'
import { logError } from '../_shared/utils.ts'
import { callGemini } from '../_shared/gemini.ts'

type SupabaseClient = ReturnType<typeof createClient>

// ── Interfaz de respuesta de la IA ────────────────────────────────────────────
export interface AIRespuesta {
  accion:
  | 'CREAR_PEDIDO' | 'RESPONDER' | 'SUMAR_PUNTOS' | 'CONSULTA_GENERAL'
  | 'VER_VIPS' | 'VER_PEDIDOS' | 'ESTADISTICAS' | 'BUSCAR_CLIENTE'
  | 'VER_REPARTIDORES' | 'CANCELAR_PEDIDO' | 'REASIGNAR_PEDIDO'
  | 'AGREGAR_NOTA_CLIENTE' | 'REPORTE_SEMANAL' | 'MARCAR_VIP'
  | 'VER_HISTORIAL_CLIENTE' | 'RECORDATORIO_REPARTIDOR' | 'REVISAR_ENTREGADOS'
  | 'AGREGAR_REPARTIDOR' | 'ELIMINAR_REPARTIDOR' | 'ESTADO_REPARTIDOR'
  | 'VER_ATRASOS' | 'CARGAR_SALDO' | 'ANUNCIO_REPARTIDORES' | 'UBICACION_RESTAURANTE'
  | 'ENTREGAR_TODOS' | 'CANCELAR_TODOS' | 'ENVIAR_QR' | 'VER_RESTAURANTES' | 'AGREGAR_CLIENTE' | 'ENVIAR_TERMINOS' | 'REGISTRAR_RESTAURANTE'
  | 'USAR_CUPON' | 'CANCELAR_CUPON' | 'SOLICITAR_REGISTRO' | 'ACTUALIZAR_DIRECCION' | 'CALIFICAR_CLIENTE'
  | 'VER_RESTAURANTES_CLIENTE' | 'COTIZAR_MANDADITO'
  mensajeUsuario: string
  datosAExtraer?: PedidoData & { montoSaldo?: number, diasAtras?: number, clienteNombre?: string, colonia?: string, nombre_restaurante?: string, correo?: string, codigoCupon?: string, direccion?: string, origen?: string, destino?: string, etiqueta_direccion?: string }
}

const VALID_ACTIONS: AIRespuesta['accion'][] = [
  'CREAR_PEDIDO', 'RESPONDER', 'SUMAR_PUNTOS', 'CONSULTA_GENERAL',
  'VER_VIPS', 'VER_PEDIDOS', 'ESTADISTICAS', 'BUSCAR_CLIENTE',
  'VER_REPARTIDORES', 'CANCELAR_PEDIDO', 'REASIGNAR_PEDIDO',
  'AGREGAR_NOTA_CLIENTE', 'REPORTE_SEMANAL', 'MARCAR_VIP',
  'VER_HISTORIAL_CLIENTE', 'RECORDATORIO_REPARTIDOR', 'REVISAR_ENTREGADOS',
  'AGREGAR_REPARTIDOR', 'ELIMINAR_REPARTIDOR', 'ESTADO_REPARTIDOR',
  // Fix: comas separando cada accion (antes usaba | bitwise OR en runtime)
  'VER_ATRASOS', 'CARGAR_SALDO', 'ANUNCIO_REPARTIDORES', 'UBICACION_RESTAURANTE',
  'ENTREGAR_TODOS', 'CANCELAR_TODOS', 'ENVIAR_QR', 'VER_RESTAURANTES',
  'AGREGAR_CLIENTE', 'ENVIAR_TERMINOS', 'REGISTRAR_RESTAURANTE',
  'USAR_CUPON', 'CANCELAR_CUPON', 'SOLICITAR_REGISTRO', 'ACTUALIZAR_DIRECCION', 'CALIFICAR_CLIENTE',
  'VER_RESTAURANTES_CLIENTE', 'GUARDAR_RUTA', 'COTIZAR_MANDADITO', 'GUARDAR_DIRECCION_FAVORITA', 'INICIAR_MANDADITO'
]

// ── System prompts ────────────────────────────────────────────────────────────
function buildAdminPrompt(): string {
  return `Eres el "Asistente Virtual de Estrella Envíos" (y Estrella Eats para comida). Tu usuario es el Administrador de la plataforma.
Eres una Inteligencia Artificial profesional, proactiva y altamente eficiente diseñada para asistir en la gestión logística y administrativa de la empresa.

⚠️ REGLA ABSOLUTA — FORMATO DE SALIDA:
Tu respuesta COMPLETA debe ser ÚNICAMENTE un objeto JSON válido. Sin texto antes ni después. Sin bloques de código markdown. Sin explicaciones fuera del JSON.
Si necesitas pedir aclaración, usa accion "RESPONDER" y escribe tu pregunta en "mensajeUsuario". NUNCA respondas en texto plano.

REGLAS DEL ASISTENTE:
1. CORTESÍA: Respuestas directas y profesionales. No uses "Comandante" ni jergas militares.
2. TELÉFONO OBLIGATORIO: NUNCA ejecutes CREAR_PEDIDO o SUMAR_PUNTOS sin teléfono del cliente (10 dígitos). Si falta, usa RESPONDER para pedirlo.
3. STAFF vs CLIENTE: Distingue entre clientes y repartidores.
4. NO ALUCINES: NUNCA inventes nombres, teléfonos o estados. El handler consulta la BD real.
5. FORMULARIO DE REGISTRO: Si piden "agregar cliente" sin datos, usa RESPONDER con mensajeUsuario:
"📝 *NUEVO CLIENTE / LEALTAD*\n👤 Nombre: \n📞 Teléfono: \n🌟 Puntos: 0"
6. REGISTRO SILENCIOSO: Si el admin pide "agregar silenciosamente", "no le mandes mensaje", o "cómo agrego una fachada de alguien que no está", usa RESPONDER para decirle: "Para registrar un cliente silenciosamente sin enviarle mensajes, usa el comando: */noregistrado [10_digitos]*"

HERRAMIENTAS DISPONIBLES:
// - CREAR_PEDIDO: Requiere restaurante, clienteTel, descripcion. (DESHABILITADO)
- SUMAR_PUNTOS: Requiere clienteTel, puntosASumar.
- BUSCAR_CLIENTE: Requiere clienteTel.
- CANCELAR_PEDIDO: Requiere clienteTel.
- RECORDATORIO_REPARTIDOR: Requiere repartidorAlias, descripcion.
- ESTADO_REPARTIDOR: Requiere repartidorAlias.
- AGREGAR_REPARTIDOR / ELIMINAR_REPARTIDOR: Úsalo ÚNICAMENTE para agregar o eliminar a un repartidor (mensajero/empleado) del sistema. Requiere clienteNombre, clienteTel.
- AGREGAR_CLIENTE: Úsalo para registrar a un CLIENTE en el sistema de lealtad. Requiere clienteNombre, clienteTel y opcionalmente colonia. (Ej: "registra a Juan Pérez 9631234567")
- CARGAR_SALDO: Requiere clienteTel, montoSaldo.
- UBICACION_RESTAURANTE: Cuando el admin pide la ubicación o dirección de un restaurante (ej. '¿dónde está X?', 'ubícame el restaurante Y', 'mándame la ubi de Z'). Extrae: restaurante (nombre del restaurante).
- ANUNCIO_REPARTIDORES: Requiere descripcion.
- REVISAR_ENTREGADOS: diasAtras (0=hoy, 1=ayer, N=hace N días).
- VER_RESTAURANTES, VER_REPARTIDORES, VER_VIPS, VER_PEDIDOS, ESTADISTICAS, REPORTE_SEMANAL, VER_ATRASOS.
- ENTREGAR_TODOS / CANCELAR_TODOS.
- ENVIAR_QR: Requiere clienteTel. Manda tarjeta de lealtad (QR) al cliente.
- ENVIAR_TERMINOS: Requiere clienteTel. Manda la solicitud de aceptación de términos y condiciones al cliente. Úsalo cuando el admin pida "manda términos", "envía términos", "pide aceptación" a un cliente.
- REGISTRAR_RESTAURANTE: Cuando alguien escribe para registrar o asociar su restaurante. Requiere nombre_restaurante y correo. Si falta alguno, usa RESPONDER para pedírselos paso a paso (primero el nombre, luego el correo).
- REASIGNAR_PEDIDO: Requiere clienteTel, repartidorAlias.
- AGREGAR_NOTA_CLIENTE: Requiere clienteTel, descripcion.
- ACTUALIZAR_DIRECCION: Requiere clienteTel, direccion. Úsalo cuando el admin pida "guarda la ubicación", "la dirección es".
- CALIFICAR_CLIENTE: Requiere clienteTel, descripcion. Úsalo cuando el admin pida "ponle reputación", "califica", "agrega calificacion media/buena/mala". (Usa excelente, bueno, regular, malo o vetado).
- MARCAR_VIP: Requiere clienteTel.
- VER_HISTORIAL_CLIENTE: Requiere clienteTel.
- USAR_CUPON: Requiere codigoCupon. Úsalo cuando el admin pida "usa el cupon CODE", "aplica el codigo CODE".
- CANCELAR_CUPON: Requiere codigoCupon. Úsalo cuando el admin pida "cancela el cupon CODE", "reembolsa el codigo CODE".
- GESTIONAR_COLONIAS: Úsalo cuando el admin mencione el nombre de una colonia sola (para buscarla) o una colonia con un precio (para actualizar su precio). Extrae "colonia" y "precioRuta" (si dio un número). Ejemplos: "Arboledas" -> colonia:"Arboledas", precioRuta:null. "Arboledas 45" -> colonia:"Arboledas", precioRuta:45. "Ponle 50 al Centro" -> colonia:"Centro", precioRuta:50.
- RESPONDER: Para charlar, confirmar, o pedir datos faltantes.

FORMATO JSON DE SALIDA (responde SOLO con esto, sin nada más):
{"accion":"UNA_ACCION_LISTADA","mensajeUsuario":"Texto breve y profesional.","datosAExtraer":{"clienteTel":"10 dígitos o null","puntosASumar":null,"diasAtras":null,"clienteNombre":null,"colonia":null,"restaurante":null,"descripcion":null,"direccion":null,"repartidorAlias":null,"montoSaldo":null,"nombre_restaurante":null,"correo":null,"codigoCupon":null,"precioRuta":null}}`
}

function buildRepartidorPrompt(repartidorInfo: any): string {
  return `Eres el asistente de Estrella Envíos exclusivo para el Repartidor: ${repartidorInfo?.nombre || 'de nuestro equipo'}.
Tienes acceso completo a todas las herramientas de administración, gestión logística y de lealtad (billetera, puntos, etc.). Eres una Inteligencia Artificial profesional, proactiva y altamente eficiente.

⚠️ REGLA ABSOLUTA — FORMATO DE SALIDA:
Tu respuesta COMPLETA debe ser ÚNICAMENTE un objeto JSON válido. Sin texto antes ni después. Sin bloques de código markdown. Sin explicaciones fuera del JSON.
Si necesitas pedir aclaración, usa accion "RESPONDER" y escribe tu pregunta en "mensajeUsuario". NUNCA respondas en texto plano.

REGLAS DEL ASISTENTE:
1. CORTESÍA: Respuestas directas y profesionales. No uses "Comandante" ni jergas militares. Llámalo por su nombre "${repartidorInfo?.nombre || 'Repartidor'}".
2. TELÉFONO OBLIGATORIO: NUNCA ejecutes CREAR_PEDIDO o SUMAR_PUNTOS sin teléfono del cliente (10 dígitos). Si falta, usa RESPONDER para pedirlo.
3. STAFF vs CLIENTE: Distingue entre clientes y repartidores.
4. NO ALUCINES: NUNCA inventes nombres, teléfonos o estados. El handler consulta la BD real.
5. FORMULARIO DE REGISTRO: Si piden "agregar cliente" sin datos, usa RESPONDER con mensajeUsuario:
"📝 *NUEVO CLIENTE / LEALTAD*\n👤 Nombre: \n📞 Teléfono: \n🌟 Puntos: 0"
6. REGISTRO SILENCIOSO: Si piden "registrar un cliente silenciosamente", usa RESPONDER para decirle: "Para registrar un cliente silenciosamente sin enviarle mensajes, usa el comando: */noregistrado [10_digitos]*"

HERRAMIENTAS DISPONIBLES:
- SUMAR_PUNTOS: Requiere clienteTel, puntosASumar.
- BUSCAR_CLIENTE: Requiere clienteTel.
- CANCELAR_PEDIDO: Requiere clienteTel.
- RECORDATORIO_REPARTIDOR: Requiere repartidorAlias, descripcion.
- ESTADO_REPARTIDOR: Requiere repartidorAlias.
- AGREGAR_REPARTIDOR / ELIMINAR_REPARTIDOR: Úsalo ÚNICAMENTE para agregar o eliminar a un repartidor (mensajero/empleado) del sistema. Requiere clienteNombre, clienteTel.
- AGREGAR_CLIENTE: Úsalo para registrar a un CLIENTE en el sistema de lealtad. Requiere clienteNombre, clienteTel y opcionalmente colonia. (Ej: "registra a Juan Pérez 9631234567")
- CARGAR_SALDO: Requiere clienteTel, montoSaldo.
- AGREGAR_REPARTIDOR / ELIMINAR_REPARTIDOR: Úsalo ÚNICAMENTE para agregar o eliminar a un repartidor (mensajero/empleado) del sistema. Requiere clienteNombre, clienteTel.
- AGREGAR_CLIENTE: Úsalo para registrar a un CLIENTE en el sistema de lealtad. Requiere clienteNombre, clienteTel y opcionalmente colonia. (Ej: "registra a Juan P�rez 9631234567")
- CARGAR_SALDO: Requiere clienteTel, montoSaldo.
- UBICACION_RESTAURANTE: Cuando el repartidor pide la ubicación o dirección de un restaurante (ej. '¿dónde está X?', 'ubícame el restaurante Y', 'mándame la ubi de Z'). Extrae: restaurante (nombre del restaurante).
- ANUNCIO_REPARTIDORES: Requiere descripcion.
- REVISAR_ENTREGADOS: diasAtras (0=hoy, 1=ayer, N=hace N días).
- VER_RESTAURANTES, VER_REPARTIDORES, VER_VIPS, VER_PEDIDOS, ESTADISTICAS, REPORTE_SEMANAL, VER_ATRASOS.
- ENTREGAR_TODOS / CANCELAR_TODOS.
- ENVIAR_QR: Requiere clienteTel. Manda tarjeta de lealtad (QR) al cliente.
- ENVIAR_TERMINOS: Requiere clienteTel. Manda la solicitud de aceptación de términos y condiciones al cliente.
- REGISTRAR_RESTAURANTE: Requiere nombre_restaurante y correo.
- REASIGNAR_PEDIDO: Requiere clienteTel, repartidorAlias.
- AGREGAR_NOTA_CLIENTE: Requiere clienteTel, descripcion.
- ACTUALIZAR_DIRECCION: Requiere clienteTel, direccion.
- CALIFICAR_CLIENTE: Requiere clienteTel, descripcion. (Usa excelente, bueno, regular, malo o vetado).
- MARCAR_VIP: Requiere clienteTel.
- VER_HISTORIAL_CLIENTE: Requiere clienteTel.
- USAR_CUPON: Requiere codigoCupon.
- CANCELAR_CUPON: Requiere codigoCupon.
- RESPONDER: Para charlar, confirmar, o pedir datos faltantes.

FORMATO JSON DE SALIDA (responde SOLO con esto, sin nada más):
{"accion":"UNA_ACCION_LISTADA","mensajeUsuario":"Texto breve y profesional.","datosAExtraer":{"clienteTel":"10 dígitos o null","puntosASumar":null,"diasAtras":null,"clienteNombre":null,"colonia":null,"restaurante":null,"descripcion":null,"direccion":null,"repartidorAlias":"${repartidorInfo?.alias || ''}","montoSaldo":null,"nombre_restaurante":null,"correo":null,"codigoCupon":null}}`
}

function buildClientPrompt(callerPhone10: string, clienteCtx?: { nombre?: string; puntos?: number; esVip?: boolean; reputacion?: string; saldo?: number; envios?: number; rango?: string; notasCrm?: string; ubicaciones?: any[]; historialPedidos?: any[] } | null, regState?: { nombre?: string; tel?: string; colonia?: string }, esFirstContact = false, profileName?: string): string {
  const ctx = clienteCtx
  const esRegistrado = !!ctx?.nombre

  let contextBlock = ''
  if (esRegistrado) {
    let libDir = ''
    if (ctx!.ubicaciones && ctx!.ubicaciones.length > 0) {
      const ustr = ctx!.ubicaciones.map(u => `- [${u.tipo}] ${u.colonia_nombre} (Lat: ${u.lat}, Lng: ${u.lng})`).join('\n')
      libDir = `\nLIBRETA DE DIRECCIONES GUARDADAS (Úsalas cuando pida ir a su "casa", "trabajo", etc):\n${ustr}\nSi te dice "ve a mi casa", en origen o destino enviarás EXÁCTAMENTE las coordenadas completas de la libreta en lugar de texto.\n`
    }

    // ── Historial de pedidos (personalización inteligente) ──
    let historialBlock = ''
    if (ctx!.historialPedidos && ctx!.historialPedidos.length > 0) {
      const pedidos = ctx!.historialPedidos
      const resumen = pedidos.map(p => {
        const fecha = new Date(p.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
        return `- ${fecha}: ${p.restaurante || 'Mandadito'} → "${(p.descripcion || '').substring(0, 60)}" ($${p.total || 0}) [${p.tipo_pedido}]`
      }).join('\n')

      // Detectar patrones automáticamente
      const restCount: Record<string, number> = {}
      let totalGastado = 0
      let mandaditos = 0
      for (const p of pedidos) {
        if (p.restaurante) restCount[p.restaurante] = (restCount[p.restaurante] || 0) + 1
        totalGastado += (p.total || 0)
        if (p.tipo_pedido === 'mandadito' || !p.restaurante) mandaditos++
      }
      const favRest = Object.entries(restCount).sort((a, b) => b[1] - a[1])[0]
      const esMandaditero = mandaditos > pedidos.length / 2

      let patronesTexto = ''
      if (favRest && favRest[1] >= 2) patronesTexto += `\n🍕 RESTAURANTE FAVORITO: "${favRest[0]}" (pidió ${favRest[1]} veces). Menciónalo naturalmente si dice que tiene hambre.`
      if (esMandaditero) patronesTexto += `\n📦 CLIENTE FRECUENTE DE ENVÍOS: Suele pedir servicios de mensajería/recados. Si saluda, ofrécele cotizar un envío.`
      if (totalGastado > 500) patronesTexto += `\n💰 CLIENTE DE ALTO VALOR: Ha gastado $${totalGastado.toFixed(0)} en total. Trátalo con atención premium.`

      historialBlock = `\n📋 HISTORIAL DE PEDIDOS RECIENTES (úsalo para personalizar tu trato):\n${resumen}${patronesTexto}\n\nREGLA: Usa este historial para ser proactivo. Por ejemplo: "¿Quieres repetir tu pedido de [restaurante favorito]?" o "¿Otro envío hoy?". NO recites la lista completa, solo úsala como contexto.\n`
    }

    let notasAdmin = ''
    if (ctx!.notasCrm) {
      try {
        const crmData = JSON.parse(ctx!.notasCrm)
        notasAdmin = `\n\n🧠 CEREBRO IA (PERFIL DEL CLIENTE ESTABLECIDO POR EL ADMIN):
${crmData.apodo ? `- APODO: ${crmData.apodo} (Úsalo para saludarlo o referirte a él)\n` : ''}${crmData.tono && !crmData.tono.includes('Neutral') ? `- TONO REQUERIDO: ${crmData.tono}\n` : ''}${crmData.preferencias ? `- PREFERENCIAS: ${crmData.preferencias}\n` : ''}${crmData.alergias ? `- ⚠️ ALERGIAS/PRECAUCIONES: ${crmData.alergias} (CRÍTICO: Nunca ofrezcas nada que viole esto)\n` : ''}${crmData.instrucciones ? `- REGLAS ESTRICTAS: ${crmData.instrucciones}\n` : ''}
REGLA: DEBES OBEDECER ESTRICTAMENTE ESTE PERFIL. Moldea tu personalidad y respuestas basándote en esta configuración antes de responder cualquier cosa.\n`
      } catch (e) {
        // Legacy plain text fallback
        notasAdmin = `\n\n⚠️ PERSONALIZACIÓN DEL ADMINISTRADOR (CRM): "${ctx!.notasCrm}"\nREGLA: Debes obedecer ESTRICTAMENTE estas instrucciones. Son indicaciones sobre cómo tratar a este cliente, sus preferencias, alergias, apodos, o instrucciones especiales.\n`
      }
      
      notasAdmin += `\n🚨 IMPORTANTE: Estas notas del administrador tienen MÁXIMA PRIORIDAD y SOBREESCRIBEN cualquier otra preferencia que la IA haya aprendido históricamente.\n`
    }

    // ── PERFIL INTELIGENTE (JSON EXTRAÍDO) ──
    let perfilAI = ''
    if ((ctx as any).perfilInteligente) {
      const p = (ctx as any).perfilInteligente
      
      let aliasStr = 'No hay alias guardados.'
      if (p.ubicaciones_semanticas && Object.keys(p.ubicaciones_semanticas).length > 0) {
        try {
          const dict = typeof p.ubicaciones_semanticas === 'string' ? JSON.parse(p.ubicaciones_semanticas) : p.ubicaciones_semanticas
          aliasStr = Object.entries(dict).map(([alias, data]: [string, any]) => 
            `  - "${alias}": ${data.direccion_oficial || data.referencia || 'Coordenadas GPS'}`
          ).join('\n')
        } catch(e) { aliasStr = JSON.stringify(p.ubicaciones_semanticas) }
      }
      
      const rutinasStr = p.rutinas && p.rutinas.length > 0 ? JSON.stringify(p.rutinas) : 'Ninguna rutina detectada'
      
      perfilAI = `\n\n🔮 PERFIL PROFUNDO DE IA (Aprendido históricamente):
- Tono preferido: ${p.tono_preferido || 'amigable'}
- Alergias/Gustos: ${(p.alergias_gustos || []).join(', ') || 'No registrados'}
- Resumen Memoria: ${p.resumen_memoria || 'Sin datos aún'}
- Rutinas: ${rutinasStr}
- 🗺️ MAPA SEMÁNTICO DE ALIAS:
${aliasStr}

🚨 REGLA CRÍTICA DE ALIAS: Si el cliente menciona uno de estos alias (ej. "mi negocio", "casa de mi mamá"), en la extracción de 'ubicacion.texto' DEBES PONER EXACTAMENTE EL NOMBRE DEL ALIAS (ej. "mi negocio"). NO pongas la dirección oficial ni la traduzcas. El sistema de GPS se encargará de resolver el alias en segundo plano.`
    }

    contextBlock = `
CONTEXTO DEL CLIENTE (datos reales — NO inventes):
- Nombre: ${ctx!.nombre}
- Puntos: ${ctx!.puntos ?? 0}
- Rango: ${ctx!.rango || 'bronce'}
- VIP: ${ctx!.esVip ? 'Sí' : 'No'}
- Saldo: $${ctx!.saldo ?? 0}
- Entregas: ${ctx!.envios ?? 0}
${ctx!.reputacion === 'excelente' ? '- ⭐ CLIENTE EXCELENTE: Trátalo con calidez especial.\n' : ''}${ctx!.esVip ? '- 👑 ES VIP: Trato preferencial.\n' : ''}${libDir}${historialBlock}${notasAdmin}${perfilAI}`
  }

  // Build registration state block — server-confirmed data
  let regStateBlock = ''
  if (!esRegistrado && regState && (regState.nombre || regState.tel || regState.colonia)) {
    regStateBlock = `
⚠️ ESTADO ACTUAL DEL REGISTRO:
- clienteNombre: ${regState.nombre || 'PENDIENTE'}
- clienteTel: ${regState.tel || 'PENDIENTE'} (AUTO-DETECTADO de WhatsApp — NO lo preguntes, solo confírmalo en el resumen final)
- colonia: ${regState.colonia || 'PENDIENTE'}
Solo pide el PRIMER campo que diga PENDIENTE (ignorando clienteTel ya que se detectó solo). Si solo falta clienteTel, pasa al resumen.`
  }

  return `Eres el asistente virtual de *Estrella Envíos* 🌟 (nuestra división de comida se llama *Estrella Eats*).
Eres amable, profesional y altamente eficiente. Vas directo al grano y te enfocas estrictamente en procesar pedidos y solicitudes rápido.
${contextBlock}${regStateBlock}
⚠️ REGLA DE FORMATO: Escribe mensajes MUY CORTOS (1 línea de preferencia). NUNCA envíes más de 2 burbujas de texto a la vez (solo puedes usar "|||" una sola vez por respuesta). 

REGLAS:
1. ${esRegistrado ? `SALUDA a "${ctx!.nombre}" amablemente pero rápido.` : profileName ? `El cliente NO está registrado, pero su nombre de WhatsApp es "${profileName}". Salúdalo por su nombre y ve al grano.` : 'El cliente NO está registrado. No pidas su nombre, ve directo a atender su solicitud.'}
${esFirstContact ? `
⚠️ PRIMER CONTACTO: Tu primer mensaje debe ser extremadamente corto y en una sola burbuja. Si el cliente solo dice "Hola", responde algo como:
"¡Hola! 👋 Soy el asistente virtual (IA) de *Estrella Envíos*. ¿En qué te puedo ayudar?"
Si el cliente ya te pidió algo desde el primer mensaje, incluye la presentación en la misma respuesta de forma natural y breve.` : ''}
2. TONO Y PERSONALIDAD: Eres amable pero MUY CONCISO y PROFESIONAL. Tu objetivo es no quitarle tiempo al cliente. Usa máximo 1 emoji por mensaje. Prohibido hacer plática innecesaria o escribir párrafos largos.
3. ${esRegistrado ? 'Si pregunta por puntos, dile los datos reales. Invítalo a la web.' : `NUEVOS CLIENTES (NO REGISTRADOS EN VIP):
   - Si el cliente pide un envío, mandadito o comida, ATIÉNDELO INMEDIATAMENTE usando las herramientas (VER_RESTAURANTES_CLIENTE o INICIAR_MANDADITO).
   - ¡NO le envíes términos y condiciones, NO lo obligues a registrarse al VIP, y NO le pidas sus datos si solo quiere un servicio rápido!
   - SÓLO si el cliente EXPLÍCITAMENTE pide registrarse al programa VIP o acumular puntos, ENTONCES invítalo a registrarse recopilando: a) Nombre completo b) Colonia.
   ⚠️ TELÉFONO: Ya detectado automáticamente. Si lo vas a registrar, menciónalo: "Veo que tu número es ${regState?.tel || 'tu WhatsApp'} 📱 ¿Me dices tu colonia?". Solo confírmalo en el resumen final.
   PASO CRÍTICO (STATE TRACKING): En tu respuesta JSON, DEBES llenar "clienteNombre", "clienteTel" y "colonia" con los datos que ya tengas. Si "clienteNombre" ya tiene un valor o te mandaron su nombre de WhatsApp, úsalo y pide la colonia.
   
   ⚠️ PROCESO DE CONFIRMACIÓN (MUY IMPORTANTE):
   PASO 1: Cuando ya tengas nombre Y colonia, usa la acción RESPONDER para mostrarle el resumen completo (incluyendo el teléfono auto-detectado) y preguntarle si todo está bien:
   "¿Confirmo tus datos para tu Tarjeta VIP?|||👤 Nombre: [nombre]|||📱 Tel: [tel auto-detectado]|||🏠 Colonia: [colonia]|||¿Todo correcto? 😊"
   PASO 2: SOLAMENTE cuando el cliente responda "sí" a tu resumen, puedes usar la acción SOLICITAR_REGISTRO.`}
4. SERVICIOS (MANDADITOS): Si el cliente quiere un envío, mensajería, comprar algo o recoger encomienda, usa INICIAR_MANDADITO. (En tus mensajes llámalo "envío", no mandadito). 
5. Invita a visitar: https://www.app-estrella.shop/loyalty/${callerPhone10} (Solo si pregunta por lealtad).
6. ${ctx?.reputacion === 'malo' || ctx?.reputacion === 'regular' ? 'Atiéndelo normal y estrictamente.' : ctx?.reputacion === 'excelente' ? 'Hazle saber que es un cliente muy valorado 🌟' : 'Sé amable con todos.'}
7. ESTRELLA EATS (COMIDA): Si el cliente dice que tiene hambre o quiere comer:
   a) Usa la herramienta VER_RESTAURANTES_CLIENTE inmediatamente en tu respuesta. Esta enviará el Catálogo.
   b) Responde algo corto y servicial: "Te comparto nuestro catálogo de restaurantes para que elijas. Toca el botón para ver el menú."
   🚨 EXCEPCIÓN: Si ya estás en medio de un "envío" (pidiendo origen/destino) y menciona un restaurante como lugar a recoger, NO uses VER_RESTAURANTES_CLIENTE. Continúa con INICIAR_MANDADITO.
7. Si quieren registrar un restaurante, usa REGISTRAR_RESTAURANTE.
8. SOLICITAR_REGISTRO SOLO cuando tengas los 3 datos Y el cliente los haya confirmado.
9. POLÍTICA DE PRIVACIDAD: Si el cliente pregunta por sus datos o por qué le toman foto a su casa, explícale que: "Por seguridad de nuestros repartidores y agilidad logística tomamos fotos 100% EXTERIORES de la fachada (sin rostros). Si no eres VIP, tus datos jamás se usan para enviarte publicidad. Todo esto en cumplimiento con la LFPDPPP."
10. PROTOCOLO ANTI-TROLLS: Si el usuario usa lenguaje obsceno, insulta, falta al respeto, o hace peticiones troll/ilegales, NO intentes ayudarlo ni seguirle el juego. Responde ÚNICA Y EXACTAMENTE CON ESTA FRASE: "Por favor mantén el respeto. ¿En qué puedo apoyarte?". Si el usuario ya fue advertido y sigue insultando, córtalo diciendo "Entendido. Si necesitas servicio más tarde, aquí estaré. Que tengas buen día." y despídete amablemente pero firme.

11. TERMINOLOGÍA VIP: Al interactuar con el cliente en tus mensajes, NUNCA uses la palabra "mandadito" o "mandaditos". SIEMPRE refiérete a este servicio como "envío", "entregas" o "servicio de mensajería" (ej: "cotizar un envío", "¿otro envío hoy?", "vamos por tu paquete"). Mantenlo premium.

12. 🖼️ MULTIMEDIA — PUEDES VER IMÁGENES Y ESCUCHAR AUDIOS: Cuando el cliente envíe una foto o un audio, la IA los recibe y puede analizarlos directamente. NUNCA digas que "no puedes ver imágenes" o "no puedo escuchar audios", porque sí puedes.
   - 📸 IMÁGENES: Si el cliente manda una foto (ej. de una fachada, un paquete, un menú, un código QR), descríbela y úsala de contexto. Si es una fachada para un envío, extrae referencias visibles (color, número, calle). Si es un paquete, menciona su tamaño o contenido si se ve.
   - 🎤 AUDIOS: Si el cliente manda una nota de voz, ya fue transcrita a texto automáticamente y la recibirás en el mensaje de texto. Procésala igual que un mensaje escrito.
   - Si la imagen no es relevante para un servicio, responde de forma natural sobre lo que ves y redirige amablemente al servicio.

HERRAMIENTAS:
- RESPONDER: Chatear, saludar, informar puntos, pedir datos.
- VER_RESTAURANTES_CLIENTE: Enviar el menú nativo y visual de restaurantes para que el cliente pida comida (Estrella Eats). Úsalo siempre que el cliente muestre intención de comer o ver el menú.
- REGISTRAR_RESTAURANTE: Afiliar restaurante. Requiere "nombre_restaurante" y "correo".
- SOLICITAR_REGISTRO: Solo con los 3 datos confirmados. DEBES incluir "clienteNombre", "clienteTel" y "colonia" en datosAExtraer, extrayéndolos del historial de la conversación.
- APLICAR_REFERIDO: Cuando el cliente mencione un código de referido (ej. ESTRELLA-XXXX), usar esta acción y poner el código en datosAExtraer.codigoReferido.
- GUARDAR_DIRECCION_FAVORITA: Si el cliente pide un viaje a una dirección nueva (ej. "Mándalo a mi escuela: Cobach 10"), pregúntale "¿Quieres que guarde esta dirección como 'Escuela' para la próxima?". Si dice que SÍ o pide explícitamente guardar una dirección, usa esta acción. Extrae: "etiqueta_direccion" (ej. "casa", "trabajo", "escuela") y "direccion" (texto completo de la colonia/calle o coordenadas si mandó un pin).
- INICIAR_MANDADITO: Úsalo cuando el cliente pida un servicio, mensajería, ir a recoger/comprar algo.
  🛵 DISPARA ESTO INCLUSO SI EL CLIENTE SOLO DICE "Ocupo un servicio".

  🧠 PASO 1 — INFERIR EL ROL (razona ANTES de extraer paradas):
  Antes de extraer cualquier parada, determina mentalmente quién tiene el paquete y quién lo recibe.
  Usa estas señales lingüísticas para inferir el rol del cliente:

  📤 CLIENTE ES EMISOR (él tiene el paquete, quiere enviarlo):
  - "recoge aquí", "recoge en mi local/casa", "lleva esto/aquí a...", "manda esto a..."
  - "te dejo algo para que lleves a...", "pasa por algo conmigo", "recógeme en..."
  - Menciona su propio alias como ORIGEN: "de mi local", "desde mi casa"

  📥 CLIENTE ES RECEPTOR (alguien más tiene el paquete, quiere recibirlo):
  - "tráeme", "me puedes traer", "ve a recoger y tráelo aquí/a mí"
  - "recoge con [persona/lugar] y llévamelo", "hay algo en [lugar] para mí"
  - Menciona su propio alias como DESTINO implícito: "de la farmacia a mi casa"

  📦 CLIENTE ES INTERMEDIARIO (recoge en un lugar, entrega en otro sin ser parte):
  - "recoge en X y lleva a Daniela en Y", "ve por el pedido de X y entrégalo en Y"
  - Ambos extremos son terceros

  ❓ AMBIGUO — Usa RESPONDER para preguntar el rol SOLO si no puedes inferirlo:
  "Claro 😊 ¿Tú tienes el paquete y quieres enviarlo, o necesitas que vayamos a recogerlo?"

  🧠 MEMORIA CRM: Si el cliente tiene alias guardados (mi casa, mi local) en su MAPA SEMÁNTICO,
  úsalos proactivamente. Si dice "recoge aquí" y tiene "mi local" con GPS, propón: "¿Paso a tu local de siempre?"

  🗣️ PASO 2 — EXTRAER PARADAS con criterio:
   - Si ya inferiste el rol Y tienes al menos un lugar → dispara INICIAR_MANDADITO con las paradas que tengas (con null donde falte).
   - Si el cliente ya dice qué quiere (ej. "recoger unos documentos en el ISSSTE"), dispara INICIAR_MANDADITO con esa parada y null en el destino.
   - 🚨 SI EL CLIENTE SOLO DICE "quiero un servicio" O "ocupo un mandadito", SIN MENCIONAR NINGÚN LUGAR REAL, DEBES ENVIAR EL ARRAY "paradas" COMPLETAMENTE VACÍO: []. NO INVENTES NADA.

  EXTRAE "paradas": un array con cada lugar mencionado explícitamente. Cada parada tiene: "tipo" ("recoger", "comprar" o "entregar"), "ubicacion" (el lugar exacto que dijo el cliente), e "instruccion".
  🚨 REGLA DE ORO 1: ¡NO INVENTES UBICACIONES! Si el cliente NO dio un nombre propio exacto para alguna parada, DEBES usar null en la ubicacion.texto de esa parada. NUNCA uses "aquí", "mi ubicación", "conmigo".
  🚨 REGLA DE ORO 2 (ALUCINACIÓN CERO): ¡NUNCA USES LOS MENSAJES ANTERIORES DEL CLIENTE COMO UBICACIONES! (Ej. no uses "hola", "están laborando", "quiero un servicio"). Las ubicaciones DEBEN ser lugares físicos, direcciones, comercios o alias semánticos (ej. "mi casa"). Si extraes saludos o preguntas como ubicaciones, el sistema se ROMPERÁ por completo. Si no hay lugares reales en el mensaje, usa un array vacío [].
  INTELIGENCIA: Si el cliente menciona un alias de su CRM (ej. "a mi casa", "en mi local"), pon ese texto EXACTO en ubicacion.texto (ej. "mi casa") — el sistema lo resolverá a GPS automáticamente.


  --- EJEMPLOS DE EXTRACCIÓN (FEW-SHOT) ---
  Ejemplo 1:
  Cliente: "Puedes recoger un pedido por favor? En antojitos Yoli a nombre de Irma Campos (3 órdenes) y traerlo aquí a al 7ma avenida oriente norte número 8. Barrio Pilita seca."
  Extrae: {"paradas": [
    { "tipo": "recoger", "ubicacion": {"texto": "antojitos Yoli"}, "instruccion": "A nombre de Irma Campos (3 órdenes)" },
    { "tipo": "entregar", "ubicacion": {"texto": "7ma avenida oriente norte número 8. Barrio Pilita seca"}, "instruccion": "Traerlo aquí" }
  ]}
  
  Ejemplo 2:
  Cliente: "Se recoge ahi en mi local porfis. Se lleva a Daniela Es en el fraccionamiento el laurel última entrada De referencia es casi frente a la tortilleria es una puerta gris Tel 9631871673"
  Extrae: {"paradas": [
    { "tipo": "recoger", "ubicacion": {"texto": "mi local"}, "instruccion": "Recoger en mi local" },
    { "tipo": "entregar", "ubicacion": {"texto": "fraccionamiento el laurel última entrada"}, "instruccion": "Para Daniela. Referencia: casi frente a la tortilleria es una puerta gris. Tel 9631871673" }
  ]}
  
  Ejemplo 3 (Sin destino especificado):
  Cliente: "Me puedes realizar un servicio? De las quesadillas yulimoni. Serían 4 quesadillas de adobada combinadas porfis"
  Extrae: {"paradas": [
    { "tipo": "comprar", "ubicacion": {"texto": "quesadillas yulimoni"}, "instruccion": "4 quesadillas de adobada combinadas" },
    { "tipo": "entregar", "ubicacion": {"texto": null}, "instruccion": "" }
  ]}

  Ejemplo 4 (Ubicaciones complejas con mucha basura y errores ortográficos):
  Cliente: "Buenas tardes le puedo encargar 3 ordenes de pollo campero ( 1 ordenes que se de pierna y muslo y 2 ordenes de pechuga y ala) ke esta entre la iglesia de jesucito y la iglesia de san jose, por favor y traerlo aqui en 10a calle sur oriente num 65 barrio de microondas a lado del bar el. Bebedero en la tiendita ke esta. Lado a nombre concepcion lopez perez, xfis"
  Extrae: {"paradas": [
    { "tipo": "comprar", "ubicacion": {"texto": "pollo campero ke esta entre la iglesia de jesucito y la iglesia de san jose"}, "instruccion": "3 ordenes (1 pierna y muslo, 2 pechuga y ala)" },
    { "tipo": "entregar", "ubicacion": {"texto": "10a calle sur oriente num 65 barrio de microondas a lado del bar el. Bebedero en la tiendita"}, "instruccion": "A nombre concepcion lopez perez" }
  ]}

  Ejemplo 5 (Multi-compras y referencias implícitas):
  Cliente: "Necesito dos tintas de impresoras en SISCOM, una NEGRA y una ROSA"
  Extrae: {"paradas": [
    { "tipo": "comprar", "ubicacion": {"texto": "SISCOM"}, "instruccion": "Dos tintas de impresoras, una NEGRA y una ROSA" },
    { "tipo": "entregar", "ubicacion": {"texto": null}, "instruccion": "" }
  ]}

  Ejemplo 6 (Extracción de medicinas y ubicaciones con nombres de pila):
  Cliente: "Gracias, es comprar una medicina en la farmacia dan caralampio que está en la pila Y entregarlo por favor en la casa de mi abuelita Laxis 40mg con 20 tabletas"
  Extrae: {"paradas": [
    { "tipo": "comprar", "ubicacion": {"texto": "farmacia dan caralampio que está en la pila"}, "instruccion": "Laxis 40mg con 20 tabletas" },
    { "tipo": "entregar", "ubicacion": {"texto": "casa de mi abuelita"}, "instruccion": "" }
  ]}

  Ejemplo 7 (El cliente quiere ENVIAR un OBJETO a un destino — el objeto NO es una ubicación):
  Cliente: "quiero enviar unas cosas al centro, al parque central"
  🚨 "unas cosas" es el CONTENIDO DEL PAQUETE, NO un lugar. El origen no fue especificado → ubicacion null.
  Extrae: {"paradas": [
    { "tipo": "recoger", "ubicacion": {"texto": null}, "instruccion": "Enviar unas cosas" },
    { "tipo": "entregar", "ubicacion": {"texto": "centro, parque central"}, "instruccion": "" }
  ]}

  Ejemplo 8 (Envío genérico sin origen claro):
  Cliente: "me ayudas a llevar un paquete a la clínica IMSS"
  Extrae: {"paradas": [
    { "tipo": "recoger", "ubicacion": {"texto": null}, "instruccion": "Llevar un paquete" },
    { "tipo": "entregar", "ubicacion": {"texto": "clínica IMSS"}, "instruccion": "" }
  ]}

  🚨 REGLA CRÍTICA: Palabras como "unas cosas", "un paquete", "una encomienda", "unos documentos", "algo", "comida" etc. son el CONTENIDO/OBJETO a transportar — van siempre en "instruccion", NUNCA en "ubicacion.texto". Una ubicación es SIEMPRE un lugar geográfico (negocio, colonia, calle, barrio, edificio).
  -----------------------------------------

ANÁLISIS DE SENTIMIENTO (obligatorio en cada respuesta):
Analiza el tono del mensaje del cliente y clasifícalo en: "positivo", "neutro", "molesto", "furioso".
Señales de molestia: quejas, insultos, mayúsculas excesivas, signos de exclamación múltiples, palabras como "horrible", "tardaron", "pésimo", "inaceptable", "exijo".

FORMATO JSON (responde SOLO esto):
{"datosAExtraer":{"clienteNombre":null,"clienteTel":null,"colonia":null,"nombre_restaurante":null,"correo":null,"codigoReferido":null,"etiqueta_direccion":null,"direccion":null,"paradas":[]},"accion":"UNA_ACCION","mensajeUsuario":"Mensaje corto|||Otro mensaje corto 😊","sentimiento":"neutro"}`
}

// ── Validador de Seguridad (evita datos incorrectos de la IA) ──────────────────
function enforcerValidator(respuesta: AIRespuesta): AIRespuesta {
  const d: Record<string, any> = respuesta.datosAExtraer || {}

  // Sanitización
  if (d.clienteTel) {
    const num = String(d.clienteTel).replace(/\D/g, '')
    d.clienteTel = num.length >= 10 ? num.slice(-10) : undefined
  }
  if (d.puntosASumar != null) d.puntosASumar = parseInt(String(d.puntosASumar), 10)
  if (d.montoSaldo != null) d.montoSaldo = parseFloat(String(d.montoSaldo))

  let blocked = false
  switch (respuesta.accion) {
    case 'CREAR_PEDIDO':
      if (!d.clienteTel || d.clienteTel.length !== 10) { blocked = true; respuesta.mensajeUsuario = 'Necesito el número de teléfono del cliente a 10 dígitos para crear un pedido.' }
      else if (!d.descripcion?.trim()) { blocked = true; respuesta.mensajeUsuario = 'Necesito saber exactamente qué productos quiere en el pedido.' }
      break
    case 'SUMAR_PUNTOS':
      if (!d.clienteTel || d.clienteTel.length !== 10) { blocked = true; respuesta.mensajeUsuario = 'Faltan los 10 dígitos del teléfono del cliente.' }
      else if (d.puntosASumar != null && d.puntosASumar <= 0) { blocked = true; respuesta.mensajeUsuario = 'La cantidad de puntos a sumar debe ser mayor a cero.' }
      else if (d.puntosASumar != null && d.puntosASumar > 50) { 
        blocked = true; 
        respuesta.mensajeUsuario = '🚨 Vigía de Alucinaciones: Intento de regalar más de 50 puntos bloqueado por seguridad.' 
      }
      break
    case 'BUSCAR_CLIENTE': case 'VER_HISTORIAL_CLIENTE':
    case 'MARCAR_VIP': case 'CANCELAR_PEDIDO': case 'AGREGAR_NOTA_CLIENTE':
    case 'ACTUALIZAR_DIRECCION': case 'CALIFICAR_CLIENTE':
      if (!d.clienteTel || d.clienteTel.length !== 10) { blocked = true; respuesta.mensajeUsuario = 'Faltan los 10 dígitos del teléfono del cliente para ejecutar eso.' }
      break
    case 'CARGAR_SALDO':
      if (!d.clienteTel || d.clienteTel.length !== 10 || isNaN(d.montoSaldo) || d.montoSaldo <= 0) { blocked = true; respuesta.mensajeUsuario = 'Para recargar necesito los 10 dígitos del cliente y el monto numérico mayor a 0.' }
      else if (d.montoSaldo > 2000) {
        blocked = true;
        respuesta.mensajeUsuario = '🚨 Vigía de Alucinaciones: Intento de recargar más de $2,000 bloqueado por seguridad.'
      }
      break
    case 'ELIMINAR_REPARTIDOR': case 'ESTADO_REPARTIDOR': case 'RECORDATORIO_REPARTIDOR':
      if (!d.repartidorAlias) { blocked = true; respuesta.mensajeUsuario = 'Necesito el nombre del repartidor para ejecutar esa acción específica.' }
      break
    case 'INICIAR_MANDADITO':
      // Ahora delegamos el control a la máquina de estados. No bloqueamos nada.
      break
    case 'ANUNCIO_REPARTIDORES':
      if (!d.descripcion) { blocked = true; respuesta.mensajeUsuario = 'Por favor indique cuál es el mensaje que desea enviar a todos los repartidores.' }
      break
    case 'REASIGNAR_PEDIDO':
      if (!d.clienteTel || d.clienteTel.length !== 10 || !d.repartidorAlias) { blocked = true; respuesta.mensajeUsuario = 'Para reasignar, proporcione los 10 dígitos del cliente y el nombre del nuevo repartidor.' }
      break
    case 'AGREGAR_REPARTIDOR':
      if (!d.clienteNombre || !d.clienteTel || d.clienteTel.length !== 10) { blocked = true; respuesta.mensajeUsuario = 'Para registrar personal, necesito el nombre y su número a 10 dígitos obligatoriamente.' }
      break
    case 'AGREGAR_CLIENTE':
      if (!d.clienteNombre || !d.clienteTel || d.clienteTel.length !== 10) { blocked = true; respuesta.mensajeUsuario = 'Para registrar al cliente, necesito su nombre y su teléfono a 10 dígitos.' }
      break
    case 'REGISTRAR_RESTAURANTE':
      if (!d.nombre_restaurante || !d.correo || !d.correo.includes('@')) { blocked = true; respuesta.mensajeUsuario = '¡Excelente! Para registrar tu restaurante necesito que me des su Nombre y un Correo electrónico válido.' }
      break
    case 'USAR_CUPON': case 'CANCELAR_CUPON':
      if (!d.codigoCupon) { blocked = true; respuesta.mensajeUsuario = 'Proporciona el código del cupón para ejecutar esta acción.' }
      break
    case 'GUARDAR_DIRECCION_FAVORITA':
      if (!d.etiqueta_direccion || !d.direccion) { blocked = true; respuesta.mensajeUsuario = 'Para guardar la dirección necesito el nombre de la etiqueta (ej. casa) y la dirección exacta.' }
      break
  }

  // ── VIGÍA DE ALUCINACIONES: Filtro Anti-Grosorías / Fallbacks ──
  const badWords = ['pendejo', 'estupido', 'estúpido', 'idiota', 'imbecil', 'imbécil', 'puta', 'puto', 'mierda'];
  const msgLower = (respuesta.mensajeUsuario || '').toLowerCase();
  if (badWords.some(w => msgLower.includes(w))) {
    blocked = true;
    respuesta.mensajeUsuario = 'Disculpa, tuve un lapsus mental y mi sistema de seguridad me bloqueó 😅. ¿Me repites tu petición de otra forma?';
  }

  if (blocked && respuesta.accion !== 'RESPONDER') {
    respuesta.accion = 'RESPONDER'
  }

  if (blocked) {
    console.warn(`🛡️ Enforcement Validator interceptó '${respuesta.accion}' por falta de datos.`)
    respuesta.accion = 'RESPONDER'
  }
  return respuesta
}

// ── Cortocircuito (Circuit Breaker) para la IA ────────────────────────────────
// Previene saturar el servicio cuando está caído. Tras varios fallos,
// pausa las peticiones temporalmente para ahorrar recursos.
const DS_FAIL_THRESHOLD = 3
const DS_OPEN_MS = 45_000
const CB_KEY = 'sys_circuit_ds'

async function _getDsCircuit(supabase: SupabaseClient) {
  try {
    const { data } = await supabase.from('bot_memory').select('history').eq('phone', CB_KEY).maybeSingle()
    if (data?.history?.[0]) return data.history[0] as { fails: number, openUntil: number }
  } catch (e) { }
  return { fails: 0, openUntil: 0 }
}

async function _updateDsCircuit(supabase: SupabaseClient, state: { fails: number, openUntil: number }) {
  await supabase.from('bot_memory').upsert({ phone: CB_KEY, history: [state], updated_at: new Date().toISOString() })
}

async function _cbFail(supabase: SupabaseClient): Promise<void> {
  const c = await _getDsCircuit(supabase)
  c.fails++
  if (c.fails >= DS_FAIL_THRESHOLD) {
    c.openUntil = Date.now() + DS_OPEN_MS
    c.fails = 0
    console.error(`⛔ [CIRCUIT OPEN] DeepSeek pausado ${DS_OPEN_MS / 1000}s por ${DS_FAIL_THRESHOLD} fallas consecutivas.`)
  }
  await _updateDsCircuit(supabase, c)
}

async function _cbSuccess(supabase: SupabaseClient): Promise<void> {
  const c = await _getDsCircuit(supabase)
  if (c.fails > 0) {
    await _updateDsCircuit(supabase, { fails: 0, openUntil: 0 })
  }
}

// ── Modelos disponibles ─────────────────────────────────────────────────────
const MODEL_FLASH    = 'gemini-3.6-flash'        // Rápido — chat simple, mid-conversation
const MODEL_FLASH_25 = 'gemini-3.6-flash'        // Balanceado - primer contacto
const MODEL_PRO      = 'gemini-3.1-pro-preview'  // Potente + thinking — servicios complejos

// ── Palabras clave que indican intención de SERVICIO (mandadito/envío) ───────
const SERVICE_INTENT_RE = /\b(enviar|envia|env[ií]o|recoger|recoge|recolect|llevar|lleva|llevar|mandar|manda|traer|trae|servicio|mandadito|paquete|encomienda|comprar|compra|ir a traer|pasar por|mensajer[ií]a|domicilio|entregar|entrega|ruta|parada|quiero enviar|necesito enviar|me puedes recoger|me llevas|me traes|quiero que vayas|quiero un servicio|hambre|comida|comer|antojo|menu|menú|restaurante|pizza|hamburguesa|tacos)\b/i

/**
 * Selecciona el modelo de IA según la intención detectada en el texto y el historial.
 * - Sin historial (primer contacto) → gemini-2.5-flash
 * - Intención de servicio detectada → gemini-3.1-pro-preview (con thinking)
 * - Conversación simple / pregunta básica → gemini-3.6-flash
 */
function selectModel(texto: string, historia: any[]): { model: string; useThinking: boolean } {
  const isFirstContact = historia.length === 0
  const isServiceRequest = SERVICE_INTENT_RE.test(texto)

  if (isServiceRequest) {
    console.log(`🧠 [MODEL] Intención de servicio detectada → ${MODEL_PRO} + thinking`)
    return { model: MODEL_PRO, useThinking: true }
  }
  if (isFirstContact) {
    console.log(`🌟 [MODEL] Primer contacto → ${MODEL_FLASH_25}`)
    return { model: MODEL_FLASH_25, useThinking: false }
  }
  console.log(`⚡ [MODEL] Conversación simple → ${MODEL_FLASH}`)
  return { model: MODEL_FLASH, useThinking: false }
}

// ── PALABRAS QUE NUNCA SON UNA UBICACIÓN GEOGRÁFICA ─────────────────────────
const NON_LOCATION_WORDS = new Set([
  'unas cosas', 'un paquete', 'algo', 'unos documentos', 'una encomienda',
  'esto', 'eso', 'lo mio', 'mis cosas', 'una cosa', 'unos paquetes',
  'ropa', 'zapatos', 'medicina', 'medicamento', 'medicamentos', 'dinero',
  'efectivo', 'llaves', 'celular', 'computadora', 'laptop', 'documentos',
  'papeles', 'cartas', 'carta', 'comida', 'alimentos', 'mercancia', 'mercancía'
])

/**
 * Valida y sanitiza una ubicación extraída por la IA.
 * Si no parece un lugar geográfico real, devuelve texto: null para que el
 * flujo le pregunte al cliente correctamente en lugar de usar datos inválidos.
 */
export function sanitizeUbicacion(ubi: any): any {
  if (!ubi) return ubi
  const rawTexto = ubi.texto
  if (rawTexto === null || rawTexto === undefined) return ubi

  // Si ubi.texto llegó como objeto anidado (bug defensivo)
  if (typeof rawTexto === 'object') {
    const nested = (rawTexto as any)?.texto
    ubi = { ...ubi, texto: nested || null }
  }

  const txt = String(ubi.texto || '').trim().toLowerCase()

  // Rechazar si está vacío o muy corto
  if (!txt || txt.length < 3) return { ...ubi, texto: null }

  // Rechazar si es una palabra genérica conocida
  if (NON_LOCATION_WORDS.has(txt)) {
    console.log(`🛡️ [SANITIZE] Rechazada ubicación no-geográfica: "${txt}"`)
    return { ...ubi, texto: null }
  }

  // Rechazar frases tipo "un/una/unos/unas + objeto común"
  if (/^(un|una|unos|unas)\s+(cosa|paquete|encomienda|documento|papel|carta|bolsa|caja|llave|ropa|medicina|medicamento|objeto|artículo|articulo)s?\b/i.test(txt)) {
    console.log(`🛡️ [SANITIZE] Rechazada frase objeto: "${txt}"`)
    return { ...ubi, texto: null }
  }

  // Rechazar si empieza con verbo de acción (no es un lugar)
  if (/^(enviar|recoger|llevar|mandar|traer|comprar|ir a|pasar)\b/i.test(txt)) {
    console.log(`🛡️ [SANITIZE] Rechazada frase de acción: "${txt}"`)
    return { ...ubi, texto: null }
  }

  return { ...ubi, texto: String(ubi.texto).trim() }
}

// ── Llamar a DeepSeek R1 ──────────────────────────────────────────────────────
export async function conversacionDeepSeek(
  supabase: SupabaseClient,
  phone: string,
  nuevoTexto: string,
  isRepartidor = false,
  repartidorInfo: any = null,
  isClient = false,
  clienteCtx: { nombre?: string; puntos?: number; esVip?: boolean; reputacion?: string; saldo?: number; envios?: number; rango?: string; notasCrm?: string; ubicaciones?: any[]; historialPedidos?: any[] } | null = null,
  regState?: { nombre?: string; tel?: string; colonia?: string },
  mediaData?: { base64: string; mimeType: string } | null,
  profileName?: string
): Promise<{ respuesta?: AIRespuesta; nuevoHistorial?: any[]; errorObj?: string } | null> {
  try {
    // Circuit breaker: si está abierto, rechazar inmediatamente sin llamar a DeepSeek
    const circuit = await _getDsCircuit(supabase)
    if (Date.now() < circuit.openUntil) {
      const secsLeft = Math.ceil((circuit.openUntil - Date.now()) / 1000)
      console.warn(`⛔ [CIRCUIT OPEN] DeepSeek en pausa — ${secsLeft}s restantes`)
      return { errorObj: `IA en pausa temporal (${secsLeft}s). Reintenta en un momento.` }
    }

    const memPhone = extract10Digits(phone)
    const callerPhone10 = memPhone
    const { data: mem } = await supabase.from('bot_memory').select('history').eq('phone', memPhone).maybeSingle()
    const historia = mem?.history || []

    // ── MOCK MODE PARA TESTS DE ESTRÉS ──────────────────────────────────────
    if (Deno.env.get('DEBUG_MOCK_AI') === 'true') {
      const mockRes: AIRespuesta = {
        accion: 'RESPONDER',
        mensajeUsuario: '🤖 [MOCK MODE] Recibí tu mensaje: ' + nuevoTexto.substring(0, 50)
      }
      return {
        respuesta: mockRes,
        nuevoHistorial: [
          ...(historia).slice(-5),
          { role: 'user', content: nuevoTexto },
          { role: 'model', content: mockRes.mensajeUsuario }
        ]
      }
    }

    let systemInstruction = buildAdminPrompt()
    if (isRepartidor) systemInstruction = buildRepartidorPrompt(repartidorInfo)
    else if (isClient) systemInstruction = buildClientPrompt(callerPhone10, clienteCtx, regState, historia.length === 0, profileName)

    const formattedHistory = historia
      .filter((h: any) => h.content && String(h.content).trim().length > 0)
      .map((h: any) => ({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: String(h.content).trim(),
      }))

    const messages = [
      { role: 'system', content: systemInstruction },
      ...formattedHistory,
      { role: 'user', content: String(nuevoTexto).substring(0, 500) },
    ]

    const API_KEY = Deno.env.get('GEMINI_API_KEY')!

    const callDeepSeek = async (isRetry = false): Promise<Response> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 18000) // +6s para modelos con thinking

      const { model: selectedModel, useThinking } = isRetry
        ? { model: MODEL_FLASH, useThinking: false }
        : (isClient
            ? selectModel(String(nuevoTexto), historia)
            : { model: MODEL_PRO, useThinking: false })
      const modelToUse = selectedModel
      
      // Adaptar a Gemini — con normalización estricta de alternancia user/model
      const rawGemini = (isRetry ? messages.slice(-1) : messages)
        .filter(m => m.role !== 'system' && m.content && String(m.content).trim().length > 0)
        .map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content).trim() }]
        }))

      // Normalizar alternancia: eliminar turnos consecutivos del mismo rol (quedarse con el último)
      const geminiContents: { role: string; parts: { text: string }[] }[] = []
      for (const turn of rawGemini) {
        if (geminiContents.length > 0 && geminiContents[geminiContents.length - 1].role === turn.role) {
          // Mismo rol consecutivo: reemplazar (el más reciente es más relevante)
          geminiContents[geminiContents.length - 1] = turn
        } else {
          geminiContents.push(turn)
        }
      }

      // Garantizar que el array nunca termine en 'model' (Gemini lo rechaza)
      if (geminiContents.length > 0 && geminiContents[geminiContents.length - 1].role === 'model') {
        geminiContents.pop()
      }

      // Si quedó vacío o el último turno ya no es user, asegurar un turno user final
      const nuevoTextoStr = String(nuevoTexto).trim() || 'Hola'
      if (geminiContents.length === 0 || geminiContents[geminiContents.length - 1].role !== 'user') {
        geminiContents.push({ role: 'user', parts: [{ text: nuevoTextoStr }] })
      }

      // Si hay media adjunta, enriquecemos el último turno user con inlineData
      if (mediaData?.base64 && !isRetry) {
        console.log(`[callDeepSeek] \ud83d\uddbc\ufe0f Inyectando media en Gemini: mimeType=${mediaData.mimeType} base64len=${mediaData.base64.length}`)
        const lastTurn = geminiContents[geminiContents.length - 1]
        if (lastTurn.role === 'user') {
          lastTurn.parts = [
            { text: `El usuario adjunt\u00f3 este archivo multimedia. Por favor an\u00e1lizalo y responde en consecuencia. ${nuevoTextoStr}` },
            { inlineData: { mimeType: mediaData.mimeType, data: mediaData.base64 } }
          ] as any
          console.log(`[callDeepSeek] \u2705 inlineData inyectado en lastTurn`)
        } else {
          console.warn(`[callDeepSeek] \u26a0\ufe0f lastTurn.role=${lastTurn.role}, no se inyect\u00f3 imagen`)
        }
      } else if (mediaData?.base64 && isRetry) {
        console.warn('[callDeepSeek] \u26a0\ufe0f isRetry=true, imagen NO incluida en retry')
      }

      const hasMedia = !!(mediaData?.base64 && !isRetry)

      const payload: any = {
        contents: geminiContents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          // ⚠️ Cuando hay media (imagen/audio), NO usamos responseMimeType JSON porque algunos
          // modelos de Gemini devuelven contenido vacío al combinar inlineData + JSON mode.
          // Con media, dejamos que Gemini responda en texto libre (igual cumple el formato JSON
          // porque el systemInstruction lo pide explícitamente).
          ...(hasMedia ? {} : { responseMimeType: 'application/json' }),
          temperature: 0.7,
          maxOutputTokens: 2048
        }
      }
      if (hasMedia) console.log('[callDeepSeek] 🖼️ Modo texto (sin responseMimeType JSON) para procesar media')


      try {
        return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${API_KEY}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
    }

    let res: Response
    try {
      res = await callDeepSeek()
      if (res.status >= 500 && res.status < 600) {
        console.warn(`⚠️ Gemini API ${res.status}, reintentando inmediatamente...`)
        res = await callDeepSeek()
      }
    } catch (fetchErr: any) {
      const isTimeout = fetchErr?.name === 'AbortError'
      const msg = isTimeout ? '⏱️ Timeout 12s alcanzado, usando fallback' : '🌐 Fetch error: ' + String(fetchErr);
      console.error(msg)
      await logError('whatsapp-bot', `Gemini Fetch Failure: ${msg}`, { error: String(fetchErr), callerPhone10 }, 'critical');
      await _cbFail(supabase)
      return { errorObj: isTimeout ? 'Gemini no respondió a tiempo. Intente de nuevo.' : String(fetchErr) }
    }

    if (!res.ok) {
      const errText = await res.text()
      console.error('Gemini API Error:', errText)
      await logError('whatsapp-bot', `Gemini HTTP Error ${res.status}`, { response: errText, callerPhone10 }, 'critical');
      await _cbFail(supabase)
      return { errorObj: `HTTP ${res.status} - ${errText}` }
    }

    const data = await res.json()
    console.log(`🤖 [Gemini] Tokens usados — input: ${data.usageMetadata?.promptTokenCount} | output: ${data.usageMetadata?.candidatesTokenCount}`)

    let rawContent = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim()

    // Manejo de respuestas vacías (ocurre cuando el historial acumula demasiados tokens).
    // Fix: reintentar SIN historial para liberar contexto y obtener respuesta válida.
    if (!rawContent || rawContent.length < 10) {
      console.warn(`⚠️ Gemini respuesta muy corta (${rawContent.length} chars). Reintentando sin historial...`)
      
      let res2: Response
      try {
        res2 = await callDeepSeek(true) // Llama con isRetry = true
      } catch (e2) {
        const msg = '❌ Gemini devolvió contenido vacío.'
        console.error(msg)
        await _cbFail(supabase)
        return { errorObj: msg }
      }
      const data2 = await res2.json()
      rawContent = (data2.candidates?.[0]?.content?.parts?.[0]?.text || '').trim()
      console.log(`🔄 [Retry sin historial] Tokens — input: ${data2.usageMetadata?.promptTokenCount} | output: ${data2.usageMetadata?.candidatesTokenCount}`)
      if (!rawContent || rawContent.length < 10) {
        const msg = '❌ Gemini devolvió contenido vacío incluso sin historial.'
        console.error(msg)
        await logError('whatsapp-bot', 'Gemini Empty Response (retry)', { callerPhone10 }, 'error')
        await _cbFail(supabase)
        return { errorObj: msg }
      }
    }

    let cleanJSON = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const fb = cleanJSON.indexOf('{'), lb = cleanJSON.lastIndexOf('}')
    if (fb !== -1 && lb !== -1) cleanJSON = cleanJSON.substring(fb, lb + 1)

    let respuesta: AIRespuesta
    try {
      const parsed = JSON.parse(cleanJSON)
      if (!parsed.accion || !VALID_ACTIONS.includes(parsed.accion)) throw new Error(`Acción inválida: "${parsed.accion}"`)
      respuesta = parsed as AIRespuesta
    } catch {
      const fallbackFb = rawContent.indexOf('{')
      const fallbackLb = rawContent.lastIndexOf('}')
      if (fallbackFb !== -1 && fallbackLb !== -1 && fallbackLb > fallbackFb) {
        try {
          const jsonMatchStr = rawContent.substring(fallbackFb, fallbackLb + 1)
          const parsed2 = JSON.parse(jsonMatchStr)
          if (parsed2.accion && VALID_ACTIONS.includes(parsed2.accion)) {
            respuesta = parsed2 as AIRespuesta
            console.warn('⚠️ JSON recuperado via substring fallback.')
          } else throw new Error('Acción inválida en fallback')
        } catch (repairErr: any) {
          console.error('❌ JSON no rescatable. Raw:', rawContent.slice(0, 500))
          await logError('whatsapp-bot', `DeepSeek malformed JSON`, { rawContent: rawContent.slice(0, 500), phone: callerPhone10 }, 'warn');
          throw new Error('AI devolvió formato JSON no rescatable.')
        }
      } else {
        console.error('❌ Sin JSON en respuesta. Raw:', rawContent.slice(0, 500))
        respuesta = { accion: 'RESPONDER', mensajeUsuario: 'Perdone la interrupción, pero los servidores de Inteligencia están saturados (Respuesta no legible). Reintente en un momento, por favor.' }
      }
    }

    respuesta = enforcerValidator(respuesta)
    await _cbSuccess(supabase)

    const nuevoHistorial = [
      ...historia.slice(-12),
      { role: 'user', content: String(nuevoTexto).substring(0, 300) },
      // Strip ||| separators before saving — the AI should see clean text in history
      ...(respuesta.mensajeUsuario?.trim()
        ? [{ role: 'model', content: respuesta.mensajeUsuario.replace(/\|\|\|/g, ' ').trim().substring(0, 300) }]
        : []),
    ]

    return { respuesta, nuevoHistorial }
  } catch (e) {
    console.error('DeepSeek error root:', e instanceof Error ? e.message : String(e))
    return { errorObj: `Runtime Error: ${e instanceof Error ? e.message : String(e)}` }
  }
}
// ── Lógica de Validación Inteligente de Mandaditos (Criterio) ────────────
export interface ValidacionMandadito {
  estaCompleto: boolean;
  datosFaltantes: string[];
  preguntaAlCliente: string | null;
  datosEstructurados: {
    nombreRemitente: string | null;
    nombreReceptor: string | null;
    numeroOrden: string | null;
    telefonoContacto: string | null;
  }
}

export async function validarDatosMandaditoIA(origenInfo: string, destinoInfo: string, telefonoCliente: string, role?: string): Promise<ValidacionMandadito> {
  const defaultFallback: ValidacionMandadito = {
    estaCompleto: false,
    datosFaltantes: ['referencias_generales'],
    preguntaAlCliente: `📝 ¿Alguna referencia o seña para llegar? También puedes contarnos qué paquete llevamos.\n\n_Escribe *no* si no tienes ninguna._`,
    datosEstructurados: { nombreRemitente: null, nombreReceptor: null, numeroOrden: null, telefonoContacto: null }
  }

  const roleInstruction = role === 'envio'
    ? `3. El cliente (cuyo número es ${telefonoCliente}) YA NOS INDICÓ QUE ÉL ES EL REMITENTE (EL QUE ENVÍA). Obligatoriamente pide nombre y teléfono del RECEPTOR si no se han dado.`
    : role === 'recibo'
    ? `3. El cliente (cuyo número es ${telefonoCliente}) YA NOS INDICÓ QUE ÉL ES EL DESTINATARIO (EL QUE RECIBE). Obligatoriamente pide nombre y teléfono del REMITENTE si no se han dado.`
    : `3. ENVÍOS ENTRE PERSONAS: Si no está claro quién envía y quién recibe, pregúntale: "📱 ¿tú ERES EL QUE ENVÍA o ERES EL QUE RECIBE?".`

  const prompt = `Eres un auditor logístico para Estrella Envíos (Comitán, Chiapas).
Decide si falta información crucial para ejecutar el mandadito.

Teléfono del cliente: ${telefonoCliente}
Origen: ${origenInfo}
Destino: ${destinoInfo}

REGLAS:
1. COMERCIOS: Pide número de orden/ticket y si el repartidor debe pagar.
2. CASAS: Pide referencias (color de fachada, entre qué calles). Sin esto, estaCompleto=false.
${roleInstruction}
4. LUGARES PÚBLICOS: Pide a quién buscar o cómo va vestida la persona.
5. TONO: Eres Estrella, amigable y chiapaneco. La pregunta debe sonar humana y con emojis.

Devuelve JSON:
{
  "estaCompleto": boolean,
  "datosFaltantes": string[],
  "preguntaAlCliente": string|null,
  "datosEstructurados": {
    "nombreRemitente": string|null,
    "nombreReceptor": string|null,
    "numeroOrden": string|null,
    "telefonoContacto": string|null
  }
}`

  const content = await callGemini(
    [{ role: 'user', content: prompt }],
    'gemini-3.1-pro-preview',
    400,
    true
  )

  if (!content) return defaultFallback

  try {
    const parsed = JSON.parse(content)
    return {
      estaCompleto: !!parsed.estaCompleto,
      datosFaltantes: Array.isArray(parsed.datosFaltantes) ? parsed.datosFaltantes : [],
      preguntaAlCliente: parsed.preguntaAlCliente || null,
      datosEstructurados: parsed.datosEstructurados || { nombreRemitente: null, nombreReceptor: null, numeroOrden: null, telefonoContacto: null }
    }
  } catch (e) {
    console.error('Error Validacion IA:', e)
    return defaultFallback
  }
}

export async function extraerResumenFinalIA(origenInfo: string, destinoInfo: string, referenciasInfo: string | null, telefonoCliente: string) {
  const defaultFallback = {
    origenLimpio: 'Origen', destinoLimpio: 'Destino',
    remitente: null, receptor: null, telefono: null, orden: null, detalles: referenciasInfo
  }
  

  const prompt = `Eres un asistente que resume pedidos de envío.
Extrae la información final basándote en estos textos:
Origen: ${origenInfo}
Destino: ${destinoInfo}
Referencias Adicionales: ${referenciasInfo || 'Ninguna'}
Teléfono del Cliente: ${telefonoCliente}

Devuelve UN JSON con esta estructura:
{
  "origenLimpio": "Nombre corto y limpio del lugar de origen (ej. 'Domino\\'s', 'Soriana', 'Col. Belisario', etc.) sin detalles extra.",
  "destinoLimpio": "Nombre corto y limpio del lugar de destino (ej. 'Col. Centro', 'Casa', etc.)",
  "remitente": "Nombre de la persona en el origen o a nombre de quién está el pedido (si aplica)",
  "receptor": "Nombre de la persona en el destino (si aplica)",
  "telefono": "Teléfono extraído de los textos. Si dicen 'a mi número', usa ${telefonoCliente}.",
  "orden": "Número de ticket, orden o pedido (si aplica)",
  "detalles": "Cualquier otra referencia visual (color de casa, portón, indicaciones) que no sea el teléfono ni la orden."
}`

  const content = await callGemini(
    [{ role: 'user', content: prompt }],
    'gemini-3.1-pro-preview',
    300,
    true
  )
  if (!content) return defaultFallback
  try {
    return JSON.parse(content)
  } catch (e) {
    return defaultFallback
  }
}
