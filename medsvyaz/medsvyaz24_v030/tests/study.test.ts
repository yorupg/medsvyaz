import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createApi} from '../server/api';
import {pilot,studyDatasets,baselineResults,studyComparison,pilotScenarioEdges,realDatasets} from '../server/study';
import {aggregate,calculate} from '../shared/engine';
import {RELEASE} from '../shared/release';
const app=createApi();
describe('Real pilot and synthetic isolation',()=>{
 it('returns calculated values through every regional dashboard entry point',async()=>{
  for(const id of Object.keys(studyDatasets)){
   const response=await app.request('/dashboard?scope='+id+'&edgeId=ce');expect(response.status,id).toBe(200);
   const body=await response.json();expect(body.after.value,id).toBeCloseTo(baselineResults[id].value!,9);
   expect(body.baseline.value,id).toBeCloseTo(baselineResults[id].value!,9);
   expect(body.synthetic,id).toBe(studyDatasets[id].synthetic);expect(body.results).toHaveLength(1);
   const index=await (await app.request('/regions/'+id+'/index')).json();expect(index.value,id).toBeCloseTo(body.after.value,9);
  }
 },15000);
 it('lists all 89 dashboard results while aggregating real data separately',async()=>{
  const response=await app.request('/dashboard?scope=russia');const body=await response.json();
  expect(body.results).toHaveLength(89);expect(body.realResults).toHaveLength(3);expect(body.syntheticResults).toHaveLength(86);
  expect(body.realCalculatedRegions).toBe(3);expect(body.syntheticCalculatedRegions).toBe(86);
 });
 it('prevents old regional API responses from remaining cached',async()=>{
  const response=await app.request('/regions');expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-MedSvyaz-Version')).toBe(RELEASE);
 });
 it('matches independent SciPy shortest paths and census weights',()=>{
  const check=JSON.parse(readFileSync('data/derived/pilot-independent-check.json','utf8'));
  const r=baselineResults.kaliningrad;
  expect(r.synthetic).toBe(false);expect(r.value).toBeCloseTo(check.index,9);
  expect(r.population).toBe(check.includedPopulation);expect(r.includedSettlements).toBe(check.includedSettlements);
  expect(pilot.settlements).toHaveLength(1098);expect(pilot.facilities).toHaveLength(10);
  expect(r.missingSettlements).toBe(25);expect(r.unreachableSettlements).toBe(7);
  expect(r.populationCoverage).toBeLessThan(1);expect(r.status).toBe('partial');
 });
 it('has three real datasets and 86 explicitly synthetic networks',()=>{
  expect(Object.values(studyDatasets)).toHaveLength(89);
  expect(Object.values(studyDatasets).filter(d=>!d.synthetic)).toHaveLength(3);
  for(const [id,d] of Object.entries(studyDatasets)){const r=baselineResults[id];expect(r.synthetic).toBe(d.synthetic);expect(r.value).toBeGreaterThanOrEqual(0);expect(r.value).toBeLessThanOrEqual(100);if(d.synthetic){expect(d.metadata?.seed).toBeTypeOf('number');expect(d.facilities.every(f=>!f.verified)).toBe(true);expect(r.warnings.join(' ')).toContain('Синтетические');}}
 });
 it('never aggregates the pilot with generated regions',()=>{
  expect(()=>aggregate([baselineResults.kaliningrad,baselineResults.tyumen])).toThrow(/Несопоставимые/);
 });
 it('returns real markers and route geometry; synthetic coordinates are unavailable',async()=>{
  const map=await (await app.request('/study/kaliningrad/map')).json();expect(map.synthetic).toBe(false);expect(map.points).toHaveLength(1098);expect(map.facilities).toHaveLength(10);
  const p=baselineResults.kaliningrad.points.find(p=>p.status==='reachable'&&p.population!>1000)!;
  const route=await (await app.request('/study/kaliningrad/route/'+p.id)).json();expect(route.synthetic).toBe(false);expect(route.coordinates.length).toBeGreaterThan(0);expect(route.coordinates[0].coordinates[0]).toHaveLength(2);
  expect((await app.request('/study/tyumen/map')).status).toBe(400);
  expect((await app.request('/study/kaliningrad/compare?period=night')).status).toBe(400);
 });
 it('excludes synthetic results from national coverage',async()=>{
  const r=await (await app.request('/national-index')).json();expect(r.value).toBeNull();expect(r.includedRegions).toBe(3);expect(r.coveredIndex).toBeCloseTo(aggregate(Object.keys(realDatasets).map(id=>baselineResults[id])).value!,9);
 });
 it('applies global time sensitivity without changing population coverage',()=>{
  const r=baselineResults.ivanovo;const fast=calculate(studyDatasets.ivanovo,{timeScale:0.8}),slow=calculate(studyDatasets.ivanovo,{timeScale:1.2});expect(fast.value!).toBeGreaterThanOrEqual(r.value!);expect(slow.value!).toBeLessThanOrEqual(r.value!);expect(slow.population).toBe(r.population);
 });
 it('real OSM-way improvement and closure have the correct direction',()=>{
  const edgeId=pilotScenarioEdges[1].id;
  expect(studyComparison('kaliningrad',{scenario:'improvement',edgeId})!.delta!).toBeGreaterThanOrEqual(0);
  expect(studyComparison('kaliningrad',{scenario:'closure',edgeId})!.delta!).toBeLessThanOrEqual(0);
 });
 it('matches independent routing for every real region and exposes its sources',async()=>{
  const sourceIds=new Set((await (await app.request('/sources')).json()).map((s:{id:string})=>s.id));
  for(const [id,d] of Object.entries(realDatasets)){
   const check=JSON.parse(readFileSync('data/derived/'+(id==='kaliningrad'?'pilot':id)+'-independent-check.json','utf8'));const r=baselineResults[id];
   expect(r.value,id).toBeCloseTo(check.index,9);expect(r.population,id).toBe(check.includedPopulation);expect(r.includedSettlements,id).toBe(check.includedSettlements);
   expect(d.sourceIds.every(s=>sourceIds.has(s))).toBe(true);expect(d.facilities.every(f=>f.verified&&f.officialAddress&&f.sourceUrl&&f.osmId)).toBe(true);
   expect((await app.request('/study/'+id+'/compare?period=night')).status).toBe(400);
  }
 });
 it('uses dimensionally consistent, connected synthetic networks without forced isolated points',()=>{
  for(const [id,d] of Object.entries(studyDatasets).filter(([,d])=>d.synthetic)){
   expect(d.facilities.length).toBeGreaterThanOrEqual(2);expect(baselineResults[id].unreachableSettlements,id).toBe(0);
   expect(d.edges.length).toBeGreaterThan(d.nodes.length-1);expect(d.settlements.every(s=>s.lat!==undefined&&s.lon!==undefined)).toBe(true);
   for(const e of d.edges){expect(e.lengthKm!).toBeGreaterThan(0);const speed=e.lengthKm!/e.minutes*60;expect(speed).toBeGreaterThanOrEqual(19.999);expect(speed).toBeLessThanOrEqual(65.001);}
  }
 });

});
