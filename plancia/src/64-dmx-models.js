/* ---------- modelli di fixture di DMX Master (note TD/Win-PD 19 e 34) ---------- */
// Un MODELLO e' cosa e' una luce: tipo di motore (chase | level | heads),
// i ruoli dei suoi canali DMX in ordine (footprint = quanti), e per il
// colore: lampada fissa (beam), RGB/CMY, oppure ruota colori con gli slot
// "nome=valore" e il loro colore. Da qui DMX Master calcola rgb_out, il
// colore reale nel Render. Comandi Gaia: dmx_model_add, dmx_model_update
// {model, <campi>}, dmx_model_remove (rifiutato se il modello e' in uso).
const MODEL_KINDS=[{id:'chase',label:'chase · PAR e barre (palette, audio)'},{id:'level',label:'level · solo livello (blinder, haze)'},{id:'heads',label:'heads · teste mobili'}];
const dmxHexToRgb=h=>{const m=/^#?([0-9a-f]{6})$/i.exec(String(h||'').trim());if(!m)return null;
  const n=parseInt(m[1],16);return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255].map(v=>+v.toFixed(3))};
// "pan tilt dimmer" / "pan, tilt" -> ['pan','tilt',...]; ruoli come li vuole TD
function parseModelRoles(text){
  const roles=String(text||'').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const bad=roles.filter(r=>!/^[a-z][a-z0-9_]*$/.test(r));
  return{roles,error:!roles.length?'servono i ruoli dei canali, in ordine':bad.length?`ruoli non validi: ${bad.join(', ')} (minuscole, cifre, _)`:roles.length>512?'oltre 512 canali':''};
}
// lampada a scarica (nota TD 43): "control on=250 off=11 hold=5" <-> {channel,on,off,hold};
// TD la accende/spegne con heads_lamp tenendo il valore per hold secondi
function parseModelLamp(text,roles){
  const t=String(text||'').trim();if(!t)return{lamp:null};
  const m=/^([a-z][a-z0-9_]*)\s+(.*)$/i.exec(t);if(!m)return{error:'lampada: scrivi "<canale> on=<v> off=<v> hold=<s>"'};
  const kv=Object.fromEntries([...m[2].matchAll(/(on|off|hold)\s*=\s*(\d+(?:\.\d+)?)/gi)].map(x=>[x[1].toLowerCase(),+x[2]]));
  const lamp={channel:m[1].toLowerCase(),on:kv.on,off:kv.off,hold:kv.hold??5};
  if(roles&&!roles.includes(lamp.channel))return{error:`lampada: "${lamp.channel}" non è tra i canali del modello`};
  if(![lamp.on,lamp.off].every(v=>Number.isInteger(v)&&v>=0&&v<=255))return{error:'lampada: on e off sono valori DMX 0-255'};
  if(!(lamp.hold>=2&&lamp.hold<=30))return{error:'lampada: hold da 2 a 30 secondi'};
  return{lamp};
}
const formatModelLamp=l=>l&&typeof l==='object'?`${l.channel} on=${l.on} off=${l.off} hold=${l.hold??5}`:String(l||'');
// righe slot dell'editor -> lista per TD [{name, value, rgb?}]
function cleanModelSlots(rows,withColor){
  const out=[],errs=[],seen=new Set();
  rows.forEach((r,i)=>{
    const name=String(r.name||'').trim().replace(/\s+/g,'_'),raw=String(r.value??'').trim(),value=Number(raw);
    if(!name&&raw==='')return;
    if(!name){errs.push(`slot ${i+1}: manca il nome`);return}
    if(raw===''||!Number.isInteger(value)||value<0||value>255){errs.push(`${name}: valore DMX 0-255`);return}
    if(seen.has(value))errs.push(`${name}: valore ${value} già usato`);seen.add(value);
    const s={name,value};if(withColor){const rgb=dmxHexToRgb(r.hex);if(rgb)s.rgb=rgb}
    out.push(s);
  });
  return{slots:out.sort((a,b)=>a.value-b.value),errors:errs};
}

// ---- UI ----
const modelRolesFor=kind=>G.dxm['td-dmx-win']?.catalog?.kinds?.[kind]?.roles||[];
function openModelEditor(){
  const models=tdModels(),s=$('#scrim');s.hidden=false;
  const byKind=MODEL_KINDS.map(k=>({k,list:models.filter(m=>m.kind===k.id)})).filter(x=>x.list.length);
  const sw=m=>{const mix=m.color_mix||[];
    if(mix.includes('wheel')&&Array.isArray(m.colors)&&m.colors.length)return dmxGradient([[m.colors.map(c=>c.rgb||[1,1,1]),true]]);
    if(mix.includes('lamp'))return dmxHex(m.beam||[1,1,1]);
    if(mix.includes('rgb')||mix.includes('cmy'))return'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f)';
    return'';};
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Modelli DMX">
    <div class="top"><h3>Modelli · catalogo DMX Master</h3><button class="btn ghost" id="mdClose">Chiudi</button></div>
    ${projectModelsBox()}
    <p class="hint">Il modello dice cos'è una luce: i suoi canali DMX in ordine e come fa colore (RGB, ruota colori, lampada fissa). Da qui DMX Master calcola il colore reale che vedi nel Render. I valori "generici" vanno controllati sul manuale della luce vera.</p>
    ${byKind.map(({k,list})=>`<h4 class="md-kind">${esc(k.label)}</h4><div class="md-list">${list.map(m=>`
      <div class="md-row" data-model="${esc(m.model)}"><span class="md-sw" style="background:${sw(m)}"></span>
        <b>${esc(m.model)}</b><span class="hint">${m.footprint} ch · ${esc((m.color_mix||[]).join('+')||'nessun colore')} · ${esc(m.source||'')}${m.complete===false?' · <b>ruoli da completare</b>':''}</span>
        <button class="btn sm ghost" data-md="edit">✎ Modifica</button></div>`).join('')}</div>`).join('')}
    <div class="row"><button class="btn" id="mdNew">＋ Nuovo modello</button><button class="btn ghost" id="mdLib" title="Cerca tra migliaia di modelli: Open Fixture Library e libreria DDF di DMXControl">🔎 Libreria</button><button class="btn ghost" id="mdMagicQ" title="Legge le personalità da un file show di ChamSys MagicQ (.shw)">⇪ Da MagicQ (.shw)</button></div>
  </div>`;
  s.querySelector('#mdClose').onclick=closeSheet;
  s.querySelector('#mdNew').onclick=()=>openModelForm(null,{back:openModelEditor});
  s.querySelector('#mdMagicQ').onclick=()=>importMagicQModels(openModelEditor);
  s.querySelector('#mdLib').onclick=()=>openFixtureLibrary(openModelEditor);
  s.querySelector('#mdAlign')?.addEventListener('click',()=>alignProjectModels().then(()=>openModelEditor()));
  s.querySelectorAll('.md-row').forEach(r=>r.querySelector('[data-md="edit"]').onclick=()=>openModelForm(tdModels().find(m=>m.model===r.dataset.model),{back:openModelEditor}));
}
// m = modello esistente (update) o null (nuovo). opts: {kind, back, onDone(name)}
function openModelForm(m,opts={}){
  // opts.asNew: m e' solo il precompilato (es. import MagicQ), si crea un modello nuovo
  const isNew=!m||!!opts.asNew,kind0=m?.kind||opts.kind||'chase',s=$('#scrim');s.hidden=false;
  const slotRows=(list,cls,withColor)=>(list||[]).map(sl=>`<div class="md-slot ${cls}"><input class="sl-name" value="${esc(sl.name)}" placeholder="nome">
    <input class="sl-val" type="number" min="0" max="255" value="${esc(sl.value)}" placeholder="DMX">${withColor?`<input class="sl-hex" type="color" value="${dmxHex(sl.rgb||[1,1,1])}" title="colore dello slot">`:''}<button class="btn sm danger sl-del" title="Togli">×</button></div>`).join('');
  const render=kind=>{
    const roles=modelRolesFor(kind);
    s.innerHTML=`<div class="sheet" role="dialog" aria-label="Modello DMX">
      <div class="top"><h3>${isNew?'Nuovo modello':'Modello · '+esc(m.model)}${opts.asNew&&opts.from?' · '+esc(opts.from):''}</h3><button class="btn ghost" id="mfBack">${opts.back?'← Elenco':'Chiudi'}</button></div>
      <div class="two"><label>Nome<input id="mfName" value="${esc(m?.model||'')}"${isNew?'':' disabled'} placeholder="es. Spot XYZ 14ch"></label>
        <label>Tipo<select id="mfKind">${MODEL_KINDS.map(k=>`<option value="${k.id}"${k.id===kind?' selected':''}>${esc(k.label)}</option>`).join('')}</select></label></div>
      <div class="two"><label>Produttore<input id="mfMan" value="${esc(m?.manufacturer||'')}"></label><label>Note<input id="mfNotes" value="${esc(m?.notes||'')}" placeholder="es. verificato sul manuale"></label></div>
      <label>Canali DMX in ordine <em>${m?`${m.footprint} canali`:'ruoli separati da spazio'}</em><input id="mfChans" class="mono" value="${esc((m?.channels||[]).join(' '))}" placeholder="dimmer red green blue"></label>
      <p class="hint">Ruoli che il motore <b>${esc(kind)}</b> usa: ${roles.map(r=>`<code>${esc(r)}</code>`).join(' ')||'—'}. Gli altri canali (es. <code>strobe</code>, <code>macro</code>) escono a 0${kind==='heads'?' o al valore di "Valori di default"':''}.</p>
      <label class="md-beam">Colore della lampada (beam) <input id="mfBeam" type="color" value="${dmxHex(m?.beam||[1,1,1])}"><span class="hint">la luce "bianca" della fixture: è il colore per i modelli senza miscelazione (solo dimmer) e quello che filtrano ruota e CMY.</span></label>
      ${kind==='heads'?`<div class="two"><label>Escursione pan (°)<input id="mfPan" type="number" min="1" value="${esc(m?.pan_range??540)}"></label><label>Escursione tilt (°)<input id="mfTilt" type="number" min="1" value="${esc(m?.tilt_range??270)}"></label></div>
      <label>Valori di default <em>per i canali non pilotati</em><input id="mfDefaults" class="mono" value="${esc(m?.defaults||'')}" placeholder="shutter=255 speed=0"></label>
      <label>Lampada <em>solo lampade a scarica: canale, valori DMX di accensione e spegnimento, secondi da tenerli</em><input id="mfLamp" class="mono" value="${esc(formatModelLamp(m?.lamp))}" placeholder="control on=250 off=11 hold=5"></label>
      <h4>Ruota colori <em>slot = nome, valore DMX, colore</em></h4><div class="md-slots" id="mfColors">${slotRows(m?.colors,'sl-color',true)}</div>
      <div class="row"><button class="btn sm" id="mfAddColor">＋ Slot colore</button></div>
      <h4>Gobo</h4><div class="md-slots" id="mfGobos">${slotRows(m?.gobos,'sl-gobo',false)}</div>
      <div class="row"><button class="btn sm" id="mfAddGobo">＋ Gobo</button></div>`:''}
      <div class="cue-editor-actions"><div class="row cue-td">${isNew?'':'<button class="btn danger" id="mfDel" title="DMX Master lo rifiuta se una fixture o un tipo lo usa">Elimina modello</button>'}</div>
        <button class="btn ghost" id="mfCancel">Annulla</button><button class="btn primary" id="mfSave">${isNew?'Crea su DMX Master':'Salva su DMX Master'}</button></div>
    </div>`;
    const back=()=>opts.back?opts.back():closeSheet();
    s.querySelector('#mfBack').onclick=s.querySelector('#mfCancel').onclick=back;
    s.querySelector('#mfKind').onchange=e=>render(e.target.value);
    const addSlot=(box,cls,withColor)=>{box.insertAdjacentHTML('beforeend',slotRows([{name:'',value:''}],cls,withColor));wireDel()};
    const wireDel=()=>s.querySelectorAll('.sl-del').forEach(b=>b.onclick=()=>b.closest('.md-slot').remove());
    wireDel();
    if(s.querySelector('#mfAddColor'))s.querySelector('#mfAddColor').onclick=()=>addSlot(s.querySelector('#mfColors'),'sl-color',true);
    if(s.querySelector('#mfAddGobo'))s.querySelector('#mfAddGobo').onclick=()=>addSlot(s.querySelector('#mfGobos'),'sl-gobo',false);
    const fail=e=>showError('Modello: '+e.message);
    s.querySelector('#mfSave').onclick=async()=>{
      const name=s.querySelector('#mfName').value.trim(),kind=s.querySelector('#mfKind').value;
      if(!name){showError('Modello: serve un nome.');return}
      if(isNew&&tdModels().some(x=>x.model===name)){showError(`Modello: "${name}" esiste già.`);return}
      const ch=parseModelRoles(s.querySelector('#mfChans').value);if(ch.error){showError('Modello: '+ch.error);return}
      const v={model:name,kind,channels:ch.roles,manufacturer:s.querySelector('#mfMan').value.trim(),notes:s.querySelector('#mfNotes').value.trim(),
        beam:dmxHexToRgb(s.querySelector('#mfBeam').value)};
      if(kind==='heads'){
        v.pan_range=+s.querySelector('#mfPan').value||540;v.tilt_range=+s.querySelector('#mfTilt').value||270;v.defaults=s.querySelector('#mfDefaults').value.trim();
        const read=(sel,withColor)=>[...s.querySelectorAll(sel)].map(r=>({name:r.querySelector('.sl-name').value,value:r.querySelector('.sl-val').value,hex:r.querySelector('.sl-hex')?.value}));
        const c=cleanModelSlots(read('.sl-color',true),true),g=cleanModelSlots(read('.sl-gobo',false),false);
        const errs=[...c.errors,...g.errors];if(errs.length){showError('Modello: '+errs.join(' · '));return}
        v.colors=c.slots;v.gobos=g.slots;
        const lp=parseModelLamp(s.querySelector('#mfLamp').value,ch.roles);if(lp.error){showError('Modello: '+lp.error);return}
        if(lp.lamp)v.lamp=lp.lamp;else if(m?.lamp&&!isNew)v.lamp=null; // svuotato = togli la lampada
      }
      const sig=x=>JSON.stringify(x&&[x.kind,x.channels,x.beam,x.colors,x.gobos,x.pan_range,x.tilt_range,x.manufacturer,x.notes,formatModelLamp(x.lamp)]);
      const before=sig(tdModels().find(x=>x.model===name));
      const send=val=>tdSceneCommand(isNew?'dmx_model_add':'dmx_model_update',val,()=>{const x=tdModels().find(y=>y.model===name);return!!x&&(isNew||sig(x)!==before)});
      try{
        try{await send(v)}
        catch(e){
          // nota TD 43: canali cambiati su un modello in uso e fixture che si
          // sovrapporrebbero -> rifiutato (reject); l'operatore puo' farle spostare
          if(isNew||!/\d+-\d+ con /.test(e.message))throw e;
          if(!confirm(`DMX Master non scrive: le fixture di questo modello si sovrapporrebbero ad altre.\n${e.message}\n\nOK = sposta in avanti le fixture che si sovrappongono (on_conflict auto).\nAnnulla = non scrivere niente.`))return;
          await send({...v,on_conflict:'auto'});
        }
        rememberModel(v);
        showInfo(`Modello "${name}" ${isNew?'creato':'aggiornato'} su DMX Master.`);
        if(opts.onDone)opts.onDone(name);else back();
      }catch(e){
        // nessun cambiamento visibile = valori gia' uguali: non e' un errore
        if(!isNew&&/conferma/.test(e.message)&&!G.devices['td-dmx-win']?.last_error){showInfo(`Modello "${name}": nessuna modifica.`);back();return}
        fail(e)}
    };
    if(s.querySelector('#mfDel'))s.querySelector('#mfDel').onclick=async()=>{
      if(!confirm(`Eliminare il modello "${m.model}" da DMX Master?`))return;
      try{await tdSceneCommand('dmx_model_remove',m.model,()=>!tdModels().some(x=>x.model===m.model));showInfo(`Modello "${m.model}" eliminato.`);back()}catch(e){fail(e)}
    };
  };
  render(kind0);
}

if(typeof module==='object'&&module.exports){
  module.exports={MODEL_KINDS,dmxHexToRgb,parseModelRoles,cleanModelSlots};
}

// ---- lampade a scarica (nota TD 43): heads_lamp "on"/"off" su tutte le teste col campo lamp ----
const headsResultText=r=>!r?'':typeof r==='string'?r:`${r.action||''} ${r.ok===false?'✖':'✔'} ${r.message||''}`.trim();
function openLampPanel(){
  const s=$('#scrim');s.hidden=false;
  const paint=()=>{
    const p=tdParams(),withLamp=new Map(tdModels().filter(m=>m.lamp).map(m=>[m.model,m.lamp]));
    const heads=(p.dmx_fixtures||[]).filter(f=>withLamp.has(f.profile));
    const byModel={};heads.forEach(f=>{(byModel[f.profile]=byModel[f.profile]||[]).push(f.name||f.uid)});
    const last=(p.heads_list||[]).map(h=>h.lamp).filter(Boolean),lastCmd=last.length?last[last.length-1]:null;
    s.innerHTML=`<div class="sheet" role="dialog" aria-label="Lampade">
      <div class="top"><h3>💡 Lampade delle teste</h3><button class="btn ghost" id="lpClose">Chiudi</button></div>
      <p class="hint">Per le lampade a scarica: DMX Master tiene il valore di accensione o spegnimento sul canale della lampada per qualche secondo (<em>hold</em> del modello), poi torna al riposo. Vale per tutte le teste il cui modello ha la lampada. DMX Master non sa se la lampada è accesa davvero: qui vedi solo l'ultimo comando dato.</p>
      ${!tdCatalogKnown()?'<p class="hint"><b>DMX Master non collegato.</b></p>':heads.length?Object.entries(byModel).map(([mod,names])=>{const l=withLamp.get(mod);
        return`<div class="md-row"><b>${esc(mod)}</b><span class="hint">${names.length} teste (${esc(names.join(', '))}) · ${esc(formatModelLamp(l))}</span></div>`}).join(''):
        '<p class="hint">Nessuna testa in patch su DMX Master ha un modello con la lampada (campo "Lampada" in ▤ Modelli).</p>'}
      <p class="hint">Ultimo comando: <b>${esc(lastCmd||'—')}</b> · ultimo esito delle teste: ${esc(headsResultText(p.heads_last_result)||'—')}</p>
      <div class="row"><button class="btn primary" id="lpOn"${heads.length?'':' disabled'}>Accendi</button><button class="btn danger" id="lpOff"${heads.length?'':' disabled'}>Spegni</button></div>
    </div>`;
    s.querySelector('#lpClose').onclick=closeSheet;
    const go=async v=>{
      if(v==='off'&&!confirm('Spegnere le lampade? Una lampada a scarica spenta deve raffreddarsi qualche minuto prima di poter essere riaccesa.'))return;
      if(v==='on'&&!confirm(`Accendere le lampade di ${heads.length} teste?`))return;
      // esito in heads_last_result {seq, action, ok, message}: aspetta un seq nuovo
      const seq0=tdParams().heads_last_result?.seq;
      try{await tdSceneCommand('heads_lamp',v,()=>{const r=tdParams().heads_last_result;return!!r&&r.seq!==seq0&&r.action==='heads_lamp'});
        const r=tdParams().heads_last_result;(r.ok===false?showError:showInfo)('Lampade: '+(r.message||v))}
      catch(e){showError('Lampade: '+e.message)}
      paint();
    };
    s.querySelector('#lpOn').onclick=()=>go('on');s.querySelector('#lpOff').onclick=()=>go('off');
  };
  paint();
}
