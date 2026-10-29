'use strict';
// Smoke test della UI: ogni pagina aperta in un browser headless, zero
// eccezioni, uno screenshot per pagina (riferimento visivo prima/dopo un passo
// del refactor). Non fa parte di `node --test` perche' serve un browser:
//
//   npm run smoke                      (dati: data/state.json se c'e', altrimenti layout di default)
//   node test/ui-smoke.js --state <file> --out <cartella>
//
// Isolamento: vedi test/browser-harness.js.

const fs = require('fs');
const path = require('path');
const { startPlancia, sleep } = require('./browser-harness');

const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const OUT = path.resolve(arg('--out', path.join(ROOT, 'test-output', 'smoke')));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const p = await startPlancia({ state: arg('--state', path.join(ROOT, 'data', 'state.json')) });
  try {
    const tabs = await p.ev(`[...document.querySelectorAll('#tabs > *')].map(e=>e.textContent.trim())`) || [];
    if (!tabs.length) p.problems.push('nessuna pagina nella barra delle tab');
    const report = [];
    for (let i = 0; i < tabs.length; i++) {
      const before = p.problems.length;
      await p.ev(`document.querySelectorAll('#tabs > *')[${i}].click();1`);
      await sleep(1500);
      const widgets = await p.ev(`document.querySelectorAll('#stage .w').length`);
      const file = `${String(i + 1).padStart(2, '0')}-${tabs[i].replace(/[^\w]+/g, '_')}.png`;
      await p.shot(path.join(OUT, file));
      const errs = p.problems.slice(before);
      report.push({ page: tabs[i], widgets, screenshot: file, problems: errs });
      console.log(`${errs.length ? 'ERRORI' : 'ok    '} ${tabs[i].padEnd(16)} widget ${String(widgets).padStart(2)}  ${file}${errs.length ? '\n  ' + errs.join('\n  ') : ''}`);
    }
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), problems: p.problems, pages: report }, null, 2));
    console.log(`\n${tabs.length} pagine, ${p.problems.length} problemi. Screenshot e report in ${OUT}`);
    process.exitCode = p.problems.length ? 1 : 0;
  } finally {
    p.close();
  }
}

main().catch(e => { console.error('smoke test fallito:', e.message); process.exitCode = 2; });
