#!/usr/bin/env python3
"""Build reproducible medical map catalogs for every real and synthetic region.

Default mode uses ONLY the files shipped with the project (already observed OSM
hospitals for 33 real regions and a Kaliningrad OSM medical snapshot).
--refresh-osm retrieves named amenity=hospital/clinic objects from OSM-derived
2° tiles at https://github.com/01shane89-jpg/AXIOM-APSAP . It NEVER converts
unverified OSM points into officially licensed medical establishments.

Do not silently treat private clinics as free publicly available care.
"""
from __future__ import annotations
import argparse
import brotli
import concurrent.futures
import hashlib
import json
import math
import re
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/processed'
OUTPUT = ROOT / 'public/data/medical-catalogs'
CACHE = ROOT / 'data/medical-osm-cache'
BOUNDARIES = ROOT / 'data/processed/geometries.json'
TILE_URL = 'https://raw.githubusercontent.com/01shane89-jpg/AXIOM-APSAP/main/data/medfac/t/{tile}.json'
TYPES = {'public_hospital', 'public_adult_polyclinic', 'public_children_polyclinic', 'private_paid'}
EXCLUDE = re.compile(r'роддом|родильн|перинатальн|санатори|аптек|стоматолог|амбулатори|фельдшер|\bфап\b|диспансер|ветеринар|психиатр|нарколог|поликлиника\s+уфсб|военн.*госпитал', re.I)
POLY = re.compile(r'поликлиник|поликлинник|амбулаторн.*отделени', re.I)
CHILD = re.compile(r'детск|педиатр', re.I)
PUBLIC = re.compile(r'гбуз|гауз|мбуз|гуз|областн|городск.*поликлиник|районн.*поликлиник|\bцрб\b|муниципальн', re.I)
PRIVATE = re.compile(r'\bооо\b|\bип\b|\bао\b|медэксперт|эдкар|арс медика|класс клиник', re.I)


def point_in_ring(lon, lat, ring):
    inside = False
    for i in range(len(ring)):
        x1, y1 = ring[i - 1]
        x2, y2 = ring[i]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def contains(feature, lat, lon):
    geometry = feature['geometry']
    multi = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    for polygon in multi:
        if polygon and point_in_ring(lon, lat, polygon[0]) and not any(point_in_ring(lon, lat, hole) for hole in polygon[1:]):
            return True
    return False


def tile_ids(feature):
    geometry = feature['geometry']
    multi = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    coords = [xy for polygon in multi for ring in polygon for xy in ring]
    minx, miny = min(p[0] for p in coords), min(p[1] for p in coords)
    maxx, maxy = max(p[0] for p in coords), max(p[1] for p in coords)
    # Boundaries are historical boundaries; select tiles intersecting their bounding box,
    # then filter objects by actual polygon to avoid cross-border contamination.
    for lat in range(math.floor(miny / 2) * 2, math.floor(maxy / 2) * 2 + 1, 2):
        for lon in range(math.floor(minx / 2) * 2, math.floor(maxx / 2) * 2 + 1, 2):
            yield f'{lat}_{lon}'


def raw_tile(tile):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f'{tile}.json'
    if f.exists():
        try: return json.loads(f.read_text('utf-8'))
        except (ValueError, OSError): pass
    try:
        req = urllib.request.Request(TILE_URL.format(tile=tile), headers={'User-Agent': 'MedSvyaz24 academic geo-audit (OSM ODbL); local batch importer'})
        with urllib.request.urlopen(req, timeout=22) as response:
            payload = response.read()
        rows = json.loads(payload)
        if not isinstance(rows, list): return []
        f.write_bytes(payload)
        return rows
    except (OSError, ValueError) as error:
        # A missing tile is not proof that a region has zero facilities.
        return None


def osm_type(name, tags):
    name = (name or '').strip()
    typ = f"{tags.get('amenity','')} {tags.get('healthcare','')}".lower()
    if EXCLUDE.search(name): return None
    owner_type = str(tags.get('operator:type') or '').lower()
    private = owner_type == 'private' or bool(PRIVATE.search(f"{name} {tags.get('operator','')}"))
    public = owner_type in ('public', 'government') or bool(PUBLIC.search(name))
    if POLY.search(name):
        if private and not public:
            # Keep fee=no/unknown private polyclinics out of the free-care index.
            return 'private_paid' if tags.get('fee') == 'yes' or bool(PRIVATE.search(name)) else None
        return 'public_children_polyclinic' if CHILD.search(name) else 'public_adult_polyclinic'
    if 'hospital' in typ:
        # A hospital tag does not prove a staffed, 24-hour inpatient facility.
        return 'public_hospital' if public or (not private and re.search(r'больниц|hospital', name, re.I)) else None
    if 'clinic' in typ or 'doctors' in typ:
        if private and not public and tags.get('fee') != 'no': return 'private_paid'
        if public: return 'public_children_polyclinic' if CHILD.search(name) else 'public_adult_polyclinic'
    return None


def classify_osm(row):
    # OSM-derived source row: [osmId, lat, lon, isoCountry, tagDictionary]
    try: osm_id, lat, lon, country, tags = row
    except (TypeError, ValueError): return None
    if country != 'ru' or not isinstance(tags, dict): return None
    name = str(tags.get('name') or '').strip()
    if not name or name.lower() in ('больница', 'поликлиника', 'клиника', 'medical', 'hospital'):
        # Generic names still preserve category for review, but no official verification.
        if name.lower() not in ('больница','поликлиника'): return None
    medical_type = osm_type(name, tags)
    if not medical_type: return None
    lat,lon=float(lat),float(lon)
    if not -90 <= lat <= 90 or not -180 <= lon <= 180: return None
    address = ', '.join(str(tags.get(k)) for k in ('addr:city','addr:street','addr:housenumber') if tags.get(k))
    osm_link = ('https://www.openstreetmap.org/' + ('node/' if str(osm_id).startswith('n') else 'way/' if str(osm_id).startswith('w') else 'relation/') + str(osm_id)[1:])
    ownership = 'private' if medical_type == 'private_paid' else 'public' if PUBLIC.search(name) else 'unknown'
    return {'id': f'osm-{osm_id}', 'name': name, 'type':medical_type, 'medicalType':
            'hospital' if medical_type=='public_hospital' else 'children_polyclinic' if medical_type=='public_children_polyclinic' else 'adult_polyclinic' if medical_type=='public_adult_polyclinic' else 'other_clinic',
            'lat':round(lat,7),'lon':round(lon,7),'address':address,
            'ownership':ownership,'feeStatus':'unknown','sourceUrl':osm_link,
            'officiallyVerified':False,'classificationReason':'OSM-метка и название; профиль и статус ОМС не проверены',
            'sourceClass':'osm-snapshot','inpatientVerified':False}


def kilometers(a, b):
    phi=math.pi/180
    x=(a['lon']-b['lon'])*math.cos((a['lat']+b['lat'])*phi/2)*111.195
    return math.hypot(x,(a['lat']-b['lat'])*111.195)


def clean_entries(entries):
    used=set(); selected=[]
    for rec in sorted(entries,key=lambda x:(not x.get('officiallyVerified',False),x['id'])):
        if rec['id'] in used: continue
        if any(kilometers(rec,p)<.065 and rec['type']==p['type'] and
            (rec['name'].lower()==p['name'].lower() or rec['name'].lower() in p['name'].lower() or p['name'].lower() in rec['name'].lower()) for p in selected):
            continue
        selected.append(rec);used.add(rec['id'])
    return sorted(selected, key=lambda x:(x['type'],x['name'],x['id']))


def hospital_entry(f):
    if f.get('lat') is None or f.get('lon') is None: return None
    return {'id':f['id'], 'name':f['name'], 'type':'public_hospital','medicalType':'hospital',
            'lat':f['lat'],'lon':f['lon'],'address':f.get('officialAddress',''),
            'ownership':'public' if f['profile']=='selected-public-hospital' else 'unknown',
            'feeStatus':'unknown','sourceUrl':f.get('sourceUrl',''),
            'officiallyVerified': f['profile']=='selected-public-hospital',
            'classificationReason': f.get('provenance',''),
            'sourceClass':'official-location' if f['profile']=='selected-public-hospital' else 'osm-hospital',
            'inpatientVerified':f['profile']=='selected-public-hospital', 'roadNodeId':f['nodeId'], 'snapDistanceMeters':0}


def synthetic_catalog(id, data):
    # Synthetic points are *not real healthcare providers*. Use a deterministic PRNG
    # per region and a plausible distribution of hospital + outpatient sites.
    import random
    rng = random.Random(int.from_bytes(hashlib.sha256(id.encode()).digest()[:8], 'big'))
    existing=[]
    for f in data['facilities']:
        if f.get('lat') is None or f.get('lon') is None: continue
        existing.append({'id':f['id'],'name':f['name'].replace('Условный центр','Модельная больница'),
          'type':'public_hospital','medicalType':'hospital','lat':f['lat'],'lon':f['lon'],
          'address':'','ownership':'synthetic','feeStatus':'free-tagged',
          'officiallyVerified':False,'classificationReason':'Модельное распределение, не фактическое учреждение',
          'sourceClass':'synthetic','inpatientVerified':False})
    settlements=[s for s in data['settlements'] if s.get('lat') and s.get('lon') and (s.get('population') or 0)>=200]
    settlements.sort(key=lambda s:s.get('population') or 0, reverse=True)
    max_n=min(20,max(2,len(settlements)//5))
    chosen=settlements[:max_n]
    extras=[]
    for rank,s in enumerate(chosen):
        pop=s.get('population') or 0
        types=['public_adult_polyclinic']
        if pop>=25000 and rank%3==0:types.append('public_children_polyclinic')
        if pop>=70000 and rng.random()<.35:types.append('private_paid')
        for typ in types:
            marker={'public_adult_polyclinic':'Условная взрослая поликлиника', 'public_children_polyclinic':'Условная детская поликлиника','private_paid':'Условная частная клиника'}[typ]
            extras.append({'id':f'model-{typ}-{s["id"]}','name':marker+' · '+s['name'],
              'type':typ,'medicalType':'children_polyclinic' if typ=='public_children_polyclinic' else 'adult_polyclinic' if typ=='public_adult_polyclinic' else 'other_clinic',
              'lat':s['lat'],'lon':s['lon'],'address':'','ownership':'synthetic','feeStatus':'unknown','roadNodeId':s['nodeId'],'snapDistanceMeters':0,
              'officiallyVerified':False,'sourceClass':'synthetic','inpatientVerified':False,
              'classificationReason':'Детерминированная модель по размерам населённых пунктов; не является реальным медучреждением'})
    return existing + extras


def real_dataset_paths():
    paths=list(DATA.glob('*-pilot.json.br'))+list((DATA/'expanded').glob('*.json.br'))
    return {p.name.replace('-pilot.json.br','').replace('.json.br',''):p for p in paths}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--refresh-osm',action='store_true',help='Download OSM medical tiles for all real regions (requires internet)')
    ap.add_argument('--threads',type=int,default=6)
    args=ap.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    datasets=real_dataset_paths()
    features={f['properties']['regionId']:f for f in json.loads(BOUNDARIES.read_text('utf-8'))['features']}
    tiles={tile for region in datasets if region in features for tile in tile_ids(features[region])}
    tile_data={}
    if args.refresh_osm:
        print('Загружаем медицинские объекты OSM, картографические фрагменты:', len(tiles),flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(12,args.threads))) as executor:
            tile_names=sorted(tiles)
            tile_data=dict(zip(tile_names,executor.map(raw_tile,tile_names)))
        failed=[tile for tile,rows in tile_data.items() if rows is None]
        if failed:print(f'WARNING: {len(failed)} OSM tiles unavailable. Cached records retained; coverage incomplete.',flush=True)
    else:
        tile_data={tile:json.loads((CACHE/f'{tile}.json').read_text('utf-8')) for tile in tiles if (CACHE/f'{tile}.json').exists()}
    snapshot = ROOT/'data/reference/kaliningrad-osm-medfac-snapshot.json'
    kg_existing = ROOT/'public/data/kaliningrad-medical-facilities.json'
    kg_rows=json.loads(kg_existing.read_text('utf-8'))['facilities'] if kg_existing.exists() else []
    totals=Counter()
    for region,path in sorted(datasets.items()):
        data=json.loads(brotli.decompress(path.read_bytes()))
        base=[v for f in data['facilities'] if (v:=hospital_entry(f)) is not None]
        gathered=[]
        feature=features.get(region)
        if feature:
            for tile in tile_ids(feature):
                for item in tile_data.get(tile) or []:
                    candidate=classify_osm(item)
                    if candidate and contains(feature,candidate['lat'],candidate['lon']):gathered.append(candidate)
        if region=='kaliningrad':
            for rec in kg_rows:
                if rec.get('type') in TYPES and not EXCLUDE.search(rec.get('name','')):
                    gathered.append({**rec,'officiallyVerified':bool(rec.get('officiallyVerified')),
                                     'inpatientVerified':False,'sourceClass':rec.get('sourceClass','osm-snapshot')})
        # Keep previously imported named OSM sites if a later fetch is partial.
        existing_file=OUTPUT/f'{region}.json'
        if existing_file.exists():
            try:
                earlier=json.loads(existing_file.read_text('utf-8'))['facilities']
                gathered.extend(f for f in earlier if f.get('sourceClass') not in ('official-location','osm-hospital','synthetic'))
            except (OSError,ValueError,KeyError):pass
        facilities=clean_entries(base+gathered)
        unsnapped=[f for f in facilities if not f.get('roadNodeId')]
        if unsnapped:
            # Only create a spatial index when there are actually NEW OSM clinic
            # or hospital entries to snap (large graphs can have >400k nodes).
            from scipy.spatial import cKDTree
            road_nodes=data['nodes']
            avg_lat=sum(n['y'] for n in road_nodes[:min(200,len(road_nodes))])/max(1,min(200,len(road_nodes)))
            scale=math.cos(math.radians(avg_lat))
            node_tree=cKDTree([(n['x']*scale,n['y']) for n in road_nodes])
            for f in unsnapped:
                distance, idx=node_tree.query((f['lon']*scale,f['lat']))
                metres=round(float(distance)*111195,1)
                f['snapDistanceMeters']=metres
                if metres<=450:f['roadNodeId']=road_nodes[int(idx)]['id']
            del road_nodes,node_tree
        del data
        counts=Counter(f['type'] for f in facilities)
        # Separate official admissions from OSM presence; not all recorded clinics are guaranteed free.
        entry={'regionId':region,'synthetic':False,'source':'Existing study hospital dataset + named OSM medical points (ODbL)',
             'sourceUrls':['https://www.openstreetmap.org/copyright',
             'https://github.com/01shane89-jpg/AXIOM-APSAP',
             'https://minzdrav.gov.ru/special/ministry/web-site/informatsionnye-sistemy-minzdrava-rossii/katalog-podsistem-egisz/federalnyy-reestr-meditsinskih-organizatsiy'],
             'completeness':'Частичный каталог; не полный перечень физических филиалов и лицензированных профилей',
             'ageAssignment':'Возрастные группы не входят в индекс',
             'mappingStatus':'osm-refreshed' if args.refresh_osm and any(tile_data.get(t) is not None for t in tile_ids(feature)) else 'archive-and-cache',
             'counts':dict(counts),'facilities':facilities}
        (OUTPUT/f'{region}.json').write_text(json.dumps(entry,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        totals.update(counts)
        print(f'{region:22} {len(facilities):4} sites, public-polyclinics={counts["public_adult_polyclinic"]+counts["public_children_polyclinic"]:3}',flush=True)
    syn=json.loads((DATA/'synthetic-regions.json').read_text('utf-8'))
    for region,d in sorted(syn.items()):
        if region in datasets:continue
        facilities=synthetic_catalog(region,d)
        counts=Counter(f['type'] for f in facilities)
        entry={'regionId':region,'synthetic':True,
          'source':'Синтетическая модель размещения медицинских учреждений около реальных координат выбранных населённых пунктов',
          'completeness':'Все объекты условные; не фактическая медицина и не подтверждённые данные',
          'mappingStatus':'synthetic-generated','counts':dict(counts),'facilities':facilities}
        (OUTPUT/f'{region}.json').write_text(json.dumps(entry,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Complete: {len(datasets)} real catalogs and {len(syn)-len(set(syn)&set(datasets))} synthetic catalogs; medical records by type: {dict(totals)}')

if __name__=='__main__':main()
