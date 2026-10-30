$ErrorActionPreference = 'Stop'
$taxiRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location -LiteralPath $taxiRepo
try {
  & node --experimental-strip-types estrella-taxis-backend/scripts/check-taxi-bot-quality.ts
  if ($LASTEXITCODE -ne 0) { throw 'Falló el control de calidad del bot de taxis.' }
  & deno check estrella-taxis-backend/supabase/functions/taxi-bot-admin/index.ts estrella-taxis-backend/supabase/functions/process-queue/index.ts estrella-taxis-backend/supabase/functions/ycloud-webhook/index.ts estrella-taxis-backend/scripts/run-taxi-worker.ts estrella-taxis-backend/scripts/evaluate-taxi-intents.ts
  if ($LASTEXITCODE -ne 0) { throw 'Falló el tipado de los puntos de entrada.' }
  & deno test tests/taxi-neighborhoods.test.ts tests/taxi-address-geocoder.test.ts tests/taxi-natural-flow.test.ts tests/taxi-native-location.test.ts tests/taxi-accounts.test.ts tests/taxi-bot-core.test.ts tests/taxi-bot-services.test.ts tests/taxi-bot-ambiguities.test.ts tests/taxi-bot-h3.test.ts tests/taxi-admin.test.ts tests/taxi-driver-admin.test.ts tests/taxi-customer-access.test.ts tests/taxi-bot-trace.test.ts tests/taxi-bot-quality.test.ts tests/taxi-bot-state-matrix.test.ts tests/taxi-bot-tools.test.ts tests/stellar-entrypoints.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas del coordinador/intérprete/proveedores.' }
  & npx tsc -p tsconfig.taxi-admin.json --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Falló el tipado estricto del panel de zonas.' }
  & npx tsc -p tsconfig.taxi-tests.json --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Falló el tipado estricto de las pruebas SQL.' }
  & node --experimental-strip-types --test tests/taxi-bot-database.test.ts tests/stellar-separation.test.ts tests/stellar-package.test.ts tests/stellar-config.test.ts tests/taxi-session.test.ts tests/taxi-coverage.test.ts tests/taxi-coverage-cache.test.ts tests/taxi-zone-colors.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Fallaron las transacciones o el recorrido integrado.' }
  Write-Output 'Taxi bot: verificaciones locales aprobadas. Esto no acredita publicación ni WhatsApp físico.'
} finally { Pop-Location }
