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
const fixtureTdValue=f=>({id:f.id,type:f.type,name:f.name,group:f.group,model:f.model,universe:f.universe,address:f.address,x:f.x,y:f.y,enabled:f.enabled!==false});
// palette della fixture: quella confermata da DMX Master, altrimenti quella in Plancia
const fixturePaletteOf=f=>{const t=tdFixtureByUid(f.id);return t?(t.palette||''):(f.palette||'')};
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
