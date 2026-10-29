/* ---------- motore dello show (simulazione locale del rig) ---------- */
const mkT=v=>({f:v.slice(),t:v.slice(),c:v.slice(),t0:0,d:0});
function goT(T,v,d){T.f=T.c.slice();T.t=v.slice();T.t0=now();T.d=d}
function setI(T,i,v){T.f[i]=T.t[i]=T.c[i]=v}
function stepT(T,n){const k=T.d>0?clamp((n-T.t0)/(T.d*1000)):1,e=k*k*(3-2*k);for(let i=0;i<T.c.length;i++)T.c[i]=T.f[i]+(T.t[i]-T.f[i])*e}
const SH={master:1,fade:1.5,blackout:0,strobe:0,rate:8,chase:0,scene:-1,t0:0,
  g:{front:.85,back:.9,mh:1,ledbar:.8,ledwall:.9,haze:.55,blinder:0},
  led:{mode:1,bright:.9},sel:new Set([0,1,2,3,4,5,6,7]),
  wash:mkT([0,0,0]),back:mkT([0,0,0]),bar:mkT([0,0,0]),wall:mkT([0,0,0]),
  heads:Array.from({length:12},()=>({T:mkT([0,.5,1,1,1,0,.3,.7]),gobo:0,strobe:0}))};
function ensureHeadPool(n){while(SH.heads.length<n)SH.heads.push({T:mkT([0,.5,1,1,1,0,.3,.7]),gobo:0,strobe:0})}
function posOf(p,i,n){const u=n>1?i/(n-1)*2-1:0;
  switch(p){case 0:return[-u*.32,.62];case 1:return[u*.25,.98];case 2:return[-u*.12,.45];case 3:return[u*.45,-.75];case 4:return[i%2?.42:-.42,.55];case 5:return[u*.85,.5];default:return[0,.5]}}
function goScene(i,d=SH.fade){
  const l=LOOKS[i]; if(!l)return; SH.scene=i; SH.t0=now();
  goT(SH.wash,l.wash,d);goT(SH.back,l.back,d);goT(SH.bar,l.bar,d);goT(SH.wall,l.wall.col,d);SH.led.mode=l.wall.mode;
  const n=fixCounts().mh;ensureHeadPool(n);
  for(let k=0;k<n;k++){const h=SH.heads[k],[p,t]=posOf(l.mh.pos,k,n);const mid=Math.abs(k-(n-1)/2)<1;
    goT(h.T,[p,t,...l.mh.col,l.mh.only&&!mid?0:l.mh.dim,l.mh.zoom,h.T.t[7]],d);h.gobo=l.mh.gobo;h.strobe=0}
  syncLedWidgets();
}
function syncLedWidgets(){for(const w of allW())if(w.type==='scenes'&&w.addr==='/led/mode'){w.value=SH.led.mode;paint(elOf(w.id),w)}}
const selHeads=()=>{const n=fixCounts().mh;ensureHeadPool(n);return SH.heads.filter((h,k)=>SH.sel.has(k)&&k<n)};
function model(a,args){
  const v=+args[0];
  if(a.startsWith('/dmx/group/')){const g=a.slice(11);if(g in SH.g)SH.g[g]=v;return}
  switch(a){
    case '/dmx/master':SH.master=v;break;
    // Con le scene di DMX Master l'indice e' una scena di TD, non un LOOK
    // locale: niente goScene (il Render mostra l'uscita vera, nota 33).
    // I LOOKS restano solo per la simulazione senza TD.
    case '/dmx/scene':if(tdScenes().length)SH.scene=Math.round(v);else goScene(Math.round(v));break;
    case '/dmx/fade':SH.fade=v;break;
    case '/dmx/blackout':SH.blackout=v>.5;break;
    case '/dmx/strobe':SH.strobe=v>.5;break;
    case '/dmx/strobe/rate':SH.rate=v;break;
    case '/dmx/chase':SH.chase=Math.round(v);break;
    case '/mh/select':SH.sel=new Set(args.map((x,k)=>+x>.5?k:-1).filter(k=>k>=0));break;
    case '/mh/pantilt':selHeads().forEach(h=>{setI(h.T,0,+args[0]);setI(h.T,1,-(+args[1]))});break;
    case '/mh/color':selHeads().forEach(h=>[0,1,2].forEach(j=>setI(h.T,2+j,+args[j])));break;
    case '/mh/dimmer':selHeads().forEach(h=>setI(h.T,5,v));break;
    case '/mh/zoom':selHeads().forEach(h=>setI(h.T,6,v));break;
    case '/mh/focus':selHeads().forEach(h=>setI(h.T,7,v));break;
    case '/mh/gobo':selHeads().forEach(h=>h.gobo=Math.round(v));break;
    case '/mh/strobe':selHeads().forEach(h=>h.strobe=v>.5);break;
    case '/mh/position':{const n=fixCounts().mh;ensureHeadPool(n);SH.heads.forEach((h,k)=>{if(!SH.sel.has(k)||k>=n)return;const [p,t]=posOf(Math.round(v),k,n);const tt=h.T.t.slice();tt[0]=p;tt[1]=t;goT(h.T,tt,.7)});break}
    case '/mh/home':if(v>.5)selHeads().forEach(h=>{goT(h.T,[0,.5,1,1,1,1,.3,.7],.6);h.gobo=0;h.strobe=0});break;
    case '/led/color':[0,1,2].forEach(j=>setI(SH.wall,j,+args[j]));break;
    case '/led/mode':SH.led.mode=Math.round(v);break;
    case '/led/bright':SH.led.bright=v;break;
  }
}

/* ---------- runtime timeline (condiviso per indirizzo) ---------- */
const RT={}; const cueCache=new Map();
const rt=w=>RT[w.addr]||(RT[w.addr]={t:0,playing:false,loop:false,cue:-1,last:0,sent:0});
function parseCues(w){
  const k=w.cues||''; if(cueCache.has(k))return cueCache.get(k);
  const r=k.split('\n').map(s=>s.match(/^\s*(\d+):(\d{1,2}(?:\.\d+)?)\s+(.*?)(?:\s*>\s*(.+))?\s*$/)).filter(Boolean)
    .map(m=>{
      const targets=(m[4]||'').split(';').map(s=>s.trim()).filter(Boolean),sceneTarget=targets.find(s=>/^[1-9]\d*$/.test(s)),sceneName=targets.find(s=>s.startsWith('@')&&s.length>1);
      // fade=<s>: crossfade della cue in DMX Master (show_timeline), non un parametro DMX V8
      const isFade=s=>/^fade\s*=/i.test(s),fadeTarget=targets.find(isFade),fade=fadeTarget?parseFloat(fadeTarget.split('=')[1]):NaN;
      return{t:+m[1]*60+ +m[2],name:m[3]||'Cue',scene:sceneTarget!=null?+sceneTarget-1:null,sceneId:sceneName?sceneName.slice(1).trim():null,fade:fade>=0?fade:null,
        params:targets.filter(s=>s.includes('=')&&!isFade(s)).map(s=>{const i=s.indexOf('=');return{param:s.slice(0,i).trim(),value:s.slice(i+1).trim()}}),
        invalid:targets.filter(s=>!s.includes('=')&&!/^\d+$/.test(s)&&!s.startsWith('@'))};
    }).sort((a,b)=>a.t-b.t);
  cueCache.set(k,r); return r;
}
// scena per nome (@id, stabile) o per indice 1-based (look locali / vecchie cue)
const cueSceneIndex=c=>c.sceneId!=null?(tdScenes().find(x=>x.id===c.sceneId)?.index??null):c.scene;
const cueTargets=c=>[c.sceneId!=null?'@'+c.sceneId:c.scene!=null?String(c.scene+1):'',c.fade!=null?`fade=${c.fade}`:'',...c.params.map(p=>`${p.param}=${p.value}`),...c.invalid].filter(Boolean).join('; ');
function formatCueTime(value){
  const total=Math.round(value*100),minutes=Math.floor(total/6000),seconds=(total%6000)/100;
  const whole=Math.floor(seconds),fraction=String(seconds.toFixed(2)).split('.')[1]?.replace(/0+$/,'')||'';
  return`${minutes}:${String(whole).padStart(2,'0')}${fraction?'.'+fraction:''}`;
}
function parseCueTime(value){
  const text=String(value||'').trim(),clock=text.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if(clock){const seconds=+clock[2];return seconds<60?+clock[1]*60+seconds:NaN}
  return/^\d+(?:\.\d+)?$/.test(text)?+text:NaN;
}
function serializeCues(cues){
  return[...cues].sort((a,b)=>a.t-b.t).map(c=>`${formatCueTime(c.t)} ${c.name.trim()||'Cue'}${c.targets.trim()?` > ${c.targets.trim()}`:''}`).join('\n');
}
// Testo cue -> {scene (1-based, stringa), fade, extra (parametri DMX V8)}
function cueSplitTargets(targets){
  const parts=String(targets||'').split(';').map(x=>x.trim()).filter(Boolean);
  const scene=parts.find(x=>/^[1-9]\d*$/.test(x)||(x.startsWith('@')&&x.length>1))||'',fadeTok=parts.find(x=>/^fade\s*=/i.test(x));
  return{scene,fade:fadeTok?String(parseFloat(fadeTok.split('=')[1])):'',extra:parts.filter(x=>x!==scene&&x!==fadeTok).join('; ')};
}
// colore della scena (scena di TD) o del look locale in simulazione
function cueSceneSwatch(v){
  if(String(v).startsWith('@')){const sc=tdScenes().find(x=>x.id===String(v).slice(1));return sc?tdSceneLook(sc).grad||'':''}
  const i=+v-1;if(!(i>=0))return'';
  const td=tdScenes();if(td.length){const sc=td.find(x=>x.index===i);return sc?tdSceneLook(sc).grad||'':''}
  return LOOKS[i]?lookHex(i):'';
}
// Menu scena: le scene di DMX Master; senza TD i look locali (simulazione)
function cueSceneFields(targets,i){
  let{scene,fade}=cueSplitTargets(targets);const td=tdScenes();
  // vecchia cue per numero: con TD si converte al nome della scena
  if(td.length&&/^\d+$/.test(scene)){const sc=td.find(x=>x.index===+scene-1);if(sc)scene='@'+sc.id}
  const list=td.length?td.map(x=>({v:'@'+x.id,t:`${String(x.index+1).padStart(2,'0')} · ${x.label||x.id}`})):LOOKS.map((l,k)=>({v:String(k+1),t:`${String(k+1).padStart(2,'0')} · ${l.n} (simulazione)`}));
  const opts=['<option value="">— marker, nessuna scena —</option>',...list.map(o=>`<option value="${esc(o.v)}"${o.v===scene?' selected':''}>${esc(o.t)}</option>`)];
  if(scene&&!list.some(o=>o.v===scene))opts.push(`<option value="${esc(scene)}" selected>scena ${esc(scene.replace(/^@/,''))} (non esiste)</option>`);
  return`<label>Scena<span class="cue-scene-wrap"><span class="cue-sw" style="background:${cueSceneSwatch(scene)}"></span><select class="cue-scene" aria-label="Scena cue ${i+1}">${opts.join('')}</select></span></label>
    <label>Fade (s)<input class="cue-fade" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(fade)}" placeholder="2" aria-label="Fade cue ${i+1}"></label>`;
}
// meta: valori in sospeso da applicare solo con Salva (duration/bpm/rev di una
// timeline appena importata da TD); meta.td = timeline /show che segue TD,
// dove Salva significa inviare a DMX Master.
function renderCueEditor(w,cues,meta={}){
  const s=$('#scrim');s.hidden=false;
  const duration=meta.duration||w.duration,tdMode=!!meta.td;
  CUE_ED={w,td:tdMode,rev:meta.rev||null,dirty:!!meta._dirty};
  const rows=cues.map((c,i)=>`<div class="cue-edit-row" data-cue-row="${i}">
    <label>Posizione (M:SS)<input class="cue-time" value="${esc(formatCueTime(c.t))}" inputmode="decimal" aria-label="Posizione cue ${i+1}"></label>
    <label>Nome<input class="cue-name" value="${esc(c.name)}" aria-label="Nome cue ${i+1}"></label>
    ${cueSceneFields(c.targets,i)}
    <div class="row"><button class="btn sm" data-cue-move="-1" aria-label="Sposta cue ${i+1} su"${i===0?' disabled':''}>↑</button><button class="btn sm" data-cue-move="1" aria-label="Sposta cue ${i+1} giù"${i===cues.length-1?' disabled':''}>↓</button><button class="btn sm danger" data-cue-delete="${i}" aria-label="Elimina cue ${i+1}">×</button></div>
    <details class="cue-adv"${cueSplitTargets(c.targets).extra?' open':''}><summary>Avanzate · parametri DMX V8 (solo Plancia)</summary><input class="cue-extra mono" value="${esc(cueSplitTargets(c.targets).extra)}" placeholder="dmx_a_palette=Warm; dmx_b_palette=Cool" aria-label="Parametri DMX cue ${i+1}"></details>
  </div>`).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Editor timeline">
    <div class="top"><h3>Timeline · ${esc(w.label)}</h3><button class="btn ghost" id="cueClose">Chiudi</button></div>
    <p class="hint">Per ogni cue scegli quando (posizione), quale scena e in quanti secondi arrivarci (fade). Le cue si riordinano da sole per posizione.</p>
    <div class="row cue-dur"><label>Durata timeline (M:SS)<input id="cueDur" value="${esc(formatCueTime(duration))}" inputmode="decimal" aria-label="Durata timeline"></label><span class="hint">Le cue vanno da 0:00 a prima della fine: con il loop una cue sulla fine non scatta.</span></div>
    <div class="cue-edit-list">${rows||'<p class="hint">Nessuna cue. Aggiungine una per iniziare.</p>'}</div>
    <div class="row"><button class="btn" id="cueAdd">＋ Aggiungi cue</button></div>
    <p class="hint">Ogni cue richiama una <b>scena</b> di DMX Master all'istante indicato, sfumando per <b>Fade</b> secondi (vuoto = 2 s). Le scene si creano e si modificano in <b>＋ Scene…</b>. Una cue senza scena è un <b>marker</b>: solo un nome sulla timeline. Le scene si sommano: una cue "colore" e una "teste" restano attive tutte e due.</p>
    <p id="cueTdChanged" class="hint warn" hidden>TD ha cambiato la timeline mentre la modificavi (rev <b></b>). "⇩ Importa da TD" riparte dalla sua; Salva prova a sovrascriverla e TD chiede conferma del conflitto.</p>
    ${tdMode?'<p class="hint">Timeline dello show di DMX Master: Salva la invia a TD, che la valida prima di caricarla.</p>':''}
    <div class="cue-editor-actions"><div class="row cue-td"><button class="btn ghost" id="cueImportTD" title="Carica nell'editor la timeline attuale di DMX Master (show_timeline)">⇩ Importa da TD</button>${tdMode?'':'<button class="btn" id="cueSendTD" title="Salva e invia questa timeline a DMX Master: TD la valida, poi chiede conferma">⇪ Invia a TD</button>'}</div><button class="btn ghost" id="cueCancel">Annulla</button><button class="btn primary" id="cueSave">${tdMode?'Salva e invia a TD':'Salva timeline'}</button></div>
  </div>`;
  const readRows=()=>[...s.querySelectorAll('.cue-edit-row')].map(row=>({
    t:parseCueTime(row.querySelector('.cue-time').value),
    name:row.querySelector('.cue-name').value.trim()||'Cue',
    // ricompone il testo della cue: "<scena 1-based>; fade=<s>; <avanzate>"
    targets:[row.querySelector('.cue-scene').value,row.querySelector('.cue-fade').value.trim()!==''?`fade=${+row.querySelector('.cue-fade').value}`:'',
      row.querySelector('.cue-extra').value.trim()].filter(Boolean).join('; ')
  }));
  s.querySelectorAll('.cue-scene').forEach(sel=>sel.onchange=()=>{const sw=sel.closest('.cue-edit-row').querySelector('.cue-sw');if(sw)sw.style.background=cueSceneSwatch(sel.value)});
  // durata modificabile qui (prima era fissa: con la timeline di TD a 10 s
  // ogni cue oltre 0:10 veniva rifiutata e non c'era modo di allungarla)
  const dur=()=>{const d=parseCueTime(s.querySelector('#cueDur').value);return d>0?d:duration};
  // ridisegna con la lista data: prima rileggeva sempre le righe dal DOM,
  // quindi la cue appena aggiunta (o tolta) da Aggiungi/× si perdeva
  const redraw=(list=readRows())=>renderCueEditor(w,list,{...meta,duration:dur(),_dirty:true});
  s.querySelector('.sheet').addEventListener('input',()=>{if(CUE_ED)CUE_ED.dirty=true});
  s.querySelector('#cueDur').onchange=()=>{
    if(!(parseCueTime(s.querySelector('#cueDur').value)>0)){showError('Durata: scrivi M:SS o secondi, maggiore di zero.');return}
    redraw();
  };
  s.querySelector('#cueClose').onclick=s.querySelector('#cueCancel').onclick=closeSheet;
  s.querySelector('#cueAdd').onclick=()=>{
    const current=readRows(),times=current.map(c=>c.t).filter(Number.isFinite).sort((a,b)=>a-b),duration=dur();
    // 10 s dopo l'ultima; se non ci sta, a meta' del buco piu' grande della
    // timeline (prima finiva sopra l'ultima cue, a fine durata: nota TD 36)
    let t=(times.length?times[times.length-1]:-10)+10;
    if(t>=duration){const pts=[0,...times,duration];let gap=[0,0];
      for(let i=1;i<pts.length;i++)if(pts[i]-pts[i-1]>gap[1]-gap[0])gap=[pts[i-1],pts[i]];
      t=(gap[0]+gap[1])/2}
    current.push({t:Math.round(t*100)/100,name:`Cue ${current.length+1}`,targets:''});
    redraw(current);
    s.querySelector('.cue-edit-row:last-child .cue-name')?.focus();
  };
  s.querySelectorAll('[data-cue-move]').forEach(button=>button.onclick=()=>{
    const current=readRows(),i=+button.closest('[data-cue-row]').dataset.cueRow,j=i+ +button.dataset.cueMove;
    if(j<0||j>=current.length)return;
    [current[i].t,current[j].t]=[current[j].t,current[i].t];
    renderCueEditor(w,current.sort((a,b)=>a.t-b.t),{...meta,duration:dur(),_dirty:true});
  });
  s.querySelectorAll('[data-cue-delete]').forEach(button=>button.onclick=()=>{
    const current=readRows();current.splice(+button.dataset.cueDelete,1);redraw(current);
  });
  const commit=()=>{
    const current=readRows(),duration=dur();
    const invalid=current.find(c=>!Number.isFinite(c.t)||c.t<0||c.t>=duration);
    if(invalid){showError(`Timeline: "${invalid.name}" deve stare tra 0:00 e prima di ${formatCueTime(duration)} (fine timeline). Per andare oltre allunga la Durata.`);return false}
    if(current.some(c=>c.name.includes('>'))){showError('Il nome della cue non può contenere il separatore ">".');return false}
    const same=current.find((c,i)=>current.some((d,j)=>j!==i&&Math.abs(d.t-c.t)<.005));
    if(same){showError(`Due cue allo stesso istante (${formatCueTime(same.t)}): spostane una.`);return false}
    w.cues=serializeCues(current);
    w.duration=duration;
    if(meta.bpm)w.bpm=meta.bpm;
    if(meta.rev)w.tdBaseRev=meta.rev;
    save();refresh(w);return true;
  };
  s.querySelector('#cueSave').onclick=()=>{if(commit()){closeSheet();if(tdMode)sendTimelineToTD(w)}};
  const send=s.querySelector('#cueSendTD');
  if(send)send.onclick=()=>{if(commit()){closeSheet();sendTimelineToTD(w)}};
  s.querySelector('#cueImportTD').onclick=()=>{
    const doc=tdTimelineDoc();
    if(!doc){showError('DMX Master non pubblica show_timeline: collega Gaia (⋯ → Gaia) o aggiorna il contratto TD.');return}
    const n=readRows().length;
    if(n&&!confirm(`Sostituire le ${n} cue nell'editor con la timeline di DMX Master${doc.name?` "${doc.name}"`:''} (${doc.cues.length} cue, ${formatCueTime(+doc.length||0)})?\nDiventa definitiva solo con Salva.`))return;
    renderCueEditor(w,timelineFromTD(doc),{...meta,duration:Math.max(1,+doc.length||duration),bpm:+doc.bpm>0?+doc.bpm:null,rev:doc.rev,_dirty:false});
  };
}

// ── Timeline Plancia ⇄ DMX Master (GAIA_INTERFACE "TD/Win-PD, 29") ─────
// TD riceve l'intera timeline come UN documento sul param show_timeline:
// la valida tutta insieme (dry_run = solo verifica), su errore non scrive
// nulla, e l'esito arriva in show_timeline_result {seq, ok, errors,
// warnings, rev, conflict, cues, markers, length}. Le scene viaggiano per
// NOME (id stabile di show_scene_catalog): l'indice /dmx/scene di Plancia
// slitta se in TD si cancella una scena precedente. base_rev = rev letta
// all'ultimo import/invio: se intanto la timeline e' cambiata in TD, TD
// risponde conflict invece di sovrascrivere in silenzio. Le automazioni
// (keys) non vengono inviate: assenti = quelle di TD restano intatte.
const tdSceneCatalog=()=>{const c=tdParams().show_scene_catalog;return Array.isArray(c)?c:[]};
// prima il topic retained gaia/devices/td-dmx-win/show_timeline, poi lo status
const tdTimelineDoc=()=>{const d=G.tdTimeline||tdParams().show_timeline;return d&&Array.isArray(d.cues)?d:null};
// Editor aperto sulla timeline di TD (CUE_ED: widget + rev da cui parte +
// modifiche locali). Rev nuova sul topic: senza modifiche l'editor si
// ricarica da solo, con modifiche avvisa (nota TD 31, flusso punto 1).
let CUE_ED=null;
function onTdTimelineRev(doc){
  refreshShowTimelines();
  const open=CUE_ED&&!$('#scrim').hidden&&document.querySelector('.cue-edit-list');
  if(!open||!CUE_ED.td||CUE_ED.rev===doc.rev)return;
  if(!CUE_ED.dirty){renderCueEditor(CUE_ED.w,timelineFromTD(doc),{td:true,duration:Math.max(1,+doc.length||CUE_ED.w.duration),bpm:+doc.bpm>0?+doc.bpm:null,rev:doc.rev});return}
  const box=document.querySelector('#cueTdChanged');
  if(box){box.hidden=false;box.querySelector('b').textContent=`${doc.rev}${doc.source?` · da ${doc.source}`:''}`}
}
function timelineToTD(w){
  const cat=tdSceneCatalog(),notes=[];
  const cues=parseCues(w).map(c=>{
    const known=c.sceneId!=null?cat.find(x=>x.id===c.sceneId):c.scene==null?null:cat.find(x=>x.index===c.scene);
    if(c.params.length)notes.push(`"${c.name}": ${c.params.map(p=>p.param).join(', ')}`);
    // nome = scena o "Cue n" sono i segnaposto di una label vuota (vedi
    // timelineFromTD): si rimanda "" cosi' l'andata e ritorno non cambia la rev
    const placeholder=(known&&c.name===known.id)||/^Cue( \d+)?$/.test(c.name);
    const d={time:+c.t.toFixed(3),scene:c.sceneId!=null?c.sceneId:c.scene==null?null:known?known.id:c.scene,label:placeholder?'':c.name};
    if(c.fade!=null)d.fade=c.fade;
    return d;
  });
  const doc={v:1,name:w.label||'Timeline',bpm:+w.bpm>0?+w.bpm:null,length:w.duration,default_fade:2,
    missing_scenes:'marker',source:'plancia',cues};
  if(w.tdBaseRev)doc.base_rev=w.tdBaseRev;
  return{doc,notes};
}
function timelineFromTD(doc){
  const cat=tdSceneCatalog();
  return doc.cues.map((c,i)=>{
    const known=c.scene?cat.find(x=>x.id===c.scene):null;
    // fade 2 = default_fade di TD: omesso, al reinvio torna uguale
    const fade=Number.isFinite(+c.fade)&&+c.fade!==2?`fade=${+c.fade}`:'';
    const targets=[c.scene?'@'+c.scene:'',fade].filter(Boolean).join('; ');
    return{t:+c.time||0,name:String(c.label||c.scene||`Cue ${i+1}`).replace(/>/g,'›'),targets};
  });
}
// Invia un documento e aspetta il PROPRIO esito (seq diverso da quello di
// prima dell'invio), stesso schema a polling di resolveDuplicates().
function tdTimelineRequest(doc){
  const before=tdParams().show_timeline_result?.seq;
  if(!devCmd('td-dmx-win',{action:'set',param:'show_timeline',value:doc}))
    return Promise.reject(new Error('Non collegata a Gaia: apri ⋯ → Gaia e collegati prima.'));
  return new Promise((resolve,reject)=>{
    let tries=0;
    const check=()=>{
      const r=tdParams().show_timeline_result;
      if(r&&r.seq!==before&&!!r.dry_run===!!doc.dry_run)return resolve(r);
      if(++tries>=16){const err=G.devices['td-dmx-win']?.last_error;
        return reject(new Error('Nessuna risposta da DMX Master entro 8 s'+(err?`: ${err}`:'.')))}
      setTimeout(check,500);
    };
    setTimeout(check,500);
  });
}
async function sendTimelineToTD(w){
  const{doc,notes}=timelineToTD(w);
  const list=a=>'\n• '+a.join('\n• ');
  try{
    let check=await tdTimelineRequest({...doc,dry_run:true});
    if(!check.ok&&check.conflict&&check.errors.every(e=>e.startsWith('conflitto'))){
      if(!confirm('La timeline in DMX Master è stata modificata dopo l\'ultimo import/invio da Plancia.\nSovrascriverla comunque con questa?'))return;
      doc.force=true;check=await tdTimelineRequest({...doc,dry_run:true});
    }
    if(!check.ok){alert('DMX Master rifiuta la timeline:'+list(check.errors));return}
    const lines=[`Inviare "${doc.name}" a DMX Master?`,
      `${check.cues} cue · durata ${formatCueTime(check.length)}${check.markers?` · ${check.markers} senza scena (marker)`:''}`,
      'Sostituisce le cue dello show in TD; le automazioni restano invariate.'];
    if(check.warnings?.length)lines.push('','Avvisi di TD:'+list(check.warnings));
    if(notes.length)lines.push('','Parametri DMX che TD non riceve (restano solo in Plancia):'+list(notes));
    if(!confirm(lines.join('\n')))return;
    const r=await tdTimelineRequest(doc);
    if(!r.ok){alert('Caricamento rifiutato da DMX Master:'+list(r.errors));return}
    w.tdBaseRev=r.rev;save();
    // conferma vera = il topic retained porta la rev dell'esito (nota TD 31)
    let seen=G.tdTimeline?.rev===r.rev;
    for(let i=0;i<10&&!seen;i++){await new Promise(ok=>setTimeout(ok,500));seen=G.tdTimeline?.rev===r.rev}
    alert(`Timeline caricata in DMX Master: ${r.cues} cue (rev ${r.rev}).`+(seen?' Confermata sul topic show_timeline.':' Il topic show_timeline non ha ancora la nuova rev: controlla che la timeline dello show si aggiorni.'));
  }catch(e){alert(e.message)}
}
function openCueEditor(w){
  // /show che segue TD: si modifica la timeline di DMX Master, non la bozza locale
  const doc=isShowTimeline(w)&&showClock.authority?tdTimelineDoc():null;
  if(doc){renderCueEditor(w,timelineFromTD(doc),{td:true,duration:Math.max(1,+doc.length||w.duration),bpm:+doc.bpm>0?+doc.bpm:null,rev:doc.rev});return}
  const cues=parseCues(w).map(c=>({t:c.t,name:c.name,targets:cueTargets(c)}));
  renderCueEditor(w,cues,{td:isShowTimeline(w)&&showClock.authority});
}
function headControlWidgets(){
  return page().widgets.filter(w=>w.addr?.startsWith('/mh/')&&
    !['/mh/select','/mh/select/heads','/mh/home','/mh/follow','/mh/release','/mh/position','/mh/preset/recall'].includes(w.addr));
}
function captureHeadControlValues(){
  return headControlWidgets().map(w=>({id:w.id,value:JSON.parse(JSON.stringify(w.value)),valueY:w.valueY}));
}
function saveHeadPresets(w,presets){
  w.headPresets=presets;save();refresh(w);
}
function recallHeadPreset(w,index){
  const preset=w.headPresets?.[index];if(!preset)return;
  let recalled=0;
  for(const saved of preset.values||[]){
    const control=page().widgets.find(item=>item.id===saved.id&&item.addr?.startsWith('/mh/'));
    if(!control)continue;
    control.value=JSON.parse(JSON.stringify(saved.value));
    if(Number.isFinite(saved.valueY))control.valueY=saved.valueY;
    paint(elOf(control.id),control);fire(control.addr,argsOf(control),control.oscChannel);recalled++;
  }
  if(!recalled){showError(`Preset "${preset.name}" non contiene controlli PTZ presenti in questa pagina.`);return}
  save();closeSheet();
}
function renderHeadPresetEditor(w,presets){
  const s=$('#scrim');s.hidden=false;
  const rows=presets.map((p,i)=>`<div class="preset-edit-row" data-preset-row="${i}">
    <input data-preset-name="${i}" value="${esc(p.name)}" aria-label="Nome preset ${i+1}">
    <div class="row">
      <button class="btn sm" data-preset-action="recall" data-preset-index="${i}">Richiama</button>
      <button class="btn sm" data-preset-action="update" data-preset-index="${i}">Aggiorna</button>
      <button class="btn sm" data-preset-action="up" data-preset-index="${i}" aria-label="Sposta preset su"${i===0?' disabled':''}>↑</button>
      <button class="btn sm" data-preset-action="down" data-preset-index="${i}" aria-label="Sposta preset giù"${i===presets.length-1?' disabled':''}>↓</button>
      <button class="btn sm danger" data-preset-action="delete" data-preset-index="${i}" aria-label="Elimina preset">×</button>
    </div>
  </div>`).join('');
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Preset teste mobili">
    <div class="top"><h3>Preset PTZ · ${esc(w.label)}</h3><button class="btn ghost" id="presetClose">Chiudi</button></div>
    <p class="hint">I preset salvati qui sono snapshot dei controlli PTZ di questa pagina, condivisi nel layout OPS. Il richiamo invia gli stessi controlli OSC alle teste attualmente selezionate; non salva un preset interno a TD.</p>
    <div class="preset-edit-list">${rows||'<p class="hint">Nessun preset salvato.</p>'}</div>
    <div class="row"><label style="flex:1">Nuovo preset<input id="presetNewName" placeholder="Es. Controluce alto"></label><button class="btn primary" id="presetAdd" style="align-self:flex-end">Salva preset corrente</button></div>
    <div class="cue-editor-actions"><button class="btn ghost" id="presetDone">Fine</button></div>
  </div>`;
  const capture=()=>captureHeadControlValues();
  s.querySelector('#presetClose').onclick=s.querySelector('#presetDone').onclick=closeSheet;
  s.querySelector('#presetAdd').onclick=()=>{
    const name=s.querySelector('#presetNewName').value.trim(),values=capture();
    if(!name){showError('Inserisci un nome per il preset PTZ.');return}
    if(presets.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase())){showError(`Esiste già un preset chiamato "${name}".`);return}
    if(!values.length){showError('Questa pagina non contiene controlli PTZ da salvare.');return}
    presets.push({name,values});saveHeadPresets(w,presets);renderHeadPresetEditor(w,presets);
  };
  s.querySelectorAll('[data-preset-name]').forEach(input=>input.onchange=()=>{
    const i=+input.dataset.presetName,name=input.value.trim();
    if(!name||presets.some((p,k)=>k!==i&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase())){
      showError('Il nome del preset deve essere presente e univoco.');input.value=presets[i].name;return;
    }
    presets[i].name=name;saveHeadPresets(w,presets);
  });
  s.querySelectorAll('[data-preset-action]').forEach(button=>button.onclick=()=>{
    const i=+button.dataset.presetIndex,action=button.dataset.presetAction;
    if(action==='recall'){w.headPresets=presets;recallHeadPreset(w,i);return}
    if(action==='update'){
      const values=capture();if(!values.length){showError('Questa pagina non contiene controlli PTZ da salvare.');return}
      presets[i].values=values;
    }else if(action==='delete')presets.splice(i,1);
    else if(action==='up'&&i>0)[presets[i-1],presets[i]]=[presets[i],presets[i-1]];
    else if(action==='down'&&i<presets.length-1)[presets[i+1],presets[i]]=[presets[i],presets[i+1]];
    saveHeadPresets(w,presets);renderHeadPresetEditor(w,presets);
  });
}
function openHeadPresetEditor(w){
  renderHeadPresetEditor(w,JSON.parse(JSON.stringify(w.headPresets||[])));
}
const cueAt=(cues,t)=>{let i=-1;cues.forEach((c,k)=>{if(c.t<=t+1e-6)i=k});return i};
function setDmxParam(device,param,raw){
  const meta=devParams(device).find(p=>p.n===param);
  if(!meta){showError(`DMX V8: parametro "${param}" non pubblicato dal device ${device||'selezionato'}.`);return false}
  const status=G.devices[device],seen=status?._seen??status?.ts;
  if(!status||!Number.isFinite(seen)||Date.now()-seen>1800000){showError(`DMX V8: device ${device} offline o senza status recente; comando non inviato.`);return false}
  let value;
  if(meta.options){
    const option=meta.options.find(o=>String(o)===raw);
    if(option===undefined){showError(`DMX V8: valore "${raw}" non disponibile per ${param}.`);return false}
    value=option;
  }else{
    if(!Number.isFinite(meta.min)||!Number.isFinite(meta.max)||meta.min>meta.max){showError(`DMX V8: range non valido per ${param}.`);return false}
    if(raw===''){showError(`DMX V8: valore mancante per ${param}.`);return false}
    value=Number(raw);
    if(!Number.isFinite(value)||value<meta.min||value>meta.max){showError(`DMX V8: valore non valido per ${param} (${meta.min}–${meta.max}).`);return false}
  }
  if(!devCmd(device,{action:'set',param,value})){showError('DMX V8 non collegato: comando non inviato.');return false}
  return true;
}
function fireCue(w,i){
  const c=parseCues(w)[i];if(!c)return;
  if(c.invalid.length)showError(`Cue "${c.name}": destinazione non riconosciuta (${c.invalid.join(', ')}).`);
  fire(w.addr+'/cue',[i+1],w.oscChannel);
  const idx=cueSceneIndex(c);
  if(idx!=null)fire('/dmx/scene',[idx],w.oscChannel);
  else if(c.sceneId!=null)showError(`Cue "${c.name}": la scena "${c.sceneId}" non esiste in DMX Master.`);
  if(c.params.length){
    c.params.forEach(p=>{
      const device=w.dmxDevice||devIds('dmx').find(id=>devParams(id).some(meta=>meta.n===p.param));
      if(!device){showError(`Timeline: nessun device DMX V8 pubblica il parametro "${p.param}".`);return}
      setDmxParam(device,p.param,p.value);
    });
  }
}
const SHOW_CLOCK_STATE='gaia/show/clock/state',SHOW_CLOCK_COMMAND='gaia/show/clock/command';
const showClock={id:`plancia-${Math.random().toString(36).slice(2)}`,state:null,receivedAt:0,
  osc:null,authority:false,hasMqtt:false,minRtt:null,rtts:[],pings:new Map(),pingSeq:0};
onMqtt(SHOW_CLOCK_STATE,(p,seg,obj)=>{
  if(obj&&p.v===1&&p.master==='td-dmx-win'&&Number.isFinite(+p.pos)&&typeof p.playing==='boolean'){
    const oldLength=showClock.state?.length;
    showClock.state={...p,pos:+p.pos,playing:p.playing};showClock.receivedAt=now();showClock.authority=true;showClock.hasMqtt=true;
    if(oldLength!==p.length)refreshShowTimelines();
  }
});
// risposta ai nostri ping: misura del ritardo verso il broker
onMqtt('gaia/show/clock/pong/+',(p,seg,obj)=>{
  if(obj&&p.from===showClock.id){
    const sent=showClock.pings.get(+p.n);
    if(sent&&p.t0===sent.t0){const rtt=Math.max(0,now()-sent.at);showClock.pings.delete(+p.n);
      showClock.rtts.push(rtt);if(showClock.rtts.length>10)showClock.rtts.shift();
      showClock.minRtt=Math.min(...showClock.rtts)}
  }
});
const showClockAge=sample=>sample?Math.max(0,now()-sample.receivedAt):Infinity;
const showClockFresh=sample=>!!sample&&((sample.source==='osc'&&!sample.state.playing&&!showClock.hasMqtt)||showClockAge(sample)<=3500);
function showClockSample(){
  const candidates=[];
  if(showClock.state)candidates.push({source:'mqtt',state:showClock.state,receivedAt:showClock.receivedAt});
  if(showClock.osc)candidates.push({source:'osc',state:showClock.osc,receivedAt:showClock.osc.receivedAt});
  const fresh=candidates.find(showClockFresh);
  if(fresh)return fresh;
  return candidates.sort((a,b)=>b.receivedAt-a.receivedAt)[0]||null;
}
function showClockPosition(sample=showClockSample()){
  if(!sample)return null;
  const s=sample.state,elapsed=Math.min(showClockAge(sample),3500);
  const compensation=sample.source==='mqtt'?(showClock.minRtt||0)/2:0;
  const rate=Number.isFinite(+s.rate)?+s.rate:1;
  return clamp((+s.pos||0)+(s.playing?(elapsed+compensation)/1000*rate:0),0,
    Number.isFinite(+s.length)&&+s.length>0?+s.length:Infinity);
}
function showClockCues(){
  const raw=G.devices['td-dmx-win']?.params?.show_cues;
  const list=Array.isArray(raw)?raw:Array.isArray(raw?.cues)?raw.cues:null;
  if(!list)return null;
  return list.map((item,i)=>{
    const c=typeof item==='string'?{}:item||{};
    const match=typeof item==='string'?item.match(/^\s*(\d+:\d{1,2}(?:\.\d+)?)\s+(.+)$/):null;
    const position=c.t??c.pos??c.position??c.seconds??c.time_s??c.time??match?.[1];
    const t=typeof position==='string'?parseCueTime(position):+position;
    const name=c.label||c.name||match?.[2]||c.scene||`Cue ${i+1}`;
    return Number.isFinite(t)?{t,name:String(name),sceneId:c.scene||null,index:Number.isFinite(+c.index)&&+c.index>0?+c.index:i+1,scene:null,params:[],invalid:[]}:null;
  }).filter(Boolean);
}
function showClockCommand(w,action,value){
  const sample=showClockSample();
  if(!sample||!showClockFresh(sample)){showError('Orologio TD non raggiungibile: comando non inviato.');return false}
  if(sample.source==='mqtt'){
    if(!G.ok){showError('Broker Gaia non collegato: comando clock non inviato.');return false}
    const command={action};if(value!==undefined)command.value=value;
    return gPub(SHOW_CLOCK_COMMAND,command);
  }
  const osc=(address,args)=>emit({type:'osc',address,args,channel:w.oscChannel||'default'});
  if(action==='play'||action==='pause')osc('/show/play',[action==='play'?1:0]);
  else if(action==='toggle')osc('/show/play',[sample.state.playing?0:1]);
  else if(action==='stop'){osc('/show/play',[0]);osc('/show/time',[0])}
  else if(action==='seek')osc('/show/time',[+value]);
  else if(action==='go')osc('/show/go',[1]);
  else if(action==='back')osc('/show/back',[1]);
  else if(action==='cue')osc('/show/cue',[+value]);
  else{showError(`Comando clock "${action}" non supportato.`);return false}
  return true;
}
function showClockRemoteOSC(address,args){
  const sample=showClock.osc||(showClock.osc={pos:0,playing:false,receivedAt:now()});
  if(address==='/show/time'&&Number.isFinite(+args[0]))sample.pos=Math.max(0,+args[0]);
  else if(address==='/show/play')sample.playing=+args[0]>.5;
  else if(address==='/show/cue')sample.cue=+args[0];
  else return;
  sample.receivedAt=now();showClock.authority=true;
}
function isShowTimeline(w){return w.addr==='/show'}
function timelineDuration(w){
  const sample=isShowTimeline(w)&&showClock.authority?showClockSample():null;
  return sample&&Number.isFinite(+sample.state.length)&&+sample.state.length>0?+sample.state.length:(w.duration||1);
}
function timelineCues(w){
  if(isShowTimeline(w)&&showClock.authority)return showClockCues()||[];
  return parseCues(w);
}
// Pulsanti /dmx/scene: nomi dal catalogo di DMX Master quando c'e'
function refreshTdSceneWidgets(){
  for(const w of page().widgets)if(w.type==='scenes'&&w.addr==='/dmx/scene'&&(!w.mode||w.mode==='push'))refresh(w);
}
function refreshShowTimelines(){
  for(const w of page().widgets)if(w.type==='timeline'&&isShowTimeline(w))refresh(w);
}
function seek(w,t,quietCue){if(isShowTimeline(w)&&showClock.authority){showClockCommand(w,'seek',clamp(t,0,timelineDuration(w)));return}
  const r=rt(w),cues=parseCues(w);r.t=clamp(t,0,w.duration);const i=cueAt(cues,r.t);
  if(i!==r.cue){r.cue=i;if(!quietCue&&i>=0)fireCue(w,i)} fire(w.addr+'/time',[+r.t.toFixed(2)],w.oscChannel)}
// Live/Timeline = servizio show_active di DMX Master (nota TD 40): spento,
// la timeline non scrive le luci e si compone dal tablet; riacceso, TD
// riapplica subito (senza fade) tutto lo stato a strati del tempo corrente.
function tdShowActive(){
  const st=G.devices['td-dmx-win']?.services?.show_active;
  if(st==='active'||st==='inactive')return st==='active';
  const a=showClock.state?.active;return typeof a==='boolean'?a:null;
}
function toggleShowActive(){
  const on=tdShowActive();
  if(on===null){showError('Stato della timeline di DMX Master non disponibile (Gaia collegata?).');return}
  if(!on&&!confirm('Tornare alla TIMELINE?\nDMX Master riapplica subito, senza fade, la scena del tempo corrente: il look composto qui viene sostituito.'))return;
  if(!devCmd('td-dmx-win',{action:on?'disable':'enable',service:'show_active'})){showError('Non collegata a Gaia: apri ⋯ → Gaia.');return}
  showInfo(on?'LIVE: la timeline non comanda più le luci. Componi e cattura le scene.':'TIMELINE: le luci seguono di nuovo la timeline.');
}
function tlAct(w,act){if(act==='live'){toggleShowActive();return}if(act==='vlive'){toggleVideoActive();return}if(act==='vcue'){openVideoCueEditor(w);return}if(act==='llive'){toggleLaserActive();return}if(act==='lcue'){openLaserCueEditor(w);return}const r=rt(w),cues=parseCues(w);
  if(isShowTimeline(w)&&showClock.authority){
    const sample=showClockSample();
    if(act==='edit-cues'){openCueEditor(w);return}
    if(act==='loop'){showError('Il clock TD non espone ancora un comando loop.');return}
    if(act==='play')showClockCommand(w,sample?.state.playing?'pause':'play');
    else if(act==='stop')showClockCommand(w,'stop');
    else if(act==='start')showClockCommand(w,'seek',0);
    else if(act==='go'||act==='back')showClockCommand(w,act);
    return;
  }
  if(act==='play'){r.playing=!r.playing;r.last=now();fire(w.addr+'/play',[r.playing?1:0],w.oscChannel);if(r.playing&&r.cue<0&&cues[0]&&cues[0].t<=r.t){r.cue=0;fireCue(w,0)}}
  else if(act==='stop'){r.playing=false;r.t=0;r.cue=-1;fire(w.addr+'/play',[0],w.oscChannel);fire(w.addr+'/time',[0],w.oscChannel)}
  else if(act==='start'){seek(w,0)}
  else if(act==='loop'){r.loop=!r.loop}
  else if(act==='go'){const i=Math.min(cues.length-1,r.cue+1);if(i>=0){r.t=cues[i].t;r.cue=i;fireCue(w,i)}}
  else if(act==='back'){const i=Math.max(0,r.cue-1);if(cues[i]){r.t=cues[i].t;r.cue=i;fireCue(w,i)}}
}
function timelineBus(a,args,src){
  if(src==='remote'&&a.startsWith('/show/'))showClockRemoteOSC(a,args);
  const seen=new Set();
  for(const w of allW()){if(w.type!=='timeline'||seen.has(w.addr)||!a.startsWith(w.addr+'/'))continue;seen.add(w.addr);
    const s=a.slice(w.addr.length+1),v=+args[0];
    if((s==='go'||s==='back')&&v>.5&&!(src==='remote'&&isShowTimeline(w)))tlAct(w,s);
    else if(src==='remote'&&s==='play'){const r=rt(w);r.playing=v>.5;r.last=now()}
    else if(src==='remote'&&s==='time'){rt(w).t=clamp(v,0,w.duration)}
  }
}
let showT=0, showPlaying=false, showBpm=120;
