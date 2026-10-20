const DMX_OUTPUT={
  source:'unknown',sourceAt:0,lastAt:0,deviceId:null,seq:null,master:null,blackout:null,strobe:null,scene:null,
  fixtures:new Map()
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
    pan:dmxNumber(f.pan),tilt:dmxNumber(f.tilt),gobo:dmxNumber(f.gobo),
    colorWheel:dmxNumber(f.color_wheel),shutter:dmxNumber(f.shutter),receivedAt
  };
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

if(typeof module==='object'&&module.exports){
  module.exports={DMX_OUTPUT,dmxOutputApplySnapshot,dmxOutputApplySource,dmxOutputApplyOsc,dmxOutputFresh,dmxOutputForFixture,dmxOutputSummary};
}
