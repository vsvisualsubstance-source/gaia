/* ---------- effetti sulle luci: formato, template, calcolo per l'anteprima ---------- */
// Li esegue DMX Master (nota TD/Win-PD 59): onde di dimmer, colore, bianco o
// strobo che scorrono sulle luci di un gruppo, sopra al look della scena. Qui
// solo la stessa matematica per l'anteprima (forme, fase, specchio). Anche
// modulo Node per i test.
//
// Effetto (L.lightFx[]):
//   {id, name, target: {group} | {fixtures: [uid...]}, channel: dimmer|color|white|strobe,
//    shape: sine|triangle|saw|square|pulse|random, period: {value, unit: beats|s},
//    spread: {phase, mirror}, min, max, colors: [[r,g,b]...] | palette: <nome>, duty}
const FX_CHANNELS=[['dimmer','Dimmer (intensità)'],['color','Colore'],['white','Bianco'],['strobe','Strobo (dimmer a scatti)']];
const FX_SHAPES=[['sine','Onda morbida'],['triangle','Triangolo'],['saw','Dente di sega'],['square','Quadra'],['pulse','Impulso (colpo e discesa)'],['random','Casuale (scintillio)']];
const fxPeriod=(fx,bpm)=>{const v=+fx?.period?.value||4;return Math.max(.05,fx?.period?.unit==='s'?v:v*60/(bpm>0?bpm:120))};
// numero pseudo-casuale stabile per (luce, ciclo): l'anteprima non sfarfalla a ogni frame
function fxRand(k,c){let h=(k*73856093)^(c*19349663);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296}
// onda w 0..1 di una luce: u = frazione del suo ciclo, c = numero del ciclo (per random)
function fxWave(fx,u,k=0,c=0){
  const duty=fx.duty;
  switch(fx.shape||(fx.channel==='strobe'?'square':'sine')){
    case'triangle':return 1-Math.abs(2*u-1);
    case'saw':return u;
    case'square':return u<(duty??.5)?1:0;
    case'pulse':return Math.max(0,1-u/(duty??.25));
    case'random':return fxRand(k,c)<(duty??1)?fxRand(k+977,c):0;
    default:return(1-Math.cos(2*Math.PI*u))/2;
  }
}
// valori delle n luci al tempo t: [{w, rgb}] (rgb solo per channel color)
function fxSample(fx,t,n,bpm=120,paletteColors=null){
  const P=fxPeriod(fx,bpm),sp=fx.spread||{},mn=+(fx.min??0),mx=+(fx.max??1),out=[];
  const cols=(Array.isArray(fx.colors)&&fx.colors.length?fx.colors:paletteColors)||[[1,0,0],[0,0,1]];
  for(let k=0;k<n;k++){
    const kk=sp.mirror?Math.abs(k-(n-1)/2):k,x=t/P+kk*(+sp.phase||0),c=Math.floor(x),u=x-c,w=fxWave(fx,u,k,c);
    let rgb=null;
    if(fx.channel==='color'){
      const sh=fx.shape||'sine';
      if(sh==='random')rgb=cols[Math.floor(fxRand(k+31,c)*cols.length)%cols.length];
      else if(sh==='saw'){const f=u*cols.length,i=Math.floor(f)%cols.length,j=(i+1)%cols.length,a=f-Math.floor(f);rgb=cols[i].map((v,m)=>v+(cols[j][m]-v)*a)}
      else{const f=w*(cols.length-1),i=Math.min(cols.length-2,Math.floor(f)),a=f-i;rgb=cols.length<2?cols[0]:cols[i].map((v,m)=>v+(cols[i+1][m]-v)*a)}
    }
    out.push({w:mn+(mx-mn)*w,rgb});
  }
  return out;
}
function fxTemplates(group='front'){
  const T=(id,name,o)=>({id:'fx-'+id,name,template:true,target:{group},channel:'dimmer',shape:'sine',period:{value:4,unit:'beats'},spread:{phase:.25,mirror:false},min:0,max:1,...o});
  return[
    T('onda','Onda di dimmer',{}),
    T('inseguimento','Inseguimento',{shape:'pulse',duty:.3,period:{value:2,unit:'beats'},spread:{phase:.25,mirror:false}}),
    T('centro','Dal centro',{shape:'sine',spread:{phase:.2,mirror:true}}),
    T('respiro','Respiro',{period:{value:8,unit:'beats'},spread:{phase:0,mirror:false},min:.3}),
    T('scintillio','Scintillio',{shape:'random',duty:.35,period:{value:.25,unit:'beats'},spread:{phase:0,mirror:false}}),
    T('strobo','Strobo a tempo',{channel:'strobe',shape:'square',duty:.2,period:{value:.5,unit:'beats'},spread:{phase:0,mirror:false}}),
    T('arcobaleno','Arcobaleno che scorre',{channel:'color',shape:'saw',period:{value:8,unit:'beats'},spread:{phase:.15,mirror:false},colors:[[1,0,0],[1,1,0],[0,1,0],[0,1,1],[0,0,1],[1,0,1]]}),
    T('due-colori','Due colori alternati',{channel:'color',shape:'square',period:{value:2,unit:'beats'},spread:{phase:.5,mirror:false},colors:[[1,0,.4],[0,.6,1]]})
  ];
}
if(typeof module==='object'&&module.exports){module.exports={fxPeriod,fxWave,fxSample,fxTemplates,FX_CHANNELS,FX_SHAPES}}
