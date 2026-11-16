/* ---------- export della patch DMX per chi monta le luci (Strumenti del palco, 16/11/2026) ----------
   Pagina stampabile (anche PDF dal browser) e CSV: per ogni luce universo, porta Art-Net, indirizzo,
   canali con il loro nome, DIP switch; pianta vista dall'alto e dal pubblico con nomi e indirizzi.
   Solo dati del progetto (L.fixtures, modelli) e, se c'e', la mappa degli universi di DMX Master. */
const DXE_COLORS=['#d62828','#1d70b8','#2a9d55','#e07b00','#7b3fbf','#0f9ea8','#c2185b','#6d6d00','#5d4037','#455a64'];
function dmxExportRows(){
  const um=universeMap()?.universes||[];
  return(L.fixtures||[]).filter(f=>FIX_TYPES[f.type]?.ch&&f.enabled!==false&&Number.isFinite(+f.address)).map(f=>{
    const m=tdModelFor(f),n=footprintFor(f)||0,names=Array.isArray(m?.channels)?m.channels:[];
    const uni=+f.universe||1,port=um.filter(u=>u.universe===uni),p=port.find(u=>u.online!==false)||port[0];
    const a=+f.address;
    return{f,name:f.name||f.id,type:FIX_TYPES[f.type]?.label||f.type,model:f.model||typeDefaultModel(f.type)||'',group:groupLabel(f.group),groupKey:f.group||'',
      universe:uni,port:p?(p.label||p.port_id||''):'',address:a,end:a+n-1,n,
      chans:Array.from({length:n},(_,i)=>({ch:a+i,name:String(names[i]??`canale ${i+1}`)})),
      dip:Array.from({length:9},(_,i)=>i+1).filter(i=>(a>>(i-1))&1),x:+f.x||0,y:+f.y||0,z:+f.z||0};
  }).sort((p,q)=>p.universe-q.universe||p.address-q.address);
}
// sovrapposizioni e indirizzi fuori dai 512 canali
function dmxExportProblems(rows){
  const out=[];
  rows.forEach((r,i)=>{if(r.end>512)out.push(`${r.name}: arriva al canale ${r.end}, oltre 512`);
    const prev=rows.slice(0,i).filter(q=>q.universe===r.universe&&q.end>=r.address);
    prev.forEach(q=>out.push(`${q.name} (${q.address}-${q.end}) e ${r.name} (${r.address}-${r.end}) si sovrappongono nell'universo ${r.universe}`))});
  return out;
}
function dmxExportCsv(rows){
  const q=v=>/[";\n]/.test(String(v))?`"${String(v).replace(/"/g,'""')}"`:String(v);
  const lines=[['Universo','Porta','Canale','Luce','Modello','Gruppo','Funzione','Indirizzo iniziale','DIP ON'].join(';')];
  for(const r of rows)for(const c of r.chans)lines.push([r.universe,r.port,c.ch,r.name,r.model,r.group,c.name,r.address,r.dip.join(' ')].map(q).join(';'));
  return'﻿'+lines.join('\r\n');
}
// pianta in SVG: dall'alto (x, y) o dal pubblico (x, z)
function dmxExportPlan(rows,view,colorOf){
  const st=L.stage||{width:6,depth:4},W=760,H=view==='top'?440:300,pad=40;
  const xs=[-st.width/2,st.width/2,...rows.map(r=>r.x)],x0=Math.min(...xs)-.8,x1=Math.max(...xs)+.8;
  const vs=view==='top'?[0,st.depth,...rows.map(r=>r.y)]:[0,(st.trussHeight||4),...rows.map(r=>r.z)];
  const v0=Math.min(...vs)-.6,v1=Math.max(...vs)+.8;
  const k=Math.min((W-2*pad)/(x1-x0),(H-2*pad)/(v1-v0)),X=x=>pad+(x-x0)*k,Y=v=>view==='top'?pad+(v-v0)*k:H-pad-(v-v0)*k;
  const lab=(x,y,t,o='')=>`<text x="${x}" y="${y}" ${o}>${esc(t)}</text>`;
  let g='';
  if(view==='top'){
    g+=`<rect x="${X(-st.width/2)}" y="${Y(0)}" width="${st.width*k}" height="${st.depth*k}" class="stage"/>${lab(X(-st.width/2)+4,Y(0)+14,`PALCO ${(+st.width).toFixed(1)} × ${(+st.depth).toFixed(1)} m`,'class="cap"')}`;
    g+=lab(W/2,H-8,'↓ PUBBLICO ↓','class="cap" text-anchor="middle"');
  }else{
    g+=`<line x1="${X(x0)}" y1="${Y(0)}" x2="${X(x1)}" y2="${Y(0)}" class="floor"/>${lab(X(x0)+4,Y(0)-4,'piano del palco','class="cap"')}`;
    if(st.trussHeight)g+=`<line x1="${X(-st.width/2)}" y1="${Y(st.trussHeight)}" x2="${X(st.width/2)}" y2="${Y(st.trussHeight)}" class="truss"/>${lab(X(-st.width/2)+4,Y(st.trussHeight)-6,`americana ${(+st.trussHeight).toFixed(1)} m`,'class="cap"')}`;
    g+=lab(W/2,14,'vista dal pubblico','class="cap" text-anchor="middle"');
  }
  rows.forEach(r=>{const cx=X(r.x),cy=Y(view==='top'?r.y:r.z),c=colorOf(r.groupKey);
    g+=`<circle cx="${cx}" cy="${cy}" r="7" fill="${c}"/>${lab(cx,cy-11,r.name,'class="nm" text-anchor="middle"')}${lab(cx,cy+19,`${r.universe}.${r.address}`,'class="ad" text-anchor="middle"')}`});
  return`<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>`;
}
function dmxExportHtml(){
  const rows=dmxExportRows(),probs=dmxExportProblems(rows),groups=[...new Set(rows.map(r=>r.groupKey))];
  const colorOf=k=>DXE_COLORS[groups.indexOf(k)%DXE_COLORS.length];
  const proj=L._projectName||'Progetto',d=new Date(),when=d.toLocaleDateString('it-IT')+' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  const unis=[...new Set(rows.map(r=>r.universe))].map(u=>{const rs=rows.filter(r=>r.universe===u);return{u,port:rs.find(r=>r.port)?.port||'',used:rs.reduce((a,r)=>a+r.n,0),max:Math.max(...rs.map(r=>r.end))}});
  const csv='data:text/csv;charset=utf-8,'+encodeURIComponent(dmxExportCsv(rows));
  const file=`patch-dmx-${proj.replace(/[^\w.-]+/g,'_')}`;
  return`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Patch DMX · ${esc(proj)}</title>
<style>
body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#111;background:#fff;margin:24px;max-width:1100px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #111;padding-bottom:3px}
.sub{color:#555}.bar{margin:12px 0;display:flex;gap:8px;flex-wrap:wrap}.bar a,.bar button{font:inherit;padding:6px 12px;border:1px solid #888;border-radius:6px;background:#f4f4f4;color:#111;text-decoration:none;cursor:pointer}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eee}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.addr{font-weight:700;font-size:15px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.warn{background:#fff3cd;border:1px solid #e0b100;padding:8px 10px;border-radius:6px}.ok{color:#2a7a3a}
.chs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:2px 12px}.chs span b{display:inline-block;min-width:34px}
.fx{break-inside:avoid;margin:0 0 10px}.fx h3{font-size:13px;margin:0 0 3px}
svg{border:1px solid #ccc;border-radius:6px;background:#fff;margin:4px 0 8px}svg .stage{fill:#f1f1f1;stroke:#555;stroke-width:1.5}svg .floor{stroke:#555;stroke-width:2}svg .truss{stroke:#999;stroke-width:4;stroke-dasharray:8 4}
svg text{font:11px system-ui,Arial,sans-serif}svg .cap{fill:#777}svg .nm{font-weight:700;fill:#111}svg .ad{fill:#111}
.dip{font-family:ui-monospace,Consolas,monospace;white-space:nowrap}
@media print{body{margin:10mm}.bar{display:none}h2{break-after:avoid}table,svg{break-inside:avoid}}
</style></head><body>
<h1>Patch DMX · ${esc(proj)}</h1><div class="sub">${rows.length} luci · ${unis.length} universi · ${esc(when)} · dalla Plancia GAIA</div>
<div class="bar"><button onclick="print()">Stampa / PDF</button><a href="${csv}" download="${esc(file)}.csv">Scarica tabella CSV</a></div>
${probs.length?`<div class="warn"><b>Da controllare:</b><br>${probs.map(esc).join('<br>')}</div>`:`<p class="ok">Nessun indirizzo sovrapposto, tutto entro 512 canali.</p>`}
<h2>Universi</h2><table><tr><th>Universo</th><th>Porta / nodo</th><th>Canali usati</th><th>Ultimo canale</th></tr>
${unis.map(x=>`<tr><td class="n">${x.u}</td><td>${esc(x.port||'—')}</td><td class="n">${x.used}</td><td class="n">${x.max}</td></tr>`).join('')}</table>
<h2>Pianta</h2>
<div class="sub">Pallino = luce, sotto <b>universo.indirizzo</b>. Colori per gruppo: ${groups.map(g=>`<span class="dot" style="background:${colorOf(g)}"></span>${esc(rows.find(r=>r.groupKey===g)?.group||'—')}`).join(' &nbsp; ')}</div>
${dmxExportPlan(rows,'top',colorOf)}${dmxExportPlan(rows,'front',colorOf)}
<h2>Indirizzi</h2><table><tr><th>Luce</th><th>Tipo · modello</th><th>Gruppo</th><th>Univ.</th><th>Indirizzo</th><th>Fine</th><th>Canali</th><th>DIP switch ON</th><th>Posizione x · y · h (m)</th></tr>
${rows.map(r=>`<tr><td><span class="dot" style="background:${colorOf(r.groupKey)}"></span><b>${esc(r.name)}</b></td><td>${esc(r.type)}<br><small>${esc(r.model)}</small></td><td>${esc(r.group)}</td><td class="n">${r.universe}</td><td class="n addr">${r.address}</td><td class="n">${r.end}</td><td class="n">${r.n}</td><td class="dip">${r.dip.join(' ')||'—'}</td><td class="n">${r.x.toFixed(2)} · ${r.y.toFixed(2)} · ${r.z.toFixed(2)}</td></tr>`).join('')}</table>
<p class="sub">DIP switch: interruttori da accendere per l'indirizzo (1 = 1, 2 = 2, 3 = 4, 4 = 8 … 9 = 256), per le luci che si indirizzano così. Il modo canali sulla luce deve essere quello del modello (es. 8CH).</p>
<h2>Canali di ogni luce</h2>
${rows.map(r=>`<div class="fx"><h3><span class="dot" style="background:${colorOf(r.groupKey)}"></span>${esc(r.name)} · universo ${r.universe} · ${r.address}-${r.end} · ${esc(r.model)}</h3><div class="chs">${r.chans.map(c=>`<span><b>${c.ch}</b> ${esc(c.name)}</span>`).join('')}</div></div>`).join('')}
</body></html>`;
}
function openDmxExport(){
  const rows=dmxExportRows();
  if(!rows.length){showError('Nessuna luce DMX con indirizzo nel progetto.');return}
  const url=URL.createObjectURL(new Blob([dmxExportHtml()],{type:'text/html'}));
  const w=window.open(url,'_blank');
  if(!w){const a=document.createElement('a');a.href=url;a.download=`patch-dmx-${(L._projectName||'progetto').replace(/[^\w.-]+/g,'_')}.html`;document.body.appendChild(a);a.click();a.remove();showInfo('Patch DMX scaricata come pagina: aprila e stampala o salvala in PDF.')}
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
