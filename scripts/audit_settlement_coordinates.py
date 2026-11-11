#!/usr/bin/env python3
"""Validate display/routing coordinates against actual named populated places.

No random jitter, municipality-centroid fallback, or change to census weights.
OSM is preferred for the three original graphs. GeoNames corroborates the
remaining synthetic samples. Every accepted replacement preserves its source.
"""
import csv,hashlib,io,json,math,re,zipfile
from collections import defaultdict
from pathlib import Path
import osmium
from shapely.geometry import shape,Point

ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'data/raw'

def norm(name):
    name=name.lower().replace('ё','е')
    name=re.sub(r'^(?:город|село|деревня|поселок городского типа|рабочий поселок|поселок|хутор|станица|аул|слобода|станция|населенный пункт)\s+','',name)
    name=re.sub(r'^(?:г\.|пгт\.?|рп\.?|д\.|с\.|п\.|пос\.?|х\.|ст-ца|сл\.|ст\.)\s*','',name)
    return re.sub(r'[^\w]','',name)

def km(a,b):
    x1,y1,x2,y2=map(math.radians,(*a,*b))
    z=math.sin((y2-y1)/2)**2+math.cos(y1)*math.cos(y2)*math.sin((x2-x1)/2)**2
    return 12742.0176*math.asin(min(1,math.sqrt(z)))

def dump(path,value):path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')

class Places(osmium.SimpleHandler):
    def __init__(self):super().__init__();self.points=defaultdict(list)
    def node(self,n):
        if n.tags.get('place') not in ['city','town','village','hamlet','isolated_dwelling']:return
        if not n.tags.get('name') or not n.location.valid():return
        self.points[norm(n.tags['name'])].append({'lon':n.lon,'lat':n.lat,
            'sourceUrl':f'https://www.openstreetmap.org/node/{n.id}','sourceId':'osm-place-coordinate-audit'})

def choose(name,lon,lat,candidates,limit=15):
    rows=sorted(((km((lon,lat),(p['lon'],p['lat'])),p) for p in candidates.get(norm(name),[])),key=lambda x:x[0])
    if not rows or rows[0][0]>limit:return None
    if len(rows)>1 and rows[1][0]<=max(rows[0][0]*2,3):return None
    return {**rows[0][1],'shiftKm':rows[0][0]}

def main():
    gazetteer=RAW/'expanded/geonames-RU.zip'
    by=defaultdict(list)
    with zipfile.ZipFile(gazetteer) as z:
        for line in io.TextIOWrapper(z.open('RU.txt'),encoding='utf-8'):
            row=line.rstrip('\n').split('\t')
            if row[6]!='P' or row[7] in ['PPLQ','PPLH','PPLW','PPLX']:continue
            point={'lon':float(row[5]),'lat':float(row[4]),'sourceUrl':'https://www.geonames.org/'+row[0]+'/',
                   'sourceId':'geonames-ru-coordinate-audit'}
            for name in set([row[1],*row[3].split(',')]):
                if name:by[norm(name)].append(point)
    # The same GeoNames feature may have several aliases with equal normalization.
    for key,points in by.items():by[key]=list({p['sourceUrl']:p for p in points}.values())
    summaries=[];all_audit=[]
    for rid,folder,pbf in [('kaliningrad','pilot','kaliningrad-261108.osm.pbf'),('ivanovo','ivanovo','roads.osm.pbf'),('pskov','pskov','roads.osm.pbf')]:
        places=Places();places.apply_file(str(RAW/folder/pbf),filters=[osmium.filter.KeyFilter('place')])
        d=json.loads((ROOT/('data/processed/'+rid+'-pilot.json')).read_text())
        census_path=RAW/folder/('kaliningrad_settlements_2021.csv' if rid=='kaliningrad' else 'settlements-2021.csv')
        with census_path.open(encoding='utf-8-sig') as f:
            originals={'s-'+r['oktmo']:r for r in csv.DictReader(f,delimiter=';')}
        overrides={}
        for s in d['settlements']:
            original=originals[s['id']]
            original_lon,original_lat=float(original['longitude']),float(original['latitude'])
            point=choose(s['name'],original_lon,original_lat,places.points)
            if point:
                overrides[s['id']]={**point,'name':s['name'],'originalLon':original_lon,'originalLat':original_lat}
        dump(RAW/folder/'coordinate-overrides.json',overrides)
        summaries.append({'regionId':rid,'points':len(d['settlements']),'matched':len(overrides),'source':'OpenStreetMap place nodes'})
        print(rid,'OSM coordinate matches',len(overrides),'/',len(d['settlements']),flush=True)
    samples=json.loads((RAW/'synthetic-samples.json').read_text())
    # Replace all 48 random Saint Petersburg points with real named towns and
    # settlements. These are disjoint census municipalities, not invented villages.
    petersburg=[];federal={};moscow_local_population=0;petersburg_local_population=0
    shapes={f['properties']['regionId']:shape(f['geometry']) for f in json.loads((ROOT/'data/processed/geometries.json').read_text())['features']}
    with zipfile.ZipFile(RAW/'expanded/census-2021.zip') as z:
        name=next(n for n in z.namelist() if n.endswith('.csv') and not n.startswith('__'))
        for r in csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig'),delimiter=';'):
            if r['region'] in ['Москва','Санкт-Петербург'] and r['object_level']=='Город федерального значения':
                federal[r['region']]={k:r[k] for k in ['oktmo','population','latitude','longitude']}
            if r['region']=='Москва' and r['object_level']=='Населенный пункт':
                moscow_local_population+=max(0,int(r['population']))
            if r['region']!='Санкт-Петербург' or r['object_level']!='Внутригородское муниципальное образование города федерального значения':continue
            if not (r['object_name'].startswith('г. ') or r['object_name'].startswith('поселок ')):continue
            petersburg_local_population+=max(0,int(r['population']))
            matches=[p for p in by.get(norm(r['object_name']),[]) if shapes['saint-petersburg'].buffer(.02).covers(Point(p['lon'],p['lat']))]
            if len(matches)!=1:continue
            point=matches[0]
            petersburg.append({'id':'s-'+r['oktmo'],'name':r['object_name'],'lat':point['lat'],'lon':point['lon'],
                'population':int(r['population']),'municipality':'Санкт-Петербург · город / поселок',
                'provenance':'tochno-allsettlements-2021; census municipality OKTMO '+r['oktmo']+'; coordinate '+point['sourceUrl'],
                'populationYear':2021,'populationSourceUrl':'https://tochno.st/datasets/allsettlements'})
    # A federal-city total overlaps its subordinate towns. Use the explicitly
    # derived residual for the urban core, never the full total alongside them.
    def urban_core(region,subtract,label):
        r=federal[region]
        return {'id':'s-urban-core-'+r['oktmo'],'name':label,'lat':float(r['latitude']),'lon':float(r['longitude']),
            'population':int(r['population'])-subtract,'municipality':region+' · основная городская территория',
            'populationYear':2021,'populationSourceUrl':'https://tochno.st/datasets/allsettlements',
            'provenance':'tochno-allsettlements-2021; derived non-overlapping urban-core weight: federal-city census total '+r['population']+' minus all subordinate town/settlement rows '+str(subtract)+'; coordinate from federal-city source row'}
    petersburg.append(urban_core('Санкт-Петербург',petersburg_local_population,'Санкт-Петербург · городская территория'))
    samples['moscow']['settlements'].append(urban_core('Москва',moscow_local_population,'Москва · городская территория'))
    samples['moscow']['settlements'].sort(key=lambda s:-s['population'])
    samples['moscow']['samplePopulation']=sum(s['population'] for s in samples['moscow']['settlements'])
    samples['moscow']['observationUnit']='Census settlement sample plus non-overlapping residual urban-core weight'
    if len(petersburg)<12:raise ValueError('Not enough real localities for Saint Petersburg: '+str(len(petersburg)))
    petersburg.sort(key=lambda s:-s['population'])
    samples['saint-petersburg']={'observedSettlements':True,'sourceSettlementCount':len(petersburg),
        'samplePopulation':sum(s['population'] for s in petersburg),'observationUnit':'Census municipalities of towns and settlements within Saint Petersburg',
        'settlements':petersburg}
    expanded=set(json.loads((RAW/'expanded/selection.json').read_text()))
    for rid,sample in samples.items():
        if rid in expanded:continue
        matches=0
        for s in sample['settlements']:
            point=choose(s['name'],s['lon'],s['lat'],by)
            if not point:continue
            if not shapes[rid].buffer(.05).covers(Point(point['lon'],point['lat'])):continue
            original=(s['lon'],s['lat'])
            s.update(lon=point['lon'],lat=point['lat'])
            if point['sourceUrl'] not in s['provenance']:s['provenance']+='; coordinate '+point['sourceUrl']
            matches+=1
            all_audit.append({'regionId':rid,'id':s['id'],'name':s['name'],'originalLon':original[0],
                'originalLat':original[1],'lon':s['lon'],'lat':s['lat'],'sourceUrl':point['sourceUrl'],'shiftKm':point['shiftKm']})
        sample['coordinateMatches']=matches
        summaries.append({'regionId':rid,'points':len(sample['settlements']),'matched':matches,'source':'GeoNames named populated places'})
    dump(ROOT/'data/processed/audited-synthetic-samples.json',samples)
    dump(ROOT/'data/derived/settlement-coordinate-audit.json',{'regions':summaries,'replacements':all_audit,
        'rule':'Exact normalized local name; nearest candidate within 15 km, no competing namesake within 3 km or twice the match distance; region geometry check',
        'gazetteerSource':'https://download.geonames.org/export/dump/RU.zip',
        'gazetteerSha256':hashlib.sha256(gazetteer.read_bytes()).hexdigest(),'license':'GeoNames CC BY 4.0; OSM ODbL 1.0'})
    dump(ROOT/'public/downloads/settlement-coordinate-audit.json',json.loads((ROOT/'data/derived/settlement-coordinate-audit.json').read_text()))
    print('Synthetic coordinates matched',len(all_audit),'Saint Petersburg real localities',len(petersburg),flush=True)

if __name__=='__main__':main()
