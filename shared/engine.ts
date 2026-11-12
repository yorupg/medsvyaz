import {z} from 'zod';
import {enrichV61Routing} from './v61-routing';
import fixedCorridors from '../data/derived/v6-extended/corridors.json';
import pilotScreen from '../data/planning/kaliningrad-road-screen.json';
import roadCorridors from '../data/planning/approved-road-corridors.json';
import preliminaryRoadCandidates from '../data/planning/algorithmic-road-candidates.json';
import {PILOT_ROAD_DEFAULTS,CalculationSchema, DatasetSchema, METHODOLOGY, type CalculationOptions, type Dataset, type IndexResult, type PointResult} from './schema';

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
/** t <= comfortMinutes is considered a comfortable local trip. At t=threshold accessibility=0.5. Legacy defaults stay exponential. */
export function accessibility(minutes:number|null,threshold:number,comfortMinutes=0,gamma=1) {
 if(!Number.isFinite(threshold)||threshold<=comfortMinutes||comfortMinutes<0)throw new Error('Параметр τ должен быть больше комфортного времени');
 if(minutes===null)return 0;
 if(!Number.isFinite(minutes)||minutes<0)throw new Error('Некорректное время');
 return minutes<=comfortMinutes?1:Math.pow(2,-((gamma>1&&minutes>60)?(60-comfortMinutes+gamma*(minutes-60)):(minutes-comfortMinutes))/(threshold-comfortMinutes));
}
export function comfortFor(version:string){return ['5.0.0','6.1.0'].includes(version)?15:0;}

/** Rank OSM ways by predicted accessibility gain if travel time on them is divided by multiplier.
 * The ranking uses the baseline shortest paths; actual gains and paths are ALWAYS recalculated. */
export function selectImprovementRoads(d:Dataset,baseline:IndexResult,scope:'point'|'region',multiplier:number,pointId?:string,timeScale=1){
 const edges=new Map(d.edges.map(e=>[e.id,e]));
 const all=new Map<string,{id:string;name:string;gain:number;minutesSaved:number;origins:Set<string>}>();
 const cohort=scope==='point'?baseline.points.filter(p=>p.id===pointId):baseline.points;
 if(scope==='point'&&!cohort.length)throw new Error('Выберите населённый пункт для улучшения маршрута');
 for(const origin of cohort){if(origin.minutes===null||origin.score===null||!origin.path.length)continue;
  const groups=new Map<string,{id:string;name:string;minutes:number}>();
  for(const eid of origin.path){const e=edges.get(eid);if(!e||!e.allowed||e.kind==='access')continue;
   const key=e.osmWayId??e.id,prior=groups.get(key);
   if(prior)prior.minutes+=e.minutes;else groups.set(key,{id:e.id,name:e.name??key,minutes:e.minutes});
  }
  for(const [key,g] of groups){const minutesSaved=g.minutes*timeScale*(1-1/multiplier);
   const predicted=accessibility(Math.max(0,origin.minutes-minutesSaved),baseline.threshold,comfortFor(baseline.methodologyVersion))-accessibility(origin.minutes,baseline.threshold,comfortFor(baseline.methodologyVersion));
   const agg=all.get(key)??{id:g.id,name:g.name,gain:0,minutesSaved:0,origins:new Set<string>()};
   agg.gain+=predicted;agg.minutesSaved+=minutesSaved;agg.origins.add(origin.id);all.set(key,agg);
  }
 }
 return [...all.values()].sort((a,b)=>b.gain-a.gain||b.minutesSaved-a.minutesSaved||a.id.localeCompare(b.id)).slice(0,scope==='region'?4:1).map(g=>({id:g.id,name:g.name,predictedGain:g.gain,estimatedMinutesSaved:g.minutesSaved,affectedOrigins:g.origins.size}));
}


/** Reverse edges: a search starting at facilities finds travel TO each facility. */
export function calculate(input:Dataset, options:Partial<CalculationOptions>={}):IndexResult {
  return routeValidatedDataset(validateDataset(input),CalculationSchema.parse(options));
}

function routeValidatedDataset(d:Dataset,o:CalculationOptions):IndexResult {
  if(['improvement','closure'].includes(o.scenario)&&!o.improvementEdgeIds?.length&&(!o.edgeId||!d.edges.some(e=>e.id===o.edgeId)))throw new Error('Выберите существующее ребро графа');
  const facilities=d.facilities.filter(f=>(d.synthetic||f.verified||f.id==='__proposal__facility')&&f.profile===d.profile&&f.periods.includes(o.period)&&(!o.facilityIds||o.facilityIds.includes(f.id))).sort((a,b)=>a.id.localeCompare(b.id));
  const result=emptyResult(d,o);
  if(!facilities.length){result.warnings.push('Нет подтверждённого набора подходящих учреждений для выбранного профиля и периода.');return result;}
  type Arc={node:string;time:number;edge:string};
  const reverse=new Map<string,Arc[]>(d.nodes.map(n=>[n.id,[]]));
  const selectedWay=d.edges.find(e=>e.id===o.edgeId)?.osmWayId;
  const selectedIds=new Set(o.improvementEdgeIds??[]);
  for(const e of [...d.edges].sort((a,b)=>a.id.localeCompare(b.id))){const selected=selectedIds.has(e.id)||e.id===o.edgeId||Boolean(selectedWay&&e.osmWayId===selectedWay);if(!e.allowed||(o.scenario==='closure'&&selected))continue;const time=e.minutes*o.timeScale/(o.scenario==='improvement'&&selected?o.multiplier:1);reverse.get(e.to)!.push({node:e.from,time,edge:e.id});if(!e.directed)reverse.get(e.from)!.push({node:e.to,time,edge:e.id});}
  const distance=new Map<string,number>(),next=new Map<string,{node:string;edge:string}>(),target=new Map<string,string>(),heap=new MinHeap();
  for(const f of facilities){if(distance.has(f.nodeId))continue;distance.set(f.nodeId,0);target.set(f.nodeId,f.id);heap.push([0,f.nodeId]);}
  while(heap.data.length){const [dist,node]=heap.pop()!;if(dist!==distance.get(node))continue;for(const arc of reverse.get(node)!){const alt=dist+arc.time;if(alt<(distance.get(arc.node)??Infinity)){distance.set(arc.node,alt);target.set(arc.node,target.get(node)!);next.set(arc.node,{node,edge:arc.edge});heap.push([alt,arc.node]);}}}
  const evidence=d.metadata?.confirmedUnreachableIds;
  const confirmedUnreachable=new Set<string>(Array.isArray(evidence)?evidence.filter((id):id is string=>typeof id==='string'):[]);
  const points:PointResult[]=[...d.settlements].sort((a,b)=>a.id.localeCompare(b.id)).map(s=>{
    const missing=s.nodeId===null?'missing_node':!['4.0.0','5.0.0'].includes(o.methodologyVersion)&&s.population===null?'missing_population':null;
    const t=s.nodeId?distance.get(s.nodeId):undefined;
    const path:string[]=[];let cursor=s.nodeId;let guard=0;
    while(cursor&&next.has(cursor)&&guard++<d.nodes.length){const n=next.get(cursor)!;path.push(n.edge);cursor=n.node;}
    const routeStatus=t===undefined?(d.synthetic||confirmedUnreachable.has(s.id)?'unreachable':'route_unverified'):'reachable';
    return {id:s.id,name:s.name,municipality:s.municipality,population:s.population,minutes:missing?null:t??null,score:missing||routeStatus==='route_unverified'?null:accessibility(t??null,o.threshold,comfortFor(o.methodologyVersion)),status:missing??routeStatus,facilityId:!missing&&s.nodeId?target.get(s.nodeId)??null:null,path:missing?[]:path};
  });
  return summarizePoints(d,o.methodologyVersion==='6.1.0'?enrichV61Routing(d,o,points):points,o);
}


export type ResultDataset=Pick<Dataset,'id'|'version'|'sourceIds'|'synthetic'|'profile'|'expectedPopulation'|'metadata'>&{regionId?:string};
function emptyResult(d:ResultDataset,o:CalculationOptions):IndexResult{
  return {value:null,unit:'points',status:'no_data',synthetic:d.synthetic,methodologyVersion:o.methodologyVersion,datasetId:d.id,datasetVersion:d.version,sourceIds:d.sourceIds,period:o.period,profile:d.profile,threshold:o.threshold,weighting:o.methodologyVersion==='6.1.0'?'hybrid':['4.0.0','5.0.0'].includes(o.methodologyVersion)?'settlement':'population',denominator:0,expectedSettlements:0,settlementCoverage:null,reachableSettlements:0,withinThresholdSettlements:0,numerator:0,population:0,populationCoverage:null,expectedPopulation:d.expectedPopulation,includedSettlements:0,missingSettlements:0,unreachableSettlements:0,unverifiedRoutes:0,reachablePopulation:0,withinThresholdPopulation:0,withinThresholdShare:null,withinMinutesShares:{'30':null,'60':null,'90':null,'120':null},meanMinutes:null,medianMinutes:null,points:[],warnings:[],p90Minutes:null,overMinutesShares:{'60':null,'90':null},excludedPopulation:d.expectedPopulation,unreachablePopulation:0,indexBounds:{lower:null,upper:null},territorialIndex:null,populationIndex:null,isolatedSettlementsShare:null,isolatedPopulationShare:null,backupWithin60Share:null,stressWayIds:[],facilityEvidence:d.synthetic?'synthetic':d.profile==='mapped-hospital'?'osm-unverified-profile':'official-source'};
}

export function weightedTimeQuantile(points:PointResult[],quantile:number,unitWeights=false){
 if(!Number.isFinite(quantile)||quantile<0||quantile>1)throw new Error('Некорректный квантиль');
 const reachable=points.filter(p=>p.minutes!==null&&(unitWeights||(p.population??0)>0)),population=reachable.reduce((sum,p)=>sum+(unitWeights?1:p.population!),0);
 if(!population)return null;
 let cumulative=0;for(const p of [...reachable].sort((a,b)=>a.minutes!-b.minutes!)){cumulative+=unitWeights?1:p.population!;if(cumulative>=quantile*population)return p.minutes;}
 return null;
}
/** Always evaluate each origin's time. Saved scores and aggregate indices are not inputs. */
export function summarizePoints(d:ResultDataset,inputPoints:PointResult[],options:Partial<CalculationOptions>={}):IndexResult{
 const o=CalculationSchema.parse(options),result=emptyResult(d,o),v61=o.methodologyVersion==='6.1.0',unit=['4.0.0','5.0.0'].includes(o.methodologyVersion);
 const points=inputPoints.map(p=>{
  // V6.1 demands a common, population-known cohort for BOTH territorial and demographic terms.
  // A graph-unverified route remains unknown, never a confirmed zero.
  const status=unit&&p.status==='missing_population'?(p.minutes!==null?'reachable':'route_unverified'):p.status;
  const excluded=['missing_population','missing_node','route_unverified'].includes(status)||(v61&&p.population===null);
  const score=excluded?null:status==='unreachable'?0:v61?
   (p.backupMinutes===undefined||p.robustMinutes===undefined?null:
    .85*accessibility(p.minutes,o.threshold,15,2)+
    .10*accessibility(p.backupMinutes,o.threshold,15,2)+
    .05*accessibility(p.robustMinutes,o.threshold,15,2)):
   accessibility(p.minutes,o.threshold,comfortFor(o.methodologyVersion));
  return {...p,status,score} as PointResult;
 });
 result.points=points;
 const included=points.filter(p=>p.score!==null),N=included.length;
 const includedPopulation=included.reduce((sum,p)=>sum+(p.population??0),0);
 const hybridValid=!v61||includedPopulation>0;
 const weight=(p:PointResult)=>v61?(hybridValid&&N?(.752/N+.248*(p.population??0)/includedPopulation):0):unit?1:p.population??0;
 result.population=includedPopulation;
 result.includedSettlements=N;result.expectedSettlements=points.length;
 result.settlementCoverage=points.length?N/points.length:null;
 result.missingSettlements=points.length-N;
 result.unreachableSettlements=included.filter(p=>p.status==='unreachable').length;
 result.unverifiedRoutes=points.filter(p=>p.status==='route_unverified').length;
 result.numerator=included.reduce((sum,p)=>sum+weight(p)*p.score!,0);
 result.denominator=v61?(hybridValid&&N?1:0):unit?N:includedPopulation;
 result.value=result.denominator?100*result.numerator/result.denominator:null;
 const reachable=included.filter(p=>p.minutes!==null),reachableCount=reachable.length;
 const reachableWeight=v61||unit?reachableCount:reachable.reduce((sum,p)=>sum+weight(p),0);
 result.reachableSettlements=reachableCount;
 result.reachablePopulation=reachable.reduce((sum,p)=>sum+(p.population??0),0);
 const within=reachable.filter(p=>p.minutes!<=o.threshold);
 result.withinThresholdPopulation=within.reduce((sum,p)=>sum+(p.population??0),0);
 result.withinThresholdSettlements=within.length;
 // These distribution metrics always retain *territorial* semantics for V6.1.
 const shareWeight=(p:PointResult)=>v61?1:weight(p);
 const shareDenominator=v61?N:result.denominator;
 result.withinThresholdShare=shareDenominator?within.reduce((sum,p)=>sum+shareWeight(p),0)/shareDenominator:null;
 for(const limit of [30,60,90,120] as const)result.withinMinutesShares[String(limit) as '30'|'60'|'90'|'120']=shareDenominator?reachable.filter(p=>p.minutes!<=limit).reduce((sum,p)=>sum+shareWeight(p),0)/shareDenominator:null;
 result.meanMinutes=reachableWeight?reachable.reduce((sum,p)=>sum+shareWeight(p)*p.minutes!,0)/reachableWeight:null;
 result.medianMinutes=weightedTimeQuantile(reachable,.5,v61||unit);result.p90Minutes=weightedTimeQuantile(reachable,.9,v61||unit);
 result.populationCoverage=d.expectedPopulation?result.population/d.expectedPopulation:null;
 for(const limit of [60,90] as const)result.overMinutesShares[String(limit) as '60'|'90']=reachableWeight?reachable.filter(p=>p.minutes!>limit).reduce((sum,p)=>sum+shareWeight(p),0)/reachableWeight:null;
 result.unreachablePopulation=included.filter(p=>p.status==='unreachable').reduce((sum,p)=>sum+(p.population??0),0);
 result.excludedPopulation=d.expectedPopulation===null?null:Math.max(0,d.expectedPopulation-result.population);
 if(v61){
  result.territorialIndex=N?100*included.reduce((sum,p)=>sum+p.score!,0)/N:null;
  result.populationIndex=includedPopulation?100*included.reduce((sum,p)=>sum+(p.population??0)*p.score!,0)/includedPopulation:null;
  // Count confirmed graph-unreachable settlements as isolated. Unknown != unreachable.
  const isolated=included.filter(p=>p.status==='unreachable'||(p.minutes!==null&&p.minutes>60));
  result.isolatedSettlementsShare=N?isolated.length/N:null;
  result.isolatedPopulationShare=includedPopulation?isolated.reduce((sum,p)=>sum+(p.population??0),0)/includedPopulation:null;
  result.backupWithin60Share=N?included.filter(p=>p.backupMinutes!==null&&p.backupMinutes!==undefined&&p.backupMinutes<=60).length/N:null;
  result.stressWayIds=(fixedCorridors as Record<string,string[]>)[d.regionId??'']??[];
  // Exact data-completeness bounds cannot be claimed for a hybrid weight without omitted populations.
  result.indexBounds={lower:result.missingSettlements===0?result.value:null,upper:result.missingSettlements===0?result.value:null};
 }else{
  const full=unit?points.length:d.expectedPopulation;
  if(full&&result.value!==null)result.indexBounds={lower:100*result.numerator/full,upper:100*(result.numerator+(unit?result.missingSettlements:result.excludedPopulation!))/full};
 }
 result.status=result.value===null?'no_data':result.missingSettlements>0||(!unit&&!v61&&result.populationCoverage!==1)?'partial':d.synthetic?'needs_review':d.metadata?.regionalScopeVerified===true?'verified':'partial';
 if(!d.synthetic)result.warnings.push('Модель на реальных исходных данных: население ВПН-2021, дороги OSM-2026, выбранные больницы. Времена рассчитаны, не измерены. Это не время прибытия скорой помощи или начала лечения.');
 if(d.synthetic)result.warnings.push('Синтетические дорожные связи и условные центры. Индекс относится к выборке модели; происхождение населения и координат указано у каждой точки.');
 if(result.missingSettlements)result.warnings.push(`${result.missingSettlements} пунктов исключено из-за пропусков. Индекс описывает только включённые поселения.`);
 if(result.unreachableSettlements)result.warnings.push(d.metadata?.scenarioUnreachability===true?'Потерянные в сценарии закрытия маршруты получают ноль при сохранении базового состава поселений. Среднее и медиана относятся к оставшимся достижимым точкам.':'Подтверждённо недостижимые пункты включены с нулевой доступностью. Среднее и медиана времени относятся к достижимым поселениям.');
 if(result.unverifiedRoutes)result.warnings.push(`${result.unverifiedRoutes} пунктов без пути в ограниченном графе исключены: фактическая автомобильная изоляция не подтверждена. Требуется проверить дороги и больницы соседних регионов.`);
 if(result.populationCoverage===null)result.warnings.push('Полный знаменатель населения не подтверждён; доля покрытия неизвестна.');
 if(v61){
  result.warnings.push('МИЭД v6.1 — эксперимент: 75,2% веса по поселениям, 24,8% по населению; 85% ближайшая площадка, 10% резервная, 5% три модельных перекрытия. Полнота списка больниц и правдоподобие выбранных перекрытий не гарантированы.');
  result.warnings.push('Вторая больница определяется как отдельный графовый узел. Отсутствие второй включённой больницы в графе штрафуется нулём: это не доказательство отсутствия реальной больницы.');
 }
 return result;
}

/** Planning scenario candidates are UNVERIFIED.  Nodes are real OSM road nodes,
 * but straight new connections are NOT a surveyed engineering alignment. */
export type InvestmentSuggestion={
 kind:'new_road'|'new_facility'; title:string; rationale:string;
 distanceKm:number|null; technicalWarning:string;
 estimatedBeneficiaries:number; affectedSettlements:number;
};
const kmDistance=(a:{x:number;y:number},b:{x:number;y:number})=>{
 const r=Math.PI/180,p1=a.y*r,p2=b.y*r,dp=(b.y-a.y)*r,dl=(b.x-a.x)*r;
 return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2)));
};
function withProposedFacility(d:Dataset,s:Dataset['settlements'][number]):Dataset {
 const n=d.nodes.find(n=>n.id===s.nodeId)!;
 return {...d,facilities:[...d.facilities,{
  id:'__proposal__facility',name:'ГИПОТЕЗА: медицинская площадка в · '+s.name,
  nodeId:n.id,profile:d.profile,periods:['day'],verified:false,
  provenance:'Гипотеза включения подходящей медицинской площадки в сеть обслуживания. Проверьте существующие учреждения и профиль; создание новой больницы не обосновано.',
  facilityType:'проектная площадка; не существующее учреждение',
  lat:n.y,lon:n.x,
 }]};
}
function withSyntheticProposedRoad(d:Dataset,from:Dataset['settlements'][number],to:Dataset['settlements'][number]):{dataset:Dataset;edge:Dataset['edges'][number]} {
 if(!d.synthetic)throw new Error('Автоматическое построение новой прямой запрещено для реальных территорий');
 const nodes=new Map(d.nodes.map(n=>[n.id,n]));const a=nodes.get(from.nodeId!)!,b=nodes.get(to.nodeId!)!;
 const length=kmDistance(a,b)*1.25;
 const edge:Dataset['edges'][number]={id:'__proposal__road',from:a.id,to:b.id,
  minutes:length/50*60,directed:false,allowed:true,kind:'road',
  lengthKm:length,name:'ПРОЕКТ: '+from.name+' — '+to.name,
  speedSource:'ГИПОТЕЗА: прямой коридор с коэффициентом извилистости 1,25 и средней скоростью 50 км/ч; инженерно не обследован',
  geometry:[[a.x,a.y],[b.x,b.y]]};
 return {dataset:{...d,edges:[...d.edges,edge]},edge};
}
/**
 * Real-world links must be externally screened and supported by a polyline.
 * No straight-line link, missing evidence, or inferred military-clearance is accepted.
 * The map cannot certify civil engineering feasibility or legal permission.
 */
export type ScreenedRoadCorridor={
 id:string;datasetId:string;title:string;fromNodeId:string;toNodeId:string;
 geometry:[number,number][];maxSpeedKmh:number;
 evidence:{militaryRestrictions:boolean;protectedAreas:boolean;waterAndBridges:boolean;
 landRights:boolean;terrainAndSafety:boolean;municipalPlan:boolean;sourceUrls:string[]};
};
const screenedRegistry=roadCorridors as {version:number;corridors:ScreenedRoadCorridor[]};

/** Automatically generated short street-network infill hypotheses, NEVER an approved
 * alignment. The underlying OSM graph does not contain a complete military/land-use,
 * cadastral, water or geotechnical exclusion layer. We therefore state the limits in
 * both results and UI instead of labelling these projects as safe for construction. */
export type PreliminaryRoadCandidate={
 id:string;datasetId:string;fromNodeId:string;toNodeId:string;title:string;
 geometry:[number,number][];modelSpeedKmh:number;lengthKmEstimate:number;
 candidateType:'urban-street-infill';originHub:string;originHubId:string;
 originHubPopulation:number;predictedLocalMinutesSaved:number;
 verifiedModelDelta:number;verifiedAffectedSettlements:number;
 screening:{maxLengthKm:number;withinSettlementCenterKm:number;minSettlementPopulation:number;
 existingRoadAnchors:boolean;nearExistingRoadAtMidpointMeters:number;
 militaryZonesVerified:false;protectedAreasVerified:false;waterAndBridgesVerified:false;
 landRightsVerified:false;terrainAndSafetyVerified:false};
 status:'PRELIMINARY_UNVERIFIED_DO_NOT_BUILD';
};
// JSON inference widens [longitude, latitude] coordinates to number[].
// Parse the source instead of asserting that arbitrary arrays are coordinate pairs.
const CoordinateSchema=z.tuple([
 z.number().finite().min(-180).max(180),
 z.number().finite().min(-90).max(90)
]);
const PreliminaryRoadCandidateSchema=z.object({
 id:z.string().min(1),datasetId:z.string().min(1),fromNodeId:z.string().min(1),
 toNodeId:z.string().min(1),title:z.string().min(1),
 geometry:z.array(CoordinateSchema).length(3),
 modelSpeedKmh:z.number().finite(),lengthKmEstimate:z.number().finite(),
 candidateType:z.literal('urban-street-infill'),
 originHub:z.string(),originHubId:z.string(),
 originHubPopulation:z.number().finite(),predictedLocalMinutesSaved:z.number().finite(),
 verifiedModelDelta:z.number().finite(),verifiedAffectedSettlements:z.number().int(),
 screening:z.object({
  maxLengthKm:z.number().finite(),withinSettlementCenterKm:z.number().finite(),
  minSettlementPopulation:z.number().finite(),existingRoadAnchors:z.boolean(),
  nearExistingRoadAtMidpointMeters:z.number().finite(),
  militaryZonesVerified:z.literal(false),protectedAreasVerified:z.literal(false),
  waterAndBridgesVerified:z.literal(false),landRightsVerified:z.literal(false),
  terrainAndSafetyVerified:z.literal(false)
 }),
 status:z.literal('PRELIMINARY_UNVERIFIED_DO_NOT_BUILD')
}).passthrough();
/** Validate externally generated planning data and preserve tuple coordinate types. */
export function parsePreliminaryRoadCandidate(input:unknown):PreliminaryRoadCandidate {
 return PreliminaryRoadCandidateSchema.parse(input);
}
const autoRoads=z.object({
 version:z.number().int(),
 corridors:z.array(PreliminaryRoadCandidateSchema)
}).parse(preliminaryRoadCandidates);
const forbiddenAreaWords=/военн|полигон|гарнизон|казарм|военный лагерь|v[oо]en|military|airfield|airport|аэродром|погранич|чернышевск|балтийск/i;
/** A defensively narrow *geometric plausibility* filter, NOT a safety clearance. */
export function validatePreliminaryRoad(c:PreliminaryRoadCandidate,d:Dataset):string[]{
 const errors:string[]=[];
 const nodes=new Map(d.nodes.map(n=>[n.id,n]));
 const a=nodes.get(c.fromNodeId),b=nodes.get(c.toNodeId);
 const hub=d.settlements.find(s=>s.id===c.originHubId);
 if(d.synthetic||c.datasetId!==d.id||c.status!=='PRELIMINARY_UNVERIFIED_DO_NOT_BUILD')errors.push('Неверный набор/статус');
 if(c.candidateType!=='urban-street-infill'||!a||!b||a.id===b.id||!a.id.startsWith('n')||!b.id.startsWith('n'))errors.push('Нужны два разных дорожных узла OSM');
 if(!hub||!hub.population||hub.population<200||hub.lat==null||hub.lon==null||forbiddenAreaWords.test(`${hub.name} ${hub.municipality}`))errors.push('Слишком неопределённый/чувствительный населённый пункт');
 if(!Array.isArray(c.geometry)||c.geometry.length!==3||c.geometry.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v))))errors.push('Не задана простая локальная полилиния');
 if(a&&b&&hub&&hub.lat!=null&&hub.lon!=null){
  const length=kmDistance(a,b);
  if(length<.15||length>1||Math.abs(length-c.lengthKmEstimate)>.03)errors.push('Не является короткой дорожной связью');
  const centre={x:hub.lon,y:hub.lat};
  if(kmDistance(a,centre)>1.05||kmDistance(b,centre)>1.05)errors.push('Дорожная связь вне населённого пункта');
  if(d.edges.some(e=>(e.from===a.id&&e.to===b.id)||(e.from===b.id&&e.to===a.id)))errors.push('Это уже существующее ребро графа');
  if(c.geometry.length===3){
   if(kmDistance(a,{x:c.geometry[0][0],y:c.geometry[0][1]})>.03||kmDistance(b,{x:c.geometry[2][0],y:c.geometry[2][1]})>.03)errors.push('Концы эскиза не совпадают с дорожными узлами');
   const m=c.geometry[1];if(kmDistance({x:m[0],y:m[1]},{x:(a.x+b.x)/2,y:(a.y+b.y)/2})>.1)errors.push('Необъяснимый изгиб эскиза');
  }
 }
 if(c.modelSpeedKmh<15||c.modelSpeedKmh>40||!Number.isFinite(c.modelSpeedKmh))errors.push('Скорость не соответствует локальной улице');
 if(!c.screening?.existingRoadAnchors||c.screening.nearExistingRoadAtMidpointMeters>180||
 c.screening.militaryZonesVerified!==false||c.screening.protectedAreasVerified!==false||
 c.screening.waterAndBridgesVerified!==false||c.screening.landRightsVerified!==false||
 c.screening.terrainAndSafetyVerified!==false)errors.push('Недостоверная степень проверки ограничений');
 return errors;
}
function withPreliminaryRoad(d:Dataset,c:PreliminaryRoadCandidate):{dataset:Dataset;edge:Dataset['edges'][number]}{
 const length=c.geometry.slice(1).reduce((sum,v,i)=>sum+kmDistance({x:c.geometry[i][0],y:c.geometry[i][1]},{x:v[0],y:v[1]}),0);
 const edge:Dataset['edges'][number]={id:'__proposal__road',from:c.fromNodeId,to:c.toNodeId,
  minutes:length/c.modelSpeedKmh*60,directed:false,allowed:true,kind:'road',lengthKm:length,
  name:'ЭСКИЗ НОВОЙ СВЯЗИ: '+c.title,geometry:c.geometry,
  speedSource:'Расчётная локальная улица (25 км/ч). Предварительная геометрическая фильтрация OSM; ограничения военных зон, воды, земель и экологии НЕ проверены'};
 return {dataset:{...d,edges:[...d.edges,edge]},edge};
}

export function validateRoadCorridor(candidate:ScreenedRoadCorridor,d:Dataset):string[]{
 const reasons:string[]=[];
 if(d.synthetic)reasons.push('Тестовые сети нельзя помечать реальными согласованными коридорами');
 if(candidate.datasetId!==d.id)reasons.push('Коридор относится к другому набору данных');
 if(!candidate.id||!candidate.title)reasons.push('Отсутствует идентификатор или название');
 const nodes=new Map(d.nodes.map(n=>[n.id,n]));
 const from=nodes.get(candidate.fromNodeId),to=nodes.get(candidate.toNodeId);
 if(!from||!to||from.id===to.id)reasons.push('Концы не связаны с двумя различными узлами исходной сети');
 const g=candidate.geometry;
 if(!Array.isArray(g)||g.length<3||g.length>2000||g.some(p=>!Array.isArray(p)||p.length!==2||p.some(x=>!Number.isFinite(x))))reasons.push('Нужна проверенная ломаная минимум из трёх координат');
 const checks=candidate.evidence;
 if(!checks||!checks.militaryRestrictions||!checks.protectedAreas||!checks.waterAndBridges||!checks.landRights||!checks.terrainAndSafety||!checks.municipalPlan)reasons.push('Не завершена обязательная проверка ограничений/безопасности');
 if(!checks||!Array.isArray(checks.sourceUrls)||checks.sourceUrls.length<2||checks.sourceUrls.some(u=>!/^https:\/\//.test(u)))reasons.push('Недостаточно документальных подтверждений');
 if(!Number.isFinite(candidate.maxSpeedKmh)||candidate.maxSpeedKmh<10||candidate.maxSpeedKmh>90)reasons.push('Скорость должна быть обоснована в пределах 10–90 км/ч');
 if(from&&to&&Array.isArray(g)&&g.length>=3&&g.every(p=>p.length===2&&p.every(Number.isFinite))){
   if(kmDistance({x:g[0][0],y:g[0][1]},from)>.12||kmDistance({x:g[g.length-1][0],y:g[g.length-1][1]},to)>.12)
     reasons.push('Коридор не примыкает к указанным дорожным узлам');
   const length=g.slice(1).reduce((sum,v,i)=>sum+kmDistance({x:g[i][0],y:g[i][1]},{x:v[0],y:v[1]}),0);
   const direct=kmDistance(from,to);
   if(length<.2||length>45||length<direct*.999)reasons.push('Неверная длина или геометрия проектного коридора');
 }
 return reasons;
}
function withScreenedRoad(d:Dataset,c:ScreenedRoadCorridor):{dataset:Dataset;edge:Dataset['edges'][number]}{
 const length=c.geometry.slice(1).reduce((sum,v,i)=>sum+kmDistance({x:c.geometry[i][0],y:c.geometry[i][1]},{x:v[0],y:v[1]}),0);
 const edge:Dataset['edges'][number]={id:'__proposal__road',from:c.fromNodeId,to:c.toNodeId,
  minutes:length/c.maxSpeedKmh*60,directed:false,allowed:true,kind:'road',lengthKm:length,
  name:'ПРЕДВАРИТЕЛЬНО ПРОВЕРЕННЫЙ КОРИДОР: '+c.title,geometry:c.geometry,
  speedSource:'Документированный кандидат '+c.id+'; предварительная проверка ограничений, не разрешение на строительство'};
 return {dataset:{...d,edges:[...d.edges,edge]},edge};
}
type BenefitOptions = Pick<CalculationOptions,'minRoadMinutes'|'minRoadPercent'>;
export type RoadListOptions = Pick<CalculationOptions,'threshold'|'timeScale'> & BenefitOptions;
const alignments = z.array(z.object({
 id:z.string(),status:z.enum(['screened','blocked','insufficient_mapping']),
 fromNodeId:z.string(),toNodeId:z.string(),geometry:z.array(CoordinateSchema),
 lengthMeters:z.number().positive().optional(),bridgeWayIds:z.array(z.number().int())
})).parse(pilotScreen.corridors);

function surveyedEdge(d:Dataset,c:PreliminaryRoadCandidate){
 const alignment=alignments.find(a=>a.id===c.id && a.status==='screened'
   && a.fromNodeId===c.fromNodeId && a.toNodeId===c.toNodeId);
 if(!alignment?.lengthMeters || alignment.lengthMeters>1000 || alignment.geometry.length<2)return null;
 const path=alignment.geometry;
 if(![0,1].every(i=>path[0][i]===c.geometry[0][i] && path[path.length-1][i]===c.geometry[c.geometry.length-1][i]))return null;
 if(!alignment.bridgeWayIds.every(id=>d.edges.some(e=>String(e.osmWayId)===String(id) && e.allowed && !e.directed)))return null;
 const edge=withPreliminaryRoad(d,{...c,geometry:path}).edge;
 edge.lengthKm=alignment.lengthMeters/1000;
 edge.minutes=edge.lengthKm/c.modelSpeedKmh*60;
 edge.name=c.title;
 edge.speedSource='Длина отобранной трассы по OSM от 08.11.2026, модельная скорость 25 км/ч.';
 return edge;
}

function meetsPilotBenefit(before:PointResult|undefined,after:PointResult,options:BenefitOptions){
 if(before?.minutes==null || after.minutes===null || before.minutes<=0)return false;
 const saved=before.minutes-after.minutes;
 return saved>0 && saved>=(options.minRoadMinutes??PILOT_ROAD_DEFAULTS.minRoadMinutes)
   && 100*saved/before.minutes>=(options.minRoadPercent??PILOT_ROAD_DEFAULTS.minRoadPercent);
}

function* evaluatedRoads(d:Dataset,base:IndexResult,o:CalculationOptions){
 const pilot=d.regionId==='kaliningrad';
 const edges=screenedRegistry.corridors.filter(c=>!pilot && c.datasetId===d.id && !validateRoadCorridor(c,d).length)
    .map(c=>({edge:withScreenedRoad(d,c).edge,documented:true}));
 for(const candidate of autoRoads.corridors){
  if(candidate.datasetId!==d.id || validatePreliminaryRoad(candidate,d).length)continue;
  const edge=pilot?surveyedEdge(d,candidate):withPreliminaryRoad(d,candidate).edge;
  if(edge)edges.push({edge,documented:false});
 }
 for(const {edge,documented} of edges){
  const result=routeValidatedDataset({...d,edges:[...d.edges,edge]},{...o,scenario:'baseline'});
  if(result.value===null || base.value===null)continue;
  const regional=result.value-base.value;
  if(pilot && !result.points.some((q,i)=>localRoadRank(base.points[i],q,regional,edge.id,o)!==null))continue;
  if(regional>1e-9)yield {result,edge,documented,regional};
 }
}

function localRoadRank(before:PointResult|undefined,after:PointResult|undefined,regional:number,edgeId:string,benefit?:BenefitOptions){
 if(benefit && (!after || !meetsPilotBenefit(before,after,benefit)))return null;
 if(before?.score==null || after?.score==null || after.score-before.score<=1e-9 || !after.path.includes(edgeId))return null;
 return 100*(after.score-before.score)+regional;
}

export type RoadOption={id:string;name:string;municipality:string;before:number;after:number};

export function settlementRoadOptions(input:Dataset,options:RoadListOptions):RoadOption[]{
 const d=validateDataset(input);
 const o=CalculationSchema.parse({...options,scenario:'new_road',scope:'point'});
 const base=routeValidatedDataset(d,{...o,scenario:'baseline'});
 const ranked=new Map<string,{rank:number;row:RoadOption}>();
 const save=(p:PointResult,q:PointResult,rank:number)=>{
  if(p.minutes===null || q.minutes===null || q.minutes>=p.minutes)return;
  const previous=ranked.get(p.id);
  if(previous && rank<=previous.rank+1e-10)return;
  ranked.set(p.id,{rank,row:{id:p.id,name:p.name,municipality:p.municipality,before:p.minutes,after:q.minutes}});
 };
 if(d.synthetic){
  for(const p of base.points){
   if(p.minutes===null || p.minutes<=15)continue;
   const project=proposeInvestment(d,base,{...o,pointId:p.id});
   const q=project.after.points.find(origin=>origin.id===p.id);
   if(project.proposedEdges.length && q?.path.includes(project.proposedEdges[0].id))save(p,q,1);
  }
 }else{
  const origins=new Map(base.points.map(p=>[p.id,p]));
  for(const {result,edge,regional} of evaluatedRoads(d,base,o)){
   for(const q of result.points){
    const p=origins.get(q.id);
    const rank=localRoadRank(p,q,regional,edge.id,d.regionId==='kaliningrad'?o:undefined);
    if(p && rank!==null)save(p,q,rank);
   }
  }
 }
 return Array.from(ranked.values(),v=>v.row).sort((a,b)=>(b.before-b.after)-(a.before-a.after)||a.id.localeCompare(b.id));
}

const proposalWarning='Только аналитическая гипотеза: положение новой дороги/медплощадки и стоимость не подтверждены. Новый дорожный коридор может пересекать водные объекты, природоохранные зоны и чужую собственность; требуется обследование, трассировка и инвестиционное обоснование. Новая медицинская площадка не означает доступный персонал или лицензированную помощь.';
function proposeInvestment(d:Dataset,base:IndexResult,o:CalculationOptions){
 const pointById=new Map(base.points.map(x=>[x.id,x]));
 const nodeMap=new Map(d.nodes.map(n=>[n.id,n]));
 const places=d.settlements.filter(s=>s.nodeId&&nodeMap.has(s.nodeId)&&pointById.get(s.id)?.minutes!=null&&pointById.get(s.id)?.score!=null);
 const target=pointById.get(o.pointId??'');
 const active=places.filter(s=>pointById.get(s.id)!.minutes!>15);
 // For a local proposal, look for a populated neighboring hub rather than building
 // a regional hospital in a 20-person village. Such hubs are CANDIDATES, not approvals.
 const weight=(s:Dataset['settlements'][number])=>Math.log2(2+(s.population??0));
 let choices:Dataset['settlements'][number][]=[];
 if(o.scenario==='new_facility'){
  if(o.scope==='point'&&target){
   const selected=d.settlements.find(s=>s.id===target.id&&s.nodeId);
   if(selected){const origin=nodeMap.get(selected.nodeId!)!;
    choices=active.filter(s=>s.id!==selected.id&&s.population!==null&&(s.population>=200)&&kmDistance(origin,nodeMap.get(s.nodeId!)!)<=40)
     .sort((a,b)=>kmDistance(origin,nodeMap.get(a.nodeId!)!)-kmDistance(origin,nodeMap.get(b.nodeId!)!)).slice(0,12);
    if(!choices.length)choices=[selected];
   }
  }else{
   const municipal=new Set<string>();
   const sorted=[...active].sort((a,b)=>{
    const aScore=(1-(pointById.get(a.id)!.score??1))*weight(a);
    const bScore=(1-(pointById.get(b.id)!.score??1))*weight(b);
    return bScore-aScore;
   });
   for(const s of sorted){if((s.population??0)<100||municipal.has(s.municipality))continue;municipal.add(s.municipality);choices.push(s);if(choices.length>=9)break;}
   for(const s of sorted){if(choices.length>=12)break;if(!choices.some(c=>c.id===s.id))choices.push(s);}
  }
 }else{
  if(!d.synthetic){
   let best:ReturnType<typeof calculate>|undefined,bestEdge:Dataset['edges'][number]|undefined;
   let bestScore=-Infinity,bestDocumented=false;
   for(const {result,edge,documented,regional} of evaluatedRoads(d,base,o)){
    const gain=o.scope==='point'
      ? localRoadRank(target,result.points.find(p=>p.id===target?.id),regional,edge.id,d.regionId==='kaliningrad'?o:undefined)
      : regional;
    if(gain===null)continue;
    if(gain>bestScore+1e-10){best=result;bestEdge=edge;bestScore=gain;bestDocumented=documented;}
   }
   if(!best||!bestEdge)return {after:base,proposedEdges:[] as Dataset['edges'],proposedFacilities:[] as Dataset['facilities'],suggestion:null as InvestmentSuggestion|null,
    rule:d.regionId==='kaliningrad'?'Среди проверенных трасс ни одна не прошла оба порога экономии в выбранном масштабе.':'В этом масштабе проверенные/предварительно отфильтрованные короткие новые дорожные связи не улучшили индекс. Не предлагаем искусственный объезд и не рисуем дорогу через неподтверждённую территорию. Попробуйте региональный масштаб, другую медплощадку или инженерную проверку дополнительных коридоров.'};
   const altered=best.points.filter((p,i)=>p.minutes!==base.points[i]?.minutes&&p.minutes!==null&&base.points[i]?.minutes!==null&&p.minutes<base.points[i]!.minutes!-0.001);
   return {after:best,proposedEdges:[bestEdge],proposedFacilities:[] as Dataset['facilities'],
    suggestion:{kind:'new_road' as const,title:bestEdge.name??'Новая дорожная связь',
     rationale:d.regionId==='kaliningrad'?'Проверена полоса шириной 8 м с запасом 2 м по сторонам по снимку OpenStreetMap от 08.11.2026. Время рассчитано по длине отобранной трассы.':bestDocumented?'Документированный предварительно проверенный коридор, не проект строительства.':'Короткая новая связь между существующими дорожными узлами вблизи населённого пункта; предварительный эскиз по OSM, реально меняет кратчайшие маршруты в расчётном графе. НЕ удостоверены отсутствие военных ограничений, водных преград, охранных зон и законность строительства.',
     distanceKm:bestEdge.lengthKm??null,
     technicalWarning:d.regionId==='kaliningrad'?'Модельная гипотеза. Полнота карты, права на землю и инженерная пригодность требуют проверки на месте.':bestDocumented?'Предварительный документированный коридор — нужны инженерные согласования.':proposalWarning,
     estimatedBeneficiaries:altered.reduce((sum,p)=>sum+(p.population??0),0),affectedSettlements:altered.length},
    rule:d.regionId==='kaliningrad'?'Для отобранной трассы пересчитаны поездки до больниц и индекс всей области. Требуемая экономия проверяется по фактическому пути в модели.':bestDocumented?'Из документированных коридоров выбран вариант с максимальным фактическим приростом индекса.':'Автоматически проверены короткие кандидаты соединения существующих дорожных узлов у населённых пунктов (до 1 км). Исключены названия военных объектов, уже существующие связи и долгие прямые трассы; каждый кандидат проверен полным пересчётом кратчайших маршрутов. Выбран максимальный подтверждённый моделью прирост индекса. ВНИМАНИЕ: военные зоны, вода, ООПТ, землепользование и инженерная безопасность НЕ проверены по официальным картам. Линия — предварительный эскиз для изучения, не рекомендация к строительству.'};
   }
  const starting=o.scope==='point'&&target?active.filter(s=>s.id===target.id):
   [...active].sort((a,b)=>((b.population??0)+100)*Math.max(0,(pointById.get(b.id)?.minutes??0)-40)-((a.population??0)+100)*Math.max(0,(pointById.get(a.id)?.minutes??0)-40)).slice(0,45);
  const ranked:{from:Dataset['settlements'][number];to:Dataset['settlements'][number];gain:number;distance:number}[]=[];
  const ordered=[...places].sort((a,b)=>(pointById.get(a.id)?.minutes??1e6)-(pointById.get(b.id)?.minutes??1e6));
  for(const from of starting){const orig=nodeMap.get(from.nodeId!)!,t0=pointById.get(from.id)!.minutes!;
   const links:{to:Dataset['settlements'][number];gain:number;distance:number}[]=[];
   // One end must connect a currently underserved origin to a better-served hub.
   for(const to of ordered){if(to.nodeId===from.nodeId)continue;const t1=pointById.get(to.id)?.minutes;if(t1==null||t1>=t0-6)continue;
    const dist=kmDistance(orig,nodeMap.get(to.nodeId!)!);
    if(dist<1||dist>28)continue;
    const proposedTime=dist*1.25*60/50;
    const gain=t0-(proposedTime+t1);
    if(gain>6)links.push({to,gain,distance:dist});
   }
   links.sort((a,b)=>b.gain-a.gain||a.distance-b.distance);
   for(const x of links.slice(0,2))ranked.push({from,to:x.to,gain:x.gain,distance:x.distance});
  }
  ranked.sort((a,b)=>b.gain-a.gain||a.distance-b.distance);
  // Evaluate the best physical-link hypotheses with full graph routing; never
  // report predicted time as a final result.
  const roads=ranked.slice(0,12);
  let best:ReturnType<typeof calculate>|undefined,bestEdge:Dataset['edges'][number]|undefined;
  let bestScore=-Infinity;
  for(const x of roads){const {dataset,edge}=withSyntheticProposedRoad(d,x.from,x.to),result=calculate(dataset,{...o,scenario:'baseline'});
   const local=o.scope==='point'&&target?(result.points.find(p=>p.id===target.id)?.score??0)-(target.score??0):0;
   const regional=result.value===null||base.value===null?0:result.value-base.value;
   const selectedAfter=o.scope==='point'&&target?result.points.find(p=>p.id===target.id):null;
   // A village-level proposal is valid only if THIS village uses the new link.
   if(o.scope==='point'&&target&&(local<=1e-8||!selectedAfter?.path.includes(edge.id)))continue;
   const score=o.scope==='point'?local*100+regional:regional;
   if(score>bestScore+1e-10){best=result;bestEdge=edge;bestScore=score;}
  }
  if(!best||!bestEdge||bestScore<=1e-10)return {after:base,proposedEdges:[] as Dataset['edges'],proposedFacilities:[] as Dataset['facilities'],
   suggestion:null as InvestmentSuggestion|null,rule:'Ни один проверенный проектный коридор 1–28 км не улучшает выбранный маршрут по заданным условиям. Не изображаем существующую дорогу как новую. Выберите сценарий медицинской площадки или другой пункт; нужно проверить рельеф, мосты и ограничения строительства.'};
  const altered=best.points.filter((x,i)=>base.points[i]?.minutes!==x.minutes);
  return {after:best,proposedEdges:[bestEdge],proposedFacilities:[] as Dataset['facilities'],
   suggestion:{kind:'new_road' as const,title:bestEdge.name??'Проектируемая дорога',rationale:'ДЕМОНСТРАЦИЯ на СИНТЕТИЧЕСКОЙ СЕТИ. Это НОВАЯ, отсутствующая в исходном дорожном графе связь. Из кандидатных коридоров выбран тот, который после пересчёта действительно используется маршрутами и улучшает доступность. Указана оценочная длина, не проверенная трасса строительства.',distanceKm:bestEdge.lengthKm??null,technicalWarning:proposalWarning,
    estimatedBeneficiaries:altered.reduce((s,p)=>s+(p.population??0),0),affectedSettlements:altered.length},
   rule:'ТОЛЬКО ДЛЯ СИНТЕТИЧЕСКИХ СЕТЕЙ. Кандидаты: соединения 1–28 км между отдалённым поселением и лучше обеспеченным дорожным узлом; отсев, если ожидаемая экономия менее 6 минут. Среди не более 12 кандидатов на графе пересчитываются все маршруты; выбирается максимальный прирост МИЭД (для выбранного пункта — его доступности). Геометрия — гипотетическая прямая, не проект дороги.'};
 }
 let best:ReturnType<typeof calculate>|undefined,bestSite:Dataset['settlements'][number]|undefined,bestScore=-Infinity;
 for(const s of choices){if(d.facilities.some(f=>f.nodeId===s.nodeId))continue;
  const result=calculate(withProposedFacility(d,s),{...o,scenario:'baseline'});
  const local=o.scope==='point'&&target?(result.points.find(p=>p.id===target.id)?.score??0)-(target.score??0):0;
  const regional=result.value===null||base.value===null?0:result.value-base.value;
  const selectedAfter=o.scope==='point'&&target?result.points.find(p=>p.id===target.id):null;
  // Do not suggest a hospital to a chosen village when its destination is unchanged.
  if(o.scope==='point'&&(local<=1e-8||selectedAfter?.facilityId!=='__proposal__facility'))continue;
  const score=o.scope==='point'?local*100+regional:regional;
  if(score>bestScore+1e-10){best=result;bestSite=s;bestScore=score;}
 }
 if(!best||!bestSite||bestScore<=1e-10)return {after:base,proposedEdges:[] as Dataset['edges'],proposedFacilities:[] as Dataset['facilities'],suggestion:null as InvestmentSuggestion|null,rule:'Ни одна из рассмотренных новых медицинских площадок не улучшает доступность выбранного пункта. Строительство не предлагается автоматически; можно проверить реконструкцию существующих учреждений или другой населённый пункт.'};
 const facility=withProposedFacility(d,bestSite).facilities.at(-1)!;
 const altered=best.points.filter((x,i)=>base.points[i]?.minutes!==x.minutes);
 return {after:best,proposedEdges:[] as Dataset['edges'],proposedFacilities:[facility],
  suggestion:{kind:'new_facility' as const,title:facility.name,rationale:'Это НОВАЯ, отсутствующая в исходном наборе медицинская площадка, а не предложение объезда. Выбрана среди населённых пунктов, привязанных к дорожной сети; для каждого кандидата пересчитаны маршруты к существующим и проектному объектам. Перед реализацией требуется полный аудит действующих больниц и профиль помощи.',distanceKm:null,technicalWarning:proposalWarning,
   estimatedBeneficiaries:altered.reduce((sum,p)=>sum+(p.population??0),0),affectedSettlements:altered.length},
  rule:'Кандидаты — существующие населённые пункты с плохой доступностью; преимущество отдаётся населённым узлам с населением и разным муниципалитетам. Проверяются до 12 площадок: рассчитывается новая кратчайшая поездка к существующим или к проектной площадке; выбирается максимальный прирост индекса (или доступности выбранного пункта). Это не доказательство медицинской или экономической целесообразности.'};
}
export function compareScenario(d:Dataset,o:Partial<CalculationOptions>={}) {
  const options=CalculationSchema.parse(o);
  if(options.scope==='point' && ['new_road','new_facility','improvement'].includes(options.scenario)){
   z.string().refine(id=>d.settlements.some(s=>s.id===id),'Пункт отсутствует в выбранном регионе').parse(options.pointId);
  }
  const baseline=calculate(d,{...options,scenario:'baseline',improvementEdgeIds:undefined});
  const proposal=options.scenario==='new_road'||options.scenario==='new_facility'?proposeInvestment(d,baseline,options):null;
  const optimized=options.scenario==='improvement'&&options.scope!=='edge'
    ?selectImprovementRoads(d,baseline,options.scope,options.multiplier,options.pointId,options.timeScale):[];
  const selectedRoads=options.scenario==='baseline'||proposal?[]:optimized.length?optimized:options.edgeId?[{id:options.edgeId,name:d.edges.find(e=>e.id===options.edgeId)?.name??options.edgeId,predictedGain:0,estimatedMinutesSaved:0,affectedOrigins:0}]:[];
  const selectedWayIds=new Set(selectedRoads.flatMap(r=>{const e=d.edges.find(e=>e.id===r.id);return e?.osmWayId?[e.osmWayId]:[];}));
  const selectedEdgeIds=options.scope==='edge'||options.scenario!=='improvement'?[]:d.edges.filter(e=>selectedRoads.some(r=>r.id===e.id)||Boolean(e.osmWayId&&selectedWayIds.has(e.osmWayId))).map(e=>e.id);
  const improvedOptions={...options,edgeId:options.scope==='edge'?options.edgeId:undefined,improvementEdgeIds:selectedEdgeIds};

  // A deliberately closed road is a known change in the model. Keep the
  // baseline population cohort, assigning zero to routes lost in that scenario.
  // Missing baseline evidence remains missing; this asserts no real-world isolation.
  const scenarioDataset=options.scenario==='closure'&&!d.synthetic?{...d,metadata:{...d.metadata,
    confirmedUnreachableIds:[...(Array.isArray(d.metadata?.confirmedUnreachableIds)?d.metadata.confirmedUnreachableIds:[]),
      ...baseline.points.filter(p=>p.status==='reachable').map(p=>p.id)],
    scenarioUnreachability:true}}:d;
  const after=proposal?.after??(optimized.length===0&&options.scenario==='improvement'&&options.scope!=='edge'?baseline:calculate(scenarioDataset,improvedOptions));
  const comparable=baseline.includedSettlements===after.includedSettlements&&baseline.denominator===after.denominator&&baseline.points.every((p,i)=>(p.score===null)===(after.points[i]?.score===null));
  const delta=comparable&&baseline.value!==null&&after.value!==null?after.value-baseline.value:null;
  const beforeById=new Map(baseline.points.map(p=>[p.id,p]));
  const affectedPopulation=after.points.reduce((sum,p)=>sum+((p.minutes!==beforeById.get(p.id)?.minutes)?p.population??0:0),0);
  return {baseline,after,delta,comparisonWarning:!comparable?'Состав поселений изменился: изменение индекса между сценариями не сопоставимо.':null,relativeChange:delta!==null&&baseline.value!==null&&baseline.value!==0?100*delta/baseline.value:null,affectedPopulation,cost:options.cost,costQuality:options.cost===null?'not_provided':'scenario_assumption',pointsPerMillion:delta!==null&&options.cost!==null?delta/(options.cost/1e6):null,selectedRoads,proposedEdges:proposal?.proposedEdges??[],proposedFacilities:proposal?.proposedFacilities??[],investmentSuggestion:proposal?.suggestion??null,selectionRule:proposal?proposal.rule:options.scope==='point'?'Один участок исходного пути выбран по максимальному прогнозному приросту доступности (при равенстве — экономия времени). После изменения пересчитана вся сеть.':options.scope==='region'?'Выбраны до четырёх дорожных объектов по сумме прогнозных приростов доступности всех поселений; затем все маршруты и индекс пересчитаны на изменённой сети.':'Выбранный пользователем дорожный объект; пересчёт всей сети.',options};
}

export function aggregate(results:IndexResult[]) {
  const included=results.filter(r=>r.value!==null);
  if(!included.length)return {value:null,population:0,label:'Нет сопоставимых результатов'};
  const key=(r:IndexResult)=>[r.methodologyVersion,r.profile,r.period,r.threshold,r.datasetVersion,r.synthetic].join('|');
  if(new Set(included.map(key)).size!==1)throw new Error('Несопоставимые методики, профили, периоды, пороги или версии');
  if(new Set(included.map(r=>r.datasetId)).size!==included.length)throw new Error('Повтор набора при агрегации');
  const population=included.reduce((sum,r)=>sum+r.population,0);
  if(included[0].methodologyVersion==='6.1.0'){
   const N=included.reduce((sum,r)=>sum+r.includedSettlements,0);
   const territorial=N?included.reduce((sum,r)=>sum+(r.territorialIndex??0)*r.includedSettlements,0)/N:null;
   const demographic=population?included.reduce((sum,r)=>sum+(r.populationIndex??0)*r.population,0)/population:null;
   return {value:(territorial!==null&&demographic!==null)?(.752*territorial+.248*demographic):null,population,denominator:N,label:'МИЭД v6.1 для общей покрытой выборки без синтетических смешений'};
  }
  const denominator=included.reduce((sum,r)=>sum+r.denominator,0);
  return {value:denominator?100*included.reduce((s,r)=>s+r.numerator,0)/denominator:null,population,denominator,label:'Индекс покрытой части'};
}
