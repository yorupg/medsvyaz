import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {calculate,compareScenario,validateDataset} from '../shared/engine';
import type {CalculationOptions,Dataset} from '../shared/schema';
export const realDatasets:Record<string,Dataset>=Object.fromEntries(['kaliningrad','ivanovo','pskov'].map(id=>[id,validateDataset(JSON.parse(readFileSync(resolve('data/processed/'+id+'-pilot.json'),'utf8')))]));
export const pilot=realDatasets.kaliningrad;
export const syntheticDatasets=JSON.parse(readFileSync(resolve('data/processed/synthetic-regions.json'),'utf8')) as Record<string,Dataset>;
// Do not clone cartographic vertex arrays for each routing calculation.
export const studyDatasets:Record<string,Dataset>={...syntheticDatasets,...Object.fromEntries(Object.entries(realDatasets).map(([id,d])=>[id,{...d,edges:d.edges.map(({geometry,...e})=>e)}]))};
export const baselineResults=Object.fromEntries(Object.entries(studyDatasets).map(([id,d])=>[id,calculate(d)]));
const lookups=Object.fromEntries(Object.entries(realDatasets).map(([id,d])=>[id,new Map(d.edges.map(e=>[e.id,e]))]));
const scenarioEdges=Object.fromEntries(Object.entries(realDatasets).map(([id,d])=>{
 const influence=new Map<string,number>(),lookup=lookups[id];
 for(const p of baselineResults[id].points)for(const eid of p.path){const e=lookup.get(eid);if(e?.osmWayId)influence.set(e.osmWayId,(influence.get(e.osmWayId)??0)+(p.population??0)*e.minutes);}
 const groups=new Map<string,{id:string;name:string;osmWayId:string;lengthKm:number}>();
 for(const e of d.edges)if(e.osmWayId){const g=groups.get(e.osmWayId);if(g)g.lengthKm+=e.lengthKm??0;else groups.set(e.osmWayId,{id:e.id,name:e.name??e.osmWayId,osmWayId:e.osmWayId,lengthKm:e.lengthKm??0});}
 return [id,[...groups.values()].filter(g=>g.lengthKm>=.4&&influence.has(g.osmWayId)).sort((a,b)=>(influence.get(b.osmWayId)??0)-(influence.get(a.osmWayId)??0)).filter((g,i,all)=>all.findIndex(x=>x.name===g.name)===i).slice(0,10)];
}));
export const pilotScenarioEdges=scenarioEdges.kaliningrad;
export function scenariosFor(d:Dataset){return d.synthetic?d.edges.filter(e=>e.kind!=='access').map(e=>({id:e.id,name:e.name??`${e.from} → ${e.to}`,lengthKm:e.lengthKm??null})):scenarioEdges[d.regionId];}
const cache=new Map<string,ReturnType<typeof compareScenario>>();
export function studyComparison(regionId:string,options:Partial<CalculationOptions>={}){
 const d=studyDatasets[regionId];if(!d)return null;
 if(!d.synthetic&&options.period==='night')throw new Error('Ночная доступность больниц не подтверждена.');
 const edgeId=options.edgeId??scenariosFor(d)[0]?.id;
 const key=JSON.stringify([regionId,{...options,edgeId}]);if(cache.has(key))return cache.get(key)!;
 const result=compareScenario(d,{...options,edgeId});if(cache.size>=16)cache.delete(cache.keys().next().value!);cache.set(key,result);return result;
}
export function studyDescription(regionId:string){const d=studyDatasets[regionId];if(!d)return null;return {id:d.id,regionId,synthetic:d.synthetic,title:d.title,profile:d.profile,profileLabel:d.profileLabel,date:d.date,version:d.version,sourceIds:d.sourceIds,assumptions:d.assumptions,metadata:d.metadata,coverageLabel:d.coverageLabel,settlementCount:d.settlements.length,facilityCount:d.facilities.length,nodes:d.nodes.length,edges:d.edges.length,scenarios:scenariosFor(d),baseline:baselineResults[regionId],facilities:d.facilities};}
export function studyMap(regionId:string,options:Partial<CalculationOptions>={}){
 const d=realDatasets[regionId],c=studyComparison(regionId,options)!;const byId=new Map(d.settlements.map(s=>[s.id,s]));
 const points=c.after.points.map(p=>{const s=byId.get(p.id)!;const {path,...short}=p;return {...short,lat:s.lat,lon:s.lon,snapMeters:s.snapMeters};});
 const selected=d.edges.find(e=>e.id===(options.edgeId??scenarioEdges[regionId][0]?.id));
 const selectedRoad=selected?.osmWayId?d.edges.filter(e=>e.osmWayId===selected.osmWayId):[];
 const coords=d.settlements.filter(s=>s.lat!==undefined&&s.lon!==undefined);
 const bounds=d.metadata?.mapBounds??[[Math.min(...coords.map(s=>s.lat!)),Math.min(...coords.map(s=>s.lon!))],[Math.max(...coords.map(s=>s.lat!)),Math.max(...coords.map(s=>s.lon!))]];
 return {synthetic:false,points,facilities:d.facilities,selectedRoad:selectedRoad.map(e=>({id:e.id,name:e.name,geometry:e.geometry})),bounds,metadata:d.metadata};
}
export function studyRoute(regionId:string,pointId:string,options:Partial<CalculationOptions>={}){const c=studyComparison(regionId,options)!;const p=c.after.points.find(p=>p.id===pointId);if(!p)return null;return {...p,coordinates:p.path.flatMap(id=>{const e=lookups[regionId].get(id);return e?.geometry?[{id,coordinates:e.geometry,kind:e.kind}]:[];}),synthetic:false};}
export const pilotMap=(options:Partial<CalculationOptions>={})=>studyMap('kaliningrad',options);
export const pilotRoute=(pointId:string,options:Partial<CalculationOptions>={})=>studyRoute('kaliningrad',pointId,options);
