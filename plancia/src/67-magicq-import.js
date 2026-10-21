/* ---------- import da ChamSys MagicQ (.shw) ---------- */
// Il file .shw di MagicQ e' testo: un record per riga, prima lettera = tipo.
// Personalita' (= modello di fixture), record P:
//   P,<id>,"<nome>","<produttore>","<modo>","<nome corto>",  (es. "Coemar_iWash575_EB","Coemar","EB","iWash575")
//   <n canali>,<n righe range>,...
//   "<canale>",<tipo>,<attributo>,      x n canali, in ordine DMX
//   <valori di default>                 una riga
//   <canale>,"<nome>",<da>,<a>,...      x n righe range (slot ruota, gobo...)
// Da qui un modello per DMX Master: ruoli dei canali, slot di ruota colori e
// gobo col valore DMX d'inizio (TD ricava il colore dal nome, nota 34).
const MQ_ROLE=[ // nome canale MagicQ -> ruolo TD (il primo che combacia)
  [/^pan\s*(f|fine)$/i,'pan_fine'],[/^pan$/i,'pan'],[/^tilt\s*(f|fine)$/i,'tilt_fine'],[/^tilt$/i,'tilt'],
  [/^(dimmer|dim|intensity|intens)$/i,'dimmer'],[/^(shutter|strobe|shut)$/i,'shutter'],
  [/^(col|colour|color|col\s*1|colour\s*1|color\s*wheel|col\s*wheel)$/i,'color'],
  [/^cyan$/i,'cyan'],[/^magenta$/i,'magenta'],[/^yellow$/i,'yellow'],
  [/^red$/i,'red'],[/^green$/i,'green'],[/^blue$/i,'blue'],[/^white$/i,'white'],[/^amber$/i,'amber'],[/^uv$/i,'uv'],
  [/^(gobo|gobo\s*1|gobos)$/i,'gobo'],[/^zoom$/i,'zoom'],[/^focus$/i,'focus'],
  [/^(m\s*speed|p\/t\s*speed|pt\s*speed|speed|mspeed)$/i,'speed']];
const MQ_NOT_SLOT=/scroll|stop|rnd|random|rotat|spin|shake|cw|ccw|split|half|macro/i;
// colore indicativo dello slot dal nome (l'operatore lo corregge nell'editor)
const MQ_COLOR=[[/white|open|bianco/i,[1,1,1]],[/uv|black[\s_]*light/i,[.45,.2,1]],[/light[\s_]*blue|azure|sky/i,[.4,.75,1]],[/cyan|ciano/i,[0,1,1]],
  [/magenta|pink|rosa/i,[1,0,1]],[/orange|arancio/i,[1,.5,0]],[/yellow|giallo/i,[1,1,0]],[/lime/i,[.6,1,0]],[/green|verde/i,[0,1,0]],
  [/red|rosso/i,[1,0,0]],[/purple|violet|lavender|viola/i,[.6,.2,1]],[/blue|blu/i,[0,0,1]],[/ctb/i,[.75,.85,1]],[/cto|3200|warm/i,[1,.8,.55]]];
function mqSlotRgb(name){for(const[re,rgb]of MQ_COLOR)if(re.test(name))return rgb.slice();return null}
function mqRole(name){const n=String(name).trim();for(const[re,r]of MQ_ROLE)if(re.test(n))return r;
  return n.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').replace(/^(\d)/,'ch_$1')||'ch'}
function parseMagicQShow(text){
  const lines=String(text||'').split(/\r?\n/),out=[];
  for(let i=0;i<lines.length;i++){
    const m=/^P,([0-9a-fA-F]+),"([^"]*)","([^"]*)","([^"]*)","([^"]*)",/.exec(lines[i]);if(!m)continue;
    const counts=(lines[i+1]||'').split(',').map(x=>parseInt(x,16));
    const nCh=counts[0],nRange=counts[1];if(!(nCh>0&&nCh<=512))continue;
    const chans=[];let j=i+2;
    for(;j<lines.length&&chans.length<nCh;j++){const c=/^"([^"]*)",([0-9a-fA-F]+),([0-9a-fA-F]+),/.exec(lines[j]);if(c)chans.push({name:c[1],attr:parseInt(c[3],16)});else break}
    if(chans.length!==nCh)continue;
    j++; // riga dei valori di default
    const ranges=[];
    for(;j<lines.length&&ranges.length<(nRange||0);j++){const r=/^([0-9a-fA-F]{4}),"([^"]*)",([0-9a-fA-F]+),([0-9a-fA-F]+),/.exec(lines[j]);if(r)ranges.push({ch:parseInt(r[1],16),name:r[2],from:parseInt(r[3],16),to:parseInt(r[4],16)});else break}
    // ruoli unici: un secondo "color" o un nome ripetuto prende un suffisso
    const used={},roles=chans.map(c=>{let r=mqRole(c.name);if(used[r]){used[r]++;r=`${r}_${used[r]}`}else used[r]=1;return r});
    const slotsOf=role=>{const k=roles.indexOf(role);if(k<0)return[];const seen=new Set();
      return ranges.filter(r=>r.ch===k&&!MQ_NOT_SLOT.test(r.name)&&r.name.trim()).map(r=>({name:r.name.trim().replace(/\s+/g,'_'),value:r.from}))
        .filter(s=>!seen.has(s.value)&&seen.add(s.value)).sort((a,b)=>a.value-b.value)};
    const has=r=>roles.includes(r),kind=has('pan')&&has('tilt')?'heads':['red','green','blue'].some(has)?'chase':'level';
    out.push({id:parseInt(m[1],16),model:[m[3],m[5]||m[2],m[4]].filter(Boolean).join(' ').replace(/_/g,' ').replace(/\s+/g,' ').trim(),
      source:m[2],manufacturer:m[3],mode:m[4],kind,channels:roles,original:chans.map(c=>c.name),
      colors:kind==='heads'?slotsOf('color').map(c=>{const rgb=mqSlotRgb(c.name);return rgb?{...c,rgb}:c}):[],gobos:kind==='heads'?slotsOf('gobo'):[]});
    i=j-1;
  }
  return out;
}

// ---- UI: dall'editor dei modelli ----
function importMagicQModels(back){
  const inp=document.createElement('input');inp.type='file';inp.accept='.shw,.txt';
  inp.onchange=async()=>{const f=inp.files?.[0];if(!f)return;
    let list=[];try{list=parseMagicQShow(await f.text())}catch(e){showError('MagicQ: file non leggibile ('+e.message+')');return}
    if(!list.length){showError('MagicQ: nessuna personalità trovata nel file (serve un .shw salvato da MagicQ).');return}
    showMagicQList(list,f.name,back)};
  inp.click();
}
function showMagicQList(list,file,back){
  showModelCandidates(list,{title:`Da MagicQ · ${file}`,from:'da MagicQ',back,
    hint:`Personalità trovate nel file. "Prepara modello" apre l'editor già compilato (canali tradotti nei ruoli di DMX Master, slot di ruota colori e gobo): controlla e premi "Crea su DMX Master". La patch delle teste (indirizzi) di questo file non viene importata qui.`});
}
// elenco di modelli candidati (import MagicQ, libreria fixture): "Prepara
// modello" apre l'editor precompilato, che crea un modello nuovo su DMX Master
function showModelCandidates(list,o){
  const s=$('#scrim');s.hidden=false;const have=new Set(tdModels().map(m=>m.model));
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Modelli da importare">
    <div class="top"><h3>${esc(o.title)}</h3><button class="btn ghost" id="mqBack">${esc(o.backLabel||'← Modelli')}</button></div>
    <p class="hint">${esc(o.hint||'')}</p>
    <div class="md-list">${list.map((p,i)=>`<div class="md-row"><b>${esc(p.model)}</b>
      <span class="hint">${p.channels.length} ch · ${esc(p.kind)} · ${esc(p.channels.join(' '))}${p.colors.length?` · ruota: ${esc(p.colors.map(c=>c.name+'='+c.value).join(' '))}`:''}${have.has(p.model)?' · <b>già nel catalogo</b>':''}</span>
      <button class="btn sm" data-mq="${i}">Prepara modello</button></div>`).join('')}</div>
  </div>`;
  s.querySelector('#mqBack').onclick=o.back||openModelEditor;
  s.querySelectorAll('[data-mq]').forEach(b=>b.onclick=()=>{const p=list[+b.dataset.mq];
    openModelForm({model:p.model,kind:p.kind,channels:p.channels,footprint:p.channels.length,manufacturer:p.manufacturer,
      notes:p.notes||`importato ${o.from} (${p.source}${p.mode?', modo '+p.mode:''}) — verificare sul manuale`,beam:[1,1,1],
      pan_range:p.pan_range||540,tilt_range:p.tilt_range||270,defaults:p.defaults||'',lamp:p.lamp||null,colors:p.colors.map(c=>({...c})),gobos:p.gobos.map(c=>({...c}))},
      {asNew:true,from:o.from,back:()=>showModelCandidates(list,o)})});
}

if(typeof module==='object'&&module.exports){module.exports={parseMagicQShow,mqRole,mqSlotRgb};}
