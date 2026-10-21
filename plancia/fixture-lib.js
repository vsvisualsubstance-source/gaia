/* ---------- libreria fixture (Open Fixture Library + DMXControl DDF) ---------- */
// Cerca un modello di luce tra le librerie aperte e lo traduce nel formato
// dei modelli di DMX Master (canali come ruoli, slot di ruota colori e gobo).
//   OFL  open-fixture-library.org  JSON su GitHub, licenza MIT
//   DDF  ddf.dmxcontrol.de         XML DMXControl 2/3, API pubblica, CC-BY-SA-4.0
// L'indice (nomi, ~3400 voci) e i file scelti restano in cache accanto allo
// stato della Plancia: dopo il primo uso la ricerca funziona anche offline.
const fs = require('fs');
const path = require('path');

const OFL_RAW = 'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/fixtures/';
const OFL_TREE = 'https://api.github.com/repos/OpenLightingProject/open-fixture-library/git/trees/master?recursive=1';
const DDF_API = 'https://ddf.api.dmxc.org/v0';
const INDEX_MAX_AGE = 30 * 24 * 3600 * 1000;

/* ---- ruoli ---- */
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'ch_$1') || 'ch';
const COLOR_ROLES = new Set(['red', 'green', 'blue', 'white', 'amber', 'uv', 'cyan', 'magenta', 'yellow', 'lime']);
// nome libero di un canale -> ruolo (per DDF 2 senza type e per i casi generici)
function roleFromName(name) {
  const n = String(name || '').toLowerCase();
  if (/\bpan\b.*fine|pan\s*\(fine\)/.test(n)) return 'pan_fine';
  if (/\btilt\b.*fine|tilt\s*\(fine\)/.test(n)) return 'tilt_fine';
  if (/^pan\b/.test(n)) return 'pan';
  if (/^tilt\b/.test(n)) return 'tilt';
  if (/speed/.test(n) && /(pan|tilt|move|movement|p\/t|pt)/.test(n)) return 'speed';
  if (/^(dimmer|intensity|master)\b/.test(n)) return 'dimmer';
  if (/shutter|strobe/.test(n)) return 'shutter';
  if (/^colou?r(\s*wheel|\s*1)?$/.test(n)) return 'color';
  if (/^gobo(\s*wheel|\s*1)?$/.test(n)) return 'gobo';
  const c = n.replace(/\s+/g, '');
  if (COLOR_ROLES.has(c)) return c;
  if (/^(zoom|focus|iris|prism)$/.test(n)) return n;
  return slug(name);
}
const uniqueRoles = roles => { const used = {}; return roles.map(r => { if (used[r]) { used[r]++; return `${r}_${used[r]}`; } used[r] = 1; return r; }); };
const kindOf = roles => roles.includes('pan') && roles.includes('tilt') ? 'heads' : ['red', 'green', 'blue'].some(r => roles.includes(r)) ? 'chase' : 'level';
const hexToRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const v = parseInt(m[1], 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255].map(x => +x.toFixed(3)); };
// nomi slot come li salva l'editor dei modelli: spazi -> _
const dedupSlots = list => { const seen = new Set(); return list.map(s => ({ ...s, name: String(s.name || '').trim().replace(/\s+/g, '_') })).filter(s => s.name && Number.isFinite(s.value) && s.value >= 0 && s.value <= 255 && !seen.has(s.value) && seen.add(s.value)).sort((a, b) => a.value - b.value); };
// nome modello: "Produttore Nome 22ch" (+ modo se due modi hanno gli stessi canali)
function modelNames(vendor, name, modes) {
  const base = `${vendor} ${name}`.replace(/\s+/g, ' ').trim();
  const count = {}; modes.forEach(m => { count[m.channels.length] = (count[m.channels.length] || 0) + 1; });
  return modes.map(m => `${base} ${m.channels.length}ch${count[m.channels.length] > 1 && m.mode ? ' ' + m.mode : ''}`.trim());
}
// ruoli che il motore heads di DMX Master comanda (nota TD 42): gli altri
// escono al loro valore in "defaults", altrimenti a 0
const TD_DRIVEN = new Set(['pan', 'pan_fine', 'tilt', 'tilt_fine', 'dimmer', 'shutter', 'red', 'green', 'blue', 'white', 'cyan', 'magenta', 'yellow', 'color', 'gobo', 'zoom', 'focus', 'speed']);
// m.defaults = {indice canale: valore}: valore neutro dei canali non comandati
// e, per lo shutter, il valore di "aperto" (TD manda defaults.shutter, nota 42)
function defaultsString(channels, defs) {
  return Object.entries(defs || {}).map(([i, v]) => [+i, Math.round(+v)])
    .filter(([i, v]) => channels[i] && Number.isFinite(v) && v >= 0 && v <= 255 && (!TD_DRIVEN.has(channels[i]) || channels[i] === 'shutter'))
    .sort((a, b) => a[0] - b[0]).map(([i, v]) => `${channels[i]}=${v}`).join(' ');
}
function finish(vendor, name, modes, extra) {
  const names = modelNames(vendor, name, modes);
  return modes.map((m, i) => {
    const channels = uniqueRoles(m.channels), kind = kindOf(channels), defaults = kind === 'heads' ? defaultsString(channels, m.defaults) : '';
    const out = {
      model: names[i], manufacturer: vendor, mode: m.mode || '', kind, channels, footprint: channels.length,
      colors: kind === 'heads' ? dedupSlots(m.colors || []) : [], gobos: kind === 'heads' ? dedupSlots(m.gobos || []) : [],
      pan_range: m.pan_range || 540, tilt_range: m.tilt_range || 270, ...extra,
    };
    if (defaults) out.defaults = defaults;
    if (m.lamp) out.notes = `${out.notes || ''} · lampada: ${m.lamp}`.replace(/^ · /, '');
    // campo lamp del modello (nota TD 43): canale, valori on/off, hold (stima: 5 s)
    const L = m.lampSpec;
    if (kind === 'heads' && L && channels[L.ch] && Number.isInteger(L.on) && Number.isInteger(L.off)) out.lamp = { channel: channels[L.ch], on: L.on, off: L.off, hold: 5 };
    return out;
  });
}

/* ---- Open Fixture Library (JSON) ---- */
const OFL_TYPE = { Intensity: 'dimmer', Pan: 'pan', Tilt: 'tilt', PanTiltSpeed: 'speed', ShutterStrobe: 'shutter', Zoom: 'zoom', Focus: 'focus', Iris: 'iris', Prism: 'prism' };
function oflCaps(ch) { return ch ? (ch.capability ? [ch.capability] : ch.capabilities || []) : []; }
function oflChannelRole(name, ch) {
  const caps = oflCaps(ch).filter(c => c.type !== 'NoFunction');
  const c = caps[0];
  if (!c) return roleFromName(name);
  if (c.type === 'ColorIntensity' && caps.every(x => x.type === 'ColorIntensity')) return COLOR_ROLES.has(slug(c.color)) ? slug(c.color) : slug(c.color || name);
  if (c.type === 'WheelSlot' || caps.some(x => x.type === 'WheelSlot')) {
    const w = String((caps.find(x => x.type === 'WheelSlot') || c).wheel || name);
    return /colou?r/i.test(w) ? 'color' : /gobo/i.test(w) ? 'gobo' : slug(w);
  }
  // velocita' al contrario (0 = lento): resta col suo nome, non e' 'speed' (nota TD 42)
  if (c.type === 'PanTiltSpeed' && /slow/i.test(String(c.speedStart || ''))) return slug(name);
  return OFL_TYPE[c.type] || roleFromName(name);
}
const oflDmx = v => { v = +v; return v > 255 ? Math.floor(v / 256) : v; };
// valore neutro di un canale OFL: shutter = inizio di "Open", altrimenti
// defaultValue della scheda, altrimenti inizio del primo "NoFunction"
function oflDefault(ch, role) {
  const caps = oflCaps(ch);
  if (role === 'shutter') { const o = caps.find(x => x.type === 'ShutterStrobe' && x.shutterEffect === 'Open' && x.dmxRange); return o ? oflDmx(o.dmxRange[0]) : null; }
  if (ch.defaultValue != null) { const d = ch.defaultValue; return typeof d === 'string' && /%$/.test(d) ? Math.round(parseFloat(d) * 255 / 100) : oflDmx(d); }
  const nf = caps.length > 1 && caps.find(x => x.type === 'NoFunction' && x.dmxRange);
  return nf ? oflDmx(nf.dmxRange[0]) : null;
}
function oflSlots(ch, wheels, want) {
  const out = [];
  for (const c of oflCaps(ch)) {
    if (c.type !== 'WheelSlot' || !Number.isInteger(c.slotNumber)) continue;
    const slot = wheels?.[c.wheel || ch._name]?.slots?.[c.slotNumber - 1]; if (!slot) continue;
    let v = Array.isArray(c.dmxRange) ? c.dmxRange[0] : 0; if (v > 255) v = Math.floor(v / 256);
    if (want === 'color' && (slot.type === 'Color' || slot.type === 'Open')) {
      const name = slot.type === 'Open' ? 'White' : slot.name || `Colore ${c.slotNumber}`;
      const rgb = slot.type === 'Open' ? [1, 1, 1] : hexToRgb(slot.colors?.[0]);
      out.push(rgb ? { name, value: v, rgb } : { name, value: v });
    } else if (want === 'gobo' && (slot.type === 'Gobo' || slot.type === 'Open')) {
      out.push({ name: slot.type === 'Open' ? 'Open' : slot.name || `Gobo ${c.slotNumber}`, value: v });
    }
  }
  return out;
}
function oflToModels(fx, vendor, key) {
  const ac = fx.availableChannels || {}, fineOf = {};
  for (const [n, ch] of Object.entries(ac)) { ch._name = n; (ch.fineChannelAliases || []).forEach((a, i) => { fineOf[a] = [n, i]; }); }
  const modes = [];
  for (const m of fx.modes || []) {
    if ((m.channels || []).some(c => c !== null && typeof c !== 'string')) continue; // canali matrice: non gestiti
    const roles = m.channels.map((c, i) => {
      if (c === null) return `ch_${i + 1}`;
      if (fineOf[c]) { const [base, k] = fineOf[c]; return `${oflChannelRole(base, ac[base])}_fine${k ? k + 1 : ''}`; }
      return oflChannelRole(c, ac[c]);
    });
    const ci = roles.indexOf('color'), gi = roles.indexOf('gobo'), defaults = {};
    m.channels.forEach((c, i) => { if (typeof c !== 'string' || fineOf[c] || !ac[c]) return; const v = oflDefault(ac[c], roles[i]); if (v != null) defaults[i] = v; });
    // lampada: capacita' con commento "Lamp on" / "Lamp off" sullo stesso canale
    let lampSpec = null;
    m.channels.forEach((c, i) => {
      if (lampSpec || typeof c !== 'string' || !ac[c]) return;
      const caps = oflCaps(ac[c]), at = re => caps.find(x => re.test(String(x.comment || '')) && x.dmxRange);
      const on = at(/^lamp\s*on\b/i), off = at(/^lamp\s*off\b/i);
      if (on && off) lampSpec = { ch: i, on: oflDmx(on.dmxRange[0]), off: oflDmx(off.dmxRange[0]) };
    });
    modes.push({
      mode: m.shortName || m.name, channels: roles, defaults, lampSpec,
      colors: ci >= 0 ? oflSlots(ac[m.channels[ci]], fx.wheels, 'color') : [],
      gobos: gi >= 0 ? oflSlots(ac[m.channels[gi]], fx.wheels, 'gobo') : [],
      pan_range: fx.physical?.focus?.panMax, tilt_range: fx.physical?.focus?.tiltMax,
    });
  }
  return finish(vendor, fx.name, modes, { source: 'ofl', notes: `Open Fixture Library ${key} (MIT) — verificare sul manuale` });
}

/* ---- DMXControl DDF (XML 2 e 3) ---- */
// parser XML minimo: elementi, attributi e testo, quanto basta per i DDF
function parseXml(xml) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' }, stack = [root];
  const ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[3]) {
      if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
      const attrs = {}; m[4].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { attrs[k] = ent(a ?? b); });
      const el = { tag: m[3].toLowerCase(), attrs, children: [], text: '' }; top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6]) top.text += ent(m[6]);
  }
  return root;
}
const find = (el, tag) => { for (const c of el.children) { if (c.tag === tag) return c; const r = find(c, tag); if (r) return r; } return null; };
const findAll = (el, tag, out = []) => { for (const c of el.children) { if (c.tag === tag) out.push(c); findAll(c, tag, out); } return out; };
const textOf = (el, tag) => (find(el, tag)?.text || '').trim();

const DDF3_TAG = { dimmer: 'dimmer', shutter: 'shutter', strobe: 'shutter', colorwheel: 'color', gobowheel: 'gobo', goborotation: 'gobo_rotation', zoom: 'zoom', focus: 'focus', iris: 'iris', prism: 'prism', ptspeed: 'speed', pan: 'pan', tilt: 'tilt', red: 'red', green: 'green', blue: 'blue', white: 'white', amber: 'amber', uv: 'uv', cyan: 'cyan', magenta: 'magenta', yellow: 'yellow', lime: 'lime' };
function ddf3ToModels(doc, meta) {
  const fn = find(doc, 'functions'); if (!fn) return [];
  const roleAt = {}; let max = -1;
  const put = (ch, role) => { ch = +ch; if (!Number.isInteger(ch) || ch < 0 || ch > 511) return; max = Math.max(max, ch); if (!roleAt[ch] || roleAt[ch] === 'shutter' && role === 'dimmer') roleAt[ch] = role; };
  (function walk(el) {
    for (const c of el.children) {
      const role = DDF3_TAG[c.tag] || slug(c.tag);
      if (c.attrs.dmxchannel !== undefined) put(c.attrs.dmxchannel, role);
      if (c.attrs.finedmxchannel !== undefined) put(c.attrs.finedmxchannel, `${role}_fine`);
      walk(c);
    }
  })(fn);
  const channels = Array.from({ length: max + 1 }, (_, i) => roleAt[i] || `ch_${i + 1}`);
  const steps = (wheel, types) => wheel ? wheel.children.filter(s => s.tag === 'step' && types.includes(s.attrs.type)).map(s => {
    const o = { name: (s.attrs.caption || (s.attrs.type === 'open' ? 'Open' : s.attrs.type)).trim(), value: +s.attrs.mindmx };
    const rgb = s.attrs.type === 'open' ? [1, 1, 1] : hexToRgb(s.attrs.val); if (rgb && types.includes('color')) o.rgb = rgb; return o;
  }) : [];
  const pan = find(fn, 'pan'), tilt = find(fn, 'tilt'), defaults = {};
  // shutter: inizio del primo step "open" (nota TD 42)
  const sh = findAll(fn, 'shutter').find(x => x.attrs.dmxchannel !== undefined), open = sh?.children.find(x => x.tag === 'step' && x.attrs.type === 'open');
  if (open && channels[+sh.attrs.dmxchannel] === 'shutter') defaults[+sh.attrs.dmxchannel] = +open.attrs.mindmx;
  return finish(meta.vendor, meta.name, [{
    mode: meta.mode, channels, defaults, colors: steps(find(fn, 'colorwheel'), ['color', 'open']), gobos: steps(find(fn, 'gobowheel'), ['gobo', 'open']),
    pan_range: +(pan?.attrs.range || find(pan || fn, 'range')?.attrs.range) || 0, tilt_range: +(tilt?.attrs.range) || 0,
  }], meta.extra);
}
const DDF2_TYPE = { pan: 'pan', panfine: 'pan_fine', tilt: 'tilt', tiltfine: 'tilt_fine', dimmer: 'dimmer', r: 'red', g: 'green', b: 'blue', red: 'red', green: 'green', blue: 'blue', color: 'color', gobo: 'gobo', shutter: 'shutter', strobe: 'shutter', iris: 'iris', zoom: 'zoom', focus: 'focus', prism: 'prism' };
// DDF 2: gli script "Get..." dicono per ogni intervallo del canale quale voce
// di menu mostrare: !if|({channel_6} > 244) and ({channel_6} < 256)| !set_control|shutter_mode|2$
// -> [{ch, lo, hi, caption}] incrociando con le voci (item value -> caption) dei dropdown
function ddf2MenuRanges(doc) {
  const captions = {};
  for (const d of findAll(doc, 'dropdown')) for (const it of d.children) if (it.tag === 'item') captions[`${d.attrs.name}|${it.attrs.value}`] = String(it.attrs.caption || '').replace(/\*$/, '').trim();
  const out = [];
  for (const p of findAll(doc, 'procedure')) {
    for (const block of p.text.split('!if|').slice(1)) {
      const bar = block.indexOf('|'); if (bar < 0) continue;
      const cond = block.slice(0, bar), body = block.slice(bar + 1);
      const ranges = [...cond.matchAll(/\{channel_(\d+)\}\s*>\s*(-?\d+)\)\s*and\s*\(\{channel_\1\}\s*<\s*(\d+)/g)].map(m => ({ ch: +m[1], lo: +m[2] + 1, hi: +m[3] - 1 }));
      if (!ranges.length) continue;
      for (const m of body.matchAll(/!set_control\|([\w]+)\|(-?\d+)\$/g)) {
        const caption = captions[`${m[1]}|${m[2]}`]; if (caption) ranges.forEach(r => out.push({ ...r, caption }));
      }
    }
  }
  return out;
}
function ddf2ToModels(doc, meta) {
  const fns = findAll(doc, 'function').filter(f => f.attrs.channel !== undefined);
  if (!fns.length) return [];
  const byCh = {}; let max = -1, colorSeen = false, goboSeen = false;
  for (const f of fns) {
    const ch = +f.attrs.channel; if (!Number.isInteger(ch) || ch < 0 || ch > 511 || byCh[ch]) continue; max = Math.max(max, ch);
    let role = DDF2_TYPE[String(f.attrs.type || '').toLowerCase()] || roleFromName(f.attrs.name);
    if (role === 'color') { if (colorSeen) role = 'color_2'; colorSeen = true; }
    if (role === 'gobo') { if (goboSeen) role = 'gobo_2'; goboSeen = true; }
    byCh[ch] = role;
  }
  const channels = Array.from({ length: max + 1 }, (_, i) => byCh[i] || `ch_${i + 1}`);
  // slot: dal menu del pannello DMXControl (caption + valore + colore)
  const drops = findAll(doc, 'dropdown');
  const items = (re, color) => {
    const d = drops.find(x => re.test(x.attrs.name || '') || re.test(x.attrs.action || '')); if (!d) return [];
    return d.children.filter(i => i.tag === 'item' && +i.attrs.value >= 0).map(i => {
      const o = { name: String(i.attrs.caption || '').replace(/\*$/, '').trim(), value: +i.attrs.value };
      const rgb = color && hexToRgb(i.attrs.color); if (rgb) o.rgb = rgb; return o;
    });
  };
  // valori di default (nota TD 42): sequenza di inizializzazione della scheda,
  // poi gli intervalli DMX che gli script del pannello danno a ogni voce
  // dei menu ("open", "off", "park, no function", "lamp on"...)
  const defaults = {};
  String(doc.attrs.initsequence || '').split(';').forEach(c => { const m = /^\s*set\s+(\d+)\s+(\d+)\s*$/i.exec(c); if (m) defaults[+m[1]] = +m[2]; });
  const menu = ddf2MenuRanges(doc), first = (ch, re) => { const r = menu.filter(x => x.ch === ch && re.test(x.caption)); return r.length ? r : null; };
  const sh = channels.indexOf('shutter'), open = sh >= 0 && first(sh, /^(shutter\s+)?open/i);
  if (open) { const w = open.reduce((a, b) => (b.hi - b.lo > a.hi - a.lo ? b : a)); defaults[sh] = w.lo; }
  channels.forEach((r, ch) => {
    if (TD_DRIVEN.has(r) || defaults[ch] != null) return;
    const n = first(ch, /^(off|open|no function|park|none|stop|no rotation|normal|standard|index)\b/i); if (n) defaults[ch] = n[0].lo;
  });
  const fmt = l => l && [...new Set(l.map(x => `${x.lo}–${x.hi}`))].slice(0, 2).join(', ');
  let lamp = '', lampSpec = null;
  for (let ch = 0; ch < channels.length && !lamp; ch++) {
    const on = first(ch, /^lamp\s*on/i), off = first(ch, /^lamp\s*off/i);
    if (on || off) lamp = `canale ${ch + 1} (${channels[ch]})${on ? ' on ' + fmt(on) : ''}${off ? ', off ' + fmt(off) : ''}`;
    if (on && off) lampSpec = { ch, on: on[0].lo, off: off[0].lo };
  }
  return finish(meta.vendor, meta.name, [{ mode: meta.mode, channels, defaults, lamp, lampSpec, colors: items(/colou?r\s*1?_?(dropdown|$)|setcolou?r1?$/i, true), gobos: items(/gobo\s*1?_?(dropdown|$)|setgobo1?$/i, false) }], meta.extra);
}
function ddfToModels(xml, meta = {}) {
  const doc = parseXml(String(xml || ''));
  const dev = find(doc, 'device'); if (!dev) return [];
  const info = find(dev, 'information') || dev;
  let name = meta.name || textOf(info, 'model') || textOf(info, 'name'), mode = meta.mode || '';
  const pm = /^(.*)\(([^()]*)\)\s*$/.exec(name); if (!meta.mode && pm) { name = pm[1].trim(); mode = pm[2].trim(); }
  const vendor = meta.vendor || textOf(info, 'vendor') || 'Sconosciuto';
  const author = textOf(info, 'author'), id = meta.id || textOf(info, 'ddf-library-id');
  const m = { vendor, name, mode, extra: { source: 'ddf', notes: `DMXControl DDF #${id}${author ? ' di ' + author : ''} (CC-BY-SA-4.0) — verificare sul manuale` } };
  return find(dev, 'functions') ? ddf3ToModels(dev, m) : ddf2ToModels(dev, m);
}

/* ---- indice, ricerca, cache ---- */
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
function search(index, q, limit = 60) {
  const words = norm(q).split(' ').filter(Boolean); if (!words.length) return [];
  const scored = [];
  for (const e of index) {
    const hay = e._hay || (e._hay = ` ${norm(`${e.vendor} ${e.name} ${e.mode || ''}`)} ${norm(`${e.vendor} ${e.name}`).replace(/ /g, '')} `);
    if (!words.every(w => hay.includes(w))) continue;
    const score = words.reduce((s, w) => s + (hay.includes(` ${w} `) ? 2 : hay.includes(` ${w}`) ? 1 : 0), 0) + (e.src === 'ofl' ? .5 : 0);
    scored.push([score, e]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].vendor.localeCompare(b[1].vendor) || a[1].name.localeCompare(b[1].name))
    .slice(0, limit).map(([, e]) => ({ src: e.src, id: e.id, vendor: e.vendor, name: e.name, mode: e.mode || '' }));
}
const prettyKey = k => k.replace(/-/g, ' ').replace(/\b([a-z])/g, c => c.toUpperCase());

function createLibrary({ dir, fetchImpl = globalThis.fetch, log = console } = {}) {
  let index = null, building = null;
  const indexFile = path.join(dir, 'index.json');
  const getJson = async url => { const r = await fetchImpl(url, { headers: { 'user-agent': 'gaia-plancia' } }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
  const getText = async url => { const r = await fetchImpl(url, { headers: { 'user-agent': 'gaia-plancia' } }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); };
  async function build() {
    const entries = [], errors = [];
    try {
      const [tree, mans] = await Promise.all([getJson(OFL_TREE), getJson(`${OFL_RAW}manufacturers.json`)]);
      for (const t of tree.tree || []) {
        const m = /^fixtures\/([^/]+)\/([^/]+)\.json$/.exec(t.path); if (!m) continue;
        entries.push({ src: 'ofl', id: `${m[1]}/${m[2]}`, vendor: mans[m[1]]?.name || prettyKey(m[1]), name: prettyKey(m[2]) });
      }
    } catch (e) { errors.push('OFL: ' + e.message); }
    try {
      const [devs, ddfs] = await Promise.all([getJson(`${DDF_API}/devices`), getJson(`${DDF_API}/ddfs`)]);
      const dev = new Map((devs.data || []).map(d => [d.id, d]));
      for (const f of ddfs.data || []) {
        const d = dev.get(f.device_id); if (!d || f.deleted_at) continue;
        entries.push({ src: 'ddf', id: String(f.id), vendor: d.vendor?.name || '', name: d.name, mode: f.mode || '' });
      }
    } catch (e) { errors.push('DDF: ' + e.message); }
    if (!entries.length) throw new Error(errors.join(' · ') || 'nessuna voce');
    const doc = { builtAt: Date.now(), errors, entries };
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(indexFile, JSON.stringify(doc));
    return doc;
  }
  async function loadIndex(refresh) {
    if (index && !refresh) return index;
    if (!refresh) {
      try { const doc = JSON.parse(await fs.promises.readFile(indexFile, 'utf8')); index = doc; if (Date.now() - doc.builtAt < INDEX_MAX_AGE) return doc; } catch { /* da costruire */ }
    }
    if (!building) building = build().then(d => { index = d; return d; }).catch(e => { if (index) { log.warn?.('Libreria fixture: aggiornamento fallito, uso la cache:', e.message); return index; } throw e; }).finally(() => { building = null; });
    return building;
  }
  async function fixture(src, id) {
    const safe = String(id).replace(/[^a-z0-9_.-]+/gi, '_'), file = path.join(dir, `${src}-${safe}.${src === 'ofl' ? 'json' : 'xml'}`);
    if (src === 'ofl') {
      if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(id)) throw new Error('id OFL non valido');
      let raw; try { raw = await fs.promises.readFile(file, 'utf8'); } catch { raw = await getText(`${OFL_RAW}${id}.json`); await fs.promises.mkdir(dir, { recursive: true }); await fs.promises.writeFile(file, raw); }
      const idx = await loadIndex().catch(() => null), e = idx?.entries.find(x => x.src === 'ofl' && x.id === id);
      return oflToModels(JSON.parse(raw), e?.vendor || prettyKey(id.split('/')[0]), id);
    }
    if (src === 'ddf') {
      if (!/^\d+$/.test(id)) throw new Error('id DDF non valido');
      let raw; try { raw = await fs.promises.readFile(file, 'utf8'); } catch { raw = await getText(`${DDF_API}/ddfs/${id}/file`); await fs.promises.mkdir(dir, { recursive: true }); await fs.promises.writeFile(file, raw); }
      const idx = await loadIndex().catch(() => null), e = idx?.entries.find(x => x.src === 'ddf' && x.id === id);
      return ddfToModels(raw, e ? { id, vendor: e.vendor, name: e.name, mode: e.mode } : { id });
    }
    throw new Error('sorgente sconosciuta');
  }
  return {
    async search(q, refresh) { const idx = await loadIndex(refresh); return { results: search(idx.entries, q), total: idx.entries.length, builtAt: idx.builtAt, errors: idx.errors || [] }; },
    fixture,
  };
}

module.exports = { createLibrary, oflToModels, ddfToModels, parseXml, search, roleFromName, ddf2MenuRanges };
