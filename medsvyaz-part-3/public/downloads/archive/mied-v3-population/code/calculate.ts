/** Recompute graphs, verify per-origin times, and evaluate both methodology versions. */
import assert from 'node:assert/strict';
import {writeFileSync,copyFileSync,readFileSync} from 'node:fs';
import {calculate,compareScenario,summarizePoints} from '../shared/engine';
import {METHODOLOGY,type Dataset,type IndexResult} from '../shared/schema';
import {studyDatasets,studyCatalogue,realRegionIds,baselineResults,scenariosFor} from '../server/study';
import {expandedSummaries} from '../server/expanded';
const write=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const report=(regionId:string)=>{
 const d=studyCatalogue[regionId],r=baselineResults[regionId];
 const legacy=summarizePoints(d,r.points,{methodologyVersion:'2.0.0'});
 return {regionId,synthetic:d.synthetic,status:r.status,label:d.synthetic?'Синтетическая модель':r.facilityEvidence==='osm-unverified-profile'?'Геоданные OSM; медицинский профиль официально не проверен':'Площадки из официальных источников',datasetId:d.id,version:d.version,profile:d.profile,
  index:r.value,indexTau60:legacy.value,methodologyVersion:r.methodologyVersion,threshold:r.threshold,
  population:r.population,sourcePopulation:d.expectedPopulation,coverage:r.populationCoverage,excludedPopulation:r.excludedPopulation,
  indexBounds:r.indexBounds,medianMinutes:r.medianMinutes,p90Minutes:r.p90Minutes,overMinutesShares:r.overMinutesShares,
  facilityEvidence:r.facilityEvidence,settlements:d.settlementCount,includedSettlements:r.includedSettlements,facilities:d.facilities.length,unverifiedRoutes:r.unverifiedRoutes};
};
const reports=Object.keys(studyCatalogue).map(report),pilots:Record<string,unknown>={},audits:Record<string,unknown>={};
const suspicious=/администрац|поликлин|диспансер|диагност|дневно[йг]|детск|реабилит|туберк|псих|онкол|инфекц|родил|перинат|стомат|отделени|корпус/i;
function subsetAudit(d:Dataset,baseline:IndexResult,keep:string[]){
 if(!keep.length)return {index:null,delta:null,population:baseline.population,reason:'Нет площадок в подмножестве; отсутствие официальной проверки не заменяется нулевой доступностью'};
 const after=keep.length===d.facilities.length?baseline:calculate({...d,facilities:d.facilities.filter(f=>keep.includes(f.id)),metadata:{...d.metadata,scenarioUnreachability:true,confirmedUnreachableIds:baseline.points.filter(p=>p.status==='reachable').map(p=>p.id)}});
 assert.equal(after.population,baseline.population,'Facility sensitivity must use the same population');
 const delta=after.value!-baseline.value!;assert(delta<=1e-9,'Removing facilities must not improve accessibility');
 return {index:after.value,delta,population:after.population,lostRoutePopulation:after.unreachablePopulation};
}
for(const regionId of realRegionIds){
 const d=studyDatasets[regionId],result=calculate(d),prefix=regionId==='kaliningrad'?'pilot':regionId;
 const check=JSON.parse(readFileSync('data/derived/'+prefix+'-independent-check-v3.json','utf8'));
 assert(Math.abs(result.value!-check.index)<1e-9,regionId+' index');
 assert.equal(result.population,check.includedPopulation);assert.equal(result.includedSettlements,check.includedSettlements);
 assert(Math.abs(result.p90Minutes!-check.p90Minutes)<1e-6,regionId+' P90');
 assert(Math.abs(result.medianMinutes!-check.medianMinutes)<1e-6,regionId+' median');
 const independentPoints=expandedSummaries[regionId]?.baselinePoints??JSON.parse(readFileSync('data/derived/'+prefix+'-independent-points.json','utf8')) as {id:string;minutes:number|null;population:number|null;status:string}[];
 const pointCheck=new Map(independentPoints.map(p=>[p.id,p]));
 for(const point of result.points){const reference=pointCheck.get(point.id);assert(reference);assert.equal(point.population,reference.population);assert.equal(point.status,reference.status);if(point.minutes===null)assert.equal(reference.minutes,null);else assert(reference.minutes!==null&&Math.abs(point.minutes-reference.minutes)<1e-6,regionId+' time '+point.id);}
 const sensitivity=METHODOLOGY.allowedThresholds.flatMap(threshold=>[.8,1,1.2].map(timeScale=>{
  const scaled=result.points.map(p=>({...p,minutes:p.minutes===null?null:p.minutes*timeScale}));
  const r=summarizePoints(d,scaled,{threshold});
  return {threshold,timeScale,index:r.value,meanMinutes:r.meanMinutes,medianMinutes:r.medianMinutes,p90Minutes:r.p90Minutes,overMinutesShares:r.overMinutesShares};
 }));
 const edges=scenariosFor(d).slice(0,process.argv.includes('--full-scenarios')?10:1);
 const scenarios=edges.map(edge=>({edge,baseline:{index:result.value,population:result.population},...Object.fromEntries(['improvement','closure'].map(scenario=>{
  const c=compareScenario(d,{scenario:scenario as 'improvement'|'closure',edgeId:edge.id});
  assert.equal(c.baseline.population,c.after.population);
  assert(c.delta!==null&&(scenario==='improvement'?c.delta>=-1e-9:c.delta<=1e-9));
  return [scenario,{index:c.after.value,delta:c.delta,affectedPopulation:c.affectedPopulation,population:c.after.population,unreachablePopulation:c.after.unreachablePopulation,medianMinutes:c.after.medianMinutes,p90Minutes:c.after.p90Minutes,overMinutesShares:c.after.overMinutesShares}];
 }))}));
 const excluded=d.facilities.filter(f=>suspicious.test(f.name));
 const influence=new Map<string,number>();for(const p of result.points)if(p.facilityId)influence.set(p.facilityId,(influence.get(p.facilityId)??0)+(p.population??0));
 const dominant=[...influence].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
 audits[regionId]={facilityEvidence:result.facilityEvidence,baselineIndex:result.value,facilityCount:d.facilities.length,
  officialProfileOnly:result.facilityEvidence==='osm-unverified-profile'?null:result.value,
  officialProfileNote:result.facilityEvidence==='osm-unverified-profile'?'Официальная проверка медицинского профиля отсутствует; сценарий только подтверждённых площадок не рассчитывается.':'Подтверждены выбранные стационарные площадки; клиническое направление и фактический приём не подтверждаются.',
  strictExcluded:excluded.map(f=>({id:f.id,name:f.name,sourceUrl:f.sourceUrl})),
  strictSelection:subsetAudit(d,result,d.facilities.filter(f=>!excluded.includes(f)).map(f=>f.id)),
  dominantFacility:d.facilities.find(f=>f.id===dominant)?.name??null,
  withoutDominant:subsetAudit(d,result,d.facilities.filter(f=>f.id!==dominant).map(f=>f.id)),
  populationCoverage:result.populationCoverage,excludedPopulation:result.excludedPopulation,indexBounds:result.indexBounds,
  interpretation:'Facility deletion is a sensitivity experiment on the same baseline population, not evidence of actual closure or correct medical eligibility. Name-based screening cannot validate a clinical profile.'};
 pilots[regionId]={profile:d.profile,methodologyVersion:METHODOLOGY.version,threshold:30,sensitivity,scenarios,independentCheck:'data/derived/'+prefix+'-independent-check-v3.json'};
 console.log(regionId,result.value?.toFixed(6),'verified; strict exclusions',excluded.length);
}
const syntheticComparisons=reports.filter(r=>r.synthetic).map(r=>({regionId:r.regionId,synthetic:true,before:r.indexTau60,after:r.index,delta:r.index!-r.indexTau60!}));
const summary={methodologyVersion:METHODOLOGY.version,defaultThreshold:30,sensitivityThresholds:METHODOLOGY.allowedThresholds,preparedAt:'2026-11-10',nationalIndex:null,
 profiles:[...new Set(reports.filter(r=>!r.synthetic).map(r=>r.profile))],reports:reports.filter(r=>!r.synthetic),pilots,syntheticExamples:reports.filter(r=>r.synthetic)};
for(const directory of ['data/derived','public/downloads']){
 write(directory+'/study-summary.json',summary);write(directory+'/facility-selection-audit.json',audits);write(directory+'/synthetic-methodology-comparison.json',{synthetic:true,rows:syntheticComparisons});
}
copyFileSync('data/derived/synthetic-calibration.json','public/downloads/synthetic-calibration.json');
console.log('Verified 33 road graphs and recomputed all 85 models; methodology v3.0, tau=30.');
