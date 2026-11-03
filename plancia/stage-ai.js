'use strict';
// "Palco da descrizione" con Ollama (sul PC OPS): il modello produce solo un
// PIANO COMPATTO (dimensioni + gruppi di fixture uguali con una posizione);
// la Plancia lo espande in modo deterministico (src/65-stage-ai.js).
// Provato 2026-10-21: qwen2.5-coder:7b ~40 s e piano corretto; qwen2.5:3b
// ~15 s ma dimentica fixture e sbaglia posizioni.

const http = require('http');

const OLLAMA_URL = process.env.STAGE_AI_OLLAMA || 'http://127.0.0.1:11434';
const MODEL = process.env.STAGE_AI_MODEL || 'qwen2.5-coder:7b';
const TYPES = ['par', 'bar', 'mh', 'blinder', 'haze', 'wall', 'laser', 'speaker', 'projector', 'screen'];
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
          group: { type: 'string' },
          model: { type: 'string' },
          mirror: { type: 'boolean' }
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
  'Altri tipi: blinder = anche strobo, flash, stroboscopica; projector = proiettore; screen = schermo di proiezione ("proiettore con schermo" sono due elementi). I numeri in lettere contano: sei = 6, otto = 8.',
  '"mirror": true solo se l\'utente chiede luci a specchio, che fanno tutte la stessa cosa. "model": solo se l\'utente nomina un modello tra quelli elencati.',
  'Posizioni (campo "row"): back = fondo palco; mid = centro palco; front = bordo palco verso il pubblico; truss = americana sopra il palco; side_left / side_right = lati del palco; audience = sopra o verso il pubblico; center = un punto al centro.',
  'Un elemento di "groups" per ogni insieme di luci uguali nella stessa posizione. "count" = quante.',
  '"group" e\' facoltativo: front/back per i PAR davanti/dietro, mh per le teste, ledbar, haze, blinder; inventa un nome breve minuscolo (es. side, floor) solo se l\'utente chiede un gruppo che si comporta diversamente dagli altri.',
  '"stage": larghezza e profondita\' del palco in metri (se non detto: 12 x 8).',
  'Non inventare luci che l\'utente non ha chiesto. In "notes" scrivi in UNA frase breve cosa hai interpretato o cosa e\' ambiguo.'
].join('\n');

// Controllo fatto dal codice: i numeri scritti nel testo contro il piano. Il modello
// sbaglia (provato 2026-11-03: "sei par" -> 1) e tace su quello che scarta.
const NUM = { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, sedici: 16, venti: 20, ventiquattro: 24 };
const TERMS = [['screen', /^scherm[oi]$/], ['projector', /^proiettor[ei]$/], ['par', /^(par|pars|wash|uplights?)$/], ['bar', /^(barr[ae]|bars?)$/], ['mh', /^(test[ae]|moving)$/],
  ['blinder', /^(blinders?|strob[oi]|stroboscopic[ah]e?|flash)$/], ['haze', /^(haze|hazer|fumo)$/], ['laser', /^lasers?$/], ['speaker', /^(cass[ae]|speakers?)$/], ['wall', /^(ledwall|wall)$/]];
const DEFAULT_ROW = { par: 'front', bar: 'back', mh: 'truss', blinder: 'front', haze: 'back', wall: 'back', laser: 'back', speaker: 'front', projector: 'audience', screen: 'back' };
const NATURAL_ROW = { wall: 'back', screen: 'back', projector: 'audience' };
function countsInText(text) {
  // la punteggiatura resta come separatore: in "palco 10 per 6. Otto PAR" il 6 non e' dei PAR
  const w = String(text).toLowerCase().replace(/[.,;:!?()]+/g, ' | ').replace(/[^a-z0-9àèéìòù| ]+/g, ' ').split(/\s+/).filter(Boolean), out = {};
  const isNum = t => /^\d+$/.test(t) || NUM[t] != null, stop = t => t == null || t === '|' || t === 'e' || t === 'per' || isNum(t);
  const typeOf = t => TERMS.find(([, re]) => re.test(t))?.[0];
  w.forEach((t, i) => { const n = /^\d+$/.test(t) ? +t : NUM[t]; if (!n || n > 96) return;
    // il nome subito dopo il numero, o dopo un aggettivo ("due grandi casse", "un led wall")
    const ty = typeOf(w[i + 1]) || (stop(w[i + 1]) ? null : typeOf(w[i + 2])); if (ty) out[ty] = (out[ty] || 0) + n; });
  w.forEach((t, i) => { if (t === 'con' && typeOf(w[i + 1]) && !out[typeOf(w[i + 1])]) out[typeOf(w[i + 1])] = 1; });
  return out;
}
// corregge il piano dove si puo' farlo con certezza; ritorna {plan, corrections}
function checkPlan(prompt, plan) {
  const want = countsInText(prompt), corrections = [], groups = Array.isArray(plan?.groups) ? plan.groups : [];
  for (const [type, n] of Object.entries(want)) {
    const mine = groups.filter(g => g.type === type), have = mine.reduce((a, g) => a + (+g.count || 0), 0);
    if (have === n) continue;
    if (!mine.length) { groups.push({ type, count: n, row: DEFAULT_ROW[type] }); corrections.push(`${type}: il modello non le aveva messe, aggiunte ${n} (controlla la posizione).`); }
    else if (mine.length === 1) { corrections.push(`${type}: il modello ne aveva messe ${have}, corrette a ${n} come nel testo.`); mine[0].count = n; }
    else if (n % mine.length === 0) { mine.forEach(g => { g.count = n / mine.length; }); corrections.push(`${type}: il modello ne aveva messe ${have}, ora ${n} divise in ${mine.length} posizioni.`); }
    else corrections.push(`${type}: nel testo ${n}, nel piano ${have}: controlla.`);
  }
  for (const g of groups) {
    const place = NATURAL_ROW[g.type], word = { wall: 'wall', screen: 'scherm', projector: 'proiettor' }[g.type];
    if (place && g.row !== place && !new RegExp(word + '[^.,;]{0,25}(davanti|bordo|lato|centro|fondo|dietro|americana|pubblico)').test(String(prompt).toLowerCase())) { corrections.push(`${g.type}: spostato da ${g.row} a ${place}, il testo non dice dove.`); g.row = place; }
  }
  for (const g of groups) if (Object.keys(want).length && !want[g.type]) corrections.push(`${g.type}: non è nel testo, le ha aggiunte il modello (${g.count}): controlla.`);
  return { plan: { ...plan, groups }, corrections };
}
// POST a Ollama /api/chat con output strutturato; callback(err, {plan, model, seconds, tokens})
function generatePlan(prompt, callback, model = MODEL, { models = [] } = {}) {
  const schema = JSON.parse(JSON.stringify(SCHEMA));
  if (models.length) schema.properties.groups.items.properties.model.enum = ['', ...models];
  const sys = models.length ? `${SYSTEM}\nModelli disponibili: ${models.join(', ')}.` : SYSTEM;
  chat(sys, schema, prompt, model, (err, out) => { if (err) return callback(err); const c = checkPlan(prompt, out.plan); callback(null, { ...out, plan: c.plan, corrections: c.corrections }); });
}
// Timeline base: il modello sceglie solo tra cose che esistono (enum dello schema);
// tempi e tracce li calcola la Plancia (expandTimelinePlan). lib = {scenes, heads, chases, effects, motions, laser}: [{id, name}]
function timelineSchema(lib) {
  const pick = list => ({ type: 'string', enum: ['', ...(list || []).map(x => x.id)] });
  return { type: 'object', required: ['sections'], properties: {
    bpm: { type: 'number' }, notes: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', required: ['name', 'seconds'], properties: {
      name: { type: 'string' }, seconds: { type: 'number' }, scene: pick(lib.scenes), heads: pick(lib.heads), chase: pick(lib.chases),
      effects: { type: 'array', items: { type: 'string', enum: (lib.effects || []).map(x => x.id).concat(['']) } }, motion: pick(lib.motions), laser: pick(lib.laser) } } } } };
}
function generateTimeline(prompt, lib, callback, model = MODEL) {
  const list = (t, l) => `${t}: ${(l || []).map(x => `${x.id} (${x.name})`).join(', ') || 'nessuno'}`;
  const sys = ['Sei un assistente per il design luci. Dividi lo show descritto dall\'utente in SEZIONI in ordine, in JSON.',
    'Ogni sezione: "name" breve, "seconds" durata, e cosa succede. Usa SOLO gli id elencati qui, esattamente come scritti; stringa vuota se quella cosa non serve.',
    list('scene (colori e look)', lib.scenes), list('heads (posizione teste)', lib.heads), list('chase (scene in sequenza)', lib.chases), list('effects (effetti luci, anche piu\' di uno)', lib.effects), list('motion (movimento teste)', lib.motions), list('laser', lib.laser),
    'La somma dei "seconds" deve essere la durata chiesta. Variare da una sezione all\'altra.',
    'Se il testo chiede chase, effetti, strobo, movimento o laser DEVI metterli nelle sezioni giuste: "chase" => un id di chase; "effetti" o "strobo" => "effects" con gli id adatti; "teste che girano" o "movimento" => "motion". Se il testo dice "niente X" o non nomina il laser, lascia vuoto.',
    'Se una sezione ha "motion", lascia vuoto "heads". Scrivi in "bpm" il tempo se e\' nel testo. In "notes" una frase breve su cosa hai scelto.'].join('\n');
  chat(sys, timelineSchema(lib), prompt, model, (err, out) => { if (err) return callback(err); const c = checkTimeline(prompt, out.plan, lib); callback(null, { ...out, plan: c.plan, corrections: c.corrections }); });
}
// Stessa idea di checkPlan: quello che il testo dice e il modello ignora. Il modello
// (provato 2026-11-03) mette il laser non chiesto, perde bpm, strobo, chase ed effetti.
function checkTimeline(prompt, plan, lib = {}) {
  const text = String(prompt).toLowerCase(), corrections = [], sections = Array.isArray(plan?.sections) ? plan.sections : [];
  const asked = word => new RegExp(word).test(text), negated = word => new RegExp(`(niente|senza|no)\\s+(?:[a-zàèéìòù]+\\s+)?(?:${word})`).test(text);
  const isStrobe = id => /strob/i.test(id) || /strob/i.test((lib.effects || []).find(x => x.id === id)?.name || '');
  const clear = (label, used, wipe) => { if (sections.some(used)) { sections.forEach(wipe); corrections.push(label); } };
  const fields = [['laser', 'laser', s => s.laser, s => { s.laser = ''; }], ['movimento', 'moviment|girano|ruotano', s => s.motion, s => { s.motion = ''; }],
    ['chase', 'chase|sequenz', s => s.chase, s => { s.chase = ''; }], ['effetti', 'effett', s => (s.effects || []).some(Boolean), s => { s.effects = []; }]];
  for (const [name, word, used, wipe] of fields) {
    if (negated(word)) clear(`${name}: tolto, il testo dice di no.`, used, wipe);
    else if (asked(word)) { if (!sections.some(used)) corrections.push(`${name}: chiesto nel testo ma il modello non l'ha messo. Aggiungilo a mano o rigenera.`); }
    else if (name === 'laser') clear('laser: tolto, il testo non lo chiede.', used, wipe);
  }
  if (negated('strob')) clear('strobo: tolta, il testo dice di no.', s => (s.effects || []).some(isStrobe), s => { s.effects = (s.effects || []).filter(e => !isStrobe(e)); });
  else if (asked('strob') && !sections.some(s => (s.effects || []).some(isStrobe))) corrections.push("strobo: chiesta nel testo ma il modello non l'ha messa. Aggiungila a mano o rigenera.");
  const bpm = text.match(/(\d{2,3})\s*bpm/);
  if (bpm && +plan?.bpm !== +bpm[1]) { corrections.push(`bpm: ${bpm[1]} come nel testo.`); plan = { ...plan, bpm: +bpm[1] }; }
  return { plan: { ...plan, sections }, corrections };
}
function chat(system, format, prompt, model, callback) {
  const body = JSON.stringify({
    model, stream: false, format, keep_alive: '10m',
    options: { temperature: 0.2, num_ctx: 4096 },
    messages: [{ role: 'system', content: system }, { role: 'user', content: String(prompt).slice(0, 2000) }]
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

module.exports = { SCHEMA, SYSTEM, TYPES, ROWS, MODEL, generatePlan, generateTimeline, timelineSchema, checkPlan, checkTimeline, countsInText };
