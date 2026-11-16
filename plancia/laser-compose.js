'use strict';
// Scena laser composta (16/11/2026): nel progetto i livelli puntano ad altre scene per id
//   {id, name, layers: [{ref: <id scena>, x, y, scale, rotate, bright}]}
// e al gateway va con le scene dentro (ops/laser/laser_scene.py, _clean_layers):
//   {id, name, layers: [{scene: {...}, x, y, scale, rotate, bright}]}
// Livelli che puntano a scene tolte o ad altre composte: saltati.
// La stessa funzione e' in src/99-laser-scenes.js (lzsResolve) per la pagina.
function resolveLaserScene(sc, scenes) {
  if (!sc || !Array.isArray(sc.layers)) return sc;
  const byId = new Map((scenes || []).map(s => [s.id, s]));
  const layers = sc.layers.map(l => ({ l, s: byId.get(l.ref) })).filter(({ s }) => s && !s.layers)
    .map(({ l, s }) => ({ scene: s, x: +l.x || 0, y: +l.y || 0, scale: l.scale ?? 1, rotate: +l.rotate || 0, bright: l.bright ?? 1 }));
  return { id: sc.id, name: sc.name, layers };
}
module.exports = { resolveLaserScene };
