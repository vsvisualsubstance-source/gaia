/* ---------- libreria fixture (Open Fixture Library + DMXControl DDF, via bridge) ---------- */
// Dall'editor modelli: cerchi produttore e modello, scegli il modo, l'editor si
// apre già compilato. Scarica e converte il bridge (fixture-lib.js), che tiene
// la cache su OPS: dopo il primo uso funziona anche senza internet.
const FLIB={q:'',results:[],info:''};
function openFixtureLibrary(back){
  const s=$('#scrim');s.hidden=false;
  s.innerHTML=`<div class="sheet" role="dialog" aria-label="Libreria fixture">
    <div class="top"><h3>Libreria fixture</h3><button class="btn ghost" id="flBack">← Modelli</button></div>
    <p class="hint">Cerca per produttore e modello (es. <code>coemar ispot</code>, <code>robe robin 600</code>, <code>par rgbw</code>). Fonti: Open Fixture Library (MIT) e libreria DDF di DMXControl (CC-BY-SA-4.0). Sono schede fatte da utenti: controlla canali e ruota sul manuale prima di creare il modello.</p>
    <div class="row"><input id="flQ" style="flex:1" placeholder="produttore modello" value="${esc(FLIB.q)}" spellcheck="false" autocapitalize="off"><button class="btn" id="flGo">Cerca</button></div>
    <p class="hint" id="flInfo">${esc(FLIB.info)}</p>
    <div class="md-list" id="flList"></div>
  </div>`;
  const list=s.querySelector('#flList'),info=s.querySelector('#flInfo'),inp=s.querySelector('#flQ');
  const paint=()=>{list.innerHTML=FLIB.results.map((r,i)=>`<div class="md-row"><b>${esc(r.vendor)} ${esc(r.name)}</b>
      <span class="hint">${r.mode?esc(r.mode)+' · ':''}${r.src==='ofl'?'Open Fixture Library':'DMXControl DDF #'+esc(r.id)}</span>
      <button class="btn sm" data-fl="${i}">Apri</button></div>`).join('');
    list.querySelectorAll('[data-fl]').forEach(b=>b.onclick=()=>openLibraryFixture(FLIB.results[+b.dataset.fl],b,back))};
  let seq=0;
  const run=async()=>{const q=inp.value.trim();if(!q)return;FLIB.q=q;const my=++seq;
    info.textContent='Cerco… (la prima volta il bridge scarica l\'indice, qualche secondo)';
    try{const r=await fetch(`/api/fixture-lib?q=${encodeURIComponent(q)}`).then(r=>r.json());if(my!==seq)return;
      if(!r.ok)throw new Error(r.error);
      FLIB.results=r.results;FLIB.info=`${r.results.length?r.results.length+(r.results.length>=60?'+':'')+' risultati':'Nessun risultato'} su ${r.total} schede · indice del ${new Date(r.builtAt).toLocaleDateString('it-IT')}${r.errors?.length?' · parziale: '+r.errors.join(' · '):''}`;
      info.textContent=FLIB.info;paint()}
    catch(e){if(my===seq)info.textContent='Libreria non raggiungibile: '+e.message+' (serve il bridge su OPS e, la prima volta, internet).'}};
  s.querySelector('#flBack').onclick=back||openModelEditor;
  s.querySelector('#flGo').onclick=run;
  inp.onkeydown=e=>{if(e.key==='Enter')run()};
  paint();inp.focus();
}
async function openLibraryFixture(r,btn,back){
  btn.disabled=true;btn.textContent='…';
  try{const out=await fetch(`/api/fixture-lib/fixture?src=${encodeURIComponent(r.src)}&id=${encodeURIComponent(r.id)}`).then(x=>x.json());
    if(!out.ok)throw new Error(out.error);
    if(!out.models.length)throw new Error('scheda senza modi utilizzabili (es. solo canali matrice)');
    showModelCandidates(out.models,{title:`${r.vendor} ${r.name}`,from:r.src==='ofl'?'da Open Fixture Library':'da DMXControl',backLabel:'← Libreria',
      back:()=>openFixtureLibrary(back),
      hint:`${out.models.length>1?'Un modello per ogni modo DMX della luce: scegli quello impostato sulla luce vera. ':''}"Prepara modello" apre l'editor già compilato: controlla e premi "Crea su DMX Master".`})}
  catch(e){btn.disabled=false;btn.textContent='Apri';showError('Libreria fixture: '+e.message)}
}
