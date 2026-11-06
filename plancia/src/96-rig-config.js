/* ---------- configurazione avanzata dei rig (nota TD 68) ---------- */
// Una pagina come il Look Rig di DMX Master: per ogni gruppo (front, back, ledbar,
// side, truss, haze, blinder e quelli creati qui) tutte le sezioni del suo tipo.
// Struttura: dmx_matrix.rig_config (kinds, fields, groups); valori: dmx_rig_config
// (topic retained); scrittura parziale e "tutto o niente": {group, values}, esito
// in dmx_rig_config_result. I campi che su quel gruppo non fanno niente restano
// visibili in grigio con il motivo.
const RC_UI={sel:null,closed:new Set(),pending:new Map(),timer:null,last:null};
function rigConfigDef(){const r=G.dxm[dmxId()]?.rig_config;return r&&r.kinds&&r.fields&&Array.isArray(r.groups)?r:null}
function rigConfigValues(){const v=tdParams().dmx_rig_config;return v&&typeof v==='object'?v:{}}
function rigConfigGroup(){const d=rigConfigDef();if(!d)return null;
  const g=d.groups.find(x=>x.group===RC_UI.sel)||d.groups.find(x=>x.fixtures>0)||d.groups[0];RC_UI.sel=g?.group||null;return g}
const rcField=(kind,f)=>rigConfigDef()?.fields?.[kind]?.[f]||{type:'float',label:f};
const rcHex=c=>'#'+(Array.isArray(c)?c:[1,1,1]).map(v=>Math.round(clamp(+v||0)*255).toString(16).padStart(2,'0')).join('');
const rcRgb=h=>[1,3,5].map(i=>+(parseInt(h.slice(i,i+2),16)/255).toFixed(4));
const rcNum=(v,r)=>{const span=Array.isArray(r)?r[1]-r[0]:1;return span>=20?String(Math.round(v)):(+v).toFixed(span>=2?2:3)};
// scritture raccolte per 120 ms: i fader mandano solo l'ultimo valore
function rigConfigSend(group,values){
  const cur=RC_UI.pending.get(group)||{};RC_UI.pending.set(group,{...cur,...values});
  clearTimeout(RC_UI.timer);RC_UI.timer=setTimeout(rigConfigFlush,120);
}
function rigConfigFlush(){
  if(!RC_UI.pending.size)return;
  const groups=Object.fromEntries(RC_UI.pending);RC_UI.pending.clear();
  const request_id=`plancia-${Date.now().toString(36)}`;RC_UI.last={request_id,ts:Date.now()};
  if(!devCmd(dmxId(),{action:'set',param:'dmx_rig_config',value:{groups,request_id}}))showError('Config rig: non collegata a Gaia.');
}
function rigConfigResultText(){
  const r=tdParams().dmx_rig_config_result;if(!RC_UI.last)return'';
  if(!r||r.request_id!==RC_UI.last.request_id)return Date.now()-RC_UI.last.ts>3000?'nessuna risposta da DMX Master':'mando…';
  return r.ok?'✓ applicato':`✗ rifiutato: ${(r.errors||[]).join(' · ')}`;
}
function rigFieldHtml(g,kind,f,v){
  const d=rcField(kind,f),why=g.inactive?.[f],r=Array.isArray(d.range)?d.range:[0,1],id=`rc-${g.group}-${f}`;
  const tip=esc([d.help,why?`Su questo gruppo non fa niente: ${why}`:''].filter(Boolean).join('\n'));
  let ctl;
  if(d.type==='enum')ctl=`<select data-rc="${esc(f)}">${(d.options||[]).map((o,i)=>`<option value="${esc(o)}"${String(o)===String(v)?' selected':''}>${esc(d.labels?.[i]??o)}</option>`).join('')}</select>`;
  else if(d.type==='bool')ctl=`<button class="btn sm rc-bool${v?' on':''}" data-rc-bool="${esc(f)}">${v?'ON':'OFF'}</button>`;
  else if(d.type==='color_rgb')ctl=`<input type="color" data-rc="${esc(f)}" value="${rcHex(v)}">`;
  else{const step=(r[1]-r[0])>=20?1:(r[1]-r[0])/200;ctl=`<input type="range" data-rc="${esc(f)}" min="${r[0]}" max="${r[1]}" step="${step}" value="${v??d.default??r[0]}"><output>${v==null?'—':rcNum(v,r)}</output>`}
  return`<label class="rc-f${why?' na':''}" title="${tip}" for="${id}"><span>${esc(d.label||f)}${why?' <i>·</i>':''}</span>${ctl.replace('data-rc=',`id="${id}" data-rc=`)}</label>`;
}
// taratura (resta: scene e timeline non la toccano, nota TD 69) e look (cambia con lo show)
const rcRole=(kind,f)=>rcField(kind,f).role||((rigConfigDef()?.calibration?.[kind]||[]).includes(f)?'calibration':'look');
function rigPresets(kind){const p=tdParams().dmx_rig_presets;return(Array.isArray(p)?p:[]).filter(x=>!kind||x.kind===kind)}
// un comando di taratura con il suo request_id: l'esito arriva in dmx_rig_config_result
function rigCmd(param,value){const request_id=`plancia-${Date.now().toString(36)}`;RC_UI.last={request_id,ts:Date.now()};
  if(!devCmd(dmxId(),{action:'set',param,value:{...value,request_id}}))showError('Config rig: non collegata a Gaia.')}
// gruppo con luci nuove o cambiate: si propone la partenza adatta (una volta per insieme di modelli)
const rcProfSig=g=>JSON.stringify([g.fixtures,[...(g.profiles||[])].sort()]);
function rigStarterPending(g){return!!(g?.starter&&g.fixtures&&(L.rigSeen||{})[g.group]!==rcProfSig(g))}
function rigStarterSeen(g){L.rigSeen={...(L.rigSeen||{}),[g.group]:rcProfSig(g)};save()}
function rcSectionsHtml(g,kind,vals,role){
  return(kind?.sections||[]).map(s=>{const fs=s.fields.filter(f=>rcRole(g.kind,f)===role);if(!fs.length)return'';const key=`${g.kind}:${role}:${s.key}`,open=!RC_UI.closed.has(key);
    return`<section class="rc-sec${open?'':' closed'}"><h4 data-rc-sec="${esc(key)}">${open?'▾':'▸'} ${esc(s.label)}<button class="btn sm ghost" data-rc-act="reset" data-rc-v="${esc(s.key)}" data-rc-role="${role}" title="Rimette i valori di base di questa parte">↺</button></h4>
      ${open?`<div class="rc-fields">${fs.map(f=>rigFieldHtml(g,g.kind,f,vals[f])).join('')}</div>`:''}</section>`}).join('');
}
function paintRigConfig(el,w,force){
  const box=el.querySelector('.rc');if(!box)return;
  const def=rigConfigDef();
  if(!def){if(box._sig!=='none'){box._sig='none';box.innerHTML='<p class="hint">DMX Master non pubblica la configurazione dei rig (rig_config, nota TD 68): Gaia collegata?</p>'}return}
  const g=rigConfigGroup(),vals=rigConfigValues()[g.group]||{},kind=def.kinds[g.kind];
  const sig=JSON.stringify([def.groups,g.group,[...RC_UI.closed],rigPresets(g.kind).map(p=>p.name),rigStarterPending(g)]);
  const st=box.querySelector('.rc-st');if(st){const t=rigConfigResultText();if(st.textContent!==t){st.textContent=t;st.classList.toggle('bad',t.startsWith('✗'))}}
  if(!force&&box._sig===sig){
    // solo i valori, senza toccare il controllo che si sta usando
    box.querySelectorAll('[data-rc]').forEach(c=>{if(c===document.activeElement)return;const f=c.dataset.rc,v=vals[f];if(v==null)return;
      if(c.type==='color'){const h=rcHex(v);if(c.value!==h)c.value=h}else if(c.tagName==='SELECT'){if(c.value!==String(v))c.value=String(v)}
      else if(+c.value!==+v){c.value=v;const o=c.nextElementSibling;if(o)o.textContent=rcNum(v,rcField(g.kind,f).range)}});
    box.querySelectorAll('[data-rc-bool]').forEach(b=>{const on=!!vals[b.dataset.rcBool];if(b.classList.contains('on')!==on){b.classList.toggle('on',on);b.textContent=on?'ON':'OFF'}});
    return;
  }
  box._sig=sig;
  const hasCal=(def.calibration?.[g.kind]||[]).length>0,starter=g.starter?def.starters?.[g.kind]?.[g.starter]:null,np=rigPresets(g.kind).length;
  box.innerHTML=`<div class="rc-groups">${def.groups.map(x=>`<button class="rc-g${x.group===g.group?' on':''}${x.fixtures?'':' empty'}" data-rc-g="${esc(x.group)}" title="${esc(`${x.fixtures} luci${x.profiles?.length?': '+x.profiles.join(', '):''}`)}"><b>${esc(x.label||x.group)}${rigStarterPending(x)?' <i class="rc-dot" title="Luci nuove o cambiate">●</i>':''}</b><small>${x.kind==='level'?'livello':'colore'} · ${x.fixtures} luci</small></button>`).join('')}</div>
    <div class="rc-top"><span class="hint">${esc(g.label||g.group)}${g.alias?` (${esc(g.alias)})`:''}: ${g.fixtures?esc(g.profiles.join(', ')):'nessuna luce in patch'}</span>
      <button class="btn sm ghost" data-rc-act="copy" title="Copia su altri gruppi dello stesso tipo: solo la taratura, oppure tutto">⧉ Copia su…</button><span class="rc-st hint"></span></div>
    ${rigStarterPending(g)&&starter?`<div class="rc-banner"><span>Le luci di <b>${esc(g.label||g.group)}</b> sono nuove o cambiate (${esc(g.profiles.join(', '))}). Vuoi partire dalla taratura adatta: <b>${esc(starter.label)}</b>?</span>
      <button class="btn sm primary" data-rc-act="starter">Applica la partenza</button><button class="btn sm ghost" data-rc-act="seen">Non ora</button></div>`:''}
    <div class="rc-body">
      ${hasCal?`<div class="rc-blk"><div class="rc-bh"><b>TARATURA</b><span class="hint">resta come la lasci: scene e timeline non la cambiano</span>
        ${starter?'<button class="btn sm" data-rc-act="starter" title="'+esc(starter.label)+'">Partenza</button>':''}<button class="btn sm" data-rc-act="store">Salva preset</button>
        <button class="btn sm" data-rc-act="recall"${np?'':' disabled title="Nessun preset salvato per questo tipo di gruppo"'}>Richiama${np?` (${np})`:''}</button></div>
        <div class="rc-secs">${rcSectionsHtml(g,kind,vals,'calibration')}</div></div>`:''}
      <div class="rc-blk"><div class="rc-bh"><b>LOOK</b><span class="hint">cambia con la timeline e le scene: qui vale finché una cue non lo cambia</span></div>
        <div class="rc-secs">${rcSectionsHtml(g,kind,vals,'look')}</div></div>
    </div>`;
  box.oninput=e=>{const c=e.target.closest('[data-rc]');if(!c)return;const f=c.dataset.rc,d=rcField(g.kind,f);
    const v=d.type==='color_rgb'?rcRgb(c.value):d.type==='enum'?c.value:+c.value;
    if(c.type==='range'){const o=c.nextElementSibling;if(o)o.textContent=rcNum(v,d.range)}
    rigConfigSend(g.group,{[f]:v})};
  box.onchange=box.oninput;
}
async function rigConfigDown(e,el,w){
  if(e.target.closest('input,select'))return;
  const b=e.target.closest('[data-rc-g],[data-rc-bool],[data-rc-act],[data-rc-sec]');if(!b||b.disabled)return;e.preventDefault();
  const def=rigConfigDef(),g=rigConfigGroup();if(!def||!g)return;
  const name=g.label||g.group,again=()=>paintRigConfig(el,w,true);
  if(b.dataset.rcG){RC_UI.sel=b.dataset.rcG;again();return}
  if(b.dataset.rcBool){const f=b.dataset.rcBool,on=!(rigConfigValues()[g.group]||{})[f];b.classList.toggle('on',on);b.textContent=on?'ON':'OFF';rigConfigSend(g.group,{[f]:on});return}
  const act=b.dataset.rcAct;
  if(act==='reset'){const s=def.kinds[g.kind].sections.find(x=>x.key===b.dataset.rcV),role=b.dataset.rcRole;
    const values=Object.fromEntries(s.fields.filter(f=>rcRole(g.kind,f)===role).map(f=>[f,rcField(g.kind,f).default]).filter(([,v])=>v!==undefined));
    if(!Object.keys(values).length){showInfo('Questa parte non ha valori di base.');return}
    if(!await uiConfirm(`Rimettere i valori di base di "${s.label}" (${role==='calibration'?'taratura':'look'}) su ${name}?`,{ok:'Rimetti'}))return;
    rigConfigSend(g.group,values);return}
  if(act==='seen'){rigStarterSeen(g);again();return}
  if(act==='starter'){const st=def.starters?.[g.kind]?.[g.starter];if(!st)return;
    if(!await uiConfirm(`${st.label}\nApplicare a ${name} la taratura di partenza? Cambia dimmer minimo e massimo, boost${g.starter==='no_dimmer'?', gamma':''} e kick; il look resta com'è.`,{ok:'Applica'}))return;
    rigCmd('dmx_rig_preset_recall',{starter:true,group:g.group});rigStarterSeen(g);showInfo(`Partenza applicata a ${name}: ritocca dal vivo e poi "Salva preset".`);again();return}
  if(act==='store'){const n=await uiPrompt(`Nome del preset di taratura (da ${name})`,`${name} ${(g.profiles||[])[0]||''}`.trim().slice(0,40));
    if(!n)return;if(n.length>40){showError('Nome del preset: al massimo 40 caratteri.');return}
    if(rigPresets(g.kind).some(p=>p.name===n)&&!await uiConfirm(`Esiste già il preset "${n}": sovrascriverlo con la taratura di ${name}?`,{ok:'Sovrascrivi'}))return;
    rigCmd('dmx_rig_preset_store',{name:n,group:g.group,label:n});showInfo(`Preset "${n}" salvato in DMX Master.`);return}
  if(act==='recall'){const list=rigPresets(g.kind);
    const pick=await uiChoose(`Taratura per ${name}`,[...list.map(p=>({label:`${p.label||p.name}${p.source?` · da ${p.source}`:''}`,value:'r:'+p.name})),...list.map(p=>({label:`Elimina "${p.label||p.name}"`,value:'x:'+p.name,cls:'danger'}))]);
    if(!pick)return;const n=pick.slice(2);
    if(pick.startsWith('x:')){if(!await uiConfirm(`Eliminare il preset "${n}" da DMX Master?`,{ok:'Elimina'}))return;rigCmd('dmx_rig_preset_remove',{name:n});return}
    rigCmd('dmx_rig_preset_recall',{name:n,group:g.group});showInfo(`Taratura "${n}" richiamata su ${name}.`);return}
  if(act==='copy'){const others=def.groups.filter(x=>x.kind===g.kind&&x.group!==g.group);
    if(!others.length){showInfo('Nessun altro gruppo dello stesso tipo.');return}
    const hasCal=(def.calibration?.[g.kind]||[]).length>0;
    const mode=hasCal?await uiChoose(`Cosa copiare da ${name}?`,[{label:'Solo la taratura (resta: le scene non la cambiano)',value:'cal'},{label:'Tutto, anche il look (la timeline lo cambia alla cue dopo)',value:'all'}]):'all';
    if(!mode)return;
    const to=await uiChoose(`Copia ${mode==='cal'?'la taratura':'tutto'} di ${name} su…`,others.map(x=>({label:`${x.label||x.group} · ${x.fixtures} luci`,value:x.group})),{multi:true,done:'Copia'});
    if(!to?.length)return;
    if(mode==='cal')rigCmd('dmx_rig_preset_copy',{from:g.group,to});
    else{const src=rigConfigValues()[g.group]||{},fields=def.kinds[g.kind].sections.flatMap(s=>s.fields).filter(f=>src[f]!==undefined);for(const x of to)rigConfigSend(x,Object.fromEntries(fields.map(f=>[f,src[f]])))}
    showInfo(`${mode==='cal'?'Taratura':'Configurazione'} copiata su ${to.length} grupp${to.length>1?'i':'o'}.`);return}
  if(b.dataset.rcSec!=null){const k=b.dataset.rcSec;RC_UI.closed.has(k)?RC_UI.closed.delete(k):RC_UI.closed.add(k);again()}
}
registerWidget('rigconfig',{size:[16,10],label:'Config rig',showsValue:false,showsAddr:false,
  inner:()=>'<div class="rc"></div>',
  onPointer:rigConfigDown,
  tick:(el,w,{repaint})=>{if(repaint)paintRigConfig(el,w)},
  help:()=>['Configurazione dei rig','Ogni gruppo di luci in DMX Master. TARATURA (dimmer minimo e massimo, boost, gamma, kick): resta come la lasci, con partenza, preset e copia. LOOK (palette, colori, audio): cambia con la timeline e le scene. I campi in grigio su quel gruppo non fanno niente: il motivo è nel suggerimento.']});
// 2026-11-05: pagina "Config rig" nel gruppo Luci, dopo Audio (uiRev 17)
function migrateUiRigConfig(){
  if((L.uiRev||0)>=17)return;
  if(!L.pages.some(p=>p.widgets.some(w=>w.type==='rigconfig'))){const at=L.pages.findIndex(p=>p.name==='Audio')+1||L.pages.length;L.pages.splice(at,0,TPL.rigconfig.pages()[0])}
  L.uiRev=17;save();
}
