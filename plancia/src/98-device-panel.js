/* ---------- pannello device TD (tddevice): sezioni ed etichette ---------- */
// Prima: tutti i servizi e ~90 parametri in un elenco unico. Ora sezioni
// apribili: per DMX Master una per rig (Front, Back, LED bar...), Show e
// generale, Teste, PTZ, Sorgenti audio; per gli altri device per prefisso.
// I servizi delicati (patch, file audio, simulazione, scan...) in "Avanzate".
const DV_OPEN=new Map(); // widget|sezione -> aperta (in memoria)
const DV_RISKY=/(patch_enable|use_file_input|simulate|scan|groups_strict|store_preset|apply_fixture_profile|rewind)$/;
const DV_IT={level:'Livello',min_dimmer:'Dimmer minimo',max_dimmer:'Dimmer massimo',dimmer_boost:'Boost dimmer',dimmer_gamma:'Gamma dimmer',
  smooth_factor:'Morbidezza',color_curve:'Curva colore',color_fade:'Dissolvenza colore',color_speed:'Velocità colore',color_phase:'Fase colore',
  bar_phase:'Fase barre',global_smooth:'Morbidezza globale',agc_release:'Rilascio AGC',min_range:'Range minimo',kick_threshold:'Soglia kick',
  kick_boost:'Boost kick',kick_decay:'Decadimento kick',kick_cooldown:'Pausa tra kick',kick_smooth:'Morbidezza kick',audio_amount:'Quanto segue la musica',
  palette:'Palette',audio_source:'Sorgente audio',kick_enable:'Kick',patch_enable:'Uscita DMX (patch)',use_file_input:'Audio da file',
  gain:'Guadagno',bass_cutoff:'Taglio bassi (Hz)',mid_low:'Medi da (Hz)',mid_high:'Medi fino a (Hz)',high_cutoff:'Taglio alti (Hz)',
  bass_gain:'Guadagno bassi',mid_gain:'Guadagno medi',high_gain:'Guadagno alti',type:'Tipo',sender:'Mittente',driver:'Driver',device:'Scheda',
  active:'Attiva',fan:'Ventola',speed:'Velocità',smooth:'Morbidezza',mode:'Modo',home:'Home',invert_pan:'Inverti pan',invert_tilt:'Inverti tilt',
  mirror:'Specchio',shutter_open:'Shutter aperto',blackout:'Blackout',output:'Uscita DMX',loop:'Loop',play:'Play',custom_color1:'Colore custom 1',
  custom_color2:'Colore custom 2',custom_color3:'Colore custom 3',custom_color4:'Colore custom 4',custom_color5:'Colore custom 5',time:'Tempo (s)',length:'Durata (s)'};
const dvLabel=suffix=>DV_IT[suffix]||suffix.replace(/_/g,' ');
function dvRigTitle(rig){
  const g=(L.groups||[]).find(x=>x.bind===`rig_${rig}`||x.group===rig);
  const fallback={a:'Front (rig A)',b:'Back (rig B)',ledbar:'LED bar',haze:'Haze',blinder:'Blinder',side:'Side',truss:'Truss'}[rig]||rig,lab=g?groupLabel(g.group):'';
  return lab&&lab!==rig?lab:fallback;
}
function tdDeviceSections(id,ps,sv){
  const rigOrder=Object.keys(G.dxm?.[id]?.rigs||{}),rigs=[...rigOrder].sort((a,b)=>b.length-a.length),secs=new Map();
  const sec=(key,title,order)=>{if(!secs.has(key))secs.set(key,{key,title,order,svc:[],params:[],adv:key==='adv',strip:''});return secs.get(key)};
  const place=name=>{
    for(const r of rigs){const pre=`dmx_${r}_`;if(name.startsWith(pre))return[`rig_${r}`,dvRigTitle(r),10+rigOrder.indexOf(r),name.slice(pre.length)]}
    let m=/^audio_([a-z])_(.+)$/.exec(name);if(m)return[`src_${m[1]}`,`Sorgente audio ${m[1].toUpperCase()}`,80,m[2]];
    m=/^(heads|ptz|show)_(.+)$/.exec(name);if(m)return[m[1],{heads:'Teste mobili',ptz:'PTZ (posizioni teste)',show:'Show e generale'}[m[1]],{heads:60,ptz:70,show:0}[m[1]],m[2]];
    m=/^dmx_(.+)$/.exec(name);if(m&&rigs.length)return['show','Show e generale',0,m[1]];
    if(rigs.length)return['altro','Altro',90,name];
    const tok=name.split('_')[0];return[`p_${tok}`,tok.toUpperCase(),50,name]; // altri device: per prefisso
  };
  for(const k of sv){
    const [key,title,order,suffix]=place(k),label=rigs.length?dvLabel(suffix):k.replace(/_/g,' ');
    // delicati: in Avanzate, col nome della sezione a cui appartengono
    if(DV_RISKY.test(k))sec('adv','Avanzate',100).svc.push({k,label:`${title} · ${label}`});
    else sec(key,title,order).svc.push({k,label});
  }
  for(const p of ps){const [key,title,order,suffix]=place(p.n);sec(key,title,order).params.push({...p,label:rigs.length?dvLabel(suffix):p.label})}
  // device non DMX: i prefissi con un solo elemento finiscono in "Generale"
  if(!rigs.length){const gen=sec('gen','Generale',1);for(const s of [...secs.values()])if(s.key.startsWith('p_')&&s.svc.length+s.params.length<2){gen.svc.push(...s.svc);gen.params.push(...s.params);secs.delete(s.key)}if(!gen.svc.length&&!gen.params.length)secs.delete('gen')}
  return[...secs.values()].sort((a,b)=>a.order-b.order||a.title.localeCompare(b.title));
}
