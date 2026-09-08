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
      description: "Busca en la base de datos (RAG) información sobre productos, precios, menú o servicios del negocio.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Término de búsqueda (ej. 'hamburguesas', 'precios de envío', 'horarios')." }
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
      description: "Muestra un menú interactivo nativo de WhatsApp. ÚSALO SIEMPRE que el cliente pida ver opciones, el menú, o pregunte qué hay.",
      parameters: {
        type: "object",
        properties: {
          mensaje: { type: "string", description: "Texto breve y amable invitando a abrir el menú." },
          boton: { type: "string", description: "Texto del botón, máximo 20 caracteres (ej. 'Ver Menú')." },
          items: {
            type: "array",
            description: "OBLIGATORIO: DEBES llenar este arreglo con TODAS las opciones o categorías solicitadas (hasta el límite técnico de 10). ESTÁ ESTRICTAMENTE PROHIBIDO resumir la lista a 5 opciones por 'conveniencia'. Tienes que agotar el límite de 10 espacios si hay más de 5 elementos.",
            items: {
              type: "object",
              properties: {
                nombre: { type: "string", description: "Nombre corto del producto (máx 22 chars). ¡NO PONGAS PRECIOS AQUÍ porque WhatsApp lo recorta!" },
                descripcion: { type: "string", description: "Breve descripción y el PRECIO (máx 72 chars)." },
                categoria: { type: "string", description: "Categoría del producto (ej. 'Bebidas', 'Complementos', 'Platos Fuertes')." }
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
