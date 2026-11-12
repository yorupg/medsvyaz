import {describe,it,expect} from 'vitest';
import {analyzeAccessibilityGaps} from '../server/ml';
import type {Dataset,IndexResult} from '../shared/schema';

function sample(n=45){
 const settlements=Array.from({length:n},(_,i)=>({
  id:'town-'+i,name:'Поселение '+i,municipality:'Район',nodeId:'node-'+i,
  population:100,provenance:'test',lat:55+(i%9)*0.005,lon:37+Math.floor(i/9)*0.005
 }));
 const facilities=[{id:'hospital',name:'Больница 1',nodeId:'node-hospital',lat:55.02,lon:37.02,
  profile:'general',periods:['day' as const],verified:true,provenance:'test'}];
 const dataset={regionId:'sample',synthetic:false,profile:'general',settlements,facilities} as Dataset;
 const points=settlements.map((s,i)=>({id:s.id,name:s.name,municipality:s.municipality,
  population:s.population,minutes:i===17?100:17,score:i===17 ? .1 : .94,
  status:'reachable' as const,facilityId:'hospital',path:[]}));
 const result={points,period:'day',threshold:40} as unknown as IndexResult;
 return {dataset,result};
}

describe('ML: неожиданно низкая доступность',()=>{
 it('finds the intentionally low road score and exposes nearby hospital and route data',()=>{
  const {dataset,result}=sample();const analysis=analyzeAccessibilityGaps(dataset,result);
  expect(analysis.status).toBe('ok');
  expect(analysis.samples).toBe(45);
  expect(analysis.trainingSamples).toBe(45);
  expect(analysis.maePoints).not.toBeNull();
  expect(analysis.anomalies[0]?.id).toBe('town-17');
  expect(analysis.anomalies[0]?.gapPoints).toBeGreaterThan(50);
  expect(analysis.anomalies[0]?.nearestFacilityName).toBe('Больница 1');
  expect(analysis.anomalies[0]?.routeFacilityName).toBe('Больница 1');
  expect(analysis.anomalies[0]?.nearestDistanceKm).toBeGreaterThanOrEqual(0);
 });
 it('does not train on a missing or unverified road route',()=>{
  const {dataset,result}=sample();
  result.points[17].status='route_unverified';result.points[17].score=null;result.points[17].minutes=null;
  const analysis=analyzeAccessibilityGaps(dataset,result);
  expect(analysis.samples).toBe(44);
  expect(analysis.anomalies.some(p=>p.id==='town-17')).toBe(false);
 });
 it('refuses to invent ML output on too small a sample',()=>{
  const {dataset,result}=sample(12);const analysis=analyzeAccessibilityGaps(dataset,result);
  expect(analysis.status).toBe('insufficient_data');
  expect(analysis.anomalies).toEqual([]);
 });
 it('is deterministic on the same inputs',()=>{
  const {dataset,result}=sample();
  expect(analyzeAccessibilityGaps(dataset,result)).toEqual(analyzeAccessibilityGaps(dataset,result));
 });
});
