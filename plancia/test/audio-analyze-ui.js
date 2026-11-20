'use strict';
// Analisi dei brani dalla Plancia (20/11): pulsante "Analizza…" della Libreria, cartella musica in piu'
// scelta sfogliando le cartelle di OPS, avanzamento e libreria ricaricata. Musica e cache di prova,
// motore vero (gaia-audio.exe analyze); salta se il motore non e' compilato.
//   node test/audio-analyze-ui.js

const fs = require('fs');
const path = require('path');
const EXE = path.join(__dirname, '..', '..', 'audio-engine', 'target', 'release', 'gaia-audio.exe');

function clickWav(file) {
  const rate = 22050, n = rate * 8, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) { const t = (i % (rate / 2)) / rate; data.writeInt16LE(Math.round(Math.exp(-t * 40) * Math.sin(2 * Math.PI * 60 * t) * 20000), i * 2); }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

async function main() {
  if (!fs.existsSync(EXE)) { console.log('analisi: saltato (gaia-audio.exe non compilato)'); return; }
  // sotto test-output (non in %TEMP%, troppe cartelle da sfogliare): C:\gaia\plancia\test-output\ana-ui
  const base = path.join(__dirname, '..', 'test-output', 'ana-ui');
  fs.rmSync(base, { recursive: true, force: true });
  const MUSIC = path.join(base, 'musica'), CACHE = path.join(base, 'cache'), USB = path.join(base, 'usb');
  clickWav(path.join(MUSIC, 'Beat', 'uno.wav'));
  clickWav(path.join(USB, 'Set', 'due.wav'));
  clickWav(path.join(USB, 'Set', 'tre.wav'));
  fs.mkdirSync(CACHE, { recursive: true });
  Object.assign(process.env, { GAIA_MUSIC: MUSIC, AUDIO_CACHE: CACHE, GAIA_AUDIO_EXE: EXE, AUDIO_ENGINE_URL: 'ws://127.0.0.1:9' });
  const { startPlancia, sleep } = require('./browser-harness');
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const H = `const T=window.__planciaTest,z=ms=>new Promise(r=>setTimeout(r,ms)),down=el=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const labels=()=>[...document.querySelectorAll('.ui-choose button')].map(b=>b.textContent);
    const choose=async t=>{await z(400);const b=[...document.querySelectorAll('.ui-choose button')].find(x=>x.textContent.startsWith(t));if(b)down(b);else{const x=document.querySelector('.ui-confirm [data-x]');if(x)down(x)}await z(300);return!!b};
    const confirm=async ok=>{await z(300);const b=document.querySelector('.ui-confirm [data-v="'+(ok?1:0)+'"]');if(b)down(b);await z(300);return!!b};
    const prompt=async v=>{await z(300);const i=document.querySelector('.ui-confirm input');i.value=v;down(document.querySelector('.ui-confirm [data-ok]'));await z(400)};
    const until=async(f,ms=30000)=>{const t0=Date.now();while(Date.now()-t0<ms){if(f())return true;await z(200)}return false};`;
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await p.ev(`(()=>{const t=window.__planciaTest;t.L.pages.push(...t.TPL.consoleaudio.pages());t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    await sleep(1500);
    const empty = await p.ev(`window.__planciaTest.AU.libState`);
    check(/Analizza/.test(empty), `libreria vuota: "${empty}"`);
    // 1. cartella principale: menu, poi "solo i nuovi"
    const r1 = JSON.parse(await p.ev(`(async()=>{${H}
      down(document.querySelector('[data-au=analyze]'));await z(800);const menu=labels();
      await choose('Musica (principale)');const how=labels();await choose('Solo i brani nuovi');
      const ok=await until(()=>T.G.audioAnalyze&&!T.G.audioAnalyze.running&&T.AU.tracks.length===1);
      return JSON.stringify({menu,how,ok,st:T.G.audioAnalyze,n:T.AU.tracks.length})})()`));
    check(r1.menu.some(l => /Musica \(principale\): 0 di 1 analizzati/.test(l)) && r1.menu.some(l => /Aggiungi cartella/.test(l)), `menu: ${r1.menu.join(' | ')}`);
    check(r1.how[0] === 'Solo i brani nuovi o cambiati (1)', `scelta: ${r1.how.join(' | ')}`);
    check(r1.ok && r1.st.analyzed === 1, `analizzato e libreria ricaricata: ${r1.n} brani, ${JSON.stringify(r1.st && { n: r1.st.n, tot: r1.st.tot, analyzed: r1.st.analyzed, failed: r1.st.failed })}`);
    // 2. cartella USB: sfoglia C:\ -> ... -> usb, "Usa", nome, analizza subito
    const segs = path.resolve(USB).split(path.sep).filter(Boolean);
    segs[0] = segs[0].toUpperCase();   // i dischi sono elencati in maiuscolo (C:\)
    const r2 = JSON.parse(await p.ev(`(async()=>{${H}
      down(document.querySelector('[data-au=analyze]'));await z(800);const m0=labels();const add=await choose('＋ Aggiungi');await z(600);const m1=labels();
      if(!m1.length)return JSON.stringify({walk:[add],labels:['m0',...m0,'m1',...m1,'msg',document.querySelector('#toast,.toast,.err,[role=alert],[role=status]')?.textContent||'']});
      const segs=${JSON.stringify(segs)},walk=[];
      walk.push(await choose(segs[0]+'\\\\'));
      for(const s of segs.slice(1))walk.push(await choose(s));
      const use=labels()[0];if(!walk.every(Boolean))return JSON.stringify({walk,labels:labels().slice(0,20)});await choose('✓ Usa');await prompt('Chiavetta');await confirm(true);
      const ok=await until(()=>T.AU.tracks.length===3&&T.G.audioAnalyze&&!T.G.audioAnalyze.running);
      return JSON.stringify({walk,use,ok,n:T.AU.tracks.length,folders:[...new Set(T.AU.tracks.map(t=>t.folder))]})})()`));
    check(r2.walk.every(Boolean), `sfogliato fino alla cartella (${r2.walk.join()}) ${r2.labels ? r2.labels.join(" | ") : ""}`); if (r2.labels) throw new Error("sfoglia");
    check(r2.ok && r2.n === 3, `cartella aggiunta e analizzata: ${r2.n} brani, cartelle ${r2.folders.join(' | ')}`);
    const roots = JSON.parse(fs.readFileSync(path.join(CACHE, 'music-roots.json'), 'utf8')).roots;
    check(roots.length === 1 && roots[0].name === 'Chiavetta', `salvata in music-roots.json: ${JSON.stringify(roots)}`);
    // 3. menu con la cartella in piu'; analisi in corso -> il pulsante la ferma
    const r3 = JSON.parse(await p.ev(`(async()=>{${H}
      down(document.querySelector('[data-au=analyze]'));await z(800);const menu=labels();
      const x=document.querySelector('.ui-confirm [data-x]');if(x)down(x);await z(300);return JSON.stringify({menu})})()`));
    check(r3.menu.some(l => l === 'Chiavetta: 2 di 2 analizzati') && r3.menu.some(l => /Togli una cartella/.test(l)), `menu: ${r3.menu.join(' | ')}`);
    // 4. disco staccato: brani grigi, niente A/B
    fs.renameSync(USB, USB + '-via');
    const r4 = JSON.parse(await p.ev(`(async()=>{${H}
      down(document.querySelector('[data-au=libreload]'));await until(()=>T.AU.tracks.some(t=>t.offline),5000);await z(600);
      const rows=[...document.querySelectorAll('.au-libtab tbody tr')];
      return JSON.stringify({off:T.AU.tracks.filter(t=>t.offline).length,miss:rows.filter(r=>r.classList.contains('au-miss')).length,loadBtns:rows.map(r=>r.querySelectorAll('[data-au=load]').length)})})()`));
    fs.renameSync(USB + '-via', USB);
    check(r4.off === 2 && r4.miss === 2 && r4.loadBtns.filter(n => n === 0).length === 2, `disco staccato: ${JSON.stringify(r4)}`);
    await p.shot(path.join(__dirname, '..', 'test-output', 'audio-analyze.png'));
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally {
    p.close();
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* windows */ }
  }
  if (fail.length) { console.error(`analisi: ${fail.length} errori`); process.exit(1); }
}
main().catch(e => { console.error('analisi: prova fallita:', e.message); process.exit(2); });
