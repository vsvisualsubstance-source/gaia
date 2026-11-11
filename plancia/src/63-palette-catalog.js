/* ---------- catalogo palette (nota OPS 59) ---------- */
// Le palette sono i colori che i gruppi di luci fanno girare. Il catalogo sta in
// DMX Master (palettes.json accanto al generatore): vale per tutti i progetti, i
// gruppi, le singole luci e le scene. Qui si crea, modifica, rinomina, riordina,
// elimina (con sostituzione) e si ripristinano quelle di partenza.
//   lettura: dmx_palette_catalog (topic retained dmx_palettes)
//   scrittura: dmx_palette_set | _remove | _restore | _order, esito in dmx_palette_result
let PAL_SEND=(param,value)=>devCmd(dmxId(),{action:'set',param,value});   // sostituibile nelle prove
const PAL_MAX_DEFAULT=8;
function palCatalog(){const c=tdParams().dmx_palette_catalog;return c&&Array.isArray(c.palettes)?c:null}
// comando con request_id; l'esito arriva in dmx_palette_result (al massimo 8 s)
function palRequest(param,value){
  const request_id=`plancia-pal-${Date.now().toString(36)}`;
  if(!PAL_SEND(param,{...value,request_id}))return Promise.reject(new Error('Non collegata a Gaia: apri ⋯ → Gaia e collegati prima.'));
  return new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{
    const r=tdParams().dmx_palette_result;
    if(r&&r.request_id===request_id){clearInterval(t);r.ok?resolve(r):reject(new Error((r.errors||[]).join(' · ')||'rifiutato'))}
    else if(++n>=40){clearInterval(t);reject(new Error('nessuna risposta da DMX Master in 8 s'))}},200)});
}
const palGrad=p=>dmxGradient([[p.colors||[],!!p.stepped]])||'#222';
function palUsageText(u){
  if(!u)return'';const parts=[];
  if(u.scenes)parts.push(`${u.scenes} scen${u.scenes===1?'a':'e'}`);
  if(u.rigs?.length)parts.push(`gruppi: ${u.rigs.map(g=>esc(groupLabel(g))).join(', ')}`);
  if(u.fixtures)parts.push(`${u.fixtures} luc${u.fixtures===1?'e':'i'}`);
  return parts.join(' · ');
}
let PAL_MSG='';
function openPaletteCatalog(){
  const c=palCatalog(),s=$('#scrim');s.hidden=false;
  const rows=c?c.palettes.map((p,i)=>`<div class="pal-row" data-pal-i="${i}">
      <i class="pal-sw" style="background:${palGrad(p)}"></i>
      <div class="pal-txt"><b>${esc(p.name)}</b>${p.builtin?(p.modified?' <span class="pal-tag mod">modificata</span>':' <span class="pal-tag">di partenza</span>'):' <span class="pal-tag new">nuova</span>'}${p.stepped?' <span class="pal-tag">a scatti</span>':''}
        <small>${palUsageText(p.used)||'non usata'}</small></div>
      <div class="pal-act"><button class="btn sm ghost" data-pal-act="edit" title="Modifica colori e nome">✎</button><button class="btn sm ghost" data-pal-act="dup" title="Duplica">⧉</button><button class="btn sm ghost" data-pal-act="up" title="Su"${i?'':' disabled'}>▲</button><button class="btn sm ghost" data-pal-act="down" title="Giù"${i<c.palettes.length-1?'':' disabled'}>▼</button>${p.builtin&&p.modified?'<button class="btn sm ghost" data-pal-act="restore" title="Rimette i colori originali">↺</button>':''}<button class="btn sm ghost danger" data-pal-act="del" title="Elimina">✕</button></div>
    </div>`).join(''):'';
  s.innerHTML=`<div class="sheet pal-sheet" role="dialog" aria-label="Palette">
    <div class="top"><h3>Palette</h3><button class="btn ghost" id="palClose">Chiudi</button></div>
    <p class="hint">Le palette sono i colori che i gruppi di luci fanno girare. Il catalogo sta in DMX Master: vale per tutti i progetti, i gruppi, le singole luci e le scene. "Custom" non è qui: sono i 5 colori custom di ogni gruppo, in Config rig.</p>
    ${c?`<div class="pal-list">${rows}</div>`:'<p class="hint">DMX Master non pubblica il catalogo delle palette: collegati a Gaia, oppure DMX Master va aggiornato (nota OPS 59).</p>'}
    <p class="hint pal-msg">${esc(PAL_MSG)}</p>
    <div class="row">${c?'<button class="btn primary" id="palNew">+ Nuova palette</button>':''}${c?.builtin_missing?.length?`<button class="btn ghost" id="palMissing" title="${esc(c.builtin_missing.join(', '))}">Ripristina quelle di partenza tolte (${c.builtin_missing.length})</button>`:''}</div>
  </div>`;
  PAL_MSG='';
  s.querySelector('#palClose').onclick=closeSheet;
  s.onpointerdown=e=>{if(e.target===s)closeSheet()};
  if(!c)return;
  const run=async(fn,ok)=>{try{await fn();PAL_MSG=ok}catch(e){PAL_MSG='✗ '+e.message}openPaletteCatalog()};
  s.querySelector('#palNew').onclick=()=>openPaletteEditor(null);
  const miss=s.querySelector('#palMissing');
  if(miss)miss.onclick=()=>run(async()=>{for(const n of c.builtin_missing)await palRequest('dmx_palette_restore',{name:n})},`✓ ripristinate: ${c.builtin_missing.join(', ')}`);
  s.querySelectorAll('[data-pal-act]').forEach(b=>b.onclick=async()=>{
    const i=+b.closest('[data-pal-i]').dataset.palI,p=c.palettes[i],a=b.dataset.palAct,names=c.palettes.map(x=>x.name);
    if(a==='edit')openPaletteEditor(p);
    else if(a==='dup'){let n=p.name+' copia',k=2;while(names.includes(n))n=`${p.name} copia ${k++}`;openPaletteEditor({...p,name:n,builtin:false},{dup:true})}
    else if(a==='up'||a==='down'){const j=i+(a==='up'?-1:1);[names[i],names[j]]=[names[j],names[i]];run(()=>palRequest('dmx_palette_order',{names}),'✓ ordine salvato')}
    else if(a==='restore'){if(await uiConfirm(`Rimettere "${p.name}" ai colori originali?`,{ok:'Ripristina'}))run(()=>palRequest('dmx_palette_restore',{name:p.name}),`✓ "${p.name}" ripristinata`)}
    else if(a==='del')paletteDelete(c,p,run);
  });
}
async function paletteDelete(c,p,run){
  const others=c.palettes.filter(x=>x.name!==p.name);
  if(!others.length){showError('Il catalogo deve avere almeno una palette.');return}
  const u=p.used||{},used=u.scenes||u.rigs?.length||u.fixtures;
  let replace=null;
  if(used){
    const def=others.find(x=>x.name===c.default)?.name||others[0].name;
    replace=await uiChoose(`"${p.name}" è usata: ${palUsageText(u).replace(/<[^>]+>/g,'')}. Gruppi e scene passano a:`,
      others.map(x=>({label:x.name,value:x.name,on:x.name===def})),{hint:'Le singole luci con questa palette tornano a seguire il colore del loro gruppo.'});
    if(!replace)return;
  }else if(!await uiConfirm(`Eliminare la palette "${p.name}"?${p.builtin?'\nÈ una di quelle di partenza: si può ripristinare in qualsiasi momento.':''}`,{ok:'Elimina'}))return;
  run(()=>palRequest('dmx_palette_remove',replace?{name:p.name,replace}:{name:p.name}),`✓ "${p.name}" eliminata${replace?`: gruppi e scene ora su "${replace}"`:''}`);
}
// p = palette da modificare (null = nuova); opts.dup = copia: si salva come nuova
function openPaletteEditor(p,opts={}){
  const c=palCatalog(),max=c?.max_colors||PAL_MAX_DEFAULT,nameMax=c?.name_max||32,orig=p&&!opts.dup?p.name:null;
  const st={name:p?.name||'',stepped:!!p?.stepped,colors:(p?.colors?.length?p.colors:[[1,0,0],[1,.6,0],[1,1,0]]).map(x=>[...x])};
  const s=$('#scrim');s.hidden=false;
  const paint=()=>{
    s.innerHTML=`<div class="sheet pal-sheet" role="dialog" aria-label="Modifica palette">
      <div class="top"><h3>${orig?'Modifica palette':'Nuova palette'}</h3><button class="btn ghost" id="peBack">← Palette</button></div>
      <label>Nome<input id="peName" maxlength="${nameMax}" value="${esc(st.name)}" placeholder="es. Tramonto caldo"></label>
      <div class="row pe-mode"><button class="btn sm${st.stepped?'':' primary'}" data-pe-mode="0" title="I colori sfumano uno nell'altro, in giro">Sfumata</button><button class="btn sm${st.stepped?' primary':''}" data-pe-mode="1" title="Un colore alla volta, cambio netto">A scatti</button></div>
      <i class="pal-sw big" style="background:${palGrad(st)}"></i>
      <div class="pe-cols">${st.colors.map((col,i)=>`<div class="pe-col" data-pe-i="${i}"><input type="color" value="${dmxHex(col)}" aria-label="Colore ${i+1}"><button class="btn sm ghost" data-pe-c="up"${i?'':' disabled'}>▲</button><button class="btn sm ghost" data-pe-c="down"${i<st.colors.length-1?'':' disabled'}>▼</button><button class="btn sm ghost" data-pe-c="del"${st.colors.length>1?'':' disabled'}>✕</button></div>`).join('')}</div>
      <div class="row"><button class="btn ghost" id="peAdd"${st.colors.length>=max?' disabled':''}>+ Colore</button><span class="hint">${st.colors.length} di ${max} colori${st.colors.length===1?' · un colore solo = tinta fissa':''}</span></div>
      ${orig&&p?.used&&palUsageText(p.used)?`<p class="hint">Usata da: ${palUsageText(p.used)}. Cambiando il nome si aggiornano anche loro.</p>`:''}
      <p class="hint pe-msg"></p>
      <div class="cue-editor-actions"><button class="btn ghost" id="peCancel">Annulla</button><button class="btn primary" id="peSave">Salva in DMX Master</button></div>
    </div>`;
    s.querySelector('#peBack').onclick=s.querySelector('#peCancel').onclick=()=>openPaletteCatalog();
    s.querySelector('#peName').oninput=e=>{st.name=e.target.value};
    s.querySelectorAll('[data-pe-mode]').forEach(b=>b.onclick=()=>{st.stepped=b.dataset.peMode==='1';paint()});
    s.querySelectorAll('.pe-col input[type=color]').forEach(inp=>inp.oninput=()=>{const i=+inp.closest('[data-pe-i]').dataset.peI;
      st.colors[i]=[1,3,5].map(k=>+(parseInt(inp.value.slice(k,k+2),16)/255).toFixed(3));s.querySelector('.pal-sw.big').style.background=palGrad(st)});
    s.querySelectorAll('[data-pe-c]').forEach(b=>b.onclick=()=>{const i=+b.closest('[data-pe-i]').dataset.peI,a=b.dataset.peC;
      if(a==='del')st.colors.splice(i,1);else{const j=i+(a==='up'?-1:1);[st.colors[i],st.colors[j]]=[st.colors[j],st.colors[i]]}paint()});
    s.querySelector('#peAdd').onclick=()=>{if(st.colors.length<max){st.colors.push([...st.colors[st.colors.length-1]]);paint()}};
    s.querySelector('#peSave').onclick=async()=>{
      const name=st.name.trim(),msg=s.querySelector('.pe-msg');
      const bad=!name?'Scrivi un nome.':name==='Custom'?'"Custom" è riservato ai colori custom dei gruppi.':(name!==orig&&(c?.palettes||[]).some(x=>x.name===name))?`Esiste già una palette "${name}".`:'';
      if(bad){msg.textContent=bad;return}
      const btn=s.querySelector('#peSave');btn.disabled=true;msg.textContent='Mando a DMX Master…';
      try{await palRequest('dmx_palette_set',{name,colors:st.colors,stepped:st.stepped,...(orig&&orig!==name?{rename_from:orig}:{})});
        PAL_MSG=`✓ "${name}" salvata in DMX Master${orig&&orig!==name?` (prima "${orig}")`:''}`;openPaletteCatalog()}
      catch(e){msg.textContent='✗ '+e.message;btn.disabled=false}};
  };
  paint();
}
