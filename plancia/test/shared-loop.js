'use strict';
// Nessun rimbalzo del layout condiviso tra due pagine che non sono d'accordo
// sulle teste di DMX Master (lampeggio del 2026-10-29: ogni pagina salvava di
// nuovo il proprio elenco a ogni layout ricevuto, una volta al secondo).
// Pagina "collegata" con le teste vere (test/fixtures/td-dmx-win.json, 6
// teste); un secondo client manda al bridge lo stesso layout con 5 teste:
// la pagina lo accetta e NON lo riscrive.
//   node test/shared-loop.js   (incluso in npm run check)

const assert = require('assert');
const WebSocket = require('ws');
const { startPlancia, sleep } = require('./browser-harness');
const TD = require('./fixtures/td-dmx-win.json');

(async () => {
  const p = await startPlancia({ hooks: true });
  try {
    await p.ev(`(()=>{window.__shared=0;const s=WebSocket.prototype.send;
      WebSocket.prototype.send=function(d){try{if(JSON.parse(d).type==='shared_state')window.__shared++}catch{}return s.call(this,d)};
      const T=window.__planciaTest;T.G.ok=true;   // come collegata a MQTT (nessun client: niente viene pubblicato)
      for(const[t,m]of Object.entries(${JSON.stringify(TD)}))T.gIn(t,JSON.parse(JSON.stringify(m)));return 1})()`);
    await sleep(1500);
    const heads = await p.ev(`window.__planciaTest.L.pages.flatMap(p=>p.widgets).filter(w=>w.mode==='head-select'&&w.addr==='/mh/select/heads').map(w=>w.headValues.length)`);
    assert.ok(heads.length && heads.every(n => n === 6), 'selettori delle teste non allineati a TD: ' + JSON.stringify(heads));
    console.log(`ok     ${heads.length} selettori delle teste con le 6 teste di TD`);

    // secondo client con un elenco vecchio (5 teste)
    const other = new WebSocket(`ws://127.0.0.1:${p.port}/`);
    const hello = await new Promise(r => other.on('message', d => { const m = JSON.parse(d); if (m.type === 'hello') r(m); }));
    const state = JSON.parse(JSON.stringify(hello.sharedState));
    for (const pg of state.layout.pages) for (const w of pg.widgets) if (w.mode === 'head-select' && w.addr === '/mh/select/heads') {
      w.headValues = w.headValues.slice(0, 5); w.items = w.items.split('\n').slice(0, 5).join('\n'); w.value = w.value.slice(0, 5); w.selectedHeads = (w.selectedHeads || []).filter(id => w.headValues.includes(id));
    }
    await p.ev(`window.__shared=0;1`);
    other.send(JSON.stringify({ type: 'shared_state', state, clientRevision: 1 }));
    await sleep(3000);
    const sent = await p.ev(`window.__shared`), after = await p.ev(`window.__planciaTest.L.pages.flatMap(p=>p.widgets).filter(w=>w.mode==='head-select'&&w.addr==='/mh/select/heads').map(w=>w.headValues.length)`);
    other.close();
    assert.equal(sent, 0, `la pagina ha riscritto il layout ${sent} volte dopo averlo ricevuto (rimbalzo)`);
    console.log(`ok     layout ricevuto (teste ${after.join(',')}): nessun salvataggio di ritorno`);
    assert.deepEqual(p.problems, []);
  } finally { p.close(); }
})().catch(e => { console.error('rimbalzo layout:', e.message); process.exitCode = 1; });
