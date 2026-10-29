/* ---------- tipo di widget: scenes (griglia di scelte, con sei modi) ---------- */
// w.mode: 'push' (una scelta), 'multi' (piu' scelte, 0/1 per voce),
// 'head-select' (selezione delle teste pubblicate da DMX Master),
// 'head-presets' (preset delle teste), 'dmx-enum' (palette di un rig: parametro
// enum di DMX Master, nessun indirizzo OSC). Con addr '/dmx/scene' mostra le
// scene vere di DMX Master. Prima era negli switch di 40, 41, 80 e 95.
registerWidget('scenes',{oscAddress:w=>!['dmx-enum','head-presets'].includes(w.mode),
  // OSC in arrivo: teste selezionate (dal selettore delle teste), voci accese o voce attiva
  receive(w,args){
    if(w.mode==='head-select'&&w.addr==='/mh/select/heads'){
      w.selectedHeads=args.map(String);w.value=(w.headValues||[]).map(id=>w.selectedHeads.includes(id)?1:0);
    }else w.value=w.mode==='multi'?args.map(x=>+x>.5?1:0):Math.round(+args[0]);
    return true},
  inspector:{html(w){const availableEnums=enumParams(w.device||pickDev(w,'dmx')||'');
      return `${!['dmx-enum','head-presets'].includes(w.mode)?'<label>Voci (una per riga)<textarea id="fItems"'+(w.mode==='head-select'?' disabled':'')+'></textarea></label>':''}<div class="two"><label>Modalità<select id="fSMode"><option value="push">Una attiva</option><option value="multi">Selezione multipla</option><option value="head-select">Selezione teste TD</option><option value="dmx-enum">Parametro enum DMX V8</option><option value="head-presets">Preset PTZ salvati</option></select></label><label>Colonne<input id="fCols" type="number" min="0" max="12" placeholder="auto"></label></div>
      ${w.mode==='dmx-enum'?`<label>Device DMX V8<select id="fTdDevice"><option value="">Automatico</option>${devIds('dmx').map(id=>`<option value="${esc(id)}"${id===w.device?' selected':''}>${esc(id)}</option>`).join('')}</select></label>
        <label>Parametro enum<select id="fTdParam"><option value="">Automatico · palette preferita</option>${[['Palette dei rig',availableEnums.filter(p=>/_palette$/.test(p.n))],['Altri parametri',availableEnums.filter(p=>!/_palette$/.test(p.n))]].filter(([,l])=>l.length).map(([g,l])=>`<optgroup label="${g}">${l.map(p=>`<option value="${esc(p.n)}"${p.n===w.param?' selected':''}>${esc(p.label)} · ${esc(p.n)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <p class="hint">Le voci arrivano dalla matrice <code>dmx_matrix</code>; il click invia al device il valore originale dell'enum via MQTT. Nessuna opzione o stato viene inventato.</p>`
        :w.mode==='head-presets'?'<p class="hint">I preset PTZ si gestiscono dal widget in modalità normale. Sono snapshot locali condivisi nel layout; non sono preset interni al motore TD.</p>'
        :'<p class="hint">Invia l’indice della voce (0, 1, 2…) oppure, in selezione multipla, un elenco di 0 e 1.</p>'}`},
    bind:(w,{on,val})=>{val('#fItems',w.items);val('#fSMode',w.mode||'push');val('#fCols',w.cols||'');
    on('#fItems',v=>w.items=v);$('#fSMode').addEventListener('change',e=>{
      const old=w.mode;w.mode=e.target.value;w.value=w.mode==='multi'||w.mode==='head-select'?[]:0;
      if(w.mode==='head-select'){w.addr='/mh/select/heads';w.headValues=[];w.selectedHeads=[];delete w._headsInitialized;syncHeadSelectors()}
      else if(old==='head-select'&&w.addr==='/mh/select/heads')w.addr='/mh/select';
      if(w.mode==='dmx-enum'){w.addr='';w.device=w.device||'';w.param=w.param||''}
      if(w.mode==='head-presets'){w.addr='';w.headPresets=w.headPresets||[]}
      else if(old==='head-presets'&&!w.addr)w.addr='/mh/preset/recall';
      save();refresh(w);renderInsp();
    });on('#fCols',v=>w.cols=+v||0);
    if($('#fTdDevice'))$('#fTdDevice').addEventListener('change',e=>{w.device=e.target.value;
      if(w.param&&!enumParams(w.device||pickDev(w,'dmx')).some(p=>p.n===w.param))w.param='';
      save();refresh(w);renderInsp()});
    if($('#fTdParam'))$('#fTdParam').addEventListener('change',e=>{w.param=e.target.value;save();refresh(w);renderInsp()});
  }},
  size:[4,3],label:'Scene',showsValue:false,refreshOnResize:true,
  showsAddr:w=>w.mode!=='dmx-enum',
  inner(w){      if(w.mode==='dmx-enum')return '<div class="sc"></div>';
      if(w.mode==='head-presets')return `<div class="hp">${(w.headPresets||[]).map((p,i)=>`<button data-head-preset="${i}" title="${esc(p.name)}">${esc(p.name)}</button>`).join('')}<button data-act="manage-presets">＋ Gestisci</button></div>`;
      // /dmx/scene con DMX Master: le scene vere di TD (catalogo), senza i
      // colori dei LOOKS locali, che con TD non corrispondono a niente
      const td=w.addr==='/dmx/scene'&&(!w.mode||w.mode==='push')?tdScenes():[];
      const it=td.length?td.map(s=>s.label||s.id):items(w),manage=w.addr==='/dmx/scene'&&(!w.mode||w.mode==='push')&&Array.isArray(tdParams().show_scene_catalog),c=colsOf(w,it.length+(manage?1:0)),lk=w.addr==='/dmx/scene'&&!td.length;
      if(w.mode==='head-select'&&!it.length)return '<div class="dv-empty">In attesa delle teste mobili pubblicate da DMX Master.</div>';
      // scene di TD: striscia con le palette salvate nella scena (front |
      // back, preview della nota TD 37), barretta col primo colore front
      return `<div class="sc" style="grid-template-columns:repeat(${c},minmax(0,1fr))">${it.map((n,i)=>{const look=td.length?tdSceneLook(td[i]):null,ic=look?look.ic:lk&&LOOKS[i]?lookHex(i):'';
        return `<div class="si" data-i="${i}" title="${esc(n)}"${ic?` style="--ic:${ic}"`:''}><span class="no">${String(i+1).padStart(2,'0')}</span><span class="nm">${esc(n)}</span><i class="chip"></i><i class="prog"></i>${look?.grad?`<i class="pal" style="background:${look.grad}"></i>`:''}</div>`}).join('')}${manage?'<div class="si si-manage" data-act="manage-scenes" title="Crea, ricattura, rinomina ed elimina le scene di DMX Master"><span class="nm">＋ Scene…</span></div>':''}</div>${lk?'<span class="simtag" title="DMX Master non collegato: look locali della Plancia, solo simulazione">SIMULAZIONE</span>':''}`},
  paint(el,w){    if(w.mode==='dmx-enum')paintTdEnum(el,w);
    else el.querySelectorAll('.si').forEach((n,i)=>n.classList.toggle('on',w.mode==='multi'||w.mode==='head-select'?!!(Array.isArray(w.value)&&+w.value[i]):w.value===i));
  },
  args(w){
      if(w.mode==='head-select'&&w.addr==='/mh/select/heads')return (w.headValues||[]).filter((_,i)=>!!w.value?.[i]);
      return w.mode==='multi'?(w.value||[]).map(x=>+x?1:0):[w.value];
  },
  onPointer(e,el,w){      if(e.target.closest('[data-act="manage-scenes"]')){e.preventDefault();openSceneEditor();return}
      if(w.mode==='head-presets'){
        const manage=e.target.closest('[data-act="manage-presets"]'),preset=e.target.closest('[data-head-preset]');
        if(manage){e.preventDefault();openHeadPresetEditor(w);return}
        if(preset){e.preventDefault();recallHeadPreset(w,+preset.dataset.headPreset);return}
        return;
      }
      const it=e.target.closest('[data-i]'); if(!it)return; e.preventDefault(); const i=+it.dataset.i;
      if(w.mode==='dmx-enum'){
        const info=tdEnumInfo(w),option=info.meta?.options?.[i];
        if(!info.id){showError('Nessun device DMX V8 pubblicato.');return}
        if(!info.meta||option===undefined){showError('Il parametro enum DMX V8 non è disponibile.');return}
        setDmxParam(info.id,info.meta.n,String(option));return;
      }
      if(w.mode==='multi'||w.mode==='head-select'){const a=items(w).map((_,k)=>Array.isArray(w.value)?(+w.value[k]||0):0);a[i]=a[i]?0:1;w.value=a;
        if(w.mode==='head-select')w.selectedHeads=(w.headValues||[]).filter((_,k)=>!!a[k]);
        paint(el,w);send(w)}
      else{w.value=-2;set(w,i)}
      save(); return;
    },
  // palette dei rig dai dati di DMX Master; barra di avanzamento del crossfade della scena
  tick(el,w,{repaint,now}){
    if(w.mode==='dmx-enum'){if(repaint)paintTdEnum(el,w)}
    else if(w.addr==='/dmx/scene'){const k=SH.fade>0?clamp((now-SH.t0)/(SH.fade*1000)):1;
      el.querySelectorAll('.si').forEach((x,i)=>{const p=x.querySelector('.prog');if(p)p.style.width=(i===SH.scene&&k<1)?k*100+'%':'0'})}
  },
  help(w){const a=w.addr||'';
      if(w.mode==='dmx-enum')return['Palette del rig','Il colore di tutto il gruppo (rig). Per una luce sola usa la pagina Luci.'];
      if(w.mode==='head-select')return['Selezione teste','Scegli quali teste comandare con i controlli della pagina.'];
      if(w.mode==='head-presets')return['Preset teste','Posizioni e stati salvati delle teste: "Gestisci" per crearli.'];
      if(a==='/dmx/scene')return['Scene di DMX Master','Tocca una scena per richiamarla (con il fade impostato). "＋ Scene…" per catturare lo stato attuale, ricatturare, rinominare o eliminare.'];
      if(a==='/dmx/chase')return['Chase','Come si muovono i colori nei rig: lento, veloce, a tempo di musica…'];
      if(a==='/mh/position')return['Posizioni teste','Posizioni pronte per le teste selezionate.'];
      if(a.startsWith('/mh/gobo'))return['Gobo','Il disegno proiettato dalle teste.'];
      return['Scelte',`Tocca per scegliere (${a||'nessun indirizzo'}).`];
  }});
