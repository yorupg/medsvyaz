import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {calculate,validateDataset} from '../shared/engine';
import {MEDICAL_CATEGORIES,mergeMedicalFacilities,matchesMedicalSearch,type MedicalCatalog,type MedicalPlace} from '../shared/medical-catalog';
import eligibility from '../data/reference/kaliningrad-index-eligibility.json';

function fixture(){
 const a=eligibility.facilities[0],b=eligibility.facilities[1];
 return validateDataset({id:'free-care-test',version:'1',title:'Проверка оплаты',regionId:'kaliningrad',synthetic:false,
  date:'2026-11-13',profile:'selected-public-hospital',profileLabel:'Государственные больницы с ОМС',mode:'car',trip:'to-facility',sourceIds:['test'],license:'test',assumptions:[],expectedPopulation:100,
  nodes:[{id:'s',x:20,y:54.7},{id:'a',x:20.1,y:54.7},{id:'b',x:20.2,y:54.7},{id:'paid',x:20.01,y:54.7}],
  edges:[['a',20],['b',40],['paid',1]].map(([id,minutes])=>({id:'to-'+id,from:'s',to:String(id),minutes:Number(minutes),directed:true,allowed:true,speedSource:'test'})),
  settlements:[{id:'village',name:'Посёлок',nodeId:'s',population:100,municipality:'test',provenance:'test'}],
  facilities:[{id:a.id,osmId:a.osmId,nodeId:'a'},{id:b.id,osmId:b.osmId,nodeId:'b'}].map(f=>({...f,name:f.id,verified:true,provenance:'TFOMS source in eligibility',profile:'selected-public-hospital',periods:['day']}))});
}

describe('Kaliningrad medical map and free-care calculation',()=>{
 it('a nearer paid or unreviewed site cannot improve nearest, backup or stress scores',()=>{
  const d=fixture(),base=calculate(d),paid={...d.facilities[0],id:'private-paid',osmId:'node/unknown',nodeId:'paid',name:'Платная клиника',verified:true};
  const result=calculate({...d,facilities:[...d.facilities,paid]});
  expect(result.value).toBe(base.value);
  expect(result.points[0].facilityId).toBe(d.facilities[0].id);
  expect(result.points[0].minutes).toBe(20);
  expect(result.points[0].backupMinutes).toBe(40);
  expect(result.points[0].robustMinutes).toBe(20);
  expect(calculate({...d,facilities:[...d.facilities,paid]},{facilityIds:[paid.id]}).value).toBeNull();
 });
 it('rejects changed OSM identity even if an approved ID is reused',()=>{
  const d=fixture();
  expect(calculate({...d,facilities:d.facilities.map(f=>({...f,osmId:'node/another-provider'}))}).value).toBeNull();
 });
 it('deduplicates calculation hospitals by source identity and aligns markers with route endpoints',()=>{
  const d=fixture(),f={...d.facilities[0],lat:54.7,lon:20.1};
  const place:MedicalPlace={id:'osm-'+f.osmId!.replace('/','-'),name:f.name,type:'public_hospital',medicalType:'hospital',lat:54.7001,lon:20.1001};
  const nearby={...place,id:'another-clinic',name:'Другая клиника рядом'};
  const merged=mergeMedicalFacilities([place,nearby],[f]);
  expect(merged).toHaveLength(2);
  expect(merged[0].baselineFacilityId).toBe(f.id);
  expect([merged[0].lat,merged[0].lon]).toEqual([f.lat,f.lon]);
  expect(merged[1].id).toBe('another-clinic');
 });
 it('searches names and addresses consistently, including ё and punctuation',()=>{
  const place={name:'Озёрская больница',address:'238120, Калининградская область, г. Озёрск, ул.Суворова, д.14'} as MedicalPlace;
  expect(matchesMedicalSearch(place,'озерская')).toBe(true);
  expect(matchesMedicalSearch(place,'Суворова 14')).toBe(true);
  expect(matchesMedicalSearch(place,'нет такого адреса')).toBe(false);
 });
 it('ships all requested map categories and exactly the verified calculation subset',()=>{
  const catalog=JSON.parse(readFileSync('public/data/kaliningrad-medical-facilities.json','utf8')) as MedicalCatalog;
  const ids=new Set(MEDICAL_CATEGORIES.map(c=>c.id));
  expect(catalog.schemaVersion).toBe(2);
  expect(catalog.facilities.every(f=>ids.has(f.type))).toBe(true);
  expect(catalog.facilities.filter(f=>f.indexEligible).map(f=>f.baselineFacilityId).sort()).toEqual(eligibility.facilities.map(f=>f.id).sort());
  expect(catalog.facilities.some(f=>f.type==='public_maternity')).toBe(true);
  expect(catalog.facilities.some(f=>/ст[оа]м[ао]т|зубной/i.test(f.name))).toBe(false);
 });
});
