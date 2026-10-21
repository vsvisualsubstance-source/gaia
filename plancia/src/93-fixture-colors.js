/* ---------- colore delle singole luci: palette per fixture (nota TD 37, risposta 4) ---------- */
// Una fixture con `palette` propria cambia SOLO colore: livello, audio,
// velocita' e strobo restano quelli del suo rig. Palette vuota = segue il
// rig. Si scrive con dmx_fixture_update (stessi campi della Pianta + palette).
// Vale per le luci a colori del motore chase (PAR, barre); le teste hanno
// il loro colore (programmatore), i level non hanno colore.
function fixturePaletteList(){
  const rigs=G.dxm?.['td-dmx-win']?.rigs||{};
  for(const r of Object.values(rigs)){
    const p=r?.params?.dmx_palette;if(!p||!Array.isArray(p.options)||!p.options.length)continue;
    const stepped=new Set(p.stepped||[]);
    return p.options.map(name=>({name,grad:dmxGradient([[p.colors?.[name]||[],stepped.has(name)]])}));
  }
  return[];
}
const fixtureHasPalette=f=>!!FIX_TYPES[f.type]?.ch&&(tdModelFor(f)?.kind||FIX_TYPES[f.type]?.kind)==='chase';
// palette della fixture: quella confermata da DMX Master, altrimenti quella in Plancia
const fixturePaletteOf=f=>{const t=tdFixtureByUid(f.id);return t?(t.palette||''):(f.palette||'')};
// audio per fixture (nota TD 44, solo luci dei rig chase): audio full|off|bass|mid|high|kick
// ("" = full = come il gruppo), audio_gain 0..2 ("" = 1). Il resto resta del rig.
const AUDIO_MODE_IT={full:'Come il gruppo',off:'Ferma',bass:'Solo bassi',mid:'Solo medi',high:'Solo alti',kick:'Solo kick'};
const AUDIO_MODE_SHORT={off:'ferma',bass:'bassi',mid:'medi',high:'alti',kick:'kick'};
const audioModes=()=>{const m=G.dxm?.['td-dmx-win']?.fixtures?.audio_modes;return Array.isArray(m)&&m.length?m:Object.keys(AUDIO_MODE_IT)};
const normAudio=a=>a||'full',normGain=g=>g===''||g==null||!Number.isFinite(+g)?1:+g;
const fixtureAudioOf=f=>{const t=tdFixtureByUid(f.id);return normAudio(t?t.audio:f.audio)};
const fixtureGainOf=f=>{const t=tdFixtureByUid(f.id);return normGain(t?t.audio_gain:f.audio_gain)};
// campi "di stile" che ogni invio della fixture deve riportare: dmx_fixtures (set)
// senza palette/audio li azzera (nota 44). Valori di DMX Master se la luce c'e', se no locali.
function fixtureStyleFields(f){
  const t=tdFixtureByUid(f.id),o={};
  if(t||f.palette!==undefined)o.palette=fixturePaletteOf(f);
  if(fixtureHasPalette(f)&&(t||f.audio!==undefined||f.audio_gain!==undefined)){o.audio=fixtureAudioOf(f);o.audio_gain=fixtureGainOf(f)}
  return o;
}
const fixtureTdValue=f=>({id:f.id,type:f.type,name:f.name,group:f.group,model:f.model,universe:f.universe,address:f.address,x:f.x,y:f.y,enabled:f.enabled!==false,...fixtureStyleFields(f)});
// modo e/o guadagno audio su piu' luci in un colpo (dmx_fixture_audio, nota 44)
async function setFixturesAudio(fixtures,fields){
  fixtures.forEach(f=>Object.assign(f,fields));save();
  const inTd=fixtures.filter(f=>tdFixtureByUid(f.id));
  if(!inTd.length)return{done:0,notInTd:fixtures.length};
  await tdSceneCommand('dmx_fixture_audio',{fixtures:inTd.map(f=>f.id),...fields},()=>inTd.every(f=>
    (fields.audio==null||fixtureAudioOf(f)===normAudio(fields.audio))&&(fields.audio_gain==null||Math.abs(fixtureGainOf(f)-fields.audio_gain)<.01)));
  return{done:inTd.length,notInTd:fixtures.length-inTd.length};
}
// controlli audio: modo (chip) + guadagno (cursore); current null = valori diversi
function audioControlsHtml(mode,gain,id){
  return`<div class="pal-chips" id="${id}">${audioModes().map(m=>`<button class="pal-chip${m===mode?' on':''}" data-aud="${m}" title="${esc(m)}">${esc(AUDIO_MODE_IT[m]||m)}</button>`).join('')}</div>
    <label class="ar-sl"><span>Guadagno audio <em>0 = ferma al minimo · 1 = normale · 2 = doppio</em><b>${gain==null?'diversi':(+gain).toFixed(2)}</b></span>
      <input type="range" min="0" max="2" step="0.05" value="${gain??1}" data-aud-gain="${id}"></label>`;
}
// manda la palette a tutte le fixture date; risolve con {done, notInTd}
async function setFixturesPalette(fixtures,name){
  const inTd=fixtures.filter(f=>tdFixtureByUid(f.id)),notInTd=fixtures.filter(f=>!tdFixtureByUid(f.id));
  fixtures.forEach(f=>{f.palette=name});save();
  if(!inTd.length)return{done:0,notInTd};
  for(const f of inTd)if(!devCmd('td-dmx-win',{action:'set',param:'dmx_fixture_update',value:{...fixtureTdValue(f),palette:name,on_conflict:'reject'}}))
    throw new Error('Non collegata a Gaia: apri ⋯ → Gaia e collegati prima.');
  const err0=G.devices['td-dmx-win']?.last_error,t0=Date.now();
  await new Promise((res,rej)=>{const check=()=>{
    if(inTd.every(f=>(tdFixtureByUid(f.id)?.palette||'')===name))return res();
    const err=G.devices['td-dmx-win']?.last_error;if(err&&err!==err0)return rej(new Error(err));
    if(Date.now()-t0>6000)return rej(new Error('nessuna conferma da DMX Master entro 6 s'));
    setTimeout(check,300)};setTimeout(check,300)});
  return{done:inTd.length,notInTd};
}
// fila di campioni: "Segue il rig" + le palette; onPick(nome) ('' = segue il rig)
function paletteChipsHtml(current,id){
  const list=fixturePaletteList();
  if(!list.length)return`<p class="hint">Palette non disponibili: DMX Master non collegato.</p>`;
  return`<div class="pal-chips" id="${id}"><button class="pal-chip${!current?' on':''}" data-pal="" title="Nessuna palette propria: la luce prende il colore del suo rig">Segue il rig</button>${
    list.map(p=>`<button class="pal-chip${p.name===current?' on':''}" data-pal="${esc(p.name)}" title="${esc(p.name)}"><i style="background:${p.grad||'var(--panel2)'}"></i>${esc(p.name)}</button>`).join('')}</div>`;
}
