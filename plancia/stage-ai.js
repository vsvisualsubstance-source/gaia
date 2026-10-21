'use strict';
// "Palco da descrizione" con Ollama (sul PC OPS): il modello produce solo un
// PIANO COMPATTO (dimensioni + gruppi di fixture uguali con una posizione);
// la Plancia lo espande in modo deterministico (src/65-stage-ai.js).
// Provato 2026-10-21: qwen2.5-coder:7b ~40 s e piano corretto; qwen2.5:3b
// ~15 s ma dimentica fixture e sbaglia posizioni.

const http = require('http');

const OLLAMA_URL = process.env.STAGE_AI_OLLAMA || 'http://127.0.0.1:11434';
const MODEL = process.env.STAGE_AI_MODEL || 'qwen2.5-coder:7b';
const TYPES = ['par', 'bar', 'mh', 'blinder', 'haze', 'wall', 'laser', 'speaker'];
const ROWS = ['back', 'mid', 'front', 'truss', 'side_left', 'side_right', 'audience', 'center'];

const SCHEMA = {
  type: 'object',
  properties: {
    stage: { type: 'object', properties: { width: { type: 'number' }, depth: { type: 'number' } }, required: ['width', 'depth'] },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: TYPES },
          count: { type: 'integer', minimum: 1, maximum: 48 },
          row: { type: 'string', enum: ROWS },
          group: { type: 'string' }
        },
        required: ['type', 'count', 'row']
      }
    },
    notes: { type: 'string' }
  },
  required: ['stage', 'groups']
};

const SYSTEM = [
  'Sei un assistente per il design luci di club e palchi. Trasformi la descrizione dell\'utente in un PIANO COMPATTO del rig, in JSON.',
  'Tipi di fixture (campo "type"): par = PAR/wash/uplight; bar = barra LED; mh = testa mobile (spot/beam/wash motorizzate); blinder; haze = macchina del fumo/haze; wall = LED wall/schermo; laser; speaker = cassa.',
  'Posizioni (campo "row"): back = fondo palco; mid = centro palco; front = bordo palco verso il pubblico; truss = americana sopra il palco; side_left / side_right = lati del palco; audience = sopra o verso il pubblico; center = un punto al centro.',
  'Un elemento di "groups" per ogni insieme di luci uguali nella stessa posizione. "count" = quante.',
  '"group" e\' facoltativo: front/back per i PAR davanti/dietro, mh per le teste, ledbar, haze, blinder; inventa un nome breve minuscolo (es. side, floor) solo se l\'utente chiede un gruppo che si comporta diversamente dagli altri.',
  '"stage": larghezza e profondita\' del palco in metri (se non detto: 12 x 8).',
  'Non inventare luci che l\'utente non ha chiesto. In "notes" scrivi in UNA frase breve cosa hai interpretato o cosa e\' ambiguo.'
].join('\n');

// POST a Ollama /api/chat con output strutturato; callback(err, {plan, model, seconds, tokens})
function generatePlan(prompt, callback, model = MODEL) {
  const body = JSON.stringify({
    model, stream: false, format: SCHEMA, keep_alive: '10m',
    options: { temperature: 0.2, num_ctx: 4096 },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: String(prompt).slice(0, 2000) }]
  });
  const url = new URL('/api/chat', OLLAMA_URL), t0 = Date.now();
  const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 240000 }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const d = JSON.parse(data);
        if (res.statusCode !== 200) throw new Error(d.error || `Ollama HTTP ${res.statusCode}`);
        callback(null, { plan: JSON.parse(d.message.content), model, seconds: Math.round((Date.now() - t0) / 1000), tokens: d.eval_count });
      } catch (e) { callback(e); }
    });
  });
  req.on('timeout', () => req.destroy(new Error('Ollama non ha risposto entro 4 minuti')));
  req.on('error', e => callback(new Error(`Ollama non raggiungibile (${e.message}): e' acceso sul PC OPS?`)));
  req.end(body);
}

module.exports = { SCHEMA, SYSTEM, TYPES, ROWS, MODEL, generatePlan };
