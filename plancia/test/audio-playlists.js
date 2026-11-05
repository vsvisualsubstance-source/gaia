'use strict';
// Playlist della Console Audio (src/52-audio-console.js + audio-lib.js): crea,
// aggiungi brani, sposta, togli, rinomina; il bridge le salva in
// <cache>/playlists.json e le rimanda a tutti i tablet. Su una copia della cache.
// Salta senza analisi in cache.
//   node test/audio-playlists.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const CACHE = process.env.AUDIO_CACHE || path.join(__dirname, '..', '..', 'audio-engine', 'cache');
const { startPlancia, sleep } = require('./browser-harness');

async function main() {
  if (!fs.existsSync(CACHE) || !fs.readdirSync(CACHE).some(n => n.endsWith('.json'))) {
    console.log(`playlist: saltato (nessuna analisi in ${CACHE})`);
    return;
  }
  const tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'plancia-pl-'));
  for (const n of fs.readdirSync(CACHE)) if (n.endsWith('.json') && !n.endsWith('.cues.json') && n !== 'playlists.json') fs.copyFileSync(path.join(CACHE, n), path.join(tmpCache, n));
  process.env.AUDIO_CACHE = tmpCache;
  process.env.AUDIO_ENGINE_URL = 'ws://127.0.0.1:9';
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const file = () => { try { return JSON.parse(fs.readFileSync(path.join(tmpCache, 'playlists.json'), 'utf8')).playlists; } catch { return null; } };
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.pages.push(...t.TPL.consoleaudio.pages());t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    let n = 0;
    for (let i = 0; i < 20 && !n; i++) { await sleep(300); n = await p.ev('window.__planciaTest.AU.tracks.length'); }
    const H = `const T=window.__planciaTest,z=ms=>new Promise(r=>setTimeout(r,ms)),down=el=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      const choose=async t=>{await z(250);const b=[...document.querySelectorAll('.ui-choose button')].find(x=>x.textContent.startsWith(t));if(b)down(b);await z(300);return!!b};
      const prompt=async v=>{await z(250);const i=document.querySelector('.ui-confirm input');i.value=v;down(document.querySelector('.ui-confirm [data-v="1"],.ui-confirm [data-ok]'));await z(400)};`;
    // nuova playlist, poi 3 brani dalla libreria con ＋
    const ids = JSON.parse(await p.ev(`(async()=>{${H}
      down(document.querySelector('[data-au=plnew]'));await prompt('Apertura');
      const view=T.AU.lib.view;T.AU.lib.view='';await z(400);
      const ids=T.AU.tracks.slice(0,3).map(t=>t.id);
      for(const id of ids){down(document.querySelector('[data-au=pladd][data-id="'+id+'"]'));await choose('Apertura')}
      // lo stesso brano due volte: non si duplica
      down(document.querySelector('[data-au=pladd][data-id="'+ids[0]+'"]'));await choose('Apertura');
      T.AU.lib.view=view;await z(500);return JSON.stringify({ids,view})})()`));
    await sleep(500);
    let pl = file();
    check(pl && pl.length === 1 && pl[0].name === 'Apertura' && pl[0].tracks.join() === ids.ids.join(), `playlist salvata dal bridge con 3 brani in ordine (${pl?.[0]?.tracks.length})`);
    const rows = await p.ev(`[...document.querySelectorAll('.au-libtab tbody tr')].length`);
    const opt = await p.ev(`document.querySelector('[data-au-s=view]').selectedOptions[0]?.textContent||''`);
    check(rows === 3 && opt.includes('Apertura (3)'), `vista playlist: ${rows} righe, menu "${opt}"`);
    // giù il primo, togli l'ultimo, rinomina
    await p.ev(`(async()=>{${H}
      down(document.querySelector('[data-au=pldown][data-i="0"]'));await z(500);
      down(document.querySelector('[data-au=plrm][data-i="2"]'));await z(500);
      down(document.querySelector('[data-au=plmenu]'));await choose('Rinomina');await prompt('Apertura show');return 1})()`);
    await sleep(500);
    pl = file();
    check(pl?.[0]?.name === 'Apertura show' && pl[0].tracks.join() === [ids.ids[1], ids.ids[0]].join(), `spostato, tolto, rinominato: ${pl?.[0]?.name} ${pl?.[0]?.tracks.length} brani`);
    // un secondo tablet riceve le playlist alla connessione
    const p2 = await p.ev(`(async()=>{const ws=new WebSocket('ws://'+location.host);return await new Promise(r=>{ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='audio_playlists'){ws.close();r(m.playlists.map(x=>x.name).join())}};setTimeout(()=>r('nessuna'),3000)})})()`);
    check(p2 === 'Apertura show', `nuovo tablet: riceve "${p2}"`);
    // elimina
    await p.ev(`(async()=>{${H}down(document.querySelector('[data-au=plmenu]'));await choose('Elimina');await z(300);
      const ok=document.querySelector('.ui-confirm [data-v="1"]');if(ok)down(ok);await z(500);return 1})()`);
    await sleep(400);
    check(file()?.length === 0 && (await p.ev('window.__planciaTest.AU.lib.view')) === '', 'playlist eliminata, si torna a tutta la libreria');
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally {
    p.close();
    fs.rmSync(tmpCache, { recursive: true, force: true });
  }
  if (fail.length) { console.error(`playlist: ${fail.length} errori`); process.exit(1); }
}
main().catch(e => { console.error('playlist: prova fallita:', e.message); process.exit(2); });
