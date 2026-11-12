/** V6.1 routing diagnostics. Two DIFFERENT facility nodes, and worst of three
 * reproducible, predetermined road-closure scenarios. Not observed failure risk.
 * Both flows use the same directed and weighted graph as calculate().
 */
import fixedCorridors from '../data/derived/v6-extended/corridors.json';
import type {CalculationOptions, Dataset, PointResult} from './schema';

type Arc={to:number;minutes:number;key:string};
type Label=[number,number,number]; // distance, node, medical source node
class Heap {
 data:Label[]=[];
 push(x:Label){const a=this.data;a.push(x);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<=x[0])break;a[i]=a[p];i=p;}a[i]=x;}
 pop():Label|undefined{const a=this.data;if(!a.length)return;const top=a[0],last=a.pop()!;if(a.length){let i=0;while(2*i+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return top;}
}

/** Returns independent medical sites by snapped ROAD NODE (not duplicated facility records). */
export function enrichV61Routing(d:Dataset,options:CalculationOptions,points:PointResult[]):PointResult[]{
 const nodes=new Map(d.nodes.map((n,i)=>[n.id,i]));
 const reverse:Arc[][]=d.nodes.map(()=>[]);
 const selectedIds=new Set(options.improvementEdgeIds??[]);
 const selectedWay=d.edges.find(e=>e.id===options.edgeId)?.osmWayId;
 for(const e of d.edges){
  if(!e.allowed)continue;
  const selected=selectedIds.has(e.id)||e.id===options.edgeId||Boolean(selectedWay&&e.osmWayId===selectedWay);
  if(options.scenario==='closure'&&selected)continue;
  const u=nodes.get(e.from),v=nodes.get(e.to);
  if(u===undefined||v===undefined)continue;
  const minutes=e.minutes*options.timeScale/(options.scenario==='improvement'&&selected?options.multiplier:1);
  const key=e.osmWayId??e.id;
  reverse[v].push({to:u,minutes,key});
  if(!e.directed)reverse[u].push({to:v,minutes,key});
 }
 const facilities=d.facilities.filter(f=>(d.synthetic||f.verified||f.id==='__proposal__facility')&&f.profile===d.profile&&f.periods.includes(options.period)&&(!options.facilityIds||options.facilityIds.includes(f.id)));
 const sourceFacility=new Map<number,string>();
 for(const f of facilities){const u=nodes.get(f.nodeId);if(u!==undefined&&!sourceFacility.has(u))sourceFacility.set(u,f.id);}
 const sources=[...sourceFacility.keys()];
 const two:(Array<[number,number]>)[]=reverse.map(()=>[]);
 if(sources.length>=2){
  const q=new Heap(),pending=new Map<string,number>();
  for(const u of sources){q.push([0,u,u]);pending.set(`${u}:${u}`,0);}
  while(q.data.length){
   const [dist,u,source]=q.pop()!,key=`${u}:${source}`;
   if(pending.get(key)!==dist)continue;
   pending.delete(key);
   const seen=two[u];
   if(seen.length>=2||seen.some(([,s])=>s===source))continue;
   seen.push([dist,source]);
   for(const arc of reverse[u]){
    if(two[arc.to].length>=2||two[arc.to].some(([,s])=>s===source))continue;
    const alt=dist+arc.minutes,k=`${arc.to}:${source}`;
    if(alt<(pending.get(k)??Infinity)){pending.set(k,alt);q.push([alt,arc.to,source]);}
   }
  }
 }
 const corridorList=(fixedCorridors as Record<string,string[]>)[d.regionId]??[];
 function closureDistances(closed:string):number[]{
  const dist=new Float64Array(reverse.length);dist.fill(Infinity);
  const q=new Heap();
  for(const source of sources){dist[source]=0;q.push([0,source,source]);}
  while(q.data.length){const [time,u]=q.pop()!;if(time!==dist[u])continue;
   for(const arc of reverse[u]){if(arc.key===closed)continue;const next=time+arc.minutes;
    if(next<dist[arc.to]){dist[arc.to]=next;q.push([next,arc.to,u]);}
   }
  }
  return Array.from(dist);
 }
 // Closure of each *predefined* OSM way independently, not all together.
 const worst=corridorList.slice(0,3).map(key=>closureDistances(key));
 const settlementById=new Map(d.settlements.map(s=>[s.id,s]));
 return points.map(p=>{
  const settlement=settlementById.get(p.id),node=settlement?.nodeId?nodes.get(settlement.nodeId):undefined;
  const second=node===undefined?undefined:two[node][1];
  const backupMinutes=second?.[0]??null;
  const backupFacilityId=second?sourceFacility.get(second[1])??null:null;
  const worstTime=node===undefined?Infinity:Math.max(...worst.map(dist=>dist[node]),p.minutes??Infinity);
  const robustMinutes=Number.isFinite(worstTime)?worstTime:null;
  return {...p,backupMinutes,backupFacilityId,robustMinutes};
 });
}
