/* ---------- tipo di widget: timeline (cue a tempo; /show = timeline dello show) ---------- */
// Prima era sparso negli switch di 40 (contenuto), 41 (tocco), 80 (loop) e 95 (aiuto).
// Il motore che fa avanzare il tempo e manda le cue resta nel loop (80) e in
// 30-show-engine.js; qui c'e' solo il widget. La timeline dello show ha le tracce
// VIDEO (66-video-timeline.js) e LASER (99-laser-scenes.js).
registerWidget('timeline',{addrLabel:'Indirizzo base OSC',
  inspector:{html:w=>`<div class="two"><label class="chk"><input id="fReadonly" type="checkbox"> Sola lettura: si esegue, le cue si modificano nella pagina Timeline</label><label>Durata (s)<input id="fDur" type="number" min="10"></label><label>BPM<input id="fBpm" type="number" min="40" max="240"></label></div>
      <label>Cue<textarea id="fCues" spellcheck="false" style="min-height:180px"></textarea></label>
      <button class="btn" id="fCueEditor">Apri editor cue</button>
      <label>Device DMX V8 per le cue<select id="fTLDmxDevice"><option value="">Automatico</option>${devIds('dmx').map(id=>`<option value="${esc(id)}"${id===w.dmxDevice?' selected':''}>${esc(id)}</option>`).join('')}</select></label>
      <p class="hint">Usa l’editor cue per aggiungere, spostare e riordinare le cue locali. Le modifiche si salvano nel layout condiviso OPS; “Aggiorna” in ⋯ → Progetti aggiorna anche lo snapshot nominato. Se DMX Master pubblica un clock attivo, la timeline /show lo segue e invia i comandi al master.</p>`,
    bind:(w,{on,val})=>{val('#fDur',w.duration);val('#fBpm',w.bpm);val('#fCues',w.cues);
    on('#fDur',v=>{if(+v>=10)w.duration=+v});on('#fBpm',v=>{if(+v>0)w.bpm=+v});on('#fCues',v=>w.cues=v);
    if($('#fCueEditor'))$('#fCueEditor').onclick=()=>openCueEditor(w);
    if($('#fReadonly')){$('#fReadonly').checked=!!w.readonly;$('#fReadonly').onchange=e=>{w.readonly=e.target.checked;save();refresh(w)}}
    if($('#fTLDmxDevice'))$('#fTLDmxDevice').addEventListener('change',e=>{w.dmxDevice=e.target.value;save();renderInsp()})}},
  size:[10,3],label:'Timeline',showsValue:false,
  inner(w){const cues=timelineCues(w),D=timelineDuration(w),controlled=isShowTimeline(w)&&showClock.authority;
      const sample=controlled?showClockSample():null,available=!!sample&&showClockFresh(sample),locked=controlled&&!available;
      const step=[5,10,15,30,60,120,300].find(s=>D/s<=12)||600; let ticks='';
      for(let t=0;t<D;t+=step)ticks+=`<span style="left:${t/D*100}%">${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}</span>`;
      const blocks=cues.map((c,i)=>{const e=(cues[i+1]?.t??D);const col=c.sceneId?tdSceneLook(tdScenes().find(s=>s.id===c.sceneId)).ic||w.color:c.scene!=null&&LOOKS[c.scene]?lookHex(c.scene):w.color;
        const target=[c.sceneId?c.sceneId:c.scene!=null?'SC '+(c.scene+1):'',c.params?.length?'DMX '+c.params.length:''].filter(Boolean).join(' · ');
        return `<div class="tl-blk" data-k="${i}" style="left:${c.t/D*100}%;width:${(e-c.t)/D*100}%;--ic:${col}"><span><i>${i+1}</i>${esc(c.name)}</span><em>${target}</em></div>`}).join('');
      return `<div class="tl${isShowTimeline(w)?' tl-tracks':''}" data-duration="${D}"><div class="tl-head"><span class="tl-name">${esc(w.label)}</span>
        <div class="tl-tr"><button data-act="start" aria-label="Inizio"${locked?' disabled':''}>${ICON.start}</button><button data-act="play" aria-label="Play/pausa"${locked?' disabled':''}>${ICON.play}</button><button data-act="stop" aria-label="Stop"${locked?' disabled':''}>${ICON.stop}</button><button data-act="loop" aria-label="Loop"${controlled?' disabled':''}>${ICON.loop}</button>${w.readonly?'':'<button data-act="edit-cues" aria-label="Modifica cue">CUE</button>'}</div>
        ${isShowTimeline(w)?`<button class="tl-live" data-act="live"${w.readonly?' disabled':''} title="${w.readonly?'Modalità di DMX Master: si cambia nella pagina Timeline':'LIVE: comandi tu dal tablet (per comporre e catturare le scene). TIMELINE: comanda la timeline dello show'}">—</button>`:''}<span class="tl-tc">00:00:00:00</span><span class="tl-cue"><span class="k">CUE</span><b>—</b></span><span class="tl-next"></span><span class="tl-bpm">${controlled?`TD · ${available?sample.source.toUpperCase():'OFFLINE · FERMO'}`:`${isShowTimeline(w)?'SIMULAZIONE · ':''}${w.bpm||120} BPM`} · ${Math.floor(D/60)}:${String(Math.round(D%60)).padStart(2,'0')}</span></div>
        ${isShowTimeline(w)?'<div class="tl-trk tl-trk-main"><div class="tl-vhead"><span class="k">LUCI</span></div>':''}<div class="tl-lane"><div class="tl-ruler">${ticks}</div><div class="tl-cues">${blocks}</div><div class="tl-ph"></div></div>${isShowTimeline(w)?'</div>'+videoLaneHtml(w,D)+laserLaneHtml(w,D):''}</div>`},
  // trasporto e pulsanti; blocchi delle cue (trascinabili, o richiamo della cue
  // quando comanda DMX Master); tocco o trascinamento sulla traccia = salto nel tempo
  onPointer(e,el,w){
    const end=()=>{el.classList.remove('active','press');el.onpointermove=null;el.onpointerup=el.onpointercancel=null;save()};
      const b=e.target.closest('[data-act]'); if(b){e.preventDefault();if(b.dataset.act==='edit-cues')openCueEditor(w);else tlAct(w,b.dataset.act);return}
      const lane=e.target.closest('.tl-lane'); if(!lane)return;
      const block=e.target.closest('.tl-blk');
      if(block){
        if(isShowTimeline(w)&&showClock.authority){
          e.preventDefault();
          const cue=timelineCues(w)[+block.dataset.k];
          if(cue)showClockCommand(w,'cue',cue.index||(+block.dataset.k+1));
          return;
        }
        // sola lettura (pagina Show): il blocco salta alla cue, non si sposta
        if(w.readonly){e.preventDefault();const cue=parseCues(w)[+block.dataset.k];if(cue)seek(w,cue.t);return}
        e.preventDefault();el.setPointerCapture(e.pointerId);
        const cues=parseCues(w).map(c=>({t:c.t,name:c.name,targets:cueTargets(c)})),i=+block.dataset.k,r=lane.getBoundingClientRect(),startX=e.clientX,startT=cues[i]?.t??0;
        block.classList.add('dragging');
        const move=ev=>{const t=clamp(startT+(ev.clientX-startX)/r.width*w.duration,0,Math.max(0,w.duration-.01));block.style.left=t/w.duration*100+'%'};
        el.onpointermove=move;
        el.onpointerup=el.onpointercancel=ev=>{
          const delta=Math.abs(ev.clientX-startX);el.onpointermove=el.onpointerup=el.onpointercancel=null;
          if(delta<5){openCueEditor(w);return}
          cues[i].t=clamp(startT+(ev.clientX-startX)/r.width*w.duration,0,Math.max(0,w.duration-.01));
          w.cues=serializeCues(cues);save();refresh(w);
        };
        return;
      }
      e.preventDefault(); el.setPointerCapture(e.pointerId); const r=lane.getBoundingClientRect();
      const mv=ev=>seek(w,clamp((ev.clientX-r.left)/r.width)*timelineDuration(w)); mv(e); el.onpointermove=mv; el.onpointerup=el.onpointercancel=end; return;
  },
  // a ogni fotogramma: LIVE/TIMELINE, playhead, timecode, tracce video e laser, cue corrente e prossima
  tick(el,w){
      const lb=el.querySelector('.tl-live');if(lb){const on=tdShowActive(),t=on===null?'—':on?'TIMELINE':'LIVE';
        if(lb.textContent!==t){lb.textContent=t;lb.classList.toggle('is-live',on===false);lb.classList.toggle('is-tl',on===true)}}
      const r=rt(w),D=timelineDuration(w),cues=timelineCues(w);
      el.querySelector('.tl-ph').style.left=r.t/D*100+'%';paintVideoLane(el,w,D,r.t);paintLaserLane(el,w,D,r.t);el.querySelector('.tl-tc').textContent=tc(r.t);
      const sample=isShowTimeline(w)&&showClock.authority?showClockSample():null;
      const controlled=isShowTimeline(w)&&showClock.authority,locked=controlled&&(!sample||!showClockFresh(sample));
      el.querySelector('[data-act="start"]').disabled=locked;
      el.querySelector('[data-act="play"]').disabled=locked;
      el.querySelector('[data-act="stop"]').disabled=locked;
      el.querySelector('[data-act="loop"]').disabled=controlled;
      const remoteLabel=sample?.source==='mqtt'&&sample.state.cue?.label?
        `${sample.state.cue.index?`${sample.state.cue.index} · `:''}${sample.state.cue.label}`:null;
      const b=el.querySelector('.tl-cue b'),nm=remoteLabel|| (cues[r.cue]?`${r.cue+1} · ${cues[r.cue].name}`:'—');if(b.textContent!==nm)b.textContent=nm;
      const pb=el.querySelector('[data-act="play"]');if(pb._p!==r.playing){pb._p=r.playing;pb.innerHTML=r.playing?ICON.pause:ICON.play;pb.classList.toggle('on',r.playing)}
      el.querySelector('[data-act="loop"]').classList.toggle('on',r.loop);
      el.querySelectorAll('.tl-blk[data-k]').forEach(x=>{const k=+x.dataset.k;x.classList.toggle('cur',k===r.cue);x.classList.toggle('done',k<r.cue)});
      // prossima cue e tempo che manca: l'operatore sa cosa sta per succedere
      const nx=el.querySelector('.tl-next'),nc=cues[r.cue+1],nt=nc?`PROSSIMA ${r.cue+2} · ${nc.name} · tra ${Math.floor(Math.max(0,nc.t-r.t)/60)}:${String(Math.floor(Math.max(0,nc.t-r.t))%60).padStart(2,'0')}`:'';
      if(nx&&nx.textContent!==nt){nx.textContent=nt;nx.classList.toggle('soon',!!nc&&nc.t-r.t<=10)}
  },
  help:w=>['Timeline dello show',w.readonly?'Segue l\'orologio dello show di DMX Master. LIVE/TIMELINE dice chi comanda le luci: in TIMELINE vanno da sole con le cue, in LIVE comandi tu.':'Le cue dello show: tocca un blocco per modificarlo, "Cue" per l\'editor (scena e fade di ogni cue). Play/stop/inizio comandano l\'orologio. Sotto, la corsia VIDEO per PatchDeck.']});
