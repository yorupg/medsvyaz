import {describe,it,expect} from 'vitest';
import {calculate,summarizePoints as currentSummary,accessibility,validateDataset,compareScenario} from '../shared/engine';
import {CalculationSchema,METHODOLOGY,LEGACY_METHODOLOGY,type PointResult} from '../shared/schema';
import demo from '../data/examples/demo.json';
const summarizePoints:typeof currentSummary=(d,p,o={})=>currentSummary(d,p,{methodologyVersion:'3.0.0',...o});
const metadata={id:'times',version:'unchanged-input',sourceIds:['test'],synthetic:false,profile:'mapped-hospital',expectedPopulation:10};
const point=(id:string,minutes:number|null,population:number,status:PointResult['status']='reachable'):PointResult=>({id,name:id,municipality:'m',population,minutes,status,score:999,facilityId:'h',path:[]});
describe('МИЭД v3.0: independent origin-time evaluation',()=>{
 it('versions the new default and preserves the previous methodology',()=>{
  expect(METHODOLOGY.version).toBe('6.1.0');expect(METHODOLOGY.allowedThresholds).toEqual([30,40,50,60]);
  expect(CalculationSchema.parse({}).threshold).toBe(40);
  expect(CalculationSchema.parse({methodologyVersion:'2.0.0'}).threshold).toBe(60);
  expect(LEGACY_METHODOLOGY.defaultThreshold).toBe(60);
  expect(accessibility(30,30)).toBe(.5);expect(accessibility(60,30)).toBe(.25);expect(accessibility(90,30)).toBe(.125);
 });
 it('does not square a regional aggregate or reuse cached point scores',()=>{
  const d={...metadata,expectedPopulation:2},points=[point('a',0,1),point('b',60,1)];
  const old=summarizePoints(d,points,{methodologyVersion:'2.0.0'}),current=summarizePoints(d,points);
  expect(old.value).toBe(75);expect(current.value).toBe(62.5);expect(current.value).not.toBe(100*(old.value!/100)**2);
  expect(current.points.map(p=>p.score)).toEqual([1,.25]);expect(points[0].score).toBe(999);
 });
 it('uses population weights for quantiles and strictly greater tail thresholds',()=>{
  const points=[point('a',0,1),point('b',30,1),point('c',60,1),point('d',90,1),point('e',120,6)];
  const r=summarizePoints(metadata,points);expect(r.medianMinutes).toBe(120);expect(r.p90Minutes).toBe(120);
  expect(r.overMinutesShares['60']).toBe(.7);expect(r.overMinutesShares['90']).toBe(.6);
  for(const threshold of [20,30,45,60])expect(summarizePoints(metadata,points,{threshold}).p90Minutes).toBe(120);
 });
 it('exposes selection bias from excluded population without assigning factual isolation',()=>{
  const r=summarizePoints(metadata,[point('a',0,1),point('b',30,1),point('unknown',null,8,'route_unverified')]);
  expect(r.value).toBe(75);expect(r.populationCoverage).toBe(.2);expect(r.excludedPopulation).toBe(8);
  expect(r.indexBounds.lower).toBe(15);expect(r.indexBounds.upper).toBe(95);
  expect(r.points[2].score).toBeNull();expect(r.unreachablePopulation).toBe(0);
 });
 it('computes ordered sensitivity and keeps versions out of identical labels',()=>{
  const points=[point('a',20,5),point('b',80,5)],values=[20,30,45,60].map(threshold=>summarizePoints(metadata,points,{threshold}).value!);
  expect(values).toEqual([...values].sort((a,b)=>a-b));expect(new Set(values).size).toBe(4);
  const d=validateDataset(demo);expect(calculate(d,{methodologyVersion:'2.0.0'}).value!).toBeGreaterThan(calculate(d,{methodologyVersion:'3.0.0'}).value!);
 });
 it('reports unverified OSM profiles and keeps fixed coverage in closure scenarios',()=>{
  const r=summarizePoints(metadata,[point('a',30,10)]);expect(r.facilityEvidence).toBe('osm-unverified-profile');
  const d=validateDataset(demo),closed=compareScenario(d,{methodologyVersion:'3.0.0',scenario:'closure',edgeId:'ce'});
  expect(closed.after.population).toBe(closed.baseline.population);expect(closed.delta!).toBeLessThanOrEqual(0);
  expect(closed.after.methodologyVersion).toBe('3.0.0');expect(closed.after.threshold).toBe(30);
 });
});
