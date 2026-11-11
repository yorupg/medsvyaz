#!/usr/bin/env python3
"""Offline regional OSM graph + observed census inputs; no simulated links.

Writes gzipped datasets, per-point audit CSV, independent SciPy shortest paths,
and a small catalogue so starting the website does not load 30 entire graphs.
Run with PYTHONPATH pointing to installed requirements-data.txt packages.
"""
import argparse, csv, gzip, hashlib, heapq, json, math, re, sys, time
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np
import osmium
from scipy.spatial import cKDTree
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from shapely.geometry import Polygon
from repair_road_snaps import repair_snaps
from graph_integrity import unique_segment_ids

ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'data/raw/expanded'
OUT=ROOT/'data/processed/expanded'
OUT.mkdir(parents=True,exist_ok=True)
DOWNLOADS=ROOT/'public/downloads'
SPEEDS={'motorway':90,'motorway_link':45,'trunk':85,'trunk_link':40,
 'primary':65,'primary_link':30,'secondary':55,'secondary_link':25,
 'tertiary':40,'tertiary_link':20,'unclassified':25,'residential':25,
 'living_street':10,'service':15}
SURFACES={'gravel':40,'unpaved':40,'ground':30,'dirt':25,'cobblestone':30,
 'earth':20,'stone':20,'sand':15,'mud':10}
PROVENANCE='https://tochno.st/datasets/allsettlements'

def dump(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')

def km(a,b):
    x1,y1,x2,y2=map(math.radians,(*a,*b))
    z=math.sin((y2-y1)/2)**2+math.cos(y1)*math.cos(y2)*math.sin((x2-x1)/2)**2
    return 12742.0176*math.asin(min(1,math.sqrt(z)))

def norm(name):
    name=name.lower().replace('ё','е')
    name=re.sub(r'^(?:город|село|деревня|поселок городского типа|рабочий поселок|поселок|хутор|станица|аул|слобода|станция|населенный пункт)\s+','',name)
    name=re.sub(r'^(?:г\.|пгт\.?|рп\.?|д\.|с\.|п\.|пос\.?|х\.|ст-ца|сл\.|ст\.|снт|тер\.)\s*','',name)
    return re.sub(r'[^\w]','',name)

class Observations(osmium.SimpleHandler):
    def __init__(self):
        super().__init__();self.ways=[];self.coords={};self.count=Counter()
        self.barriers=set();self.restrictions=0;self.excluded=Counter()
        self.places=defaultdict(list);self.hospitals=[]
    def hospital(self,kind,oid,t,lon,lat):
        if t.get('amenity')!='hospital' or not t.get('name'):return
        if t.get('disused')=='yes' or t.get('abandoned')=='yes':return
        # OSM has miscoded polyclinics, dentists and individual departments.
        # Select general hospital campuses, applying the same rule in all 30 regions.
        name=t['name'].lower().replace('ё','е')
        if not re.search(r'больниц|стационар|госпитал|\bцрб\b|\bцгб\b|\bрб\b|\bмсч\b|медико.санитар',name):return
        if re.search(r'поликлин|стомат|диспансер|санатор|реабилит|псих|туберк|нарко|инфекц|родил|перинат|детск|онколог|офтальм|ветерин',name):return
        self.hospitals.append({'id':f'osm-{kind}-{oid}','name':t['name'],
            'lon':lon,'lat':lat,'osmId':f'{kind}/{oid}',
            'sourceUrl':f'https://www.openstreetmap.org/{kind}/{oid}',
            'address':', '.join(filter(None,[t.get('addr:city'),t.get('addr:street'),t.get('addr:housenumber')])),
            'website':t.get('website') or t.get('contact:website'), 'tags':t})
    def node(self,n):
        t=dict(n.tags)
        if n.location.valid():
            if t.get('place') in ['city','town','village','hamlet','isolated_dwelling'] and t.get('name'):
                self.places[norm(t['name'])].append({'lon':n.lon,'lat':n.lat,'osmId':f'node/{n.id}','place':t['place'],'name':t['name']})
            self.hospital('node',n.id,t,n.lon,n.lat)
        access=next((t[k] for k in ['motorcar','motor_vehicle','vehicle','access'] if t.get(k)),None)
        if access in ['no','private'] or t.get('barrier') in ['bollard','block','stile','kissing_gate','cycle_barrier']:
            self.barriers.add(n.id)
    def relation(self,r):
        if r.tags.get('type')=='restriction':self.restrictions+=1
    def way(self,w):
        t=dict(w.tags)
        if t.get('amenity')=='hospital':
            points=[(n.lon,n.lat) for n in w.nodes if n.location.valid()]
            if len(points)>=4 and points[0]==points[-1]:
                polygon=Polygon(points)
                if polygon.is_valid:
                    p=polygon.representative_point();self.hospital('way',w.id,t,p.x,p.y)
        h=t.get('highway')
        if h not in SPEEDS:return
        access=next((t[k] for k in ['motorcar','motor_vehicle','vehicle','access'] if t.get(k)),None)
        if access in ['no','private','agricultural','forestry','delivery','customers'] or t.get('area')=='yes' or t.get('impassable')=='yes':
            self.excluded['access_or_area']+=1;return
        if any(k.endswith(':conditional') for k in t):self.excluded['conditional']+=1;return
        refs=[(n.ref,(n.lon,n.lat)) for n in w.nodes if n.location.valid()]
        if len(refs)<2:return
        speed=SPEEDS[h];limit=t.get('maxspeed','')
        if re.fullmatch(r'\d+(\.\d+)?',limit):speed=min(speed,float(limit))
        elif limit in ['RU:urban','RU:living_street','RU:motorway']:
            speed=min(speed,{'RU:urban':60,'RU:living_street':20,'RU:motorway':110}[limit])
        speed=min(speed,SURFACES.get(t.get('surface'),speed))
        if speed<=0:return
        oneway=t.get('oneway','yes' if t.get('junction')=='roundabout' or h=='motorway' else 'no')
        if oneway in ['reversible','alternating']:
            self.excluded['reversible']+=1;return
        if oneway=='-1':refs.reverse()
        ids=[n for n,p in refs]
        self.coords.update(refs);self.count.update(set(ids))
        self.ways.append({'id':str(w.id),'ids':ids,'speed':speed,'directed':oneway in ['yes','1','true','-1'],
                         'name':t.get('name') or t.get('ref') or h,'class':h})

def build(rid):
    started=time.monotonic()
    existing=OUT/(rid+'-summary.json')
    if existing.exists():return json.loads(existing.read_text())
    pbf=RAW/(rid+'.osm.pbf');csv_path=RAW/(rid+'-settlements-2021.csv')
    if not pbf.exists() or not csv_path.exists():raise ValueError('Missing primary inputs: '+rid)
    names={r['id']:r['name'] for r in json.loads((ROOT/'data/regions.json').read_text())}
    with csv_path.open(encoding='utf-8-sig') as f:
        all_rows=list(csv.DictReader(f,delimiter=';'))
        source_population=sum(max(0,int(r['population'])) for r in all_rows if r['population'].lstrip('-').isdigit())
        rows=[r for r in all_rows if r['population'].isdigit() and int(r['population'])>=10]
    h=Observations()
    # libosmium caches all coordinates first; untagged geometry vertices need
    # no Python callback. This substantially reduces the 30-region parse cost.
    h.apply_file(str(pbf),locations=True,filters=[osmium.filter.KeyFilter(
        'highway','place','amenity','barrier','access','motorcar','motor_vehicle','vehicle','type')])
    print(rid,'parsed',len(h.ways),'roads,',len(h.places),'place names,',len(h.hospitals),'hospital objects',flush=True)
    latitudes=[float(r['latitude']) for r in rows if r.get('latitude')]
    scale=np.array([111320*math.cos(math.radians(sum(latitudes)/len(latitudes))),111320])
    keep={n for n,c in h.count.items() if c>1}
    for w in h.ways:keep.update([w['ids'][0],w['ids'][-1]])
    candidates=sorted({n for w in h.ways if w['class'] not in ['motorway','motorway_link','trunk','trunk_link'] for n in w['ids'] if n not in h.barriers})
    tree=cKDTree(np.array([h.coords[n] for n in candidates])*scale)
    def snap(lon,lat):
        _,indices=tree.query(np.array([lon,lat])*scale,k=min(8,len(candidates)))
        metres,n=min((km((lon,lat),h.coords[candidates[int(i)]])*1000,candidates[int(i)]) for i in np.atleast_1d(indices))
        if metres<=500:keep.add(n);return n,round(float(metres),2)
        return None,round(float(metres),2)
    settlements=[];coordinate_audit=[]
    for row in rows:
        s={'id':'s-'+row['oktmo'],'name':row['object_name'],'nodeId':None,
           'population':int(row['population']),'municipality':row['mun_upper'],
           'provenance':'tochno-allsettlements-2021; OKTMO '+row['oktmo'],
           'populationYear':2021,'populationSourceUrl':PROVENANCE}
        try:lon,lat=float(row['longitude']),float(row['latitude'])
        except (ValueError,TypeError):settlements.append(s);continue
        if not(-180<=lon<=180 and -85<=lat<=85):settlements.append(s);continue
        original=(lon,lat)
        matches=sorted(((km(original,(p['lon'],p['lat'])),p) for p in h.places.get(norm(s['name']),[])),key=lambda p:p[0])
        # Preserve names and census weights; only correct an unambiguous local namesake.
        if matches and matches[0][0]<=15 and (len(matches)==1 or matches[1][0]>max(matches[0][0]*2,3)):
            place=matches[0][1];lon,lat=place['lon'],place['lat']
            s['provenance']+='; coordinate '+place['osmId']
            coordinate_audit.append({'id':s['id'],'name':s['name'],'originalLon':original[0],'originalLat':original[1],
                'lon':lon,'lat':lat,'osmId':place['osmId'],'shiftKm':matches[0][0]})
        n,metres=snap(lon,lat)
        s.update(lat=lat,lon=lon,snapMeters=metres,_snap=n)
        if n:s['nodeId']=s['id']
        settlements.append(s)
    facilities=[];excluded_facilities=[]
    # Avoid counting a named point and the corresponding campus polygon twice.
    for f in sorted(h.hospitals,key=lambda f:(not f['osmId'].startswith('way/'),f['id'])):
        if any(norm(f['name'])==norm(g['name']) and km((f['lon'],f['lat']),(g['lon'],g['lat']))<.3 for g in facilities):continue
        n,metres=snap(f['lon'],f['lat'])
        if n is None:
            excluded_facilities.append({**f,'reason':'No eligible road node within 500 m','snapMeters':metres});continue
        facilities.append({'id':f['id'],'name':f['name'],'nodeId':f['id'],
            'profile':'mapped-hospital','periods':['day'],'verified':True,
            'provenance':'Observed named amenity=hospital in archived OSM PBF; source existence and coordinates checked, clinical admission not asserted',
            'facilityType':'hospital','lat':f['lat'],'lon':f['lon'],
            'officialAddress':f['address'],'sourceUrl':f['sourceUrl'],'osmId':f['osmId'],'_snap':n})
    if not facilities:raise ValueError('No routable observed hospitals: '+rid)
    edges=[];used=set()
    for w in h.ways:
        path=[]
        for n in w['ids']:
            path.append(n)
            if n in keep and len(path)>1:
                start,end=path[0],path[-1]
                if start!=end and not any(p in h.barriers for p in path):
                    geometry=[[round(x,7),round(y,7)] for x,y in (h.coords[p] for p in path)]
                    length=sum(km(a,b) for a,b in zip(geometry,geometry[1:]))
                    if length>0:
                        edges.append({'id':'w'+w['id']+'-'+str(start)+'-'+str(end),
                            'from':'n'+str(start),'to':'n'+str(end),'minutes':round(length/w['speed']*60,7),
                            'directed':w['directed'],'allowed':True,
                            'speedSource':f"OSRM class-based model; capped by maxspeed/surface; {w['speed']} km/h",
                            'name':w['name'],'osmWayId':w['id'],'highway':w['class'],'lengthKm':round(length,5),'kind':'road','geometry':geometry})
                        used.update([start,end])
                path=[n]
    nodes=[{'id':'n'+str(n),'x':round(h.coords[n][0],7),'y':round(h.coords[n][1],7)} for n in sorted(used)]
    retained_facilities=[]
    for item in [*settlements,*facilities]:
        n=item.pop('_snap',None)
        if n not in used:
            item['nodeId']=None
            continue
        nodes.append({'id':item['nodeId'],'x':item['lon'],'y':item['lat']})
        p=h.coords[n];length=km((item['lon'],item['lat']),p)
        edges.append({'id':'access-'+item['id'],'from':item['nodeId'],'to':'n'+str(n),
            'minutes':max(.001,round(length/5*60,7)),'directed':False,'allowed':True,
            'speedSource':'Geometric connector to actual road node; 5 km/h, max 500 m',
            'name':'Подъезд к дорожной сети','lengthKm':round(length,5),'kind':'access',
            'geometry':[[item['lon'],item['lat']],list(p)]})
    facilities=[f for f in facilities if f['nodeId']]
    if not facilities:raise ValueError('All hospitals snapped to rejected ways: '+rid)
    source=json.loads(pbf.with_suffix('.pbf.source.json').read_text())
    # Real regional network, with directions; no inferred cross-country chords.
    metadata={'populationYear':2021,'roadSnapshot':source['lastModified'],'preparedAt':'2026-11-10',
        'coordinateSystem':'WGS84','rawRoadWays':len(h.ways),'rawRoadNodes':len(h.coords),
        'compressedNodes':len(nodes),'compressedEdges':len(edges),'snapLimitMeters':500,
        'connectorSpeedKmh':5,'missingSnaps':sum(s['nodeId'] is None for s in settlements),
        'coordinateMatches':len(coordinate_audit),'sourceSha256':source['sha256'],
        'ignoredTurnRestrictionRelations':h.restrictions,'excludedRoadWays':dict(h.excluded),
        'sourceType':'observed_census_and_osm_with_modeled_travel_times',
        'facilityEvidence':'osm-hospital-tags','nightAvailabilityVerified':False,
        'hospitalSelectionRule':'Named general hospitals; exclude polyclinics, dental, pediatric, psychiatric, infectious, oncology, maternity, rehabilitation and sanatorium facilities; deduplicate nearby identical campus names',
        'regionalScopeVerified':False,
        'mapBounds':[[min(s['lat'] for s in settlements if 'lat' in s),min(s['lon'] for s in settlements if 'lon' in s)],
                     [max(s['lat'] for s in settlements if 'lat' in s),max(s['lon'] for s in settlements if 'lon' in s)]]}
    d={'id':rid+'-observed-v1','version':'observed-osm-2026-11-10-v1','title':names[rid]+' · реальные геоданные',
        'regionId':rid,'synthetic':False,'date':'2026-11-10','profile':'mapped-hospital',
        'profileLabel':'Автомобильная доступность больничных площадок OSM','mode':'car','trip':'to-facility',
        'sourceIds':['tochno-allsettlements-2021','osm-expanded-'+rid,'osrm-speed-model'],
        'license':'Population: CC BY, Tochno/Rosstat; roads and facilities: ODbL 1.0, © OpenStreetMap contributors',
        'expectedPopulation':source_population,
        'coverageLabel':'Поселения ВПН-2021 с населением от 10 человек; больничные объекты OpenStreetMap',
        'assumptions':['Население — ВПН-2021; дороги и больницы — сохранённая региональная выгрузка OSM ноября 2026 года.',
            'Больничные площадки отобраны по именованным объектам amenity=hospital. Подтверждение означает проверку объекта в исходной выгрузке OSM; профиль лечения и приём пациентов не заявляются.',
            'Сравниваются результаты одного профиля mapped-hospital. Три прежних пилота используют отдельный профиль учреждений, подтверждённых официальными реестрами.',
            'Координаты однозначно сопоставленных по названию местных поселений уточнены по OSM place. Оригинальные координаты и основания исправлений сохранены в выгрузке.',
            'Время вычислено по направленному графу дорог с модельными скоростями. Учитываются явные запреты доступа, одностороннее движение, maxspeed и покрытие.',
            'Геометрический подъезд к доступной дороге ограничен 500 м со скоростью 5 км/ч.',
            'Пробки, ожидание, вместимость, поворотные ограничения, переправы и дороги за границами выгрузки в расчёт не входят.',
            'Пункты без привязки или пути исключены из расчёта с отражением фактического покрытия населения.'],
        'metadata':metadata,'nodes':nodes,'edges':edges,'settlements':settlements,'facilities':facilities}
    unique_segment_ids(d)
    snap_audit=repair_snaps(d)
    nodes,edges=d['nodes'],d['edges']
    dump(DOWNLOADS/(rid+'-road-snap-audit.json'),snap_audit)
    # Independent sparse shortest paths; parallel road arcs take MIN, never SUM.
    ids={n['id']:i for i,n in enumerate(nodes)};arcs={}
    for e in edges:
        a,b=ids[e['from']],ids[e['to']]
        arcs[a,b]=min(arcs.get((a,b),math.inf),e['minutes'])
        if not e['directed']:arcs[b,a]=min(arcs.get((b,a),math.inf),e['minutes'])
    matrix=csr_matrix((list(arcs.values()),([a for a,b in arcs],[b for a,b in arcs])),shape=(len(nodes),len(nodes)))
    dist=dijkstra(matrix.T,indices=[ids[f['nodeId']] for f in facilities],min_only=True)
    numerator=0;population=0;included=0;point_rows=[]
    for s in settlements:
        t=float(dist[ids[s['nodeId']]]) if s['nodeId'] is not None else math.inf
        reachable=math.isfinite(t)
        if reachable:
            numerator+=s['population']*2**(-t/60);population+=s['population'];included+=1
        point_rows.append({'id':s['id'],'name':s['name'],'municipality':s['municipality'],
            'population':s['population'],'minutes':t if reachable else None,
            'score':2**(-t/60) if reachable else None,
            'status':'reachable' if reachable else 'missing_node' if s['nodeId'] is None else 'route_unverified'})
    check={'methodologyVersion':'2.0.0','tau':60,'period':'day','profile':d['profile'],
           'index':100*numerator/population if population else None,
           'includedPopulation':population,'sourcePopulation':d['expectedPopulation'],
           'populationCoverage':population/d['expectedPopulation'],
           'includedSettlements':included,'reachableSettlements':included,
           'method':'Independent SciPy directed sparse Dijkstra; parallel arcs minimized; unverified routes excluded'}
    dump(ROOT/('data/derived/'+rid+'-independent-check.json'),check)
    dump(DOWNLOADS/(rid+'-independent-check.json'),check)
    for folder in [ROOT/'data/derived',DOWNLOADS]:
        with (folder/(rid+'-calculation.csv')).open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=list(point_rows[0]),delimiter=';');writer.writeheader();writer.writerows(point_rows)
    dump(DOWNLOADS/(rid+'-facilities.json'),facilities)
    dump(RAW/(rid+'-hospital-evidence.json'),h.hospitals)
    dump(RAW/(rid+'-excluded-hospitals.json'),excluded_facilities)
    dump(DOWNLOADS/(rid+'-coordinate-audit.json'),coordinate_audit)
    # Filtered observed census rows remain downloadable independently of graph files.
    with (DOWNLOADS/(rid+'-settlements-2021.csv')).open('w',encoding='utf-8-sig',newline='') as f:
        fields=['id','name','municipality','population','populationYear','lat','lon','provenance']
        writer=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore',delimiter=';');writer.writeheader();writer.writerows(settlements)
    with gzip.open(OUT/(rid+'.json.gz'),'wt',encoding='utf-8',compresslevel=5) as f:
        json.dump(d,f,ensure_ascii=False,separators=(',',':'))
    summary={k:d[k] for k in ['id','regionId','synthetic','title','profile','profileLabel','date','version','sourceIds','license','expectedPopulation','coverageLabel','assumptions','metadata','facilities']}
    summary.update(settlementCount=len(settlements),facilityCount=len(facilities),nodes=len(nodes),edges=len(edges),
                   independentCheck=check,baselinePoints=point_rows)
    dump(existing,summary)
    print(rid,'built',len(nodes),'nodes,',len(edges),'edges,',len(settlements),'settlements,',len(facilities),'hospitals;',
          'index',round(check['index'],6),'coverage',round(check['populationCoverage']*100,2),'in',round(time.monotonic()-started),'s',flush=True)
    return summary

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--region');parser.add_argument('--wait',action='store_true');args=parser.parse_args()
    selection=json.loads((RAW/'selection.json').read_text())
    selected=[args.region] if args.region else list(selection)
    for rid in selected:
        while args.wait and not ((RAW/(rid+'.osm.pbf')).exists() and (RAW/(rid+'-settlements-2021.csv')).exists()):time.sleep(10)
        build(rid)
    catalogue={p.name.removesuffix('-summary.json'):json.loads(p.read_text()) for p in OUT.glob('*-summary.json')}
    dump(OUT/'catalogue.json',catalogue)
    print('Catalogue:',len(catalogue),'observed regional datasets.',flush=True)
