'use strict';
// Widget Luci (94-console-widgets.js) con blocchi: 12 barre in 4 colonne da 3 (come
// le Color Pic di Lowtopic). Una tessera per blocco, ordine da sinistra a destra,
// Dispari/Pari per blocchi interi, Barre singole, ⊞ Blocco e Sciogli.
//   node test/fixgrid-blocks.js [--shot file.png]

const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  const down = sel => p.ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true})()`);
  const tiles = () => p.ev(`[...document.querySelectorAll('.fg-tile')].map(t=>t.querySelector('b').textContent.trim()+(t.classList.contains('on')?'*':t.classList.contains('part')?'~':''))`);
  const selected = () => p.ev(`(()=>{const t=window.__planciaTest,w=t.L.pages[t.L.pages.length-1].widgets[0];return[...document.querySelectorAll('.fg-tile.on')].length})()`);
  const answer = async v => { await sleep(150); await p.ev(`(()=>{const b=document.querySelector('.ui-confirm');b.querySelector('input').value=${JSON.stringify(v)};b.querySelector('[data-ok]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`); await sleep(250); };
  try {
    // 12 barre: colonne da destra a sinistra nell'ordine della patch, per provare l'ordinamento
    await p.ev(`(()=>{const t=window.__planciaTest;const fx=[];const xs=[4.5,1.5,-1.5,-4.5];
      xs.forEach((x,c)=>{for(let k=0;k<3;k++)fx.push({id:'p-cp'+c+k,type:'bar',name:'COL'+(4-c)+'-'+(k+1),group:'ledbar',universe:1,address:1+(c*3+k)*14,x,y:-0.6,z:.2+k,vertical:true,w:1,block:'COL'+(4-c),unit:4-c,enabled:true})});
      fx.push({id:'p-par1',type:'par',name:'PAR1',group:'front',universe:1,address:200,x:8,y:3,enabled:true});
      t.L.fixtures=fx;t.L.pages.push(t.P('Luci prova',[t.W('fixgrid',0,0,16,10,{label:'Luci'})]));t.render();
      const tabs=document.querySelectorAll('#tabs > *');tabs[tabs.length-1].click();return 1})()`);
    let tl = [];
    for (let i = 0; i < 20 && tl.length < 5; i++) { await sleep(200); tl = await tiles(); }
    check(tl.length === 5 && tl.slice(0, 4).join() === 'COL1 ×3,COL2 ×3,COL3 ×3,COL4 ×3', `una tessera per colonna, da sinistra: ${tl.join(' | ')}`);

    await down('[data-fg-block-tile="COL2"]'); await sleep(150);
    tl = await tiles();
    check(tl[1] === 'COL2 ×3*' && await p.ev(`document.querySelector('.fg-foot').textContent.includes('3 luci')`), 'un tocco su COL2 seleziona le sue 3 barre');
    await down('[data-fg-block-tile="COL2"]'); await sleep(150);
    check(!(await tiles())[1].endsWith('*'), 'secondo tocco: COL2 deselezionata');

    await down('[data-fg-sel="odd"]'); await sleep(150);
    tl = await tiles();
    check(tl[0].endsWith('*') && !tl[1].endsWith('*') && tl[2].endsWith('*') && !tl[3].endsWith('*') && tl[4].endsWith('*'), `Dispari = COL1, COL3 e il PAR (quinta da sinistra): ${tl.join(' | ')}`);
    check(await p.ev(`document.querySelector('.fg-foot').textContent.includes('7 luci')`), 'Dispari: 7 luci (2 colonne x 3 + il PAR)');

    await down('[data-fg-single]'); await sleep(150);
    check((await tiles()).length === 13, 'Barre singole: 13 tessere');
    await down('[data-fg-single]'); await sleep(150);

    // nuovo blocco con due luci singole: stesso nome e stessa unita'
    await down('[data-fg-sel="none"]'); await down('[data-fg-single]'); await sleep(150);
    await p.ev(`(()=>{for(const id of ['p-cp00','p-cp01'])document.querySelector('[data-fg="'+id+'"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    await sleep(150);
    await down('[data-fg-block="make"]');
    await answer('alto dx');
    const nb = await p.ev(`JSON.stringify(window.__planciaTest.L.fixtures.filter(f=>['p-cp00','p-cp01'].includes(f.id)).map(f=>[f.block,f.unit]))`);
    const b = JSON.parse(nb);
    check(b[0][0] === 'ALTO DX' && b[1][0] === 'ALTO DX' && b[0][1] === b[1][1] && b[0][1] === 5, `⊞ Blocco: nome in maiuscolo e unità nuova comune (${nb})`);
    await down('[data-fg-block="free"]'); await sleep(150);
    check(await p.ev(`window.__planciaTest.L.fixtures.filter(f=>['p-cp00','p-cp01'].includes(f.id)).every(f=>!f.block)`), 'Sciogli: le luci escono dal blocco');

    // salva scena senza DMX Master: messaggio chiaro, niente blocchi
    await down('[data-fg-scene]'); await sleep(300);
    const err = await p.ev(`[...document.querySelectorAll('.toast,.err,[role=alert],.ui-confirm')].map(x=>x.textContent).join(' | ')`);
    await p.ev(`(()=>{const b=document.querySelector('.ui-confirm');if(b)b.querySelector('[data-x]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`);
    check(/Nome della scena/.test(err), '📷 Salva scena chiede il nome della scena');

    const shot = arg('--shot');
    if (shot) { await down('[data-fg-single]'); await down('[data-fg-block-tile="COL3"]'); await sleep(300); await p.shot(path.resolve(shot)); console.log('screenshot: ' + path.resolve(shot)); }
    check(!p.problems.length, `nessun errore nella pagina${p.problems.length ? ': ' + p.problems.join('; ') : ''}`);
  } finally { p.close(); }
  process.exitCode = fail.length ? 1 : 0;
}
main().catch(e => { console.error('luci a blocchi: prova fallita:', e.message); process.exitCode = 2; });
