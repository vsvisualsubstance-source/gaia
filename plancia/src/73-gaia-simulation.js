/* ---------- simulazione: dati d'esempio quando il broker non è raggiungibile (es. anteprima) ---------- */
const SIM_THOUGHTS=['In ingresso le piante hanno suonato per quasi tutto il pomeriggio.','Lo studio è silenzioso da un’ora. Mi piace questa luce bassa.',
  'Oggi ho imparato una parola nuova: «riverbero».','Due persone in salotto, il mood si sta scaldando.','Stanotte sognerò colori viola, credo.'];
function gSim(){
  if(G.ok||G.sim)return;G.sim=true;const t=Date.now(),svc={},pm={};
  for(const d of['a','b']){for(let n=1;n<=38;n++){const k=`load_x${n}_${d}`;svc[k]=n===(d==='a'?7:15)?'active':'inactive';pm[k]={kind:'load_patch',patch:n,deck:d.toUpperCase()}}
    svc['deck_'+d]=d==='a'?'active':'inactive';pm['deck_'+d]={kind:'deck_toggle',deck:d.toUpperCase()}}
  svc.audio_reactive='active';svc.ndi_out='inactive';
  G.pdm['PatchDeck-Win-MSI']={device_id:'PatchDeck-Win-MSI',services:pm,fx_params:{edge:{label:'Edge',min:0,max:1},blur:{label:'Blur',min:0,max:1},feedback:{label:'Feedback',min:0,max:1},rgb_split:{label:'RGB split',min:0,max:1},kaleido:{label:'Kaleido',min:0,max:1}}};
  G.devices['PatchDeck-Win-MSI']={device_id:'PatchDeck-Win-MSI',name:'PatchDeck V8',family:'patchdeck',role:'touchdesigner',stanza:'studio',services:svc,params:{edge:.2,blur:.1,feedback:.45,rgb_split:0,kaleido:.3},ts:t};
  G.devices['td-controller-macmauro']={device_id:'td-controller-macmauro',name:'Controller V8',family:'mixeraudio',role:'touchdesigner',stanza:'studio',services:{audio_in:'active',limiter:'active',record:'inactive'},params:{ch1_gain:.8,ch2_gain:.65,ch3_gain:.5,ch4_gain:.7,master:.85},ts:t};
  const dmxPalettes=['Rainbow (Daslight)','Warm','Cool','Fire','Fire Inverted','Ocean','Magenta-Cyan','Plasma','Basic','Basic 2','Neon Party','Sunset','Forest','Deep Purple','Red','Blue','Yellow','Amber','Custom'];
  G.dxm['td-dmx-win']={device_id:'td-dmx-win',params:{dmx_min_dimmer:{type:'float',range:[0,1]},dmx_max_dimmer:{type:'float',range:[0,1]},dmx_kick_threshold:{type:'float',range:[0,1]},dmx_kick_boost:{type:'float',range:[0,2]},dmx_color_speed:{type:'float',range:[0,4]},dmx_a_palette:{type:'menu',options:dmxPalettes},dmx_b_palette:{type:'menu',options:dmxPalettes},dmx_a_fixture_profile:{type:'menu',options:['ZQ006018 4CH RGBW','ZQ006018 8CH','RGB 3CH','D+RGB 4CH','D+RGBW 5CH','RGBWA+UV 6CH','D+RGBW+S+M 7CH']},audio_a_type:{type:'menu',options:['device','touch_audio','touch_bands']}},
    services:{dmx_output:{kind:'toggle'},dmx_kick_enable:{kind:'toggle'},dmx_audio_enable:{kind:'toggle'}}};
  G.devices['td-dmx-win']={device_id:'td-dmx-win',name:'DMX V8',family:'dmx',role:'touchdesigner',stanza:'studio',services:{dmx_output:'active',dmx_kick_enable:'active',dmx_audio_enable:'active'},
    params:{dmx_min_dimmer:.05,dmx_max_dimmer:.95,dmx_kick_threshold:.55,dmx_kick_boost:1.2,dmx_color_speed:1.4,dmx_a_palette:'Basic 2',dmx_b_palette:'Warm',dmx_a_fixture_profile:'RGB 3CH',audio_a_type:'touch_bands'},ts:t};
  const pr={Warm:[255,160,60],Cool:[60,140,255],Fire:[255,60,0],Ocean:[0,120,180],Forest:[20,160,60],Sunset:[255,90,40],Magenta:[220,0,180],White:[255,255,255],Off:[0,0,0]};
  G.dmx.ingresso={device_id:'pi-dmx-ingresso',stanza:'ingresso',artnet_configured:true,palettes:Object.keys(pr),palettes_rgb:pr,timeline_presets:{Arcobaleno:{},Lampeggio:{},Respiro:{}},default_fixture:'par1',
    fixtures:{par1:{current_palette:'Warm',output_rgb:[255,160,60],brightness:.8,audio_reactive:false,timeline_running:false,current_timeline_preset:null}},audio_level:.2,ts:t};
  G.canvas={soul:{mood:'curiosity',mood_rgb:{r:190,g:135,b:255},stress:.18,calm:.52,social:.41,curiosity:.72,energy:64,lifeIndex:78},thought:SIM_THOUGHTS[0]};
  G.chat=[{who:'gaia',text:'Buonasera. Sono in simulazione: collegami al broker di Core per parlare davvero.',room:'studio',ts:t-90000}];G.chatV++;
  gStatus();G.dirty=true;
}
function gSimOff(){G.sim=false;G.devices={};G.pdm={};G.dxm={};G.dmx={};G.canvas=null;G.brain=null;G.chat=[];G.chatV++;G.dirty=true}
function simMood(){const s=G.canvas.soul,k=['stress','calm','social','curiosity'].reduce((a,b)=>(s[b]>s[a]?b:a));s.mood=k;const c=MOOD_INKS[k];s.mood_rgb={r:c[0],g:c[1],b:c[2]}}
function simCmd(topic,o){
  let m=topic.match(/^gaia\/device\/([^/]+)\/command$/);
  if(m){const id=m[1],d=G.devices[id];if(!d)return;
    if(o.action==='set')(d.params=d.params||{})[o.param]=o.value;
    else if(o.action==='enable'||o.action==='disable'){const pm=G.pdm[id]?.services||{},k=pm[o.service];
      if(k?.kind==='load_patch'&&o.action==='enable')for(const[x,s]of Object.entries(pm))if(s.kind==='load_patch'&&s.deck===k.deck)d.services[x]='inactive';
      d.services[o.service]=o.action==='enable'?'active':'inactive'}
    d.ts=Date.now();return}
  m=topic.match(/^gaia\/dmx\/([^/]+)\/command$/);
  if(m){const s=G.dmx[m[1]],f=s?.fixtures[o.fixture||s.default_fixture];if(!f)return;
    switch(o.action){case 'set_palette':f.current_palette=o.palette;f.output_rgb=s.palettes_rgb[o.palette];f.timeline_running=false;break;
      case 'blackout':f.output_rgb=[0,0,0];f.current_palette=null;f.timeline_running=false;break;
      case 'set_brightness':f.brightness=o.value;break;case 'timeline_load':f.current_timeline_preset=o.name;break;
      case 'timeline_start':f.timeline_running=true;break;case 'timeline_stop':f.timeline_running=false;break;
      case 'audio_reactive_start':f.audio_reactive=true;break;case 'audio_reactive_stop':f.audio_reactive=false;break}
    s.ts=Date.now();return}
  if(topic.startsWith('gaia/touchdesigner/mood/')&&G.canvas){const k=topic.split('/').pop(),s=G.canvas.soul;s[k]=clamp((+s[k]||0)+(+o),0,k==='energy'?100:1);simMood();return}
  if(topic.startsWith('gaia/voice/command/'))setTimeout(()=>{if(!G.sim)return;gChat('gaia',`Ho sentito «${o.text}». In simulazione non posso risponderti davvero: collegami al broker di Core.`,GC.stanza)},1100);
}
let simT=0;
function simTick(n){
  if(!G.sim||n-simT<1000)return;simT=n;const s=G.dmx.ingresso;
  if(s){s.audio_level=clamp(.25+.5*Math.random()*(Math.sin(n/700)+1)/2);const f=s.fixtures.par1;
    if(f.timeline_running){const names=Object.keys(s.palettes_rgb).filter(x=>x!=='Off');const nm=names[Math.floor(n/2500)%names.length];f.output_rgb=s.palettes_rgb[nm];f.current_palette=null}}
  if(G.canvas&&Math.floor(n/15000)!==G.canvas._k){G.canvas._k=Math.floor(n/15000);G.canvas.thought=SIM_THOUGHTS[G.canvas._k%SIM_THOUGHTS.length]}
  G.dirty=true;
}
