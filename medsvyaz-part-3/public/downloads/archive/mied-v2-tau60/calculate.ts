/** Recompute all observed regions, verify every point, export reproducible summaries. */
import assert from 'node:assert/strict';
import {writeFileSync,copyFileSync,readFileSync,existsSync} from 'node:fs';
import {calculate,compareScenario} from '../shared/engine';
import {studyDatasets,studyCatalogue,realRegionIds,baselineResults,scenariosFor} from '../server/study';
import {expandedSummaries} from '../server/expanded';
const previous=existsSync('data/derived/study-summary.json')?JSON.parse(readFileSync('data/derived/study-summary.json','utf8')):{pilots:{}};
const reports=Object.entries(studyCatalogue).map(([regionId,d])=>({regionId,synthetic:d.synthetic,status:baselineResults[regionId].status,label:d.synthetic?'Синтетическая модель':'Реальные данные',datasetId:d.id,version:d.version,profile:d.profile,index:baselineResults[regionId].value,population:baselineResults[regionId].population,sourcePopulation:d.expectedPopulation,coverage:baselineResults[regionId].populationCoverage,settlements:d.settlementCount,includedSettlements:baselineResults[regionId].includedSettlements,facilities:d.facilities.length,unverifiedRoutes:baselineResults[regionId].unverifiedRoutes}));
const pilots:Record<string,unknown>={...previous.pilots};
const regionFlag=process.argv.indexOf('--region'),selectedRegion=regionFlag>=0?process.argv[regionFlag+1]:undefined;
if(selectedRegion)assert(realRegionIds.includes(selectedRegion),'Unknown observed region');
for(const regionId of selectedRegion?[selectedRegion]:realRegionIds){
 const d=studyDatasets[regionId],result=calculate(d),prefix=regionId==='kaliningrad'?'pilot':regionId;
 const check=JSON.parse(readFileSync('data/derived/'+prefix+'-independent-check.json','utf8'));
 assert(Math.abs(result.value!-check.index)<1e-9,regionId+' index');
 assert.equal(result.population,check.includedPopulation,regionId+' population');
 assert.equal(result.includedSettlements,check.includedSettlements,regionId+' settlements');
 const independentPoints=expandedSummaries[regionId]?.baselinePoints??JSON.parse(readFileSync('data/derived/'+prefix+'-independent-points.json','utf8')) as {id:string;minutes:number|null;population:number|null;status:string}[];
 const pointCheck=new Map(independentPoints.map(p=>[p.id,p]));
 for(const point of result.points){
  const reference=pointCheck.get(point.id);assert(reference,regionId+' point '+point.id);
  assert.equal(point.population,reference.population,regionId+' population '+point.id);
  assert.equal(point.status,reference.status,regionId+' route status '+point.id);
  if(point.minutes===null)assert.equal(reference.minutes,null,regionId+' time '+point.id);
  else assert(reference.minutes!==null&&Math.abs(point.minutes-reference.minutes)<1e-6,regionId+' time '+point.id);
 }
 const sensitivity=[30,45,60,90].flatMap(threshold=>[.8,1,1.2].map(timeScale=>{
  const reachable=result.points.filter(p=>p.minutes!==null&&p.score!==null);
  return {threshold,timeScale,index:result.population?100*reachable.reduce((sum,p)=>sum+(p.population??0)*2**(-p.minutes!*timeScale/threshold),0)/result.population:null,
   withinThresholdShare:result.population?reachable.filter(p=>p.minutes!*timeScale<=threshold).reduce((sum,p)=>sum+(p.population??0),0)/result.population:null,
   meanMinutes:result.meanMinutes===null?null:result.meanMinutes*timeScale};
 }));
 const pointsOnly=process.argv.includes('--verify-points-only');
 const edges=pointsOnly?[]:scenariosFor(d).slice(0,process.argv.includes('--full-scenarios')?10:1);
 const scenarios=pointsOnly?previous.pilots[regionId]?.scenarios??[]:edges.map(edge=>({edge,...Object.fromEntries(['improvement','closure'].map(scenario=>{
  const c=compareScenario(d,{scenario:scenario as 'improvement'|'closure',edgeId:edge.id});
  if(c.delta!==null)assert(scenario==='improvement'?c.delta>=-1e-9:c.delta<=1e-9,regionId+' scenario direction');
  return [scenario,{index:c.after.value,delta:c.delta,affectedPopulation:c.affectedPopulation,population:c.after.population,unreachableSettlements:c.after.unreachableSettlements}];
 }))}));
 pilots[regionId]={profile:d.profile,sensitivity,scenarios,independentCheck:'data/derived/'+prefix+'-independent-check.json'};
 console.log(regionId,result.value?.toFixed(6),'population',result.population,'coverage',result.populationCoverage?.toFixed(6));
}
const summary={methodologyVersion:'2.0.0',preparedAt:'2026-11-10',nationalIndex:null,
 profiles:[...new Set(reports.filter(r=>!r.synthetic).map(r=>r.profile))],
 reports:reports.filter(r=>!r.synthetic),pilots,syntheticExamples:reports.filter(r=>r.synthetic)};
writeFileSync('data/derived/study-summary.json',JSON.stringify(summary,null,2)+'\n');
for(const f of ['study-summary.json','synthetic-calibration.json'])copyFileSync('data/derived/'+f,'public/downloads/'+f);
console.log('Verified',realRegionIds.length,'observed regions;',reports.filter(r=>r.synthetic).length,'synthetic models.');
