import ts from 'typescript';
import {readFileSync,readdirSync,statSync}from'node:fs';
import {resolve,relative}from'node:path';
const root=resolve(import.meta.dirname,'../..'),taxi=resolve(root,'estrella-taxis-backend/supabase/functions/_shared/bot/taxis');
const names=['conversationTools.ts','trace.ts','stateMachine.ts','adminContracts.ts','contracts.ts','policy.ts','coordinator.ts','interpreter.ts','services.ts','h3.ts','transport.ts','engine.ts','runtime.ts','prompt.ts','tools.ts'];
const files=[...names.map((n)=>resolve(taxi,n)),resolve(root,'tests/taxi-bot-core.test.ts'),resolve(root,'tests/taxi-bot-database.test.ts'),resolve(root,'tests/taxi-bot-services.test.ts'),resolve(root,'tests/taxi-bot-ambiguities.test.ts'),resolve(root,'tests/taxi-bot-h3.test.ts'),resolve(root,'tests/fixtures/taxi-intents.ts'),resolve(root,'estrella-taxis-backend/scripts/run-taxi-worker.ts'),resolve(root,'estrella-taxis-backend/scripts/evaluate-taxi-intents.ts')];
files.push(...['tests/taxi-admin.test.ts','src/lib/taxiAdminClient.ts','src/lib/taxiAdminPreview.ts','src/pages/TaxiBotAdminPage.tsx','src/components/TaxiChannelForm.tsx','src/components/TaxiZoneMap.tsx','estrella-taxis-backend/supabase/functions/taxi-bot-admin/handler.ts','estrella-taxis-backend/supabase/functions/taxi-bot-admin/index.ts'].map((file)=>resolve(root,file)));
files.push(...['tests/taxi-bot-trace.test.ts','tests/taxi-bot-quality.test.ts','tests/taxi-bot-state-matrix.test.ts','estrella-taxis-backend/supabase/functions/taxi-bot-admin/quality.ts'].map((file)=>resolve(root,file)));
files.push(...['src/lib/taxiQualityClient.ts','src/components/TaxiQualityPanel.tsx','estrella-taxis-backend/supabase/functions/_shared/bot/taxis/qualityContracts.ts'].map((file)=>resolve(root,file)));
const failures:string[]=[];
files.push(resolve(root,'tests/taxi-customer-access.test.ts'));
files.push(...['estrella-taxis-backend/supabase/functions/_shared/bot/taxis/customerAccess.ts','src/components/TaxiCustomerAccessPanel.tsx'].map((file)=>resolve(root,file)));
files.push(...['src/pages/MapPage.tsx','src/lib/openStreetMap.ts','src/lib/fleetMapPresentation.ts','src/lib/fleetMapQuote.ts','tests/fleet-map.test.ts'].map((file)=>resolve(root,file)));
files.push(...['src/lib/taxiZoneColors.ts','tests/taxi-zone-colors.test.ts'].map((file)=>resolve(root,file)));
files.push(...['src/lib/taxiCoverage.ts','tests/taxi-coverage.test.ts'].map((file)=>resolve(root,file)));
files.push(...['tests/taxi-session.test.ts','src/lib/taxiSession.ts','src/context/AuthContext.tsx'].map((file)=>resolve(root,file)));
files.push(resolve(root,'tests/taxi-bot-tools.test.ts'));
files.push(...['estrella-taxis-backend/supabase/functions/_shared/bot/taxis/contactAdmin.ts','estrella-taxis-backend/supabase/functions/_shared/bot/taxis/driverAdmin.ts','estrella-taxis-backend/supabase/functions/_shared/bot/taxis/channelPhone.ts','estrella-taxis-backend/supabase/functions/taxi-bot-admin/drivers.ts','src/components/TaxiDriversPanel.tsx','src/components/TaxiPhoneField.tsx','tests/taxi-driver-admin.test.ts'].map((file)=>resolve(root,file)));
files.push(...['tests/stellar-separation.test.ts','tests/stellar-package.test.ts','tests/stellar-config.test.ts','tests/stellar-entrypoints.test.ts','src/lib/stellarBackendConfig.ts','src/lib/supabase.ts','estrella-taxis-backend/scripts/package-stellar-functions.ts','estrella-taxis-backend/supabase/functions/ycloud-webhook/index.ts','estrella-taxis-backend/supabase/functions/process-queue/index.ts'].map((file)=>resolve(root,file)));
for(const file of files){
  const source=readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const fail=(node:ts.Node,rule:string)=>{const pos=ast.getLineAndCharacterOfPosition(node.getStart(ast));failures.push(relative(root,file)+':'+(pos.line+1)+': '+rule);};
  function visit(node:ts.Node):void{
    if(node.kind===ts.SyntaxKind.AnyKeyword)fail(node,'No se permite any.');
    if(ts.isAsExpression(node)&&ts.isAsExpression(node.expression))fail(node,'No se permiten conversiones dobles.');
    ts.forEachChild(node,visit);
  }
  visit(ast);
  if(/@ts-(?:ignore|nocheck)|eslint-disable|deno-lint-ignore/.test(source))failures.push(relative(root,file)+': No se permiten supresiones.');
}
// Keep the scope explicit: legacy restaurant and voice files still have older contracts.
for(const directory of ['tests/fixtures'])assertDirectory(directory);
function assertDirectory(dir:string):void{const p=resolve(root,dir);if(!statSync(p).isDirectory()||readdirSync(p).length===0)throw new Error('Missing declared fixtures.');}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Taxi quality gate: '+files.length+' archivos revisados; sin tipos any, conversiones dobles ni supresiones.');
