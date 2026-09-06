---
name: "TypeScript Strictness (No Any)"
description: "Regla estricta para proyectos del usuario: Prohibido usar 'any' o parches temporales en TypeScript."
---

# TypeScript Strictness

1. **PROHIBIDO EL USO DE `any`:** Bajo ninguna circunstancia uses `any`, `Record<string, any>`, o parches temporales para "saltar" los errores del compilador de TypeScript.
2. **Usa Interfaces Precisas:** Si necesitas tipar un objeto que viene de la base de datos (Supabase) o de una API, define la `interface` o `type` exacta, detallando solo las propiedades que el código realmente necesita (ej: `interface EmpresaRow { id: string; waba_number?: string; }`).
3. **Calidad de Código:** El usuario (Kaleb) requiere código de producción, fuertemente tipado. Si hay un problema de tipos, arréglalo correctamente tipando la fuente de los datos o creando el casteo correcto a una interfaz definida, en lugar de usar `any`.
