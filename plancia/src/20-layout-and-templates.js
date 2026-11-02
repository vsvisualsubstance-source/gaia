// Laser: i LaserCube WiFi attraverso il laser gateway di OPS (ops/laser).
TPL.laser={name:'Laser',desc:'LaserCube: modalità per cubo (Show, PatchDeck, Yolo), ARM, blackout, zona di sicurezza.',pages:()=>[P('Laser',[
  W('laser',0,0,16,10,{label:'Laser · LaserCube',color:SWATCH[2]})])]};
// Motion: nuova area di composizione per scene di movimento, teste mobili e timeline condivisa.
TPL.motion={name:'Scene e movimento',desc:'Scene laser, teste mobili e motion timing in una sola area di composizione.',pages:()=>[P('Scene motion',[
  W('laser',0,0,8,6,{label:'Scene laser',color:SWATCH[2]}),
  W('scenes',8,0,8,6,{label:'Teste mobili',addr:'/mh/select/heads',mode:'head-select',items:'',headValues:[],selectedHeads:[],value:[],cols:8,color:SWATCH[1]}),
  W('timeline',0,6,16,4,{label:'Timeline motion',...tlOpts(),readonly:false,color:SWATCH[3]})
])]};
TPL.full={name:'Show completo',desc:'Tutte le pagine insieme: Gaia, PatchDeck, DMX V8, panoramica show, DMX, teste mobili, timeline, palco, mix.',
  pages:()=>['gaia','show','regia','luci','audio','laser','motion','dmx','mh','timeline','palco','mix'].flatMap(k=>TPL[k].pages())};
const sample=()=>({pages:TPL.full.pages(),fixtures:defaultFixtures(),stage:stageDefaults()});
