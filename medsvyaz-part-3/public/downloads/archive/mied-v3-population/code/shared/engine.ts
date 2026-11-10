import {CalculationSchema, DatasetSchema, METHODOLOGY, type CalculationOptions, type Dataset, type IndexResult, type PointResult} from './schema';

/** Min-heap makes multi-source Dijkstra O((V+E) log V), not O(V²). */
class MinHeap {
  data:[number,string][]=[];
  push(item:[number,string]) { const a=this.data; a.push(item); let i=a.length-1; while(i>0){const p=(i-1)>>1;if(a[p][0]<=item[0])break;a[i]=a[p];i=p;}a[i]=item; }
  pop():[number,string]|undefined {const a=this.data;if(!a.length)return;const top=a[0],last=a.pop()!;if(a.length){let i=0;while(2*i+1<a.length){let c=2*i+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return top;}
}
export function validateDataset(input:unknown):Dataset {
  const d=DatasetSchema.parse(input);
  for(const key of ['nodes','edges','settlements','facilities'] as const){const ids=d[key].map(x=>x.id);if(new Set(ids).size!==ids.length)throw new Error(`Дублирующиеся id: ${key}`);}
  const nodes=new Set(d.nodes.map(n=>n.id));
  for(const e of d.edges)if(!nodes.has(e.from)||!nodes.has(e.to))throw new Error(`Ребро ${e.id}: неизвестная вершина`);
  for(const s of d.settlements)if(s.nodeId&&!nodes.has(s.nodeId))throw new Error(`Пункт ${s.id}: неизвестная вершина`);
  for(const f of d.facilities)if(!nodes.has(f.nodeId))throw new Error(`Учреждение ${f.id}: неизвестная вершина`);
  const population=d.settlements.reduce((s,p)=>s+(p.population??0),0);
  if(d.expectedPopulation!==null&&d.expectedPopulation<population)throw new Error('Численность охвата превышает население территории');
  return d;
}
export function accessibility(minutes:number|null,threshold:number) {if(!Number.isFinite(threshold)||threshold<=0)throw new Error('Параметр τ должен быть положительным');if(minutes===null)return 0;if(!Number.isFinite(minutes)||minutes<0)throw new Error('Некорректное время');return Math.pow(2,-minutes/threshold);}

/** Reverse edges: a search starting at facilities finds travel TO each facility. */
export function calculate(input:Dataset, options:Partial<CalculationOptions>={}):IndexResult {
  const d=validateDataset(input),o=CalculationSchema.parse(options);
  if(o.scenario!=='baseline'&&(!o.edgeId||!d.edges.some(e=>e.id===o.edgeId)))throw new Error('Выберите существующее ребро графа');
  const facilities=d.facilities.filter(f=>(d.synthetic||f.verified)&&f.profile===d.profile&&f.periods.includes(o.period)&&(!o.facilityIds||o.facilityIds.includes(f.id))).sort((a,b)=>a.id.localeCompare(b.id));
  const result=emptyResult(d,o);
  if(!facilities.length){result.warnings.push('Нет подтверждённого набора подходящих учреждений для выбранного профиля и периода.');return result;}
  type Arc={node:string;time:number;edge:string};
  const reverse=new Map<string,Arc[]>(d.nodes.map(n=>[n.id,[]]));
  const selectedWay=d.edges.find(e=>e.id===o.edgeId)?.osmWayId;
  for(const e of [...d.edges].sort((a,b)=>a.id.localeCompare(b.id))){const selected=e.id===o.edgeId||Boolean(selectedWay&&e.osmWayId===selectedWay);if(!e.allowed||(o.scenario==='closure'&&selected))continue;const time=e.minutes*o.timeScale/(o.scenario==='improvement'&&selected?o.multiplier:1);reverse.get(e.to)!.push({node:e.from,time,edge:e.id});if(!e.directed)reverse.get(e.from)!.push({node:e.to,time,edge:e.id});}
  const distance=new Map<string,number>(),next=new Map<string,{node:string;edge:string}>(),target=new Map<string,string>(),heap=new MinHeap();
  for(const f of facilities){if(distance.has(f.nodeId))continue;distance.set(f.nodeId,0);target.set(f.nodeId,f.id);heap.push([0,f.nodeId]);}
  while(heap.data.length){const [dist,node]=heap.pop()!;if(dist!==distance.get(node))continue;for(const arc of reverse.get(node)!){const alt=dist+arc.time;if(alt<(distance.get(arc.node)??Infinity)){distance.set(arc.node,alt);target.set(arc.node,target.get(node)!);next.set(arc.node,{node,edge:arc.edge});heap.push([alt,arc.node]);}}}
  const evidence=d.metadata?.confirmedUnreachableIds;
  const confirmedUnreachable=new Set<string>(Array.isArray(evidence)?evidence.filter((id):id is string=>typeof id==='string'):[]);
  const points:PointResult[]=[...d.settlements].sort((a,b)=>a.id.localeCompare(b.id)).map(s=>{
    const missing=s.population===null?'missing_population':s.nodeId===null?'missing_node':null;
    const t=s.nodeId?distance.get(s.nodeId):undefined;
    const path:string[]=[];let cursor=s.nodeId;let guard=0;
    while(cursor&&next.has(cursor)&&guard++<d.nodes.length){const n=next.get(cursor)!;path.push(n.edge);cursor=n.node;}
    const routeStatus=t===undefined?(d.synthetic||confirmedUnreachable.has(s.id)?'unreachable':'route_unverified'):'reachable';
    return {id:s.id,name:s.name,municipality:s.municipality,population:s.population,minutes:missing?null:t??null,score:missing||routeStatus==='route_unverified'?null:accessibility(t??null,o.threshold),status:missing??routeStatus,facilityId:!missing&&s.nodeId?target.get(s.nodeId)??null:null,path:missing?[]:path};
  });
  return summarizePoints(d,points,o);
}


export type ResultDataset=Pick<Dataset,'id'|'version'|'sourceIds'|'synthetic'|'profile'|'expectedPopulation'|'metadata'>;
function emptyResult(d:ResultDataset,o:CalculationOptions):IndexResult{
  return {value:null,unit:'points',status:'no_data',synthetic:d.synthetic,methodologyVersion:o.methodologyVersion,datasetId:d.id,datasetVersion:d.version,sourceIds:d.sourceIds,period:o.period,profile:d.profile,threshold:o.threshold,numerator:0,population:0,populationCoverage:null,expectedPopulation:d.expectedPopulation,includedSettlements:0,missingSettlements:0,unreachableSettlements:0,unverifiedRoutes:0,reachablePopulation:0,withinThresholdPopulation:0,withinThresholdShare:null,withinMinutesShares:{'30':null,'60':null,'90':null,'120':null},meanMinutes:null,medianMinutes:null,points:[],warnings:[],p90Minutes:null,overMinutesShares:{'60':null,'90':null},excludedPopulation:d.expectedPopulation,unreachablePopulation:0,indexBounds:{lower:null,upper:null},facilityEvidence:d.synthetic?'synthetic':d.profile==='mapped-hospital'?'osm-unverified-profile':'official-source'};
}

export function weightedTimeQuantile(points:PointResult[],quantile:number){
 if(!Number.isFinite(quantile)||quantile<0||quantile>1)throw new Error('Некорректный квантиль');
 const reachable=points.filter(p=>p.minutes!==null&&(p.population??0)>0),population=reachable.reduce((sum,p)=>sum+p.population!,0);
 if(!population)return null;
 let cumulative=0;for(const p of [...reachable].sort((a,b)=>a.minutes!-b.minutes!)){cumulative+=p.population!;if(cumulative>=quantile*population)return p.minutes;}
 return null;
}
/** Always evaluate each origin's time. Saved scores and aggregate indices are not inputs. */
export function summarizePoints(d:ResultDataset,inputPoints:PointResult[],options:Partial<CalculationOptions>={}):IndexResult{
 const o=CalculationSchema.parse(options),result=emptyResult(d,o);
 const points=inputPoints.map(p=>({...p,score:p.population===null||['missing_population','missing_node','route_unverified'].includes(p.status)?null:p.status==='unreachable'?0:accessibility(p.minutes,o.threshold)}));
  result.points=points;
  const included=points.filter(p=>p.score!==null);
  result.population=included.reduce((s,p)=>s+p.population!,0);
  result.includedSettlements=included.length;result.missingSettlements=points.length-included.length;
  result.unreachableSettlements=included.filter(p=>p.status==='unreachable').length;
  result.unverifiedRoutes=points.filter(p=>p.status==='route_unverified').length;
  result.numerator=included.reduce((s,p)=>s+p.population!*p.score!,0);
  result.value=result.population>0?100*result.numerator/result.population:null;
  const reachable=included.filter(p=>p.minutes!==null);
  result.reachablePopulation=reachable.reduce((s,p)=>s+p.population!,0);
  result.withinThresholdPopulation=reachable.filter(p=>p.minutes!<=o.threshold).reduce((s,p)=>s+p.population!,0);
  result.withinThresholdShare=result.population?result.withinThresholdPopulation/result.population:null;
  for(const limit of [30,60,90,120] as const)result.withinMinutesShares[String(limit) as '30'|'60'|'90'|'120']=result.population?reachable.filter(p=>p.minutes!<=limit).reduce((s,p)=>s+p.population!,0)/result.population:null;
  result.meanMinutes=result.reachablePopulation?reachable.reduce((s,p)=>s+p.population!*p.minutes!,0)/result.reachablePopulation:null;
  if(result.reachablePopulation){let cumulative=0;for(const p of [...reachable].sort((a,b)=>a.minutes!-b.minutes!)){cumulative+=p.population!;if(cumulative>=result.reachablePopulation/2){result.medianMinutes=p.minutes;break;}}}
  result.populationCoverage=d.expectedPopulation?result.population/d.expectedPopulation:null;

  result.p90Minutes=weightedTimeQuantile(reachable,.9);
  result.medianMinutes=weightedTimeQuantile(reachable,.5);
  for(const limit of [60,90] as const)result.overMinutesShares[String(limit) as '60'|'90']=result.reachablePopulation?reachable.filter(p=>p.minutes!>limit).reduce((sum,p)=>sum+(p.population??0),0)/result.reachablePopulation:null;
  result.unreachablePopulation=included.filter(p=>p.status==='unreachable').reduce((sum,p)=>sum+(p.population??0),0);
  result.excludedPopulation=d.expectedPopulation===null?null:Math.max(0,d.expectedPopulation-result.population);
  if(d.expectedPopulation&&result.value!==null)result.indexBounds={lower:100*result.numerator/d.expectedPopulation,upper:100*(result.numerator+result.excludedPopulation!)/d.expectedPopulation};
  result.status=result.value===null?'no_data':result.missingSettlements>0||result.populationCoverage!==1?'partial':d.synthetic?'needs_review':d.metadata?.regionalScopeVerified===true?'verified':'partial';
  if(!d.synthetic)result.warnings.push('Модель на реальных исходных данных: население ВПН-2021, дороги OSM-2026, выбранные больницы. Времена рассчитаны, не измерены. Это не время прибытия скорой помощи или начала лечения.');
  if(d.synthetic)result.warnings.push('Синтетические дорожные связи и условные центры. Индекс относится к выборке модели; происхождение населения и координат указано у каждой точки.');
  if(result.missingSettlements)result.warnings.push(`${result.missingSettlements} пунктов исключено из-за пропусков. Индекс описывает только включённое население.`);
  if(result.unreachableSettlements)result.warnings.push(d.metadata?.scenarioUnreachability===true?'Потерянные в сценарии закрытия маршруты получают ноль при сохранении базового населения. Среднее и медиана относятся к оставшимся достижимым точкам.':'Подтверждённо недостижимые пункты включены с нулевой доступностью. Среднее и медиана времени относятся только к достижимому населению.');
  if(result.unverifiedRoutes)result.warnings.push(`${result.unverifiedRoutes} пунктов без пути в ограниченном графе исключены: фактическая автомобильная изоляция не подтверждена. Требуется проверить дороги и больницы соседних регионов.`);
  if(result.populationCoverage===null)result.warnings.push('Полный знаменатель населения не подтверждён; доля покрытия неизвестна.');
  return result;
}

export function compareScenario(d:Dataset,o:Partial<CalculationOptions>={}) {
  const options=CalculationSchema.parse(o),baseline=calculate(d,{...options,scenario:'baseline'});
  // A deliberately closed road is a known change in the model. Keep the
  // baseline population cohort, assigning zero to routes lost in that scenario.
  // Missing baseline evidence remains missing; this asserts no real-world isolation.
  const scenarioDataset=options.scenario==='closure'&&!d.synthetic?{...d,metadata:{...d.metadata,
    confirmedUnreachableIds:[...(Array.isArray(d.metadata?.confirmedUnreachableIds)?d.metadata.confirmedUnreachableIds:[]),
      ...baseline.points.filter(p=>p.status==='reachable').map(p=>p.id)],
    scenarioUnreachability:true}}:d;
  const after=calculate(scenarioDataset,options);
  const delta=baseline.population===after.population&&baseline.value!==null&&after.value!==null?after.value-baseline.value:null;
  const beforeById=new Map(baseline.points.map(p=>[p.id,p]));
  const affectedPopulation=after.points.reduce((sum,p)=>sum+((p.minutes!==beforeById.get(p.id)?.minutes)?p.population??0:0),0);
  return {baseline,after,delta,comparisonWarning:baseline.population!==after.population?'Охват населения изменился: изменение индекса между сценариями не сопоставимо.':null,relativeChange:delta!==null&&baseline.value!==null&&baseline.value!==0?100*delta/baseline.value:null,affectedPopulation,cost:options.cost,costQuality:options.cost===null?'not_provided':'scenario_assumption',pointsPerMillion:delta!==null&&options.cost!==null?delta/(options.cost/1e6):null,options};
}

export function aggregate(results:IndexResult[]) {
  const included=results.filter(r=>r.value!==null);
  if(!included.length)return {value:null,population:0,label:'Нет сопоставимых результатов'};
  const key=(r:IndexResult)=>[r.methodologyVersion,r.profile,r.period,r.threshold,r.datasetVersion,r.synthetic].join('|');
  if(new Set(included.map(key)).size!==1)throw new Error('Несопоставимые методики, профили, периоды, пороги или версии');
  if(new Set(included.map(r=>r.datasetId)).size!==included.length)throw new Error('Повтор набора при агрегации');
  const population=included.reduce((s,r)=>s+r.population,0);
  return {value:population?100*included.reduce((s,r)=>s+r.numerator,0)/population:null,population,label:'Индекс покрытой части'};
}
