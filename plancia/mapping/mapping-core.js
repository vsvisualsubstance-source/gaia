// Mapping video comune (20/11/2026): corner pin (omografia) + mesh n x n (Catmull-Rom), portato da
// Regia (plancia/regia) per usarlo in Plancia (pagina Mapping), Render 3D e Regia stessa; domani
// lo stesso formato lo leggera' un motore nativo che fa solo mapping.
//
// Formato di un mapping (coordinate normalizzate dell'uscita: 0,0 = alto sx, 1,1 = basso dx):
//   {mode:'corners'|'mesh', corners:[[x,y] alto sx, alto dx, basso dx, basso sx], n:2..8,
//    off:[[du,dv] x n*n]}   off = spostamento dei punti della mesh nello spazio dell'immagine
//                           (prima dell'omografia), riga per riga dall'alto
// Il punto (u,v) dell'immagine sorgente (0..1) va in warpPt(map,u,v) sull'uscita.
//
// Script classico: definisce globalThis.PlanciaMapping; in Node: module.exports (test).
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;
  const defMap = () => ({ mode: 'corners', corners: [[0, 0], [1, 0], [1, 1], [0, 1]], n: 4, off: Array.from({ length: 16 }, () => [0, 0]) });
  const num = v => (Number.isFinite(+v) ? +v : 0);
  // mapping valido da qualunque cosa (dati vecchi, salvati a mano, da Regia)
  function fixMap(m) {
    const d = defMap();
    if (!m || typeof m !== 'object') return d;
    const r = { ...d, ...m };
    r.mode = r.mode === 'mesh' ? 'mesh' : 'corners';
    r.corners = Array.isArray(r.corners) && r.corners.length === 4 && r.corners.every(c => Array.isArray(c) && c.length >= 2)
      ? r.corners.map(c => [num(c[0]), num(c[1])]) : d.corners;
    r.n = clamp(Math.round(+r.n) || 4, 2, 8);
    r.off = Array.isArray(r.off) && r.off.length === r.n * r.n ? r.off.map(p => [num(p?.[0]), num(p?.[1])]) : Array.from({ length: r.n * r.n }, () => [0, 0]);
    return { mode: r.mode, corners: r.corners, n: r.n, off: r.off };
  }
  // omografia quadrato unitario -> quadrilatero degli angoli (matrice 3x3 per righe)
  function homog(c) {
    const [x0, y0] = c[0], [x1, y1] = c[1], [x2, y2] = c[2], [x3, y3] = c[3];
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3, dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    let g = 0, h = 0;
    if (Math.abs(den) > 1e-12) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  }
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g),
      G = b * f - c * e, Hh = -(a * f - c * d), I = a * e - b * d, det = a * A + b * B + c * C || 1e-12;
    return [A / det, D / det, G / det, B / det, E / det, Hh / det, C / det, F / det, I / det];
  }
  const applyH = (H, u, v) => { const w = H[6] * u + H[7] * v + H[8]; return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w]; };
  const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
  // spostamento della mesh nel punto (u,v): Catmull-Rom sui punti n x n
  function evalOff(m, u, v) {
    const n = m.n, off = m.off, fx = clamp(u * (n - 1), 0, n - 1.000001), fy = clamp(v * (n - 1), 0, n - 1.000001), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const P = (a, b, k) => off[clamp(b, 0, n - 1) * n + clamp(a, 0, n - 1)][k], res = [0, 0];
    for (let k = 0; k < 2; k++) { const r = []; for (let q = -1; q <= 2; q++) r.push(cr(P(i - 1, j + q, k), P(i, j + q, k), P(i + 1, j + q, k), P(i + 2, j + q, k), tx)); res[k] = cr(r[0], r[1], r[2], r[3], ty); }
    return res;
  }
  // come in Regia: la mesh resta applicata anche tornando al corner pin (si ritoccano gli angoli tenendo la forma)
  const hasOff = m => m.off.some(p => p[0] !== 0 || p[1] !== 0);
  // dove finisce sull'uscita il punto (u,v) della sorgente
  function warpPt(m, u, v, H = homog(m.corners)) { const d = hasOff(m) ? evalOff(m, u, v) : [0, 0]; return applyH(H, u + d[0], v + d[1]); }
  // griglia (tess x tess celle) gia' deformata: per WebGL (clip space, vec4 con w per la prospettiva) e per three.js
  function meshGrid(m, tess = 32) {
    const H = homog(m.corners), N = tess + 1, off = hasOff(m), cw = H[6] * 0.5 + H[7] * 0.5 + H[8], sg = cw < 0 ? -1 : 1;
    const clip = new Float32Array(N * N * 4), pts = new Float32Array(N * N * 2), uv = new Float32Array(N * N * 2);
    let p = 0, q = 0, r = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = i / tess, v = j / tess, d = off ? evalOff(m, u, v) : [0, 0], s = u + d[0], t = v + d[1];
      const X = (H[0] * s + H[1] * t + H[2]) * sg, Y = (H[3] * s + H[4] * t + H[5]) * sg, W = (H[6] * s + H[7] * t + H[8]) * sg;
      clip[p++] = 2 * X - W; clip[p++] = W - 2 * Y; clip[p++] = 0; clip[p++] = W;
      pts[r++] = X / W; pts[r++] = Y / W; uv[q++] = u; uv[q++] = v;
    }
    const idx = [];
    for (let j = 0; j < tess; j++) for (let i = 0; i < tess; i++) { const k = j * N + i; idx.push(k, k + 1, k + N, k + 1, k + N + 1, k + N); }
    return { clip, pts, uv, idx: new Uint16Array(idx), tess };
  }
  // punti trascinabili: i 4 angoli o i punti della mesh, in coordinate dell'uscita
  function handles(m) {
    if (m.mode === 'corners') return m.corners.map(c => [c[0], c[1]]);
    const H = homog(m.corners), n = m.n, out = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const d = m.off[j * n + i]; out.push(applyH(H, i / (n - 1) + d[0], j / (n - 1) + d[1])); }
    return out;
  }
  function moveHandle(m, k, x, y) {
    if (m.mode === 'corners') { m.corners[k] = [x, y]; return; }
    const [s, t] = applyH(inv3(homog(m.corners)), x, y), n = m.n;
    m.off[k] = [s - (k % n) / (n - 1), t - Math.floor(k / n) / (n - 1)];
  }
  // cambia la densita' della mesh tenendo la forma
  function setMeshN(m, n) {
    n = clamp(Math.round(n), 2, 8);
    const old = { ...m, off: m.off.map(p => [...p]) }, nw = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) nw.push(evalOff(old, i / (n - 1), j / (n - 1)));
    m.n = n; m.off = nw;
  }
  const rotate180 = m => { const c = m.corners; m.corners = [c[2], c[3], c[0], c[1]]; };
  // punto piu' vicino a (x,y) entro r pixel (w,h = dimensioni in pixel), -1 se nessuno
  function hitHandle(m, x, y, w, h, r = 18) {
    let best = -1, bd = r * r;
    handles(m).forEach((p, k) => { const dx = (p[0] - x) * w, dy = (p[1] - y) * h, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = k; } });
    return best;
  }
  // griglia e punti sopra l'uscita (canvas 2D)
  function drawOverlay(g, m, w, h, { sel = 0, label = '', dpr = 1, color = '#ffb020' } = {}) {
    const H = homog(m.corners), L = 8, S = 32;
    g.lineWidth = dpr; g.strokeStyle = 'rgba(255,176,32,.75)'; g.beginPath();
    for (let a = 0; a <= L; a++) {
      for (let s = 0; s <= S; s++) { const p = warpPt(m, a / L, s / S, H); s ? g.lineTo(p[0] * w, p[1] * h) : g.moveTo(p[0] * w, p[1] * h); }
      for (let s = 0; s <= S; s++) { const p = warpPt(m, s / S, a / L, H); s ? g.lineTo(p[0] * w, p[1] * h) : g.moveTo(p[0] * w, p[1] * h); }
    }
    g.stroke();
    const hs = handles(m), r = 7 * dpr;
    hs.forEach((p, k) => { g.beginPath(); g.arc(p[0] * w, p[1] * h, k === sel ? r * 1.4 : r, 0, TAU); g.fillStyle = k === sel ? color : 'rgba(0,0,0,.6)'; g.fill(); g.lineWidth = 2 * dpr; g.strokeStyle = color; g.stroke(); });
    if (label) {
      const sp = hs[sel] || [0, 0];
      g.font = `600 ${12 * dpr}px "JetBrains Mono",monospace`; g.fillStyle = color; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(`${label} · ${m.mode === 'corners' ? 'corner pin' : 'mesh ' + m.n + '×' + m.n} · punto ${sel + 1}: ${sp[0].toFixed(3)}, ${sp[1].toFixed(3)}`, 10 * dpr, 10 * dpr);
    }
  }
  // renderer WebGL: sorgente (video/canvas/immagine) deformata sull'uscita, con ritaglio, bordi
  // sfumati (edge blend), specchio e luminosita' (come le uscite di Regia)
  const VS = 'attribute vec4 aP;attribute vec2 aT;varying vec2 vT;void main(){gl_Position=aP;vT=aT;}';
  const FS = 'precision mediump float;varying vec2 vT;uniform sampler2D uS;uniform vec4 uC;uniform vec4 uF;uniform float uM;uniform float uB;' +
    'float rp(float x,float w){return w<=0.0?1.0:pow(clamp(x/w,0.0,1.0),1.0/2.2);}' +
    'void main(){vec2 u=vT;if(uM>0.5)u.x=1.0-u.x;vec3 c=texture2D(uS,uC.xy+u*uC.zw).rgb;float a=rp(vT.x,uF.x)*rp(1.0-vT.x,uF.y)*rp(vT.y,uF.z)*rp(1.0-vT.y,uF.w);gl_FragColor=vec4(c*a*uB,1.0);}';
  function makeRenderer(cv, tess = 32) {
    const gl = cv.getContext('webgl', { alpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) return null;
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p); gl.useProgram(p);
    const R = { gl, pb: gl.createBuffer(), tb: gl.createBuffer(), ib: gl.createBuffer(), tex: gl.createTexture(), aP: gl.getAttribLocation(p, 'aP'), aT: gl.getAttribLocation(p, 'aT'),
      uC: gl.getUniformLocation(p, 'uC'), uF: gl.getUniformLocation(p, 'uF'), uM: gl.getUniformLocation(p, 'uM'), uB: gl.getUniformLocation(p, 'uB'), key: '', n: 0, stage: null };
    gl.bindTexture(gl.TEXTURE_2D, R.tex);
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.uniform1i(gl.getUniformLocation(p, 'uS'), 0);
    const upload = src => {
      gl.bindTexture(gl.TEXTURE_2D, R.tex);
      try { if (R.stage) throw 0; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); }
      catch (e) {   // alcune sorgenti (video di certi browser) passano solo da un canvas
        if (!R.stage) { R.stage = document.createElement('canvas'); R.sg = R.stage.getContext('2d'); }
        const w = src.videoWidth || src.width, h = src.videoHeight || src.height;
        if (R.stage.width !== w || R.stage.height !== h) { R.stage.width = w; R.stage.height = h; }
        R.sg.drawImage(src, 0, 0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, R.stage);
      }
    };
    // o: {crop:[x,y,w,h] 0..1, feather:[sx,dx,su,giu] 0..0.5, mirror, bri}
    R.render = (m, src, o = {}) => {
      const w = cv.width, h = cv.height; gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!src || (src.readyState !== undefined && src.readyState < 2)) return false;
      upload(src);
      const key = JSON.stringify([m.mode, m.corners, m.n, m.off]);
      if (key !== R.key) {
        const gr = meshGrid(m, tess); R.key = key; R.n = gr.idx.length;
        gl.bindBuffer(gl.ARRAY_BUFFER, R.pb); gl.bufferData(gl.ARRAY_BUFFER, gr.clip, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, R.tb); gl.bufferData(gl.ARRAY_BUFFER, gr.uv, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, R.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gr.idx, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, R.pb); gl.enableVertexAttribArray(R.aP); gl.vertexAttribPointer(R.aP, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, R.tb); gl.enableVertexAttribArray(R.aT); gl.vertexAttribPointer(R.aT, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, R.ib);
      const c = o.crop || [0, 0, 1, 1], f = o.feather || [0, 0, 0, 0];
      gl.uniform4f(R.uC, c[0], c[1], c[2], c[3]); gl.uniform4f(R.uF, f[0], f[1], f[2], f[3]); gl.uniform1f(R.uM, o.mirror ? 1 : 0); gl.uniform1f(R.uB, o.bri ?? 1);
      gl.drawElements(gl.TRIANGLES, R.n, gl.UNSIGNED_SHORT, 0);
      return true;
    };
    return R;
  }
  const api = { defMap, fixMap, homog, inv3, applyH, evalOff, hasOff, warpPt, meshGrid, handles, moveHandle, setMeshN, rotate180, hitHandle, drawOverlay, makeRenderer, clamp };
  root.PlanciaMapping = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
