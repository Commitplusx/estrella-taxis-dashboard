# Comprensión natural y conservación de datos — 30 de octubre de 2026

Estado posterior: [v9, reinicio y mínimo de Pompeyo](STELLAR_RESET_MINIMUM_20261030.md). Las versiones y resultados de esta página corresponden a la publicación histórica v8.

## Cambios publicados

Motor `taxi-bot-v8-context`, exclusivo del canal de Pompeyo terminado en 2491. Se mantienen el GPS nativo obligatorio de recogida, destino opcional, tarifa del servidor y confirmación exclusivamente con el botón vigente. No cambian las RPC ni la asignación o cierre de viajes.

La revisión reprodujo estos problemas antes de corregirlos:

- Una negación en otra idea («voy a Pilita Seca y no llevo equipaje») rechazaba la dirección válida. La polaridad ahora se comprueba en la cláusula del dato; las correcciones del otro extremo no borran el primero.
- Una coincidencia parcial podía recortar «Mariana» a «Ana», o extraer «la» dentro de «ala». Los datos deben coincidir con palabras completas del mensaje actual. Se conserva la escritura del pasajero para la búsqueda de lugares; el modelo no inventa artículos ni corrige nombres por su cuenta.
- Una corrección a «Centrosur» podía ocultar la mención previa a «Centro» al buscar subcadenas. La comprobación de correcciones posteriores también usa palabras completas.
- Respuestas directas como «ahí me recoges», «es donde estoy» o «es a donde voy» no resolvían el papel de un pin pendiente. Se aceptan respuestas afirmativas acotadas; preguntas, condicionales, direcciones y alternativas no eligen un pin automáticamente.
- Un fallo o propuesta rechazada del intérprete podía descartar del borrador un pin enviado con texto. El evento nativo se conserva independientemente del texto: se guarda el GPS o el pin pendiente de aclaración, se invalida la confirmación y se pregunta lo que falta. No se ofrece reserva mientras ese mensaje siga sin entenderse.

Las referencias visuales conservan contrastes explícitos como «es el portón azul, no el rojo». Una cita recortada de «no es el portón azul» sigue sin autorizar una afirmación positiva sobre ese portón. Las direcciones negadas, alternativas sin resolver, citas ajenas, hipótesis y correcciones posteriores continúan protegidas.

## Evidencia

El conjunto fijo `tests/fixtures/taxi-language-hardening.ts` se declaró antes de consultar el modelo. Contiene 58 casos sintéticos: faltas de escritura, coloquialismos, nombres, referencias, origen/destino simultáneos, correcciones entre mensajes, negaciones, consultas de precio y ambigüedades. Los mismos casos y expectativas se conservaron en la comparación:

- Antes: 50 de 58 aprobados con el modelo real.
- Después: 58 de 58 aprobados con el modelo real.
- Hash de casos: `e810900ec5f3f666c10de1ea286b9f292f271c937b1e154ac8570a4ddb086d7d`.
- Contrato anterior: `e4430118a424026ab166a7ac4d2b7e4fe01f92d246034149a835c9c3bc4b31a7`.
- Contrato nuevo: `8f94885e96d68e1c7aa699a9584b46b6111f844083afbf8b8d9c495569a56662`.

Se usaron como ejemplos de desarrollo durante el ajuste. Estos resultados **no miden precisión general ni constituyen una prueba ciega o entrenamiento de pesos**. No contienen contactos reales ni envían mensajes.

La última ejecución completa aprobó 5,814 pruebas Deno y 113 pruebas Node (91 SQL y 22 contratos), tipado estricto del panel y pruebas, los puntos de entrada y el control estático ampliado a 90 archivos. Tras identificar la nueva versión del motor, se repitieron las pruebas de herramientas/trazas y el recorrido SQL integrado con su versión exacta.

La prueba SQL de persistencia recorre eventos nativos reales del montaje aislado: pin + texto → falla del intérprete → commit → sesión restaurada → «ahí me recoges» → captura de nombre → tarifa → resumen. Conserva el identificador original del pin, completa los cuatro eventos y no crea viajes ni ofertas. Otras pruebas comprueban que texto afirmativo, botones antiguos y respuestas mezcladas no solicitan un taxi.

## Evaluación reproducible

El evaluador existente admite `--suite=language`, usando exclusivamente los 58 casos fijos y sus estados iniciales. La suite anterior permanece como `--suite=intents`. Valida los argumentos, limita las llamadas a 64/12 según la suite, establece cuatro minutos de plazo, no reintenta y falla si faltan casos o alguna expectativa no se cumple. Guarda hashes de casos, estados iniciales y contrato; no exporta secretos ni mensajes de clientes.

Con las credenciales del modelo ya configuradas en el entorno privado:

```powershell
deno run --allow-env=DEEPSEEK_API_KEY,TAXI_EVAL_MODEL --allow-net=api.deepseek.com --allow-write=.codex-tmp estrella-taxis-backend/scripts/evaluate-taxi-intents.ts .codex-tmp/taxi-language-evaluation.json --suite=language
```

El control habitual `estrella-taxis-backend/scripts/test-taxi-bot.ps1` ejecuta las nuevas regresiones sin llamar al modelo real.

## Publicación verificada

Destino único: Stellar Tracking `izrsxygazsalfhpaualj`. Canal activo de Pompeyo, con 2,541 H3 propios y 191 localidades escritas. Sin migraciones ni cambios de tarifas o permisos. El paquete sólo difiere del activo anterior en contratos/versionado, coordinador, política e instrucciones del intérprete.

| Función | Versión | SHA-256 del paquete |
| --- | --- | --- |
| `ycloud-webhook` | 20 | `3f58591fd7fae32cf9b2d3acbf6495d903405f821824f5b0147ea44488857278` |
| `process-queue` | 20 | `2a16da92310dfe9428ed563dd4661e972fcabc69bca3c0e93049eb27c309efb6` |
| `taxi-bot-admin` | 26 | `3947826665a070156290d50fff87ac142d7c38895b854475694bfcebf8633921` |

Se descargaron las tres funciones después de publicar: 25/25/24 archivos ejecutables coinciden con el código revisado. OPTIONS respondió 200 en las tres; el administrador sin credenciales respondió 401. El consumidor PM2 `stellar-taxi-bot` siguió en línea. La función temporal de evaluación y su ejecutor remoto se eliminaron al terminar.

Respaldos y evidencia privada: `.codex-tmp/taxi-language-20261030/`, incluidos `before.log`, `literal-before.log`, `suffix-before.log`, `rejected-field-before.log`, `model-before.json`, `model-after.json`, `final-checks.log`, `persistence.log`, fuentes descargadas antes/después y `published-verification.json`. Se mantiene pendiente la comprobación física por WhatsApp con pasajero y conductor; las pruebas no crearon viajes ni mensajes comerciales reales.
