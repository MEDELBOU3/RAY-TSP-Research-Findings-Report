const cv=document.getElementById('cv'),ctx=cv.getContext('2d');
const W=580,H=280; cv.width=W; cv.height=H;
let cities=[],rayPath=[],nnPath=[],distMode='random';
let historyRows=[];
let benchResults={};

/* ── helpers ── */
function d(a,b){return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2)}
function norm(v){const l=Math.sqrt(v.x*v.x+v.y*v.y);return l<1e-9?{x:1,y:0}:{x:v.x/l,y:v.y/l}}
function dot(a,b){return a.x*b.x+a.y*b.y}
function cross2D(a,b){return a.x*b.y-a.y*b.x}

/* ── FIX PERF: build rotation angles once ── */
const ROT_ANGLES=[];
for(let a=5;a<=180;a+=5) ROT_ANGLES.push(a,-a);

function getLambda(){return parseFloat(document.getElementById('lambda').value)||1.2}
function useFix1(){return document.getElementById('fix1').checked}
function useFix2(){return document.getElementById('fix2').checked}
function updateFixLabels(){}

/* ── city generation ── */
function setMode(m){
  distMode=m;
  ['random','cluster','grid'].forEach(x=>document.getElementById('btn-'+x).classList.toggle('active',x===m));
  document.getElementById('cluster-ctrl').style.display=m==='cluster'?'flex':'none';
  genCities();
}

function randomCities(n,mode){
  const arr=[];const pad=40;
  if(mode==='random'||!mode){
    for(let i=0;i<n;i++)arr.push({x:pad+Math.random()*(W-pad*2),y:pad+Math.random()*(H-pad*2)});
  } else if(mode==='cluster'){
    const k=parseInt(document.getElementById('nClusters').value)||4;
    const spread=parseInt(document.getElementById('spread').value)||55;
    const centers=[];
    for(let c=0;c<k;c++)centers.push({x:80+Math.random()*(W-160),y:60+Math.random()*(H-120)});
    for(let i=0;i<n;i++){
      const c=centers[i%k];
      arr.push({
        x:Math.max(pad,Math.min(W-pad,c.x+(Math.random()-0.5)*spread*2)),
        y:Math.max(pad,Math.min(H-pad,c.y+(Math.random()-0.5)*spread*2))
      });
    }
  } else if(mode==='grid'){
    const cols=Math.ceil(Math.sqrt(n));const rows=Math.ceil(n/cols);
    const sx=(W-80)/(cols-1||1),sy=(H-80)/(rows-1||1);
    for(let i=0;i<n;i++){
      const r=Math.floor(i/cols),c=i%cols;
      arr.push({x:40+c*sx+(Math.random()-0.5)*18,y:40+r*sy+(Math.random()-0.5)*18});
    }
  }
  return arr;
}

function genCities(){
  const n=parseInt(document.getElementById('nIn').value)||12;
  cities=randomCities(n,distMode);
  rayPath=[];nnPath=[];
  document.getElementById('live-costs').textContent='';
  draw();
}

/* ════════════════════════════════════════════════════
   Ray TSP core — all fixes applied
   ════════════════════════════════════════════════════ */
function runRay(arr,fix1=true,fix2=true,lambda=1.2){
  const n=arr.length;
  let best=null,bestCost=Infinity;
  for(let s=0;s<n;s++){
    for(let t=0;t<n;t++){
      if(t===s)continue;
      const dx=arr[t].x-arr[s].x,dy=arr[t].y-arr[s].y;
      const initDir=norm({x:dx,y:dy});
      const{path,cost}=runRaySingle(s,initDir,arr,fix1,fix2,lambda);
      if(cost<bestCost){bestCost=cost;best=path;}
    }
  }
  return{path:best,cost:bestCost};
}

function runRaySingle(start,initDir,arr,fix1,fix2,lambda){
  const n=arr.length;
  const visited=new Set([start]);
  const path=[start];
  let dir=initDir,cost=0;

  while(visited.size<n){
    const cur=arr[path[path.length-1]];
    let bestIdx=-1,bestScore=Infinity;

    for(let i=0;i<n;i++){
      if(visited.has(i))continue;
      const c=arr[i];
      const dx=c.x-cur.x,dy=c.y-cur.y;
      const dist_ci=Math.sqrt(dx*dx+dy*dy);
      if(dist_ci<1e-9)continue;

      if(fix1){
        const t=dot({x:dx,y:dy},dir);
        if(t<-dist_ci*0.15)continue; // FIX 2 
        const sinTheta=Math.abs(cross2D(dir,norm({x:dx,y:dy})));
        const adaptLambda=lambda*Math.max(0.3,1-visited.size/n); // FIX 3 — adaptive lambda
        //const score=dist_ci*(1+adaptLambda*sinTheta);
        const score = dist_ci * Math.exp(adaptLambda * sinTheta);
        if(score<bestScore){bestScore=score;bestIdx=i;}
      } else {
        const t=dot({x:dx,y:dy},dir);
        if(t<=0)continue;
        const fx=cur.x+t*dir.x,fy=cur.y+t*dir.y;
        const r=Math.sqrt((c.x-fx)**2+(c.y-fy)**2);
        if(r<bestScore){bestScore=r;bestIdx=i;}
      }
    }

    /* fallback: rotate بالاتجاهين — FIX 1 */
    if(bestIdx<0){
      for(const angle of ROT_ANGLES){ // FIX PERF — ROT_ANGLES constant
        const rad=angle*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
        const rd={x:dir.x*cos-dir.y*sin,y:dir.x*sin+dir.y*cos};
        let localBest=-1,localScore=Infinity;
        for(let i=0;i<n;i++){
          if(visited.has(i))continue;
          const c=arr[i];
          const dx=c.x-cur.x,dy=c.y-cur.y;
          const dist_ci=Math.sqrt(dx*dx+dy*dy); // FIX — check
          if(dist_ci<1e-9)continue;
          const t=dot({x:dx,y:dy},rd);
          if(t<-dist_ci*0.15)continue; // FIX 2 — fallback
          let score;
          if(fix1){
            const sinTheta=Math.abs(cross2D(rd,norm({x:dx,y:dy})));
            const adaptLambda=lambda*Math.max(0.3,1-visited.size/n); // FIX 3 — fallback
            score=dist_ci*(1+adaptLambda*sinTheta);
          } else {
            const fx=cur.x+t*rd.x,fy=cur.y+t*rd.y;
            score=Math.sqrt((c.x-fx)**2+(c.y-fy)**2);
          }
          if(score<localScore){localScore=score;localBest=i;}
        }
        if(localBest>=0){bestIdx=localBest;dir=rd;break;}
      }
    }

    /* last resort: nearest unvisited */
    if(bestIdx<0){
      let nd=Infinity;
      for(let i=0;i<n;i++){
        if(visited.has(i))continue;
        const dd=d(cur,arr[i]);
        if(dd<nd){nd=dd;bestIdx=i;}
      }
    }

    cost+=d(cur,arr[bestIdx]);

    // FIX 2 — dir update  
    if(fix2){
      const next=arr[bestIdx];
      dir=norm({x:next.x-cur.x,y:next.y-cur.y});
    } else {
      const c=arr[bestIdx];
      const dx=c.x-cur.x,dy=c.y-cur.y;
      const t=dot({x:dx,y:dy},dir);
      const foot={x:cur.x+t*dir.x,y:cur.y+t*dir.y};
      dir=norm({x:c.x-foot.x,y:c.y-foot.y});
    }

    visited.add(bestIdx);path.push(bestIdx);
  }
  cost+=d(arr[path[path.length-1]],arr[start]);
  path.push(start);
  return{path,cost};
}

/* ── NN ── */
function runNN(arr){
  const n=arr.length;let best=null,bestCost=Infinity;
  for(let s=0;s<n;s++){
    const visited=new Set([s]);const path=[s];
    while(visited.size<n){
      const cur=arr[path[path.length-1]];
      let bi=-1,bd=Infinity;
      for(let i=0;i<n;i++){if(visited.has(i))continue;const dd=d(cur,arr[i]);if(dd<bd){bd=dd;bi=i;}}
      visited.add(bi);path.push(bi);
    }
    path.push(s);
    const c=pathCost(path,arr);
    if(c<bestCost){bestCost=c;best=path;}
  }
  return{path:best,cost:bestCost};
}

function pathCost(p,arr){
  let c=0;for(let i=0;i<p.length-1;i++)c+=d(arr[p[i]],arr[p[i+1]]);return c;
}

/* ── 2-opt ── */
function opt2(path,arr){
  const n=path.length-1;let improved=true,p=[...path];
  while(improved){
    improved=false;
    for(let i=1;i<n-1;i++){
      for(let j=i+1;j<n;j++){
        const a=p[i-1],b=p[i],c=p[j],dd=(j+1<p.length)?p[j+1]:p[0];
        const before=d(arr[a],arr[b])+d(arr[c],arr[dd]);
        const after=d(arr[a],arr[c])+d(arr[b],arr[dd]);
        if(after<before-0.01){p.splice(i,j-i+1,...p.slice(i,j+1).reverse());improved=true;}
      }
    }
  }
  return p;
}

function runBoth(){
  const lam=getLambda(),f1=useFix1(),f2=useFix2();
  const r=runRay(cities,f1,f2,lam);
  const nn=runNN(cities);
  rayPath=r.path;nnPath=nn.path;
  const rCost=Math.round(r.cost),nCost=Math.round(nn.cost);
  const gap=((rCost-nCost)/nCost*100).toFixed(1);
  const winLabel=rCost<nCost-0.5?'Ray ✓':rCost>nCost+0.5?'NN ✓':'=';
  document.getElementById('live-costs').textContent=
    `Ray: ${rCost}px  |  NN: ${nCost}px  |  gap: ${gap>0?'+':''}${gap}%  →  ${winLabel}`;
  draw();
}

/* ── BENCHMARK ── */
async function runBenchmark(mode){
  const trials=100;
  const n=parseInt(document.getElementById('nIn').value)||12;
  const lam=getLambda(),f1=useFix1(),f2=useFix2();
  const btnId=mode==='random'?'b-rand':'b-clust';
  document.getElementById(btnId).disabled=true;
  document.getElementById('bench-status').textContent=`جاري... ${mode} ×${trials}`;

  let rawRayW=0,rawNNW=0,rawTies=0,sumRawGap=0;
  let optRayW=0,optNNW=0,optTies=0,sumOptGap=0;

  for(let trial=1;trial<=trials;trial++){
    if(trial%10===0){
      document.getElementById('pf').style.width=(trial/trials*100)+'%';
      document.getElementById('bench-status').textContent=`${mode} — trial ${trial}/${trials}`;
      await new Promise(r=>setTimeout(r,0));
    }

    const arr=randomCities(n,mode);

    const{path:rp,cost:rc}=runRay(arr,f1,f2,lam);
    const{path:np,cost:nc}=runNN(arr);

    const rawGap=(rc-nc)/nc*100;
    sumRawGap+=rawGap;
    const rawWinner=rc<nc-0.5?'ray':rc>nc+0.5?'nn':'tie';
    if(rawWinner==='ray')rawRayW++;else if(rawWinner==='nn')rawNNW++;else rawTies++;

    const rp2=opt2(rp,arr);const rc2=pathCost(rp2,arr);
    const np2=opt2(np,arr);const nc2=pathCost(np2,arr);
    const optGap=(rc2-nc2)/nc2*100;
    sumOptGap+=optGap;
    const optWinner=rc2<nc2-0.5?'ray':rc2>nc2+0.5?'nn':'tie';
    if(optWinner==='ray')optRayW++;else if(optWinner==='nn')optNNW++;else optTies++;

    historyRows.unshift({
      trial,mode,
      rc:Math.round(rc),nc:Math.round(nc),rawWinner,rawGap:rawGap.toFixed(1),
      rc2:Math.round(rc2),nc2:Math.round(nc2),optWinner,
    });
    if(historyRows.length>20)historyRows.pop();
    updateHistory();
  }

  document.getElementById('pf').style.width='100%';
  setTimeout(()=>{document.getElementById('pf').style.width='0%';},600);

  const avgRawGap=(sumRawGap/trials).toFixed(2);
  const avgOptGap=(sumOptGap/trials).toFixed(2);

  benchResults[mode]={rawRayW,rawNNW,rawTies,avgRawGap,optRayW,optNNW,optTies,avgOptGap,trials,n};
  updateResultsTable();
  updateStatCards(rawRayW,rawNNW,optRayW,avgRawGap);
  updateFinding(mode,avgRawGap,avgOptGap,rawRayW,rawNNW,trials);

  document.getElementById(btnId).disabled=false;
  document.getElementById('bench-status').textContent=`اكتمل — ${mode} ×${trials} | raw gap: ${avgRawGap}% | 2opt gap: ${avgOptGap}%`;
}

function updateStatCards(rRayW,rNNW,oRayW,avgRawGap){
  const gap=parseFloat(avgRawGap);
  document.getElementById('stats-raw').innerHTML=[
    {v:rRayW,cls:'teal',lbl:'Ray wins (raw)'},
    {v:rNNW,cls:'amber',lbl:'NN wins (raw)'},
    {v:oRayW,cls:oRayW>50?'teal':'gray',lbl:'Ray wins (2opt)'},
    {v:(gap>0?'+':'')+avgRawGap+'%',cls:gap<-2?'teal':gap>2?'red':'amber',lbl:'avg gap raw'},
  ].map(v=>`<div class="stat"><div class="stat-val ${v.cls}">${v.v}</div><div class="stat-lbl">${v.lbl}</div></div>`).join('');
}

function updateFinding(mode,rawGap,optGap,rayW,nnW,trials){
  const el=document.getElementById('finding');
  el.style.display='block';
  const rg=parseFloat(rawGap),og=parseFloat(optGap);
  let txt,cls='finding';
 if (rg < -2) {
  txt = ` Fix1 + Fix2 succeeded! Ray TSP outperforms NN in RAW by ${rawGap}% — this confirms the geometric advantage. After 2-opt, the gap is ${optGap}%.`;
} else if (rg < 0) {
  txt = `Ray TSP performs better than NN by ${rawGap}% without 2-opt. After 2-opt, the gap is ${optGap}%. Consider increasing λ.`;
  cls = 'finding warn';
} else if (rg < 2) {
  txt = `RAW: Nearly equivalent performance (${rawGap}%). Fix1/Fix2 are not sufficient — try increasing λ or changing the mode.`;
  cls = 'finding warn';
} else {
  txt = `NN still outperforms in RAW by ${rawGap}%. Fix1 + Fix2 were not sufficient. Fix3 is useful for analysis as it highlights the difference.`;
  cls = 'finding warn';
}
  el.className=cls;el.textContent=txt;
}

function updateResultsTable(){
  const tbody=document.getElementById('results-body');
  const labels={random:'RANDOM',cluster:'CLUSTERED',grid:'GRID'};
  tbody.innerHTML='';
  let hasAny=false;
  ['random','cluster','grid'].forEach(m=>{
    if(!benchResults[m])return;
    hasAny=true;
    const r=benchResults[m];
    const rg=parseFloat(r.avgRawGap),og=parseFloat(r.avgOptGap);
    const rgCol=rg<-1?'#1D9E75':rg>2?'#E24B4A':'#BA7517';
    const ogCol=og<-0.5?'#1D9E75':og>1?'#E24B4A':'#BA7517';
    tbody.innerHTML+=`<tr>
      <td style="color:#aaa;font-weight:700">${labels[m]||m.toUpperCase()}</td>
      <td style="color:#555">${r.trials} (n=${r.n})</td>
      <td style="color:#1D9E75">${r.rawRayW}</td>
      <td style="color:#BA7517">${r.rawNNW}</td>
      <td style="color:${rgCol};font-weight:700">${rg>0?'+':''}${r.avgRawGap}%</td>
      <td style="color:#1D9E75">${r.optRayW}</td>
      <td style="color:#BA7517">${r.optNNW}</td>
      <td style="color:${ogCol};font-weight:700">${og>0?'+':''}${r.avgOptGap}%</td>
    </tr>`;
  });
  if(!hasAny)tbody.innerHTML='<tr><td colspan="8" style="color:#333;padding:12px">— شغّل benchmark —</td></tr>';
}

function updateHistory(){
  const tbody=document.getElementById('hist-body');
  tbody.innerHTML=historyRows.map(r=>{
    const rwC=r.rawWinner==='ray'?'#1D9E75':r.rawWinner==='nn'?'#BA7517':'#555';
    const owC=r.optWinner==='ray'?'#1D9E75':r.optWinner==='nn'?'#BA7517':'#555';
    const rwL=r.rawWinner==='ray'?'Ray✓':r.rawWinner==='nn'?'NN✓':'=';
    const owL=r.optWinner==='ray'?'Ray✓':r.optWinner==='nn'?'NN✓':'=';
    const gC=parseFloat(r.rawGap)<0?'#1D9E75':parseFloat(r.rawGap)>3?'#E24B4A':'#BA7517';
    const mL=r.mode==='cluster'?'<span style="color:#BA7517">CLUST</span>':r.mode==='grid'?'<span style="color:#534AB7">GRID</span>':'<span style="color:#555">RAND</span>';
    return`<tr>
      <td style="color:#555">${r.trial}</td>
      <td>${mL}</td>
      <td>${r.rc}</td><td>${r.nc}</td>
      <td style="color:${rwC};font-weight:700">${rwL}</td>
      <td>${r.rc2}</td><td>${r.nc2}</td>
      <td style="color:${owC};font-weight:700">${owL}</td>
      <td style="color:${gC}">${parseFloat(r.rawGap)>0?'+':''}${r.rawGap}%</td>
    </tr>`;
  }).join('');
}

/* ── draw ── */
function draw(){
  ctx.clearRect(0,0,W,H);
  function drawPath(path,color,dash){
    if(!path||path.length<2)return;
    ctx.beginPath();ctx.moveTo(cities[path[0]].x,cities[path[0]].y);
    for(let i=1;i<path.length;i++)ctx.lineTo(cities[path[i]].x,cities[path[i]].y);
    ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash(dash||[]);ctx.stroke();ctx.setLineDash([]);
  }
  if(nnPath.length)drawPath(nnPath,'#BA7517',[5,4]);
  if(rayPath.length)drawPath(rayPath,'#1D9E75');
  cities.forEach((c,i)=>{
    ctx.beginPath();ctx.arc(c.x,c.y,6,0,2*Math.PI);
    ctx.fillStyle='#1e1e1e';ctx.fill();
    ctx.strokeStyle='#444';ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle='#888';ctx.font='bold 9px Courier New';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(i,c.x,c.y);
  });
}

genCities();
