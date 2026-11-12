import {describe,it,expect} from 'vitest';
import {calculate,accessibility,compareScenario,validateDataset} from '../shared/engine';
import {METHODOLOGY} from '../shared/schema';
import {mapDistribution} from '../shared/map-metrics';
import rawDemo from '../data/examples/demo.json';
const fixture=()=>validateDataset(structuredClone(rawDemo));

describe('МИЭД v6.1 · региональная оценка и границы',()=>{
 it('переключает методику по умолчанию на v6.1 без удаления исторической v5',()=>{
  expect(METHODOLOGY.version).toBe('6.1.0');
  expect(calculate(fixture()).weighting).toBe('hybrid');
  expect(calculate(fixture(),{methodologyVersion:'5.0.0'}).weighting).toBe('settlement');
 });
 it('оставляет функцию непрерывной в 15 и 60 мин и ускоряет спад после 60',()=>{
  expect(accessibility(15,40,15,2)).toBe(1);
  expect(accessibility(40,40,15,2)).toBeCloseTo(.5,12);
  expect(accessibility(60,40,15,2)).toBeCloseTo(accessibility(60,40,15),12);
  expect(accessibility(90,40,15,2)).toBeLessThan(accessibility(90,40,15));
  expect(accessibility(60.00001,40,15,2)).toBeCloseTo(accessibility(60,40,15,2),5);
 });
 it('точно воспроизводит индекс из индивидуальных весов и 85/10/5',()=>{
  const r=calculate(fixture());
  const included=r.points.filter(p=>p.score!==null);
  const population=included.reduce((sum,p)=>sum+(p.population??0),0);
  expect(population).toBeGreaterThan(0);
  for(const p of included){
   const expected=p.status==='unreachable'?0:
    .85*accessibility(p.minutes,r.threshold,15,2)+
    .10*accessibility(p.backupMinutes??null,r.threshold,15,2)+
    .05*accessibility(p.robustMinutes??null,r.threshold,15,2);
   expect(p.score!).toBeCloseTo(expected,9);
   if(p.backupMinutes!==null&&p.backupMinutes!==undefined&&p.minutes!==null)expect(p.backupMinutes).toBeGreaterThanOrEqual(p.minutes-1e-8);
  }
  const expected=100*included.reduce((sum,p)=>sum+(.752/included.length+.248*(p.population??0)/population)*p.score!,0);
  expect(r.value).toBeCloseTo(expected,9);
  expect(mapDistribution(r.points,r.value,r.weighting).index).toBeCloseTo(expected,9);
 });
 it('не изменяет исходные данные при сравнении дорожных сценариев',()=>{
  const d=fixture(),prior=structuredClone(d);
  const closure=compareScenario(d,{scenario:'closure',edgeId:d.edges[0].id});
  expect(closure.after.value).toBeLessThanOrEqual(closure.baseline.value!);
  expect(d).toEqual(prior);
 });
});
