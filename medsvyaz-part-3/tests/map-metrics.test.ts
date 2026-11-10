import {describe,it,expect} from 'vitest';
import {baselineResults} from '../server/study';
import {mapDistribution,pointMapColor,populationRadius} from '../shared/map-metrics';
import {indexColor} from '../shared/schema';
import {accessibility} from '../shared/engine';
describe('Map and equal-settlement index consistency',()=>{
 it('reconstructs every one of 85 model indices and checks every point colour against the same tau',()=>{
  for(const [id,result] of Object.entries(baselineResults)){
   const d=mapDistribution(result.points,result.value);
   expect(d.index,id).toBeCloseTo(result.value!,9);expect(d.population).toBe(result.population);
   expect(d.bins.reduce((sum,b)=>sum+b.population,0)).toBe(result.population);
   expect(d.bins.reduce((sum,b)=>sum+(b.contributionPoints??0),0)).toBeCloseTo(result.value!,9);
   for(const point of result.points)expect(pointMapColor(point),id+':'+point.id).toBe(indexColor(point.score===null?null:100*accessibility(point.minutes,result.threshold)));
  }
 });
 it('uses equal settlement weights in Yaroslavl',()=>{
  const d=mapDistribution(baselineResults.yaroslavl.points);expect(d.index).toBeCloseTo(54.3831357924,8);
  expect(d.unweightedIndex).toBeCloseTo(54.3831357924,8);
  const low=d.bins.filter(b=>b.max<=40);expect(low.reduce((sum,b)=>sum+b.settlements,0)).toBe(525);
  expect(low.reduce((sum,b)=>sum+(b.populationShare??0),0)).toBeLessThan(.031);
 });
 it('uses circle area scaling and preserves the numerical colour scale',()=>{
  expect(populationRadius(100,10000,true)**2/populationRadius(400,10000,true)**2).toBeCloseTo(.25);
  expect(populationRadius(100,10000,false)).toBe(4);expect(populationRadius(1,1000000,true)).toBe(1.8);
  expect(()=>mapDistribution(baselineResults.yaroslavl.points,1)).toThrow(/не воспроизводят/);
 });
});
