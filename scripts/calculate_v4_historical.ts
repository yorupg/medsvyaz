/** Final v4 release: route every dataset; never convert aggregate indices. */
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {calculate,compareScenario,summarizePoints} from '../shared/engine';
import {METHODOLOGY,type Dataset,type IndexResult} from '../shared/schema';
import {studyDatasets,studyCatalogue,realRegionIds,scenariosFor} from '../server/study';
import {expandedSummaries} from '../server/expanded';
const write=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
mkdirSync('data/derived/v4-baselines',{recursive:true});
const reports:any[]=[],pilots:Record<string,unknown>={},audits:Record<string,unknown>={},comparisons:any[]=[];
const names=Object.fromEntries(JSON.parse(readFileSync('data/regions.json','utf8')).map((r:any)=>[r.id,r.name]));
const suspicious=/администрац|поликлин|диспансер|диагност|дневно[йг]|детск|реабилит|туберк|псих|онкол|инфекц|родил|перинат|стомат|отделени|корпус/i;
function subsetAudit(d:Dataset,baseline:IndexResult,keep:string[]){
 if(!keep.length)return {index:null,delta:null,settlements:baseline.includedSettlements,reason:'Нет площадок в подмножестве'};
 const after=keep.length===d.facilities.length?baseline:calculate({...d,facilities:d.facilities.filter(f=>keep.includes(f.id)),metadata:{...d.metadata,scenarioUnreachability:true,confirmedUnreachableIds:baseline.points.filter(p=>p.status==='reachable').map(p=>p.id)}});
 assert.equal(after.denominator,baseline.denominator);assert(after.value!<=baseline.value!+1e-9);
 return {index:after.value,delta:after.value!-baseline.value!,settlements:after.includedSettlements,population:after.population,lostRoutePopulation:after.unreachablePopulation,lostRouteSettlements:after.unreachableSettlements};
}
for(const regionId of Object.keys(studyCatalogue)){
 const d=studyDatasets[regionId],r=calculate(d);
 const old=summarizePoints(d,r.points,{methodologyVersion:'3.0.0'}),legacy=summarizePoints(d,r.points,{methodologyVersion:'2.0.0'});
 assert.equal(r.methodologyVersion,'4.0.0');assert.equal(r.denominator,r.includedSettlements);
 // Keep times, source weights and IDs; no large route arrays in the baseline cache.
 write('data/derived/v4-baselines/'+regionId+'.json',{...r,points:r.points.map(p=>({...p,path:[]}))});
 const row={regionId,synthetic:d.synthetic,status:r.status,label:d.synthetic?'Синтетическая модель':'Реальные данные',datasetId:d.id,version:d.version,profile:d.profile,index:r.value,indexTau60:legacy.value,indexPopulation30:old.value,methodologyVersion:r.methodologyVersion,weighting:r.weighting,threshold:r.threshold,population:r.population,sourcePopulation:d.expectedPopulation,coverage:r.populationCoverage,settlementCoverage:r.settlementCoverage,excludedPopulation:r.excludedPopulation,indexBounds:r.indexBounds,medianMinutes:r.medianMinutes,p90Minutes:r.p90Minutes,overMinutesShares:r.overMinutesShares,facilityEvidence:r.facilityEvidence,settlements:d.settlements.length,includedSettlements:r.includedSettlements,facilities:d.facilities.length,unverifiedRoutes:r.unverifiedRoutes};
 reports.push(row);comparisons.push({regionId,name:names[regionId],synthetic:d.synthetic,before:old.value,after:r.value,delta:r.value!-old.value!,coverage:r.settlementCoverage,medianMinutes:r.medianMinutes,p90Minutes:r.p90Minutes,overMinutesShares:r.overMinutesShares,facilityEvidence:r.facilityEvidence});
 const sensitivity=METHODOLOGY.allowedThresholds.flatMap(threshold=>[.8,1,1.2].map(timeScale=>{const scaled=r.points.map(p=>({...p,minutes:p.minutes===null?null:p.minutes*timeScale}));const x=summarizePoints(d,scaled,{threshold});return {threshold,timeScale,index:x.value,meanMinutes:x.meanMinutes,medianMinutes:x.medianMinutes,p90Minutes:x.p90Minutes,overMinutesShares:x.overMinutesShares};}));
 if(!d.synthetic){
  // Compare per-origin times against the pre-existing independent SciPy calculation.
  const prefix=regionId==='kaliningrad'?'pilot':regionId;
  const independent=expandedSummaries[regionId]?.baselinePoints??JSON.parse(readFileSync('data/derived/'+prefix+'-independent-points.json','utf8'));
  const byId=new Map<string,any>(independent.map((p:any)=>[p.id,p]));
  for(const p of r.points){const reference=byId.get(p.id);assert(reference,regionId+':'+p.id);if(p.minutes!==null&&reference.minutes!==null)assert(Math.abs(p.minutes-reference.minutes)<1e-6,regionId+' independent route time');}
  const edges=scenariosFor(d).slice(0,process.argv.includes('--full-scenarios')?10:1);
  const scenarios=edges.map(edge=>({edge,baseline:{index:r.value,settlements:r.includedSettlements},...Object.fromEntries(['improvement','closure'].map(scenario=>{const c=compareScenario(d,{scenario:scenario as 'improvement'|'closure',edgeId:edge.id});assert.equal(c.baseline.denominator,c.after.denominator);assert(c.delta!==null&&(scenario==='improvement'?c.delta>=-1e-9:c.delta<=1e-9));return [scenario,{index:c.after.value,delta:c.delta,affectedPopulation:c.affectedPopulation,settlements:c.after.includedSettlements,unreachableSettlements:c.after.unreachableSettlements,medianMinutes:c.after.medianMinutes,p90Minutes:c.after.p90Minutes,overMinutesShares:c.after.overMinutesShares}];}))}));
  const excluded=d.facilities.filter(f=>suspicious.test(f.name)),influence=new Map<string,number>();for(const p of r.points)if(p.score!==null&&p.facilityId)influence.set(p.facilityId,(influence.get(p.facilityId)??0)+1);
  const dominant=[...influence].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
  audits[regionId]={methodologyVersion:'4.0.0',weighting:'settlement',facilityEvidence:r.facilityEvidence,baselineIndex:r.value,facilityCount:d.facilities.length,officialProfileOnly:r.facilityEvidence==='osm-unverified-profile'?null:r.value,strictExcluded:excluded.map(f=>({id:f.id,name:f.name,sourceUrl:f.sourceUrl})),strictSelection:subsetAudit(d,r,d.facilities.filter(f=>!excluded.includes(f)).map(f=>f.id)),dominantFacility:d.facilities.find(f=>f.id===dominant)?.name??null,withoutDominant:subsetAudit(d,r,d.facilities.filter(f=>f.id!==dominant).map(f=>f.id)),populationCoverage:r.populationCoverage,settlementCoverage:r.settlementCoverage,excludedPopulation:r.excludedPopulation,indexBounds:r.indexBounds};
  pilots[regionId]={profile:d.profile,methodologyVersion:METHODOLOGY.version,threshold:30,sensitivity,scenarios,independentCheck:'data/derived/v4-independent-checks.json'};
 }
 console.log(regionId,r.value?.toFixed(6),r.includedSettlements,'settlements');
}
const summary={methodologyVersion:METHODOLOGY.version,weighting:'settlement',defaultThreshold:30,sensitivityThresholds:METHODOLOGY.allowedThresholds,preparedAt:'2026-11-10',nationalIndex:null,profiles:[...new Set(reports.filter(r=>!r.synthetic).map(r=>r.profile))],reports:reports.filter(r=>!r.synthetic),pilots,syntheticExamples:reports.filter(r=>r.synthetic)};
for(const dir of ['data/derived','public/downloads']){
 write(dir+'/study-summary.json',summary);write(dir+'/facility-selection-audit.json',audits);
 write(dir+'/methodology-comparison.json',{before:{version:'3.0.0',weighting:'population',tau:30},after:{version:'4.0.0',weighting:'settlement',tau:30},rows:comparisons.filter(r=>!r.synthetic)});
 write(dir+'/synthetic-methodology-comparison.json',{synthetic:true,rows:comparisons.filter(r=>r.synthetic)});
}
const csv=(rows:unknown[][])=>'\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n')+'\r\n';
for(const synthetic of [false,true]){
 const group=reports.filter(r=>r.synthetic===synthetic),comp=comparisons.filter(r=>r.synthetic===synthetic);
 writeFileSync('public/downloads/'+(synthetic?'synthetic':'observed')+'-regional-indices.csv',csv([['Регион','МИЭД v4.0, τ=30, равные веса поселений','Поселений в расчете','Всего поселений','Покрытие поселений','Тип данных'],...group.map(r=>[names[r.regionId],r.index,r.includedSettlements,r.settlements,r.settlementCoverage,r.label])]));
 writeFileSync('public/downloads/'+(synthetic?'synthetic-indices-before-after.csv':'regional-indices-before-after.csv'),csv([['Регион','v3.0: по населению, τ=30','v4.0: по поселениям, τ=30','Изменение, баллы','Покрытие поселений'],...comp.map(r=>[r.name,r.before,r.after,r.delta,r.coverage])]));
}
console.log('Final v4: all 85 road graphs recalculated; equal settlement weights, tau=30.');
