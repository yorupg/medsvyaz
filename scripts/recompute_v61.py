#!/usr/bin/env python3
"""Independent reproducible v6.1 baseline from the INCLUDED ROAD GRAPH.
 - 2 distinct medical nodes with same modelled profile
 - three most commonly used non-access OSM ways across origin paths
 - one-at-a-time worst-case closure rerouting to ANY included medical facility
No engineering reliability probability or completeness of the facility register is asserted.
"""
import json,heapq,sys,time,collections,math,csv,subprocess
from pathlib import Path
import brotli
ROOT=Path(__file__).resolve().parents[1]
DER=ROOT/'data/derived/v6-extended';DER.mkdir(exist_ok=True,parents=True)
PILOTS=['kaliningrad','ivanovo','pskov']
SYNTHETIC_PATH=ROOT/'data/processed/synthetic-regions.json'
SYNTHETIC_DATA=None
ALPHA=.752
GAMMA=2.

def access(t,tau=40):
 if t is None:return 0.
 if t<=15:return 1.
 return 2**(-((t-15) if t<=60 else (45+GAMMA*(t-60)))/(tau-15))

def load_data(rid):
 global SYNTHETIC_DATA
 if rid in PILOTS:
  p=ROOT/'data/processed'/f'{rid}-pilot.json.br'
  if p.exists():return json.loads(brotli.decompress(p.read_bytes()))
  return json.loads((ROOT/'data/processed'/f'{rid}-pilot.json').read_bytes())
 if SYNTHETIC_DATA is None:SYNTHETIC_DATA=json.loads(SYNTHETIC_PATH.read_bytes())
 if rid in SYNTHETIC_DATA:return SYNTHETIC_DATA[rid]
 p=ROOT/'data/processed/expanded'/f'{rid}.json.br'
 if p.exists():return json.loads(brotli.decompress(p.read_bytes()))
 raise FileNotFoundError(str(p))

def reverse_graph(d):
 nodes=d['nodes'];lookup={v['id']:i for i,v in enumerate(nodes)}
 rev=[[] for _ in nodes]
 for e in d['edges']:
  if not e.get('allowed',False):continue
  u=lookup[e['from']];v=lookup[e['to']]
  key=e.get('osmWayId') or e['id']
  arc=(u,float(e['minutes']),key,e['id'],e.get('kind')=='access')
  rev[v].append(arc)
  if not e.get('directed',False):rev[u].append((v,float(e['minutes']),key,e['id'],e.get('kind')=='access'))
 return lookup,rev

def dijkstra(rev,seeds,closed=None,pred=False):
 n=len(rev);dist=[math.inf]*n;nextedge=[None]*n if pred else None
 q=[]
 for idx in seeds:
  if dist[idx]>0:dist[idx]=0.;heapq.heappush(q,(0.,idx))
 while q:
  du,u=heapq.heappop(q)
  if du!=dist[u]:continue
  for v,t,key,eid,is_access in rev[u]:
   if key==closed:continue
   nd=du+t
   if nd<dist[v]:
    dist[v]=nd
    if pred:nextedge[v]=(u,key,eid,is_access)
    heapq.heappush(q,(nd,v))
 return dist,nextedge

def top_two(rev,seeds):
 # Two-source Dijkstra with stale-heap pruning to avoid exponential queued alternatives.
 best=[[] for _ in rev];q=[];pending={}
 for node in seeds:
  pending[(node,node)]=0.
  heapq.heappush(q,(0.,node,node))
 while q:
  dist,u,source=heapq.heappop(q)
  key=(u,source)
  if dist!=pending.get(key):continue
  del pending[key]
  seen=best[u]
  if len(seen)>=2 or any(s==source for _,s in seen):continue
  seen.append((dist,source))
  for v,t,_,__,___ in rev[u]:
   if len(best[v])>=2 or any(s==source for _,s in best[v]):continue
   alt=dist+t;k=(v,source)
   if alt<pending.get(k,math.inf):
    pending[k]=alt;heapq.heappush(q,(alt,v,source))
 return best

def top_corridors(rev, lookup, settlements, nextedge, limit=3):
 counts=collections.Counter()
 for s in settlements:
  i=lookup.get(s.get('nodeId'))
  if i is None:continue
  encountered=set();guard=0
  while i is not None and nextedge[i] is not None and guard<len(rev):
   i2,key,eid,is_access=nextedge[i]
   if not is_access:encountered.add(key)
   i=i2;guard+=1
  for key in encountered:counts[key]+=1
 return [key for key,_ in sorted(counts.items(),key=lambda pair:(-pair[1],pair[0]))[:limit]]

def recalc_region(rid,d,prior):
 st=time.time();lookup,rev=reverse_graph(d)
 fac=[f for f in d['facilities'] if (d['synthetic'] or f.get('verified')) and f['profile']==d['profile'] and 'day' in f['periods']]
 # Distinct road nodes: multiple entries snapped to same node do not count as independent reserve
 seed_by_node={lookup[f['nodeId']]:f['id'] for f in fac if f['nodeId'] in lookup}
 seeds=list(seed_by_node)
 main,pred=dijkstra(rev,seeds,pred=True)
 second=top_two(rev,seeds) if len(seeds)>=2 else None
 corridors=top_corridors(rev,lookup,d['settlements'],pred)
 closed=[dijkstra(rev,seeds,closed=key)[0] for key in corridors]
 old={p['id']:p for p in prior['points']}
 generated=[];drifts=[]
 for s in sorted(d['settlements'],key=lambda x:x['id']):
  oid=s['id'];o=old.get(oid)
  if o is None:continue
  node=lookup.get(s.get('nodeId'))
  tmain=(main[node] if node is not None else math.inf)
  if o['minutes'] is not None and math.isfinite(tmain) and abs(tmain-o['minutes'])>0.05:drifts.append((oid,o['minutes'],tmain))
  # Use source v5 cached time for historical cohort consistency.
  tb=(second[node][1][0] if second is not None and node is not None and len(second[node])>1 else None)
  tfid=seed_by_node.get(second[node][1][1]) if tb is not None else None
  worst=max((arr[node] for arr in closed),default=tmain) if node is not None else math.inf
  backup=None if tb is None or not math.isfinite(tb) else tb
  stress=None if not math.isfinite(worst) else worst
  p={**o,'backupMinutes':backup,'backupFacilityId':tfid,'robustMinutes':stress}
  if p['status'] in ('reachable','unreachable') and p.get('population') is not None:
   prim=access(o['minutes']);p['score']=.85*prim+.10*access(backup)+.05*access(stress)
  else:p['score']=None
  generated.append(p)
 # all included common cohort; equal + pop weighting normalized across cohort
 included=[p for p in generated if p['score'] is not None]
 population=sum(p['population'] for p in included)
 n=len(included)
 if not n or not population:score=None
 else:score=100*sum((ALPHA/n+(1-ALPHA)*p['population']/population)*p['score'] for p in included)
 terr=(100*sum(p['score'] for p in included)/n) if n else None
 pop=(100*sum(p['population']*p['score'] for p in included)/population) if population else None
 oldvalue=prior['value']
 out={'regionId':rid,'synthetic':d['synthetic'],'methodologyVersion':'6.1.0','weightTerritory':ALPHA,'weightPopulation':1-ALPHA,'primaryWeight':.85,'backupWeight':.10,'robustWeight':.05,'tau':40,'comfortMinutes':15,'longTripBreakMinutes':60,'longTripGamma':GAMMA,'stressWayIds':corridors,'facilityNodes':len(seed_by_node),'facilityRegisterCompleteness':'not-certified','sourceIndexV5':oldvalue,'value':score,'territorialIndex':terr,'populationIndex':pop,'includedSettlements':n,'includedPopulation':population,'points':generated,'travelTimeDisagreements':drifts[:10], 'travelTimeDriftCount':len(drifts),'computationSeconds':round(time.time()-st,2)}
 (DER/f'{rid}.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
 print(rid,'v6.1',round(score,4) if score is not None else None,'n',n,'fac',len(seed_by_node),'corridors',len(corridors),'drift',len(drifts),'s',round(time.time()-st,1),flush=True)
 return {k:out[k] for k in ['regionId','synthetic','value','territorialIndex','populationIndex','includedSettlements','includedPopulation','sourceIndexV5','stressWayIds','facilityNodes','travelTimeDriftCount','facilityRegisterCompleteness']}

def main():
 if len(sys.argv)==1:
  all_regions=[p.name.removesuffix('-summary.json') for p in (ROOT/'data/processed/expanded').glob('*-summary.json')]+PILOTS+list(json.loads(SYNTHETIC_PATH.read_bytes()))
  for region in all_regions:
   code=subprocess.run([sys.executable,__file__,region]).returncode
   if code:raise SystemExit(code)
  subprocess.run([sys.executable,str(ROOT/'scripts/publish_v61.py')],check=True)
  return
 wanted=sys.argv[1:] or [p.name.removesuffix('-summary.json') for p in (ROOT/'data/processed/expanded').glob('*-summary.json')]+PILOTS+list(json.loads(SYNTHETIC_PATH.read_bytes()))
 scores=[]
 for rid in wanted:
  old=ROOT/'data/derived/v5-baselines'/f'{rid}.json'
  if not old.exists():print('SKIP',rid,flush=True);continue
  prior=json.loads(old.read_bytes());d=load_data(rid)
  scores.append(recalc_region(rid,d,prior))
 (DER/'summary.json').write_text(json.dumps(scores,ensure_ascii=False,indent=2)+'\n')
 with (DER/'indices.csv').open('w',newline='',encoding='utf-8-sig') as file:
  wr=csv.writer(file,delimiter=';');wr.writerow(['Регион','МИЭД v6.1','По поселениям','По населению','МИЭД v5','Кол-во поселений','Узлов медплощадок','Проверка путей: несовпадения']);
  for o in scores:wr.writerow([o.get('regionId'),o.get('value'),o.get('territorialIndex'),o.get('populationIndex'),o.get('sourceIndexV5'),o.get('includedSettlements'),o.get('facilityNodes'),o.get('travelTimeDriftCount')]);
if __name__=='__main__':main()
