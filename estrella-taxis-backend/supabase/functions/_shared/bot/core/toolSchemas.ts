export const COMMON_TOOLS: Array<Record<string, unknown>> = [
  {
    type: "function",
    function: {
      name: "escalar_humano",
      description: "Transfiere la conversación a un agente humano cuando el cliente está enojado, tiene una queja compleja, o pide hablar con un humano.",
      parameters: {
        type: "object",
        properties: {
          resumen: { type: "string", description: "Breve resumen del problema para el agente humano." }
        },
        required: ["resumen"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "pedir_ubicacion",
      description: "Envía un botón nativo de WhatsApp para que el cliente comparta su ubicación GPS exacta.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_catalogo",
      description: "⚠️ OBLIGATORIO: Ejecuta esta herramienta SIEMPRE que el cliente mencione un producto, paquete o menú, INCLUSO SI crees que ya sabes la respuesta por el historial de la conversación. NUNCA respondas de memoria, los datos cambian en tiempo real. Si te vuelven a preguntar, VUELVES a buscar.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Término de búsqueda (ej. 'paquete 3', 'hamburguesas', 'precios de envío')." }
        },
        required: ["query"]
      }
    }
  }
];

export const RESTAURANT_TOOLS: Array<Record<string, unknown>> = [
  {
    type: "function",
    function: {
      name: "preguntar_tipo_entrega",
      description: "Muestra botones interactivos para que el cliente elija si quiere Entrega a Domicilio o Pasar a Recoger.",
      parameters: {
        type: "object",
        properties: {
          mensaje: { type: "string", description: "Mensaje natural y contextual antes de mostrar los botones. Úsalo para contestar dudas del cliente (ej. 'Son $150 en total. ¿Cómo te gustaría recibirlo?')." }
        },
        required: ["mensaje"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mostrar_menu_lista",
      description: "⚠️ OBLIGATORIO: Usa SIEMPRE este tool para mostrar el menú, categorías, o cualquier lista de productos al cliente. NUNCA mandes el menú como texto plano. Primero usa 'consultar_catalogo' para obtener los productos reales, luego pasa esos datos aquí.",
      parameters: {
        type: "object",
        properties: {
          mensaje: { type: "string", description: "Texto breve e invitador antes de la lista (ej: '¡Aquí está nuestro menú! 🍗 Toca para ver los detalles:')." },
          boton: { type: "string", description: "Texto del botón, máximo 20 caracteres (ej. 'Ver Menú 🍽️')." },
          items: {
            type: "array",
            description: "OBLIGATORIO: Lista de productos del catálogo. DEBES incluir hasta 10 items (el máximo de WhatsApp). Ponle emojis de comida en la descripción para hacerlo visual.",
            items: {
              type: "object",
              properties: {
                nombre: { type: "string", description: "Nombre del producto, máx 22 chars (ej. 'Boneless 10 Pzas')." },
                descripcion: { type: "string", description: "Emoji + precio + detalle breve, máx 72 chars (ej. '🍗 $120 — Con dip de tu elección')." },
                categoria: { type: "string", description: "Categoría del producto (ej. 'Alitas', 'Paquetes', 'Complementos')." }
              },
              required: ["nombre"]
            }
          }
        },
        required: ["items"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "enviar_pedido",
      description: "Registra un pedido finalizado y lo envía a la cocina. Úsalo SOLO cuando el cliente ya confirmó producto y dirección (o si pasa a recoger).",
      parameters: {
        type: "object",
        properties: {
          pedido: { type: "string", description: "Descripción detallada de lo que pidió (ej. '1 Pizza Pepperoni, 2 Refrescos')." },
          direccion: { type: "string", description: "Dirección completa de entrega, o 'Recoger en tienda' si pasa por él." },
          tipo_entrega: { type: "string", description: "'domicilio' o 'recoger'" },
          nombre: { type: "string", description: "Nombre del cliente." }
        },
        required: ["pedido", "direccion", "nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cotizar_envio",
      description: "Calcula el costo de envío a una colonia o dirección específica.",
      parameters: {
        type: "object",
        properties: {
          direccion: { type: "string", description: "Calle y colonia a donde se enviaría." }
        },
        required: ["direccion"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "enviar_ticket_facturacion",
      description: "Ejecuta esta herramienta cuando el cliente solicite una factura y se cuente con: (1) el ID del ticket/documento de consumo válido, Y (2) los datos fiscales completos (RFC, Razón Social, Código Postal, Régimen Fiscal y Uso de CFDI). Los datos fiscales pueden venir de dos fuentes: extraídos automáticamente de un PDF que el cliente envió (Constancia del SAT), o escritos directamente por el cliente en el chat. NUNCA uses datos fiscales inventados o de ejemplo.",
      parameters: {
        type: "object",
        properties: {
          media_id: { type: "string", description: "El ID_IMAGEN estrictamente de la FOTO DEL TICKET DE COMPRA. NUNCA uses aquí el ID del PDF de la Constancia de Situación Fiscal. El contador necesita ver la foto del ticket, no el PDF." },
          media_url: { type: "string", description: "La URL pública de la foto del ticket (provista en el mensaje del sistema)." },
          media_type: { type: "string", description: "El TIPO_MEDIA que recibiste en el contexto del mensaje (ej. 'image' o 'document')." },
          datos_fiscales: { type: "string", description: "ESTRICTAMENTE OBLIGATORIO: Devuelve los datos fiscales (RFC, Nombre, CP, Régimen, Uso CFDI) separados por SALTO DE LÍNEA (\\n). Ejemplo exacto:\nRFC: Valor\nRazón Social: Valor\nCódigo Postal: Valor" },
          pdf_media_id: { type: "string", description: "OPCIONAL. Si el cliente envió su Constancia de Situación Fiscal en PDF, pon aquí el ID_DOCUMENTO_FISCAL (ID_IMAGEN) de ese PDF para adjuntarlo al contador." },
          pdf_url: { type: "string", description: "OPCIONAL. La URL pública del PDF (provista en el mensaje del sistema si envió constancia)." }
        },
        required: ["media_id", "media_url", "media_type", "datos_fiscales"]
      }
    }
  }
];

export const TAXI_TOOLS: Array<Record<string, unknown>> = [
  {
    type: "function",
    function: {
      name: "book_taxi",
      description: "Reserva un taxi enviando el viaje a los choferes.",
      parameters: {
        type: "object",
        properties: {
          origen: { type: "string", description: "Dirección de origen." },
          destino: { type: "string", description: "Dirección de destino." },
          nombre: { type: "string", description: "Nombre del pasajero." }
        },
        required: ["origen"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cotizar_viaje",
      description: "Calcula el costo de un viaje en taxi.",
      parameters: {
        type: "object",
        properties: {
          origen: { type: "string" },
          destino: { type: "string" }
        },
        required: ["origen", "destino"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cancelar_viaje",
      description: "Cancela un viaje activo de taxi.",
      parameters: {
        type: "object",
        properties: {
          motivo: { type: "string" }
        }
      }
    }
  }
];

export function getToolsForBusiness(tipoNegocio: string) {
  let tools = [...COMMON_TOOLS];
  if (tipoNegocio === 'taxi') {
    tools = tools.concat(TAXI_TOOLS);
  } else if (tipoNegocio === 'restaurante' || tipoNegocio === 'comida') {
    tools = tools.concat(RESTAURANT_TOOLS);
  }
  return tools;
}
