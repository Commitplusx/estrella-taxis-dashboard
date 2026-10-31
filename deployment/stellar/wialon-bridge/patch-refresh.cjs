'use strict';
/** Apply only to the reviewed bridge, after the occupancy patch. Never export credentials. */
function patchRefresh(source){
 const edits=[
  ['async function wialonApi(svc, params) {','async function wialonApi(svc, params, signal) {'],
  ["    body: body.toString()","    body: body.toString(),\n    signal"],
  ['async function login() {','async function login(signal) {'],
  ["await wialonApi('token/login', { token: WIALON_TOKEN });","await wialonApi('token/login', { token: WIALON_TOKEN }, signal);"],
  ['console.log(`✅ Login exitoso. Sesión: ${currentEid}`);',"console.log('✅ Login exitoso con Wialon.');"],
  ['async function syncTaxis() {','async function syncTaxis(signal) {'],
  ['    await login();','    await login(signal);'],
  ['      to: 0\n    });','      to: 0\n    }, signal);'],
  ['    let syncedCount = 0;','    let syncedCount = 0;\n    const expectedCount = items.filter(item => Boolean(item.pos)).length;'],
  ['        await fetch(osmandUrl);',"        const response = await fetch(osmandUrl, {signal});\n        if (!response.ok) throw Error('traccar_ingest_failed');\n        await response.body?.cancel();"],
  ['    console.log(`📡 Sincronización exitosa: ${syncedCount}/${items.length} taxis inyectados a Traccar.`);','    console.log(`📡 Sincronización exitosa: ${syncedCount}/${items.length} taxis inyectados a Traccar.`);\n    return {synced: syncedCount, expected: expectedCount};'],
  ["    if (err.message.includes('Error 1')) {\n      currentEid = null; \n    }", "    if (err.message.includes('Error 1')) {\n      currentEid = null; \n    }\n    throw Error('gps_refresh_failed');"],
  ['syncTaxis();\nsetInterval(syncTaxis, POLLING_INTERVAL_MS);',"const refreshController = createRefreshController(syncTaxis);\nstartRefreshServer(refreshController);\nconst poll = () => refreshController.run('poll').catch(() => console.error(JSON.stringify({event:'taxi_gps_sync_failed',reason:'poll'})));\npoll();\nsetInterval(poll, POLLING_INTERVAL_MS);"]
 ];
 let result=source.replaceAll('\r\n','\n');
 if(result.includes("require('./refresh.cjs')"))throw Error('Refresh already installed; review current state.');
 if(!result.includes("require('./occupancy.cjs')"))throw Error('Occupancy patch is required first.');
 for(const [before,after]of edits){if(result.split(before).length!==2)throw Error('Bridge baseline changed; cannot apply refresh patch.');result=result.replace(before,after);}
 return "const {createRefreshController,startRefreshServer} = require('./refresh.cjs');\n"+result;
}
module.exports={patchRefresh};
