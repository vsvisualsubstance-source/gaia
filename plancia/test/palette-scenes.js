'use strict';
// Scene dalle palette e timeline piu' chiara, nel browser headless con un
// DMX Master finto: status, dmx_matrix e show_scenes veri (test/fixtures/
// td-dmx-win.json, senza IP), comandi "set" dalla simulazione della Plancia,
// cattura delle scene risposta qui. Nessun messaggio esce verso TD.
//   node test/palette-scenes.js   (incluso in npm run check)

const assert = require('assert');
const { startPlancia, sleep } = require('./browser-harness');
const TD = require('./fixtures/td-dmx-win.json');

(async () => {
  const p = await startPlancia({ hooks: true });
  try {
    // DMX Master finto: dati veri, timeline attiva, palette di partenza note
    await p.ev(`(()=>{const T=window.__planciaTest,td=${JSON.stringify(TD)};
      for(const[t,m]of Object.entries(td))T.gIn(t,JSON.parse(JSON.stringify(m)));
      const d=T.G.devices['td-dmx-win'];d.ts=Date.now();d.services={...(d.services||{}),show_active:'active'};
      for(const k of Object.keys(d.params))if(/^dmx_.+_palette$/.test(k))d.params[k]='Neon Party';
      // una pal_warm vecchia, fatta con il look dei rig e usata in una cue
      d.params.show_scene_catalog=[...(d.params.show_scene_catalog||[]).filter(s=>s.id!=='pal_warm'),
        {id:'pal_warm',index:99,label:'Warm',categories:['rigs','palette'],cues:[2]}];
      // come TD (nota 52): la cattura riscrive i valori ma su una scena che
      // esiste lascia le categorie; show_scene_update le cambia
      setInterval(()=>{const cat=d.params.show_scene_catalog;
        const u=d.params.show_scene_update;if(u){delete d.params.show_scene_update;const s=cat.find(x=>x.id===u.name);if(s)s.categories=u.categories;d.ts=Date.now()}
        const q=d.params.show_scene_capture;if(!q)return;delete d.params.show_scene_capture;
        const old=cat.find(s=>s.id===q.name),pal=Object.fromEntries(Object.entries(d.params).filter(([k])=>/_palette$/.test(k)));
        if(old)Object.assign(old,{palettes:pal});else cat.push({id:q.name,index:cat.length,label:q.label||q.name,categories:q.categories,cues:[],palettes:pal});
        d.ts=Date.now()},100);
      window.confirm=()=>true;return T.G.sim})()`);
    const rigs = await p.ev(`Object.keys(window.__planciaTest.G.devices['td-dmx-win'].params).filter(k=>/^dmx_.+_palette$/.test(k))`);
    assert.ok(rigs.length >= 2, 'nessuna palette dei rig nei dati di DMX Master');

    // editor scene: sezione "Scene dalle palette"
    await p.ev(`window.__planciaTest.openSceneEditor();1`);
    const offered = await p.ev(`[...document.querySelectorAll('.sp-pal')].map(x=>x.value)`);
    assert.ok(offered.includes('Warm') && offered.includes('Fire'), 'palette non offerte: ' + offered.join(', '));
    assert.ok(!offered.includes('Custom'), 'Custom non e\' un template');
    console.log(`ok     editor scene: ${offered.length} palette, ${rigs.length} rig`);

    await p.ev(`(()=>{for(const x of document.querySelectorAll('.sp-pal'))x.checked=['Warm','Fire'].includes(x.value);document.querySelector('#spBuild').click();return 1})()`);
    let done = false;
    for (let i = 0; i < 100 && !done; i++) { await sleep(200); done = await p.ev(`!document.querySelector('#spBuild')||!document.querySelector('#spBuild').disabled`); }
    const r = await p.ev(`(()=>{const d=window.__planciaTest.G.devices['td-dmx-win'];
      return{cat:d.params.show_scene_catalog.filter(s=>/^pal_/.test(s.id)),pal:Object.fromEntries(Object.entries(d.params).filter(([k])=>/^dmx_.+_palette$/.test(k))),active:d.services.show_active}})()`);
    const warm = r.cat.find(s => s.id === 'pal_warm'), fire = r.cat.find(s => s.id === 'pal_fire');
    assert.ok(warm && fire, 'scene palette non create: ' + JSON.stringify(r.cat.map(s => s.id)));
    assert.deepEqual(warm.categories, ['palette'], 'pal_warm vecchia non portata alla sola categoria palette');
    assert.deepEqual(fire.categories, ['palette']);
    assert.ok(rigs.every(k => warm.palettes[k] === 'Warm' && fire.palettes[k] === 'Fire'), 'la scena non ha fotografato la sua palette su tutti i rig');
    assert.ok(Object.values(r.pal).every(v => v === 'Neon Party'), 'palette di prima non rimesse: ' + JSON.stringify(r.pal));
    assert.equal(r.active, 'active', 'timeline non riaccesa');
    console.log('ok     pal_warm (vecchia, con rigs) e pal_fire catturate solo palette, palette e timeline rimesse come prima');

    // menu della cue: gruppi per tipo, le palette in "Colore"
    const groups = await p.ev(`(()=>{const d=document.createElement('div');d.innerHTML=window.__planciaTest.cueSceneFields('@pal_warm',0);
      return[...d.querySelectorAll('optgroup')].map(g=>[g.label,[...g.children].map(o=>o.value)])})()`);
    const color = groups.find(([l]) => /^Colore/.test(l));
    assert.ok(color && color[1].includes('@pal_warm') && color[1].includes('@colore_rosso'), 'gruppo Colore: ' + JSON.stringify(groups));
    assert.ok(groups.some(([l, v]) => /^Teste/.test(l) && v.includes('@teste_pubblico')), 'gruppo Teste mancante');
    console.log('ok     menu cue: ' + groups.map(([l, v]) => `${l.split(' ')[0]} ${v.length}`).join(' · '));
    assert.deepEqual(p.problems, []);
  } finally { p.close(); }
})().catch(e => { console.error('scene palette:', e.message); process.exitCode = 1; });
