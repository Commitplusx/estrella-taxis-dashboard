import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
test('fleet audit renders untrusted names and model text safely and exposes incomplete states',async()=>{
  const server=await createServer({server:{middlewareMode:true},appType:'custom'});
  try {
    const {FleetAuditReport}=await server.ssrLoadModule('/src/components/FleetAuditReport.tsx');
    const report={requestId:'fixture',generatedAt:'2026-10-27T18:00:00Z',period:{from:'2026-10-26T06:00:00Z',to:'2026-10-27T05:59:59Z'},
      devices:[{id:1,name:'<img src=x onerror="steal()">'}],facts:{units:1,distanceKm:20,eventCount:3,maxSpeedKmh:92,
        findings:[{id:'speed-1',deviceId:1,severity:'review',title:'Revisar velocidad',evidence:'Tres avisos requieren comprobar la zona.'}],warnings:[]},
      narrative:{summary:'<script>steal()</script>',recommendations:[{findingId:'speed-1',text:'<img src=x>'}]},narrativeStatus:'generated'};
    const html=renderToStaticMarkup(createElement(FleetAuditReport,{report,onClose:()=>{}}));
    assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('aria-label="Cerrar análisis"'));
    const unavailable=renderToStaticMarkup(createElement(FleetAuditReport,{report:{...report,narrative:null,narrativeStatus:'unavailable'},onClose:()=>{}}));
    assert.ok(unavailable.includes('La IA no respondió'));assert.ok(unavailable.includes('Tres avisos requieren'));
    const empty=renderToStaticMarkup(createElement(FleetAuditReport,{report:{...report,narrative:null,narrativeStatus:'not_configured',facts:{...report.facts,findings:[],warnings:['No hubo eventos; eso no prueba ausencia de incidentes.']}},onClose:()=>{}}));
    assert.ok(empty.includes('No aparecieron señales'));assert.ok(empty.includes('no prueba ausencia'));
  }finally {await server.close();}
});
