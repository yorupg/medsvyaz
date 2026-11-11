import {indexColor,type IndexResult,type PointResult} from './schema';

export function pointMapColor(point:Pick<PointResult,'score'>){return indexColor(point.score===null?null:point.score*100);}
/** Area, rather than diameter, scales with population; a minimum keeps tiny villages selectable. */
export function populationRadius(population:number|null,maxPopulation:number,weighted=true){
 if(!weighted)return 4;
 return Math.max(1.8,26*Math.sqrt(Math.max(0,population??0)/Math.max(1,maxPopulation)));
}
export function mapDistribution(points:PointResult[],expectedIndex?:number|null){
 const included=points.filter(p=>p.score!==null&&p.population!==null);
 const population=included.reduce((sum,p)=>sum+p.population!,0);
 const numerator=included.reduce((sum,p)=>sum+p.population!*p.score!,0);
 const index=population?100*numerator/population:null;
 if(expectedIndex!=null&&(index===null||Math.abs(index-expectedIndex)>1e-9))throw new Error('Точки карты не воспроизводят региональный индекс');
 const bins=[0,20,40,60,80].map(min=>{
  const max=min+20,selected=included.filter(p=>p.score!*100>=min&&(max===100?p.score!*100<=max:p.score!*100<max));
  const residents=selected.reduce((sum,p)=>sum+p.population!,0);
  return {min,max,color:indexColor((min+max)/2),settlements:selected.length,population:residents,populationShare:population?residents/population:null,settlementShare:included.length?selected.length/included.length:null,contributionPoints:population?100*selected.reduce((sum,p)=>sum+p.population!*p.score!,0)/population:null};
 });
 return {index,population,settlements:included.length,unweightedIndex:included.length?100*included.reduce((sum,p)=>sum+p.score!,0)/included.length:null,bins,
  largest:[...included].sort((a,b)=>b.population!-a.population!).slice(0,5).map(p=>({id:p.id,name:p.name,population:p.population,minutes:p.minutes,score:p.score,populationShare:population?p.population!/population:null,contributionPoints:population?100*p.population!*p.score!/population:null}))};
}
export type MapDistribution=ReturnType<typeof mapDistribution>;
export function auditResultMap(result:IndexResult){return mapDistribution(result.points,result.value);}
