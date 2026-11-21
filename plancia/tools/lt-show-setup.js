// Progetto dello show Lowtopic 28/11/2026, eseguito DENTRO la Plancia in esercizio
// (node tools/live-page.js tools/lt-show-setup.js --url "http://127.0.0.1:8080/?profilo=ops").
// Apre "LT 28/11 Mauro" (prima ne fa una copia), tiene solo le pagine che servono,
// rifa' la Regia, crea la timeline di 60 minuti (luci, effetti, laser) e la manda a DMX Master.
// Le scene lt_* devono gia' esistere in DMX Master (tools/lt-scenes.js).
const SRC = 'proj-yhj35kw', DUR = 3600, STEP = 120;
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 40 && !tdScenes().length; i++) await wait(500);
if (!G.ok || !tdScenes().length) throw new Error('DMX Master non visibile (Gaia non collegata)');
const LT = [['lt_fuoco', 'LT Fuoco'], ['lt_ghiaccio', 'LT Ghiaccio'], ['lt_rosso_blu', 'LT Rosso Blu'], ['lt_oro', 'LT Oro'],
  ['lt_caldo_freddo', 'LT Caldo Freddo'], ['lt_blu', 'LT Blu'], ['lt_rosso', 'LT Rosso'], ['lt_fuoco_ghiaccio', 'LT Fuoco Ghiaccio']];
const missing = LT.filter(([id]) => !tdSceneById(id)).map(([id]) => id);
if (missing.length) throw new Error('scene mancanti in DMX Master: ' + missing.join(', '));
const out = {};

// 1. copia di sicurezza, poi apertura
const bak = projDuplicate(SRC);
projRename(bak, 'LT 28/11 Mauro · prima della pulizia 21/11');
out.copia = bak;
if (!projLoad(SRC)) throw new Error('progetto non trovato: ' + SRC);
out.uiRevAperto = L.uiRev;
// aggiornamenti dell'interfaccia (quelli che una pagina ricaricata farebbe da sola), PRIMA della pulizia
migrateUiShowTimeline(); migrateUiConsolePages(); migrateUiAudioPage(); migrateUiNoChase(); migrateUiOneDmxV8(); migrateUiLaserPage();
migrateUiLaserScenes(); migrateUiHeadMotion(); migrateUiChase(); migrateUiLaserFx(); migrateUiLightFx(); migrateUiTracks(); migrateUiPageGroups();
migrateUiTimelinePage(); migrateUiHeadPages(); migrateUiRigConfig(); migrateUiChannelTest(); migrateUiAudioTrack(); migrateUiLaserTint();
migrateUiLaserRotY(); migrateUiRender3d(); migrateUiMapping();
out.uiRev = L.uiRev;
out.pagineDiPrima = L.pages.map(p => p.name);

// 2. pagine
const pg = n => L.pages.find(p => p.name === n);
const find = (p, f) => p?.widgets.find(f);
const clone = (w, x, y, ww, h, o = {}) => ({ ...JSON.parse(JSON.stringify(w)), id: uid(), x, y, w: ww, h, ...o });
const oldRegia = pg('Regia'), tlPage = pg('Timeline'), fxPage = pg('Sequenze ed effetti'), laserPage = pg('Laser');
const tlw = find(tlPage, w => w.type === 'timeline' && w.addr === '/show');
if (!tlw) throw new Error('manca la timeline nella pagina Timeline');
const oldFader = a => find(oldRegia, w => w.type === 'fader' && w.addr === a);
const fader = (label, addr, x, color) => { const o = oldFader(addr); return o ? clone(o, x, 6, 2, 4, { label }) : W('fader', x, 6, 2, 4, { label, addr, value: 1, color }); };
const bo = find(oldRegia, w => w.addr === '/dmx/blackout') || W('button', 0, 0, 1, 1, { label: 'Blackout', addr: '/dmx/blackout', mode: 'toggle', color: SWATCH[2] });
const st = find(oldRegia, w => w.addr === '/dmx/strobe') || W('button', 0, 0, 1, 1, { label: 'Flash strobo', addr: '/dmx/strobe', color: SWATCH[5] });
const lbo = find(laserPage, w => w.addr === '/laser/blackout');
const regia = { id: oldRegia?.id || uid(), name: 'Regia', widgets: [
  W('cuestack', 0, 0, 4, 6, { label: 'Scene GO', color: SWATCH[3] }),
  W('scenes', 4, 0, 4, 6, { label: 'Scene a mano', addr: '/dmx/scene', items: '', cols: 2, value: -1, color: SWATCH[0] }),
  W('stage', 8, 0, 8, 4, { label: 'Palco', view: 'render' }),
  W('clock', 8, 4, 4, 1, { label: 'Show', mode: 'show', color: SWATCH[0] }),
  W('clock', 12, 4, 4, 1, { label: 'Ora', mode: 'tod', color: SWATCH[5] }),
  clone(tlw, 8, 5, 8, 3, { label: 'Timeline show', readonly: true, onlyTracks: ['fx', 'laser'] }),
  fader('Master', '/dmx/master', 0, SWATCH[0]),
  fader('Colonne', '/dmx/group/ledbar', 2, SWATCH[2]),
  fader('Consolle', '/dmx/group/consolle', 4, SWATCH[1]),
  fader('Fronte', '/dmx/group/fronte', 6, SWATCH[4]),
  clone(bo, 8, 8, 2, 2, { label: 'Blackout' }),
  clone(st, 10, 8, 2, 2, { label: 'Flash strobo' }),
  W('fader', 12, 8, 2, 2, { label: 'Fade scene (s)', addr: '/dmx/fade', min: 0, max: 10, value: .4, color: SWATCH[1] }),
  ...(lbo ? [clone(lbo, 14, 8, 2, 2, { label: 'BLACKOUT laser' })] : []),
] };
// Effetti: solo la traccia EFFETTI e la libreria degli effetti (niente chase: i chase vecchi hanno viola e verde)
const fxLib = find(fxPage, w => w.type === 'lightfx');
const effetti = { id: fxPage?.id || uid(), name: 'Effetti', group: 'Luci', widgets: [
  clone(find(fxPage, w => w.type === 'timeline') || tlw, 0, 0, 16, 4, { label: 'Timeline effetti', readonly: false, onlyTracks: ['fx'] }),
  fxLib ? clone(fxLib, 0, 4, 16, 6) : W('lightfx', 0, 4, 16, 6, { label: 'Effetti luci' }),
] };
const keep = [regia, tlPage, effetti, laserPage, pg('Audio'), pg('Palco'), pg('Config rig'), pg('Test canali')].filter(Boolean);
L.pagesBackup = { ...(L.pagesBackup || {}), lowtopic_20261121: JSON.parse(JSON.stringify(L.pages)) };
L.pages = keep; pi = 0; selId = null;

// 3. scene: solo le LT, in quest'ordine
L.sceneSetlist = LT.map(([id]) => id);
L.sceneHidden = tdScenes().map(s => s.id).filter(id => !L.sceneSetlist.includes(id));

// 4. effetti: due in piu' per la consolle
const addFx = f => { if (!lightFx().some(x => x.id === f.id)) L.lightFx.push(f); };
addFx({ id: 'efx-lt-cons-scint', name: 'Consolle: scintillio', target: { group: 'consolle' }, channel: 'dimmer', shape: 'random', period: { value: .25, unit: 'beats' }, spread: { phase: 0, mirror: false }, min: 0, max: 1, duty: .35 });
addFx({ id: 'efx-lt-cons-onda', name: 'Consolle: onda', target: { group: 'consolle' }, channel: 'dimmer', shape: 'sine', period: { value: 4, unit: 'beats' }, spread: { phase: .25, mirror: true }, min: .1, max: 1 });

// 5. timeline di 60 minuti: luci ogni 120 s, effetti ogni 120 s sfalsati di 60, laser ogni 120 s
const N = DUR / STEP;
const light = Array.from({ length: N }, (_, k) => { const [id, label] = LT[k % LT.length]; return { t: k * STEP, name: label, targets: `@${id}; fade=4` }; });
const FXSEQ = [['fx-centro'], ['efx-nfxw4ak', 'efx-6hu3jdm'], ['fx-scintillio', 'efx-lt-cons-scint'], [], ['efx-i9hd4eh', 'efx-lt-cons-onda'], ['efx-lt-cons-scint'], ['fx-centro', 'efx-6hu3jdm'], []];
const known = new Set(lightFx().map(f => f.id));
L.fxTimeline = { cues: Array.from({ length: N }, (_, k) => ({ time: k * STEP + 60, label: '', effects: FXSEQ[k % FXSEQ.length].filter(id => known.has(id)) })) };
const LZ = ['tpl-cerchio', 'tpl-tunnel-fasci', 'tpl-raggiera', 'tpl-onda', 'tpl-spirale', 'tpl-lissajous', 'tpl-scanner', 'tpl-stella', 'tpl-cono', 'tpl-infinito', 'ilda-kd4wmxj', 'ilda-8v0gpml']
  .filter(id => laserScenes().some(s => s.id === id));
L.laserTimeline = { active: true, cues: Array.from({ length: N }, (_, k) => { const id = LZ[k % LZ.length]; return { time: k * STEP, label: laserScenes().find(s => s.id === id).name, cube: 'all', mode: 'scene', scene: id }; }) };
L.audioTimeline = { active: false, cues: [] };   // la musica arriva dal vivo
L.videoTimeline = { active: false, cues: [] };
L.chaseTimeline = { cues: [] };
tlw.cues = serializeCues(light); tlw.duration = DUR; tlw.bpm = 120; tlw.label = 'Timeline show';
syncShowWidgets(tlw); save(); render(); refreshShowTimelines();

// 6. a DMX Master: luci + effetti in un documento solo (sostituisce la timeline che c'era)
const { doc, notes } = timelineToTD(tlw);
doc.name = 'Lowtopic 28/11'; doc.force = true; delete doc.base_rev;
const chk = await tdTimelineRequest({ ...doc, dry_run: true });
if (!chk.ok) throw new Error('DMX Master rifiuta la timeline: ' + (chk.errors || []).join(' | '));
const r = await tdTimelineRequest(doc);
if (!r.ok) throw new Error('caricamento rifiutato: ' + (r.errors || []).join(' | '));
tlw.tdBaseRev = r.rev; L.tlTdDirty = false; syncShowWidgets(tlw); save();
out.td = { cue: r.cues, durata: r.length, rev: r.rev, avvisi: chk.warnings || [], note: notes };

// 7. salva il progetto
projUpdate(L._projectId); updateProjChip();
pi = 0; render();
out.progetto = L._projectName;
out.pagine = L.pages.map(p => `${p.name} (${p.widgets.length})`);
out.scaletta = projScenes().map(s => s.label || s.id);
out.effetti = L.fxTimeline.cues.length; out.laser = L.laserTimeline.cues.length; out.luci = parseCues(tlw).length;
out.problemi = projDirty() ? 'progetto con modifiche non salvate' : 'salvato';
return out;
