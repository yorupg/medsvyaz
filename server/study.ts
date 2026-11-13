import {gunzipSync,brotliDecompressSync} from 'node:zlib';
import {auditResultMap} from '../shared/map-metrics';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {type RoadListOptions,calculate,compareScenario,settlementRoadOptions,validateDataset,aggregate} from '../shared/engine';
import {METHODOLOGY} from '../shared/schema';
import type {CalculationOptions,Dataset,IndexResult} from '../shared/schema';
import {expandedSummaries,expandedDataset,expandedBaseline} from './expanded';

// The national model retains historical MIED v6.1 coefficients (85/10/5).
// The two closest sources can be a public hospital, an adult polyclinic or a
// children's polyclinic. Private paid clinics are intentionally not eligible.
// Kaliningrad also has an experimental v6.2 (55/35/10) shown separately.
// OSM classification is NOT proof of public ownership or covered care.

type CatalogPlace={
 id:string;name:string;type:string;ownership?:string;roadNodeId?:string;
 sourceClass?:string;sourceUrl?:string;officiallyVerified?:boolean;
};
const medicalCatalogCache=new Map<string,CatalogPlace[]>();
function eligibleCatalogPlaces(regionId:string):CatalogPlace[]{
 const cached=medicalCatalogCache.get(regionId);if(cached)return cached;
 const pathname=resolve('public/data/medical-catalogs/'+regionId+'.json');
 let entries:CatalogPlace[]=[];
 if(existsSync(pathname)){
  try{
   const parsed=JSON.parse(readFileSync(pathname,'utf8')) as {facilities?:CatalogPlace[]};
   if(Array.isArray(parsed.facilities))entries=parsed.facilities.filter(e=>
    typeof e.id==='string' && typeof e.name==='string' &&
    typeof e.roadNodeId==='string' &&
    ['public_hospital','public_adult_polyclinic','public_children_polyclinic'].includes(e.type) &&
    ['public','synthetic'].includes(e.ownership??'')
   );
  }catch{/* Do not promote malformed or unverified records into eligible sources. */}
 }
 medicalCatalogCache.set(regionId,entries);
 return entries;
}
function medicalClinicNodes(regionId:string):string[]{
 return [...new Set(eligibleCatalogPlaces(regionId)
  .filter(e=>['public_adult_polyclinic','public_children_polyclinic'].includes(e.type))
  .map(e=>e.roadNodeId!))];
}
function withMedicalData(d:Dataset):Dataset{
 const clinicNodeIds=medicalClinicNodes(d.regionId);
 const metadata={...(d.metadata??{}),clinicNodeIds};
 if(d.regionId==='kaliningrad')return {...d,metadata};
 const existingNodes=new Set(d.nodes.map(n=>n.id));
 const existingIds=new Set(d.facilities.map(f=>f.id));
 const existingSiteNodes=new Set(d.facilities.filter(f=>d.synthetic||f.verified).map(f=>f.nodeId));
 const additional:Dataset['facilities']=[];
 for(const entry of eligibleCatalogPlaces(d.regionId)){
  // Preserve the historical hospital cohort. Map-only OSM classification is not
  // enough to enter the national benchmark: verify the actual service/profile first.
  if(!['public_adult_polyclinic','public_children_polyclinic'].includes(entry.type) || entry.officiallyVerified!==true)continue;
  const nodeId=entry.roadNodeId!;
  // Both the closest and the reserve MUST refer to different physical sites.
  if(!existingNodes.has(nodeId)||existingSiteNodes.has(nodeId))continue;
  const id='catalog-'+d.regionId+'-'+entry.id;
  if(id.length>120||existingIds.has(id))continue;
  const isPolyclinic=entry.type==='public_adult_polyclinic'||entry.type==='public_children_polyclinic';
  additional.push({
   id,name:entry.name,nodeId,profile:d.profile,periods:['day'],
   verified:entry.officiallyVerified===true,
   provenance:entry.sourceClass==='synthetic'?'synthetic-public-medical-catalog':
    entry.officiallyVerified===true?'official-public-medical-catalog':'osm-classified-public-medical-catalog',
   facilityType:isPolyclinic?(entry.type==='public_children_polyclinic'?'Детская поликлиника':'Взрослая поликлиника'):'Государственная больница',
   sourceUrl:entry.sourceUrl,
  });
  existingIds.add(id);existingSiteNodes.add(nodeId);
 }
 return {...d,metadata:{...metadata,publicMedicalSitesFromCatalog:additional.length},
  facilities:[...d.facilities,...additional]};
}
function medicalMethod(_d:Dataset):'6.1.0'{
 // One national benchmark; experimental Kaliningrad calculations are opt-in.
 return '6.1.0';
}
function calculateCurrent(d:Dataset){return calculate(withMedicalData(d),{methodologyVersion:medicalMethod(d)});}

const originalReal=Object.fromEntries(['kaliningrad','ivanovo','pskov'].map(id=>{
 const path=resolve('data/processed/'+id+'-pilot.json');
 const gz=resolve('data/processed/'+id+'-pilot.json.gz');
 const br=resolve('data/processed/'+id+'-pilot.json.br');
 const raw=existsSync(path)?readFileSync(path):existsSync(gz)?gunzipSync(readFileSync(gz)):brotliDecompressSync(readFileSync(br));
 return [id,withMedicalData(validateDataset(JSON.parse(raw.toString('utf8'))))];
}));
export const realRegionIds=[...Object.keys(originalReal),...Object.keys(expandedSummaries)];
export const realDatasets:Record<string,Dataset>={...originalReal};
export const pilot=originalReal.kaliningrad;
// In-depth pilot is never substituted for the primary 85/10/5 regional result.
// Unlike the common index, this pilot uses preliminary OSM-classified clinic sites.
const experimentalCache=new Map<string,IndexResult>();
export function kaliningradExperimental(options:{threshold?:number;timeScale?:number}={}):IndexResult {
 const threshold=options.threshold??40,timeScale=options.timeScale??1;
 const key=`${threshold}:${timeScale}`;
 const cached=experimentalCache.get(key);if(cached)return cached;
 const result=calculate(studyDatasets.kaliningrad,{methodologyVersion:'6.2.0',threshold,timeScale,scenario:'baseline'});
 result.warnings.push('ЭКСПЕРИМЕНТ: предварительная классификация поликлиник OSM не означает подтверждённый профиль и бесплатность обслуживания. Не сравнивать баллы 55/35/10 с общероссийским МИЭД 85/10/5.');
 if(experimentalCache.size>6)experimentalCache.clear();
 experimentalCache.set(key,result);
 return result;
}
const generated=JSON.parse(readFileSync(resolve('data/processed/synthetic-regions.json'),'utf8')) as Record<string,Dataset>;
export const syntheticDatasets=Object.fromEntries(Object.entries(generated).filter(([id])=>!realRegionIds.includes(id)).map(([id,d])=>[id,withMedicalData(d)]));
export const studyDatasets:Record<string,Dataset>={...syntheticDatasets,...Object.fromEntries(Object.entries(originalReal).map(([id,d])=>[id,{...d,edges:d.edges.map(({geometry,...edge})=>edge)}]))};
for(const id of Object.keys(expandedSummaries)){
 Object.defineProperty(realDatasets,id,{enumerable:true,get:()=>withMedicalData(expandedDataset(id))});
 Object.defineProperty(studyDatasets,id,{enumerable:true,get:()=>withMedicalData(expandedDataset(id,false))});
}
export const studyDatasetIds=Object.keys(studyDatasets);
export const isRealRegion=(id:string)=>realRegionIds.includes(id);
type StudyCatalogueEntry=Omit<Dataset,'nodes'|'edges'|'settlements'>&{nodes:number;edges:number;settlementCount:number;facilityCount:number};
export const studyCatalogue:Record<string,StudyCatalogueEntry>=Object.fromEntries([
 ...Object.entries({...syntheticDatasets,...originalReal}).map(([id,d])=>[id,{...d,nodes:d.nodes.length,edges:d.edges.length,settlementCount:d.settlements.length,facilityCount:d.facilities.length}]),
 ...Object.entries(expandedSummaries),
]);
export const baselineResults:Record<string,IndexResult>={
 ...Object.fromEntries(Object.entries({...syntheticDatasets,...originalReal}).map(([id,d])=>[id,calculateCurrent({...d,edges:d.edges.map(({geometry,...edge})=>edge)})])),
 ...Object.fromEntries(Object.entries(expandedSummaries).map(([id,s])=>[id,expandedBaseline(s)])),
};

for(const [id] of Object.entries(expandedSummaries)){
 if(!eligibleCatalogPlaces(id).some(p=>p.officiallyVerified===true && ['public_adult_polyclinic','public_children_polyclinic'].includes(p.type)))continue;
 let result:IndexResult|null=null;
 Object.defineProperty(baselineResults,id,{enumerable:true,configurable:true,get(){
  if(!result)result=calculateCurrent(studyDatasets[id]);
  return result;
 }});
}

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
 const result=compareScenario(d,{...options,methodologyVersion:medicalMethod(d),edgeId});if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(key,result);return result;
}
const roadOptionCache=new Map<string,ReturnType<typeof settlementRoadOptions>>();
type SavedRoadOptions={methodology:string;threshold:number;timeScale:number;regions:Record<string,ReturnType<typeof settlementRoadOptions>>};
const optionsFile=resolve('data/derived/road-options-v5.json');
const defaults:SavedRoadOptions|null=existsSync(optionsFile)?JSON.parse(readFileSync(optionsFile,'utf8')):null;
export function studyRoadOptions(id:string,options:RoadListOptions){
 if(id!=='kaliningrad' && defaults?.methodology===METHODOLOGY.version && defaults.threshold===options.threshold && defaults.timeScale===options.timeScale && Object.hasOwn(defaults.regions,id)){
  return defaults.regions[id];
 }
 const key=JSON.stringify([id,options.threshold,options.timeScale,options.minRoadMinutes,options.minRoadPercent]);
 const cached=roadOptionCache.get(key);
 if(cached)return cached;
 const rows=settlementRoadOptions(studyDatasets[id],options);
 if(roadOptionCache.size>=100)roadOptionCache.delete(roadOptionCache.keys().next().value!);
 roadOptionCache.set(key,rows);
 return rows;
}

export function studyDescription(regionId:string){
 const summary=studyCatalogue[regionId];if(!summary)return null;
 const d=studyDatasets[regionId];
 return {id:summary.id,regionId,synthetic:summary.synthetic,title:summary.title,profile:summary.profile,profileLabel:summary.profileLabel,medicalMethodologyVersion:medicalMethod(d),experimentalAvailable:regionId==='kaliningrad',date:summary.date,version:summary.version,sourceIds:summary.sourceIds,assumptions:summary.assumptions,metadata:summary.metadata,coverageLabel:summary.coverageLabel,settlementCount:summary.settlementCount,facilityCount:d.facilities.length,nodes:summary.nodes,edges:summary.edges,scenarios:scenariosFor(d),baseline:baselineResults[regionId],facilities:d.facilities};
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
