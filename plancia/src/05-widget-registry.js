/* ---------- registro dei tipi di widget ---------- */
// Ogni tipo dichiara in un posto solo quello che prima era sparso negli switch
// di 00 (DEF, NAMES), 40 (interno, valore, indirizzo, argomenti OSC), 41 (tocco),
// 80 (loop) e 95 (aiuto). Oggi tutti i 19 tipi sono registrati e quegli switch
// non esistono piu' (REFACTOR.md, passo 2).
//
//   registerWidget('laser',{
//     size:[8,6], label:'Laser',            // dimensioni di default e nome nel menu
//     showsValue:false, showsAddr:false,    // valore e indirizzo OSC sotto l'etichetta (anche w=>bool)
//     inner:w=>html,                        // contenuto del widget
//     mounted:(el,w)=>…,                    // dopo la costruzione (es. dimensionare un canvas)
//     paint:(el,w)=>…, valueText:w=>testo,  // disegno del valore e testo sotto l'etichetta
//     args:w=>[…],                          // argomenti OSC (default: il valore nel range min..max)
//     onPointer:(e,el,w)=>…,                // tocco fuori da "Modifica griglia"
//     tick:(el,w,{repaint,now,level})=>…,   // a ogni fotogramma; repaint = dati cambiati o 1 s,
//                                           // level = pulsazione dello show (per il Render)
//     help:w=>[titolo,testo],               // passo della visita guidata "?"
//     receive:(w,args)=>bool,               // OSC in arrivo sul suo indirizzo: aggiorna il valore,
//                                           // true = da ridisegnare (senza: il tipo non ascolta)
//     refreshOnResize:true,                 // ricostruito quando lo si ridimensiona in Modifica griglia
//     oscAddress:true, addrLabel:'…',       // indirizzo OSC modificabile nell'ispettore (anche w=>bool)
//     range:true|{min,max}, midi:true,      // campi min/max (con etichette) e MIDI CC nell'ispettore
//     inspector:{html:w=>…, bind:(w,{on,val})=>…, footer:w=>…}}); // campi propri nell'ispettore
//
// La registrazione avviene quando il modulo del widget viene valutato: tutto
// cio' che la usa gira dopo init() (src/999-start.js).
const WIDGET_TYPES=new Map();
function registerWidget(type,spec){
  WIDGET_TYPES.set(type,{showsValue:true,showsAddr:true,...spec,type});
  if(spec.size)DEF[type]=spec.size;
  if(spec.label)NAMES[type]=spec.label;
}
function widgetType(type){return WIDGET_TYPES.get(type)||null}
// valore OSC -> 0..1 nel range del widget
const oscNorm=(w,a)=>clamp((+a-w.min)/((w.max-w.min)||1));

// Indice indirizzo OSC -> widget che lo ascoltano (tipi con receive), in ordine
// di pagina. Si ricostruisce alla prima ricezione dopo un cambio del layout:
// save() e render() lo invalidano, un layout nuovo (L sostituito) pure.
let oscIndex=null;
function oscIndexStale(){oscIndex=null}
function oscListeners(address){
  if(!oscIndex||oscIndex.L!==L){
    oscIndex={L,map:new Map()};
    for(const p of L.pages)for(const w of p.widgets){
      if(!w.addr||!widgetType(w.type)?.receive)continue;
      const list=oscIndex.map.get(w.addr);if(list)list.push([p,w]);else oscIndex.map.set(w.addr,[[p,w]]);
    }
  }
  return oscIndex.map.get(address)||[];
}
