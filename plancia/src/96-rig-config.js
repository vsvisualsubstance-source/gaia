/* ---------- configurazione avanzata dei rig (nota TD 68) ---------- */
// Una pagina come il Look Rig di DMX Master: per ogni gruppo (front, back, ledbar,
// side, truss, haze, blinder e quelli creati qui) tutte le sezioni del suo tipo.
// Struttura: dmx_matrix.rig_config (kinds, fields, groups); valori: dmx_rig_config
// (topic retained); scrittura parziale e "tutto o niente": {group, values}, esito
// in dmx_rig_config_result. I campi che su quel gruppo non fanno niente restano
// visibili in grigio con il motivo.
const RC_UI={sel:null,closed:new Set(),pending:new Map(),timer:null,last:null};
function rigConfigDef(){const r=G.dxm['td-dmx-win']?.rig_config;return r&&r.kinds&&r.fields&&Array.isArray(r.groups)?r:null}
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
  if(!devCmd('td-dmx-win',{action:'set',param:'dmx_rig_config',value:{groups,request_id}}))showError('Config rig: non collegata a Gaia.');
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
  if(d.type==='enum')ctl=`<select data-rc="${esc(f)}">${(d.options||[]).map(o=>`<option${String(o)===String(v)?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
  else if(d.type==='bool')ctl=`<button class="btn sm rc-bool${v?' on':''}" data-rc-bool="${esc(f)}">${v?'ON':'OFF'}</button>`;
  else if(d.type==='color_rgb')ctl=`<input type="color" data-rc="${esc(f)}" value="${rcHex(v)}">`;
  else{const step=(r[1]-r[0])>=20?1:(r[1]-r[0])/200;ctl=`<input type="range" data-rc="${esc(f)}" min="${r[0]}" max="${r[1]}" step="${step}" value="${v??d.default??r[0]}"><output>${v==null?'—':rcNum(v,r)}</output>`}
  return`<label class="rc-f${why?' na':''}" title="${tip}" for="${id}"><span>${esc(d.label||f)}${why?' <i>·</i>':''}</span>${ctl.replace('data-rc=',`id="${id}" data-rc=`)}</label>`;
}
function paintRigConfig(el,w,force){
  const box=el.querySelector('.rc');if(!box)return;
  const def=rigConfigDef();
  if(!def){if(box._sig!=='none'){box._sig='none';box.innerHTML='<p class="hint">DMX Master non pubblica la configurazione dei rig (rig_config, nota TD 68): Gaia collegata?</p>'}return}
  const g=rigConfigGroup(),vals=rigConfigValues()[g.group]||{},kind=def.kinds[g.kind];
  const sig=JSON.stringify([def.groups,g.group,[...RC_UI.closed]]);
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
  box.innerHTML=`<div class="rc-groups">${def.groups.map(x=>`<button class="rc-g${x.group===g.group?' on':''}${x.fixtures?'':' empty'}" data-rc-g="${esc(x.group)}" title="${esc(`${x.fixtures} luci${x.profiles?.length?': '+x.profiles.join(', '):''}`)}"><b>${esc(x.label||x.group)}</b><small>${x.kind==='level'?'livello':'colore'} · ${x.fixtures} luci</small></button>`).join('')}</div>
    <div class="rc-top"><span class="hint">${esc(g.label||g.group)}${g.alias?` (${esc(g.alias)})`:''}: ${g.fixtures?esc(g.profiles.join(', ')):'nessuna luce in patch'}</span>
      <button class="btn sm ghost" data-rc-act="copy" title="Copia la configurazione di questo gruppo su altri gruppi dello stesso tipo">⧉ Copia su…</button><span class="rc-st hint"></span></div>
    <div class="rc-secs">${(kind?.sections||[]).map(s=>{const open=!RC_UI.closed.has(`${g.kind}:${s.key}`);
      return`<section class="rc-sec${open?'':' closed'}"><h4 data-rc-sec="${esc(s.key)}">${open?'▾':'▸'} ${esc(s.label)}<button class="btn sm ghost" data-rc-act="reset" data-rc-v="${esc(s.key)}" title="Rimette i valori di base di questa sezione">↺</button></h4>
        ${open?`<div class="rc-fields">${s.fields.map(f=>rigFieldHtml(g,g.kind,f,vals[f])).join('')}</div>`:''}</section>`}).join('')}</div>`;
  box.oninput=e=>{const c=e.target.closest('[data-rc]');if(!c)return;const f=c.dataset.rc,d=rcField(g.kind,f);
    const v=d.type==='color_rgb'?rcRgb(c.value):d.type==='enum'?c.value:+c.value;
    if(c.type==='range'){const o=c.nextElementSibling;if(o)o.textContent=rcNum(v,d.range)}
    rigConfigSend(g.group,{[f]:v})};
  box.onchange=box.oninput;
}
async function rigConfigDown(e,el,w){
  if(e.target.closest('input,select'))return;
  const b=e.target.closest('[data-rc-g],[data-rc-bool],[data-rc-act],[data-rc-sec]');if(!b)return;e.preventDefault();
  const def=rigConfigDef(),g=rigConfigGroup();if(!def||!g)return;
  if(b.dataset.rcG){RC_UI.sel=b.dataset.rcG;paintRigConfig(el,w,true);return}
  if(b.dataset.rcBool){const f=b.dataset.rcBool,on=!(rigConfigValues()[g.group]||{})[f];b.classList.toggle('on',on);b.textContent=on?'ON':'OFF';rigConfigSend(g.group,{[f]:on});return}
  const act=b.dataset.rcAct;
  if(act==='reset'){const s=def.kinds[g.kind].sections.find(x=>x.key===b.dataset.rcV);
    const values=Object.fromEntries(s.fields.map(f=>[f,rcField(g.kind,f).default]).filter(([,v])=>v!==undefined));
    if(!Object.keys(values).length){showInfo('Questa sezione non ha valori di base.');return}
    if(!await uiConfirm(`Rimettere i valori di base di "${s.label}" su ${g.label||g.group}?`,{ok:'Rimetti'}))return;
    rigConfigSend(g.group,values);return}
  if(act==='copy'){const others=def.groups.filter(x=>x.kind===g.kind&&x.group!==g.group);
    if(!others.length){showInfo('Nessun altro gruppo dello stesso tipo.');return}
    const to=await uiChoose(`Copia la configurazione di ${g.label||g.group} su…`,others.map(x=>({label:`${x.label||x.group} · ${x.fixtures} luci`,value:x.group})),{multi:true,done:'Copia',hint:'Si copiano tutte le sezioni; la palette compresa.'});
    if(!to?.length)return;const src=rigConfigValues()[g.group]||{},fields=def.kinds[g.kind].sections.flatMap(s=>s.fields).filter(f=>src[f]!==undefined);
    for(const x of to)rigConfigSend(x,Object.fromEntries(fields.map(f=>[f,src[f]])));showInfo(`Configurazione copiata su ${to.length} grupp${to.length>1?'i':'o'}.`);return}
  if(b.dataset.rcSec!=null){const k=`${g.kind}:${b.dataset.rcSec}`;RC_UI.closed.has(k)?RC_UI.closed.delete(k):RC_UI.closed.add(k);paintRigConfig(el,w,true)}
}
registerWidget('rigconfig',{size:[16,10],label:'Config rig',showsValue:false,showsAddr:false,
  inner:()=>'<div class="rc"></div>',
  onPointer:rigConfigDown,
  tick:(el,w,{repaint})=>{if(repaint)paintRigConfig(el,w)},
  help:()=>['Configurazione dei rig','Tutto il look di ogni gruppo di luci in DMX Master: livello e dimmer, colore, audio e kick. I valori cambiano subito dal vivo, finché la timeline non li cambia di nuovo. I campi in grigio su quel gruppo non fanno niente (il motivo è nel suggerimento).']});
// 2026-11-05: pagina "Config rig" nel gruppo Luci, dopo Audio (uiRev 17)
function migrateUiRigConfig(){
  if((L.uiRev||0)>=17)return;
  if(!L.pages.some(p=>p.widgets.some(w=>w.type==='rigconfig'))){const at=L.pages.findIndex(p=>p.name==='Audio')+1||L.pages.length;L.pages.splice(at,0,TPL.rigconfig.pages()[0])}
  L.uiRev=17;save();
}
