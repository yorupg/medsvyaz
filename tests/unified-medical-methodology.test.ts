import {describe,it,expect} from 'vitest';
import {baselineResults,realRegionIds,studyComparison,kaliningradExperimental} from '../server/study';
import {createApi} from '../server/api';
import {accessibility} from '../shared/engine';

const app=createApi();
describe('Единая основная методика и отдельный калининградский эксперимент',()=>{
 it('каждый реальный регион, включая Калининград, имеет основной индекс 85/10/5',()=>{
  expect(realRegionIds).toContain('kaliningrad');
  for(const id of realRegionIds){
   expect(baselineResults[id].methodologyVersion).toBe('6.1.0');
  }
  expect(studyComparison('kaliningrad')!.baseline.methodologyVersion).toBe('6.1.0');
 });
 it('оба типа инфраструктурных сценариев используют один и тот же основной индекс',()=>{
  for(const scenario of ['new_road','new_facility'] as const){
   const comparison=studyComparison('kaliningrad',{scenario,scope:'region'});
   expect(comparison?.baseline.methodologyVersion).toBe('6.1.0');
   expect(comparison?.after.methodologyVersion).toBe('6.1.0');
   if(comparison?.baseline.value!=null&&comparison.after.value!=null){
    expect(comparison.delta).toBeCloseTo(comparison.after.value-comparison.baseline.value,8);
   }
  }
 });
 it('эксперимент имеет отдельную формулу и не заменяет основной показатель',async()=>{
  const experimental=kaliningradExperimental();
  expect(experimental.methodologyVersion).toBe('6.2.0');
  expect(baselineResults.kaliningrad.methodologyVersion).toBe('6.1.0');
  const response=await app.request('/study/kaliningrad/experimental');
  expect(response.status).toBe(200);
  const payload=await response.json();
  expect(payload.comparableToPrimary).toBe(false);
  expect(payload.result.methodologyVersion).toBe('6.2.0');
  expect((await app.request('/study/ivanovo/experimental')).status).toBe(404);
 });
 it('национальный API включает Калининград в основную группу и не называет эксперимент общим индексом',async()=>{
  const response=await app.request('/national-index');
  expect(response.status).toBe(200);
  const payload=await response.json();
  expect(payload.methodologyVersion).toBe('6.1.0');
  expect(payload.separatePilot.methodologyVersion).toBe('6.2.0');
  expect(payload.value).toBeNull(); // Не называем частичный охват индексом всей страны.
  const regional=await app.request('/regions/kaliningrad/index');
  expect((await regional.json()).methodologyVersion).toBe('6.1.0');
 });
 it('проверка спадания функции доступности согласована с методологией',()=>{
  expect(accessibility(15,40,15,2)).toBe(1);
  expect(accessibility(40,40,15,2)).toBeCloseTo(.5);
  expect(accessibility(80,40,15,2)).toBeLessThan(accessibility(60,40,15,2));
 });
});
