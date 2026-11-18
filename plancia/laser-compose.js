'use strict';
// Scena laser composta (16/11/2026): nel progetto i livelli puntano ad altre scene per id
//   {id, name, layers: [{ref: <id scena>, x, y, scale, rotate, bright}]}
// e al gateway va con le scene dentro (ops/laser/laser_scene.py, _clean_layers):
//   {id, name, layers: [{scene: {...}, x, y, scale, rotate, bright}]}
// Livelli che puntano a scene tolte o ad altre composte: saltati.
// La stessa funzione e' in src/99-laser-scenes.js (lzsResolve) per la pagina.
// 18/11: preset master (layout.laserPresets = [{id, name, values: {pps, blank_shift, ...}}]) della
// scena: viaggia con la scena come "render" e il gateway lo usa finche' la scena e' in onda
function presetRender(sc, presets) {
  const p = (presets || []).find(x => x && x.id === sc?.preset);
  return p && p.values && Object.keys(p.values).length ? { ...p.values } : null;
}
function scenesWithPresets(scenes, presets) {
  return (scenes || []).map(s => { const r = presetRender(s, presets); return r ? { ...s, render: r } : s; });
}
function resolveLaserScene(sc, scenes) {
  if (!sc || !Array.isArray(sc.layers)) return sc;
  const byId = new Map((scenes || []).map(s => [s.id, s]));
  const layers = sc.layers.map(l => ({ l, s: byId.get(l.ref) })).filter(({ s }) => s && !s.layers)
    .map(({ l, s }) => ({ scene: s, x: +l.x || 0, y: +l.y || 0, scale: l.scale ?? 1, rotate: +l.rotate || 0, bright: l.bright ?? 1 }));
  // 18/11: reattivita' audio della composta intera (laser_scene.py)
  return { id: sc.id, name: sc.name, layers, ...(sc.render ? { render: sc.render } : {}), ...(sc.audio ? { audio: { amount: +sc.audio.amount || 0, to: sc.audio.to === 'brightness' ? 'brightness' : 'scale' } } : {}) };
}
module.exports = { resolveLaserScene, presetRender, scenesWithPresets };
