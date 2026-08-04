// GAIA · Arte Viva — quadro vivente generativo
// Campi Rothko sfumati + flow-field di particelle + nucleo respirante.
// Tutto guidato dal payload WS di ThreeViewEngineGAME: mood → palette,
// energia → velocità, stress → turbolenza, persone → orbi con nome,
// luci → braci, pensiero → testo in dissolvenza. Nessuna libreria.
'use strict';

// ── Canvas / DPR ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('gaiaCanvas');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

// offscreen: bande Rothko a bassissima risoluzione (l'upscale fa da blur gratis)
const bandCv = document.createElement('canvas');
bandCv.width = 16; bandCv.height = 128;
const bandCtx = bandCv.getContext('2d');

// vignettatura pre-renderizzata (solo al resize)
let vignetteCv = null;

// grana pellicola pre-renderizzata (tile fisso)
const grainCv = document.createElement('canvas');
grainCv.width = 128; grainCv.height = 128;
(function buildGrain() {
    const g = grainCv.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = 118 + Math.random() * 20 | 0;
        img.data[i] = img.data[i+1] = img.data[i+2] = v;
        img.data[i+3] = 14;
    }
    g.putImageData(img, 0, 0);
})();
let grainPattern = null;

function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    vignetteCv = document.createElement('canvas');
    vignetteCv.width = W; vignetteCv.height = H;
    const v = vignetteCv.getContext('2d');
    const g = v.createRadialGradient(W/2, H/2, Math.min(W,H)*0.42, W/2, H/2, Math.max(W,H)*0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    v.fillStyle = g;
    v.fillRect(0, 0, W, H);

    grainPattern = ctx.createPattern(grainCv, 'repeat');
    seedParticles();
}
window.addEventListener('resize', resize);

// ── Palette per mood ──────────────────────────────────────────────────────────
// bands: [alto, centro, basso] RGB · hue: range HSL particelle · accent RGB
const PALETTES = {
    neutra:    { bands: [[10,14,26],[16,25,44],[7,10,18]],  hue: [175, 215], accent: [0, 255, 204] },
    calm:      { bands: [[8,22,24],[13,42,39],[5,15,17]],   hue: [150, 185], accent: [80, 230, 190] },
    stress:    { bands: [[28,10,12],[52,17,14],[17,7,9]],   hue: [5, 30],    accent: [255, 115, 85] },
    social:    { bands: [[30,20,10],[56,39,17],[21,13,8]],  hue: [32, 52],   accent: [255, 195, 100] },
    curiosity: { bands: [[20,12,34],[39,23,62],[13,9,23]],  hue: [262, 300], accent: [190, 135, 255] },
};
// alias per eventuali stati storici con altri nomi
const MOOD_ALIAS = { serena: 'calm', sofferente: 'stress', instabile: 'stress',
                     viva: 'social', stabile: 'neutra', neutrale: 'neutra' };

// palette corrente = lerp continuo verso la target (transizioni fluide di mood)
const cur = {
    bands: [[10,14,26],[16,25,44],[7,10,18]],
    hue:   [175, 215],
    accent:[0, 255, 204],
};

// ── Stato dai dati WS (lerped) ────────────────────────────────────────────────
const S = {
    mood: 'neutra', energy: 50, stress: 0, calm: 0, social: 0, curiosity: 0,
    lifeIndex: 50, lightsOn: 0, voice: 'idle',
};
let people = [];          // [{name, emotion}]
let thoughtTarget = '';   // ultimo pensiero ricevuto
let lastLevel = null;
let lastDreamTs = 0;

// Stesso algoritmo FNV-1a del vocabolario asemico (web/asemic.js) e del
// feed TouchDesigner (/gaia/canvas/.../seed) — "sedia" produce sempre lo
// stesso segno qui, sul Pi, e in TD: e' questo che rende Gaia coerente
// come identita' visiva invece che tre generativi scollegati.
function fnv1a(str) {
    let h = 2166136261 >>> 0;
    for (const ch of String(str).toLowerCase()) {
        h ^= ch.codePointAt(0);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

function lerp(a, b, f) { return a + (b - a) * f; }

// Stesso vocabolario solfeggio→glifo di pi/screen/main.py e web/welcome.html
// (nota MIDI % 12 → parola) — riusato qui per seedare colore/identità delle
// note dell'AV Herbarium con lo stesso fnv1a di sopra, coerente ovunque.
const NOTE_WORDS = ['do', 'dodiesis', 're', 'rediesis', 'mi', 'fa', 'fadiesis',
                     'sol', 'soldiesis', 'la', 'ladiesis', 'si'];

// ── WebSocket ─────────────────────────────────────────────────────────────────
// Nessuna scritta a schermo (mood/presenze/luci) — l'opera deve leggersi da
// sola, per intero visiva. Resta solo il puntino di stato connessione.
const dotEl = document.getElementById('ws-dot');

function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.hostname}:1880/gaia`);
    ws.onopen = () => { dotEl.className = 'ok'; };
    ws.onerror = () => { dotEl.className = 'err'; };
    ws.onclose = () => {
        dotEl.className = 'err';
        setTimeout(connectWS, 3000);
    };
    ws.onmessage = e => {
        try {
            const d = JSON.parse(e.data);
            const soul = d.soul || {};
            S.moodTarget      = MOOD_ALIAS[soul.mood] || (PALETTES[soul.mood] ? soul.mood : 'neutra');
            S.energyTarget    = soul.energy ?? 50;
            S.stressTarget    = soul.stress ?? 0;
            S.calmTarget      = soul.calm ?? 0;
            S.socialTarget    = soul.social ?? 0;
            S.curiosityTarget = soul.curiosity ?? 0;
            S.lifeTarget      = soul.lifeIndex ?? 50;
            S.voice           = d.voiceStatus?.status || 'idle';
            const lights = Array.isArray(d.lights) ? d.lights : [];
            S.lightsTarget = lights.filter(l => l.power).length;
            people = (Array.isArray(d.people) ? d.people : [])
                .filter(p => p.present !== false)
                .map(p => ({ name: p.name || '…', emotion: p.emotion || 'neutral', room: p.room || 'unknown' }));
            if (d.thought) thoughtTarget = d.thought;

            // Sogno nuovo → sequenza dedicata (velo viola + testo in alto)
            if (d.lastDreamTs && d.lastDreamTs !== lastDreamTs) {
                lastDreamTs = d.lastDreamTs;
                triggerDream(d.lastDream || '');
            }

            // Livello RPG salito → burst dorato dal nucleo
            const lvl = d.progression?.level;
            if (lastLevel !== null && lvl != null && lvl > lastLevel) triggerLevelBurst();
            if (lvl != null) lastLevel = lvl;

            stepObjectSources(d);
            stepHerbNotes(d);
        } catch (_) {}
    };
}

// ── Flow field ────────────────────────────────────────────────────────────────
// Somma di seni: economico, organico, senza rumore pre-calcolato.
function fieldAngle(x, y, t, turb) {
    const s = 0.0016;
    return Math.sin(x * s * 1.3 + t * 0.21) * 1.4
         + Math.cos(y * s * 1.7 - t * 0.16) * 1.2
         + Math.sin((x + y) * s * 0.8 + t * 0.07) * (0.6 + turb * 2.4);
}

// ── Particelle ────────────────────────────────────────────────────────────────
const MAX_PARTICLES = 620;
let particles = [];
let activeCount = MAX_PARTICLES;

function seedParticles() {
    particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) particles.push(newParticle());
}
function newParticle() {
    return {
        x: Math.random() * W,
        y: Math.random() * H,
        hue: Math.random(),                 // 0..1 dentro il range palette
        life: 120 + Math.random() * 260,    // frame residui
        speed: 0.5 + Math.random() * 0.9,
    };
}

// tap/click → impulso radiale nel campo
const ripples = [];
function addRipple(x, y) {
    ripples.push({ x, y, t0: performance.now() });
    if (ripples.length > 4) ripples.shift();
}
canvas.addEventListener('pointerdown', e => addRipple(e.clientX, e.clientY));

// ── Pensiero (crossfade) ──────────────────────────────────────────────────────
const thought = { text: '', alpha: 0, fading: false };

function stepThought() {
    if (thought.text !== thoughtTarget) {
        thought.alpha -= 0.025;                    // dissolve il vecchio
        if (thought.alpha <= 0) { thought.text = thoughtTarget; thought.alpha = 0; }
    } else if (thought.text && thought.alpha < 1) {
        thought.alpha = Math.min(1, thought.alpha + 0.012);
    }
}

function drawThought(t) {
    if (!thought.text || thought.alpha <= 0) return;
    const breath = 0.72 + 0.1 * Math.sin(t * 0.6);
    ctx.save();
    ctx.globalAlpha = thought.alpha * breath * 0.65;
    const size = Math.max(15, Math.min(24, W / 46));
    ctx.font = `italic ${size}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = `rgb(${cur.accent[0]|0}, ${cur.accent[1]|0}, ${cur.accent[2]|0})`;
    ctx.textAlign = 'center';

    // word-wrap su max 2 righe
    const maxW = W * 0.72;
    const words = `“${thought.text}”`.split(' ');
    const lines = [''];
    for (const w of words) {
        const probe = lines[lines.length-1] ? lines[lines.length-1] + ' ' + w : w;
        if (ctx.measureText(probe).width > maxW && lines[lines.length-1]) {
            if (lines.length === 2) { lines[1] += '…'; break; }
            lines.push(w);
        } else lines[lines.length-1] = probe;
    }
    const y0 = H * 0.885 - (lines.length - 1) * (size * 1.3);
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, y0 + i * size * 1.3));
    ctx.restore();
}

// ── Sogno (sequenza dedicata, più lenta e più lunga del pensiero) ────────────
// Stesso viola "curiosity"/sogno usato su welcome.html e pi/screen — un
// sogno non è un pensiero come gli altri, merita un momento diverso.
const DREAM_HOLD_MS = 42000;
const dream = { text: '', alpha: 0, activeUntil: 0 };

function triggerDream(text) {
    if (!text) return;
    dream.text = text;
    dream.activeUntil = performance.now() + DREAM_HOLD_MS;
}

function stepDream(nowMs) {
    if (nowMs < dream.activeUntil) dream.alpha = Math.min(1, dream.alpha + 0.01);
    else if (dream.alpha > 0) dream.alpha = Math.max(0, dream.alpha - 0.006);
}

function drawDream(t) {
    if (dream.alpha <= 0 || !dream.text) return;
    // velo viola su tutta la scena mentre il sogno è attivo — la notte cala
    ctx.save();
    ctx.globalAlpha = dream.alpha * 0.10;
    ctx.fillStyle = 'rgb(190,135,255)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const breath = 0.7 + 0.12 * Math.sin(t * 0.35);
    ctx.save();
    ctx.globalAlpha = dream.alpha * breath * 0.75;
    const size = Math.max(14, Math.min(21, W / 50));
    ctx.font = `italic ${size}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = 'rgb(190,135,255)';
    ctx.textAlign = 'center';

    const maxW = W * 0.66;
    const words = `💭 "${dream.text}"`.split(' ');
    const lines = [''];
    for (const w of words) {
        const probe = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w;
        if (ctx.measureText(probe).width > maxW && lines[lines.length - 1]) {
            if (lines.length === 3) { lines[2] += '…'; break; }
            lines.push(w);
        } else lines[lines.length - 1] = probe;
    }
    const y0 = H * 0.13 - (lines.length - 1) * (size * 1.3) / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, y0 + i * size * 1.3));
    ctx.restore();
}

// ── Oggetti rilevati (YOLO/mediapipe) — motes seedate deterministiche ───────
// Stesso principio delle persone (seed→posizione) ma per gli oggetti visti
// nelle stanze: appena una classe compare in una stanza nasce un puntino,
// sempre nella stessa tonalità per quella parola, che si dissolve quando
// l'oggetto non è più visto invece di sparire di scatto.
const MAX_MOTES = 14;
const objectMotes = new Map(); // "stanza:classe" -> {seed, hueF, count, alpha, dying, angleOff}

function stepObjectSources(d) {
    const wanted = new Set();
    (Array.isArray(d.rooms) ? d.rooms : []).forEach(r => {
        const room = r.id || r.name || 'unknown';
        Object.entries(r.objects || {}).forEach(([cls, count]) => {
            if (!count) return;
            const key = `${room}:${cls}`;
            wanted.add(key);
            let m = objectMotes.get(key);
            if (!m) {
                if (objectMotes.size >= MAX_MOTES) return; // limite, niente affollamento
                const seed = fnv1a(cls);
                m = {
                    room, seed, hueF: (seed % 10000) / 10000, count, alpha: 0, dying: false,
                    angleOff: ((seed >>> 8) % 10000) / 10000 * Math.PI * 2,
                };
                objectMotes.set(key, m);
            }
            m.count = count;
            m.dying = false;
        });
    });
    objectMotes.forEach((m, key) => { if (!wanted.has(key)) m.dying = true; });
}

// Note dell'AV Herbarium (piante→MIDI→Carla): a differenza degli oggetti
// (stato persistente finché visti) una nota è un evento fugace — una
// scintilla che nasce e si dissolve, non un puntino che resta finché la
// pianta "c'è ancora". Colore seedato dalla parola del solfeggio (stessa
// identità visiva di pi/screen e welcome.html), posizione all'ancora della
// stanza (stesso sistema delle persone/oggetti).
const MAX_NOTE_SPARKS = 24;   // le note arrivano a raffica coi preset arpeggiati
let lastHerbTs = 0;
const noteSparks = [];

function stepHerbNotes(d) {
    const notes = (d.herbarium && Array.isArray(d.herbarium.notes)) ? d.herbarium.notes : [];
    let maxTs = lastHerbTs;
    notes.forEach(n => {
        if (!n || typeof n.ts !== 'number' || n.ts <= lastHerbTs) return;
        if (n.ts > maxTs) maxTs = n.ts;
        if (noteSparks.length >= MAX_NOTE_SPARKS) return;
        const word = NOTE_WORDS[((n.note % 12) + 12) % 12];
        const seed = fnv1a(word);
        noteSparks.push({
            room: n.room || 'unknown', seed, hueF: (seed % 10000) / 10000,
            vel: (n.velocity || 64) / 127, t0: performance.now(),
        });
    });
    lastHerbTs = maxTs;
}

function drawNoteSparks(nowMs, core) {
    for (let i = noteSparks.length - 1; i >= 0; i--) {
        const s = noteSparks[i];
        const age = (nowMs - s.t0) / 1000;
        if (age > 1.2) { noteSparks.splice(i, 1); continue; }
        const p = age / 1.2;
        const anchor = roomAnchor(s.room, core);
        const r = core.bR * (0.3 + p * (1.4 + s.vel));
        const alpha = (1 - p) * 0.55 * (0.5 + s.vel * 0.5);
        const [h0, h1] = cur.hue;
        const hue = h0 + (h1 - h0) * s.hueF;
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue}, 70%, 65%, ${alpha})`;
        ctx.lineWidth = 2 * (1 - p) + 0.4;
        ctx.stroke();
    }
}

function drawObjectMotes(t, core) {
    objectMotes.forEach((m, key) => {
        m.alpha += m.dying ? -0.012 : (m.alpha < 1 ? 0.01 : 0);
        if (m.dying && m.alpha <= 0) { objectMotes.delete(key); return; }
        m.alpha = Math.max(0, Math.min(1, m.alpha));
        if (m.alpha <= 0) return;

        // stessa ancora di stanza delle persone: gli oggetti orbitano vicino
        // a chi/cosa li ha visti, non al centro condiviso della scena
        const anchor = roomAnchor(m.room, core);
        const ang = t * 0.045 + m.angleOff;
        const R = core.bR * (1.6 + (m.seed % 997) / 997 * 1.1);
        const x = anchor.x + Math.cos(ang) * R;
        const y = anchor.y + Math.sin(ang) * R * 0.6;

        const [h0, h1] = cur.hue;
        const hue = h0 + (h1 - h0) * m.hueF;
        const size = 3 + Math.min(3, Math.log2(1 + m.count)) * 2;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 60%, 62%, ${m.alpha * 0.5})`;
        ctx.fill();
    });
}

// ── Burst dorato al level-up (stesso oro delle rune asemiche) ───────────────
const levelBurst = { active: false, t0: 0 };
function triggerLevelBurst() { levelBurst.active = true; levelBurst.t0 = performance.now(); }

function drawLevelBurst(nowMs, core) {
    if (!levelBurst.active) return;
    const age = (nowMs - levelBurst.t0) / 1000;
    if (age > 1.6) { levelBurst.active = false; return; }
    const p = age / 1.6;
    const r = core.bR * (1 + p * 6);
    const alpha = (1 - p) * 0.5;
    ctx.beginPath();
    ctx.arc(core.cx, core.cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,214,90,${alpha})`;
    ctx.lineWidth = 3 * (1 - p) + 0.5;
    ctx.stroke();
}

// ── Nucleo respirante ─────────────────────────────────────────────────────────
// Stessi colori-stato della welcome (identità visiva condivisa):
// idle=accento palette · listening=verde acido · processing=azzurro
function drawCore(t) {
    const life = Math.max(0, Math.min(1, S.lifeIndex / 100));
    const isL = S.voice === 'listening', isP = S.voice === 'processing';
    const hue = isL ? '45,200,0' : isP ? '88,166,255'
              : `${cur.accent[0]|0},${cur.accent[1]|0},${cur.accent[2]|0}`;
    const spd = isL ? 4.2 : isP ? 2.8 : 0.7;

    const cx = W / 2 + Math.sin(t * 0.13) * W * 0.012;
    const cy = H / 2 + Math.cos(t * 0.10) * H * 0.010;
    const bR = Math.min(W, H) * (0.10 + life * 0.05);
    const amp = bR * 0.28 * (0.4 + life * 0.6);

    for (let i = 0; i < 4; i++) {
        const ph = (i * Math.PI * 2) / 4;
        const r = bR * (1 + i * 0.62) + amp * Math.sin(t * spd + ph);
        const a = (0.34 - i * 0.07) * (0.6 + 0.4 * Math.sin(t * spd * 0.5 + ph));
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(r, 4), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${hue},${a})`;
        ctx.lineWidth = isL ? 2.4 : 1.6;
        ctx.stroke();
    }
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, bR * 0.5);
    g.addColorStop(0, `rgba(${hue},.55)`);
    g.addColorStop(1, `rgba(${hue},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, bR * 0.5, 0, Math.PI * 2);
    ctx.fill();
    return { cx, cy, bR };
}

// ── Ancoraggio per stanza — deterministico dal nome (stesso principio del
// seed asemico): due stanze diverse finiscono SEMPRE in punti diversi e
// stabili della scena, non a caso. Persone e oggetti si posizionano
// intorno all'ancora della loro stanza invece di orbitare un unico centro
// condiviso — così "Mauro in salotto" ed "Eli in ingresso" si vedono
// davvero in due posti diversi, non in due punti a caso dello stesso posto.
function roomAnchor(room, core) {
    const seed = fnv1a(room || 'unknown');
    const angle = (seed % 100000) / 100000 * Math.PI * 2;
    const R = Math.min(core.bR * 5.5, Math.min(W, H) * 0.34);
    return { x: core.cx + Math.cos(angle) * R, y: core.cy + Math.sin(angle) * R * 0.62 };
}

// ── Orbi presenza (una per persona, col nome, raggruppate per stanza) ───────
function personSeed(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return h / 0xffff;
}

function drawPeople(t, core) {
    if (!people.length) return;
    const byRoom = new Map();
    people.forEach(p => {
        if (!byRoom.has(p.room)) byRoom.set(p.room, []);
        byRoom.get(p.room).push(p);
    });

    byRoom.forEach((group, room) => {
        const anchor = roomAnchor(room, core);
        group.forEach((p, i) => drawOnePerson(p, i, group.length, anchor, t, core));
    });
}

function drawOnePerson(p, i, groupSize, anchor, t, core) {
    const seed = personSeed(p.name);
    const localAng = seed * Math.PI * 2 + (i * Math.PI * 2) / groupSize;
    const localR = core.bR * (0.85 + (i % 3) * 0.45);
    const bob = Math.sin(t * 0.6 + seed * 9) * core.bR * 0.12;
    const x = anchor.x + Math.cos(localAng) * localR;
    const y = anchor.y + Math.sin(localAng) * localR * 0.7 + bob;

    const happy = p.emotion === 'happy';
    const warm = happy ? [255, 214, 130] : cur.accent;
    const pulse = happy ? 1 + 0.12 * Math.sin(t * 3 + seed * 9) : 1;

    const g = ctx.createRadialGradient(x, y, 0, x, y, 26 * pulse);
    g.addColorStop(0, `rgba(${warm[0]|0},${warm[1]|0},${warm[2]|0},0.50)`);
    g.addColorStop(1, `rgba(${warm[0]|0},${warm[1]|0},${warm[2]|0},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 26 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(240,246,255,0.92)';
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(201,209,217,0.55)';
    ctx.fillText(p.name.toUpperCase(), x, y + 24);
}

// ── Braci (luci accese) ───────────────────────────────────────────────────────
const embers = [];
function stepEmbers() {
    const want = Math.min(24, Math.round(S.lightsOn) * 3);
    while (embers.length < want)
        embers.push({ x: Math.random() * W, y: H + Math.random() * 40,
                      v: 0.15 + Math.random() * 0.35, ph: Math.random() * 9 });
    if (embers.length > want) embers.length = want;
    for (const e of embers) {
        e.y -= e.v;
        e.x += Math.sin(e.y * 0.01 + e.ph) * 0.3;
        if (e.y < -10) { e.y = H + 10; e.x = Math.random() * W; }
    }
}
function drawEmbers(t) {
    for (const e of embers) {
        const tw = 0.10 + 0.08 * Math.sin(t * 2 + e.ph);
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 14);
        g.addColorStop(0, `rgba(255,226,170,${tw})`);
        g.addColorStop(1, 'rgba(255,226,170,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 14, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ── Loop principale ───────────────────────────────────────────────────────────
let time = 0;
let lastTs = 0;
let slowFrames = 0;

function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(50, ts - lastTs || 16);
    lastTs = ts;
    time += dt * 0.001;
    const t = time;

    // qualità adattiva: se il frame medio è lento, meno particelle (mai < 220)
    if (dt > 42) { if (++slowFrames > 45 && activeCount > 220) { activeCount = Math.round(activeCount * 0.8); slowFrames = 0; } }
    else if (slowFrames > 0) slowFrames--;

    // ── lerp dei valori dell'anima ──
    const F = 0.03;
    S.energy    = lerp(S.energy,    S.energyTarget    ?? S.energy,    F);
    S.stress    = lerp(S.stress,    S.stressTarget    ?? S.stress,    F);
    S.calm      = lerp(S.calm,      S.calmTarget      ?? S.calm,      F);
    S.curiosity = lerp(S.curiosity, S.curiosityTarget ?? S.curiosity, F);
    S.lifeIndex = lerp(S.lifeIndex, S.lifeTarget      ?? S.lifeIndex, F);
    S.lightsOn  = lerp(S.lightsOn,  S.lightsTarget    ?? S.lightsOn,  F);
    S.mood = S.moodTarget || S.mood;

    // ── lerp palette ──
    const pal = PALETTES[S.mood] || PALETTES.neutra;
    const PF = 0.02;
    for (let b = 0; b < 3; b++)
        for (let c = 0; c < 3; c++)
            cur.bands[b][c] = lerp(cur.bands[b][c], pal.bands[b][c], PF);
    cur.hue[0] = lerp(cur.hue[0], pal.hue[0], PF);
    cur.hue[1] = lerp(cur.hue[1], pal.hue[1], PF);
    for (let c = 0; c < 3; c++) cur.accent[c] = lerp(cur.accent[c], pal.accent[c], PF);

    // ── bande Rothko (offscreen minuscolo → upscale = sfumatura) ──
    const bg = bandCtx.createLinearGradient(0, 0, 0, 128);
    const [top, mid, bot] = cur.bands;
    const drift = 0.03 * Math.sin(t * 0.05);
    bg.addColorStop(0.00, `rgb(${top[0]|0},${top[1]|0},${top[2]|0})`);
    bg.addColorStop(0.30 + drift, `rgb(${mid[0]|0},${mid[1]|0},${mid[2]|0})`);
    bg.addColorStop(0.66 - drift, `rgb(${mid[0]|0},${mid[1]|0},${mid[2]|0})`);
    bg.addColorStop(1.00, `rgb(${bot[0]|0},${bot[1]|0},${bot[2]|0})`);
    bandCtx.fillStyle = bg;
    bandCtx.fillRect(0, 0, 16, 128);

    // velo del frame: fa svanire le scie verso lo sfondo
    ctx.globalAlpha = 0.085;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bandCv, 0, 0, W, H);
    ctx.globalAlpha = 1;

    // ── particelle flow-field ──
    const turb = S.stress;
    const speedK = (0.5 + S.energy / 100) * (dt / 16.7);
    const [h0, h1] = cur.hue;
    const nowMs = performance.now();

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < activeCount; i++) {
        const p = particles[i];
        const a = fieldAngle(p.x, p.y, t, turb);
        let vx = Math.cos(a) * p.speed * speedK * 1.6;
        let vy = Math.sin(a) * p.speed * speedK * 1.6;

        for (const r of ripples) {
            const age = (nowMs - r.t0) / 1000;
            if (age > 1.2) continue;
            const dx = p.x - r.x, dy = p.y - r.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 90000 && d2 > 1) {
                const d = Math.sqrt(d2);
                const k = (1 - age / 1.2) * 90 / (d + 30);
                vx += (dx / d) * k;
                vy += (dy / d) * k;
            }
        }

        const nx = p.x + vx, ny = p.y + vy;
        const hue = h0 + (h1 - h0) * p.hue;
        const alpha = 0.16 + 0.12 * Math.min(1, p.life / 120);
        ctx.strokeStyle = `hsla(${hue},68%,${52 + S.calm * 14}%,${alpha})`;
        ctx.lineWidth = 0.8 + (S.energy / 100) * 1.1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();

        p.x = nx; p.y = ny;
        p.life -= 1;
        if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20 || p.life <= 0)
            particles[i] = newParticle();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ── braci · nucleo · oggetti · persone · pensiero · sogno · burst ──
    stepEmbers();
    ctx.globalCompositeOperation = 'lighter';
    drawEmbers(t);
    const core = drawCore(t);
    drawLevelBurst(nowMs, core);
    ctx.globalCompositeOperation = 'source-over';
    drawObjectMotes(t, core);
    drawNoteSparks(nowMs, core);
    drawPeople(t, core);
    stepThought();
    drawThought(t);
    stepDream(nowMs);
    drawDream(t);

    // ── vignettatura + grana ──
    if (vignetteCv) ctx.drawImage(vignetteCv, 0, 0);
    if (grainPattern) {
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = grainPattern;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
    }
}

// ── Avvio ─────────────────────────────────────────────────────────────────────
resize();
// primo frame: riempi lo sfondo pieno per evitare il flash nero
ctx.drawImage(bandCv, 0, 0, W, H);
connectWS();
requestAnimationFrame(frame);
