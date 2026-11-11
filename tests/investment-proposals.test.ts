import {describe,it,expect} from 'vitest';
import {calculate,compareScenario,validateDataset,validateRoadCorridor} from '../shared/engine';

// Small fully synthetic graph. Coordinates are WGS84 solely for evaluating
// the simplified new-road planning candidate, not a real alignment.
function fixture(){
 const nodes=[
  {id:'a',x:30,y:55},{id:'b',x:30.1,y:55},{id:'c',x:30.4,y:55},{id:'h',x:30.6,y:55},
 ];
 const edges=[
  {id:'ab',from:'a',to:'b',minutes:70,directed:false,allowed:true,speedSource:'test'},
  {id:'bh',from:'b',to:'h',minutes:30,directed:false,allowed:true,speedSource:'test'},
  {id:'ch',from:'c',to:'h',minutes:12,directed:false,allowed:true,speedSource:'test'},
 ];
 return validateDataset({id:'test-investment',version:'1',title:'Тест',regionId:'test',synthetic:true,date:'2026-11-11',profile:'test',profileLabel:'тест',mode:'car',trip:'to-facility',sourceIds:['test'],license:'CC0',assumptions:[],expectedPopulation:1000,
  nodes,edges,settlements:[
   {id:'s-a',name:'Дальний пункт',nodeId:'a',population:200,municipality:'А',provenance:'test'},
   {id:'s-c',name:'Опорный пункт',nodeId:'c',population:800,municipality:'Б',provenance:'test'},
  ],facilities:[{id:'hospital',name:'Условный центр',nodeId:'h',profile:'test',periods:['day'],verified:false,provenance:'test'}]});
}
describe('Инвестиционные проектные сценарии',()=>{
 it('новая дорожная связь действительно меняет граф, путь и индекс',()=>{
  const d=fixture(),baseline=calculate(d),c=compareScenario(d,{scenario:'new_road',scope:'point',pointId:'s-a'});
  expect(c.proposedEdges).toHaveLength(1);
  expect(c.proposedEdges[0].kind).toBe('road');
  expect(c.after.points.find(p=>p.id==='s-a')?.path).toContain('__proposal__road');
  expect(c.delta).toBeGreaterThan(0);
  expect(c.after.points.find(p=>p.id==='s-a')?.minutes).toBeLessThan(baseline.points.find(p=>p.id==='s-a')!.minutes!);
  expect(d.edges).toHaveLength(3); // source graph is immutable
 });
 it('реальные территории не получают неподтверждённую прямую дорогу',()=>{
  const d={...fixture(),synthetic:false};
  const comparison=compareScenario(d,{scenario:'new_road',scope:'point',pointId:'s-a'});
  expect(comparison.proposedEdges).toHaveLength(0);
  expect(comparison.after.value).toBe(comparison.baseline.value);
  expect(comparison.selectionRule).toMatch(/военн|ограничени|проверенн/);
 });
 it('отбрасывает опасный или не подтверждённый дорожный коридор',()=>{
  const d={...fixture(),synthetic:false};
  const reasons=validateRoadCorridor({id:'demo',datasetId:d.id,title:'Демо',fromNodeId:'a',toNodeId:'c',geometry:[[30,55],[30.2,55],[30.4,55]],maxSpeedKmh:50,
    evidence:{militaryRestrictions:false,protectedAreas:true,waterAndBridges:true,landRights:true,terrainAndSafety:true,municipalPlan:true,sourceUrls:[]}},d);
  expect(reasons.some(x=>x.includes('ограничений'))).toBe(true);
  expect(reasons.some(x=>x.includes('подтверждений'))).toBe(true);
 });
 it('добавление площадки меняет пункт назначения, но не подменяет официальную больницу',()=>{
  const d=fixture(),c=compareScenario(d,{scenario:'new_facility',scope:'region'});
  expect(c.proposedFacilities).toHaveLength(1);
  expect(c.proposedFacilities[0].verified).toBe(false);
  expect(c.after.points.some((p,i)=>p.facilityId!==c.baseline.points[i].facilityId)).toBe(true);
  expect(c.delta).toBeGreaterThan(0);
  expect(d.facilities).toHaveLength(1);
 });
 it('проект для выбранного поселения не подменяется улучшением другого поселения',()=>{
  const d=fixture();
  for(const scenario of ['new_road','new_facility'] as const){
   const c=compareScenario(d,{scenario,scope:'point',pointId:'s-a'});
   if(!c.investmentSuggestion){expect(c.proposedEdges.length+c.proposedFacilities.length).toBe(0);continue;}
   const before=c.baseline.points.find(p=>p.id==='s-a')!;
   const after=c.after.points.find(p=>p.id==='s-a')!;
   expect(after.minutes!).toBeLessThan(before.minutes!);
   if(scenario==='new_road')expect(after.path).toContain('__proposal__road');
   else expect(after.facilityId).toBe('__proposal__facility');
  }
 });
 it('сценарии не заменяют отсутствующие фактические денежные данные',()=>{
  const c=compareScenario(fixture(),{scenario:'new_facility',scope:'region'});
  expect(c.cost).toBeNull();
  expect(c.investmentSuggestion?.technicalWarning).toMatch(/гипотез/i);
  expect(c.pointsPerMillion).toBeNull();
 });
});
