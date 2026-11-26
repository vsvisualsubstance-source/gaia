/* ---------- pannello ⏱ Orologio: master e follower (tablet, bridge, TD quando li manderanno) ---------- */
const CH_REPORTS={};
onMqtt('gaia/show/clock/report/+',(p,seg,obj)=>{if(obj&&p.v===1&&p.id)CH_REPORTS[p.id]={...p,rx:Date.now()}});
// nome di questo tablet nel pannello (si cambia toccandolo), tenuto nel browser
function chDeviceName(){
  try{let n=localStorage.getItem('plancia.deviceName');if(!n){n=(/Android|iPad|iPhone|Mobile/i.test(navigator.userAgent)?'Tablet ':'PC ')+Math.random().toString(36).slice(2,6);localStorage.setItem('plancia.deviceName',n)}return n}
  catch{return'Plancia'}
}
function chLive(){return Object.values(CH_REPORTS).filter(r=>Date.now()-r.rx<7000)}
function chWorst(){const g=chLive().map(chGrade);return!g.length?null:g.includes('bad')?'bad':g.includes('warn')?'warn':'ok'}
function chPaintPill(){
  const p=$('#clockPill');if(!p)return;
  const s=showClock.state,w=chWorst(),age=s?now()-showClock.receivedAt:Infinity;
  p.classList.toggle('on',age<3500&&w!=='bad');p.classList.toggle('warn',w==='warn');
  const t=!s?'Orologio: nessun master':`Orologio: ${s.master}${+s.prio>1?' (motore audio)':''} · ${chLive().length} follower`;
  p.title=t;$('#clockPillTxt').textContent=age<3500?'⏱ '+(w==='warn'?'Orologio ~':w==='bad'?'Orologio ✗':'Orologio'):'⏱ fermo';
}
setInterval(chPaintPill,1000);
function openClockHealth(){
  const s=$('#scrim');s.hidden=false;
  const ms=v=>v==null?'—':`${Math.round(v)} ms`;
  const paint=()=>{
    if(!document.querySelector('.ch-sheet'))return;
    const st=showClock.state,age=st?Math.round(now()-showClock.receivedAt):null,rs=chLive().sort((a,b)=>(a.kind||'').localeCompare(b.kind||'')||String(a.name).localeCompare(b.name));
    const tag={ok:'<b class="ch-ok">●</b>',warn:'<b class="ch-warn">●</b>',bad:'<b class="ch-bad">●</b>'};
    s.querySelector('.ch-body').innerHTML=`
      <p><b>Master:</b> ${st?`${esc(st.master)} · prio ${esc(st.prio??1)}${+st.prio>1?' (motore audio di OPS)':' (TD DMX)'} · ${st.playing?'▶ in play':'■ fermo'} · ${formatCueTime(+st.pos||0)} · ultimo stato ${age} ms fa${showClock.health.states.length>2?` · ${chReport(showClock.health,now()).rate_hz} stati/s`:''}`:'nessuno: l’orologio non è attivo'}</p>
      <table class="ch-tab"><thead><tr><th></th><th>Chi</th><th>Tipo</th><th>Ritardo</th><th>Jitter</th><th>Scarto medio</th><th>Scarto max</th><th>Pausa max</th><th>Ultimo stato</th></tr></thead><tbody>
      ${rs.map(r=>`<tr${r.id===showClock.id?' class="ch-me"':''}><td>${tag[chGrade(r)]}</td><td>${esc(r.name||r.id)}${r.id===showClock.id?' <span class="hint">(questo)</span>':''}</td><td class="dim">${esc(r.kind||'')}</td>
        <td class="num">${ms(r.rtt_ms)}</td><td class="num">${ms(r.jitter_ms)}</td><td class="num">${ms(r.err_ms)}</td><td class="num">${ms(r.err_max_ms)}</td><td class="num">${ms(r.gap_max_ms)}</td><td class="num">${ms(r.age_ms)}</td></tr>`).join('')||'<tr><td colspan="9" class="hint">Nessun follower ha mandato il suo rapporto negli ultimi 7 s.</td></tr>'}
      </tbody></table>`;
  };
  s.innerHTML=`<div class="sheet ch-sheet" role="dialog" aria-label="Orologio dello show">
    <div class="top"><h3>⏱ Orologio dello show</h3><button class="btn ghost" id="chClose">Chiudi</button></div>
    <div class="ch-body"></div>
    <p class="hint"><b>Scarto</b> = di quanto ogni macchina corregge la sua posizione a ogni nuovo stato del master: viene dal ritardo variabile di rete e broker (Wi-Fi). Si misura solo con lo show in play. <b>Ritardo</b> e <b>jitter</b> = andata e ritorno verso il broker e quanto variano. <b>Pausa max</b> = il tempo più lungo fra due stati (il master ne manda almeno uno al secondo). Verde: scarto entro 10 ms e jitter entro 20 ms; giallo fino a 40 / 80 ms; rosso oltre, o nessuno stato da 5 s. I TD (DMX, PatchDeck) compariranno quando manderanno anche loro il rapporto.</p>
    <div class="row"><button class="btn ghost" id="chName">Nome di questo tablet: ${esc(chDeviceName())}</button></div></div>`;
  s.querySelector('#chClose').onclick=()=>{clearInterval(t);closeSheet()};
  s.querySelector('#chName').onclick=async()=>{const n=String(await uiPrompt('Nome di questo tablet nel pannello',chDeviceName())||'').trim().slice(0,30);if(n){try{localStorage.setItem('plancia.deviceName',n)}catch{}openClockHealth()}};
  const t=setInterval(()=>{if(!document.querySelector('.ch-sheet')){clearInterval(t);return}paint()},1000);
  paint();
}
$('#clockPill')?.addEventListener('click',openClockHealth);
