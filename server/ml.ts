/** Exploratory spatial accessibility outliers.
 * A supervised, leave-one-out k-nearest-neighbours regressor learns a typical
 * existing-road accessibility score from straight-line facility proximity only.
 * This does not alter the official MIED score or imply causation.
 */
import type {Dataset,IndexResult} from '../shared/schema';
import {isCalculationFacility} from '../shared/medical-policy';

export type MlAnomaly={
 id:string;name:string;municipality:string;expectedScore:number;actualScore:number;
 gapPoints:number;roadMinutes:number;nearestFacilityName:string;nearestFacilityId:string;
 nearestDistanceKm:number;facilitiesWithin50Km:number;
 routeFacilityName:string|null;routeFacilityId:string|null;routeFacilityStraightKm:number|null;
};
export type MlReport={
 status:'ok'|'insufficient_data';regionId:string;profile:string;threshold:number;
 samples:number;trainingSamples:number;neighbours:number;maePoints:number|null;
 minimumGapPoints:number|null;nearbyRadiusKm:50;
 anomalies:MlAnomaly[];warning:string;
};
type Coordinates={lat:number;lon:number};
type Example={id:string;name:string;municipality:string;score:number;minutes:number;
 nearestKm:number;within50:number;nearestFacilityId:string;nearestFacilityName:string;
 routeFacilityId:string|null;routeFacilityName:string|null;routeFacilityKm:number|null;
 x:number;y:number;};
const NEARBY_RADIUS_KM=50 as const;
const MIN_SAMPLES=30;
const MAX_TRAINING=1600;
const toRad=(v:number)=>v*Math.PI/180;
function distanceKm(a:Coordinates,b:Coordinates){
 const lat=toRad(b.lat-a.lat),lon=toRad(b.lon-a.lon);
 const h=Math.sin(lat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(lon/2)**2;
 return 6371.0088*2*Math.asin(Math.min(1,Math.sqrt(Math.max(0,h))));
}
function validCoord(p:{lat?:number;lon?:number}):p is {lat:number;lon:number}{
 return typeof p.lat==='number'&&typeof p.lon==='number'&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
}
function stableHash(s:string){let h=2166136261;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),16777619);}return h>>>0;}
function clampScore(v:number){return Math.max(0,Math.min(100,v));}
function round(v:number){return Math.round(v*100)/100;}

/** The candidate's own observed outcome is explicitly excluded from its prediction. */
export function analyzeAccessibilityGaps(dataset:Dataset,result:IndexResult):MlReport{
 const facilities=dataset.facilities.filter((f):f is Dataset['facilities'][number]&Coordinates=>isCalculationFacility(dataset,f)&&f.profile===dataset.profile&&f.periods.includes(result.period)&&validCoord(f));
 const facilityById=new Map(facilities.map(f=>[f.id,f]));
 const byPoint=new Map(result.points.map(p=>[p.id,p]));
 const examples:Example[]=[];
 for(const settlement of dataset.settlements){
  const point=byPoint.get(settlement.id);
  // A missing/unverified route has no measured target; unreachable points cannot open a route.
  if(!validCoord(settlement)||!point||point.status!=='reachable'||point.score===null||point.minutes===null)continue;
  if(!Number.isFinite(point.score)||!Number.isFinite(point.minutes))continue;
  let nearestKm=Infinity,nearestFacilityId='',nearestFacilityName='',within50=0;
  for(const f of facilities){
   const km=distanceKm(settlement,f);
   if(km<=NEARBY_RADIUS_KM)within50++;
   if(km<nearestKm){nearestKm=km;nearestFacilityId=f.id;nearestFacilityName=f.name;}
  }
  if(!Number.isFinite(nearestKm))continue;
  const routeFacility=point.facilityId?facilityById.get(point.facilityId):undefined;
  examples.push({id:point.id,name:point.name,municipality:point.municipality,
   score:clampScore(point.score*100),minutes:point.minutes,nearestKm,within50,
   nearestFacilityId,nearestFacilityName,routeFacilityId:point.facilityId,
   routeFacilityName:routeFacility?.name??null,
   routeFacilityKm:routeFacility?distanceKm(settlement,routeFacility):null,
   x:Math.log1p(nearestKm),y:Math.log1p(within50)});
 }
 const report:MlReport={status:'insufficient_data',regionId:dataset.regionId,profile:dataset.profile,
  threshold:result.threshold,samples:examples.length,trainingSamples:0,neighbours:0,
  maePoints:null,minimumGapPoints:null,nearbyRadiusKm:NEARBY_RADIUS_KM,anomalies:[],
  warning:'ML — исследовательский поиск нетипичных случаев, не доказательство ошибки и не причинно-следственная оценка.'};
 if(examples.length<MIN_SAMPLES)return {...report,warning:'Недостаточно поселений с координатами и рассчитанным маршрутом для ML (нужно не менее 30).'};
 // Deterministic capped train set to limit browser/API latency on large regions.
 const training=[...examples].sort((a,b)=>stableHash(a.id)-stableHash(b.id)||a.id.localeCompare(b.id)).slice(0,MAX_TRAINING);
 const meanX=training.reduce((s,p)=>s+p.x,0)/training.length;
 const meanY=training.reduce((s,p)=>s+p.y,0)/training.length;
 const stdX=Math.max(.15,Math.sqrt(training.reduce((s,p)=>s+(p.x-meanX)**2,0)/training.length));
 const stdY=Math.max(.15,Math.sqrt(training.reduce((s,p)=>s+(p.y-meanY)**2,0)/training.length));
 const k=Math.min(20,Math.max(8,Math.floor(Math.sqrt(training.length))));
 const predict=(sample:Example)=>{
  const selected:{dist:number;id:string;score:number}[]=[];
  for(const other of training){
   if(other.id===sample.id)continue;
   const dx=(sample.x-other.x)/stdX,dy=(sample.y-other.y)/stdY;
   const dist=Math.sqrt(dx*dx+dy*dy);
   if(selected.length===k&&dist>=selected[selected.length-1].dist)continue;
   let index=selected.findIndex(s=>dist<s.dist||dist===s.dist&&other.id<s.id);
   if(index<0)index=selected.length;
   selected.splice(index,0,{dist,id:other.id,score:other.score});
   if(selected.length>k)selected.pop();
  }
  let weighted=0,totalWeight=0;
  for(const entry of selected){const weight=1/(.15+entry.dist);weighted+=entry.score*weight;totalWeight+=weight;}
  return totalWeight?clampScore(weighted/totalWeight):null;
 };
 let sumError=0,validated=0;
 for(const example of training){const prediction=predict(example);if(prediction!==null){sumError+=Math.abs(prediction-example.score);validated++;}}
 const mae=validated?sumError/validated:0;
 // The threshold must exceed both 15 points and 1.5 x training LOO MAE.
 const minimumGap=Math.max(15,1.5*mae);
 const anomalies=examples.flatMap(example=>{
  const expected=predict(example);if(expected===null||expected-example.score<minimumGap)return [];
  return [{id:example.id,name:example.name,municipality:example.municipality,
   expectedScore:round(expected),actualScore:round(example.score),gapPoints:round(expected-example.score),
   roadMinutes:round(example.minutes),nearestFacilityName:example.nearestFacilityName,
   nearestFacilityId:example.nearestFacilityId,nearestDistanceKm:round(example.nearestKm),
   facilitiesWithin50Km:example.within50,routeFacilityName:example.routeFacilityName,
   routeFacilityId:example.routeFacilityId,
   routeFacilityStraightKm:example.routeFacilityKm===null?null:round(example.routeFacilityKm)}];
 }).sort((a,b)=>b.gapPoints-a.gapPoints||a.id.localeCompare(b.id)).slice(0,8);
 return {...report,status:'ok',trainingSamples:training.length,neighbours:k,
  maePoints:round(mae),minimumGapPoints:round(minimumGap),anomalies};
}
