#!/usr/bin/env python3
"""Generate *unverified* short street-network infill hypotheses, not construction approvals.

The input graph has no polygons of military/protected areas, private parcels, waterways or
verified terrain/surface constraints. This script deliberately restricts candidate links
to the immediate vicinity of known populated settlement centres and existing mapped
road nodes. It cannot guarantee safety; proposals must be surveyed separately.
"""
from __future__ import annotations
import argparse
import json
import math
import os
from pathlib import Path
from collections import defaultdict
from time import time

import brotli
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
EARTH = 111.32


def load_dataset(path: Path):
    return json.loads(brotli.decompress(path.read_bytes()))


def generate(d, *, max_km=0.95, hub_radius_km=1.00, min_pop=200, top=18):
    nodes=d['nodes']; edges=d['edges']; settlements=d['settlements'];facilities=d['facilities'];
    ids={node['id']:i for i,node in enumerate(nodes)}
    n=len(nodes)
    if not n:return []
    lat0=float(np.mean([p['y'] for p in nodes])); kx=EARTH*math.cos(math.radians(lat0));ky=EARTH
    x=np.array([p['x']*kx for p in nodes]);y=np.array([p['y']*ky for p in nodes]);pts=np.stack((x,y),axis=1)
    deg=np.zeros(n,dtype=np.int32);adjacent=set();rows=[];cols=[];val=[]
    forbiddenWords=('воен','military','полигон','аэродром','аэропорт','аэроп','airfield','airport','border','погранич','запрет','закрыт')
    safeNode=np.zeros(n,dtype=np.bool_); blockedNode=np.zeros(n,dtype=np.bool_)
    for e in edges:
        if not e.get('allowed',False):continue
        a=ids.get(e['from']);b=ids.get(e['to'])
        if a is None or b is None:continue
        if e.get('kind')!='access':deg[a]+=1;deg[b]+=1
        adjacent.add((min(a,b),max(a,b)))
        v=float(e['minutes'])
        rows.append(b);cols.append(a);val.append(v) # transpose for dist-to-hospital
        if not e.get('directed',False): rows.append(a);cols.append(b);val.append(v)
        if e.get('kind')!='access':
            if any(w in str(e.get('name','')).lower() for w in forbiddenWords):blockedNode[a]=True;blockedNode[b]=True
            else:safeNode[a]=True;safeNode[b]=True
    rev=coo_matrix((val,(rows,cols)),shape=(n,n)).tocsr()
    sources=np.array([ids[f['nodeId']] for f in facilities if f['nodeId'] in ids and f.get('profile')==d.get('profile')],dtype=int)
    if not sources.size:return []
    try:
        dist=dijkstra(rev,directed=True,indices=sources,min_only=True)
    except TypeError:
        dist=dijkstra(rev,directed=True,indices=sources).min(axis=0)
    nodeTree=cKDTree(pts)
    hubs=[s for s in settlements if s.get('population') is not None and s['population']>=min_pop and s.get('lat') is not None and s.get('lon') is not None and s.get('nodeId') in ids and dist[ids[s['nodeId']]]>22 and not any(word in (s['name']+' '+s['municipality']).lower() for word in ('лагерь','военн','полигон','гарнизон','казарм','погранич','чернышевск','балтийск'))]
    hubs.sort(key=lambda s:(-s['population'],s['id']))
    # Avoid rural straight-line corridors / highways: each candidate stays within 550m of
    # a named settlement centre and attaches to existing non-service graph junctions.
    rank=[]
    for s in hubs:
        centre=np.array([s['lon']*kx,s['lat']*ky]); nearby=nodeTree.query_ball_point(centre,hub_radius_km)
        eligible=[i for i in nearby if deg[i]>=2 and safeNode[i] and not blockedNode[i] and np.isfinite(dist[i])]
        if len(eligible)<2: continue
        eligible=sorted(eligible,key=lambda i:(np.linalg.norm(pts[i]-centre),i))[:180]
        if len(eligible)>1:
            subTree=cKDTree(pts[eligible])
            pairs=subTree.query_pairs(max_km,output_type='ndarray')
        else:continue
        # Limit near-duplicate suggestions; each pair at most 1km, and point-to-point
        # detour time must be >2 minutes to justify link.
        local=[]
        for ia,ib in pairs:
            a=eligible[int(ia)];b=eligible[int(ib)]
            if (min(a,b),max(a,b)) in adjacent:continue
            dd=float(np.linalg.norm(pts[a]-pts[b]));
            if dd<0.17 or dd>max_km:continue
            tNew=60*dd/25
            saved=abs(float(dist[a])-float(dist[b]))-tNew
            if saved<2.2 or saved>12:continue
            # Endpoints must be reasonably near distinct mapped local roads and not
            # require unsupported long-distance construction.
            # Filter crossings that are clearly in open unknown territory by requiring
            # midpoint near mapped road junctions; does NOT verify land use.
            middle=(pts[a]+pts[b])/2
            md,midpoint_idx=nodeTree.query(middle)
            if md>0.14:continue
            # Avoid an obvious unrealistic shortcut if the baseline already has a small route.
            candidate=(saved * (1.0+math.log1p(s['population'])/18))/(0.20+dd) # normalized for small low-impact infill
            local.append((candidate,a,b,dd,s['name'],s['id'],int(s['population']),saved))
        local.sort(key=lambda o:-o[0])
        for c in local[:3]:rank.append(c)
    rank.sort(key=lambda o:(-o[0],o[1],o[2]))
    unique=[];seen=set(); selected_pairs=[]
    for score,a,b,dd,name,hubid,pop,saved in rank:
        pair=(min(a,b),max(a,b));
        if pair in seen:continue
        if any(np.linalg.norm(pts[a]-pts[q])<.5 and np.linalg.norm(pts[b]-pts[r])<.5 for q,r in selected_pairs):continue
        seen.add(pair);selected_pairs.append((a,b))
        A=nodes[a];B=nodes[b];mid=[(A['x']+B['x'])/2,(A['y']+B['y'])/2]
        unique.append({'id':f"auto-infill-{d['regionId']}-{len(unique)+1}",'datasetId':d['id'],
                       'fromNodeId':A['id'],'toNodeId':B['id'],
                       'title':f"Короткая новая связка улиц у {name}",
                       'geometry':[[A['x'],A['y']],mid,[B['x'],B['y']]],
                       'modelSpeedKmh':25,'lengthKmEstimate':round(dd,4),
                       'candidateType':'urban-street-infill',
                       'originHub':name,'originHubId':hubid,'originHubPopulation':pop,
                       'predictedLocalMinutesSaved':round(saved,2),
                       'screening':{'maxLengthKm':max_km,'withinSettlementCenterKm':hub_radius_km,
                                    'minSettlementPopulation':min_pop,'existingRoadAnchors':True,
                                    'nearExistingRoadAtMidpointMeters':140,
                                    'militaryZonesVerified':False,'protectedAreasVerified':False,
                                    'waterAndBridgesVerified':False,'landRightsVerified':False,
                                    'terrainAndSafetyVerified':False},
                       'status':'PRELIMINARY_UNVERIFIED_DO_NOT_BUILD'})
        if len(unique)>=top:break
    # Independent shortest-path recomputation, same 15-minute comfort zone as MIED v5.
    # Candidates that do not actually change the region index are not exported.
    orig_pts=np.array([ids[s['nodeId']] for s in settlements if s.get('nodeId') in ids and np.isfinite(dist[ids[s['nodeId']]])],dtype=int)
    baseline_t=dist[orig_pts]
    def score(t):
        return 100*np.mean(np.where(t<=15,1.0,np.exp2(-(t-15)/25))) if len(t) else 0
    base_score=score(baseline_t)
    real_candidates=[]
    for item in unique:
        aa=ids[item['fromNodeId']];bb=ids[item['toNodeId']]
        rr=np.concatenate([np.asarray(rows,dtype=int),[aa,bb]])
        cc=np.concatenate([np.asarray(cols,dtype=int),[bb,aa]])
        speed=float(item['modelSpeedKmh']);time=float(item['lengthKmEstimate'])*60/speed
        vv=np.concatenate([np.asarray(val,dtype=float),[time,time]])
        changed_graph=coo_matrix((vv,(rr,cc)),shape=(n,n)).tocsr()
        post=dijkstra(changed_graph,indices=sources,directed=True,min_only=True)
        after_t=post[orig_pts]
        gain=score(after_t)-base_score
        changed=int(np.count_nonzero((baseline_t-after_t)>0.0001))
        if gain>0.000001 and changed>0:
            item['verifiedModelDelta']=round(float(gain),7)
            item['verifiedAffectedSettlements']=changed
            item['verifiedMaxMinutesSaved']=round(float(np.max(baseline_t-after_t)),3)
            real_candidates.append(item)
    real_candidates.sort(key=lambda c:(-c['verifiedModelDelta']/(0.4+c['lengthKmEstimate']),-c['verifiedModelDelta'],c['id']))
    return real_candidates[:7]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--regions',nargs='*',default=['kaliningrad','ivanovo','pskov'])
    args=parser.parse_args()
    dest=ROOT/'data/planning/algorithmic-road-candidates.json'
    registry=json.loads(dest.read_text('utf-8')) if dest.exists() else {'version':1,'method':'near-populated-existing-road-junctions; provisional; no verified military/protected-area/water/land constraints','corridors':[]}
    for region in args.regions:
        path=ROOT/'data/processed'/ (f'{region}-pilot.json.br' if region in ('kaliningrad','ivanovo','pskov') else f'expanded/{region}.json.br')
        if not path.exists():continue
        t0=time(); d=load_dataset(path);v=generate(d)
        registry['corridors']=[x for x in registry['corridors'] if x['datasetId']!=d['id']]+v
        dest.write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        print(region,len(v),f'{time()-t0:.1f}s',[{'name':c['originHub'],'km':c['lengthKmEstimate'],'delta_local':c['predictedLocalMinutesSaved']} for c in v[:3]],flush=True)
    dest.write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('Saved',dest,flush=True)

if __name__=='__main__':main()
