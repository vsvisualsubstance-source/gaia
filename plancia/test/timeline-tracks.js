'use strict';
// Tracce della timeline nel browser (src/43-timeline-tracks.js): ogni traccia si usa
// allo stesso modo. Niente esce verso DMX Master: la pagina gira in simulazione.
//   node test/timeline-tracks.js [--shot file.png]
const { startPlancia, sleep } = require('./browser-harness');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

const CATALOG = JSON.stringify([
  { id: 'rosso', index: 0, label: 'Rosso', categories: ['rigs'] }, { id: 'blu', index: 1, label: 'Blu', categories: ['rigs'] },
  { id: 'pos_a', index: 2, label: 'Pubblico', categories: ['heads'] }, { id: 'pos_b', index: 3, label: 'Cielo', categories: ['heads'] }]);

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const ev = s => p.ev(s);
  // tocco a una frazione della traccia (o sul blocco k), poi eventuale scelta
  const tap = (trk, f) => ev(`(()=>{const l=document.querySelector('${trk}');if(!l)return 'manca';const r=l.getBoundingClientRect();
    l.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width*${f},clientY:r.top+5}));return 'ok'})()`);
  const tapBlock = trk => ev(`(()=>{const b=document.querySelector('${trk} [data-ci],${trk} .tl-blk');if(!b)return 'manca';const r=b.getBoundingClientRect(),x=r.left+4,o={bubbles:true,clientX:x,clientY:r.top+3,pointerId:1};
    b.dispatchEvent(new PointerEvent('pointerdown',o));const w=b.closest('.w')||b.closest('[data-id]');const up=new PointerEvent('pointerup',o);(b.closest('.tl').parentElement).dispatchEvent(up);
    let e=b;while(e){if(e.onpointerup){e.onpointerup(up);break}e=e.parentElement}return 'ok'})()`);
  const choose = label => ev(`(()=>{const b=[...document.querySelectorAll('.ui-choose button')].find(x=>x.textContent==='${label}');if(!b)return 'manca ${label}';b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 'ok'})()`);
  const choices = () => ev(`[...document.querySelectorAll('.ui-choose button')].map(b=>b.textContent)`);
  const ok = () => ev(`document.querySelector('.ui-confirm [data-ok]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  const goto = name => ev(`[...document.querySelectorAll('#tabs > *')].find(x=>x.textContent.trim()==='${name}').click()`);
  const L = path => ev(`JSON.stringify(window.__planciaTest.L.${path})`).then(s => s == null ? null : JSON.parse(s));
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await ev(`(()=>{const T=window.__planciaTest;T.G.devices['td-dmx-win']={...(T.G.devices['td-dmx-win']||{}),params:{...(T.G.devices['td-dmx-win']?.params||{}),show_scene_catalog:${CATALOG}}};
      T.L.chases=[{id:'c1',name:'Giro',steps:[{scene:'rosso'},{scene:'blu'}],hold:{value:4,unit:'beats'},fadePct:50}];return 1})()`);

    // ogni pagina mostra le sue tracce
    await goto('Sequenze ed effetti'); await sleep(400);
    const kinds = () => ev(`[...document.querySelectorAll('.tl-tracks .tl-trk .k')].map(k=>k.textContent)`);
    const k1 = await kinds(); check(k1.includes('SEQUENZE') && k1.includes('EFFETTI') && !k1.includes('TESTE MOV.'), `pagina Sequenze ed effetti: ${k1.join(', ')}`);
    await goto('Teste · movimento'); await sleep(400);
    const k2 = await kinds(); check(k2.includes('TESTE POS.') && k2.includes('TESTE MOV.') && !k2.includes('SEQUENZE'), `pagina Teste: ${k2.join(', ')}`);

    // TESTE POS.: tocco = posizione, con le scene di sole teste
    await tap('.tl-hlane', 0.5); await sleep(200);
    const c0 = await choices();
    check(c0.includes('Pubblico') && c0.includes('Cielo') && !c0.includes('Rosso'), `TESTE POS. offre le scene teste: ${c0.join(' / ')}`);
    await choose('Cielo'); await sleep(300);
    const blk = () => ev(`[...document.querySelectorAll('.tl-hlane .tl-blk em')].map(e=>e.textContent)`);
    check((await blk()).includes('pos_b'), `TESTE POS.: nasce il blocco ${(await blk()).join()}`);

    // la timeline e' la stessa in tutte le pagine
    const shows = await ev(`[...new Set(window.__planciaTest.L.pages.flatMap(p=>p.widgets).filter(w=>w.type==='timeline'&&w.addr==='/show').map(w=>w.cues+'|'+w.duration))].length`);
    check(shows === 1, `una sola timeline dello show in tutte le pagine (${shows})`);

    // SEQUENZE: tocco, poi su un blocco si cambia e si toglie
    await goto('Sequenze ed effetti'); await sleep(400);
    check(await ev(`document.querySelector('.tl-cst').textContent`) === 'tocca qui per far partire un chase', 'SEQUENZE vuota dice cosa fare');
    await tap('[data-trk="chase"]', 0.25); await sleep(200); await choose('Giro'); await sleep(300);
    let cues = (await L('chaseTimeline')).cues;
    check(cues.length === 1 && cues[0].chase === 'c1', `SEQUENZE: cue a ${cues[0]?.time}`);
    await tapBlock('[data-trk="chase"]'); await sleep(200);
    check((await choices()).includes('Togli questa cue'), 'SEQUENZE: tocco sul blocco offre di togliere');
    await choose('Togli questa cue'); await sleep(300);
    check((await L('chaseTimeline')).cues.length === 0, 'SEQUENZE: cue tolta');

    // EFFETTI: scelta multipla
    await tap('[data-trk="fx"]', 0.5); await sleep(200);
    const names = await choices();
    await choose(names[0]); await choose(names[1]); await ok(); await sleep(300);
    cues = (await L('fxTimeline')).cues;
    check(cues.length === 1 && cues[0].effects.length === 2, `EFFETTI: due effetti insieme (${cues[0]?.effects})`);

    // trascinamento: il blocco si sposta e resta nella traccia
    const t0 = cues[0].time;
    await ev(`(()=>{const l=document.querySelector('[data-trk="fx"]'),b=l.querySelector('[data-ci]'),r=b.getBoundingClientRect(),W=l.getBoundingClientRect().width;
      const o=(x)=>({bubbles:true,clientX:x,clientY:r.top+3,pointerId:1});b.dispatchEvent(new PointerEvent('pointerdown',o(r.left+4)));
      let e=b;while(e&&!e.onpointermove)e=e.parentElement;e.onpointermove(new PointerEvent('pointermove',o(r.left+4+W*.1)));e.onpointerup(new PointerEvent('pointerup',o(r.left+4+W*.1)));return 1})()`);
    await sleep(300);
    const t1 = (await L('fxTimeline')).cues[0].time;
    check(t1 > t0, `EFFETTI: trascinato da ${t0} a ${t1}`);

    // scelta delle tracce: LASER compare; una traccia con cue non si puo' nascondere
    await ev(`document.querySelector('[data-act="tracks"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`); await sleep(200);
    check(await ev(`[...document.querySelectorAll('.ui-choose button')].find(x=>x.textContent==='Effetti luci').disabled`), 'Tracce: quella con cue resta visibile');
    await choose('Laser'); await ok(); await sleep(300);
    check((await kinds()).includes('LASER'), `Tracce: aggiunta ${(await kinds()).join(', ')}`);

    // VIDEO/LASER: il loro editor con la cue nuova gia' al suo posto
    await tap('[data-trk="laser"]', 0.5); await sleep(300);
    check(await ev(`document.querySelectorAll('.lcue-row').length`) === 1, 'LASER: tocco apre il suo editor con la cue nuova');
    await ev(`document.querySelector('#lcClose').click()`); await sleep(200);

    // gruppi: nella barra i gruppi, sotto le pagine del gruppo; ogni gruppo ricorda l'ultima pagina
    const groupClick = n => ev(`[...document.querySelectorAll('#groups > *')].find(x=>x.textContent==='${n}').click()`);
    const visible = () => ev(`[...document.querySelectorAll('#tabs > *')].filter(x=>!x.hidden).map(x=>x.textContent)`);
    const groups = await ev(`[...document.querySelectorAll('#groups > *')].map(x=>x.textContent)`);
    check(groups.length <= 7 && groups.includes('Luci') && groups.includes('Sistema'), `gruppi: ${groups.join(', ')}`);
    check(await ev(`[...document.querySelectorAll('#groups > *')].every(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.right<=innerWidth})`), 'tutti i gruppi si vedono a 1280 px');
    await groupClick('Teste'); await sleep(300);
    check((await visible()).join() === 'Teste mobili,Teste · movimento', `gruppo Teste: ${(await visible()).join(', ')}`);
    await goto('Teste · movimento'); await sleep(300); await groupClick('Laser'); await sleep(300);
    check(await ev(`getComputedStyle(document.querySelector('#tabs')).display`) === 'none', 'gruppo con una pagina sola: nessuna riga sotto');
    await groupClick('Teste'); await sleep(300);
    check(await ev(`[...document.querySelectorAll('#tabs > *')].find(x=>x.getAttribute('aria-current')==='true').textContent`) === 'Teste · movimento', 'il gruppo torna all\'ultima pagina vista');

    // Palco: comandi principali e menu Strumenti con le stesse azioni di prima
    await goto('Palco'); await sleep(400);
    const seg = await ev(`[...document.querySelectorAll('.seg > button')].map(b=>b.textContent.trim())`);
    check(seg.length <= 5 && seg.some(x => x.includes('Strumenti')), `barra del Palco: ${seg.join(' · ')}`);
    await ev(`document.querySelector('.seg [data-act="more"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`); await sleep(200);
    const tools = await choices();
    check(tools.length >= 8 && tools.some(x => x.includes('Modelli')), `Strumenti: ${tools.length} voci`);
    await choose(tools.find(x => x.includes('Modelli'))); await sleep(400);
    check(await ev(`!document.querySelector('#scrim').hidden`), 'Strumenti: Modelli apre il suo editor');
    await ev(`document.querySelector('#scrim button.ghost')?.click()`); await sleep(200);

    // nessuna finestra del browser: confirm e prompt falliscono se chiamati
    await ev(`(()=>{window.confirm=window.prompt=()=>{throw new Error('finestra del browser')};return 1})()`);
    await goto('Laser'); await sleep(300);

    await goto('Sequenze ed effetti'); await sleep(400);
    const shot = arg('--shot'); if (shot) await p.shot(shot);
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 200)}`);
  } finally { p.close(); }
  if (fail.length) { console.error(`timeline-tracks: ${fail.length} errori`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
