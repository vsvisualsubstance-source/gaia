'use strict';
// Prova di Regia (plancia/regia) in un browser headless, servita dal bridge come in show:
// pagina e font in locale, cartella video (elenco, Range, file nel canale, cue e clip ripresi
// per nome), orologio dello show su un topic di PROVA (mai quello vero), NDI con gateway assente.
//   node test/regia-smoke.js [video.mp4]   (senza video: solo immagini e controlli di base)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const video = process.argv[2];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regia-video-'));
fs.mkdirSync(path.join(dir, 'Atto 1'));
// PNG 1x1 rosso
fs.writeFileSync(path.join(dir, 'Atto 1', 'logo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));
if (video) fs.copyFileSync(video, path.join(dir, 'Atto 1', 'clip.mp4'));
process.env.VIDEO_DIR = dir;
const TOPIC = 'gaia/test/regia-smoke/clock';

(async () => {
  const p = await startPlancia();
  const fail = [];
  const check = (ok, what) => { console.log((ok ? 'ok  ' : 'NO  ') + what); if (!ok) fail.push(what); };
  try {
    await p.send('Page.navigate', { url: `http://127.0.0.1:${p.port}/regia/?clock=${encodeURIComponent(TOPIC)}` });
    await sleep(4000);
    check(await p.ev('document.title') === 'Regia', 'pagina /regia/ servita dal bridge');
    check(await p.ev('[...document.styleSheets].some(s=>(s.href||"").endsWith("/regia/fonts/fonts.css"))'), 'font in locale');
    await p.ev('document.fonts.load(\'700 40px "Barlow Condensed"\')');
    check(await p.ev('document.fonts.check(\'700 40px "Barlow Condensed"\')'), 'font Barlow Condensed caricato senza internet');
    const lib = await p.ev('libLoad(true).then(()=>LIB.files.map(f=>f.rel))');
    check(Array.isArray(lib) && lib.includes('Atto 1/logo.png') && (!video || lib.includes('Atto 1/clip.mp4')), 'cartella video: ' + JSON.stringify(lib));
    const r = await p.ev(`fetch('/media/video/Atto%201/logo.png',{headers:{range:'bytes=0-9'}}).then(r=>r.status+' '+r.headers.get('content-range'))`);
    check(r === '206 bytes 0-9/' + fs.statSync(path.join(dir, 'Atto 1', 'logo.png')).size, 'Range sul file: ' + r);
    check(await p.ev(`fetch('/media/video/..%2F..%2Fbridge.js').then(r=>r.status)`) === 404, 'niente file fuori dalla cartella');
    // file nel canale, cue ripreso per nome
    await p.ev(`openLib();1`); await sleep(600);
    check(await p.ev(`document.querySelectorAll('#libList [data-act=libch]').length`) === lib.length, 'finestra Cartella video con i file');
    await p.ev(`document.querySelector('#libList [data-act=libch][data-rel="Atto 1/logo.png"]').click();1`); await sleep(800);
    check(await p.ev(`RT[S.sel].mtype==='image'&&RT[S.sel].mname==='Atto 1/logo.png'`), 'immagine dalla cartella nel canale');
    await p.ev(`S.show.cues.push({...newCue(),src:'m:logo.png',ch:2});RT[2].bin.length=0;libRelinkAll();1`); await sleep(800);
    check(await p.ev(`RT[2].bin.some(b=>b.name==='logo.png')&&!cueMissing(S.show.cues[S.show.cues.length-1])`), 'cue col solo nome del file ripreso dalla cartella');
    if (video) {
      await p.ev(`S.sel=1;document.querySelector('#libList [data-act=libtl][data-rel="Atto 1/clip.mp4"]')?.click();1`);
      await p.ev(`openLib();1`); await sleep(600);
      await p.ev(`TLV.t=0;S.sel=1;libAct('libtl','Atto 1/clip.mp4');1`); await sleep(3000);
      const clip = await p.ev(`(()=>{const tr=S.tl.tracks.find(x=>x.type==='clip'&&x.ch===1);const it=tr.items.find(x=>x.src==='m:Atto 1/clip.mp4');const b=RT[1].bin.find(b=>b.name==='Atto 1/clip.mp4');return {it:!!it,d:it&&it.d,w:b&&b.el.videoWidth}})()`);
      check(clip.it && clip.w > 0, 'clip video dalla cartella in timeline: ' + JSON.stringify(clip));
    }
    // orologio dello show (topic di prova): due seq dallo stesso master = vivo, la timeline segue
    const mqtt = require('mqtt');
    const c = mqtt.connect('mqtt://127.0.0.1:11883');
    await new Promise((res, rej) => { c.on('connect', res); c.on('error', rej); setTimeout(() => rej(new Error('broker 11883 non raggiungibile')), 4000); });
    await p.ev(`S.tl.ext=true;S.tl.dur=120;1`);
    await sleep(1500);
    const pub = (seq, pos, playing) => c.publish(TOPIC, JSON.stringify({ v: 1, master: 'prova', prio: 9, seq, pos, playing, rate: 1, length: 120, loop: false, bpm: 128 }));
    pub(1, 10, true); await sleep(300); pub(2, 10.3, true); await sleep(1000);
    const st = await p.ev(`({t:TLV.t,playing:TLV.playing,ext:TLV.ext,bpm:S.tl.bpm,lbl:document.getElementById('tlClk').textContent})`);
    check(st.ext && st.playing && st.t > 10.5 && st.t < 12.5 && st.bpm === 128, 'timeline segue l\'orologio: ' + JSON.stringify(st));
    pub(3, 50, false); await sleep(600);
    const st2 = await p.ev(`({t:TLV.t,playing:TLV.playing})`);
    check(!st2.playing && Math.abs(st2.t - 50) < 0.01, 'salto e pausa dall\'orologio: ' + JSON.stringify(st2));
    await p.ev(`tlToggle();1`);
    check(await p.ev(`TLV.playing`) === false, 'play locale fermo mentre comanda l\'orologio');
    c.end();
    // NDI con gateway assente: messaggio, nessuna eccezione
    await p.ev(`S.ndiUrl='http://127.0.0.1:9';startNdi(3,'NESSUNO (prova)');1`); await sleep(1500);
    check(await p.ev(`RT[3].mtype!=='ndi'&&!!RT[3].ndiFail`), 'NDI con gateway assente: errore gestito');
    await p.shot(path.join(os.tmpdir(), 'regia-smoke.png'));
    check(!p.problems.length, 'nessun errore in pagina' + (p.problems.length ? ': ' + p.problems.join(' | ') : ''));
  } catch (e) { fail.push(e.message); console.log('ERRORE', e.message); }
  finally { p.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(fail.length ? `${fail.length} problemi` : 'tutto ok');
  process.exit(fail.length ? 1 : 0);
})();
