'use strict';
// Contenuto video di LED wall e proiettori (20/11): durante il ⏺ la Plancia registra un video a
// tasselli (procedurale o NDI/URL) accanto allo stato delle luci; il Render 3D lo usa sul muro e
// nell'immagine del proiettore, in play e nell'export.
//   node test/render3d-media.js   (senza scansione in data/render3d si salta)

const fs = require('fs');
const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const SCAN = path.join(__dirname, '..', 'data', 'render3d');
const OUT = path.join(__dirname, '..', 'test-output', 'render3d-media');

async function main() {
  if (!fs.existsSync(path.join(SCAN, 'scan.js')) || !fs.existsSync(path.join(SCAN, 'v1.mp4'))) { console.log('salto: manca la scansione (data/render3d)'); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const p = await startPlancia({ hooks: true });
  const fail = [];
  let other = null;
  const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'ERRORE'} ${msg}`); if (!ok) fail.push(msg); };
  try {
    fs.cpSync(SCAN, path.join(p.tmp, 'render3d'), { recursive: true });
    // video su un altro sito senza CORS (come un link http qualunque): deve passare dal bridge
    other = require('http').createServer((q, r) => { const file = path.join(SCAN, 'v1.mp4'), st = fs.statSync(file), m = /bytes=(d+)-(d*)/.exec(q.headers.range || '');
      if (m) { const a = +m[1], b = m[2] ? +m[2] : st.size - 1; r.writeHead(206, { 'content-type': 'video/mp4', 'content-length': b - a + 1, 'content-range': `bytes ${a}-${b}/${st.size}`, 'accept-ranges': 'bytes' }); fs.createReadStream(file, { start: a, end: b }).pipe(r); }
      else { r.writeHead(200, { 'content-type': 'video/mp4', 'content-length': st.size, 'accept-ranges': 'bytes' }); fs.createReadStream(file).pipe(r); } });
    await new Promise(r => other.listen(0, '127.0.0.1', r));
    const OTHER = `http://localhost:${other.address().port}`;
    // Palco: LED wall procedurale, proiettore con video URL (un video di prova servito dal bridge)
    const ok = await p.ev(`(async()=>{const T=window.__planciaTest,L=T.L;
      L.fixtures=(L.fixtures||[]).filter(f=>!['wall','projector','screen'].includes(f.type));
      L.fixtures.push({id:'led',type:'wall',name:'LED1',x:0,y:.5,z:0,w:6,h:3.5,rot:0,sourceType:'procedural',enabled:true});
      L.fixtures.push({id:'scr',type:'screen',name:'SCHERMO',x:-4,y:3,z:1,w:4,h:2.25,rot:0,enabled:true});
      L.fixtures.push({id:'prj',type:'projector',name:'PROIETTORE',x:0,y:11,z:3,target:'scr',throw:1.5,sourceType:'url',sourceRef:'${OTHER}/v1.mp4',enabled:true});
      const SH=T.SH;SH.led.bright=1;SH.master=1;SH.blackout=false;SH.g.ledwall=1;SH.wall.c=[1,.2,.4];SH.led.mode=2;
      // la pagina del Palco in vista Render: la Plancia apre i video solo li'
      const i=L.pages.findIndex(pg=>pg.widgets.some(w=>w.type==='stage'&&w.view!=='plot'));if(i<0)return 'nessuna pagina Palco';
      document.querySelectorAll('#tabs .tab')[i].click();
      for(let i=0;i<60;i++){const v=T.wallVideoPlayers.get('prj')?.video;if(v&&v.readyState>=2)return true;await new Promise(r=>setTimeout(r,100))}
      return false})()`);
    check(ok === true, 'Palco: il proiettore riceve il suo video URL ' + (ok === true ? '' : ok));
    // registrazione: 2 s di Render disegnato a mano (come fa il Palco a ogni fotogramma)
    const rec = await p.ev(`(async()=>{const T=window.__planciaTest;const cv=document.createElement('canvas');cv.width=960;cv.height=540;const g=cv.getContext('2d');
      T.lfStart(30);const t0=performance.now();
      while(performance.now()-t0<2200){T.drawRender(g,960,540,performance.now(),.6);await new Promise(r=>requestAnimationFrame(r))}
      let clean=true;try{cv.toDataURL()}catch{clean=false}
      const doc=T.lfStop();doc.__clean=clean;const file=await T.lfUpload(doc,'prova_contenuto');return {file,media:doc.media,frames:doc.frames.length,clean:doc.__clean}})()`);
    check(rec.clean, 'il Render resta registrabile anche col video di un altro sito (passa dal bridge)');
    check(rec.media?.file && rec.media.tiles?.led && rec.media.tiles?.prj, `contenuto registrato e caricato: ${rec.media?.file} (${rec.frames} fotogrammi, tasselli ${Object.keys(rec.media?.tiles || {}).join(', ')})`);
    const base = await p.ev('location.origin');
    const head = await fetch(`${base}/api/light-frames/${encodeURIComponent(rec.media.file)}`, { headers: { range: 'bytes=0-99' } });
    check(head.status === 206 && /^video\//.test(head.headers.get('content-type')), `il bridge serve il video a pezzi (${head.status} ${head.headers.get('content-type')})`);

    await p.send('Page.navigate', { url: `${base}/render3d/?frames=${encodeURIComponent(rec.file)}` });
    let st = null;
    for (let i = 0; i < 80 && !st?.ready; i++) { await sleep(250); st = await p.ev(`window.__r3d?{ready:window.__r3d.MV.ready,n:window.__r3d.PAL.items.length}:null`).catch(() => null); }
    check(st?.ready && st.n === 3, `Render 3D: video del contenuto caricato, ${st?.n} elementi`);
    await sleep(1200);
    // pixel dei tasselli disegnati: muro (procedurale rosa) e proiettore (video)
    const px = await p.ev(`(()=>{const it=window.__r3d.PAL.items;const lum=(c,m=0)=>{const g=c.getContext('2d'),d=g.getImageData(c.width*m,c.height*m,c.width*(1-2*m),c.height*(1-2*m)).data;let s=0,r=0,b=0;for(let i=0;i<d.length;i+=16){s+=d[i]+d[i+1]+d[i+2];r+=d[i];b+=d[i+2]}const n=d.length/16;return {l:s/n/3,r:r/n,b:b/n}};
      const w=it.find(i=>i.kind==='wall'),pj=it.find(i=>i.kind==='projector');return {wall:lum(w.cv),prj:lum(pj.cv,.36),map:!!w.mat.map}})()`);
    check(px.map && px.wall.l > 10 && px.wall.r > px.wall.b, `LED wall col contenuto procedurale registrato (luminosità ${px.wall.l.toFixed(0)}, rosso ${px.wall.r.toFixed(0)} > blu ${px.wall.b.toFixed(0)})`);
    check(px.prj.l > 5, `proiettore con il video registrato (luminosità ${px.prj.l.toFixed(1)})`);
    // pausa e salto: il video segue la barra del tempo
    await p.ev(`(()=>{const R=window.__r3d;document.getElementById('play').click();R.FR.t=1.2;return 1})()`);
    await sleep(700);
    const tv = await p.ev(`(()=>{const R=window.__r3d;return {v:R.MV.video.currentTime,want:R.FR.t+(R.MV.doc.offset||0),paused:R.MV.video.paused}})()`);
    check(tv.paused && Math.abs(tv.v - tv.want) < 0.06, `in pausa sul punto scelto: video a ${tv.v.toFixed(3)} s, atteso ${tv.want.toFixed(3)} s`);
    await p.ev(`(()=>{const R=window.__r3d,it=R.PAL.items,sc=it.find(i=>i.kind==='screen').g,pj=it.find(i=>i.kind==='projector').spot,c=R.camera();document.getElementById('walls').value='none';document.getElementById('walls').dispatchEvent(new Event('change'));
      const w=sc.getWorldPosition(sc.position.clone()),q=pj.getWorldPosition(pj.position.clone());c.position.copy(q).lerp(w,0.2).add({x:0,y:1.5,z:0});R.controls.target.copy(w);R.controls.update();return 1})()`);
    await sleep(1200); await p.shot(path.join(OUT, 'contenuto.png'));
    // export: fotogramma per fotogramma, il video cercato a ogni passo
    await p.ev(`(()=>{window._lastExport=null;document.getElementById('exRes').value='1280x720';document.getElementById('exDur').value='full';document.getElementById('exGo').click();return 1})()`);
    let blob = 0;
    for (let i = 0; i < 240 && !blob; i++) { await sleep(500); blob = await p.ev(`window._lastExport?window._lastExport.size:0`); }
    check(blob > 50000, `export con il contenuto: ${(blob / 1048576).toFixed(2)} MB — ${await p.ev(`document.getElementById('exMsg').textContent`)}`);
    check(!p.problems.length, 'nessuna eccezione' + (p.problems.length ? ': ' + p.problems.slice(0, 3).join(' | ') : ''));
    console.log('screenshot in ' + OUT);
  } finally { p.close(); other?.close?.(); }
  if (fail.length) { console.log(`\n${fail.length} controlli falliti`); process.exitCode = 1; } else console.log('\ntutto ok');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
