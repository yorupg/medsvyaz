#!/usr/bin/env python3
"""Reproducible offline Kaliningrad mixed public-medical-site screening (not land approval).

Inputs are the project's unchanged road graph, selected baseline public hospitals,
2021 settlement populations, an OSM clinic map catalog and official 2021 age-cohort
rates by urban/rural settlement type. Requires numpy scipy brotli.
No invented settlement-specific age counts. MIED v6.1 is not redefined.
"""
from __future__ import annotations
import json, math, heapq, pathlib
from collections import defaultdict
import brotli
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

ROOT=pathlib.Path(__file__).resolve().parents[1]
DATASET=ROOT/'data/processed/kaliningrad-pilot.json.br'
CATALOG=ROOT/'public/data/kaliningrad-medical-facilities.json'
DEMO=ROOT/'data/demographics/kaliningrad-age-structure-2021.json'
CORRIDORS=ROOT/'data/derived/v6-extended/corridors.json'
OUTPUT=ROOT/'public/data/kaliningrad-hospital-proposals.json'

def distance_km(a,b):
    p=math.pi/180
    x=(b['lon']-a['lon'])*math.cos((a['lat']+b['lat'])*p/2)*111.195
    y=(b['lat']-a['lat'])*111.195
    return math.hypot(x,y)

def accessibility(t):
    t=np.asarray(t,dtype=np.float64)
    x=np.maximum(0,t-15)
    x=np.where(t>60,45+2*(t-60),x)
    with np.errstate(over='ignore'):
        a=np.where(t<=15,1.,np.exp2(-x/25))
    return np.where(np.isfinite(t),a,0.)

def main():
    data=json.loads(brotli.decompress(DATASET.read_bytes()))
    catalog=json.loads(CATALOG.read_text())['facilities']
    demo=json.loads(DEMO.read_text())
    nodes=data['nodes']; node_ids={v['id']:i for i,v in enumerate(nodes)}
    n=len(nodes)
    # Use minimum, NOT sum, when more than one OSM edge shares endpoints.
    arcs=[]
    closed_ways=set(json.loads(CORRIDORS.read_text()).get('kaliningrad',[])[:3])
    for e in data['edges']:
        if not e['allowed']: continue
        u,v=node_ids[e['from']],node_ids[e['to']]
        key=e.get('osmWayId') or e['id']
        # Graph is TRANSPOSED: starts are destination facilities.
        for a,b in ([(v,u)] if e['directed'] else [(v,u),(u,v)]):
            arcs.append((a,b,float(e['minutes']),key))
    def make_graph(closed=None):
        arc_min={}
        for a,b,t,key in arcs:
            if key==closed:continue
            k=(a,b)
            if t<arc_min.get(k,float('inf')):arc_min[k]=t
        entries=[(a,b,t) for (a,b),t in arc_min.items()]
        return csr_matrix((np.array([e[2] for e in entries]),(
            np.array([e[0] for e in entries]),np.array([e[1] for e in entries]))),shape=(n,n))
    graph=make_graph(); closed_graphs=[make_graph(w) for w in sorted(closed_ways)]
    hospital_ids=sorted({node_ids[f['nodeId']] for f in data['facilities'] if f['verified']})
    points=[s for s in data['settlements'] if s['nodeId'] and s['population'] is not None and s['population']>=0]
    point_nodes=np.array([node_ids[s['nodeId']] for s in points],dtype=np.int32)
    pops=np.array([int(s['population']) for s in points],dtype=np.float64)
    def is_urban(s):return s.get('settlementType','').strip().lower() in ['г.','город','пгт','г','городской']
    age_splits=[];age_weights=[]
    for s,pop in zip(points,pops):
        key='urban' if is_urban(s) else 'rural'
        shares=demo['splits'][key]['shares']
        ages=[pop*shares['age_0_17'],pop*shares['age_18_54'],pop*shares['age_55_plus']]
        age_splits.append(ages)
        age_weights.append(float(np.dot(ages,[1.4,1.0,1.6])))
    age_weights=np.array(age_weights)
    age_splits=np.array(age_splits)
    baseline_matrix=dijkstra(graph,directed=True,indices=hospital_ids)
    baseline_choices=np.sort(baseline_matrix[:,point_nodes],axis=0)
    base_first=baseline_choices[0];base_backup=baseline_choices[1]
    closed_base=[np.min(dijkstra(g,directed=True,indices=hospital_ids)[:,point_nodes],axis=0) for g in closed_graphs]
    base_robust=np.maximum.reduce([base_first]+closed_base)
    # Status=unknown for no road path; never turn it into a confirmed 0.
    valid=np.isfinite(base_first)&(pops>=0)
    def mied(first,backup,robust):
        scores=.85*accessibility(first)+.10*accessibility(backup)+.05*accessibility(robust)
        p=pops[valid];w=.752/valid.sum()+.248*p/p.sum()
        return float(100*np.sum(w*scores[valid]))
    baseline_value=mied(base_first,base_backup,base_robust)
    print('Baseline v6.1 graph index',baseline_value,'valid',valid.sum())
    all_facility_locations=[{'lat':f.get('lat'), 'lon':f.get('lon'),'name':f.get('name',''),'type':'public_hospital'} for f in data['facilities']]+catalog
    hospitals=[f for f in all_facility_locations if (f.get('medicalType')=='hospital' or f.get('type')=='public_hospital') and f.get('lat') is not None]
    adult_clinics=[f for f in catalog if f['type']=='public_adult_polyclinic' and not any(t in f['name'].lower() for t in ('стоматолог','уфсб'))]
    child_clinics=[f for f in catalog if f['type']=='public_children_polyclinic' and not 'стоматолог' in f['name'].lower()]
    # Projected road-node proximity for OSM outpatient locations; map category is a proxy,
    # NOT official proof of an outpatient clinic's profile or catchment.
    coords=np.array([[x['x']*math.cos(54.8*math.pi/180),x['y']] for x in nodes])
    tree=cKDTree(coords)
    def clinic_distances(facilities):
        indexes=[]
        for site in facilities:
            dist,idx=tree.query([site['lon']*math.cos(54.8*math.pi/180),site['lat']])
            if dist*111195<=600:indexes.append(int(idx))
        if not indexes:return np.full(len(points),np.inf)
        return np.min(dijkstra(graph,directed=True,indices=sorted(set(indexes)))[:,point_nodes],axis=0)
    current_clinic={'public_adult_polyclinic':clinic_distances(adult_clinics),
                    'public_children_polyclinic':clinic_distances(child_clinics)}
    baseline_clinic={k:v.copy() for k,v in current_clinic.items()}
    # A site is screened for distance to road and community; candidate TYPE will be
    # selected from simulated hospital / outpatient gaps, never from a fixed list.
    options=[]
    for i,s in enumerate(points):
        if not valid[i] or not(400<=pops[i]<=160000) or s.get('snapMeters',9999)>150:continue
        site={'lat':s.get('lat',nodes[point_nodes[i]]['y']),'lon':s.get('lon',nodes[point_nodes[i]]['x'])}
        road={'lat':nodes[point_nodes[i]]['y'],'lon':nodes[point_nodes[i]]['x']}
        nearest_hospital=min(distance_km(site,f) for f in hospitals)
        local_clinics=sum(distance_km(site,f)<=15 for f in adult_clinics+child_clinics)
        hospital_need=min(1.,nearest_hospital/35.)*(1.+.07*min(local_clinics,4))
        peak=float(pops[i]*max(0.,base_first[i]-25))
        # Clinic gaps are deliberately screened separately from an inpatient shortage.
        clinic_need=float(pops[i]*min(1.,min(current_clinic['public_adult_polyclinic'][i],100)/55))
        options.append({'index':i,'settlement':s,'road':road,'distanceRoadMeters':round(distance_km(site,road)*1000,1),'nearestHospitalKm':round(nearest_hospital,2),'nearbyPolyclinics':local_clinics,'hospitalNeed':hospital_need,'peak':peak+clinic_need})
    options.sort(key=lambda x:x['peak']*(1+.2*x['hospitalNeed']),reverse=True)
    selected=[];seen=set()
    for item in options:
        mun=item['settlement']['municipality']
        if mun in seen:continue
        selected.append(item);seen.add(mun)
        if len(selected)>=18:break
    for item in options:
        if len(selected)>=35:break
        if item not in selected:selected.append(item)
    if len(selected)<3:raise ValueError('Too few eligible settlement sites')
    print('candidate shortlist',len(selected),'eligible',len(options),'closures',sorted(closed_ways))
    candidates={}
    for item in selected:
        node=point_nodes[item['index']]
        cand=dijkstra(graph,directed=True,indices=node)[point_nodes]
        closed=[dijkstra(g,directed=True,indices=node)[point_nodes] for g in closed_graphs]
        candidates[item['settlement']['id']]={'item':item,'first':cand,'stress':closed}
    picked=[]
    current_first=base_first.copy();current_backup=base_backup.copy();current_stress=[x.copy() for x in closed_base]
    current_value=baseline_value
    base_destination_ids=np.array([next((f['id'] for f in data['facilities'] if node_ids[f['nodeId']]==hospital_ids[j]),data['facilities'][0]['id']) for j in np.argmin(baseline_matrix[:,point_nodes],axis=0)],dtype=object)
    hospital_destination_ids=base_destination_ids.copy()
    baseline_scores=.85*accessibility(base_first)+.10*accessibility(base_backup)+.05*accessibility(base_robust)
    affected_by_projects=set()
    def score_for_status(first,backup,stresses):
        return .85*accessibility(first)+.10*accessibility(backup)+.05*accessibility(np.maximum.reduce([first]+stresses))
    def pct_norm(x,maxv):return min(1.,x/maxv) if maxv>0 else 0.
    for rank in range(3):
        proposals=[]
        for key,rec in candidates.items():
            item=rec['item'];site=item['settlement']
            if any(distance_km({'lat':site.get('lat'),'lon':site.get('lon')},{'lat':p['lat'],'lon':p['lon']})<18 for p in picked):continue
            cand=rec['first']
            for kind in ('public_hospital','public_adult_polyclinic','public_children_polyclinic'):
                # Where inpatient care is still beyond 35 minutes at this settlement,
                # outpatient-only construction must not substitute for a hospital.
                if kind!='public_hospital' and base_first[item['index']]>=35:continue
                if kind=='public_hospital':
                    if item['nearestHospitalKm']<8:continue
                    new_first=np.minimum(current_first,cand)
                    new_backup=np.minimum(np.maximum(current_first,cand),current_backup)
                    new_stress=[np.minimum(old,new) for old,new in zip(current_stress,rec['stress'])]
                    value=mied(new_first,new_backup,np.maximum.reduce([new_first]+new_stress))
                    gain=value-current_value
                    improved=valid&(new_first<=40)&(current_first>=45)&(current_first-new_first>=5)
                    weighted=float(age_weights[improved].sum())
                    captured=float(pops[improved].sum())
                    gap=min(1.,item['nearestHospitalKm']/35.)*(1+.04*min(item['nearbyPolyclinics'],4))
                    impact=max(0.,gain)
                    changed=valid&(current_first-new_first>=1)
                else:
                    old_clinic=current_clinic[kind]
                    new_clinic=np.minimum(old_clinic,cand)
                    # Only age-cohort clients of the outpatient category count.
                    # If no recorded clinic existed, the new facility is a modeled
                    # nearest clinic; the route from a hospital is NOT substituted.
                    improved=valid&(new_clinic<=30)&(old_clinic>40)&((old_clinic-new_clinic)>=5)
                    age_group=age_splits[:,0]*1.4 if kind=='public_children_polyclinic' else age_splits[:,1]+age_splits[:,2]*1.6
                    weighted=float(age_group[improved].sum())
                    captured=float((age_splits[:,0] if kind=='public_children_polyclinic' else (age_splits[:,1]+age_splits[:,2]))[improved].sum())
                    gap=min(1.,float(np.median(np.minimum(old_clinic[valid],120)))/60)
                    value=current_value
                    gain=0.
                    impact=weighted / max(1.,float(age_group.sum())) * 100
                    changed=improved
                proposals.append({'key':key,'kind':kind,'gain':gain,'after':value,'capture':captured,
                    'weightedCapture':weighted,'impact':impact,'affectedSettlements':int(np.sum(changed)),
                    'newlyCovered':np.where(improved)[0],'item':item,'first':cand,
                    'gap':gap,'stress':rec['stress']})
        if not proposals:break
        max_impact=max(p['impact'] for p in proposals)
        max_pop=max(p['weightedCapture'] for p in proposals)
        for p in proposals:
            item=p['item']
            p['rankScore']=100*(.40*pct_norm(p['impact'],max_impact)+.35*pct_norm(p['weightedCapture'],max_pop)+.15*min(1.,p['gap'])+.10*max(0,1-item['distanceRoadMeters']/150.))
        proposals.sort(key=lambda p:(p['rankScore'],p['weightedCapture'],p['gain']),reverse=True)
        # Explicit portfolio policy: prioritize at least one 24h inpatient hospital,
        # while further projects compete on age-weighted access and local shortage.
        if rank==0:
            hospital_options=[p for p in proposals if p['kind']=='public_hospital' and p['gain']>0]
            if not hospital_options:raise ValueError('No inpatient candidate with positive MIED gain')
            best=hospital_options[0]
        else:best=proposals[0]
        if best['impact']<=1e-6:break
        item=best['item'];kind=best['kind'];cand=best['first']
        s=item['settlement'];r=item['road']
        prev_index=current_value
        if kind=='public_hospital':
            new_first=np.minimum(current_first,cand)
            current_backup=np.minimum(np.maximum(current_first,cand),current_backup)
            current_stress=[np.minimum(old,new) for old,new in zip(current_stress,best['stress'])]
            changed_dest=(cand<current_first-1.e-7)
            hospital_destination_ids[changed_dest]=f'candidate-facility-{rank+1}'
            current_first=new_first
            current_value=best['after']
        else:
            current_clinic[kind]=np.minimum(current_clinic[kind],cand)
        for i in best['newlyCovered']:affected_by_projects.add(i)
        label={'public_hospital':'Больница круглосуточного стационара',
               'public_adult_polyclinic':'Взрослая поликлиника',
               'public_children_polyclinic':'Детская поликлиника'}[kind]
        chosen={'rank':rank+1,'id':f'candidate-facility-{rank+1}','settlementId':s['id'],
          'name':f'Проектная государственная {label.lower()} — {s["name"]}',
          'kind':kind,'careLevel':('inpatient-24h' if kind=='public_hospital' else 'outpatient-daytime'),
          'lat':r['lat'],'lon':r['lon'],'settlement':s['name'],'municipality':s['municipality'],
          'population':int(s['population']),'snapDistanceMeters':item['distanceRoadMeters'],
          'nearestExistingHospitalKm':item['nearestHospitalKm'],
          'nearbyPublicPolyclinics15km':item['nearbyPolyclinics'],
          'affectedSettlements':best['affectedSettlements'],'capturedPeople':round(best['capture']),
          'weightedCapture':round(best['weightedCapture']),
          'baselineIndex':round(baseline_value,5),'previousPortfolioIndex':round(prev_index,5),
          'indexAfter':round(current_value,5),'indexIncrement':round(current_value-prev_index,5),
          'rankScore':round(best['rankScore'],2),'estimatedAge':{
              'children0_17':round(float(age_splits[item['index']][0])),
              'adults18_54':round(float(age_splits[item['index']][1])),
              'older55_plus':round(float(age_splits[item['index']][2]))},
          'impactType':('mied-inpatient' if kind=='public_hospital' else 'outpatient-coverage'),
          'rankImpact':round(float(best['impact']),4)}
        picked.append(chosen)
        del candidates[best['key']]
        print('chosen',rank+1,label,s['name'],'gain',current_value-prev_index,'outpatient impact',best['impact'],'capture',best['capture'])
    # Saved pointwise portfolio is the exact state AFTER applying every chosen project.
    final_scores=score_for_status(current_first,current_backup,current_stress)
    final_robust=np.maximum.reduce([current_first]+current_stress)
    point_results=[]
    for i,s in enumerate(points):
        point_results.append({'id':s['id'],
            'baselineMinutes':round(float(base_first[i]),5) if np.isfinite(base_first[i]) else None,
            'afterMinutes':round(float(current_first[i]),5) if np.isfinite(current_first[i]) else None,
            'baselineScore':round(float(baseline_scores[i]),9) if valid[i] else None,
            'afterScore':round(float(final_scores[i]),9) if valid[i] else None,
            'afterFacilityId':str(hospital_destination_ids[i]),
            'afterBackupMinutes':round(float(current_backup[i]),5) if np.isfinite(current_backup[i]) else None,
            'afterRobustMinutes':round(float(final_robust[i]),5) if np.isfinite(final_robust[i]) else None})
    included_ids={p['id'] for p in point_results}
    for settlement in data['settlements']:
        if settlement['id'] not in included_ids:
            point_results.append({'id':settlement['id'],'baselineMinutes':None,'afterMinutes':None,
                'baselineScore':None,'afterScore':None,'afterFacilityId':'',
                'afterBackupMinutes':None,'afterRobustMinutes':None})
    first_saved=np.array([p['afterScore'] for p in point_results if p['afterScore'] is not None])
    assert len(first_saved)==valid.sum()
    assert abs(mied(current_first,current_backup,np.maximum.reduce([current_first]+current_stress))-current_value)<1e-7
    changed_med=valid&(current_first<base_first-1.e-5)
    uniq_affected=changed_med.copy()
    for i in affected_by_projects:uniq_affected[i]=True
    project_summary={'affectedPopulation':round(float(pops[uniq_affected].sum())),
        'inpatientAffectedPopulation':round(float(pops[changed_med].sum())),
        'affectedSettlements':int(uniq_affected.sum()),
        'includedSettlements':int(valid.sum()),
        'medianMinutes':round(float(np.sort(current_first[valid])[math.ceil(.5*valid.sum())-1]),5),
        'p90Minutes':round(float(np.sort(current_first[valid])[math.ceil(.9*valid.sum())-1]),5),
        'withinMinutesShares':{str(t):round(float((current_first[valid]<=t).mean()),8) for t in [30,60,90,120]},
        'pointResults':point_results}
    if len(picked)!=3:raise ValueError('Expected exactly three viable candidate sites')
    payload={'regionId':'kaliningrad','methodologyVersion':'6.1.0','mode':'constrained-sequential-portfolio',
      'computedWith':'official-age-urban-rural-proxy+OSM-road-network+unchanged-MIED-v6.1',
      'baselineIndex':round(baseline_value,5),'indexAfterThree':round(current_value,5),
      'totalGain':round(current_value-baseline_value,5),'sourceDataset':DATASET.name,'candidates':picked,
      'criteriaWeights':{'index_gain':.40,'age_weighted_newly_covered_population':.35,'existing_hospital_shortage':.15,'near_road_and_settlement':.10},
      'ageWeights':{'0-17':1.4,'18-54':1.0,'55+':1.6},
      'coverageDefinition':'Hospital: population in settlements where nearest inpatient trip was >=45min and becomes <=40min with >=5min saved. Adult / child clinics: estimated age-eligible population where nearest mapped clinic was >40min and becomes <=30min with >=5min saved.',
      'populationCounts':'Census 2021 settlements (Tochno), NOT updated 2025 local counts.',
      'ageEstimates':'2021 Rosstat urban/rural age-cohort proportions applied to 2021 settlement population. NOT observed age for each settlement. 18-year-olds belong to adult cohort (otherwise the user-proposed 19-54 leaves an uncovered age).',
      'validation':'Model-screened sites only. Land title, zoning, protected areas, buildings, road access, emergency profile, OSM hospital duplicates and exact medical need NOT verified.',
      'sourceUrls':[demo['sourceUrl'],'https://tochno.st/datasets/allsettlements','https://www.openstreetmap.org/copyright','https://tfoms39.ru/medicalfacilities/register-medical/'],
      'portfolio':project_summary,
      'medicalScope':'МИЭД v6.1 оценивает путь к круглосуточному стационару: взрослые/детские поликлиники не подменяют стационар и не меняют МИЭД. Для них отдельный прогноз доступности амбулаторного приёма по OSM.',
      'selectionPolicy':'Не менее одной круглосуточной государственной больницы; амбулаторный объект не замещает стационар там, где он удалён более чем на 35 минут. Остальные типы сопоставляются по прозрачному рейтингу спроса и доступности.',
      'selectionCaveat':'Кандидаты сравниваются по условной нормированной полезности: прирост МИЭД для стационара, дополнительный амбулаторный охват для поликлиник. Эти показатели не являются взаимозаменяемыми клиническими эффектами.'}
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
    print('saved',OUTPUT,'baseline',baseline_value,'after',current_value)

if __name__=='__main__':main()
