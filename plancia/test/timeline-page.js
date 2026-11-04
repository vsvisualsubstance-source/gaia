'use strict';
// Pagina Timeline semplificata (uiRev 15): un layout uiRev 14 come quello in
// esercizio il 2026-11-04 passa dall'aggiornamento. La pagina gira in simulazione.
const { startPlancia } = require('./browser-harness');

async function main() {
  const p = await startPlancia({ hooks: true });
  const fail = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    const r = JSON.parse(await p.ev(`(()=>{const T=window.__planciaTest,W=(type,x,y,w,h,o={})=>({id:'w'+Math.random(),type,x,y,w,h,label:type,addr:'',...o});
      const old=[W('timeline',0,0,11,3,{addr:'/show',cues:'0:00 A > @base',tracks:['chase','fx']}),W('scenes',11,0,5,3,{addr:'/dmx/scene'}),
        W('scenes',0,3,4,4,{mode:'dmx-enum'}),W('scenes',4,3,4,4,{mode:'dmx-enum'}),W('scenes',8,3,3,4,{mode:'dmx-enum'}),W('scenes',11,3,3,4,{addr:'/mh/position'}),
        W('scenes',14,3,2,4,{mode:'head-presets'}),W('scenes',0,7,4,3,{addr:'/mh/select/heads',mode:'head-select'}),W('color',4,7,3,3,{addr:'/mh/color'}),
        W('button',7,7,2,3,{addr:'/dmx/strobe',mode:'toggle'}),W('fader',9,7,2,3,{addr:'/dmx/strobe/rate'}),W('button',11,7,3,3,{addr:'/show/go'}),W('button',14,7,2,3,{addr:'/show/back'})];
      const show=[W('stage',0,0,11,7),W('clock',11,0,5,2),W('timeline',0,7,11,3,{addr:'/show',readonly:true}),W('fader',11,7,2,3,{addr:'/dmx/master'})];
      const seq=[W('timeline',0,0,16,4,{addr:'/show'}),W('chase',0,4,8,6)];
      T.L.pages=[{id:'a',name:'Show',widgets:show},{id:'b',name:'Sequenze ed effetti',widgets:seq},{id:'c',name:'Timeline',widgets:old}];T.L.uiRev=14;
      T.migrations.find(m=>m[0]==='migrateUiTimelinePage')[1]();
      const pg=n=>T.L.pages.find(x=>x.name===n).widgets.map(w=>[w.type,w.addr||w.mode||'',w.x,w.y,w.w,w.h,w.onlyTracks||null]);
      const once=JSON.stringify(T.L.pages);T.L.uiRev=14;T.migrations.find(m=>m[0]==='migrateUiTimelinePage')[1]();
      return JSON.stringify({tl:pg('Timeline'),show:pg('Show'),seq:pg('Sequenze ed effetti'),rev:T.L.uiRev,backup:!!T.L.pagesBackup?.timeline_20261104,twice:JSON.stringify(T.L.pages)===once})})()`));
    check(JSON.stringify(r.tl) === JSON.stringify([['timeline', '/show', 0, 0, 12, 10, null], ['scenes', '/dmx/scene', 12, 0, 4, 10, null]]), `Timeline: timeline grande e colonna scene (${JSON.stringify(r.tl)})`);
    check(r.backup && r.rev === 15, 'copia della vecchia pagina, uiRev 15');
    const go = r.show.find(w => w[1] === '/show/go'), back = r.show.find(w => w[1] === '/show/back'), tl = r.show.find(w => w[0] === 'timeline');
    check(go && back && tl[3] === 6 && r.show.find(w => w[0] === 'stage')[5] === 6 && JSON.stringify(tl[6]) === '["chase","fx"]', 'Show: GO e BACK sotto la timeline, 3 tracce');
    check(JSON.stringify(r.seq[0][6]) === '["chase","fx"]', 'Sequenze ed effetti: solo le sue tracce');
    check(r.twice, 'seconda volta: non cambia niente');
    check(!p.problems.length, `nessun errore nella pagina ${p.problems.join(' ').slice(0, 300)}`);
  } finally { p.close(); }
  if (fail.length) { console.error(`timeline-page: ${fail.length} errori`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
