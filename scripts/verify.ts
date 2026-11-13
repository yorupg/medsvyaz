import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApi} from '../server/api';
import regions from '../data/regions.json';
import geometries from '../data/processed/geometries.json';
import sources from '../data/sources.json';
import {studyCatalogue,baselineResults,realRegionIds,syntheticDatasets} from '../server/study';
import {regionStyle,regionTooltip,NO_DATA_TERRITORIES} from '../shared/map-style';
import {METHODOLOGY,type Region} from '../shared/schema';
assert.equal(regions.length,89);assert.equal(geometries.features.length,89);
assert.equal(new Set(regions.map(r=>r.id)).size,89);
assert.equal(new Set(geometries.features.map(f=>f.properties.regionId)).size,89);
assert.equal(realRegionIds.length,33);assert.equal(Object.keys(syntheticDatasets).length,52);
const sourceIds=new Set(sources.map(s=>s.id));
for(const [id,d] of Object.entries(studyCatalogue)){
 assert(d.sourceIds.every(s=>sourceIds.has(s)),id+' sources');
 const result=baselineResults[id];assert(result.value!==null&&result.value>=0&&result.value<=100,id);
 assert.equal(result.synthetic,d.synthetic,id);
 if(!d.synthetic){
  const check=JSON.parse(readFileSync('data/derived/v6-extended/'+id+'.json','utf8'));
  const historicalTimes=JSON.parse(readFileSync('data/derived/v5-independent-checks.json','utf8'))[id];
  assert.equal(result.methodologyVersion,METHODOLOGY.version);assert.equal(result.threshold,check.tau);
  assert(Math.abs(result.medianMinutes!-historicalTimes.medianMinutes)<1e-6,id+' median');
  assert(Math.abs(result.p90Minutes!-historicalTimes.p90Minutes)<1e-6,id+' P90');
  for(const limit of ['60','90'] as const)assert(Math.abs(result.overMinutesShares[limit]!-historicalTimes.overMinutesShares[limit])<1e-12,id+' tail share');
  if(result.methodologyVersion==='6.1.0'&&result.missingSettlements>0)assert.deepEqual(result.indexBounds,{lower:null,upper:null},id+' unidentified bounds');
  assert(Math.abs(result.value-check.value)<1e-9,id+' independent index');
  assert.equal(result.population,check.includedPopulation,id+' independent population');
  assert.equal(result.includedSettlements,check.includedSettlements,id+' independent settlements');
 }
}
const app=createApi();
for(const path of ['/health','/regions','/geometry','/study-scope','/national-index','/dashboard?scope=russia']){
 const response=await app.request(path);assert.equal(response.status,200,path);assert(await response.json());
}
const apiRegions=await (await app.request('/regions')).json() as Region[];
for(const region of apiRegions){
 const response=await app.request('/regions/'+region.id+'/index');assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.value,region.indexValue,region.id);
 if(NO_DATA_TERRITORIES.has(region.id)){
  assert.equal(region.indexValue,null);assert.equal(studyCatalogue[region.id],undefined);
  assert(regionStyle(region,region.id,true,true).weight<1);
 }else assert(!regionTooltip(region,region.name).includes('не рассчитан'));
}
const national=await (await app.request('/national-index')).json();
assert.equal(national.value,null);assert.equal(national.includedRegions,33);assert.equal(national.cohorts.length,2);
console.log('OK: 89 геометрий, 33 реальных набора, 52 синтетические модели, 4 территории без данных; независимые индексы, население, источники и API проверены.');
