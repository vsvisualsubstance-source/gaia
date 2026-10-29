'use strict';
// Plancia di prova in un browser headless, per smoke test e caratterizzazione.
// Isolata dalla Plancia in esercizio: copia temporanea del repo (il bundle vero
// non si tocca), porte libere, copia dei dati, OSC verso 127.0.0.1, timeline
// video/laser verso device inesistenti, pagina in simulazione (nessun MQTT).
// Ogni messaggio che la pagina manda al bridge (OSC, MIDI, layout) e' registrato
// in window.__sent, per i test sui messaggi generati.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { buildAppBundle } = require('../build-app');

const ROOT = path.join(__dirname, '..');
const BROWSERS = [
  process.env.SMOKE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].filter(Boolean);
const COPY_SKIP = new Set(['node_modules', '.git', 'test-output', 'data', 'app.js']);
const RECORD_SENT = `(()=>{window.__sent=[];const s=WebSocket.prototype.send;
  WebSocket.prototype.send=function(d){try{const m=JSON.parse(d);if(m.type==='osc'||m.type==='midi')window.__sent.push(m)}catch{}return s.call(this,d)}})();`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const getJson = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
async function waitHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { await new Promise((res, rej) => http.get(url, r => { r.resume(); res(); }).on('error', rej)); return; } catch { await sleep(200); }
  }
  throw new Error('non risponde: ' + url);
}
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (COPY_SKIP.has(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b); else fs.copyFileSync(a, b);
  }
}

// state: file di stato da copiare. Default: il layout fisso di test/fixtures
// (cosi' i riferimenti non dipendono da data/, che cambia a ogni prova e non e'
// nel repo); PLANCIA_STATE=percorso per provare un altro layout; null = layout
// di default della Plancia.
const FIXTURE_STATE = path.join(__dirname, 'fixtures', 'state.json');
async function startPlancia({ hooks = false, state = process.env.PLANCIA_STATE || FIXTURE_STATE } = {}) {
  const browser = BROWSERS.find(p => fs.existsSync(p));
  if (!browser) throw new Error('nessun browser Chromium/Edge trovato (SMOKE_BROWSER=...)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plancia-smoke-'));
  const app = path.join(tmp, 'app');
  copyTree(ROOT, app);
  fs.writeFileSync(path.join(app, 'app.js'), buildAppBundle(path.join(app, 'src'), { testHooks: hooks }));
  const stateFile = path.join(tmp, 'state.json');
  if (state && fs.existsSync(state)) fs.copyFileSync(state, stateFile);
  const [port, oscIn, cdp] = await Promise.all([freePort(), freePort(), freePort()]);
  const procs = [];
  const close = () => {
    for (const p of procs) { try { p.kill(); } catch { /* gia' chiuso */ } }
    // il browser lascia processi figli: si chiudono quelli col profilo di questa prova
    if (process.platform === 'win32') {
      try { execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | ? { $_.CommandLine -match '${path.basename(tmp)}' } | % { Stop-Process -Id $_.ProcessId -Force }`], { stdio: 'ignore' }); } catch { /* niente da chiudere */ }
    }
  };
  process.on('exit', close);
  const bridge = spawn(process.execPath, ['bridge.js'], { cwd: app, stdio: 'ignore', env: {
    ...process.env, NODE_PATH: path.join(ROOT, 'node_modules'),
    PORT: String(port), OSC_IN: String(oscIn), PLANCIA_STATE_FILE: stateFile,
    OSC_HOST: '127.0.0.1', OSC_PORT: '9', GAIA_OSC_HOST: '127.0.0.1', GAIA_OSC_PORT: '9',
    PATCHDECK_ID: 'smoke-nessuno', LASER_ID: 'smoke-nessuno', PLANCIA_MQTT: 'mqtt://127.0.0.1:9' } });
  procs.push(bridge);
  await waitHttp(`http://127.0.0.1:${port}/`, 15000);
  procs.push(spawn(browser, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${cdp}`,
    `--user-data-dir=${path.join(tmp, 'profile')}`, '--window-size=1400,950', 'about:blank'], { stdio: 'ignore' }));
  let targets;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await getJson(`http://127.0.0.1:${cdp}/json`); } catch { await sleep(250); } }
  if (!targets) { close(); throw new Error('il browser headless non risponde'); }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pending = new Map(), problems = [];
  ws.on('message', m => {
    const d = JSON.parse(m);
    if (d.method === 'Runtime.exceptionThrown') problems.push('eccezione: ' + String(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') problems.push('console.error: ' + d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  // valuta un'espressione nella pagina; un'eccezione diventa un errore qui
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n')[0]);
    return r.result?.result?.value;
  };
  const shot = async file => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: RECORD_SENT });
  const open = async (wait = 6000) => {
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/?broker=0.0.0.0` });
    await sleep(wait);
    await ev('window.confirm=()=>false;window.alert=()=>{};window.prompt=()=>null;1');
  };
  await open();
  return { ev, send, shot, problems, reload: open, close: () => { try { ws.close(); } catch { /* chiuso */ } close(); }, port };
}

module.exports = { startPlancia, sleep };
