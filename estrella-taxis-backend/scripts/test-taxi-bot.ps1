$ErrorActionPreference = 'Stop'
$taxiRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location -LiteralPath $taxiRepo
try {
  & node --test deployment/stellar/wialon-bridge/occupancy.test.cjs deployment/stellar/wialon-bridge/patch.test.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas del switch de ocupación.' }
  & node --experimental-strip-types estrella-taxis-backend/scripts/check-taxi-bot-quality.ts
  if ($LASTEXITCODE -ne 0) { throw 'Falló el control de calidad del bot de taxis.' }
  & deno check estrella-taxis-backend/supabase/functions/taxi-bot-admin/index.ts estrella-taxis-backend/supabase/functions/process-queue/index.ts estrella-taxis-backend/supabase/functions/ycloud-webhook/index.ts estrella-taxis-backend/scripts/run-taxi-worker.ts estrella-taxis-backend/scripts/evaluate-taxi-intents.ts estrella-taxis-backend/scripts/evaluate-taxi-compound-turns.ts
  if ($LASTEXITCODE -ne 0) { throw 'Falló el tipado de los puntos de entrada.' }
  & deno check estrella-taxis-backend/supabase/functions/driver-trip/index.ts
  if ($LASTEXITCODE -ne 0) { throw 'Falló el tipado de la página de viaje del chofer.' }
  & deno test --allow-read --allow-env tests/taxi-driver-trip-web.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Fallaron los contratos del enlace privado y aviso de llegada.' }
  & npx tsc -p tsconfig.driver-trip.json --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Falló el tipado de la interfaz del chofer.' }
  & npx tsc -p tsconfig.customer-trip.json --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Falló el tipado del seguimiento del cliente.' }
  & deno test tests/taxi-occupancy.test.ts tests/tracking-core.test.ts tests/tracking-regressions.test.ts tests/taxi-phone-login.test.ts tests/taxi-message-budget.test.ts tests/taxi-destination-help.test.ts tests/taxi-reset.test.ts tests/taxi-language-hardening.test.ts tests/taxi-gps-booking.test.ts tests/taxi-contextual-replies.test.ts tests/taxi-neighborhoods.test.ts tests/taxi-address-geocoder.test.ts tests/taxi-natural-flow.test.ts tests/taxi-native-location.test.ts tests/taxi-conversation-combinations.test.ts tests/taxi-recovery.test.ts tests/taxi-dispatch.test.ts tests/taxi-accounts.test.ts tests/taxi-owner.test.ts tests/taxi-bot-core.test.ts tests/taxi-bot-services.test.ts tests/taxi-bot-ambiguities.test.ts tests/taxi-bot-h3.test.ts tests/taxi-admin.test.ts tests/taxi-driver-admin.test.ts tests/taxi-customer-access.test.ts tests/taxi-bot-trace.test.ts tests/taxi-bot-quality.test.ts tests/taxi-bot-state-matrix.test.ts tests/taxi-bot-tools.test.ts tests/stellar-entrypoints.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas del coordinador/intérprete/proveedores.' }
  & npx tsc -p tsconfig.taxi-admin.json --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Falló el tipado estricto del panel de zonas.' }
  & npx tsc -p tsconfig.taxi-tests.json --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Falló el tipado estricto de las pruebas SQL.' }
  & node --experimental-strip-types --test tests/taxi-bot-database.test.ts tests/stellar-separation.test.ts tests/stellar-package.test.ts tests/stellar-config.test.ts tests/taxi-session.test.ts tests/taxi-coverage.test.ts tests/taxi-coverage-cache.test.ts tests/taxi-zone-colors.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Fallaron las transacciones o el recorrido integrado.' }
  Write-Output 'Taxi bot: verificaciones locales aprobadas. Esto no acredita publicación ni WhatsApp físico.'
} finally { Pop-Location }
