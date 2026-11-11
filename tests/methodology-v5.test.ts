import {describe,it,expect} from 'vitest';
import {accessibility,calculate,compareScenario,validateDataset} from '../shared/engine';
import {CalculationSchema} from '../shared/schema';
import rawDemo from '../data/examples/demo.json';
const fixture=()=>validateDataset(structuredClone(rawDemo));
describe('МИЭД v5: комфортная зона и изменение маршрутов',()=>{
 it('не снижает доступность при поездке 0–15 минут, в том числе в примере 0 и 8 минут',()=>{
  for(const t of [0,1,8,10,12,15])expect(accessibility(t,40,15)).toBe(1);
  expect(100*(accessibility(8,40,15)+accessibility(0,40,15))/2).toBe(100);
  expect(accessibility(40,40,15)).toBe(.5);
  expect(accessibility(65,40,15)).toBeCloseTo(.25);
  expect(accessibility(90,40,15)).toBeLessThan(.13);
 });
 it('сохраняет преемственность моделей v2, v3 и v4',()=>{
  expect(CalculationSchema.parse({})).toMatchObject({methodologyVersion:'5.0.0',threshold:40});
  expect(calculate(fixture())).toMatchObject({methodologyVersion:'5.0.0',threshold:40,weighting:'settlement'});
  expect(calculate(fixture(),{methodologyVersion:'4.0.0'}).threshold).toBe(30);
  expect(calculate(fixture(),{methodologyVersion:'3.0.0'}).weighting).toBe('population');
  expect(accessibility(8,30)).toBeCloseTo(2**(-8/30));
 });
 it('индекс v5 — среднее индивидуальных доступностей, не преобразование старого агрегата',()=>{
  const d=fixture(),r=calculate(d),sum=r.points.filter(p=>p.score!==null).reduce((total,p)=>total+p.score!,0);
  expect(r.value).toBeCloseTo(100*sum/r.denominator,10);
 });
 it('автоматически выбирает участок текущего пути выбранного поселения',()=>{
  const d=fixture(),base=calculate(d),point=base.points.find(p=>p.minutes!==null&&p.path.some(id=>d.edges.some(e=>e.id===id&&e.kind!=='access')))!;
  const change=compareScenario(d,{scenario:'improvement',scope:'point',pointId:point.id,multiplier:2});
  expect(change.selectedRoads).toHaveLength(1);
  expect(point.path).toContain(change.selectedRoads[0].id);
  expect(change.after.denominator).toBe(change.baseline.denominator);
  expect(change.delta).toBeGreaterThanOrEqual(0);
  expect(change.after.points.find(p=>p.id===point.id)?.minutes).toBeLessThanOrEqual(point.minutes!);
 });
 it('региональный сценарий выбирает до четырёх объектов и пересчитывает все поселения',()=>{
  const d=fixture(),original=structuredClone(d),r=compareScenario(d,{scenario:'improvement',scope:'region',multiplier:1.8});
  expect(r.selectedRoads.length).toBeGreaterThan(0);
  expect(r.selectedRoads.length).toBeLessThanOrEqual(4);
  expect(r.after.points).toHaveLength(r.baseline.points.length);
  expect(r.after.denominator).toBe(r.baseline.denominator);
  expect(r.delta).toBeGreaterThanOrEqual(0);
  expect(d).toEqual(original);
 });
 it('маршрут и индекс при закрытии не становятся лучше; нет подмены отсутствующих данных',()=>{
  const d=fixture(),r=compareScenario(d,{scenario:'closure',edgeId:d.edges[0].id});
  expect(r.delta).toBeLessThanOrEqual(0);
  expect(r.after.denominator).toBe(r.baseline.denominator);
 });
});
