'use strict';
// Libreria di scene laser su disco (data/laser-lib, fuori da git): troppo grande per stare nel
// layout condiviso, quindi la Plancia sfoglia l'indice e copia nel progetto solo le scene scelte.
// Si costruisce con: node laser-lib-build.js <cartella con i file .ild>
const fs = require('fs/promises');
const path = require('path');

const dir = () => process.env.LASER_LIB_DIR || path.join(__dirname, 'data', 'laser-lib');

async function index() {
  try {
    return JSON.parse(await fs.readFile(path.join(dir(), 'index.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { items: [] };
    throw error;
  }
}

async function scene(id) {
  if (!/^[\w-]{1,64}$/.test(String(id)) || id === 'index') throw new Error('scena non valida');
  return JSON.parse(await fs.readFile(path.join(dir(), `${id}.json`), 'utf8'));
}

module.exports = { index, scene };
