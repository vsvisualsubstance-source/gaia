/* ---------- impostazioni e template ---------- */
function openSheet(){
  const s=$('#scrim'); s.hidden=false;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Impostazioni">
    <div class="top"><h3>Impostazioni</h3><button class="btn ghost" id="sClose">Chiudi</button></div>
    <section style="border:0;padding:0"><h3 style="font-size:14px">Template</h3>
      <div class="tpls">${Object.entries(TPL).reverse().map(([k,t])=>`<div class="tpl"><b>${esc(t.name)}</b><p>${esc(t.desc)}</p>
        <div class="row"><button class="btn sm" data-tadd="${k}">Aggiungi</button><button class="btn sm ghost" data-trep="${k}">Sostituisci</button></div></div>`).join('')}</div>
      <p class="note" id="tMsg">"Aggiungi" mette le pagine del template dopo le tue; "Sostituisci" chiede conferma e rimpiazza tutto il layout.</p>
    </section>
    <section><h3 style="font-size:14px">Gaia</h3>
      <label class="chk"><input id="gOn" type="checkbox"> Collega a Gaia</label>
      <div class="row" style="align-items:flex-end"><label style="flex:1;min-width:160px">Profilo di rete<select id="gProf"></select></label>
        <button class="btn sm" id="gDup">Duplica</button><button class="btn sm danger" id="gDelP">Elimina</button></div>
      <label>Nome del profilo<input id="gPName"></label>
      <div class="netg">
        <span></span><b>Host / IP</b><b>Porta</b>
        <span>Broker MQTT <em>WebSocket</em></span><input id="gBroker" class="mono" spellcheck="false" autocapitalize="off"><input id="gWs" type="number">
        <span>Fallback broker <em>es. Tailscale</em></span><input id="gFb" class="mono" spellcheck="false" autocapitalize="off" placeholder="nessuno"><span class="nmut">stessa</span>
        <span>Node-RED <em>HTTP e WS /gaia</em></span><input id="gNr" class="mono" spellcheck="false" autocapitalize="off"><input id="gNrP" type="number">
        <span>Gaia Admin</span><input id="gAd" class="mono" spellcheck="false" autocapitalize="off"><input id="gAdP" type="number">
        <span>OSC verso Gaia <em>osc_bridge</em></span><input id="gOs" class="mono" spellcheck="false" autocapitalize="off"><input id="gOsP" type="number">
      </div>
      <label>Stanza della chat<input id="gSt" class="mono"></label>
      <div class="row"><button class="btn primary" id="gApply">Salva e collega</button><button class="btn" id="gTest">Verifica connessioni</button></div>
      <div id="gTestOut" class="nett" hidden></div>
      <p class="note">Avvio diretto su un profilo dal browser del tablet: <code>?profilo=ops</code>, oppure singoli indirizzi con <code>?broker=192.168.1.240&amp;nodered=192.168.1.240&amp;osc=192.168.1.240</code>.</p>
      <p class="note">Stesso broker di <code>patchdeck.html</code> e <code>dmx.html</code>: i device TD si trovano da soli da <code>gaia/device/+/status</code> e dalle matrici retained. Se il broker non risponde per 10 s si prova il fallback. Gli indirizzi OSC che iniziano con <code>/gaia/</code> il bridge di Plancia li manda all'ingresso OSC di Gaia. Senza broker raggiungibile i widget Gaia mostrano una simulazione.</p>
    </section>
    <section><h3 style="font-size:14px">Connessione OSC</h3>
      <label>Indirizzo del bridge<input id="sUrl" class="mono" spellcheck="false" autocapitalize="off"></label>
      <div class="three"><label>Invia OSC a (host)<input id="sHost" class="mono"></label><label>Porta<input id="sPort" type="number"></label></div>
      <div class="row"><button class="btn primary" id="sApply">Connetti</button></div>
      <p class="note">Avvia il bridge sul computer con <code>npm start</code> e apri dal tablet l'indirizzo che stampa (es. <code>http://192.168.1.20:8080</code>). L'OSC in arrivo va sulla porta <code>9000</code> del bridge. Senza bridge, il render simula il rig in locale.</p>
    </section>
    <section><h3 style="font-size:14px">Canali OSC per progetto o istanza</h3>
      <p class="note">La destinazione predefinita resta ${esc(C.host)}:${C.port}. Aggiungi un canale per ogni progetto o istanza TD e assegnalo ai widget dal loro ispettore. Gaia <code>/gaia/…</code> continua a usare il canale Gaia; i widget Gaia via MQTT non cambiano.</p>
      <div id="oscRoutes" class="osc-routes"></div>
      <div class="row"><button class="btn sm" id="oscRouteAdd">Aggiungi canale</button></div>
      <p class="note" id="oscRouteError" role="alert" hidden></p>
      <p class="note">Per esempio, configura qui DMX, PatchDeck o Controller Audio con host e porta OSC realmente in ascolto nel relativo progetto. La famiglia e l’istanza sono etichette di routing: non trasformano né verificano il contratto degli indirizzi.</p>
    </section>
    <section><h3 style="font-size:14px">Progetti</h3>
      <div class="row"><button class="btn primary" id="pOpen">📁 Apri Progetti</button></div>
      <p class="note">Salva, apri, rinomina, duplica, esporta e importa i progetti, o creane uno da un modello. Anche dal nome del progetto in alto.</p>
    </section>
    <section><h3 style="font-size:14px">Layout</h3>
      <textarea id="sJson" spellcheck="false"></textarea>
      <div class="row"><button class="btn" id="sCopy">Copia</button><button class="btn" id="sLoad">Applica JSON</button></div>
      <p class="note" id="sMsg">Il layout corrente si salva automaticamente sul server OPS e si condivide tra i browser connessi. Lo snapshot di un progetto si aggiorna solo con “Aggiorna”. Copia il JSON per spostare il layout fuori da OPS o nel repo.</p>
    </section></div>`;
  let editP=GC.profile;
  const F=[['gBroker','broker'],['gWs','wsPort',1],['gFb','fallback'],['gNr','nodered'],['gNrP','noderedPort',1],['gAd','admin'],['gAdP','adminPort',1],['gOs','osc'],['gOsP','oscPort',1]];
  const fillProf=()=>{$('#gProf').innerHTML=Object.entries(GC.profiles).map(([k,v])=>`<option value="${esc(k)}"${k===editP?' selected':''}>${esc(v.name||k)}</option>`).join('');
    const n=GC.profiles[editP];$('#gPName').value=n.name||'';F.forEach(([id,k])=>$('#'+id).value=n[k]??'');$('#gDelP').disabled=editP in NET_DEFAULT};
  const readProf=()=>{const n=GC.profiles[editP];n.name=$('#gPName').value.trim()||n.name;F.forEach(([id,k,num])=>{const v=$('#'+id).value.trim();n[k]=num?(+v||n[k]):v})};
  $('#gOn').checked=GC.on;$('#gSt').value=GC.stanza;fillProf();
  $('#gProf').onchange=e=>{readProf();editP=e.target.value;fillProf()};
  $('#gDup').onclick=()=>{readProf();const k='p'+uid();GC.profiles[k]={...GC.profiles[editP],name:(GC.profiles[editP].name||'Profilo')+' (copia)'};editP=k;fillProf()};
  let delArmed=false;$('#gDelP').onclick=e=>{if(editP in NET_DEFAULT)return;if(!delArmed){delArmed=true;e.target.textContent='Conferma';return}
    delete GC.profiles[editP];if(GC.profile===editP)GC.profile='casa';editP=GC.profile;delArmed=false;e.target.textContent='Elimina';store.set(GKEY,GC);fillProf()};
  $('#gTest').onclick=()=>{readProf();netTest(GC.profiles[editP])};
  $('#gApply').onclick=()=>{readProf();GC.on=$('#gOn').checked;GC.stanza=$('#gSt').value.trim()||'studio';GC.profile=editP;store.set(GKEY,GC);
    if(ws&&ws.readyState===1)ws.send(JSON.stringify(bridgeCfg()));
    G.offSince=null;nrConnect();if(GC.on){gSimOff();gLoadLib(()=>gConnect(net().broker));setTimeout(()=>{if(!G.ok)gSim()},4500)}else{try{G.client&&G.client.end(true)}catch{}G.client=null;G.ok=false;gSim()}gStatus();closeSheet()};
  $('#sUrl').value=C.url;$('#sHost').value=C.host;$('#sPort').value=C.port;
  let oscChannelsDraft=C.oscChannels.map(c=>({...c}));
  const deletedOscChannels=new Set();
  const renderOscChannels=()=>{
    const list=$('#oscRoutes');
    list.innerHTML=oscChannelsDraft.map((c,i)=>`<div class="osc-route" data-route="${i}">
      <label>Nome<input data-prop="name" value="${esc(c.name)}" placeholder="Es. DMX Master"></label>
      <label>Famiglia<select data-prop="family">${Object.entries(OSC_FAMILIES).map(([k,v])=>`<option value="${k}"${k===c.family?' selected':''}>${esc(v)}</option>`).join('')}</select></label>
      <label>Istanza<input data-prop="instance" value="${esc(c.instance)}" placeholder="Es. td-dmx-win"></label>
      <label>Host<input data-prop="host" class="mono" value="${esc(c.host)}" spellcheck="false" autocapitalize="off"></label>
      <label>Porta<input data-prop="port" type="number" min="1" max="65535" value="${esc(c.port)}"></label>
      <button class="btn danger" data-route-del="${i}" aria-label="Elimina canale OSC">×</button>
    </div>`).join('')||'<p class="hint">Nessun canale aggiuntivo. I widget usano la destinazione predefinita.</p>';
    list.querySelectorAll('[data-route]').forEach(row=>{
      const i=+row.dataset.route;
      row.querySelectorAll('[data-prop]').forEach(input=>input.addEventListener('input',e=>{
        oscChannelsDraft[i][e.target.dataset.prop]=e.target.dataset.prop==='port'?e.target.value:e.target.value;
      }));
      row.querySelector('[data-prop="family"]').addEventListener('change',e=>{oscChannelsDraft[i].family=e.target.value});
    });
    list.querySelectorAll('[data-route-del]').forEach(button=>button.onclick=()=>{
      const route=oscChannelsDraft[+button.dataset.route];
      const assigned=allW().filter(w=>w.oscChannel===route.id);
      if(assigned.length&&!confirm(`Il canale è assegnato a ${assigned.length} controlli. Eliminarlo e riportarli alla destinazione predefinita?`))return;
      deletedOscChannels.add(route.id);
      oscChannelsDraft.splice(+button.dataset.route,1);save();renderOscChannels();
    });
  };
  renderOscChannels();
  $('#oscRouteAdd').onclick=()=>{
    oscChannelsDraft.push({id:'osc-'+uid(),name:'',family:'custom',instance:'',host:'',port:''});
    renderOscChannels();
  };
  $('#sJson').value=JSON.stringify(L,null,1);
  $('#sClose').onclick=closeSheet; s.onpointerdown=e=>{if(e.target===s)closeSheet()};
  const tmsg=t=>$('#tMsg').textContent=t;
  s.querySelectorAll('[data-tadd]').forEach(b=>b.onclick=()=>{const t=TPL[b.dataset.tadd],ps=t.pages();L.pages.push(...ps);pi=L.pages.length-ps.length;selId=null;save();render();initShow();tmsg(`Aggiunto "${t.name}" (${ps.length} ${ps.length>1?'pagine':'pagina'}).`);$('#sJson').value=JSON.stringify(L,null,1)});
  s.querySelectorAll('[data-trep]').forEach(b=>{let armed=false;b.onclick=()=>{if(!armed){armed=true;b.textContent='Conferma';b.classList.add('danger');return}
    const t=TPL[b.dataset.trep];L={pages:t.pages(),fixtures:L.fixtures||defaultFixtures(L.rig),stage:L.stage||stageDefaults(),...(L.groups?{groups:L.groups}:{})};ensureStageData(L);pi=0;selId=null;save();render();initShow();tmsg(`Layout sostituito con "${t.name}".`);$('#sJson').value=JSON.stringify(L,null,1);
    armed=false;b.textContent='Sostituisci';b.classList.remove('danger')}});
  $('#sApply').onclick=()=>{
    const port=Number($('#sPort').value),host=$('#sHost').value.trim();
    const invalid=oscChannelsDraft.find(c=>!c.host.trim()||!Number.isInteger(Number(c.port))||Number(c.port)<1||Number(c.port)>65535||(!c.instance.trim()&&!c.name.trim()));
    const error=$('#oscRouteError');
    if(!host||!Number.isInteger(port)||port<1||port>65535){error.textContent='Inserisci un host e una porta OSC predefinita valida (1–65535).';error.hidden=false;return}
    if(invalid){error.textContent=`Completa nome o istanza, host e porta validi per il canale "${invalid.name||OSC_FAMILIES[invalid.family]||'senza nome'}".`;error.hidden=false;return}
    const normalizedChannels=oscChannelsDraft.map(c=>({...c,id:oscChannelId(c),port:Number(c.port)}));
    if(new Set(normalizedChannels.map(c=>c.id)).size!==normalizedChannels.length){error.textContent='Due canali hanno la stessa famiglia e identità (istanza o nome). Rendili univoci.';error.hidden=false;return}
    error.hidden=true;
    for(const w of allW())if(deletedOscChannels.has(w.oscChannel))delete w.oscChannel;
    const channelIds=new Map(oscChannelsDraft.map(c=>[c.id,oscChannelId(c)]));
    for(const w of allW())if(channelIds.has(w.oscChannel))w.oscChannel=channelIds.get(w.oscChannel);
    C={...C,url:$('#sUrl').value.trim(),host,port,oscChannels:normalizedChannels};
    save();store.set(CKEY,C);connect();closeSheet();
  };
  const msg=t=>$('#sMsg').textContent=t;
  $('#sCopy').onclick=()=>{const ta=$('#sJson');const fb=()=>{ta.select();msg('Testo selezionato: copialo con Ctrl/Cmd+C.')};
    if(navigator.clipboard)navigator.clipboard.writeText(ta.value).then(()=>msg('Layout copiato negli appunti.'),fb);else fb()};
  $('#sLoad').onclick=()=>{try{const j=JSON.parse($('#sJson').value);if(!Array.isArray(j.pages)||!j.pages.length)throw 0;L=j;if(!L.fixtures)L.fixtures=defaultFixtures(L.rig);ensureStageData(L);pi=0;selId=null;save();render();initShow();msg('Layout applicato.')}catch{msg('JSON non valido: serve un oggetto con un elenco "pages".')}};
  $('#pOpen').onclick=openProjects;
}
function closeSheet(){$('#scrim').hidden=true;$('#scrim').innerHTML=''}
$('#menuBtn').onclick=openSheet; $('#conn').onclick=openSheet; $('#gconn').onclick=openSheet;

/* stato iniziale del rig dai controlli salvati, senza inviare OSC */
function initShow(){
  let sc=0;
  for(const w of allW()){if(!w.addr)continue;
    if(w.addr==='/dmx/scene'&&typeof w.value==='number'&&w.value>=0)sc=w.value;
    else if((w.addr.startsWith('/dmx/')||w.addr==='/led/bright')&&['fader','knob','button','scenes'].includes(w.type))model(w.addr,argsOf(w));
    else if(w.addr==='/mh/select')model(w.addr,argsOf(w));}
  goScene(sc,0);
}

// 2026-10-21, scelta dell'operatore: Timeline = preparare, Show = eseguire.
// Una volta sola (L.uiRev): la pagina Timeline diventa quella di
// preparazione (la vecchia resta in L.pagesBackup), le timeline /show delle
// altre pagine diventano in sola lettura.
function migrateUiShowTimeline(){
  if((L.uiRev||0)>=1)return;
  const old=L.pages.find(p=>p.name==='Timeline'),fresh=TPL.timeline.pages()[0];
  L.pagesBackup={...(L.pagesBackup||{}),timeline_20261021:old?JSON.parse(JSON.stringify(old)):null};
  if(old){fresh.id=old.id;L.pages[L.pages.indexOf(old)]=fresh}else L.pages.push(fresh);
  for(const p of L.pages)if(p!==fresh)for(const w of p.widgets)if(w.type==='timeline'&&w.addr==='/show')w.readonly=true;
  L.uiRev=1;save();
}
// 2026-10-21: pagine console scelte dall'operatore (Regia, Luci), aggiunte una volta
// sola dopo "Show"; se esistono gia' (o sono state tolte dopo) non si toccano.
function migrateUiConsolePages(){
  if((L.uiRev||0)>=2)return;
  let at=L.pages.findIndex(p=>p.name==='Show')+1||L.pages.length;
  for(const k of ['regia','luci']){const fresh=TPL[k].pages()[0];if(!L.pages.some(p=>p.name===fresh.name))L.pages.splice(at++,0,fresh)}
  L.uiRev=2;save();
}
migrateLegacyHeadSelectors();migrateHeadPresetWidgets();migrateUiShowTimeline();migrateUiConsolePages();render(); initShow(); connect(); gStart(); requestAnimationFrame(loop);
