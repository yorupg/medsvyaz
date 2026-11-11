import {describe,it,expect} from 'vitest';
import {calculate as rawCalculate,compareScenario as rawCompare,summarizePoints as rawSummary,validateDataset,aggregate} from '../shared/engine';
const calculate:typeof rawCalculate=(d,o={})=>rawCalculate(d,{methodologyVersion:'4.0.0',...o});
const compareScenario:typeof rawCompare=(d,o={})=>rawCompare(d,{methodologyVersion:'4.0.0',...o});
const summarizePoints:typeof rawSummary=(d,p,o={})=>rawSummary(d,p,{methodologyVersion:'4.0.0',...o});
import {CalculationSchema} from '../shared/schema';
import demo from '../data/examples/demo.json';
const fixture=()=>validateDataset(structuredClone(demo));
describe('Final MIED v4: equal settlement weights',()=>{
 it('uses the arithmetic mean of point accessibilities, including zero for lost routes',()=>{
  const r=calculate(fixture());
  expect(r.methodologyVersion).toBe('4.0.0');expect(r.weighting).toBe('settlement');expect(r.denominator).toBe(7);
  expect(r.value).toBeCloseTo(100*(2**(-44/30)+2**(-38/30)+2**(-26/30)+2**(-14/30)+1+2**(-16/30)+0)/7,10);
 });
 it('is invariant to population, including zero, missing values and extreme disparities',()=>{
  const d=fixture(),r=calculate(d);d.expectedPopulation=null;
  for(const mode of ['zero','missing','extreme']){
   d.settlements.forEach((s,i)=>s.population=mode==='zero'?0:mode==='missing'?null:i===0?1e9:1);
   const changed=calculate(d);expect(changed.value).toBe(r.value);expect(changed.denominator).toBe(r.denominator);
   expect(changed.meanMinutes).toBe(r.meanMinutes);expect(changed.medianMinutes).toBe(r.medianMinutes);expect(changed.p90Minutes).toBe(r.p90Minutes);
   expect(changed.overMinutesShares).toEqual(r.overMinutesShares);expect(changed.indexBounds).toEqual(r.indexBounds);
   expect(compareScenario(d,{scenario:'improvement',edgeId:'ce'}).delta).toBe(compareScenario(fixture(),{scenario:'improvement',edgeId:'ce'}).delta);
  }
 });
 it('preserves v2 and v3 explicitly and retains explicit v4',()=>{
  expect(CalculationSchema.parse({methodologyVersion:'4.0.0'}).methodologyVersion).toBe('4.0.0');
  const d=fixture(),v3=calculate(d,{methodologyVersion:'3.0.0'}),v4=calculate(d);
  expect(v3.weighting).toBe('population');expect(v3.denominator).toBe(5100);expect(v4.value).not.toBe(v3.value);
  expect(calculate(d,{methodologyVersion:'2.0.0'}).threshold).toBe(60);
 });
 it('uses unit quantiles and settlement coverage bounds',()=>{
  const d=fixture(),r=calculate(d),old=calculate(d,{methodologyVersion:'3.0.0'});
  expect(r.medianMinutes).toBe(16);expect(r.meanMinutes).toBe((44+38+26+14+0+16)/6);
  expect(old.meanMinutes).not.toBe(r.meanMinutes);
  const excluded={...r.points[0],status:'route_unverified' as const,minutes:null,score:null};
  const partial=summarizePoints(d,[excluded,...r.points.slice(1)]);
  expect(partial.denominator).toBe(6);expect(partial.settlementCoverage).toBe(6/7);
  expect(partial.indexBounds.lower).toBeCloseTo(partial.value!*6/7);expect(partial.indexBounds.upper!-partial.indexBounds.lower!).toBeCloseTo(100/7);
 });
 it('aggregates by settlement counts and preserves the baseline settlement cohort in closure',()=>{
  const d=fixture(),a=calculate(d),b=calculate({...d,id:'another',settlements:d.settlements.slice(0,1)});
  expect(aggregate([a,b]).value).toBeCloseTo((a.value!*7+b.value!)/8);
  const c=compareScenario(d,{scenario:'closure',edgeId:'ce'});expect(c.after.denominator).toBe(c.baseline.denominator);expect(c.delta!).toBeLessThanOrEqual(0);
 });
});
