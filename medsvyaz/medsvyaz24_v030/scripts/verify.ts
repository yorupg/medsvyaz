/** Node-only verification independent of Vite/Rollup native binaries. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculate,compareScenario,validateDataset} from '../shared/engine';
import {createApi} from '../server/api';
import regions from '../data/regions.json';
import geometries from '../data/processed/geometries.json';
import points from '../data/derived/representative-points.json';
import manifest from '../data/examples/manifest.json';
import {studyDatasets,baselineResults,pilot,realDatasets} from '../server/study';
assert.equal(regions.length,89);
assert.equal(geometries.features.length,89);
assert.equal(new Set(geometries.features.map(f=>f.properties.regionId)).size,89);
assert.equal(new Set(regions.map(r=>r.id)).size,89);
assert.equal(Object.keys(points).length,89);
for(const f of geometries.features){assert(regions.some(r=>r.id===f.properties.regionId)); assert(f.geometry.coordinates.length>0);}
for(const r of regions){assert.equal(Boolean(r.isoCode),geometries.features.some(f=>f.properties.regionId===r.id));}
const app=createApi();
for(const path of ['/health','/regions','/geometry','/geo-summary','/examples','/examples/ivanovo/dataset','/examples/tyumen/compare','/regions/kaliningrad/index']){
 const response=await app.request('http://localhost'+path);assert.equal(response.status,200,path);
 const body=await response.json();assert(body!==null);
}
for(const e of manifest){
 const data=await (await app.request('http://localhost/examples/'+e.regionId+'/dataset')).json();
 const dataset=validateDataset(data);assert.equal(dataset.synthetic,true);
 const baseline=calculate(dataset,{threshold:60});
 assert(baseline.value!==null&&baseline.value>=0&&baseline.value<=100);
 assert.equal(baseline.population,dataset.expectedPopulation);
 const improve=compareScenario(dataset,{scenario:'improvement',edgeId:'ce',multiplier:1.5});
 const close=compareScenario(dataset,{scenario:'closure',edgeId:'ce'});
 assert(improve.delta!==null&&improve.delta>=0);
 assert(close.delta!==null&&close.delta<=0);
 const endpoint=await (await app.request('http://localhost/examples/'+e.regionId+'/compare?scenario=improvement')).json();
 assert.equal(endpoint.after.value,improve.after.value);
}
assert.equal((await app.request('http://localhost/examples/unknown/dataset')).status,404);
assert.equal((await app.request('http://localhost/examples/unknown/compare')).status,404);
assert.equal((await app.request('http://localhost/regions/kaliningrad/index')).status,200);
const independent=JSON.parse(readFileSync('data/derived/pilot-independent-check.json','utf8'));
assert(Math.abs(baselineResults.kaliningrad.value!-independent.index)<1e-9);
assert.equal(pilot.settlements.length,1098);assert.equal(pilot.facilities.length,10);
assert.equal(Object.values(studyDatasets).filter(d=>d.synthetic).length,86);
assert.equal((await app.request('http://localhost/study/kaliningrad/compare?period=night')).status,400);
const national=await (await app.request('http://localhost/national-index')).json();assert.equal(national.value,null);assert.equal(national.includedRegions,3);
for(const [id,d] of Object.entries(realDatasets)){
 const file=id==='kaliningrad'?'pilot':id;const check=JSON.parse(readFileSync('data/derived/'+file+'-independent-check.json','utf8'));const r=baselineResults[id];
 assert(Math.abs(r.value!-check.index)<1e-9,id);assert.equal(r.population,check.includedPopulation);assert.equal(r.includedSettlements,check.includedSettlements);
 assert.equal((await app.request('http://localhost/study/'+id+'/map')).status,200);
}
console.log('OK: 89 геометрий, 89 регионов, 3 реальных пилота, 86 сценарных моделей; три независимые проверки SciPy, API.');
