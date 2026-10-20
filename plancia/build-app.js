#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const appModules = [
  '00-core-state.js',
  '10-show-data.js',
  '20-layout-and-templates.js',
  '30-show-engine.js',
  '40-widget-rendering.js',
  '41-widget-interactions.js',
  '49-dmx-output.js',
  '50-bridge-sync.js',
  '60-stage-rendering.js',
  '61-stage-fixtures.js',
  '62-dmx-groups.js',
  '70-gaia-mqtt.js',
  '71-gaia-widgets.js',
  '72-gaia-interactions.js',
  '73-gaia-simulation.js',
  '80-animation-loop.js',
  '90-settings-and-bootstrap.js'
];

function buildAppBundle(sourceDir = path.join(__dirname, 'src')) {
  const modules = appModules.map(file => {
    const filename = path.join(sourceDir, file);
    return fs.readFileSync(filename, 'utf8').trimEnd();
  });

  return `(()=>{\n${modules.join('\n\n')}\n})();\n`;
}

if (require.main === module) {
  const output = path.join(__dirname, 'app.js');
  fs.writeFileSync(output, buildAppBundle(), 'utf8');
  console.log(`Built app.js from ${appModules.length} source modules.`);
}

module.exports = { appModules, buildAppBundle };
