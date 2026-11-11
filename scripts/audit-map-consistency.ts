import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {baselineResults,studyDatasets,studyComparison,studyMap,isRealRegion} from '../server/study';
import {accessibility,comfortFor} from '../shared/engine';
import {mapDistribution,pointMapColor} from '../shared/map-metrics';
import {indexColor} from '../shared/schema';
import {transportEffect} from '../shared/economics';
const rows=[];
for(const [id,cached] of Object.entries(baselineResults)){
 const d=studyDatasets[id],baseline=studyComparison(id,{scenario:'baseline'})!.baseline;
 assert(Math.abs(baseline.value!-cached.value!)<1e-8,id+' live graph versus catalogue');
 assert.equal(baseline.denominator,cached.denominator,id+' denominator');
 const distribution=mapDistribution(baseline.points,baseline.value);
 for(const point of baseline.points){
  assert.equal(pointMapColor(point),indexColor(point.score===null?null:100*accessibility(point.minutes,baseline.threshold,comfortFor(baseline.methodologyVersion))),id+':'+point.id+' colour');
 }
 let mapped=0;
 if(isRealRegion(id)){
  const map=studyMap(id,{scenario:'baseline'}),settlements=new Map(d.settlements.map(s=>[s.id,s]));
  assert.equal(map.points.length,baseline.points.length,id+' every point mapped');
  for(const p of map.points){const s=settlements.get(p.id)!;assert.equal(p.lat,s.lat);assert.equal(p.lon,s.lon);assert(Number.isFinite(p.lat)&&Number.isFinite(p.lon));}
  assert(Math.abs(map.distribution.index!-cached.value!)<1e-8,id+' map versus catalogue');mapped=map.points.length;
 }else{
  assert(d.settlements.every(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)),id+' synthetic coordinates');mapped=d.settlements.length;
 }
 const scenarios=[];
 for(const scenario of ['improvement','closure'] as const){
  const comparison=studyComparison(id,{scenario,multiplier:1.5})!;
  mapDistribution(comparison.after.points,comparison.after.value);
  const effect=transportEffect(comparison.baseline,comparison.after,60);
  assert.equal(effect.population,baseline.population,id+' fixed scenario cohort');
  if(scenario==='improvement')assert(effect.deltaIndex!>=-1e-9,id+' improvement monotonicity');
  else assert(effect.deltaIndex!<=1e-9,id+' closure monotonicity');
  scenarios.push({scenario,delta:effect.deltaIndex,newlyCovered:effect.newlyCoveredPopulation,lostCoverage:effect.lostCoveragePopulation});
 }
 rows.push({id,synthetic:d.synthetic,index:baseline.value,catalogueIndex:cached.value,population:baseline.population,mapped,unweightedIndex:distribution.unweightedIndex,bins:distribution.bins,scenarios});
 console.log(id+' OK');
}
const report={date:new Date().toISOString(),methodology:'5.0.0',weighting:'settlement',comfortMinutes:15,tau:40,regions:rows.length,observed:rows.filter(r=>!r.synthetic).length,synthetic:rows.filter(r=>r.synthetic).length,points:rows.reduce((s,r)=>s+r.mapped,0),checks:['Full live graph versus cached catalogue index and denominator','Every map point has source coordinates and the same score colour','Equal-settlement bin contributions reproduce the index','Improvement and closure: fixed settlement cohort, index monotonicity, actual transport effects'],rows};
writeFileSync('public/downloads/map-consistency-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({regions:report.regions,points:report.points,observed:report.observed,synthetic:report.synthetic}));
