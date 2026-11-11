"""Select observed census inputs; generate explicitly artificial points only where unavailable."""
import csv,io,json,zipfile,random,hashlib,math,argparse
from pathlib import Path
from collections import defaultdict
from shapely.geometry import shape,Point
p=argparse.ArgumentParser();p.add_argument('archive');args=p.parse_args()
root=Path(__file__).resolve().parents[1];regions=json.loads((root/'data/regions.json').read_text());geo={f['properties']['regionId']:shape(f['geometry']) for f in json.loads((root/'data/processed/geometries.json').read_text())['features']}
by=defaultdict(list)
with zipfile.ZipFile(args.archive) as z:
 name=next(n for n in z.namelist() if n.endswith('.csv') and not n.startswith('__'))
 for r in csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig'),delimiter=';'):
  if r['object_level']!='Населенный пункт':continue
  try:lat,lon,pop=float(r['latitude']),float(r['longitude']),int(r['population'])
  except ValueError:continue
  if not(-90<=lat<=90 and -180<=lon<=180) or pop<10:continue
  by[r['region']].append({'id':'s-'+r['oktmo'],'name':r['object_name'],'lat':lat,'lon':lon,'population':pop,'municipality':r['mun_upper'],'provenance':'tochno-allsettlements-2021; OKTMO '+r['oktmo']})
calibration=[s['population'] for s in by['Калининградская область'] if 20<=s['population']<=20000]
rename={'Республика Адыгея (Адыгея)':'Республика Адыгея','Республика Татарстан (Татарстан)':'Республика Татарстан','Чувашская Республика — Чувашия':'Чувашская Республика','Кемеровская область — Кузбасс':'Кемеровская область'}
out={}
for r in regions:
 if r['id'] in ['kaliningrad','ivanovo','pskov','donetsk','luhansk','kherson','zaporizhzhia']:continue
 rows=sorted(by[rename.get(r['name'],r['name'])],key=lambda s:(-s['population'],s['id']));rng=random.Random(int(hashlib.sha256(r['id'].encode()).hexdigest()[:12],16));observed=len(rows)>=12
 if observed:
  selected=rows[:12];rest=rows[12:];rng.shuffle(rest)
  # Spatially dispersed sample: farthest from existing points; preserve original census weights.
  candidates=rest[:2500]
  while len(selected)<min(60,len(rows)) and candidates:
   def distance(a,b):return ((a['lon']-b['lon'])*math.cos(math.radians(a['lat'])))**2+(a['lat']-b['lat'])**2
   idx=max(range(len(candidates)),key=lambda i:min(distance(candidates[i],s) for s in selected));selected.append(candidates.pop(idx))
 else:
  g=geo[r['id']];minx,miny,maxx,maxy=g.bounds;selected=[]
  while len(selected)<48:
   lon,lat=rng.uniform(minx,maxx),rng.uniform(miny,maxy)
   if not g.contains(Point(lon,lat)):continue
   i=len(selected);selected.append({'id':f's-model-{i}','name':f'Условное поселение {i+1:02}','lat':lat,'lon':lon,'population':rng.choice(calibration),'municipality':'Модельная зона '+str(1+i%4),'provenance':'Fully synthetic position and weight; population distribution sampled from Kaliningrad census 2021; no claim about regional demography'})
  selected.sort(key=lambda s:-s['population'])
 out[r['id']]={'observedSettlements':observed,'sourceSettlementCount':len(rows),'samplePopulation':sum(s['population'] for s in selected),'settlements':selected}
(root/'data/raw/synthetic-samples.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
print('Prepared',len(out),'samples, observed input subsets:',sum(d['observedSettlements'] for d in out.values()))
