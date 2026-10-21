const DMX_OUTPUT={
  source:'unknown',sourceAt:0,lastAt:0,deviceId:null,seq:null,master:null,blackout:null,strobe:null,scene:null,
  fixtures:new Map(),rigs:{}
};
const dmxNumber=value=>value==null||value===''||!Number.isFinite(+value)?null:+value;
const dmxUnit=value=>{const n=dmxNumber(value);return n==null||n<0?null:Math.max(0,Math.min(1,n))};
function dmxFixtureRecord(f,receivedAt){
  if(!f||typeof f!=='object')return null;
  const uid=String(f.uid??'');
  const id=dmxNumber(f.id);
  const key=uid|| (id==null?'':`id${id}`);
  if(!key)return null;
  const rgb=Array.isArray(f.rgb_out)&&f.rgb_out.length>=3?f.rgb_out.slice(0,3).map(dmxUnit):null;
  return{
    key,uid,id,sent:f.sent===true,intensity:dmxUnit(f.intensity),rgbOut:rgb&&rgb.every(v=>v!=null)?rgb:null,
    group:f.group==null?null:String(f.group),colorSource:f.color_source??null,
    pan:dmxNumber(f.pan),tilt:dmxNumber(f.tilt),gobo:dmxNumber(f.gobo),
    colorWheel:dmxNumber(f.color_wheel),shutter:dmxNumber(f.shutter),
    // audio della luce (solo rig chase, nota TD 45): full|off|bass|mid|high|kick, guadagno 0..2
    audio:typeof f.audio==='string'?(f.audio||'full'):null,audioGain:dmxNumber(f.audio_gain),receivedAt
  };
}
// misura dal vivo per rig (nota TD 45): {rig_a:{level,kicks,amount,kick_enable}}.
// kicks e' un contatore che riparte da 0 col motore: kick = "diverso da prima".
function dmxRigMeters(raw,prev,receivedAt){
  const out={};
  if(!raw||typeof raw!=='object')return out;
  for(const[key,r]of Object.entries(raw)){
    if(!r||typeof r!=='object')continue;
    const kicks=dmxNumber(r.kicks),old=prev?.[key];
    out[key]={level:dmxUnit(r.level),kicks,amount:dmxUnit(r.amount),kickEnable:typeof r.kick_enable==='boolean'?r.kick_enable:null,
      kickAt:old&&kicks!=null&&old.kicks!=null&&kicks!==old.kicks?receivedAt:old?.kickAt||0};
  }
  return out;
}
function dmxOutputApplySnapshot(payload,deviceId,receivedAt=Date.now()){
  if(!payload||typeof payload!=='object'||payload.v!==1||!Array.isArray(payload.fixtures))return false;
  const fixtures=new Map();
  for(const fixture of payload.fixtures){
    const record=dmxFixtureRecord(fixture,receivedAt);
    if(record)fixtures.set(record.key,record);
  }
  DMX_OUTPUT.source='mqtt';DMX_OUTPUT.sourceAt=receivedAt;DMX_OUTPUT.lastAt=receivedAt;
  DMX_OUTPUT.deviceId=String(payload.device_id||deviceId||'');
  DMX_OUTPUT.seq=dmxNumber(payload.seq);
  DMX_OUTPUT.master=dmxUnit(payload.master);
  DMX_OUTPUT.blackout=typeof payload.blackout==='boolean'?payload.blackout:null;
  DMX_OUTPUT.strobe=typeof payload.strobe==='boolean'?payload.strobe:null;
  DMX_OUTPUT.scene=payload.scene??null;
  DMX_OUTPUT.fixtures=fixtures;
  DMX_OUTPUT.rigs=dmxRigMeters(payload.rigs,DMX_OUTPUT.rigs,receivedAt);
  return true;
}
function dmxOutputApplySource(args,receivedAt=Date.now()){
  const source=args?.[0];
  if(source!=='mqtt'&&source!=='osc')return false;
  if(DMX_OUTPUT.source!==source){DMX_OUTPUT.fixtures=new Map();DMX_OUTPUT.lastAt=0}
  DMX_OUTPUT.source=source;DMX_OUTPUT.sourceAt=receivedAt;
  return true;
}
function dmxOutputApplyOsc(address,args,receivedAt=Date.now()){
  if(address==='/dmx/output/source')return dmxOutputApplySource(args,receivedAt);
  if(typeof address!=='string'||!Array.isArray(args))return false;
  const match=address.match(/^\/dmx\/fixture\/([^/]+)(\/head)?$/);
  if(!match)return false;
  const key=match[1],head=!!match[2],old=DMX_OUTPUT.fixtures.get(key)||{
    key,uid:key,id:key.startsWith('id')?dmxNumber(key.slice(2)):null,sent:false,intensity:null,rgbOut:null,
    pan:null,tilt:null,gobo:null,colorWheel:null,shutter:null,receivedAt
  };
  const next={...old,receivedAt};
  if(head){
    if(args.length<5)return false;
    [next.pan,next.tilt,next.gobo,next.colorWheel,next.shutter]=args.slice(0,5).map(v=>{
      const n=dmxNumber(v);return n==null||n<0?null:n;
    });
  }else{
    if(args.length<5)return false;
    next.sent=+args[0]>.5;
    next.intensity=dmxUnit(args[1]);
    const rgb=args.slice(2,5).map(dmxUnit);
    next.rgbOut=rgb.every(v=>v!=null)?rgb:null;
  }
  DMX_OUTPUT.fixtures.set(key,next);
  DMX_OUTPUT.source='osc';DMX_OUTPUT.sourceAt=receivedAt;DMX_OUTPUT.lastAt=receivedAt;
  return true;
}
function dmxOutputFresh(at=Date.now()){
  const timeout=DMX_OUTPUT.source==='osc'?12000:6000;
  return DMX_OUTPUT.source!=='unknown'&&DMX_OUTPUT.lastAt>0&&at-DMX_OUTPUT.lastAt<=timeout;
}
function dmxOutputForFixture(fixture){
  if(!fixture)return null;
  const keys=[fixture.uid,fixture.id].filter(v=>v!=null).map(String);
  for(const key of keys){
    const found=DMX_OUTPUT.fixtures.get(key);
    if(found)return found;
  }
  for(const found of DMX_OUTPUT.fixtures.values()){
    if(fixture.id!=null&&found.id!=null&&String(fixture.id)===String(found.id))return found;
  }
  return null;
}
function dmxOutputSummary(at=Date.now()){
  if(!dmxOutputFresh(at))return'DMX feedback · stale / offline';
  const sent=[...DMX_OUTPUT.fixtures.values()].filter(f=>f.sent).length;
  return`DMX feedback · ${DMX_OUTPUT.source.toUpperCase()} · ${sent}/${DMX_OUTPUT.fixtures.size} fixture inviate`;
}

// ── Colori e scene reali di DMX Master (note TD/Win-PD 28, 33, 34) ─────
// Pan/tilt di dmx_output sono gradi: in unita' del Render (-1..1, stesso
// verso della nota 30) dividendo per meta' escursione del modello del
// catalogo (pan_range/tilt_range, default 540/270 come i generici TD).
function dmxHeadAngles(record,model){
  if(!record||record.pan==null||record.tilt==null)return null;
  const half=(v,d)=>Math.max(1,(Number.isFinite(+v)&&+v>0?+v:d)/2),c=v=>Math.max(-1,Math.min(1,v));
  return[c(record.pan/half(model?.pan_range,540)),c(record.tilt/half(model?.tilt_range,270))];
}
// Tinta reale di un gruppo TD (rig_a, rig_b, ledbar...): media degli
// rgb_out delle sue fixture inviate, normalizzata a luminosita' piena (e'
// un campione di colore, non un livello). null = gruppo buio o sconosciuto.
// groupOf: uid -> gruppo, per la riserva OSC che il gruppo non lo porta.
function dmxGroupColor(group,groupOf=null,fixtures=DMX_OUTPUT.fixtures){
  const sum=[0,0,0];let n=0;
  for(const f of fixtures.values()){
    const g=f.group||(groupOf&&groupOf(f.uid))||null;
    if(g!==group||!f.sent||!f.rgbOut)continue;
    f.rgbOut.forEach((v,i)=>sum[i]+=v);n++;
  }
  const max=Math.max(...sum);
  return n&&max>.004?sum.map(v=>v/max):null;
}
// dmx_a_palette -> rig_a, dmx_b_palette -> rig_b, dmx_<gruppo>_palette -> gruppo
function dmxPaletteGroup(param){
  const m=/^dmx_(.+)_palette$/.exec(String(param||''));
  return m?({a:'rig_a',b:'rig_b'}[m[1]]||m[1]):null;
}
// Scene di TD: show_scene_catalog [{id,index,label}], index = /dmx/scene.
function tdSceneList(params){
  const c=params?.show_scene_catalog;
  return Array.isArray(c)?c.filter(s=>s&&s.id!=null&&Number.isFinite(+s.index)).sort((a,b)=>a.index-b.index):[];
}
function tdActiveScene(params,output=DMX_OUTPUT){
  const a=output?.scene??params?.show_active_scene;
  const index=dmxNumber(a&&typeof a==='object'?a.index:a);
  return index==null?null:{index,id:a&&typeof a==='object'?a.scene??null:null};
}

// ── Colori di palette e scene (nota TD/Win-PD 37) ──────────────────────
// dmx_matrix.rigs.<a|b|ledbar>.params.dmx_palette = {options, colors:
// {"Warm": [[r,g,b]...]}, stepped: ["Basic 2"]}: i colori nell'ordine in
// cui il rig li fa girare (0-1). "Custom" non c'e': sono i
// dmx_<rig>_custom_color1..5 dello status.
const dmxHex=c=>'#'+c.slice(0,3).map(v=>Math.round(Math.max(0,Math.min(1,+v||0))*255).toString(16).padStart(2,'0')).join('');
function dmxPaletteColors(matrix,param){
  const m=/^dmx_(.+)_palette$/.exec(String(param||'')),p=m?matrix?.rigs?.[m[1]]?.params?.dmx_palette:null;
  if(!p||!p.colors||typeof p.colors!=='object')return null;
  return{colors:p.colors,stepped:new Set(Array.isArray(p.stepped)?p.stepped:[])};
}
// CSS linear-gradient per segmenti affiancati [colori, stepped]: dentro un
// segmento sfuma (o salta, se stepped); tra segmenti il bordo e' netto.
function dmxGradient(segments){
  const segs=(segments||[]).filter(s=>Array.isArray(s?.[0])&&s[0].some(Array.isArray));
  if(!segs.length)return'';
  const stops=[],pc=v=>`${+v.toFixed(2)}%`;
  segs.forEach(([raw,stepped],k)=>{
    const cols=raw.filter(Array.isArray),a=k*100/segs.length,w=100/segs.length;
    if(cols.length===1||stepped)cols.forEach((c,i)=>stops.push(`${dmxHex(c)} ${pc(a+w*i/cols.length)}`,`${dmxHex(c)} ${pc(a+w*(i+1)/cols.length)}`));
    else cols.forEach((c,i)=>stops.push(`${dmxHex(c)} ${pc(a+w*i/(cols.length-1))}`));
  });
  return`linear-gradient(90deg,${stops.join(',')})`;
}
// Anteprima di una scena di TD (show_scene_catalog[].preview): front |
// back, ognuno con i colori della palette salvata nella scena.
// Dalla nota 38 la preview ha ogni rig della scena (ledbar, rig creati;
// haze/blinder solo con "level", senza colori): front, back, poi gli altri.
function tdScenePreview(scene,stepped=new Set()){
  const p=scene?.preview;if(!p||typeof p!=='object')return[];
  const keys=['rig_a','rig_b',...Object.keys(p).filter(k=>!['rig_a','rig_b','heads'].includes(k)).sort()];
  return keys.map(k=>p[k]).filter(r=>Array.isArray(r?.colors)&&r.colors.length).map(r=>[r.colors,stepped.has(r.palette)]);
}
// Parametri quick patch dei rig: mai offerti come controlli (nota TD 38)
const DMX_QUICK_PATCH=['fixture_count','start_address','output_port','fixture_profile'];

if(typeof module==='object'&&module.exports){
  module.exports={DMX_OUTPUT,dmxRigMeters,dmxOutputApplySnapshot,dmxOutputApplySource,dmxOutputApplyOsc,dmxOutputFresh,dmxOutputForFixture,dmxOutputSummary,
    dmxHeadAngles,dmxGroupColor,dmxPaletteGroup,tdSceneList,tdActiveScene,dmxHex,dmxPaletteColors,dmxGradient,tdScenePreview,DMX_QUICK_PATCH};
}
