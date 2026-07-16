/* GAIA · Vocabolario Asemico — engine v2 (inchiostro dal mood; algoritmo glifi INVARIATO da v1)
 *
 * Trasforma testo (TTS in/out, pensieri) in scrittura asemica: glifi inventati
 * ma DETERMINISTICI — la stessa parola produce sempre lo stesso glifo, su ogni
 * pagina e device. È questo che li rende un vocabolario apprendibile e non
 * rumore decorativo: chi guarda a lungo inizia a riconoscere i segni.
 *
 * Uso:
 *   const field = new AsemicField(canvas);          // parte da solo (rAF interno)
 *   field.say('Ciao Mauro, bentornato', 'out');     // Gaia parla  → inchiostro ciano
 *   field.say('accendi le luci', 'in');             // umano parla → inchiostro blu
 *   field.setInk('out', '255,190,100');             // futuro: colore da mood
 *
 * Nessuna dipendenza. Stesso algoritmo portabile su Pi/altre superfici:
 * word → FNV-1a 32bit → mulberry32 → 2-5 tratti in cella 1×1 (+ diacritici).
 */
'use strict';

(function (global) {

    // ── PRNG deterministico ───────────────────────────────────────────────
    function fnv1a(str) {
        let h = 2166136261 >>> 0;
        for (const ch of str.toLowerCase()) {
            h ^= ch.codePointAt(0);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h >>> 0;
    }

    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // ── Glifo: parola → tratti in cella 1×1 ──────────────────────────────
    // Cache globale: il vocabolario è condiviso, la stessa parola non si
    // ricalcola mai (e resta identica ovunque).
    const GLYPHS = new Map();

    function glyphFor(word) {
        const key = word.toLowerCase();
        if (GLYPHS.has(key)) return GLYPHS.get(key);
        const rnd = mulberry32(fnv1a(key));
        const strokes = [];
        const nStrokes = Math.min(5, 2 + Math.floor(key.length / 3) + (rnd() < 0.3 ? 1 : 0));
        for (let s = 0; s < nStrokes; s++) {
            const pts = [];
            const nPts = 2 + Math.floor(rnd() * 3);          // 2-4 punti di controllo
            let x = 0.05 + rnd() * 0.30;
            let y = 0.18 + rnd() * 0.64;
            for (let i = 0; i < nPts; i++) {
                pts.push([x, y]);
                x += 0.16 + rnd() * 0.34;
                y = Math.max(0.04, Math.min(0.96, y + (rnd() - 0.5) * 0.75));
            }
            // lunghezza approssimata del tratto (per l'animazione di scrittura)
            let len = 0;
            for (let i = 1; i < pts.length; i++)
                len += Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
            strokes.push({ pts, len: len * 1.15 });
        }
        const glyph = {
            strokes,
            dot:  rnd() < 0.28 ? { x: 0.2 + rnd() * 0.6, y: rnd() < 0.5 ? 0.06 : 0.97 } : null,
            bar:  rnd() < 0.18,                              // barra orizzontale bassa
            wide: 0.75 + rnd() * 0.45,                       // proporzione cella
        };
        GLYPHS.set(key, glyph);
        return glyph;
    }

    // ── v2: inchiostro dal mood ───────────────────────────────────────────
    // Solo 'out': la voce di Gaia porta l'umore. L'inchiostro umano resta blu
    // (è identità, non stato). Colori = accent delle PALETTES di Arte Viva
    // (web/gaia-art/script.js) — tenere allineati. speed scala il ritmo di
    // scrittura: calma scrive lenta, stress scrive nervosa.
    const MOOD_INKS = {
        neutra:    { ink: '0,255,204',   width: 1.7, speed: 1.0  },
        calm:      { ink: '80,230,190',  width: 1.5, speed: 0.8  },
        stress:    { ink: '255,115,85',  width: 2.4, speed: 1.35 },
        social:    { ink: '255,195,100', width: 2.0, speed: 1.15 },
        curiosity: { ink: '190,135,255', width: 1.8, speed: 1.05 },
    };
    const MOOD_ALIAS = { serena: 'calm', sofferente: 'stress', instabile: 'stress',
                         viva: 'social', stabile: 'neutra', neutrale: 'neutra' };

    // ── Campo di scrittura ────────────────────────────────────────────────
    class AsemicField {
        constructor(canvas, opts = {}) {
            this.cv = canvas;
            this.ctx = canvas.getContext('2d');
            // Stili per direzione: l'inchiostro 'in' (voce umana) è blu, molto
            // meno luminoso del ciano su fondo scuro — compensa con alpha e
            // tratto maggiori, altrimenti a parità di valori sparisce.
            this.style = {
                out:  { ink: opts.inkOut  || '0,255,204',   alpha: 0.16, width: 1.7, glow: 4.5 },
                in:   { ink: opts.inkIn   || '88,166,255',  alpha: 0.30, width: 2.2, glow: 6.0 },
                // herbarium: la pianta scrive in verde foglia (banda centrale);
                // inchiostro fisso — è la sua identità, come il blu dell'umano
                herb: { ink: opts.inkHerb || '120,240,110', alpha: 0.24, width: 1.9, glow: 5.0 },
            };
            this.maxSentences = opts.maxSentences || 3;
            this.cell = opts.cell || 0;                      // 0 = auto da viewport
            this.sentences = [];
            this._dirty = false;
            this._resize = this._resize.bind(this);
            window.addEventListener('resize', this._resize);
            this._resize();
            const loop = () => { this._frame(); requestAnimationFrame(loop); };
            requestAnimationFrame(loop);
        }

        setInk(dir, rgb) { if (this.style[dir]) this.style[dir].ink = rgb; }

        // v2: l'inchiostro di Gaia segue il mood, con transizione fluida
        // (il colore scivola verso il nuovo umore in ~2s, non scatta).
        setMood(mood) {
            const key = MOOD_ALIAS[mood] || (MOOD_INKS[mood] ? mood : 'neutra');
            this._moodTarget = MOOD_INKS[key];
        }

        _lerpMood() {
            const t = this._moodTarget;
            if (!t) return;
            const st = this.style.out;
            const cur = st.ink.split(',').map(Number);
            const dst = t.ink.split(',').map(Number);
            const k = 0.04;
            const next = cur.map((c, i) => c + (dst[i] - c) * k);
            st.ink   = next.map(v => Math.round(v)).join(',');
            st.width = st.width + (t.width - st.width) * k;
            st.speed = (st.speed || 1) + (t.speed - (st.speed || 1)) * k;
            if (next.every((v, i) => Math.abs(v - dst[i]) < 1)) {
                st.ink = t.ink; st.width = t.width; st.speed = t.speed;
                this._moodTarget = null;
            }
            this._dirty = true;
        }

        _resize() {
            this.dpr = Math.min(window.devicePixelRatio || 1, 2);
            this.W = window.innerWidth;
            this.H = window.innerHeight;
            this.cv.width  = this.W * this.dpr;
            this.cv.height = this.H * this.dpr;
            this.cv.style.width  = this.W + 'px';
            this.cv.style.height = this.H + 'px';
            this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            this._dirty = true;
        }

        // Scrive una frase. dir: 'out' = Gaia, 'in' = umano.
        say(text, dir = 'out') {
            text = (text || '').toString().trim();
            if (!text) return;
            const words = text.split(/\s+/).slice(0, 26);    // cap parole per frase
            const cell = this.cell || Math.max(26, Math.min(44, this.W / 26));
            const maxW = this.W * 0.86;
            const seed = mulberry32(fnv1a(text) ^ 0x9e37);

            // layout: righe centrate, max 3
            const lines = [[]];
            let lineW = 0;
            for (const w of words) {
                const g = glyphFor(w);
                const adv = cell * g.wide * 0.82 + cell * 0.22;
                if (lineW + adv > maxW && lines[lines.length - 1].length) {
                    if (lines.length === 3) break;
                    lines.push([]); lineW = 0;
                }
                lines[lines.length - 1].push({ word: w, g, adv });
                lineW += adv;
            }

            // banda verticale: Gaia scrive in alto; l'umano sotto il centro ma
            // sopra la zona saluto/bolla camera del kiosk (~0.75+); la pianta
            // (herb) nella banda centrale, tra le due
            const baseBand = dir === 'out' ? 0.24 : dir === 'herb' ? 0.44 : 0.63;
            const y0 = this.H * (baseBand + (seed() - 0.5) * 0.06);
            const items = [];
            let gi = 0;
            lines.forEach((line, li) => {
                const totW = line.reduce((s, it) => s + it.adv, 0);
                let x = (this.W - totW) / 2;
                for (const it of line) {
                    items.push({
                        g: it.g, cell,
                        x, y: y0 + li * cell * 1.55 + (seed() - 0.5) * cell * 0.18,
                        slant: (dir === 'in' ? 0.12 : -0.04) + (seed() - 0.5) * 0.05,
                        order: gi++,
                    });
                    x += it.adv;
                }
            });
            if (!items.length) return;

            this.sentences.push({
                items, dir,
                born: performance.now(),
                // ritmo di scrittura: la speed del mood accelera/rallenta la mano
                writeMs: (260 * items.length + 400) / ((this.style[dir].speed || 1)),
                holdMs: 9000, fadeMs: 5000,
            });
            while (this.sentences.length > this.maxSentences) this.sentences.shift();
            this._dirty = true;
        }

        _frame() {
            this._lerpMood();
            const now = performance.now();
            // pulizia frasi esaurite
            this.sentences = this.sentences.filter(s =>
                now - s.born < s.writeMs + s.holdMs + s.fadeMs);

            if (!this.sentences.length) {
                if (this._dirty) { this.ctx.clearRect(0, 0, this.W, this.H); this._dirty = false; }
                return;                                       // idle: costo ~zero
            }
            this._dirty = true;
            const ctx = this.ctx;
            ctx.clearRect(0, 0, this.W, this.H);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (const s of this.sentences) {
                const age = now - s.born;
                const style = this.style[s.dir] || this.style.out;
                // alpha di fase: scrittura → tenuta → dissolvenza
                let phase = 1;
                if (age > s.writeMs + s.holdMs)
                    phase = Math.max(0, 1 - (age - s.writeMs - s.holdMs) / s.fadeMs);
                const lift = Math.min(1, age / (s.writeMs + s.holdMs)) * 6;   // deriva su

                const perGlyph = s.writeMs / s.items.length;
                for (const it of s.items) {
                    const gAge = age - it.order * perGlyph;
                    if (gAge <= 0) continue;
                    const reveal = Math.min(1, gAge / (perGlyph * 1.6));
                    this._drawGlyph(it, reveal, phase, style, lift);
                }
            }
        }

        _drawGlyph(it, reveal, phase, style, lift) {
            const { g, cell, x, y, slant } = it;
            const ctx = this.ctx;
            const ink = style.ink;
            const w = cell * g.wide, h = cell;
            const alpha = style.alpha * phase;
            const nStrokes = g.strokes.length;

            ctx.save();
            ctx.translate(x, y - lift);
            ctx.transform(1, 0, slant, 1, 0, 0);

            for (let si = 0; si < nStrokes; si++) {
                // reveal sequenziale dei tratti dentro il glifo
                const sp = Math.max(0, Math.min(1, reveal * nStrokes - si));
                if (sp <= 0) continue;
                const st = g.strokes[si];
                const pxLen = st.len * Math.max(w, h);

                ctx.beginPath();
                const pts = st.pts;
                ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
                if (pts.length === 2) {
                    ctx.lineTo(pts[1][0] * w, pts[1][1] * h);
                } else {
                    for (let i = 1; i < pts.length - 1; i++) {
                        const mx = (pts[i][0] + pts[i+1][0]) / 2 * w;
                        const my = (pts[i][1] + pts[i+1][1]) / 2 * h;
                        ctx.quadraticCurveTo(pts[i][0] * w, pts[i][1] * h, mx, my);
                    }
                    const last = pts[pts.length - 1];
                    ctx.lineTo(last[0] * w, last[1] * h);
                }
                ctx.setLineDash([pxLen, pxLen]);
                ctx.lineDashOffset = pxLen * (1 - sp);
                // alone morbido + tratto
                ctx.strokeStyle = `rgba(${ink},${alpha * 0.35})`;
                ctx.lineWidth = style.glow;
                ctx.stroke();
                ctx.strokeStyle = `rgba(${ink},${alpha})`;
                ctx.lineWidth = style.width;
                ctx.stroke();
                ctx.setLineDash([]);
            }

            if (g.dot && reveal >= 0.95) {
                ctx.beginPath();
                ctx.arc(g.dot.x * w, g.dot.y * h, 1.6, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${ink},${alpha * 1.2})`;
                ctx.fill();
            }
            if (g.bar && reveal >= 0.85) {
                ctx.beginPath();
                ctx.moveTo(w * 0.12, h * 1.06);
                ctx.lineTo(w * 0.74, h * 1.06);
                ctx.strokeStyle = `rgba(${ink},${alpha * 0.7})`;
                ctx.lineWidth = 1.1;
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    global.AsemicField = AsemicField;

})(window);
