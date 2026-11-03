'use strict';
// Progetto di prova (src/99-demo-project.js): si crea dal modello e ogni cosa che
// nomina esiste. La pagina gira in simulazione: niente esce verso DMX Master.
const { startPlancia, sleep } = require('./browser-harness');

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const r = JSON.parse(await p.ev(`(()=>{const T=window.__planciaTest;
      T.G.devices['td-dmx-win']={...(T.G.devices['td-dmx-win']||{}),params:{...(T.G.devices['td-dmx-win']?.params||{}),heads_motion_state:{source:'off'},dmx_effects_state:{live:[]},
        show_scene_catalog:['base','colore_rosso','colore_blu','pal_magenta_cyan','pal_forest','pal_deep_purple','teste_pubblico','teste_cielo','strobo_on','strobo_off'].map((id,index)=>({id,index,label:id,categories:id.startsWith('teste')?['heads']:id.startsWith('strobo')?['strobe']:id==='base'?['rigs','heads']:['rigs']}))}};
      const L=T.demoProjectLayout();T.L=L;T.render();
      const w=L.pages.flatMap(p=>p.widgets).find(x=>x.type==='timeline'&&x.addr==='/show'&&!x.readonly);
      const doc=T.timelineToTD(w).doc;return JSON.stringify({L,doc})})()`));
    const { L, doc } = r;
    const dmx = L.fixtures.filter(f => f.address > 0), types = new Set(L.fixtures.map(f => f.type));
    check(['mh', 'par', 'bar', 'blinder', 'haze', 'wall', 'screen', 'projector', 'speaker', 'laser'].every(t => types.has(t)), `rig con ogni tipo di luce: ${[...types].join(', ')}`);
    const size = { 'D+RGB 4CH': 4, 'Dimmer 1CH': 1, 'Haze 2CH': 2, 'Wecam Moving Head 30W 11ch': 11 };
    const spans = dmx.map(f => [f.address, f.address + size[f.model] - 1, f.name]).sort((a, b) => a[0] - b[0]);
    check(spans.every((s, i) => !i || s[0] > spans[i - 1][1]), `nessun indirizzo sovrapposto (${spans.length} luci, fino a ${spans.at(-1)[1]})`);
    check(L.fixtures.filter(f => f.group === 'front').map(f => f.unit).join() === '1,2,3,4' && L.fixtures.filter(f => f.group === 'back').every(f => f.unit === 1), 'front indipendenti, back a specchio');
    const projector = L.fixtures.find(f => f.type === 'projector');
    check(L.fixtures.some(f => f.id === projector.target), 'il proiettore punta allo schermo');

    const has = (list, id) => list.some(x => x.id === id);
    check(L.chaseTimeline.cues.every(c => c.chase === 'off' || has(L.chases, c.chase)), 'SEQUENZE: i chase esistono');
    check(L.fxTimeline.cues.every(c => c.effects.every(id => has(L.lightFx, id))), 'EFFETTI: gli effetti esistono');
    check(L.headTimeline.cues.every(c => c.scene === 'off' || has(L.headMotions, c.scene)), 'TESTE MOV.: i movimenti esistono');
    check(L.laserTimeline.cues.every(c => !c.scene || has(L.laserScenes, c.scene)), 'LASER: le scene esistono');
    check(!L.videoTimeline.active && !L.laserTimeline.active && !L.headTimeline.active, 'video, laser e movimento su OPS partono in LIVE');

    const groups = new Set(L.groups.map(g => g.group));
    check(L.lightFx.every(f => groups.has(f.target.group)) && dmx.every(f => groups.has(f.group)), 'effetti e luci usano gruppi del progetto');
    const laser = L.laserScenes;
    check(has(laser, 'demo-testo') && laser.find(s => s.id === 'demo-testo').strokes.length > 2, 'laser: scena di testo');
    check(laser.find(s => s.id === 'demo-frame').frames.length === 12 && laser.find(s => s.id === 'demo-tempo').tempo.sync, 'laser: animazione a frame e scena a tempo');

    check(doc.cues.filter(c => String(c.label).startsWith('⟳')).length > 10, `verso DMX Master: ${doc.cues.length} cue, chase compresi`);
    check(doc.motion.cues.length === 7 && doc.effects.cues.length === 6, 'verso DMX Master: tracce movimento ed effetti');
    check(new Set(doc.cues.map(c => c.time)).size === doc.cues.length, 'nessuna cue allo stesso istante');
    check(doc.effects.effects.every(f => !f.template) && doc.motion.scenes.every(s => !s.template), 'niente campi interni della Plancia verso TD');

    // ogni pagina si apre senza errori
    const names = await p.ev(`[...document.querySelectorAll('#tabs > *')].map(x=>x.textContent)`);
    for (let i = 0; i < names.length; i++) { await p.ev(`document.querySelectorAll('#tabs > *')[${i}].click()`); await sleep(250); }
    check(names.length >= 15, `${names.length} pagine aperte`);
    const kinds = await p.ev(`(async()=>{[...document.querySelectorAll('#tabs > *')].find(x=>x.textContent==='Timeline').click();await new Promise(z=>setTimeout(z,300));return [...document.querySelectorAll('.tl-tracks .tl-trk .k')].map(k=>k.textContent)})()`);
    check(kinds.length === 7, `pagina Timeline, tutte le tracce: ${kinds.join(', ')}`);
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally { p.close(); }
  if (fail.length) { console.error(`demo-project: ${fail.length} errori`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
