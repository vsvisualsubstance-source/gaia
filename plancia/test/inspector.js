'use strict';
// Ispettore di "Modifica griglia" (spec.inspector nel registro): cambia un campo
// per tipo e controlla che il widget (o il palco) cambi davvero.
//   node test/inspector.js   (incluso in npm run check)

const assert = require('assert');
const { startPlancia, sleep } = require('./browser-harness');

// tipo (o tipo:modo) -> campo, valore nuovo, verifica sul widget
const EDITS = [
  ['button', '#fMode', 'push', w => w.mode === 'push'],
  ['clock', '#fCMode', 'countdown', w => w.mode === 'countdown'],
  ['timeline', '#fDur', '1234', w => w.duration === 1234],
  ['stage', '#stWidth', '17.5', (w, L) => L.stage.width === 17.5],
  ['patchdeck', '#gDeck', 'b', w => w.deck === 'b'],
  ['scenes:push', '#fSMode', 'multi', w => w.mode === 'multi' && Array.isArray(w.value)],
  ['fader', '#fMax', '255', w => w.max === 255],
];

(async () => {
  const p = await startPlancia({ hooks: true });
  try {
    await p.ev(`document.querySelector('#editBtn').click();1`);
    await sleep(400);
    for (const [key, field, value, check] of EDITS) {
      const [type, mode] = key.split(':');
      const t = await p.ev(`(()=>{let out=null;window.__planciaTest.L.pages.forEach((pg,pi)=>pg.widgets.forEach(w=>{
        if(!out&&w.type==='${type}'&&(${mode ? `(w.mode||'push')==='${mode}'` : 'true'}))out={pi,id:w.id}}));return out})()`);
      assert.ok(t, `${key}: nessun widget nel layout`);
      await p.ev(`document.querySelectorAll('#tabs > *')[${t.pi}].click();1`);
      await sleep(300);
      const c = await p.ev(`(()=>{const r=document.querySelector('[data-id="${t.id}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await sleep(300);
      const set = await p.ev(`(()=>{const n=document.querySelector('#insp ${field}');if(!n)return false;n.value=${JSON.stringify(value)};
        n.dispatchEvent(new Event(n.tagName==='SELECT'?'change':'input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
      assert.ok(set, `${key}: campo ${field} assente nell'ispettore`);
      await sleep(200);
      const w = await p.ev(`window.__planciaTest.L.pages.flatMap(p=>p.widgets).find(w=>w.id==='${t.id}')`);
      const L = await p.ev(`({stage:window.__planciaTest.L.stage})`);
      assert.ok(check(w, L), `${key}: ${field} = ${value} non arriva al widget`);
      console.log(`ok     ${key.padEnd(12)} ${field} = ${value}`);
    }
    // l'ultimo widget toccato e' il fader: cambio d'indirizzo dall'ispettore,
    // l'OSC in arrivo sul nuovo indirizzo deve trovarlo (indice per indirizzo)
    await p.ev(`window.__planciaTest.receive({type:'osc',address:'/zz/prima',args:[0]});1`); // indice gia' costruito
    await p.ev(`(()=>{const n=document.querySelector('#insp #fAddr');n.value='/zz/nuovo';n.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
    const moved = await p.ev(`(()=>{const T=window.__planciaTest,w=T.L.pages.flatMap(p=>p.widgets).find(w=>w.addr==='/zz/nuovo');
      T.receive({type:'osc',address:'/zz/nuovo',args:[w.min+(w.max-w.min)/4]});return w.value})()`);
    assert.equal(moved, 0.25, 'OSC sul nuovo indirizzo non arriva al fader');
    console.log('ok     fader        OSC in arrivo sul nuovo indirizzo');
    assert.deepEqual(p.problems, []);
    console.log(`ispettore: ${EDITS.length} modifiche arrivate ai widget`);
  } finally { p.close(); }
})().catch(e => { console.error('ispettore:', e.message); process.exitCode = 1; });
