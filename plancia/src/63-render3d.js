// 17/11: Render 3D (plancia/render3d, la "Luci nello spazio" di Nicola) dentro la Plancia.
// La pagina 3D carica una scansione pesante: non deve ripartire ogni volta che la Plancia
// ridisegna i widget (cambi da altri tablet, salvataggi). Per questo l'iframe vive fuori dalla
// griglia, uno solo, posato sopra il riquadro del widget a ogni fotogramma e nascosto quando
// il widget non c'e' (altra pagina) o si modifica la griglia.
const R3D={frame:null,seen:0,timer:0};
function r3dFrame(){
  if(R3D.frame)return R3D.frame;
  const f=document.createElement('iframe');f.className='r3d-frame';f.title='Render 3D';f.src='/render3d/';f.allow='fullscreen';
  document.body.appendChild(f);R3D.frame=f;
  R3D.timer=setInterval(()=>{if(R3D.frame&&performance.now()-R3D.seen>250)R3D.frame.style.display='none'},200);
  return f;
}
// dopo una registrazione del Render: apre questa registrazione nel Render 3D
function r3dOpen(file){const f=r3dFrame();f.src='/render3d/'+(file?'?frames='+encodeURIComponent(file):'')}
registerWidget('render3d',{oscAddress:false,size:[16,10],label:'Render 3D',showsValue:false,showsAddr:false,
  inner:()=>`<div class="r3d-box"><div class="r3d-bar"><span class="hint">Scansione del locale con le luci registrate col ⏺ del Render</span><a class="btn sm ghost" href="/render3d/" target="_blank" rel="noopener" title="Apri il Render 3D in una scheda a parte: export più veloce">⤢ Scheda a parte</a></div><div class="r3d-slot"></div></div>`,
  onPointer:ignorePointer,
  tick(el){
    const slot=el.querySelector('.r3d-slot');if(!slot)return;
    const f=r3dFrame(),r=slot.getBoundingClientRect();R3D.seen=performance.now();
    if(editing||r.width<20||r.height<20){f.style.display='none';return}
    const st=f.style,v=[r.left,r.top,r.width,r.height].map(x=>Math.round(x)+'px');
    if(st.left!==v[0])st.left=v[0];if(st.top!==v[1])st.top=v[1];if(st.width!==v[2])st.width=v[2];if(st.height!==v[3])st.height=v[3];if(st.display!=='block')st.display='block';
  },
  help:()=>['Render 3D','Come si usa: 1) nel Palco premi ⏺ (Render) con la musica in play: si salvano luci, musica e contenuto di LED wall e proiettori. 2) Qui, in "Sorgente delle luci", scegli la registrazione e collega le colonne alle luci del Palco. 3) "Elementi del Palco": LED wall, schermi e proiettori vengono messi nello spazio; se non coincidono usa l’allineamento manuale (2 punti) e i ritocchi. 4) Proiettore: 📍 punta qui sceglie dove guarda, ◰ mappa 4 punti fa cadere l’immagine sui 4 punti cliccati (finisce nella pagina Mapping). 5) ● registra MP4 esporta il video con la musica. ⤢ apre il Render 3D in una scheda a parte (export più veloce).']});
// 2026-11-17: pagina Render 3D nel suo gruppo (uiRev 22)
function migrateUiRender3d(){
  if((L.uiRev||0)>=22)return;
  if(!L.pages.some(p=>p.widgets.some(w=>w.type==='render3d')))L.pages.push({id:uid(),name:'Render 3D',widgets:[W('render3d',0,0,16,10,{label:'Render 3D'})]});
  L.uiRev=22;save();
}
