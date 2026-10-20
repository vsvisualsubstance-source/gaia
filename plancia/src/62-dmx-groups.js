/* ---------- gruppi DMX della Plancia (note TD/Win-PD 21 e 38) ---------- */
// Un gruppo = un rig di DMX Master: palette, effetti audio, livello
// (/dmx/group/<nome>). front/back/mh sono legati (bind) ai tre motori fissi
// di TD (rig_a, rig_b, heads); gli altri sono rig che TD crea quando riceve
// dmx_groups: "chase" (palette+audio, come front) o "level" (haze, blinder).
// Il rig non dipende dall'universo: universo e indirizzo sono di ogni
// fixture. LED wall e casse non sono DMX: fuori da questa lista.
const DEFAULT_GROUPS=[
  {group:'front',kind:'chase',label:'Front',bind:'rig_a'},
  {group:'back',kind:'chase',label:'Back',bind:'rig_b'},
  {group:'mh',kind:'heads',label:'Teste',bind:'heads'},
  {group:'ledbar',kind:'chase',label:'LED bar'},
  {group:'haze',kind:'level',label:'Haze'},
  {group:'blinder',kind:'level',label:'Blinder'}];
// nomi che TD rifiuta o che confonderebbero (nota 16), piu' i motori TD
const GROUP_RESERVED=new Set(['a','b','group','fixture','fixtures','patch','scan','output','blackout','ledwall','rig_a','rig_b','heads']);
// nome TD (rig_a...) -> nome Plancia (front...): il layout importato da TD
// porta ancora i nomi dei motori
function normGroupName(name,list=DEFAULT_GROUPS){
  const n=String(name||'').trim(),g=list.find(x=>x.bind===n);
  return g?g.group:n;
}
function validateGroups(list){
  const errs=[],seen=new Set();
  for(const g of list){
    const n=g.group;
    if(!/^[a-z][a-z0-9_]{1,15}$/.test(n))errs.push(`"${n}": da 2 a 16 caratteri, minuscole, cifre o _`);
    else if(GROUP_RESERVED.has(n))errs.push(`"${n}": nome riservato`);
    if(seen.has(n))errs.push(`"${n}" c'è due volte`);
    seen.add(n);
    if(!['chase','level','heads'].includes(g.kind))errs.push(`"${n}": tipo "${g.kind}" non valido`);
    if(g.kind==='heads'&&g.bind!=='heads')errs.push(`"${n}": le teste sono un motore solo (mh)`);
  }
  for(const b of ['rig_a','rig_b','heads'])if(list.filter(g=>g.bind===b).length!==1)errs.push(`serve un solo gruppo legato a ${b}`);
  return errs;
}
// la lista completa come la vuole TD (nota 21): {group, kind, label, bind?}
const groupsPayload=list=>list.map(g=>({group:g.group,kind:g.kind,label:g.label||g.group,...(g.bind?{bind:g.bind}:{})}));
// lista dallo status di TD (dmx_groups: {group, td_group, kind, label, builtin})
const groupsFromTD=list=>(Array.isArray(list)?list:[]).filter(x=>x&&x.group&&x.kind!=='none')
  .map(x=>({group:x.group,kind:x.kind,label:x.label||x.group,...(x.builtin?{bind:x.td_group}:{})}));

// ---- UI (solo nel browser) ----
// Lista: quella del layout; se manca, quella che TD pubblica; poi i default.
function groupsOf(){
  if(Array.isArray(L.groups)&&L.groups.length)return L.groups;
  const td=groupsFromTD(tdParams().dmx_groups);
  return td.length?td:DEFAULT_GROUPS;
}
function groupLabel(name){
  const list=groupsOf(),g=list.find(x=>x.group===normGroupName(name,list));
  if(!g)return name||'—';
  const rig={rig_a:'rig A',rig_b:'rig B'}[g.bind];
  return`${g.label||g.group}${rig?` (${rig})`:''}`;
}
function groupFixtureCount(g){
  const names=new Set([g.group,g.bind].filter(Boolean));
  return(L.fixtures||[]).filter(f=>names.has(f.group)).length;
}
function groupOptionsHtml(current){
  const list=groupsOf(),cur=normGroupName(current,list);
  const opts=list.map(g=>`<option value="${esc(g.group)}"${g.group===cur?' selected':''}>${esc(groupLabel(g.group))}</option>`);
  if(cur&&!list.some(g=>g.group===cur))opts.push(`<option value="${esc(cur)}" selected>${esc(cur)} (non nella lista gruppi)</option>`);
  return opts.join('');
}
function openGroupEditor(list){
  const inTD=new Set((tdParams().dmx_groups||[]).map(x=>x.group));
  list=list||groupsOf().map(g=>({...g}));
  const s=$('#scrim');s.hidden=false;
  const KIND={chase:'chase · palette e audio',level:'level · solo livello',heads:'teste'};
  const rows=list.map((g,i)=>{
    const fixed=!!g.bind,locked=fixed||(inTD.has(g.group)&&!g._new),n=groupFixtureCount(g);
    return`<div class="grp-row" data-g="${i}">
      <label>Nome <em>/dmx/group/…</em><input class="g-name mono" value="${esc(g.group)}"${locked?' disabled':''}></label>
      <label>Etichetta<input class="g-label" value="${esc(g.label||'')}"></label>
      <label>Tipo<select class="g-kind"${locked?' disabled':''}>${Object.keys(KIND).filter(k=>k!=='heads'||g.kind==='heads').map(k=>`<option value="${k}"${g.kind===k?' selected':''}>${KIND[k]}</option>`).join('')}</select></label>
      <div class="row"><span class="hint">${fixed?`motore TD ${g.bind}`:inTD.has(g.group)?'rig in TD':'nuovo'} · ${n} fixture</span><button class="btn sm danger" data-g-del="${i}"${fixed||n?' disabled':''} title="${fixed?'Gruppo fisso di TD':n?'Sposta prima le sue fixture in un altro gruppo':'Elimina il gruppo'}">×</button></div>
    </div>`}).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Gruppi DMX">
    <div class="top"><h3>Gruppi DMX</h3><button class="btn ghost" id="grpClose">Chiudi</button></div>
    <p class="hint">Ogni gruppo è un rig di DMX Master, con palette, effetti audio e livello propri. Front e back sono i rig A e B, mh le teste. Tutti i rig possono stare nello stesso universo: universo e indirizzo sono di ogni fixture. Aggiungi un rig quando un gruppo deve comportarsi in modo diverso (velocità, audio, livello); se cambia solo il colore basta la palette della singola fixture. LED wall e casse non sono DMX.</p>
    <div class="grp-list">${rows}</div>
    <div class="row"><button class="btn" id="grpAdd">＋ Aggiungi gruppo</button></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="grpCancel">Annulla</button><button class="btn primary" id="grpSave">Salva e invia a TD</button></div>
  </div>`;
  const read=()=>[...s.querySelectorAll('.grp-row')].map((r,i)=>({...list[i],
    group:r.querySelector('.g-name').value.trim().toLowerCase(),label:r.querySelector('.g-label').value.trim(),kind:r.querySelector('.g-kind').value}));
  s.querySelector('#grpClose').onclick=s.querySelector('#grpCancel').onclick=closeSheet;
  s.querySelector('#grpAdd').onclick=()=>{const cur=read();let k=1;while(cur.some(g=>g.group===`rig${k}`))k++;
    cur.push({group:`rig${k}`,kind:'chase',label:'',_new:true});openGroupEditor(cur);
    s.querySelector('.grp-row:last-child .g-name')?.select()};
  s.querySelectorAll('[data-g-del]').forEach(b=>b.onclick=()=>{const cur=read();cur.splice(+b.dataset.gDel,1);openGroupEditor(cur)});
  s.querySelector('#grpSave').onclick=()=>{
    const cur=read().map(({_new,...g})=>g),errs=validateGroups(cur);
    if(errs.length){showError('Gruppi: '+errs.join(' · '));return}
    L.groups=cur;save();closeSheet();sendGroupsToTD();
  };
}
// Manda la lista completa e aspetta il proprio esito (ts nuovo di
// dmx_groups_result), stesso schema a polling di resolveDuplicates().
function sendGroupsToTD(){
  const before=tdParams().dmx_groups_result?.ts;
  if(!devCmd('td-dmx-win',{action:'set',param:'dmx_groups',value:groupsPayload(groupsOf())})){
    alert('Gruppi salvati in Plancia. Non collegata a Gaia: invio a DMX Master non fatto.');return}
  let tries=0;
  const check=()=>{
    const r=tdParams().dmx_groups_result;
    if(r&&r.ts!==before){
      const show=v=>Array.isArray(v)?v.map(x=>typeof x==='object'?JSON.stringify(x):x).join(', '):v;
      const parts=[['creati',r.created],['legati',r.bound],['aggiornati',r.updated],['tolti',r.removed],['tenuti perché hanno fixture',r.kept],['ignorati',r.ignored]]
        .filter(([,v])=>Array.isArray(v)?v.length:v).map(([k,v])=>`${k}: ${show(v)}`);
      alert('Gruppi confermati da DMX Master.'+(parts.length?'\n'+parts.join('\n'):' Nessuna modifica.'));return}
    if(++tries>=16){const err=G.devices['td-dmx-win']?.last_error;
      alert('Nessuna conferma da DMX Master entro 8 s'+(err?': '+err:'.'));return}
    setTimeout(check,500);
  };
  setTimeout(check,500);
}

if(typeof module==='object'&&module.exports){
  module.exports={DEFAULT_GROUPS,GROUP_RESERVED,normGroupName,validateGroups,groupsPayload,groupsFromTD};
}
