'use strict';
// Apre la Plancia IN ESERCIZIO (http://127.0.0.1:8080) in un browser invisibile ed esegue uno
// script nella pagina, con le funzioni della Plancia (projLoad, save, sendTimelineToTD...).
// E' un tablet in piu': quello che lo script cambia nel layout arriva a tutti i tablet.
//   node tools/live-page.js script.js [--shot file.png] [--url http://host:porta/]
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SCRIPT = process.argv[2];
const URL = arg('--url') || 'http://127.0.0.1:8080/';
const SHOT = arg('--shot');
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

async function main() {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plancia-live-'));
  const cdp = 9300 + Math.floor(Math.random() * 500);
  const br = spawn(BROWSERS.find(p => fs.existsSync(p)), ['--headless=new', '--disable-gpu', `--remote-debugging-port=${cdp}`, `--user-data-dir=${tmp}`, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  const close = () => {
    try { br.kill(); } catch { /* chiuso */ }
    try { execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | ? { $_.CommandLine -match '${path.basename(tmp)}' } | % { Stop-Process -Id $_.ProcessId -Force }`], { stdio: 'ignore' }); } catch { /* niente */ }
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* resta */ }
  };
  try {
    let targets;
    for (let i = 0; i < 60 && !targets; i++) { try { targets = await getJson(`http://127.0.0.1:${cdp}/json`); } catch { await sleep(250); } }
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    let id = 0; const pending = new Map(), problems = [];
    ws.on('message', m => {
      const d = JSON.parse(m);
      if (d.method === 'Runtime.exceptionThrown') problems.push(String(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable'); await send('Page.enable');
    // solo in questo browser: app.js con un accesso alle funzioni interne (window.__ev = eval nel modulo)
    const appUrl = new globalThis.URL('app.js', URL).href;
    const appSrc = await new Promise((res, rej) => http.get(appUrl, r => { let d = ''; r.setEncoding('utf8'); r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
    const end = appSrc.lastIndexOf('})();');
    const patched = appSrc.slice(0, end) + 'window.__ev=s=>eval(s);\n' + appSrc.slice(end);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*app.js*' }] });
    ws.on('message', m => {
      const d = JSON.parse(m);
      if (d.method === 'Fetch.requestPaused') send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }],
        body: Buffer.from(patched, 'utf8').toString('base64') });
    });
    await send('Page.navigate', { url: URL });
    await sleep(9000);
    // lo script gira DENTRO il modulo della Plancia (eval diretto): vede L, save, projLoad...
    const r = await send('Runtime.evaluate', { expression: `window.__ev(${JSON.stringify(`(async()=>{${code}\n})()`)})`, returnByValue: true, awaitPromise: true, timeout: 300000 });
    if (r.result?.exceptionDetails) console.log('ECCEZIONE:', r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    else console.log(JSON.stringify(r.result?.result?.value, null, 1));
    await sleep(2500);   // il salvataggio del layout arriva al bridge
    if (SHOT) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SHOT, Buffer.from(s.result.data, 'base64')); console.log('schermata', SHOT); }
    if (problems.length) console.log('eccezioni nella pagina:', problems.slice(0, 5));
    ws.close();
  } finally { close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
