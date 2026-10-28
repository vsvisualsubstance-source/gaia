/* ---------- Laser: LaserCube WiFi tramite il laser gateway di OPS ---------- */
// Il gateway (ops/laser, device family "laser") e' l'unico mittente verso i
// cubi e fa la sicurezza: zona, tetto di intensita', blanking, buio se la
// sorgente si ferma, disarmo se cade il broker. Qui: modalita' per cubo
// (sorgente), ARM con conferma, BLACKOUT, master, zona e allineamento, stato.
// Il contenuto dello Show lo genera TD DMX: i suoi parametri laser_* (nota
// OPS 33) compaiono da soli nella sezione Contenuto.
const LZ_MODES=[['off','Spento'],['test','Test'],['dmx','Show'],['patchdeck','PatchDeck'],['yolo','Yolo']];
const LZ_MODE_HINT={
  off:'Nessuna sorgente: il cubo non si può armare.',
  test:'Cerchio di prova generato dal gateway: per puntare e controllare la zona.',
  dmx:'Contenuto da TD DMX guidato dalla Plancia (timeline, palette, effetti); audio dal controller.',
  patchdeck:'Contorni dell\'uscita video di PatchDeck; audio dal controller.',
  yolo:'Grafica proiettata su una superficie, guidata dalle posizioni di Yolo. Mai il fascio sulle persone.',
};
const LZ_PENDING=new Map(); // req del comando -> etichetta, per mostrare l'esito del gateway
function lzDevId(){const e=Object.entries(G.devices||{}).find(([,d])=>d?.family==='laser'&&!d.offline);return e?e[0]:'laser-ops'}
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
// parametri di contenuto pubblicati da TD DMX (laser_*), con range dalla matrice se c'e'
function lzContentParams(){
  const p=tdParams(),spec=G.dxm?.[TD_DEV]?.params||{};
  return Object.keys(p).filter(k=>/^laser_/.test(k)&&typeof p[k]!=='object').sort().map(k=>({k,v:p[k],s:spec[k]||{}}));
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
  const content=c.mode==='dmx'?lzContentParams():[];
  return`<div class="lz-card${c.armed?' armed':''}${c.streaming?' live':''}${c.online?'':' off'}">
    <div class="ar-head"><span class="lz-dot" title="${c.online?'online':'offline'}"></span><b>${esc(c.name||c.id)}</b><span class="lz-id">${esc(c.id)} · ${esc(c.ip||'')}</span></div>
    <p class="hint">${c.online?`${esc(c.model||'LaserCube')} fw ${esc(c.fw||'?')} · ${c.charging?'in carica':c.battery!=null?`batteria ${c.battery}%`:''} · ${c.temp_c??'?'} °C`:'Il gateway non riceve risposta: rete, alimentazione, modalità LAN Client.'}${warn.length?` · <b class="lz-warn">${warn.join(' · ')}</b>`:''}</p>
    <div class="lz-modes">${LZ_MODES.map(([m,l])=>`<button class="${c.mode===m?'on':''}" data-lz="mode" data-lz-v="${m}" data-lz-c="${c.id}">${l}</button>`).join('')}</div>
    <p class="hint">${esc(LZ_MODE_HINT[c.mode]||'')}${c.mode!=='off'&&c.mode!=='test'?lzSourceHint(d,c.mode):''}</p>
    <button class="lz-arm${c.armed?' on':''}" data-lz="${c.armed?'disarm':'arm'}" data-lz-c="${c.id}"${c.mode==='off'||!c.online?' disabled':''}>${c.armed?'DISARMA':'ARMA'}<i>${live}</i></button>
    ${lzSlider(c.id,'master','Master',c.master??1)}
    ${lzSlider(c.id,'max_intensity','Intensità massima',c.max_intensity??.5)}
    ${content.length?`<details class="ar-cal lz-sec" data-sec="content"><summary>Contenuto (TD DMX)</summary>${content.map(x=>lzContentHtml(x)).join('')}</details>`:c.mode==='dmx'?'<p class="hint">TD DMX non pubblica ancora parametri laser_* (nota OPS 33).</p>':''}
    <details class="ar-cal lz-sec" data-sec="zone"><summary>Zona di sicurezza</summary>${lzZoneHtml(c)}</details>
    <details class="ar-cal lz-sec" data-sec="align"><summary>Allineamento e cubo</summary>
      ${lzSlider(c.id,'scale','Dimensione',c.scale??1,.05,1)}${lzSlider(c.id,'offset_x','Sposta X',c.offset_x??0,-1,1)}${lzSlider(c.id,'offset_y','Sposta Y',c.offset_y??0,-1,1)}
      <div class="ar-togs"><button class="ar-tog${c.flip_x?' on':''}" data-lz="flip_x" data-lz-c="${c.id}">Specchia X<i>${c.flip_x?'ON':'OFF'}</i></button><button class="ar-tog${c.flip_y?' on':''}" data-lz="flip_y" data-lz-c="${c.id}">Capovolgi Y<i>${c.flip_y?'ON':'OFF'}</i></button></div>
      ${lzSlider(c.id,'pps','Punti al secondo',c.pps??30000,6000,35000,1000)}
      <div class="lz-row"><button class="btn sm ghost" data-lz="rename" data-lz-c="${c.id}">Rinomina</button><button class="btn sm ghost" data-lz="ip" data-lz-c="${c.id}">Cambia IP</button><button class="btn sm ghost" data-lz="remove" data-lz-c="${c.id}">Togli</button></div></details>
  </div>`;
}
function lzContentHtml({k,v,s}){
  const label=esc(k.replace(/^laser_/,'').replace(/_/g,' '));
  if(Array.isArray(s.options))return`<label class="ar-sl"><span>${label}</span><select data-lz-td="${esc(k)}">${s.options.map(o=>`<option${String(o)===String(v)?' selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
  if(typeof v==='boolean'||s.type==='bool')return`<button class="ar-tog${v?' on':''}" data-lz="tdtoggle" data-lz-v="${esc(k)}">${label}<i>${v?'ON':'OFF'}</i></button>`;
  const [min,max]=Array.isArray(s.range)?s.range:[0,1],step=(max-min)>10?1:.01;
  return`<label class="ar-sl"><span>${label}<b>${(+v).toFixed(step<1?2:0)}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${+v}" data-lz-td="${esc(k)}"></label>`;
}
function lzSourceHint(d,mode){
  const s=d.laser.sources?.[mode];
  return s&&s.age_ms<1500?` <b class="lz-ok">Sorgente attiva · ${s.points} punti</b>`:' <b class="lz-warn">Nessun frame dalla sorgente.</b>';
}
function paintLaser(el,w,force){
  const box=el.querySelector('.lz');if(!box)return;
  const d=lzDev();lzResults(d);
  if(box.contains(document.activeElement)&&['range','select-one'].includes(document.activeElement.type)&&!force)return; // non ridisegnare mentre trascini
  const compact=w.h<=3,content=lzContentParams();
  const sig=JSON.stringify([compact,d&&{c:d.laser.cubes,s:Object.entries(d.laser.sources||{}).map(([k,v])=>[k,v.age_ms<1500,v.points]),f:d.laser.found},content]);
  if(!force&&box._sig===sig)return;box._sig=sig;
  if(!d){box.innerHTML='<p class="hint">Laser gateway non collegato: in Admin accendi il servizio "laser" di OPS.</p>';return}
  const cubes=d.laser.cubes||[],armed=cubes.some(c=>c.armed);
  const bo=`<button class="lz-bo${armed?' hot':''}" data-lz="blackout" title="Disarma subito tutti i cubi">BLACKOUT LASER</button>`;
  if(compact){box.innerHTML=`<div class="ar-mini">${bo}${cubes.map(c=>`<div class="ar-mrow lz-mrow${c.online?'':' off'}"><b><span class="lz-dot"></span>${esc(c.name||c.id)} · ${esc((LZ_MODES.find(m=>m[0]===c.mode)||[])[1]||c.mode)}</b>
    <button class="ar-tog${c.armed?' on':''}" data-lz="${c.armed?'disarm':'arm'}" data-lz-c="${c.id}"${c.mode==='off'||!c.online?' disabled':''}>${c.armed?'Armato':'Arma'}<i>${c.streaming?'ON':'—'}</i></button></div>`).join('')||'<p class="hint">Nessun cubo: aggiungili nella pagina Laser.</p>'}</div>`;return}
  const found=(d.laser.found||[]).filter(f=>!f.cube);
  box.innerHTML=`<div class="lz-top">${bo}<span class="hint">Classe 4: beam block regolato, chiave ed E-Stop a portata di mano, nessuno nel fascio.</span>
      <button class="btn sm ghost" data-lz="scan">Cerca cubi</button><button class="btn sm ghost" data-lz="add">+ Cubo</button></div>
    ${found.length?`<div class="lz-found">${found.map(f=>`<button class="pal-chip" data-lz="addip" data-lz-v="${esc(f.ip)}">+ ${esc(f.ip)}${f.mac?` · ${esc(f.mac)}`:''}</button>`).join('')}</div>`:''}
    <div class="ar-cards lz-cards">${cubes.map(c=>lzCardHtml(c,d)).join('')||'<p class="hint">Nessun cubo configurato: collega i cubi via cavo in LAN Client (LED verde), poi "Cerca cubi" o "+ Cubo" con l\'IP.</p>'}</div>`;
  box.querySelectorAll('details.lz-sec').forEach(x=>{const k=x.closest('.lz-card')&&x.dataset.sec+':'+(x.querySelector('[data-lz-c]')?.dataset.lzC||'');
    x.open=!!paintLaser._open?.[k];x.ontoggle=()=>{(paintLaser._open=paintLaser._open||{})[k]=x.open}});
}
function laserDown(e,el,w){
  if(e.target.closest('input[type=range],select,summary'))return;
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
  else if(a==='tdtoggle')setDmxParam(TD_DEV,v,String(!tdParams()[v]));
  setTimeout(()=>paintLaser(el,w,true),400);
}
// cursori e menu: invio al rilascio (change), non a ogni pixel
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset?.lzTd){setDmxParam(TD_DEV,t.dataset.lzTd,String(t.value));t.blur();return}
  if(t.dataset?.lzZ!=null){const card=t.closest('.lz-card'),z=[0,1,2,3].map(i=>+card.querySelector(`[data-lz-z="${i}"]`).value);
    if(z[0]>=z[2]||z[1]>=z[3]){showError('Laser: la zona deve avere sinistra < destra e basso < alto.');return}
    lzSet(t.dataset.lzC,'zone',z);t.blur();return}
  if(t.dataset?.lzP){lzSet(t.dataset.lzC,t.dataset.lzP,+t.value);t.blur()}});
document.addEventListener('input',e=>{const t=e.target;if(!t.dataset||(t.dataset.lzP==null&&t.dataset.lzZ==null&&t.dataset.lzTd==null)||t.type!=='range')return;
  const b=t.parentElement.querySelector('b');if(b)b.textContent=(+t.value).toFixed(+t.step<1?2:0)});
