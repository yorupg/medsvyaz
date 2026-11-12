import {expect,it} from 'vitest';
import {createApi} from '../server/api';
import {settlementRoadOptions} from '../shared/engine';
import {studyComparison,studyDatasets} from '../server/study';
import type {RoadOption} from '../shared/engine';
const app=createApi();

it('opens the exact local scenario advertised for each pilot example',async()=>{
 const res=await app.request('/study/kaliningrad/road-options');
 expect(res.status).toBe(200);
 const {rows}:{rows:RoadOption[]}=await res.json();
 expect(rows.length).toBeGreaterThan(0);
 expect(rows.some(p=>p.id==='s-27518000261')).toBe(false);
 const fresh=settlementRoadOptions(studyDatasets.kaliningrad,{threshold:40,timeScale:1});
 expect(rows).toEqual(fresh);
 for(const p of rows){
  const scenario=studyComparison('kaliningrad',{scenario:'new_road',scope:'point',pointId:p.id})!;
  const after=scenario.after.points.find(origin=>origin.id===p.id)!;
  expect(after.minutes).toBeCloseTo(p.after,6);
  expect(after.path).toContain(scenario.proposedEdges[0].id);
  expect(p.after).toBeLessThan(p.before);
 }
},180000);

it('respects changed settings and finds all eligible origins on a synthetic network',async()=>{
 const id='kamchatka',d=studyDatasets[id],opts={threshold:50,timeScale:0.8};
 const res=await app.request('/study/'+id+'/road-options?threshold=50&timeScale=0.8');
 const {rows}:{rows:RoadOption[]}=await res.json();
 const selected=new Map(rows.map(p=>[p.id,p.after]));
 for(const s of d.settlements){
  const c=studyComparison(id,{...opts,scenario:'new_road',scope:'point',pointId:s.id})!;
  expect(selected.has(s.id)).toBe(Boolean(c.investmentSuggestion));
  if(selected.has(s.id))expect(selected.get(s.id)).toBeCloseTo(c.after.points.find(p=>p.id===s.id)!.minutes!,6);
 }
});
it('distinguishes missing data, empty results, unknown regions and invalid settings',async()=>{
 expect(await (await app.request('/study/donetsk/road-options')).json()).toEqual({status:'no_data',rows:[]});
 expect(await (await app.request('/study/kostroma/road-options')).json()).toEqual({status:'available',rows:[]});
 expect((await app.request('/study/kaliningrad/road-options?timeScale=3')).status).toBe(400);
 expect((await app.request('/study/unknown/road-options')).status).toBe(404);
});

it('applies both pilot thresholds to the list, regional choice, local map and route',async()=>{
 const root='/study/kaliningrad';
 const rows=async(query:string)=>(await (await app.request(root+'/road-options?'+query)).json()).rows as RoadOption[];
 const standard=await rows('');
 expect(standard.map(r=>r.name)).toEqual(['посёлок Холмы']);
 const relaxed=await rows('minRoadMinutes=0&minRoadPercent=0');
 expect(relaxed.some(r=>r.name.includes('Моховое'))).toBe(true);
 expect(relaxed.some(r=>r.name.includes('Светлогорск'))).toBe(false);
 for(const strict of ['minRoadMinutes=10','minRoadPercent=80']){
  expect(await rows(strict)).toEqual([]);
  const result=await (await app.request(root+'/compare?scenario=new_road&scope=region&'+strict)).json();
  expect(result.proposedEdges).toEqual([]);
 }
 const p=standard[0],params='?scenario=new_road&scope=point&pointId='+p.id;
 const scenario=await (await app.request(root+'/compare'+params)).json();
 const map=await (await app.request(root+'/map'+params)).json();
 const route=await (await app.request(root+'/route/'+p.id+params)).json();
 const geometry=scenario.proposedEdges[0].geometry;
 expect(map.selectedRoad.find((r:{proposed:boolean})=>r.proposed).geometry).toEqual(geometry);
 const road=route.coordinates.find((e:{id:string})=>e.id==='__proposal__road');
 expect([geometry,[...geometry].reverse()]).toContainEqual(road.coordinates);
 expect(route.minutes).toBeCloseTo(p.after,6);
 expect((await app.request(root+'/road-options?minRoadPercent=150')).status).toBe(400);
},180000);
