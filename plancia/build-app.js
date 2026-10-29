#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const appModules = [
  '00-core-state.js',
  '05-widget-registry.js',
  '06-message-bus.js',
  '10-show-data.js',
  '20-layout-and-templates.js',
  '30-show-engine.js',
  '40-widget-rendering.js',
  '41-widget-interactions.js',
  '42-control-widgets.js',
  '43-timeline-widget.js',
  '44-scene-widgets.js',
  '49-dmx-output.js',
  '50-bridge-sync.js',
  '60-stage-rendering.js',
  '61-stage-fixtures.js',
  '62-dmx-groups.js',
  '63-dmx-scenes.js',
  '64-dmx-models.js',
  '65-stage-ai.js',
  '66-video-timeline.js',
  '67-magicq-import.js',
  '68-fixture-library.js',
  '69-project-models.js',
  '70-gaia-mqtt.js',
  '71-gaia-widgets.js',
  '72-gaia-interactions.js',
  '73-gaia-simulation.js',
  '80-animation-loop.js',
  '90-settings-and-bootstrap.js',
  '92-projects.js',
  '93-fixture-colors.js',
  '94-console-widgets.js',
  '95-help-tour.js',
  '96-audio-rigs.js',
  '97-stage-space.js',
  '98-device-panel.js',
  '99-laser.js',
  '99-laser-scenes.js',
  '999-start.js'
];

// Solo per la build di test (test/browser-harness.js): espone al browser headless
// le parti interne che i test di caratterizzazione fotografano. La build normale
// (app.js servito ai tablet) non le contiene.
const TEST_HOOKS = `
window.__planciaTest={
  get L(){return L},set L(v){L=v},
  G,W,P,TPL,DEF,NAMES,argsOf,out,set,setXY,send,fire,flush,render,ensureStageData,widgetType,WIDGET_TYPES,
  receive,gIn,SH,DMX_OUTPUT,mqttTopics,showClock,drawRender,ensureHeadPool,
  migrations:[['migrateLegacyHeadSelectors',migrateLegacyHeadSelectors],['migrateHeadPresetWidgets',migrateHeadPresetWidgets],
    ['migrateUiShowTimeline',migrateUiShowTimeline],['migrateUiConsolePages',migrateUiConsolePages],['migrateUiAudioPage',migrateUiAudioPage],
    ['migrateUiNoChase',migrateUiNoChase],['migrateUiOneDmxV8',migrateUiOneDmxV8],['migrateUiLaserPage',migrateUiLaserPage],
    ['migrateUiLaserScenes',migrateUiLaserScenes]]};`;

function buildAppBundle(sourceDir = path.join(__dirname, 'src'), { testHooks = false } = {}) {
  const modules = appModules.map(file => {
    const filename = path.join(sourceDir, file);
    return fs.readFileSync(filename, 'utf8').trimEnd();
  });
  if (testHooks) modules.push(TEST_HOOKS.trim());

  return `(()=>{\n${modules.join('\n\n')}\n})();\n`;
}

if (require.main === module) {
  const output = path.join(__dirname, 'app.js');
  fs.writeFileSync(output, buildAppBundle(), 'utf8');
  console.log(`Built app.js from ${appModules.length} source modules.`);
}

module.exports = { appModules, buildAppBundle };
