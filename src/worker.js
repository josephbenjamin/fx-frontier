
function boxMuller() {
  let u,v;
  do{u=Math.random();}while(u===0);
  do{v=Math.random();}while(v===0);
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}
// Returns null if M is not positive semi-definite (matches main-thread validator).
function cholesky(M) {
  const n=M.length;
  const L=Array.from({length:n},()=>new Array(n).fill(0));
  for(let i=0;i<n;i++){
    for(let j=0;j<=i;j++){
      let s=0;
      for(let k=0;k<j;k++) s+=L[i][k]*L[j][k];
      if(i===j){
        const v=M[i][i]-s;
        if(v < -1e-8) return null;
        L[i][j]=Math.sqrt(Math.max(0,v));
      } else {
        L[i][j]=L[j][j]>1e-10?(M[i][j]-s)/L[j][j]:0;
      }
    }
  }
  return L;
}
function pctile(arr,p){
  const s=[...arr].sort((a,b)=>a-b);
  const idx=(p/100)*(s.length-1);
  const lo=Math.floor(idx),hi=Math.ceil(idx);
  return lo===hi?s[lo]:s[lo]+(idx-lo)*(s[hi]-s[lo]);
}
self.onmessage=function(e){
  const {corrMatrix,foreignCcys,reportingCcy,fwdArr,volArr,spotArr,
         navTotal,netDebtTotal,ebitdaTotal,naAlloc,ebitdaAlloc,
         scenarios,nSims,T}=e.data;
  const nF=foreignCcys.length;
  const L=cholesky(corrMatrix);
  if(!L){
    self.postMessage({type:'error',message:'Correlation matrix is not positive semi-definite.'});
    return;
  }
  // Simulate FX paths
  const paths=[];
  for(let s=0;s<nSims;s++){
    const eps=Array.from({length:nF},boxMuller);
    const Z=new Array(nF).fill(0);
    for(let i=0;i<nF;i++) for(let j=0;j<=i;j++) Z[i]+=L[i][j]*eps[j];
    paths.push(foreignCcys.map((_,i)=>fwdArr[i]*Math.exp(-0.5*volArr[i]*volArr[i]*T+volArr[i]*Math.sqrt(T)*Z[i])));
  }
  // Fixed local values (reporting ccy component unchanged)
  const naLocal    =foreignCcys.map((_,i)=>navTotal*(naAlloc[foreignCcys[i]]||0)/100/spotArr[i]);
  const ebitdaLocal=foreignCcys.map((_,i)=>ebitdaTotal*(ebitdaAlloc[foreignCcys[i]]||0)/100/spotArr[i]);
  const naRep    =navTotal*(naAlloc[reportingCcy]||0)/100;
  const ebitdaRep=ebitdaTotal*(ebitdaAlloc[reportingCcy]||0)/100;
  const baseEq   =navTotal-netDebtTotal;
  const scResults=[];
  for(let sc=0;sc<scenarios.length;sc++){
    const da=scenarios[sc];
    const debtLocal=foreignCcys.map((_,i)=>netDebtTotal*(da[foreignCcys[i]]||0)/100/spotArr[i]);
    const debtRep  =netDebtTotal*(da[reportingCcy]||0)/100;
    const dEs=[],levs=[];
    for(let s=0;s<nSims;s++){
      let na=naRep,eb=ebitdaRep,dt=debtRep;
      for(let i=0;i<nF;i++){na+=naLocal[i]*paths[s][i];eb+=ebitdaLocal[i]*paths[s][i];dt+=debtLocal[i]*paths[s][i];}
      dEs.push(na-dt-baseEq);
      levs.push(eb>0?dt/eb:99);
    }
    const res={debtAlloc:da,
      de_p1:pctile(dEs,1),de_p5:pctile(dEs,5),de_p10:pctile(dEs,10),
      de_p50:pctile(dEs,50),de_p99:pctile(dEs,99),
      lev_p50:pctile(levs,50),lev_p90:pctile(levs,90),
      lev_p95:pctile(levs,95),lev_p99:pctile(levs,99)};
    if(sc===0) res.scatterDE=dEs, res.scatterLev=levs;
    scResults.push(res);
    if(sc%Math.max(1,Math.floor(scenarios.length/40))===0)
      self.postMessage({type:'progress',value:Math.round(sc/scenarios.length*100)});
  }
  self.postMessage({type:'done',results:scResults,
    paths:paths,naLocal:naLocal,ebitdaLocal:ebitdaLocal,
    naRep:naRep,ebitdaRep:ebitdaRep,baseEq:baseEq,spotArr:spotArr});
};
