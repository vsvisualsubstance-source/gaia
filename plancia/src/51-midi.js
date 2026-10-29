/* ---------- MIDI in ingresso: impara, azioni, porte ---------- */
// I comandi MIDI li esegue il bridge (midi-in.js), una volta sola e anche a
// tablet chiusi: qui si vedono le porte, si "impara" una mappatura (prossimo
// messaggio MIDI) e si mostra cosa arriva. Mappature nel layout condiviso:
// w.midi = {ch, cc} o {ch, note} per fader/manopole/pulsanti,
// L.midiActions = {panic, go, back}.
let MIDI_PORTS=[],MIDI_LEARN=null;
const MIDI_ACTIONS=[
  ['panic','PANIC','blackout luci (/dmx/blackout 1) e laser'],
  ['go','GO','cue successiva della timeline dello show'],
  ['back','BACK','cue precedente']];
const midiMapText=map=>!map||((map.cc===''||map.cc==null)&&map.note==null)?'nessuno':
  `${map.note!=null?'Nota '+map.note:'CC '+map.cc} · canale ${map.ch||1}`;

// prossimo messaggio MIDI -> fn(m); 15 s per muovere il controllo
function midiLearn(label,fn){
  if(!MIDI_PORTS.length&&!confirm('Il bridge non vede nessuna porta MIDI in ingresso.\nCollega il controller (o avvia rtpMIDI) e riprova, oppure aspetta comunque?'))return;
  clearTimeout(MIDI_LEARN?.timer);
  MIDI_LEARN={fn,timer:setTimeout(()=>{MIDI_LEARN=null;showError('Impara MIDI: nessun messaggio in 15 s.')},15000)};
  showInfo(`Impara MIDI · ${label}: muovi il fader o premi il tasto sul controller…`);
}
// messaggio grezzo dal bridge: {port, kind:'cc'|'note', ch, n, v, on}
function midiFromBridge(m){
  log('in',{address:`MIDI ${m.kind==='cc'?'CC':'nota'} ${m.n} · ch ${m.ch}`,args:[m.v]});
  if(!MIDI_LEARN||(m.kind==='note'&&!m.on))return;   // si impara alla pressione, non al rilascio
  const{fn,timer}=MIDI_LEARN;
  if(fn(m)===false)return;   // messaggio non adatto: si continua ad aspettare
  clearTimeout(timer);MIDI_LEARN=null;
}
const midiMapOf=m=>m.kind==='cc'?{ch:m.ch,cc:m.n}:{ch:m.ch,cc:'',note:m.n};

// ispettore: riga sotto canale/CC (fader, manopole, pulsanti)
const midiLearnHtml=w=>`<div class="row"><button class="btn sm" id="fMidiLearn" title="Prossimo messaggio MIDI in ingresso">🎹 Impara MIDI</button>
  <span class="hint" id="fMidiMap">Ingresso: ${esc(midiMapText(w.midi))}</span></div>`;
function bindMidiLearn(w){
  const b=$('#fMidiLearn');if(!b)return;
  b.onclick=()=>midiLearn(w.label||NAMES[w.type],m=>{
    if(m.kind==='note'&&w.type!=='button'){showError('Fader e manopole seguono un CC: muovi un fader o una manopola del controller.');return false}
    w.midi=midiMapOf(m);   // vale anche per l'uscita MIDI CC del widget, come prima
    save();renderInsp();showInfo(`${w.label||NAMES[w.type]}: ${midiMapText(w.midi)}.`);
  });
}

// impostazioni: porte viste dal bridge e azioni globali
function midiSettingsSection(){
  const acts=L.midiActions||{};
  return`<section><h3 style="font-size:14px">MIDI in ingresso</h3>
    <p class="note">Porte viste dal bridge: <b>${MIDI_PORTS.length?MIDI_PORTS.map(esc).join(', '):'nessuna'}</b>. Un controller USB collegato dopo compare da solo. Per il MIDI in rete installa <b>rtpMIDI</b> su OPS (su macOS c'è già: Configurazione MIDI Audio → Rete). I comandi li esegue il bridge su OPS: funzionano anche con i tablet chiusi.</p>
    <div class="midi-acts">${MIDI_ACTIONS.map(([k,label,desc])=>`<div class="row midi-act"><b>${label}</b><span class="hint">${esc(desc)} · <span data-midi-map="${k}">${esc(midiMapText(acts[k]))}</span></span>
      <button class="btn sm" data-midi-learn="${k}">🎹 Impara</button><button class="btn sm ghost" data-midi-clear="${k}" title="Togli la mappatura"${acts[k]?'':' disabled'}>×</button></div>`).join('')}</div>
    <p class="note">Fader, manopole e pulsanti si mappano dal loro ispettore (Modifica griglia → 🎹 Impara MIDI). Un pulsante può usare anche una nota (pad, pedale).</p>
  </section>`;
}
function bindMidiSettings(s){
  const show=k=>{const n=s.querySelector(`[data-midi-map="${k}"]`);if(n)n.textContent=midiMapText((L.midiActions||{})[k]);
    const c=s.querySelector(`[data-midi-clear="${k}"]`);if(c)c.disabled=!(L.midiActions||{})[k]};
  s.querySelectorAll('[data-midi-learn]').forEach(b=>b.onclick=()=>{const k=b.dataset.midiLearn,label=MIDI_ACTIONS.find(a=>a[0]===k)[1];
    midiLearn(label,m=>{L.midiActions={...(L.midiActions||{}),[k]:midiMapOf(m)};save();show(k);showInfo(`${label}: ${midiMapText(L.midiActions[k])}.`)})});
  s.querySelectorAll('[data-midi-clear]').forEach(b=>b.onclick=()=>{const k=b.dataset.midiClear;
    if(L.midiActions){delete L.midiActions[k];save()}show(k)});
}
