'use strict';
// MIDI in ingresso, da capo a fondo nel browser headless: "Impara MIDI" su un
// fader dall'ispettore, poi un CC dal controller (finto: PLANCIA_MIDI_FAKE=1
// fa accettare al bridge di prova {type:'midi_fake'}) che il BRIDGE esegue e
// rimanda alla pagina; PANIC imparato dalle impostazioni e premuto.
//   node test/midi-learn.js   (incluso in npm run check)

process.env.PLANCIA_MIDI_FAKE = '1';
const assert = require('assert');
const WebSocket = require('ws');
const { startPlancia, sleep } = require('./browser-harness');

(async () => {
  const p = await startPlancia({ hooks: true });
  const ctl = new WebSocket(`ws://127.0.0.1:${p.port}/`);
  const seen = [];
  ctl.on('message', d => { const m = JSON.parse(d); if (m.type === 'osc') seen.push(m); });
  await new Promise(r => ctl.on('open', r));
  const midi = (midiType, msg) => ctl.send(JSON.stringify({ type: 'midi_fake', midiType, msg }));
  try {
    await p.ev(`window.confirm=()=>true;1`);   // "nessuna porta MIDI: aspettare comunque?"
    // un fader del layout: Modifica griglia, pagina giusta, tocco vero, Impara
    const t = await p.ev(`(()=>{let out=null;window.__planciaTest.L.pages.forEach((pg,pi)=>pg.widgets.forEach(w=>{if(!out&&w.type==='fader'&&w.addr)out={pi,id:w.id,addr:w.addr}}));return out})()`);
    assert.ok(t, 'nessun fader nel layout di prova');
    await p.ev(`document.querySelector('#editBtn').click();1`); await sleep(300);
    await p.ev(`document.querySelectorAll('#tabs > *')[${t.pi}].click();1`); await sleep(300);
    const c = await p.ev(`(()=>{const r=document.querySelector('[data-id="${t.id}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await sleep(300);
    assert.ok(await p.ev(`!!document.querySelector('#fMidiLearn')`), 'manca "Impara MIDI" nell\'ispettore del fader');
    await p.ev(`document.querySelector('#fMidiLearn').click();1`);
    midi('noteon', { channel: 1, note: 40, velocity: 100 });   // una nota: un fader non la impara
    await sleep(200);
    midi('cc', { channel: 1, controller: 21, value: 10 });
    await sleep(400);
    const map = await p.ev(`window.__planciaTest.L.pages.flatMap(p=>p.widgets).find(w=>w.id==='${t.id}').midi`);
    assert.deepEqual({ ch: map.ch, cc: map.cc }, { ch: 2, cc: 21 }, 'mappatura imparata: ' + JSON.stringify(map));
    assert.ok(/CC 21 · canale 2/.test(await p.ev(`document.querySelector('#fMidiMap').textContent`)));
    console.log('ok     Impara MIDI sul fader: CC 21 canale 2 (la nota e\' stata ignorata)');
    await p.ev(`document.querySelector('#editBtn').click();1`);
    await sleep(800);   // il layout con la mappatura arriva al bridge

    // il controller muove il fader: lo esegue il bridge, la pagina lo vede
    seen.length = 0;
    midi('cc', { channel: 1, controller: 21, value: 127 });
    await sleep(500);
    const sent = seen.find(m => m.address === t.addr);
    assert.ok(sent, 'il bridge non ha eseguito il CC: ' + JSON.stringify(seen));
    const v = await p.ev(`window.__planciaTest.L.pages.flatMap(p=>p.widgets).find(w=>w.id==='${t.id}').value`);
    assert.equal(v, 1, 'il fader nella pagina non si e\' mosso');
    console.log(`ok     CC 21 = 127 -> ${t.addr} ${sent.args[0]} dal bridge, fader in cima nella pagina`);

    // PANIC dalle impostazioni
    await p.ev(`window.__planciaTest.openSheet();1`); await sleep(200);
    await p.ev(`document.querySelector('[data-midi-learn="panic"]').click();1`);
    midi('noteon', { channel: 0, note: 60, velocity: 127 });
    await sleep(400);
    assert.deepEqual(await p.ev(`window.__planciaTest.L.midiActions.panic`), { ch: 1, cc: '', note: 60 });
    assert.ok(/Nota 60/.test(await p.ev(`document.querySelector('[data-midi-map="panic"]').textContent`)));
    midi('noteoff', { channel: 0, note: 60, velocity: 0 });
    await sleep(800);
    seen.length = 0;
    midi('noteon', { channel: 0, note: 60, velocity: 127 });
    await sleep(400);
    assert.ok(seen.some(m => m.address === '/dmx/blackout' && m.args[0] === 1), 'PANIC: blackout non mandato: ' + JSON.stringify(seen));
    console.log('ok     PANIC imparato (nota 60) e premuto: /dmx/blackout 1 dal bridge');
    assert.deepEqual(p.problems, []);
  } finally { ctl.close(); p.close(); }
})().catch(e => { console.error('MIDI in:', e.message); process.exitCode = 1; });
