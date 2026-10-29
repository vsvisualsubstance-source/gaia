/* ---------- Laser: LaserCube WiFi tramite il laser gateway di OPS ---------- */
// Il gateway (ops/laser, device family "laser") e' l'unico mittente verso i
// cubi e fa la sicurezza: zona, tetto di intensita', blanking, buio se la
// sorgente si ferma, disarmo se cade il broker. Qui: modalita' per cubo
// (sorgente), ARM con conferma, BLACKOUT, master, zona e allineamento, stato.
// Il contenuto dello Show lo genera TD DMX: i suoi parametri laser_* (nota
// OPS 33) compaiono da soli nella sezione Contenuto.
// niente sorgente DMX (nota TD 51): lo show passa dalle Scene del gateway
const LZ_MODES=[['off','Spento'],['test','Test'],['scene','Scene'],['patchdeck','PatchDeck'],['yolo','Yolo']];
const LZ_MODE_HINT={
  off:'Nessuna sorgente: il cubo non si può armare.',
  test:'Cerchio di prova generato dal gateway: per puntare e controllare la zona.',
  scene:'Scena interna del gateway (template o SVG), senza sorgenti esterne: scegli la scena qui sopra o dalla timeline LASER.',
  patchdeck:'Contorni dell\'uscita video di PatchDeck; audio dal controller.',
  yolo:'Grafica proiettata su una superficie, guidata dalle posizioni di Yolo. Mai il fascio sulle persone.',
};
const LZ_PENDING=new Map(); // req del comando -> etichetta, per mostrare l'esito del gateway
// piu' gateway visibili (es. OPS e touring): vince quello con cubi che rispondono,
// poi quello con cubi configurati, poi il piu' recente
function lzDevId(){
  const score=d=>{const c=d.laser?.cubes||[];return(c.some(x=>x.online)?2:0)+(c.length?1:0)};
  const e=Object.entries(G.devices||{}).filter(([,d])=>d?.family==='laser'&&!d.offline)
    .sort(([,a],[,b])=>(score(b)-score(a))||((b._seen||0)-(a._seen||0)))[0];
  return e?e[0]:'laser-ops';
}
const lzDev=()=>{const d=G.devices?.[lzDevId()];return d&&!d.offline&&d.laser?d:null};
const lzCube=cid=>lzDev()?.laser.cubes.find(c=>c.id===cid);
function lzCmd(o,label){
  const req=Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  LZ_PENDING.set(req,label||o.action);setTimeout(()=>LZ_PENDING.delete(req),8000);
  if(!devCmd(lzDevId(),{...o,req}))showError('Laser: non collegato al broker di Gaia.');
}
const lzSet=(cid,key,value)=>lzCmd({action:'set',param:`${cid}_${key}`,value},key);
function lzResults(d){
  const r=d?.laser?.last_result;if(!r||!LZ_PENDING.has(r.req))return;
  LZ_PENDING.delete(r.req);
  if(!r.ok)showError('Laser: '+r.msg);else if(['arm','add_cube','remove_cube'].includes(r.action))showInfo('Laser: '+r.msg);
}
// Contenuto di ogni sorgente: i parametri laser_* del suo device TD (nota OPS 33),
// con tipo/range/opzioni dalla matrice (PatchDeck: patchdeck_matrix.laser_params,
// nota TD 49). Un solo set per sorgente, condiviso dai cubi in
// quella modalita' (PatchDeck sceglie il cubo con laser_target).
const LZ_SRC_LABEL={patchdeck:'PatchDeck',yolo:'TD Yolo'};
function lzSourceDev(mode){
  const hasLaser=id=>Object.keys(G.devices?.[id]?.params||{}).some(k=>/^laser_/.test(k));
  if(mode==='patchdeck')return Object.keys(G.pdm||{}).find(id=>G.pdm[id]?.laser_params)||Object.keys(G.pdm||{})[0]||'td-pd-pc-win';
  if(mode==='yolo')return Object.keys(G.devices||{}).find(id=>/yolo/i.test(id)&&hasLaser(id))||null;
  return null;
}
function lzContentParams(mode){
  const dev=lzSourceDev(mode);if(!dev)return{dev,list:[]};
  const p=G.devices?.[dev]?.params||{},spec=G.pdm?.[dev]?.laser_params||G.dxm?.[dev]?.laser_params||G.dxm?.[dev]?.params||{};
  // ordine della matrice (TD lo da' gia' logico), poi i parametri senza matrice
  const keys=Object.keys(spec),order=k=>{const i=keys.indexOf(k);return i<0?1e3:i};
  const list=Object.keys(p).filter(k=>/^laser_/.test(k)).sort((a,b)=>order(a)-order(b)||a.localeCompare(b)).map(k=>({dev,k,v:p[k],s:spec[k]||{}}));
  return{dev,list};
}
function lzTdSet(dev,k,value){
  if(!devCmd(dev,{action:'set',param:k,value}))showError('Laser: non collegato al broker di Gaia.');
}
function lzSlider(cid,key,label,v,min=0,max=1,step=.01){
  return`<label class="ar-sl"><span>${label}<b>${(+v).toFixed(step<1?2:0)}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-lz-p="${key}" data-lz-c="${cid}"></label>`;
}
function lzZoneHtml(c){
  const [x0,y0,x1,y1]=c.zone||[-1,-1,1,1],L_=(x0+1)/2*100,W_=(x1-x0)/2*100,T_=(1-y1)/2*100,H_=(y1-y0)/2*100;
  const zs=(i,label,v)=>`<label class="ar-sl"><span>${label}<b>${(+v).toFixed(2)}</b></span><input type="range" min="-1" max="1" step=".01" value="${v}" data-lz-z="${i}" data-lz-c="${c.id}"></label>`;
  return`<div class="lz-zone"><div class="lz-zbox" title="Area di proiezione del cubo; in verde la zona dove il fascio può andare"><i style="left:${L_}%;top:${T_}%;width:${W_}%;height:${H_}%"></i></div>
    <div class="lz-zs">${zs(0,'Sinistra',x0)}${zs(2,'Destra',x1)}${zs(1,'Basso',y0)}${zs(3,'Alto',y1)}</div></div>
    <button class="btn sm ghost" data-lz="zonereset" data-lz-c="${c.id}">Zona intera</button>`;
}
function lzCardHtml(c,d){
  const warn=[!c.online&&'NON RISPONDE',c.online&&c.interlock===false&&'interlock aperto',c.temp_warn&&'temperatura alta',c.temp_fault&&'SURRISCALDATO'].filter(Boolean);
  const live=c.streaming?'IN USCITA':c.armed?(c.mode==='off'?'armato':'armato · in attesa della sorgente'):'disarmato';
  const content=['patchdeck','yolo'].includes(c.mode)?lzContentParams(c.mode):{list:[]},srcName=LZ_SRC_LABEL[c.mode]||'';
  return`<div class="lz-card${c.armed?' armed':''}${c.streaming?' live':''}${c.online?'':' off'}">
    <div class="ar-head"><span class="lz-dot" title="${c.online?'online':'offline'}"></span><b>${esc(c.name||c.id)}</b><span class="lz-id">${esc(c.id)} · ${esc(c.ip||'')}</span></div>
    <p class="hint">${c.online?`${esc(c.model||'LaserCube')} fw ${esc(c.fw||'?')} · ${c.charging?'in carica':c.battery!=null?`batteria ${c.battery}%`:''} · ${c.temp_c??'?'} °C`:'Il gateway non riceve risposta: rete, alimentazione, modalità LAN Client.'}${warn.length?` · <b class="lz-warn">${warn.join(' · ')}</b>`:''}</p>
    <div class="lz-modes">${LZ_MODES.map(([m,l])=>`<button class="${c.mode===m?'on':''}" data-lz="mode" data-lz-v="${m}" data-lz-c="${c.id}">${l}</button>`).join('')}</div>
    <p class="hint">${esc(LZ_MODE_HINT[c.mode]||'')}${c.mode==='scene'?(c.scene?` <b class="lz-ok">Scena: ${esc(c.scene.name)}</b>`:' <b class="lz-warn">Nessuna scena scelta.</b>'):c.mode!=='off'&&c.mode!=='test'?lzSourceHint(d,c.mode):''}</p>
    <button class="lz-arm${c.armed?' on':''}" data-lz="${c.armed?'disarm':'arm'}" data-lz-c="${c.id}"${c.mode==='off'||!c.online?' disabled':''}>${c.armed?'DISARMA':'ARMA'}<i>${live}</i></button>
    ${lzSlider(c.id,'master','Master',c.master??1)}
    ${lzSlider(c.id,'max_intensity','Intensità massima',c.max_intensity??.5)}
    ${content.list.length?`<details class="ar-cal lz-sec" data-sec="content-${c.mode}"><summary>Contenuto (${srcName})</summary>${content.list.map(x=>lzContentHtml(x)).join('')}<p class="hint">Un solo set per ${srcName}: vale per tutti i cubi in questa modalità.</p></details>`:srcName?`<p class="hint">${srcName} non pubblica ancora parametri laser_* (nota OPS 33).</p>`:''}
    <details class="ar-cal lz-sec" data-sec="zone"><summary>Zona di sicurezza</summary>${lzZoneHtml(c)}</details>
    <details class="ar-cal lz-sec" data-sec="align"><summary>Allineamento e cubo</summary>
      ${lzSlider(c.id,'scale','Dimensione',c.scale??1,.05,1)}${lzSlider(c.id,'offset_x','Sposta X',c.offset_x??0,-1,1)}${lzSlider(c.id,'offset_y','Sposta Y',c.offset_y??0,-1,1)}
      <div class="ar-togs"><button class="ar-tog${c.flip_x?' on':''}" data-lz="flip_x" data-lz-c="${c.id}">Specchia X<i>${c.flip_x?'ON':'OFF'}</i></button><button class="ar-tog${c.flip_y?' on':''}" data-lz="flip_y" data-lz-c="${c.id}">Capovolgi Y<i>${c.flip_y?'ON':'OFF'}</i></button></div>
      ${lzSlider(c.id,'pps','Punti al secondo',c.pps??30000,6000,35000,1000)}
      <div class="lz-row"><button class="btn sm ghost" data-lz="rename" data-lz-c="${c.id}">Rinomina</button><button class="btn sm ghost" data-lz="ip" data-lz-c="${c.id}">Cambia IP</button><button class="btn sm ghost" data-lz="remove" data-lz-c="${c.id}">Togli</button></div></details>
  </div>`;
}
const LZ_PARAM_IT={enabled:'Sorgente accesa',target:'Cubo',mode:'Contorni',threshold:'Soglia',min_size:'Forma minima',max_points:'Punti massimi',size:'Dimensione',color:'Colore da',palette:'Colore fisso',audio_amount:'Audio (dal controller)',points:'Punti nell’ultimo frame'};
function lzContentHtml({dev,k,v,s}){
  const short=k.replace(/^laser_/,''),label=esc(LZ_PARAM_IT[short]||s.label||short.replace(/_/g,' ')),at=`data-lz-dev="${esc(dev)}" data-lz-k="${esc(k)}"`;
  if(s.readonly)return`<p class="hint">${label}: <b>${esc(typeof v==='number'?Math.round(v):v)}</b></p>`;
  if(Array.isArray(s.options)){const lab=s.option_labels||s.options;
    return`<label class="ar-sl"><span>${label}</span><select ${at} data-lz-type="enum">${s.options.map((o,i)=>`<option value="${esc(o)}"${String(o)===String(v)?' selected':''}>${esc(lab[i]??o)}</option>`).join('')}</select></label>`}
  if(typeof v==='boolean'||s.type==='bool')return`<button class="ar-tog${v?' on':''}" data-lz="tdtoggle" ${at}>${label}<i>${v?'ON':'OFF'}</i></button>`;
  if(s.type==='rgb'||Array.isArray(v)){const hex='#'+(Array.isArray(v)?v:[1,1,1]).slice(0,3).map(x=>Math.round(Math.max(0,Math.min(1,+x||0))*255).toString(16).padStart(2,'0')).join('');
    return`<label class="ar-sl"><span>${label}</span><input type="color" value="${hex}" ${at} data-lz-type="rgb"></label>`}
  const r=Array.isArray(s.range)?s.range:[s.min??0,s.max??1],min=+r[0],max=+r[1],step=s.type==='int'||(max-min)>10?1:.01;
  return`<label class="ar-sl"><span>${label}<b>${(+v).toFixed(step<1?2:0)}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${+v}" ${at} data-lz-type="${step<1?'float':'int'}"></label>`;
}
function lzSourceHint(d,mode){
  const s=d.laser.sources?.[mode];
  return s&&s.age_ms<1500?` <b class="lz-ok">Sorgente attiva · ${s.points} punti</b>`:' <b class="lz-warn">Nessun frame dalla sorgente.</b>';
}
function paintLaser(el,w,force){
  const box=el.querySelector('.lz');if(!box)return;
  const d=lzDev();lzResults(d);
  if(box.contains(document.activeElement)&&['range','select-one','color'].includes(document.activeElement.type)&&!force)return; // non ridisegnare mentre trascini
  const compact=w.h<=3,content=['patchdeck','yolo'].map(m=>lzContentParams(m).list.map(x=>[x.k,x.v]));
  const sig=JSON.stringify([compact,lzsSig(),d&&{c:d.laser.cubes,s:Object.entries(d.laser.sources||{}).map(([k,v])=>[k,v.age_ms<1500,v.points]),f:d.laser.found},content]);
  if(!force&&box._sig===sig)return;box._sig=sig;
  if(!d){box.innerHTML='<p class="hint">Laser gateway non collegato: in Admin accendi il servizio "laser" di OPS.</p>';return}
  const cubes=d.laser.cubes||[],armed=cubes.some(c=>c.armed);
  const bo=`<button class="lz-bo${armed?' hot':''}" data-lz="blackout" title="Disarma subito tutti i cubi">BLACKOUT LASER</button>`;
  if(compact){box.innerHTML=`<div class="ar-mini">${bo}${cubes.map(c=>`<div class="ar-mrow lz-mrow${c.online?'':' off'}"><b><span class="lz-dot"></span>${esc(c.name||c.id)} · ${esc((LZ_MODES.find(m=>m[0]===c.mode)||[])[1]||c.mode)}</b>
    <button class="ar-tog${c.armed?' on':''}" data-lz="${c.armed?'disarm':'arm'}" data-lz-c="${c.id}"${c.mode==='off'||!c.online?' disabled':''}>${c.armed?'Armato':'Arma'}<i>${c.streaming?'ON':'—'}</i></button></div>`).join('')||'<p class="hint">Nessun cubo: aggiungili nella pagina Laser.</p>'}</div>`;return}
  const found=(d.laser.found||[]).filter(f=>!f.cube);
  box.innerHTML=`<div class="lz-top">${bo}<span class="hint">Classe 4: beam block regolato, chiave ed E-Stop a portata di mano, nessuno nel fascio.</span>
      <button class="btn sm ghost" data-lz="scan">Cerca cubi</button><button class="btn sm ghost" data-lz="add">+ Cubo</button></div>
    ${lzScenesHtml(d)}
    ${found.length?`<div class="lz-found">${found.map(f=>`<button class="pal-chip" data-lz="addip" data-lz-v="${esc(f.ip)}">+ ${esc(f.ip)}${f.mac?` · ${esc(f.mac)}`:''}</button>`).join('')}</div>`:''}
    <div class="ar-cards lz-cards">${cubes.map(c=>lzCardHtml(c,d)).join('')||'<p class="hint">Nessun cubo configurato: collega i cubi via cavo in LAN Client (LED verde), poi "Cerca cubi" o "+ Cubo" con l\'IP.</p>'}</div>`;
  box.querySelectorAll('details.lz-sec').forEach(x=>{const k=x.closest('.lz-card')&&x.dataset.sec+':'+(x.querySelector('[data-lz-c]')?.dataset.lzC||'');
    x.open=!!paintLaser._open?.[k];x.ontoggle=()=>{(paintLaser._open=paintLaser._open||{})[k]=x.open}});
}
function laserDown(e,el,w){
  if(e.target.closest('input[type=range],select,summary'))return;
  if(e.target.closest('[data-lzs]'))return lzsDown(e,el,w);
  const b=e.target.closest('[data-lz]');if(!b||b.disabled)return;e.preventDefault();
  const a=b.dataset.lz,cid=b.dataset.lzC,c=cid&&lzCube(cid),v=b.dataset.lzV;
  if(a==='blackout')lzCmd({action:'blackout'});
  else if(a==='arm'){if(confirm(`Armare ${c?.name||cid} (${(LZ_MODES.find(m=>m[0]===c?.mode)||[])[1]||''})?\nLaser di Classe 4: beam block e zona di sicurezza controllati, nessuno nel fascio.`))lzCmd({action:'arm',cube:cid})}
  else if(a==='disarm')lzCmd({action:'disarm',cube:cid});
  else if(a==='mode')lzSet(cid,'mode',v);
  else if(a==='flip_x'||a==='flip_y')lzSet(cid,a,!c?.[a]);
  else if(a==='zonereset')lzSet(cid,'zone',[-1,-1,1,1]);
  else if(a==='scan'){lzCmd({action:'scan'});showInfo('Laser: ricerca dei cubi sulla rete…')}
  else if(a==='add'||a==='addip'){const ip=v||prompt('IP del cubo (LAN Client, es. 192.168.1.61):');if(ip)lzCmd({action:'add_cube',ip:ip.trim()},'add_cube')}
  else if(a==='rename'){const n=prompt('Nome del cubo:',c?.name||'');if(n)lzSet(cid,'name',n)}
  else if(a==='ip'){const ip=prompt('Nuovo IP del cubo:',c?.ip||'');if(ip)lzSet(cid,'ip',ip.trim())}
  else if(a==='remove'){if(confirm(`Togliere ${c?.name||cid} dal gateway?`))lzCmd({action:'remove_cube',cube:cid})}
  else if(a==='tdtoggle'){const dev=b.dataset.lzDev,k=b.dataset.lzK;lzTdSet(dev,k,!G.devices?.[dev]?.params?.[k])}
  setTimeout(()=>paintLaser(el,w,true),400);
}
// cursori e menu: invio al rilascio (change), non a ogni pixel
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset?.lzK){const ty=t.dataset.lzType,v=t.value;
    lzTdSet(t.dataset.lzDev,t.dataset.lzK,ty==='rgb'?[1,3,5].map(i=>+(parseInt(v.slice(i,i+2),16)/255).toFixed(3)):ty==='enum'?v:ty==='int'?Math.round(+v):+v);t.blur();return}
  if(t.dataset?.lzZ!=null){const card=t.closest('.lz-card'),z=[0,1,2,3].map(i=>+card.querySelector(`[data-lz-z="${i}"]`).value);
    if(z[0]>=z[2]||z[1]>=z[3]){showError('Laser: la zona deve avere sinistra < destra e basso < alto.');return}
    lzSet(t.dataset.lzC,'zone',z);t.blur();return}
  if(t.dataset?.lzP){lzSet(t.dataset.lzC,t.dataset.lzP,+t.value);t.blur()}});
document.addEventListener('input',e=>{const t=e.target;if(!t.dataset||(t.dataset.lzP==null&&t.dataset.lzZ==null&&t.dataset.lzK==null)||t.type!=='range')return;
  const b=t.parentElement.querySelector('b');if(b)b.textContent=(+t.value).toFixed(+t.step<1?2:0)});

/* ---------- laser nel Palco: fixture collegata a un cubo reale (f.cube) ---------- */
// Dichiarazioni function, non const: il Render le chiama gia' al primo
// disegno, prima che questo modulo sia valutato.
function laserCubeState(cid){
  const d=G.devices?.[lzDevId()];
  return d&&!d.offline&&d.laser?(d.laser.cubes||[]).find(c=>c.id===cid)||null:null;
}
// laser gateway: cio' che i cubi proiettano davvero, per il Render (~6/s, solo in uscita)
onMqtt('gaia/devices/+/laser_preview',(p,seg,obj)=>{if(obj&&p.cubes)G.laserPreview={at:Date.now(),cubes:p.cubes}});
function laserPreviewPts(cid){
  const p=G.laserPreview;
  return p&&Date.now()-p.at<1200?p.cubes?.[cid]||null:null;
}
function laserStateText(c){return!c?'gateway assente':!c.online?'offline':c.streaming?'IN USCITA':c.armed?'armato':'disarmato'}
function laserStateColor(c){return!c||!c.online?'#5d6573':c.streaming?'#ff365c':c.armed?'#ffb23e':'#8a92a0'}
// raggi veri: dall'uscita del cubo ai punti accesi dell'anteprima, e la figura
// dove arriva. Orientamento e apertura della fixture dicono solo dove disegnarla.
function drawRealLaser(g,f,origin,z0,spread,base,distance,project){
  const c=laserCubeState(f.cube),pts=c?.streaming?laserPreviewPts(f.cube):null,col=laserStateColor(c);
  if(pts?.length){
    const tan=Math.tan(spread/2);
    const tg=pts.map(p=>{const a=base+p[0]/100*spread/2;
      return project(f.x+Math.sin(a)*distance,f.y+Math.cos(a)*distance,Math.max(0,z0+p[1]/100*distance*tan))});
    const lit=pts.map((p,i)=>p[2]?i:-1).filter(i=>i>=0),k=Math.max(1,Math.ceil(lit.length/40));
    g.save();g.globalCompositeOperation='lighter';g.lineWidth=1;g.globalAlpha=.3;
    lit.forEach((i,j)=>{if(j%k)return;g.strokeStyle='#'+pts[i][2];g.beginPath();g.moveTo(origin.x,origin.y);g.lineTo(tg[i].x,tg[i].y);g.stroke()});
    g.globalAlpha=.95;g.lineWidth=2;g.shadowBlur=10;
    for(let i=1;i<pts.length;i++){if(!pts[i][2])continue;
      g.strokeStyle=g.shadowColor='#'+pts[i][2];g.beginPath();g.moveTo(tg[i-1].x,tg[i-1].y);g.lineTo(tg[i].x,tg[i].y);g.stroke()}
    g.restore();
  }
  g.fillStyle=col;g.beginPath();g.arc(origin.x,origin.y,c?.armed?4:3,0,Math.PI*2);g.fill();
  if(c?.armed&&!c.streaming){g.strokeStyle=col;g.lineWidth=1;g.beginPath();g.arc(origin.x,origin.y,8,0,Math.PI*2);g.stroke()}
}
function bindLaserFixtureEditor(f){
  const sel=$('#feCube'),cubes=lzDev()?.laser.cubes||[];
  const opts=[['','— nessuno (disegno di prova) —'],...cubes.map(c=>[c.id,`${c.id} · ${c.name||''}`])];
  if(f.cube&&!cubes.some(c=>c.id===f.cube))opts.push([f.cube,`${f.cube} · (il gateway non lo vede)`]);
  sel.innerHTML=opts.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');sel.value=f.cube||'';
  $('#feCubeArm').onclick=()=>{const c=laserCubeState(f.cube);if(!c)return;
    if(c.armed)lzCmd({action:'disarm',cube:c.id});
    else if(confirm(`Armare ${c.name||c.id}?\nLaser di Classe 4: beam block e zona di sicurezza controllati, nessuno nel fascio.`))lzCmd({action:'arm',cube:c.id});
    setTimeout(()=>laserFixtureStatus(f),800)};
  $('#feCubePage').onclick=()=>{const i=L.pages.findIndex(p=>p.name==='Laser');if(i<0){showError('Nel layout non c\'è la pagina Laser.');return}
    closeSheet();pi=i;selId=null;render()};
  laserFixtureStatus(f);
}
function laserFixtureStatus(f){
  const st=$('#feCubeSt'),b=$('#feCubeArm');if(!st)return;
  const c=f.cube?laserCubeState(f.cube):null;b.hidden=!c;
  st.textContent=!f.cube?'Nessun cubo collegato: nel Render resta il disegno di prova.':!c?'Il laser gateway non vede questo cubo (gateway spento o cubo tolto).':
    `${laserStateText(c)} · sorgente ${(LZ_MODES.find(m=>m[0]===c.mode)||[])[1]||c.mode}${c.armed||c.mode==='off'?'':' · si arma qui o nella pagina Laser'}`;
  if(c){b.textContent=c.armed?'Disarma':'Arma';b.disabled=!c.armed&&(!c.online||c.mode==='off')}
}

/* ---------- tipo di widget: laser ---------- */
registerWidget('laser',{size:[8,6],label:'Laser',showsValue:false,showsAddr:false,
  inner:()=>'<div class="lz"></div>',
  onPointer:laserDown,
  tick:(el,w,{repaint})=>{if(repaint)paintLaser(el,w);animateLaserThumbs(el)},
  help:w=>['Laser',w.h<=3?'BLACKOUT LASER disarma subito tutti i cubi; Arma/Armato per cubo (chiede conferma). Il resto nella pagina Laser.':'In alto le Scene laser: tocca una scena (template o SVG importato) per mandarla ai cubi scelti, ✎ per modificarla. Sotto, una scheda per LaserCube: sorgente (Test = cerchio di prova, Scene = scene del gateway, PatchDeck = contorni del video, Yolo = grafica su superficie, mai sulle persone), ARMA con conferma, Master e Intensità massima. In "Zona di sicurezza" il rettangolo dove il fascio può andare: fuori il gateway spegne il raggio. Se la sorgente si ferma il cubo va al buio da solo. BLACKOUT LASER disarma tutto.']});
