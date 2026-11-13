import {describe,it,expect} from 'vitest';
import {accessibility,calculate,validateDataset} from '../shared/engine';
import type {Dataset} from '../shared/schema';

/** Two eligible FREE sites plus a closer but excluded PAID private site. */
function makeNetwork():Dataset {
 const nodes=[{id:'home',x:20,y:54},{id:'hospital',x:20.1,y:54},{id:'clinic',x:20.05,y:54},{id:'private',x:20.01,y:54}];
 return validateDataset({
  id:'regional-free-sites-test',version:'test-1',title:'Test graph',regionId:'fixture-not-kaliningrad',synthetic:false,
  date:'2026-11-13',profile:'mapped-hospital',profileLabel:'Free medical sites',
  mode:'car',trip:'to-facility',sourceIds:['fixture'],license:'test-only',assumptions:[],
  expectedPopulation:100,coverageLabel:'',metadata:{clinicNodeIds:['clinic']},nodes,
  edges:[
   {id:'to-hospital',from:'home',to:'hospital',minutes:20,directed:false,allowed:true,speedSource:'test'},
   {id:'to-clinic',from:'home',to:'clinic',minutes:10,directed:false,allowed:true,speedSource:'test'},
   {id:'to-private',from:'home',to:'private',minutes:2,directed:false,allowed:true,speedSource:'test'},
  ],
  settlements:[{id:'home-settlement',name:'Посёлок',municipality:'Тест',nodeId:'home',population:100,provenance:'test'}],
  facilities:[
   {id:'h',name:'Государственная больница',nodeId:'hospital',profile:'mapped-hospital',periods:['day'],verified:true,provenance:'official-source'},
   {id:'c',name:'Государственная поликлиника (OSM)',nodeId:'clinic',profile:'mapped-hospital',periods:['day'],verified:false,provenance:'osm-classified-public-medical-catalog'},
   {id:'p',name:'Частная платная клиника',nodeId:'private',profile:'mapped-hospital',periods:['day'],verified:false,provenance:'private-paid-medical-catalog'},
  ],
 });
}

describe('Разделение национальной и калининградской методики',()=>{
 it('v6.1 ищет два разных ближайших бесплатных объекта и сохраняет веса 85/10/5',()=>{
  const result=calculate(makeNetwork(),{methodologyVersion:'6.1.0',threshold:40});
  const point=result.points[0];
  expect(point.minutes).toBeCloseTo(10);
  expect(point.facilityId).toBe('c');
  expect(point.backupMinutes).toBeCloseTo(20);
  expect(point.backupFacilityId).toBe('h');
  expect(point.robustMinutes).toBeCloseTo(10);
  const expected=100*(.85*accessibility(10,40,15,2)+.10*accessibility(20,40,15,2)+.05*accessibility(10,40,15,2));
  expect(result.value).toBeCloseTo(expected,8);
 });
 it('платная частная клиника не становится медицинской точкой назначения',()=>{
  const d=makeNetwork(),r=calculate(d,{methodologyVersion:'6.1.0'});
  expect(r.points[0].facilityId).not.toBe('p');
  expect(r.points[0].backupFacilityId).not.toBe('p');
 });
 it('v6.2 сохраняет отдельную формулу 55/35/10 для специального пилота',()=>{
  const d=makeNetwork();
  // The special pilot has a hospital-only baseline dataset: clinic gets routed
  // separately through metadata.clinicNodeIds.
  d.facilities=d.facilities.filter(f=>f.id!=='c');
  const r=calculate(d,{methodologyVersion:'6.2.0',threshold:40});
  const p=r.points[0];
  expect(p.minutes).toBeCloseTo(20);
  expect(p.clinicMinutes).toBeCloseTo(10);
  const expected=100*(.55*accessibility(20,40,15,2)+.35*accessibility(10,40,15,2)+.10*accessibility(20,40,15,2));
  expect(r.value).toBeCloseTo(expected,8);
 });
});
