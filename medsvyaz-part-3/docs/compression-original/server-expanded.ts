import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {validateDataset,summarizePoints} from '../shared/engine';
import type {Dataset,IndexResult,PointResult} from '../shared/schema';

type ExpandedSummary=Omit<Dataset,'nodes'|'edges'|'settlements'>&{
 nodes:number;edges:number;settlementCount:number;facilityCount:number;
 baselinePoints:Omit<PointResult,'path'>[];
 independentCheck:{index:number;includedPopulation:number;includedSettlements:number;populationCoverage:number};
};
const directory=resolve('data/processed/expanded');
export const expandedSummaries:Record<string,ExpandedSummary>=Object.fromEntries(
 readdirSync(directory).filter(name=>name.endsWith('-summary.json')).map(name=>{
  const summary=JSON.parse(readFileSync(resolve(directory,name),'utf8')) as ExpandedSummary;
  return [summary.regionId,summary];
 })
);

// Keep one selected graph in memory. The catalogue never expands the road files.
let current:{id:string;full:Dataset;routing:Dataset}|undefined;
export function expandedDataset(id:string,geometry=true):Dataset{
 if(current?.id!==id){
  const full=validateDataset(JSON.parse(gunzipSync(readFileSync(resolve(directory,id+'.json.gz'))).toString('utf8')));
  current={id,full,routing:{...full,edges:full.edges.map(({geometry,...edge})=>edge)}};
 }
 return geometry?current.full:current.routing;
}

/** Stored point times are independently recomputed from the archived road graph.
 * The live scenario engine recalculates paths when a region is opened. */
export function expandedBaseline(summary:ExpandedSummary):IndexResult{
 const current=resolve('data/derived/v4-baselines/'+summary.regionId+'.json');
 const origins=existsSync(current)?JSON.parse(readFileSync(current,'utf8')).points:summary.baselinePoints;
 const points:PointResult[]=origins.map((p:PointResult)=>({...p,path:[],facilityId:p.facilityId??null}));
 return summarizePoints(summary,points);
}
