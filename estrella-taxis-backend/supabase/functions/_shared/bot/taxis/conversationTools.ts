import { type Interpretation, record } from "./contracts.ts";
import { parseInterpretation } from "./policy.ts";
import { TrackingError } from "../../tracking/contracts.ts";

type TaxiToolName =
  | "actualizar_recorrido"
  | "cotizar_viaje"
  | "consultar_mi_viaje"
  | "escalar_a_base"
  | "saludar"
  | "aclarar_solicitud";
interface TaxiToolDefinition {
  type: "function";
  function: {
    name: TaxiToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}
const field = (max: number) => ({
  type: "object",
  additionalProperties: false,
  required: ["value", "evidence"],
  properties: {
    value: { type: "string", minLength: 2, maxLength: max },
    evidence: { type: "string", minLength: 2, maxLength: 3000 },
  },
});
const fields = {
  type: "object",
  additionalProperties: false,
  properties: { name: field(80), origin: field(400), destination: field(400) },
};
const withFields = {
  type: "object",
  additionalProperties: false,
  required: ["fields"],
  properties: { fields },
};
const noArguments = {
  type: "object",
  additionalProperties: false,
  properties: {},
};
/** One atomic proposal; the existing coordinator executes permitted services and SQL owns mutations. */
export const TAXI_CONVERSATION_TOOLS: readonly TaxiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "actualizar_recorrido",
      description:
        "Propone datos de recogida, destino y pasajero, incluidas respuestas breves al expectedField pendiente (colonia, calle, referencia o nombre, aunque no tengan verbo). Incluye todos los cambios actuales en una sola llamada y cita su cláusula literal completa. No reserva. fields debe contener al menos un dato.",
      parameters: {
        ...withFields,
        properties: { fields: { ...fields, minProperties: 1 } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cotizar_viaje",
      description:
        "Consulta tarifa y resumen del recorrido mediante el servidor. Incluye cambios actuales con evidencia; fields vacío reutiliza el borrador. No elige importe ni solicita unidad; preguntar el precio no autoriza reservar.",
      parameters: withFields,
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_mi_viaje",
      description:
        "Consulta sólo la solicitud del pasajero actual; no recibe teléfono, ID de viaje ni estado supuesto.",
      parameters: noArguments,
    },
  },
  {
    type: "function",
    function: {
      name: "escalar_a_base",
      description:
        "Pide atención de la base: persona, queja, emergencia o servicio especial. No promete disponibilidad ni una reserva.",
      parameters: noArguments,
    },
  },
  {
    type: "function",
    function: {
      name: "saludar",
      description:
        "Saludo o conversación breve sin datos ni cambios del viaje. Si hay datos actuales usa actualizar_recorrido.",
      parameters: noArguments,
    },
  },
  {
    type: "function",
    function: {
      name: "aclarar_solicitud",
      description:
        "Petición ambigua después de consultar el dato pendiente, contradictoria, condicional, ejemplo, instrucciones ajenas al servicio o confirmación/cancelación que el servidor deba comprobar. Una colonia o referencia breve que responde al expectedField usa actualizar_recorrido. No modifica datos.",
      parameters: noArguments,
    },
  },
];

export function parseTaxiToolCompletion(
  raw: unknown,
  current: string,
): Interpretation {
  const incomplete = (): never => {
    throw new TrackingError(
      502,
      "taxi_model_incomplete",
      "La interpretación quedó incompleta.",
    );
  };
  if (!record(raw) || !Array.isArray(raw.choices) || raw.choices.length !== 1) {
    return incomplete();
  }
  const choice: unknown = raw.choices[0];
  if (
    !record(choice) || choice.finish_reason !== "tool_calls" ||
    !record(choice.message)
  ) return incomplete();
  const message = choice.message;
  if (
    message.role !== "assistant" ||
    (message.content !== null && message.content !== undefined &&
      message.content !== "") ||
    !Array.isArray(message.tool_calls) || message.tool_calls.length !== 1
  ) return incomplete();
  const call: unknown = message.tool_calls[0];
  if (
    !record(call) || call.type !== "function" || typeof call.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(call.id) || !record(call.function)
  ) return incomplete();
  const fn = call.function;
  if (typeof fn.arguments !== "string" || fn.arguments.length > 12000) {
    return incomplete();
  }
  let args: unknown;
  try {
    args = JSON.parse(fn.arguments);
  } catch {
    throw new TrackingError(
      502,
      "taxi_model_invalid_json",
      "Los argumentos de la herramienta no tienen un formato válido.",
    );
  }
  if (!record(args)) {
    throw new TrackingError(
      502,
      "invalid_taxi_tool_arguments",
      "La herramienta no tiene argumentos válidos.",
    );
  }
  let intent: Interpretation["intent"];
  if (fn.name === "actualizar_recorrido" || fn.name === "cotizar_viaje") {
    if (
      Object.keys(args).length !== 1 || !record(args.fields) ||
      (fn.name === "actualizar_recorrido" &&
        Object.keys(args.fields).length === 0)
    ) {
      throw new TrackingError(
        502,
        "invalid_taxi_tool_arguments",
        "Faltan los datos actuales del recorrido.",
      );
    }
    return parseInterpretation({
      intent: fn.name === "actualizar_recorrido" ? "provide" : "quote",
      fields: args.fields,
    }, current);
  }
  switch (fn.name) {
    case "consultar_mi_viaje":
      intent = "status";
      break;
    case "escalar_a_base":
      intent = "human";
      break;
    case "saludar":
      intent = "smalltalk";
      break;
    case "aclarar_solicitud":
      intent = "ambiguous";
      break;
    default:
      throw new TrackingError(
        502,
        "invalid_taxi_tool",
        "La herramienta no está permitida para taxis.",
      );
  }
  if (Object.keys(args).length !== 0) {
    throw new TrackingError(
      502,
      "invalid_taxi_tool_arguments",
      "La herramienta no acepta datos adicionales.",
    );
  }
  return parseInterpretation({ intent, fields: {} }, current);
}
