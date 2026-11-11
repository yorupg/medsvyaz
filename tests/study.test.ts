import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createApi} from '../server/api';
import {pilot,studyDatasets,studyCatalogue,baselineResults,studyComparison,pilotScenarioEdges,realRegionIds,syntheticDatasets} from '../server/study';
import {aggregate,calculate,summarizePoints} from '../shared/engine';
import {RELEASE} from '../shared/release';
import {regionStyle,regionTooltip,NO_DATA_TERRITORIES} from '../shared/map-style';
import {indexColor,type Region} from '../shared/schema';
const app=createApi();
describe('Observed regional data, catalogue and maps',()=>{
 it('recalculates all 85 models from origin times and reproduces the archived legacy values',()=>{
  const legacy=JSON.parse(readFileSync('public/downloads/archive/mied-v2-tau60/study-summary.json','utf8'));
  const previous=new Map([...legacy.reports,...legacy.syntheticExamples].map((r:{regionId:string;index:number})=>[r.regionId,r.index]));
  for(const [id,r] of Object.entries(baselineResults)){
   const old=summarizePoints(studyCatalogue[id],r.points,{methodologyVersion:'2.0.0'});
   expect(old.value,id).toBeCloseTo(previous.get(id) as number,9);
   expect(r.methodologyVersion,id).toBe('5.0.0');expect(r.threshold).toBe(40);expect(r.value!,id).toBeGreaterThanOrEqual(0);
   expect(r.p90Minutes===null||r.p90Minutes>=r.medianMinutes!).toBe(true);
  }
 });
 it('serves both methodology versions and exposes OSM profile evidence and missing-population bounds',async()=>{
  const current=await (await app.request('/regions/bryansk/index')).json();
  const old=await (await app.request('/regions/bryansk/index?methodologyVersion=2.0.0')).json();
  expect(current.threshold).toBe(40);expect(old.threshold).toBe(60);expect(current.value).toBeLessThan(old.value);
  expect(current.facilityEvidence).toBe('osm-unverified-profile');expect(current.indexBounds.lower).toBeLessThanOrEqual(current.value);
  const comparison=await (await app.request('/methodology-comparison')).json();expect(comparison.rows).toHaveLength(33);
  expect(comparison.rows.every((r:{synthetic:boolean})=>!r.synthetic)).toBe(true);
 });
 it('exposes calculated indices for every model through the regional API',async()=>{
  const regions=await (await app.request('/regions')).json() as Region[];
  expect(regions).toHaveLength(89);
  for(const region of regions){
   const result=await (await app.request('/regions/'+region.id+'/index')).json();
   expect(result.value,region.id).toBe(region.indexValue);
   if(NO_DATA_TERRITORIES.has(region.id)){expect(result.value).toBeNull();continue;}
   expect(result.value,region.id).toBeGreaterThanOrEqual(0);expect(result.value).toBeLessThanOrEqual(100);
   expect(result.synthetic).toBe(region.synthetic);
   expect(regionTooltip(region,region.name)).not.toMatch(/не рассчитан/i);
  }
 });
 it('contains 33 observed regions, 52 synthetic models and 4 no-data territories',async()=>{
  const body=await (await app.request('/dashboard?scope=russia')).json();
  expect(body.results).toHaveLength(85);expect(body.realResults).toHaveLength(33);expect(body.syntheticResults).toHaveLength(52);
  expect(body.realCalculatedRegions).toBe(33);expect(body.syntheticCalculatedRegions).toBe(52);
  expect(body.summary.value).toBeNull();expect(body.summary.cohorts).toHaveLength(2);
  expect(realRegionIds).toHaveLength(33);expect(Object.keys(syntheticDatasets)).toHaveLength(52);
 });
 it('publishes the selected 33 with source-backed calculations',async()=>{
  const scope=await (await app.request('/study-scope')).json();
  expect(scope.methodologyVersion).toBe('5.0.0');expect(scope.regions).toHaveLength(33);
  expect(scope.regions.every((r:{result:{value:number|null;synthetic:boolean}})=>r.result.value!==null&&!r.result.synthetic)).toBe(true);
 });
 it('has live dashboard results matching the catalogue in representative observed and synthetic regions',async()=>{
  for(const id of ['kaliningrad','bryansk','murmansk','mordovia','tyumen','saint-petersburg']){
   const response=await app.request('/dashboard?scope='+id+'&edgeId=ce');expect(response.status,id).toBe(200);
   const body=await response.json();expect(body.after.value,id).toBeCloseTo(baselineResults[id].value!,9);
   expect(body.synthetic).toBe(studyCatalogue[id].synthetic);expect(body.results).toHaveLength(1);
  }
 },60000);
 it('matches the independently computed population and index for all 33 observed regions',async()=>{
  const sources=new Set((await (await app.request('/sources')).json()).map((s:{id:string})=>s.id));
  for(const id of realRegionIds){
   const check=JSON.parse(readFileSync('data/derived/v5-independent-checks.json','utf8'))[id];
   const r=baselineResults[id],d=studyCatalogue[id];
   expect(r.value,id).toBeCloseTo(check.index,9);expect(r.population,id).toBe(check.includedPopulation);
   expect(r.includedSettlements,id).toBe(check.includedSettlements);expect(r.synthetic).toBe(false);
   expect(d.sourceIds.every(s=>sources.has(s)),id).toBe(true);
   expect(d.facilities.every(f=>f.verified&&f.sourceUrl&&f.osmId&&Number.isFinite(f.lat)&&Number.isFinite(f.lon)),id).toBe(true);
   expect(r.populationCoverage,id).toBeGreaterThan(.93);expect(r.populationCoverage).toBeLessThanOrEqual(1);
  }
 });
 it('keeps no-data territories grey and subtly dashed even when selected or hovered',async()=>{
  for(const id of NO_DATA_TERRITORIES){
   const r=await (await app.request('/regions/'+id)).json() as Region;
   expect(studyCatalogue[id]).toBeUndefined();expect(r.dataStatus).toBe('no_data');expect(r.indexValue).toBeNull();
   const border=await (await app.request('/regions/'+id+'/geometry')).json();expect(border.features).toHaveLength(1);
   for(const selected of [false,true])for(const hovered of [false,true]){
    const style=regionStyle(r,id,selected,hovered);expect(style.weight).toBeLessThan(1);
    expect(style.dashArray).toBeDefined();expect(style.fillColor).toBe(indexColor(null));
   }
  }
 });
 it('preserves index colours on hover and outlines observed data more strongly',()=>{
  const observed={id:'a',datasetId:'real-a',synthetic:false,indexValue:82} as Region;
  const synthetic={...observed,id:'b',synthetic:true} as Region;
  expect(regionStyle(observed,'a').weight).toBeGreaterThan(regionStyle(synthetic,'b').weight);
  expect(regionStyle(observed,'a',true,true).fillColor).toBe(indexColor(82));
  expect(regionStyle(synthetic,'b',false,true).fillColor).toBe(indexColor(82));
  expect(indexColor(0)).toBe('#da6667');expect(indexColor(100)).toBe('#2b9978');
  expect(indexColor(81)).not.toBe(indexColor(89));expect(indexColor(NaN)).toBe(indexColor(null));
 });
 it('keeps real and synthetic profiles in separate aggregates',async()=>{
  expect(()=>aggregate([baselineResults.kaliningrad,baselineResults.tyumen])).toThrow(/Несопоставимые/);
  expect(()=>aggregate([baselineResults.kaliningrad,baselineResults.bryansk])).toThrow(/Несопоставимые/);
  const result=await (await app.request('/national-index')).json();expect(result.value).toBeNull();
  expect(result.includedRegions).toBe(33);expect(result.cohorts).toHaveLength(2);
  expect(result.cohorts.map((c:{regions:number})=>c.regions).sort((a:number,b:number)=>a-b)).toEqual([3,30]);
 });
 it('returns actual marker coordinates and continuous correctly oriented route segments',async()=>{
  const map=await (await app.request('/study/kaliningrad/map')).json();expect(map.synthetic).toBe(false);
  expect(map.points).toHaveLength(pilot.settlements.length);expect(map.facilities).toHaveLength(10);
  const point=baselineResults.kaliningrad.points.find(p=>p.status==='reachable'&&p.population!>1000)!;
  const route=await (await app.request('/study/kaliningrad/route/'+point.id)).json();
  expect(route.coordinates.length).toBeGreaterThan(0);
  const origin=pilot.settlements.find(p=>p.id===point.id)!;
  expect(route.coordinates[0].coordinates[0]).toEqual([origin.lon,origin.lat]);
  for(let i=1;i<route.coordinates.length;i++){
   const previous=route.coordinates[i-1].coordinates.at(-1),next=route.coordinates[i].coordinates[0];
   expect(previous[0]).toBeCloseTo(next[0],6);expect(previous[1]).toBeCloseTo(next[1],6);
  }
 });
 it('does not claim a verified night-time profile',async()=>{
  for(const id of ['kaliningrad','ivanovo','pskov','bryansk'])expect((await app.request('/study/'+id+'/compare?period=night')).status).toBe(400);
 });
 it('time sensitivity and OSM road scenarios have the expected mathematical direction',()=>{
  const before=baselineResults.ivanovo;
  expect(calculate(studyDatasets.ivanovo,{timeScale:.8}).value!).toBeGreaterThanOrEqual(before.value!);
  expect(calculate(studyDatasets.ivanovo,{timeScale:1.2}).value!).toBeLessThanOrEqual(before.value!);
  const edgeId=pilotScenarioEdges[1].id;
  expect(studyComparison('kaliningrad',{scenario:'improvement',edgeId})!.delta!).toBeGreaterThanOrEqual(0);
  const closed=studyComparison('kaliningrad',{scenario:'closure',edgeId})!;
  expect(closed.after.population).toBe(closed.baseline.population);expect(closed.delta!).toBeLessThanOrEqual(0);
 });
 it('uses real named localities in all synthetic models and finite region-specific assumptions',()=>{
  for(const [id,d] of Object.entries(syntheticDatasets)){
   expect(d.metadata?.observedSettlements,id).toBe(true);
   expect(d.settlements.every(p=>p.population!==null&&p.population>=10&&Number.isFinite(p.lat)&&Number.isFinite(p.lon))).toBe(true);
   expect(d.settlements.some(p=>p.name.startsWith('Условное поселение')),id).toBe(false);
   expect(d.facilities.every(f=>!f.verified)).toBe(true);
   expect(baselineResults[id].unreachableSettlements,id).toBe(0);
   for(const edge of d.edges){expect(edge.minutes).toBeGreaterThan(0);expect(edge.lengthKm!).toBeGreaterThan(0);}
  }
  expect(syntheticDatasets['saint-petersburg'].settlements).toHaveLength(30);
  for(const id of ['moscow','saint-petersburg'])expect(syntheticDatasets[id].settlements.some(p=>p.id.startsWith('s-urban-core-'))).toBe(true);
  const sakhalin=syntheticDatasets.sakhalin,nodes=new Map(sakhalin.nodes.map(n=>[n.id,n]));
  for(const edge of sakhalin.edges.filter(e=>e.kind==='road'))expect(nodes.get(edge.from)!.x<144).toBe(nodes.get(edge.to)!.x<144);
 });
 it('prevents stale cached regional API responses',async()=>{
  const response=await app.request('/regions');expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-MedSvyaz-Version')).toBe(RELEASE);
 });
});
