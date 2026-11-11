import {gunzipSync,brotliDecompressSync} from 'node:zlib';
import {auditResultMap} from '../shared/map-metrics';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {calculate,compareScenario,validateDataset,aggregate} from '../shared/engine';
import type {CalculationOptions,Dataset,IndexResult} from '../shared/schema';
import {expandedSummaries,expandedDataset,expandedBaseline,hasExpandedGraph} from './expanded';

const originalReal=Object.fromEntries(['kaliningrad','ivanovo','pskov'].map(id=>[id,validateDataset(JSON.parse(existsSync(resolve('data/processed/'+id+'-pilot.json'))?readFileSync(resolve('data/processed/'+id+'-pilot.json'),'utf8'):(existsSync(resolve('data/processed/'+id+'-pilot.json.gz'))?gunzipSync(readFileSync(resolve('data/processed/'+id+'-pilot.json.gz'))):brotliDecompressSync(readFileSync(resolve('data/processed/'+id+'-pilot.json.br')))).toString('utf8')))]));
export const realRegionIds=[...Object.keys(originalReal),...Object.keys(expandedSummaries)];
export const realDatasets:Record<string,Dataset>={...originalReal};
export const pilot=originalReal.kaliningrad;
const generated=JSON.parse(readFileSync(resolve('data/processed/synthetic-regions.json'),'utf8')) as Record<string,Dataset>;
export const syntheticDatasets=Object.fromEntries(Object.entries(generated).filter(([id])=>!realRegionIds.includes(id)));
export const studyDatasets:Record<string,Dataset>={...syntheticDatasets,...Object.fromEntries(Object.entries(originalReal).map(([id,d])=>[id,{...d,edges:d.edges.map(({geometry,...edge})=>edge)}]))};
for(const id of Object.keys(expandedSummaries).filter(hasExpandedGraph)){
 Object.defineProperty(realDatasets,id,{enumerable:true,get:()=>expandedDataset(id)});
 Object.defineProperty(studyDatasets,id,{enumerable:true,get:()=>expandedDataset(id,false)});
}
export const studyDatasetIds=Object.keys(studyDatasets);
export const isRealRegion=(id:string)=>realRegionIds.includes(id);
type StudyCatalogueEntry=Omit<Dataset,'nodes'|'edges'|'settlements'>&{nodes:number;edges:number;settlementCount:number;facilityCount:number};
export const studyCatalogue:Record<string,StudyCatalogueEntry>=Object.fromEntries([
 ...Object.entries({...syntheticDatasets,...originalReal}).map(([id,d])=>[id,{...d,nodes:d.nodes.length,edges:d.edges.length,settlementCount:d.settlements.length,facilityCount:d.facilities.length}]),
 ...Object.entries(expandedSummaries),
]);
export const baselineResults:Record<string,IndexResult>={
 ...Object.fromEntries(Object.entries({...syntheticDatasets,...originalReal}).map(([id,d])=>[id,calculate({...d,edges:d.edges.map(({geometry,...edge})=>edge)})])),
 ...Object.fromEntries(Object.entries(expandedSummaries).map(([id,s])=>[id,expandedBaseline(s)])),
};

const scenarioCache=new Map<string,{id:string;name:string;osmWayId?:string;lengthKm:number|null}[]>();
export function scenariosFor(d:Dataset){
 if(d.synthetic)return d.edges.filter(e=>e.kind!=='access').map(e=>({id:e.id,name:e.name??`${e.from} → ${e.to}`,lengthKm:e.lengthKm??null}));
 const previous=scenarioCache.get(d.regionId);if(previous)return previous;
 const baseline=calculate(d),lookup=new Map(d.edges.map(e=>[e.id,e]));
 const influence=new Map<string,number>();
 for(const point of baseline.points)for(const eid of point.path){const edge=lookup.get(eid);if(edge?.osmWayId)influence.set(edge.osmWayId,(influence.get(edge.osmWayId)??0)+edge.minutes);}
 const groups=new Map<string,{id:string;name:string;osmWayId:string;lengthKm:number}>();
 for(const edge of d.edges)if(edge.osmWayId){const g=groups.get(edge.osmWayId);if(g)g.lengthKm+=edge.lengthKm??0;else groups.set(edge.osmWayId,{id:edge.id,name:edge.name??edge.osmWayId,osmWayId:edge.osmWayId,lengthKm:edge.lengthKm??0});}
 const selection=[...groups.values()].filter(g=>g.lengthKm>=.4&&influence.has(g.osmWayId)).sort((a,b)=>(influence.get(b.osmWayId)??0)-(influence.get(a.osmWayId)??0)).filter((g,i,all)=>all.findIndex(x=>x.name===g.name)===i).slice(0,10);
 scenarioCache.set(d.regionId,selection);return selection;
}
export const pilotScenarioEdges=scenariosFor(studyDatasets.kaliningrad);
const cache=new Map<string,ReturnType<typeof compareScenario>>();
export function studyComparison(regionId:string,options:Partial<CalculationOptions>={}){
 const d=studyDatasets[regionId];if(!d)return null;
 if(!d.synthetic&&options.period==='night')throw new Error('Ночная доступность больниц не подтверждена.');
 const edgeId=options.scope==='point'||options.scope==='region'?undefined:options.edgeId??scenariosFor(d)[0]?.id;
 const key=JSON.stringify([regionId,{...options,edgeId}]);if(cache.has(key))return cache.get(key)!;
 const result=compareScenario(d,{...options,edgeId});if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(key,result);return result;
}
export function studyDescription(regionId:string){
 const summary=studyCatalogue[regionId];if(!summary)return null;
 const d=studyDatasets[regionId];
 return {hasRouting:Boolean(d),id:summary.id,regionId,synthetic:summary.synthetic,title:summary.title,profile:summary.profile,profileLabel:summary.profileLabel,date:summary.date,version:summary.version,sourceIds:summary.sourceIds,assumptions:summary.assumptions,metadata:summary.metadata,coverageLabel:summary.coverageLabel,settlementCount:summary.settlementCount,facilityCount:summary.facilityCount,nodes:summary.nodes,edges:summary.edges,scenarios:d?scenariosFor(d):[],baseline:baselineResults[regionId],facilities:summary.facilities};
}
export function studyMap(regionId:string,options:Partial<CalculationOptions>={}){
 const d=realDatasets[regionId],c=studyComparison(regionId,options)!;
 const byId=new Map(d.settlements.map(s=>[s.id,s]));
 const points=c.after.points.flatMap(p=>{const s=byId.get(p.id)!;if(s.lat===undefined||s.lon===undefined)return [];const {path,...short}=p;return [{...short,lat:s.lat,lon:s.lon,snapMeters:s.snapMeters}];});
 const selectedRoadIds=c.selectedRoads.map(r=>r.id);
 const selectedWayIds=new Set(selectedRoadIds.map(id=>d.edges.find(e=>e.id===id)?.osmWayId).filter(Boolean));
 const selectedRoad=[...d.edges.filter(e=>e.geometry?.length&& (selectedRoadIds.includes(e.id)||Boolean(e.osmWayId&&selectedWayIds.has(e.osmWayId)))),...c.proposedEdges];
 const coords=d.settlements.filter(s=>s.lat!==undefined&&s.lon!==undefined);
 const bounds=d.metadata?.mapBounds??[[Math.min(...coords.map(s=>s.lat!)),Math.min(...coords.map(s=>s.lon!))],[Math.max(...coords.map(s=>s.lat!)),Math.max(...coords.map(s=>s.lon!))]];
 return {synthetic:false,points,threshold:c.after.threshold,indexValue:c.after.value,distribution:auditResultMap(c.after),facilities:[...d.facilities,...c.proposedFacilities],selectedRoad:selectedRoad.map(e=>({id:e.id,name:e.name,geometry:e.geometry,proposed:e.id==='__proposal__road'})),bounds,metadata:d.metadata};
}
export function studyRoute(regionId:string,pointId:string,options:Partial<CalculationOptions>={}){
 const c=studyComparison(regionId,options)!,p=c.after.points.find(p=>p.id===pointId);if(!p)return null;
 const d=realDatasets[regionId],edges=new Map([...d.edges,...c.proposedEdges].map(e=>[e.id,e]));
 let cursor=d.settlements.find(s=>s.id===pointId)?.nodeId;
 const coordinates=p.path.flatMap(id=>{
  const e=edges.get(id);if(!e?.geometry)return [];
  const reversed=cursor===e.to;cursor=reversed?e.from:e.to;
  return [{id,coordinates:reversed?[...e.geometry].reverse():e.geometry,kind:e.kind}];
 });
 return {...p,coordinates,synthetic:false};
}
export const pilotMap=(options:Partial<CalculationOptions>={})=>studyMap('kaliningrad',options);
export const pilotRoute=(pointId:string,options:Partial<CalculationOptions>={})=>studyRoute('kaliningrad',pointId,options);

export function aggregateCohorts(results:IndexResult[]){
 const groups=new Map<string,IndexResult[]>();
 for(const r of results){const key=[r.methodologyVersion,r.profile,r.period,r.threshold,r.datasetVersion,r.synthetic].join('|');groups.set(key,[...(groups.get(key)??[]),r]);}
 const cohorts=[...groups.values()].map(items=>({...aggregate(items),profile:items[0].profile,version:items[0].datasetVersion,regions:items.length}));
 return {value:cohorts.length===1?cohorts[0].value:null,population:cohorts.reduce((sum,g)=>sum+g.population,0),label:'Доступность по сопоставимым группам',cohorts};
}
