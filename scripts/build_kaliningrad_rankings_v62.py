import json, math, pathlib, re
import brotli
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

ROOT=pathlib.Path(__file__).resolve().parents[1]
DATASET=ROOT/'data/processed/kaliningrad-pilot.json.br'
CATALOG=ROOT/'public/data/medical-catalogs/kaliningrad.json'
AGES=ROOT/'public/data/kaliningrad-settlement-ages-2021.json'
CORRIDORS=ROOT/'data/derived/v6-extended/corridors.json'
OUT_PUBLIC=ROOT/'public/data/kaliningrad-public-medical-proposals.json'
OUT_PRIVATE=ROOT/'public/data/kaliningrad-private-clinic-proposals.json'


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


def percentile(arr,q):
    arr=np.sort(arr)
    if len(arr)==0: return None
    idx=max(0,math.ceil(q*len(arr))-1)
    return float(arr[idx])


def load():
    data=json.loads(brotli.decompress(DATASET.read_bytes()))
    catalog=json.loads(CATALOG.read_text(encoding='utf-8'))['facilities']
    age_rows=json.loads(AGES.read_text(encoding='utf-8'))['settlements']
    return data,catalog,{r['id']:r for r in age_rows}


def build_graph(data):
    nodes=data['nodes']; node_ids={v['id']:i for i,v in enumerate(nodes)}
    arcs=[]
    closed_ways=set(json.loads(CORRIDORS.read_text(encoding='utf-8')).get('kaliningrad',[])[:3])
    for e in data['edges']:
        if not e['allowed']: continue
        u,v=node_ids[e['from']],node_ids[e['to']]
        key=e.get('osmWayId') or e['id']
        for a,b in ([(v,u)] if e['directed'] else [(v,u),(u,v)]):
            arcs.append((a,b,float(e['minutes']),key))
    def make_graph(closed=None):
        arc_min={}
        for a,b,t,key in arcs:
            if key==closed: continue
            k=(a,b)
            if t<arc_min.get(k,float('inf')): arc_min[k]=t
        entries=[(a,b,t) for (a,b),t in arc_min.items()]
        return csr_matrix((np.array([e[2] for e in entries]),(
            np.array([e[0] for e in entries]), np.array([e[1] for e in entries]))),shape=(len(nodes),len(nodes)))
    graph=make_graph()
    closed_graphs=[make_graph(w) for w in sorted(closed_ways)]
    return nodes,node_ids,graph,closed_graphs,sorted(closed_ways)


def get_public_clinic_sites(catalog):
    return [f for f in catalog if f['type'] in ('public_adult_polyclinic','public_children_polyclinic') and f.get('lat') is not None and f.get('lon') is not None]


def snap_catalog_to_nodes(nodes,catalog,max_m=600,types=None):
    coords=np.array([[x['x']*math.cos(54.8*math.pi/180),x['y']] for x in nodes])
    tree=cKDTree(coords)
    idxs=[]
    for site in catalog:
        if types is not None and site['type'] not in types: continue
        if site.get('lat') is None or site.get('lon') is None: continue
        dist,idx=tree.query([site['lon']*math.cos(54.8*math.pi/180),site['lat']])
        if dist*111195<=max_m:
            idxs.append(int(idx))
    return sorted(set(idxs))


def composite_index(first, clinic, robust, pops, valid):
    score=.55*accessibility(first)+.35*accessibility(clinic)+.10*accessibility(robust)
    p=pops[valid]
    w=.752/valid.sum()+.248*p/p.sum()
    return float(100*np.sum(w*score[valid])), score


def build_baseline(data,catalog,age_map):
    nodes,node_ids,graph,closed_graphs,closed_ways=build_graph(data)
    hospitals=[f for f in data['facilities'] if f['verified']]
    # Extra institutions are included in the hospital-distance formula only if
    # round-the-clock inpatient function AND their road-linked site were verified.
    extra_verified=[f for f in catalog if f['type']=='public_hospital' and f.get('inpatientVerified') and f.get('roadNodeId') in node_ids]
    hospital_ids=sorted({node_ids[f['nodeId']] for f in hospitals}|{node_ids[f['roadNodeId']] for f in extra_verified})
    points=[s for s in data['settlements'] if s['nodeId'] and s['population'] is not None and s['population']>=0]
    point_nodes=np.array([node_ids[s['nodeId']] for s in points],dtype=np.int32)
    pops=np.array([int(s['population']) for s in points],dtype=np.float64)
    valid=np.isfinite(pops)
    base_mat=dijkstra(graph,directed=True,indices=hospital_ids)
    sorted_h=np.sort(base_mat[:,point_nodes],axis=0)
    base_first=sorted_h[0]
    base_backup=sorted_h[1] if sorted_h.shape[0]>1 else sorted_h[0]
    closed_base=[np.min(dijkstra(g,directed=True,indices=hospital_ids)[:,point_nodes],axis=0) for g in closed_graphs]
    base_robust=np.maximum.reduce([base_first]+closed_base)
    public_clinics=get_public_clinic_sites(catalog)
    clinic_ids=snap_catalog_to_nodes(nodes, public_clinics)
    if clinic_ids:
        base_clinic=np.min(dijkstra(graph,directed=True,indices=clinic_ids)[:,point_nodes],axis=0)
    else:
        base_clinic=np.full(len(points), np.inf)
    base_value,base_score=composite_index(base_first,base_clinic,base_robust,pops,valid)
    ages=[]
    for s in points:
        row=age_map.get(s['id'])
        est=(row or {}).get('estimatedAges',{})
        a0=est.get('age0to17') or 0
        a1=est.get('age18to54') or 0
        a2=est.get('age55plus') or 0
        ages.append([a0,a1,a2])
    ages=np.array(ages,dtype=np.float64)
    age_weighted=np.dot(ages,[1.4,1.0,1.6])
    return {
        'nodes':nodes,'node_ids':node_ids,'graph':graph,'closed_graphs':closed_graphs,'closed_ways':closed_ways,
        'points':points,'point_nodes':point_nodes,'pops':pops,'valid':valid,
        'base_first':base_first,'base_backup':base_backup,'base_robust':base_robust,'base_clinic':base_clinic,
        'base_value':base_value,'base_score':base_score,'ages':ages,'age_weighted':age_weighted,
        'hospital_locations':[{'lat':f['lat'],'lon':f['lon'],'name':f['name']} for f in hospitals],
        'mapped_hospital_locations':[{'lat':f['lat'],'lon':f['lon'],'name':f['name']} for f in catalog if f['type']=='public_hospital' and f.get('lat') is not None and f.get('lon') is not None],
        'public_clinics':public_clinics,
        'private_clinics':[f for f in catalog if f['type']=='private_paid' and f.get('lat') is not None and f.get('lon') is not None],
    }


def summarise_point_results(data, base, after_first, after_robust, after_clinic, after_score, after_facility_ids):
    points=base['points']; valid=base['valid']; pops=base['pops']
    point_results=[]
    improved=np.zeros(len(points),dtype=bool)
    for i,s in enumerate(points):
        if base['base_score'][i] is not None and np.isfinite(base['base_score'][i]) and np.isfinite(after_score[i]):
            improved[i]=after_score[i] > base['base_score'][i] + 1e-9
        point_results.append({
            'id':s['id'],
            'baselineMinutes':round(float(base['base_first'][i]),5) if np.isfinite(base['base_first'][i]) else None,
            'afterMinutes':round(float(after_first[i]),5) if np.isfinite(after_first[i]) else None,
            'baselineClinicMinutes':round(float(base['base_clinic'][i]),5) if np.isfinite(base['base_clinic'][i]) else None,
            'afterClinicMinutes':round(float(after_clinic[i]),5) if np.isfinite(after_clinic[i]) else None,
            'baselineScore':round(float(base['base_score'][i]),9) if valid[i] else None,
            'afterScore':round(float(after_score[i]),9) if valid[i] else None,
            'afterFacilityId':str(after_facility_ids[i]) if after_facility_ids is not None else '',
            'afterBackupMinutes': None,
            'afterRobustMinutes':round(float(after_robust[i]),5) if np.isfinite(after_robust[i]) else None,
        })
    included_ids={p['id'] for p in point_results}
    for settlement in data['settlements']:
        if settlement['id'] not in included_ids:
            point_results.append({'id':settlement['id'],'baselineMinutes':None,'afterMinutes':None,'baselineClinicMinutes':None,'afterClinicMinutes':None,
                'baselineScore':None,'afterScore':None,'afterFacilityId':'','afterBackupMinutes':None,'afterRobustMinutes':None})
    summary={
        'affectedPopulation':round(float(pops[improved].sum())),
        'affectedSettlements':int(improved.sum()),
        'includedSettlements':int(valid.sum()),
        'medianMinutes':round(percentile(after_first[valid],0.5),5),
        'p90Minutes':round(percentile(after_first[valid],0.9),5),
        'withinMinutesShares':{str(t):round(float((after_first[valid]<=t).mean()),8) for t in [30,60,90,120]},
        'pointResults':point_results,
    }
    return summary


def choose_public_integrated(data, base, age_map):
    points=base['points']; pops=base['pops']; valid=base['valid']; point_nodes=base['point_nodes']; nodes=base['nodes']
    graph=base['graph']; closed_graphs=base['closed_graphs']
    # eligible settlements
    options=[]
    known_existing_inpatient={'правдинск','полесск','янтарный'}
    for i,s in enumerate(points):
        if re.sub(r'^(?:г\.|пгт|пос[её]лок|пос\.|село|п\.)\s*','',(s.get('name') or '').strip().lower()) in known_existing_inpatient:continue
        if not valid[i] or not (600<=pops[i]<=160000) or s.get('snapMeters',9999)>150: continue
        site={'lat':s.get('lat',nodes[point_nodes[i]]['y']), 'lon':s.get('lon',nodes[point_nodes[i]]['x'])}
        road={'lat':nodes[point_nodes[i]]['y'],'lon':nodes[point_nodes[i]]['x']}
        nearest_h=min(distance_km(site,f) for f in (base['hospital_locations']+base['mapped_hospital_locations']))
        nearest_poly=min([distance_km(site,f) for f in base['public_clinics']] or [999])
        if nearest_h<6 and nearest_poly<4: continue
        clinic_need=min(1., float(min(base['base_clinic'][i],120))/45.)
        hosp_need=min(1., float(min(base['base_first'][i],120))/40.)
        size_factor=min(1., pops[i]/20000)
        gap_score=.55*hosp_need+.45*clinic_need
        options.append({'index':i,'settlement':s,'road':road,'nearestHospitalKm':nearest_h,'nearestPolyclinicKm':nearest_poly,
                        'distanceRoadMeters':s.get('snapMeters',0),'gapScore':gap_score,'sizeFactor':size_factor})
    options.sort(key=lambda x:(x['gapScore']*(0.6+0.4*x['sizeFactor']), pops[x['index']]), reverse=True)
    shortlist=[]; seen_mun=set()
    for item in options:
        mun=item['settlement']['municipality']
        if mun in seen_mun: continue
        shortlist.append(item); seen_mun.add(mun)
        if len(shortlist)>=20: break
    for item in options:
        if len(shortlist)>=35: break
        if item not in shortlist: shortlist.append(item)
    candidates={}
    for item in shortlist:
        node=point_nodes[item['index']]
        cand=dijkstra(graph,directed=True,indices=node)[point_nodes]
        stress=[dijkstra(g,directed=True,indices=node)[point_nodes] for g in closed_graphs]
        candidates[item['settlement']['id']]={'item':item,'cand':cand,'stress':stress}
    picked=[]
    current_first=base['base_first'].copy(); current_robust=base['base_robust'].copy(); current_clinic=base['base_clinic'].copy(); current_score=base['base_score'].copy(); current_value=base['base_value']
    facility_ids=np.array(['baseline-hospital' for _ in points],dtype=object)
    for rank in range(3):
        scored=[]
        max_gain=max_capture=max_age=max_gap=1e-9
        for key,rec in candidates.items():
            item=rec['item']; s=item['settlement']; cand=rec['cand']; stress=rec['stress']
            if any(distance_km({'lat':s.get('lat'),'lon':s.get('lon')},{'lat':p['lat'],'lon':p['lon']})<16 for p in picked):
                continue
            new_first=np.minimum(current_first,cand)
            new_robust=np.minimum(current_robust, np.maximum.reduce([cand]+stress))
            new_clinic=np.minimum(current_clinic,cand)
            value, score = composite_index(new_first,new_clinic,new_robust,pops,valid)
            gain=max(0., value-current_value)
            improved=(score>current_score+1e-9)
            captured=float(pops[improved].sum())
            agecap=float(base['age_weighted'][improved].sum())
            need=.6*min(1., item['nearestHospitalKm']/35.) + .4*min(1., item['nearestPolyclinicKm']/20.)
            max_gain=max(max_gain,gain); max_capture=max(max_capture,captured); max_age=max(max_age,agecap); max_gap=max(max_gap,need)
            scored.append({'key':key,'item':item,'cand':cand,'stress':stress,'value':value,'score':score,'gain':gain,'improved':improved,'captured':captured,'agecap':agecap,'need':need,'new_first':new_first,'new_robust':new_robust,'new_clinic':new_clinic})
        if not scored: break
        for p in scored:
            p['rankScore']=100*(0.45*(p['gain']/max_gain)+0.25*(p['agecap']/max_age)+0.20*(p['need']/max_gap)+0.10*max(0.,1-p['item']['distanceRoadMeters']/150.))
        scored.sort(key=lambda x:(x['rankScore'],x['gain'],x['captured']), reverse=True)
        best=scored[0]
        item=best['item']; s=item['settlement']; i=item['index']
        prev=current_value
        current_first=best['new_first']; current_robust=best['new_robust']; current_clinic=best['new_clinic']; current_score=best['score']; current_value=best['value']
        facility_ids=np.where(best['cand']<base['base_first']-1e-7, f'public-integrated-{rank+1}', facility_ids)
        est=age_map.get(s['id'],{}).get('estimatedAges',{})
        chosen={
            'rank':rank+1,'id':f'public-integrated-{rank+1}','settlementId':s['id'],
            'proposalClass':'public_integrated','kind':'public_hospital_polyclinic',
            'name':f'Проектная больница с поликлиническим отделением — {s["name"]}',
            'careLevel':'integrated-hospital-and-polyclinic','lat':item['road']['lat'],'lon':item['road']['lon'],
            'settlement':s['name'],'municipality':s['municipality'],'population':int(s['population']),
            'snapDistanceMeters':round(item['distanceRoadMeters'],1),'nearestExistingHospitalKm':round(item['nearestHospitalKm'],2),
            'nearestExistingPolyclinicKm':round(item['nearestPolyclinicKm'],2),
            'nearbyPublicPolyclinics15km':sum(distance_km({'lat':s['lat'],'lon':s['lon']},f)<=15 for f in base['public_clinics']),
            'affectedSettlements':int(best['improved'].sum()),'capturedPeople':round(best['captured']),
            'weightedCapture':round(best['agecap']),'baselineIndex':round(base['base_value'],5),'previousPortfolioIndex':round(prev,5),
            'indexAfter':round(current_value,5),'indexIncrement':round(current_value-prev,5),'rankScore':round(best['rankScore'],2),
            'estimatedAge':{'children0_17':round(est.get('age0to17',0)),'adults18_54':round(est.get('age18to54',0)),'older55_plus':round(est.get('age55plus',0))},
            'impactType':'composite-public-index','rankImpact':round(float(best['gain']),4),
        }
        picked.append(chosen); del candidates[best['key']]
    portfolio=summarise_point_results(data, base, current_first, current_robust, current_clinic, current_score, facility_ids)
    payload={
        'regionId':'kaliningrad','methodologyVersion':'6.2.0','proposalClass':'public_integrated','scoreModel':'hospital-0.55+polyclinic-0.35+robust-0.10',
        'computedWith':'kaliningrad-road-network+public-polyclinic-snap+age-weighted-placement',
        'baselineIndex':round(base['base_value'],5),'indexAfterThree':round(current_value,5),'totalGain':round(current_value-base['base_value'],5),
        'candidates':picked,'ageWeights':{'0-17':1.4,'18-54':1.0,'55+':1.6},
        'coverageDefinition':'Индекс по поселению: 0.55×доступность ближайшей больницы + 0.35×доступность ближайшей государственной поликлиники (включая детскую) + 0.10×устойчивость больничного маршрута при модельных перекрытиях.',
        'populationCounts':'ВПН-2021 по Tochno. Возрастные группы используются только при выборе мест, а не в общей формуле индекса.',
        'ageEstimates':'Оценки по возрастам для поселений взяты из подготовленного файла kaliningrad-settlement-ages-2021.json; это модельные оценки, не фактический учёт каждого жителя.',
        'validation':'Площадки в Правдинске, Янтарном и Полесске исключены из выбора новых больниц: региональные сведения указывают на уже работающие учреждения. Кандидаты модельные; земельный участок, профиль стационара, мощность поликлиники, лицензии и инженерные ограничения не проверены.',
        'sourceUrls':['https://tochno.st/datasets/allsettlements','https://www.openstreetmap.org/copyright','https://tfoms39.ru/medicalfacilities/register-medical/'],
        'portfolio':portfolio,
        'medicalScope':'Каждый предложенный объект трактуется как больница с поликлиническим отделением: он одновременно улучшает больничную и амбулаторную компоненты. Возрастные группы учитываются только в ранжировании мест для строительства.',
        'selectionPolicy':'Подбираются населённые пункты у реальной дорожной сети, где сохраняется дефицит как стационарной, так и амбулаторной доступности. Рейтинг сочетает прирост общего индекса, возрастно-взвешенный охват и выраженность дефицита.',
        'selectionCaveat':'Это не медико-экономическое обоснование строительства и не государственная программа. Показатели отражают транспортную доступность в модели.',
    }
    OUT_PUBLIC.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
    return payload


def choose_private(data, base, age_map):
    points=base['points']; pops=base['pops']; valid=base['valid']; point_nodes=base['point_nodes']
    graph=base['graph']
    options=[]
    known_existing_inpatient={'правдинск','полесск','янтарный'}
    for i,s in enumerate(points):
        if re.sub(r'^(?:г\.|пгт|пос[её]лок|пос\.|село|п\.)\s*','',(s.get('name') or '').strip().lower()) in known_existing_inpatient:continue
        if not valid[i] or s.get('snapMeters',9999)>150: continue
        urban=(s.get('settlementType') or '').strip().lower() in ('г.','город','г','пгт')
        if not urban or pops[i] < 3500: continue
        site={'lat':s['lat'],'lon':s['lon']}
        nearest_private=min([distance_km(site,f) for f in base['private_clinics']] or [999])
        nearest_public=min([distance_km(site,f) for f in base['public_clinics']] or [999])
        nearest_any=min(nearest_private,nearest_public)
        if nearest_any < 2.2: continue
        options.append({'index':i,'settlement':s,'nearestPrivateKm':nearest_private,'nearestPublicPolyclinicKm':nearest_public,'distanceRoadMeters':s.get('snapMeters',0)})
    options.sort(key=lambda x:(pops[x['index']], min(x['nearestPrivateKm'],12)+0.7*min(x['nearestPublicPolyclinicKm'],12)), reverse=True)
    shortlist=[]; seen=set()
    for item in options:
        mun=item['settlement']['municipality']
        if mun in seen: continue
        shortlist.append(item); seen.add(mun)
        if len(shortlist)>=18: break
    for item in options:
        if len(shortlist)>=30: break
        if item not in shortlist: shortlist.append(item)
    candidates={}
    for item in shortlist:
        node=point_nodes[item['index']]
        cand=dijkstra(graph,directed=True,indices=node)[point_nodes]
        candidates[item['settlement']['id']]={'item':item,'cand':cand}
    picked=[]
    current_clinic=base['base_clinic'].copy(); current_score=base['base_score'].copy(); current_value=base['base_value']; facility_ids=np.array(['baseline-hospital' for _ in points],dtype=object)
    for rank in range(3):
        scored=[]
        max_gain=max_capture=max_market=max_gap=1e-9
        for key,rec in candidates.items():
            item=rec['item']; s=item['settlement']; cand=rec['cand']
            if any(distance_km({'lat':s['lat'],'lon':s['lon']},{'lat':p['lat'],'lon':p['lon']})<14 for p in picked):
                continue
            new_clinic=np.minimum(current_clinic,cand)
            value,score=composite_index(base['base_first'],new_clinic,base['base_robust'],pops,valid)
            gain=max(0.,value-current_value)
            improved=(score>current_score+1e-9)
            captured=float(pops[improved].sum())
            agecap=float(base['age_weighted'][improved].sum())
            market=float(pops[item['index']])
            gap=min(1., min(item['nearestPrivateKm'],12)/12.)*0.55 + min(1., min(item['nearestPublicPolyclinicKm'],12)/12.)*0.45
            max_gain=max(max_gain,gain); max_capture=max(max_capture,agecap); max_market=max(max_market,market); max_gap=max(max_gap,gap)
            scored.append({'key':key,'item':item,'cand':cand,'value':value,'score':score,'gain':gain,'improved':improved,'captured':captured,'agecap':agecap,'market':market,'gap':gap,'new_clinic':new_clinic})
        if not scored: break
        for p in scored:
            p['rankScore']=100*(0.35*(p['gain']/max_gain)+0.25*(p['market']/max_market)+0.20*(p['gap']/max_gap)+0.15*(p['agecap']/max_capture)+0.05*max(0.,1-p['item']['distanceRoadMeters']/150.))
        scored.sort(key=lambda x:(x['rankScore'],x['gain'],x['market']), reverse=True)
        best=scored[0]
        item=best['item']; s=item['settlement']
        prev=current_value
        current_clinic=best['new_clinic']; current_score=best['score']; current_value=best['value']
        est=age_map.get(s['id'],{}).get('estimatedAges',{})
        chosen={
            'rank':rank+1,'id':f'private-clinic-{rank+1}','settlementId':s['id'],
            'proposalClass':'private_paid','kind':'private_paid_clinic','name':f'Платная клиника — {s["name"]}',
            'careLevel':'paid-outpatient-clinic','lat':s['lat'],'lon':s['lon'],'settlement':s['name'],'municipality':s['municipality'],'population':int(s['population']),
            'snapDistanceMeters':round(item['distanceRoadMeters'],1),'nearestExistingHospitalKm':round(min(distance_km({'lat':s['lat'],'lon':s['lon']},f) for f in base['hospital_locations']),2),
            'nearestExistingPolyclinicKm':round(item['nearestPublicPolyclinicKm'],2),'nearestPrivateClinicKm':round(item['nearestPrivateKm'],2),
            'nearbyPublicPolyclinics15km':sum(distance_km({'lat':s['lat'],'lon':s['lon']},f)<=15 for f in base['public_clinics']),
            'affectedSettlements':int(best['improved'].sum()),'capturedPeople':round(best['captured']),'weightedCapture':round(best['agecap']),
            'baselineIndex':round(base['base_value'],5),'previousPortfolioIndex':round(prev,5),'indexAfter':round(current_value,5),'indexIncrement':round(current_value-prev,5),
            'rankScore':round(best['rankScore'],2),'estimatedAge':{'children0_17':round(est.get('age0to17',0)),'adults18_54':round(est.get('age18to54',0)),'older55_plus':round(est.get('age55plus',0))},
            'impactType':'private-clinic-placement','rankImpact':round(float(best['gain']),4),
        }
        picked.append(chosen); del candidates[best['key']]
    portfolio=summarise_point_results(data, base, base['base_first'], base['base_robust'], current_clinic, current_score, facility_ids)
    payload={
        'regionId':'kaliningrad','methodologyVersion':'6.2.0','proposalClass':'private_paid','scoreModel':'hospital-0.55+polyclinic-0.35+robust-0.10',
        'computedWith':'kaliningrad-road-network+competitive-private-placement',
        'baselineIndex':round(base['base_value'],5),'indexAfterThree':round(current_value,5),'totalGain':round(current_value-base['base_value'],5),
        'candidates':picked,'ageWeights':{'0-17':1.4,'18-54':1.0,'55+':1.6},
        'coverageDefinition':'Для рейтинга частных клиник общий индекс считается так же, как если бы новая клиника была бесплатной поликлиникой: меняется только амбулаторная компонента 0.35.',
        'populationCounts':'ВПН-2021 по Tochno. Возрастные группы используются только для выбора мест, но не в общей формуле индекса.',
        'ageEstimates':'Используются модельные оценки по возрастным группам из файла по поселениям Калининградской области.',
        'validation':'Рейтинг не подтверждает коммерческую окупаемость. Не учтены цены, помещения, кадровый состав, конкретный профиль услуг и конкуренция за пределами OSM-каталога.',
        'sourceUrls':['https://tochno.st/datasets/allsettlements','https://www.openstreetmap.org/copyright'],
        'portfolio':portfolio,
        'medicalScope':'Платная клиника не считается государственной больницей и не влияет на больничную часть индекса. При ранжировании мест оценивается, насколько она могла бы повысить амбулаторную доступность, если бы работала как поликлиника.',
        'selectionPolicy':'Рейтинг сочетает размер города, удалённость от ближайших частных клиник и гос. поликлиник, прогнозируемое влияние на индекс и возрастно-взвешенный охват населения.',
        'selectionCaveat':'Это проектный рейтинг площадок, а не заключение о прибыли инвестора и не лицензирование клиники.',
    }
    OUT_PRIVATE.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
    return payload

if __name__=='__main__':
    data,catalog,age_map=load()
    base=build_baseline(data,catalog,age_map)
    pub=choose_public_integrated(data,base,age_map)
    priv=choose_private(data,base,age_map)
    print('baseline', base['base_value'])
    print('public', pub['indexAfterThree'], [(x['settlement'],x['indexIncrement']) for x in pub['candidates']])
    print('private', priv['indexAfterThree'], [(x['settlement'],x['indexIncrement']) for x in priv['candidates']])
