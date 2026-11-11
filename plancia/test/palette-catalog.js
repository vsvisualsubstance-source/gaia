'use strict';
// Catalogo palette (63-palette-catalog.js): elenco, nuova, rinomina, elimina con
// sostituzione, ordine. DMX Master finto che risponde come TD (nota OPS 59).
//   node test/palette-catalog.js [--shot file.png]   (incluso in npm run check)

const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const down = sel => p.ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return 0;b.click();return 1})()`);
  const choose = label => p.ev(`(()=>{const b=[...document.querySelectorAll('.ui-confirm [data-i]')].find(x=>x.textContent===${JSON.stringify(label)});if(!b)return 0;b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));return 1})()`);
  const names = () => p.ev(`[...document.querySelectorAll('.pal-row .pal-txt b')].map(b=>b.textContent).join('|')`);
  try {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    // DMX Master finto: catalogo nei params e comandi applicati con esito, come dmx_services
    await p.ev(`(()=>{const T=window.__planciaTest;
      const pal=(name,colors,o={})=>({name,colors,stepped:false,builtin:true,modified:false,used:{rigs:[],fixtures:0,scenes:0},...o});
      const params={dmx_palette_catalog:{v:1,default:'Warm',max_colors:8,name_max:32,builtin_missing:['Ocean'],palettes:[
        pal('Warm',[[1,0,0],[1,.35,0],[1,.67,0]],{used:{rigs:['ledbar'],fixtures:0,scenes:3}}),
        pal('Cool',[[0,0,1],[0,.55,1]],{modified:true}),
        pal('Basic 2',[[1,0,0],[0,0,1]],{stepped:true})]}};
      T.G.devices['td-dmx-win']={params,ts:Date.now()};
      window.__sent=[];
      T.palSend=(param,v)=>{window.__sent.push([param,v]);const c=params.dmx_palette_catalog,ps=c.palettes,ix=n=>ps.findIndex(x=>x.name===n);
        const ok=()=>params.dmx_palette_result={request_id:v.request_id,ok:true,errors:[],name:v.name};
        setTimeout(()=>{
          if(param==='dmx_palette_set'){const e={name:v.name,colors:v.colors,stepped:!!v.stepped,builtin:false,modified:false,used:{rigs:[],fixtures:0,scenes:0}};
            const i=ix(v.rename_from||v.name);if(i>=0)ps[i]={...ps[i],...e,builtin:ps[i].builtin&&!v.rename_from};else ps.push(e)}
          if(param==='dmx_palette_remove')ps.splice(ix(v.name),1);
          if(param==='dmx_palette_order')ps.sort((a,b)=>v.names.indexOf(a.name)-v.names.indexOf(b.name));
          ok()},150);return true};
      return 1})()`);
    await p.ev(`(()=>{window.__planciaTest.openPaletteCatalog();return 1})()`);
    await sleep(200);
    check(await names() === 'Warm|Cool|Basic 2', `catalogo: tre palette nell'ordine di DMX Master (${await names()})`);
    const row0 = await p.ev(`document.querySelector('.pal-row').textContent.replace(/\\s+/g,' ')`);
    check(/di partenza/.test(row0) && /3 scene/.test(row0) && /gruppi/.test(row0), `uso mostrato: scene e gruppi (${row0.trim().slice(0, 80)})`);
    check(await p.ev(`!!document.querySelector('[data-pal-i="1"] [data-pal-act="restore"]') && !document.querySelector('[data-pal-i="0"] [data-pal-act="restore"]')`), 'ripristina solo sulla palette di partenza modificata');
    check(/Ripristina quelle di partenza tolte \(1\)/.test(await p.ev(`document.querySelector('#palMissing')?.textContent||''`)), 'pulsante per ripristinare quelle di partenza tolte');
    // nuova palette: nome, a scatti, tre colori
    await down('#palNew'); await sleep(150);
    await p.ev(`(()=>{const n=document.querySelector('#peName');n.value='Tramonto';n.dispatchEvent(new Event('input'));return 1})()`);
    await down('[data-pe-mode="1"]'); await sleep(100);
    await p.ev(`(()=>{const c=document.querySelector('.pe-col input[type=color]');c.value='#00ff00';c.dispatchEvent(new Event('input'));return 1})()`);
    await down('#peSave'); await sleep(700);
    let sent = JSON.parse(await p.ev(`JSON.stringify(window.__sent.at(-1))`));
    check(sent[0] === 'dmx_palette_set' && sent[1].name === 'Tramonto' && sent[1].stepped === true && sent[1].colors.length === 3 && sent[1].colors[0][1] === 1 && !sent[1].rename_from,
      `nuova: comando dmx_palette_set con nome, scatti e 3 colori (${JSON.stringify(sent[1]).slice(0, 120)})`);
    check(await names() === 'Warm|Cool|Basic 2|Tramonto', `dopo la conferma torna al catalogo con la nuova (${await names()})`);
    check(/salvata in DMX Master/.test(await p.ev(`document.querySelector('.pal-msg').textContent`)), 'messaggio di conferma');
    // nome gia' usato: bloccato prima di mandare
    await down('[data-pal-i="3"] [data-pal-act="edit"]'); await sleep(150);
    await p.ev(`(()=>{const n=document.querySelector('#peName');n.value='Warm';n.dispatchEvent(new Event('input'));return 1})()`);
    const before = await p.ev(`window.__sent.length`);
    await down('#peSave'); await sleep(200);
    check(/Esiste già/.test(await p.ev(`document.querySelector('.pe-msg').textContent`)) && await p.ev(`window.__sent.length`) === before, 'nome già usato: avviso, niente inviato');
    // rinomina
    await p.ev(`(()=>{const n=document.querySelector('#peName');n.value='Tramonto 2';n.dispatchEvent(new Event('input'));return 1})()`);
    await down('#peSave'); await sleep(700);
    sent = JSON.parse(await p.ev(`JSON.stringify(window.__sent.at(-1))`));
    check(sent[1].rename_from === 'Tramonto' && sent[1].name === 'Tramonto 2', 'rinomina: rename_from col nome di prima');
    // ordine: Tramonto 2 su
    await down('[data-pal-i="3"] [data-pal-act="up"]'); await sleep(600);
    check(await names() === 'Warm|Cool|Tramonto 2|Basic 2', `ordine: su di un posto (${await names()})`);
    const shot = arg('--shot');
    if (shot) await p.shot(path.resolve(shot));
    // elimina una palette usata: chiede con cosa sostituirla
    await down('[data-pal-i="0"] [data-pal-act="del"]'); await sleep(200);
    const opts = await p.ev(`[...document.querySelectorAll('.ui-confirm [data-i]')].map(b=>b.textContent).join('|')`);
    check(opts === 'Cool|Tramonto 2|Basic 2', `elimina usata: sceglie la sostituta tra le altre (${opts})`);
    await choose('Cool'); await sleep(700);
    sent = JSON.parse(await p.ev(`JSON.stringify(window.__sent.at(-1))`));
    check(sent[0] === 'dmx_palette_remove' && sent[1].name === 'Warm' && sent[1].replace === 'Cool', 'comando remove con replace');
    check(await names() === 'Cool|Tramonto 2|Basic 2', `Warm tolta dal catalogo (${await names()})`);
    // pulsanti nelle pagine: Luci, Config rig, Scene
    await p.ev(`(()=>{document.querySelector('#scrim').hidden=true;return 1})()`);
    const src = await p.ev(`(()=>{const s=[...document.scripts].map(x=>x.src).find(x=>/app\\.js/.test(x));return s||''})()`);
    const app = await (await fetch(src)).text();
    check(/data-fg-palettes/.test(app) && /data-rc-act="palettes"/.test(app) && /id="smPalettes"/.test(app), 'pulsante 🎨 Palette in Luci, Config rig e ▣ Scene');
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('palette: prova fallita:', e.message); process.exitCode = 2; });
