#!/usr/bin/env python3
"""Build a reproducible road model from the bundled Geofabrik PBF and census CSV.
Regeneration only: pip install osmium numpy scipy. App runtime needs only Node.
This is a simplified car routing model, not full OSRM or clinical dispatch routing.
"""
import csv, hashlib, json, math, re, argparse
from collections import Counter
from pathlib import Path
import osmium
import numpy as np
from scipy.spatial import cKDTree
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--region',default='kaliningrad',choices=['kaliningrad','ivanovo','pskov']);REGION=parser.parse_args().region
RAW=ROOT/('data/raw/pilot' if REGION=='kaliningrad' else 'data/raw/'+REGION)
NAMES={'kaliningrad':'Калининградская область','ivanovo':'Ивановская область','pskov':'Псковская область'}
PBF=RAW/('kaliningrad-261108.osm.pbf' if REGION=='kaliningrad' else 'roads.osm.pbf')
CSV=RAW/('kaliningrad_settlements_2021.csv' if REGION=='kaliningrad' else 'settlements-2021.csv')
ROADDATE='2026-11-08' if REGION=='kaliningrad' else '2026-11-09'
SOURCES={'kaliningrad':['geofabrik-kaliningrad-20261108','tfoms-hospitals-2026'],'ivanovo':['osmfr-ivanovo-20261109','tfoms-ivanovo-2026'],'pskov':['osmfr-pskov-20261109','hospitals-pskov-official']}
CHECK='pilot-independent-check.json' if REGION=='kaliningrad' else REGION+'-independent-check.json'
SPEEDS={'motorway':90,'motorway_link':45,'trunk':85,'trunk_link':40,'primary':65,'primary_link':30,'secondary':55,'secondary_link':25,'tertiary':40,'tertiary_link':20,'unclassified':25,'residential':25,'living_street':10,'service':15}
SURFACE={'gravel':40,'unpaved':40,'ground':40,'dirt':40,'cobblestone':30,'earth':20,'stone':20,'sand':20,'mud':10}
SNAP_LIMIT=500
def distance(a,b):
    x1,y1,x2,y2=map(math.radians,(*a,*b))
    z=math.sin((y2-y1)/2)**2+math.cos(y1)*math.cos(y2)*math.sin((x2-x1)/2)**2
    return 6371.0088*2*math.asin(min(1,math.sqrt(z)))
def dump(path,data):path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
class Roads(osmium.SimpleHandler):
    def __init__(self):
        super().__init__();self.ways=[];self.coords={};self.count=Counter();self.barriers=set();self.restrictions=0;self.excluded=Counter()
    def node(self,n):
        access=next((n.tags.get(k) for k in ['motorcar','motor_vehicle','vehicle','access'] if n.tags.get(k)),None)
        if access in ['no','private'] or n.tags.get('barrier') in ['bollard','block','stile','kissing_gate','cycle_barrier']:self.barriers.add(n.id)
    def relation(self,r):
        if r.tags.get('type')=='restriction':self.restrictions+=1
    def way(self,w):
        t=dict(w.tags);h=t.get('highway')
        if h not in SPEEDS:return
        access=next((t[k] for k in ['motorcar','motor_vehicle','vehicle','access'] if t.get(k)),None)
        if access in ['no','private','agricultural','forestry','delivery','customers'] or t.get('area')=='yes' or t.get('impassable')=='yes':self.excluded['access_or_area']+=1;return
        if any(k.endswith(':conditional') for k in t):self.excluded['conditional']+=1;return
        refs=[(n.ref,(n.lon,n.lat)) for n in w.nodes if n.location.valid()]
        if len(refs)<2:return
        speed=SPEEDS[h];limit=t.get('maxspeed','')
        if re.fullmatch(r'\d+(\.\d+)?',limit):speed=min(speed,float(limit))
        elif limit in ['RU:urban','RU:living_street','RU:motorway']:speed=min(speed,{'RU:urban':60,'RU:living_street':20,'RU:motorway':110}[limit])
        speed=min(speed,SURFACE.get(t.get('surface'),speed))
        if speed<=0:return
        oneway=t.get('oneway','yes' if t.get('junction')=='roundabout' or h=='motorway' else 'no')
        if oneway in ['reversible','alternating']:self.excluded['reversible']+=1;return
        if oneway=='-1':refs.reverse()
        ids=[x[0] for x in refs]
        for n,p in refs:self.coords[n]=p
        self.count.update(set(ids))
        self.ways.append({'id':str(w.id),'ids':ids,'speed':speed,'directed':oneway in ['yes','1','true','-1'],'name':t.get('name') or t.get('ref') or h,'class':h,'limit':limit})

def main():
    facilities=json.loads((RAW/'facilities_verified.json').read_text())
    if isinstance(facilities,dict):facilities=facilities['facilities']
    with CSV.open(encoding='utf-8-sig') as f:rows=list(csv.DictReader(f,delimiter=';'))
    h=Roads();h.apply_file(str(PBF),locations=True)
    print('Raw roads:',len(h.ways),'nodes:',len(h.coords),flush=True)
    # Protect endpoints, junctions and actual snap vertices before degree-two compression.
    keep={n for n,c in h.count.items() if c>1}
    for w in h.ways:keep.update([w['ids'][0],w['ids'][-1]])
    candidate_ids=sorted(set(n for w in h.ways if w['class'] not in ['motorway','motorway_link','trunk','trunk_link'] for n in w['ids'] if n not in h.barriers))
    scale=np.array([111320*math.cos(math.radians(54.8 if REGION=='kaliningrad' else sum(float(r['latitude']) for r in rows)/len(rows))),111320])
    tree=cKDTree(np.array([h.coords[n] for n in candidate_ids])*scale)
    def snap(lon,lat):
        metres,i=tree.query(np.array([lon,lat])*scale);n=candidate_ids[int(i)]
        if metres<=SNAP_LIMIT:keep.add(n);return n,round(float(metres),2)
        return None,round(float(metres),2)
    settlements=[]
    for r in rows:
        lon,lat=float(r['longitude']),float(r['latitude']);n,metres=snap(lon,lat)
        settlements.append({'id':'s-'+r['oktmo'],'name':r['object_name'],'nodeId':('s-'+r['oktmo']) if n else None,'population':int(r['population']),'municipality':r['mun_upper'],'provenance':'tochno-allsettlements-2021; OKTMO '+r['oktmo'],'lat':lat,'lon':lon,'snapMeters':metres,'_snap':n})
    fs=[]
    for f in facilities:
        n,metres=snap(f['lon'],f['lat'])
        if n is None:raise ValueError('Hospital too far from modeled road: '+f['name'])
        fs.append({'id':f['id'],'name':f['name'],'nodeId':f['id'],'profile':'selected-public-hospital','periods':['day'],'verified':True,'provenance':SOURCES[REGION][1]+'; '+f.get('verificationNote','official registry, matched OSM address'),'lat':f['lat'],'lon':f['lon'],'officialAddress':f['officialAddress'],'sourceUrl':f['sourceUrl'],'osmId':f['osmId'],'_snap':n,'snapMeters':metres})
    edges=[];used=set();segments={}
    for w in h.ways:
        path=[]
        for n in w['ids']:
            path.append(n)
            if n in keep and len(path)>1:
                start,end=path[0],path[-1]
                if start!=end and not any(p in h.barriers for p in path):
                    geometry=[[round(x,7),round(y,7)] for x,y in (h.coords[p] for p in path)]
                    km=sum(distance(a,b) for a,b in zip(geometry,geometry[1:]))
                    if km>0:
                        eid='w'+w['id']+'-'+str(start)+'-'+str(end)
                        edges.append({'id':eid,'from':'n'+str(start),'to':'n'+str(end),'minutes':round(km/w['speed']*60,7),'directed':w['directed'],'allowed':True,'speedSource':f"OSRM v5.27.1 class table; min numeric maxspeed/surface; {w['speed']} km/h (model)",'name':w['name'],'osmWayId':w['id'],'lengthKm':round(km,5),'kind':'road','geometry':geometry})
                        used.update([start,end]);segments[eid]=geometry
                path=[n]
    nodes=[{'id':'n'+str(n),'x':round(h.coords[n][0],7),'y':round(h.coords[n][1],7)} for n in sorted(used)]
    for item in [*settlements,*fs]:
        n=item.pop('_snap');node_id=item.get('nodeId')
        if n not in used:
            if item in fs:raise ValueError('Hospital snapped to excluded road')
            item['nodeId']=None;continue
        nodes.append({'id':node_id,'x':item['lon'],'y':item['lat']})
        p=h.coords[n];km=distance((item['lon'],item['lat']),p)
        edges.append({'id':'access-'+item['id'],'from':node_id,'to':'n'+str(n),'minutes':max(0.001,round(km/5*60,7)),'directed':False,'allowed':True,'speedSource':'Geometric last-mile connector, explicit assumption 5 km/h; not a surveyed driveway','name':'Привязка точки к сети','lengthKm':round(km,5),'kind':'access','geometry':[[item['lon'],item['lat']],list(p)]})
        item.pop('snapMeters',None) if item in fs else None
    metadata={'populationYear':2021,'roadSnapshot':ROADDATE,'preparedAt':'2026-11-09','coordinateSystem':'WGS84','rawRoadWays':len(h.ways),'rawRoadNodes':len(h.coords),'compressedNodes':len(nodes),'compressedEdges':len(edges),'snapLimitMeters':SNAP_LIMIT,'connectorSpeedKmh':5,'missingSnaps':sum(s['nodeId'] is None for s in settlements),'maxSnapMeters':max(s['snapMeters'] for s in settlements if s['nodeId']),'ignoredTurnRestrictionRelations':h.restrictions,'excludedRoadWays':dict(h.excluded),'speedProfileUrl':'https://github.com/Project-OSRM/osrm-backend/blob/v5.27.1/profiles/car.lua','sourceSha256':hashlib.sha256(PBF.read_bytes()).hexdigest(),'sourceType':'real_observations_with_modeled_travel_times','facilityScope':'Selected public hospitals matched by treatment address; not all regional providers; no admission or specialist-service guarantee','nightAvailabilityVerified':False,'mapBounds':[[min(s['lat'] for s in settlements),min(s['lon'] for s in settlements)],[max(s['lat'] for s in settlements),max(s['lon'] for s in settlements)]]}
    dataset={'id':REGION+'-real-v1','version':'pilot-2026-11-09-v1','title':NAMES[REGION]+' · реальные исходные данные','regionId':REGION,'synthetic':False,'date':'2026-11-09','profile':'selected-public-hospital','profileLabel':'Поездка к выбранным государственным больницам','mode':'car','trip':'to-facility','sourceIds':['tochno-allsettlements-2021',*SOURCES[REGION],'osrm-speed-model'],'license':'Population: CC BY, Tochno/Rosstat. Road database: ODbL 1.0 © OpenStreetMap contributors. Sources stored separately.','coverageLabel':'Все поселения источника в области; доступность до выбранного набора больниц','expectedPopulation':sum(s['population'] for s in settlements),'assumptions':['Население зафиксировано по ВПН-2021; сеть дорог — снимок '+ROADDATE+'. Это разные даты наблюдения.','Цель — автомобильная поездка до ближайшей из выбранных больниц. Это не медицинская маршрутизация и не время прибытия скорой помощи.','Скорости — упрощённая модель по таблице OSRM v5.27.1 с ограничением числовым maxspeed и покрытием; не измерения трафика.','Пункты представлены одной координатой; геометрическая привязка до 500 м со скоростью 5 км/ч — допущение, а не обследованный подъезд.','Дороги с явным запретом доступа, сезонными/условными ограничениями исключены. Паромы и выезд за регион не моделируются.','Направления движения учитываются. Ограничения поворотов, задержки на перекрёстках, пробки, погода, вместимость больниц и ожидание не моделируются.','Ночной режим и свободный приём пациентов не подтверждены; доступен один расчётный период без заявления о режиме работы.','Сценарий улучшения или закрытия OSM-way — исследовательское предположение, а не утверждение о реальных дорожных работах.'],'metadata':metadata,'nodes':nodes,'edges':edges,'settlements':settlements,'facilities':fs}
    dump(ROOT/('data/processed/'+REGION+'-pilot.json'),dataset)
    # Independent shortest paths (SciPy) for comparison with the TypeScript engine.
    ids={n['id']:i for i,n in enumerate(nodes)};arcs={}
    for e in edges:
        a,b=ids[e['from']],ids[e['to']];arcs[a,b]=min(arcs.get((a,b),math.inf),e['minutes'])
        if not e['directed']:arcs[b,a]=min(arcs.get((b,a),math.inf),e['minutes'])
    graph=csr_matrix(([v for v in arcs.values()],([a for a,b in arcs],[b for a,b in arcs])),shape=(len(nodes),len(nodes)))
    dist=dijkstra(graph.T,indices=[ids[f['nodeId']] for f in fs],min_only=True)
    scores=[];values=[]
    for s in settlements:
        if s['nodeId'] is None:continue
        t=float(dist[ids[s['nodeId']]]);scores.append(s['population']*max(0,1-t/60) if math.isfinite(t) else 0)
        if math.isfinite(t) and s['population']>0:values.append(t)
    pop=sum(s['population'] for s in settlements if s['nodeId'] is not None)
    independent={'threshold':60,'period':'day','index':100*sum(scores)/pop,'includedPopulation':pop,'includedSettlements':sum(s['nodeId'] is not None for s in settlements),'reachableSettlements':sum(s['nodeId'] is not None and math.isfinite(float(dist[ids[s['nodeId']]])) for s in settlements),'unweightedReachableTimeQuantiles':list(np.quantile(values,[.1,.25,.5,.75,.9])),'method':'SciPy directed sparse Dijkstra independently of shared/engine.ts'}
    dump(ROOT/('data/derived/'+CHECK),independent)
    print('Built',len(nodes),'nodes',len(edges),'edges;',independent,flush=True)
if __name__=='__main__':main()
