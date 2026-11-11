#!/usr/bin/env python3
"""Reproducibly prepare historical ADM1 polygons from bundled geoBoundaries GeoJSON.
No network calls; uses geopandas-free shapely and bundled source. ODbL attribution required.
"""
import csv
import json
from pathlib import Path
from shutil import copyfile
from shapely.geometry import shape, mapping

ROOT=Path(__file__).resolve().parents[1]
# Explicit crosswalk reviewed against the region names in regions.json;
# RU-* codes here are geoBoundaries shapeISO identifiers (not official OKATO).
ISO_TO_ID = dict(item.split(':') for item in '''
RU-ALT:altai-krai RU-MO:mordovia RU-TUL:tula RU-KGN:kurgan RU-IN:ingushetia
RU-KHM:khanty-mansi RU-KIR:kirov RU-KO:komi RU-KOS:kostroma RU-KYA:krasnoyarsk
RU-ZAB:zabaykalsky RU-SVE:sverdlovsk RU-VGG:volgograd RU-IRK:irkutsk RU-PER:perm
RU-PSK:pskov RU-ROS:rostov RU-RYA:ryazan RU-AD:adygea RU-SAM:samara
RU-KK:khakassia RU-TAM:tambov RU-TA:tatarstan RU-TOM:tomsk RU-NIZ:nizhny-novgorod
RU-KR:karelia RU-ARK:arkhangelsk RU-AST:astrakhan RU-BEL:belgorod RU-BRY:bryansk
RU-BU:buryatia RU-CE:chechnya RU-CHE:chelyabinsk RU-CU:chuvashia RU-TYU:tyumen
RU-SE:north-ossetia-alania RU-PNZ:penza RU-AMU:amur RU-KB:kabardino-balkaria RU-KDA:krasnodar
RU-KRS:kursk RU-LEN:leningrad RU-ME:mari-el RU-MOW:moscow RU-MOS:moscow-oblast
RU-MUR:murmansk RU-NEN:nenets RU-NGR:novgorod RU-NVS:novosibirsk RU-OMS:omsk
RU-ORL:oryol RU-SPE:saint-petersburg RU-SAK:sakhalin RU-SA:sakha RU-SAR:saratov
RU-SMO:smolensk RU-STA:stavropol RU-TY:tuva RU-TVE:tver RU-UD:udmurtia
RU-KLU:kaluga RU-LIP:lipetsk RU-MAG:magadan RU-ULY:ulyanovsk RU-VLA:vladimir
RU-VLG:vologda RU-YAR:yaroslavl RU-VOR:voronezh RU-YAN:yamalo-nenets RU-AL:altai-republic
RU-IVA:ivanovo RU-YEV:jewish-autonomous RU-KL:kalmykia RU-KAM:kamchatka RU-KC:karachay-cherkessia
RU-KEM:kemerovo RU-KHA:khabarovsk RU-CHU:chukotka RU-DA:dagestan RU-KGD:kaliningrad
RU-ORE:orenburg RU-PRI:primorye RU-BA:bashkortostan
'''.split())
regions=json.loads((ROOT/'data/regions.json').read_text(encoding='utf8'))
source=json.loads((ROOT/'data/raw/russia-adm1.geojson').read_text(encoding='utf8'))
# Same upstream revision and year; retain original UA source codes as provenance.
extra=json.loads((ROOT/'data/raw/crimea-adm1.geojson').read_text(encoding='utf8'))
ISO_TO_ID.update({'UA-43':'crimea','UA-40':'sevastopol'})
source['features'].extend(extra['features'])
# Four additional historical administrative outlines from the same UKR release.
additional=json.loads((ROOT/'data/raw/additional-adm1.geojson').read_text(encoding='utf8'))
ISO_TO_ID.update({'UA-14':'donetsk','UA-09':'luhansk','UA-65':'kherson','UA-23':'zaporizhzhia'})
source['features'].extend(additional['features'])
byid={r['id']:r for r in regions}
features=[]
rows=[]
matched=set()
for original in source['features']:
    props=original['properties']; code=props['shapeISO']
    if code not in ISO_TO_ID: raise ValueError('Нет соответствия '+code)
    region_id=ISO_TO_ID[code]
    if region_id in matched:raise ValueError('Дублируется '+region_id)
    matched.add(region_id)
    region=byid[region_id]
    source_id=('geoboundaries-crimea-2017' if code in {'UA-43','UA-40'} else 'geoboundaries-additional-2017') if code.startswith('UA-') else 'geoboundaries-2017'
    region['isoCode']=code  # as named in source, not an OKATO code
    geom=shape(original['geometry'])
    simplified=geom.simplify(0.035,preserve_topology=True)
    if not simplified.is_valid or simplified.is_empty:raise ValueError('Invalid '+code)
    # Reference point guaranteed inside polygon for display; not a city's coordinate.
    point=geom.representative_point()
    features.append({'type':'Feature','properties':{'regionId':region_id,'name':region['name'],'sourceISO':code,'sourceName':props['shapeName'],'boundaryYear':2017,'sourceId':source_id},'geometry':mapping(simplified)})
    rows.append({'regionId':region_id,'name':region['name'],'sourceISO':code,'representative_lon':round(point.x,5),'representative_lat':round(point.y,5),'sourceYear':2017,'sourceId':source_id,'coordinateType':'точка внутри исторической геометрии, не столица'})
if len(matched)!=89:raise ValueError('Ожидалось 89, получено '+str(len(matched)))
if len(regions)!=89:raise ValueError('Справочник регионов изменился')
print('Геометрий:',len(features),'без геометрии:',', '.join(x['id'] for x in regions if x['id'] not in matched))
features.sort(key=lambda f:f['properties']['regionId']);rows.sort(key=lambda r:r['regionId'])
(ROOT/'data/processed/geometries.json').write_text(json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
(ROOT/'data/regions.json').write_text(json.dumps(regions,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
with (ROOT/'data/derived/representative-points.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
(ROOT/'data/derived/geodata-manifest.json').write_text(json.dumps({'sourceId':'geoboundaries-2017','sourceIds':['geoboundaries-2017','geoboundaries-crimea-2017','geoboundaries-additional-2017'],'sourceFeatureCounts':{'geoboundaries-2017':83,'geoboundaries-crimea-2017':2,'geoboundaries-additional-2017':4},'boundaryYear':2017,'simplificationDegrees':0.035,'featureCount':len(features),'catalogCount':len(regions),'excludedRegionIds':[x['id'] for x in regions if x['id'] not in matched],'license':'ODbL 1.0 — © OpenStreetMap contributors','coordinates':'WGS84, EPSG:4326; longitude, latitude','quality':'historical_boundaries_not_travel_data','territorialNotice':'Исторические административные контуры; не линии военного контроля и не признание территориального статуса. Международно оспариваемый статус сохранён в карточках каталога.'},ensure_ascii=False,indent=2)+'\n',encoding='utf8')

# Keep API reference points and user-downloadable files in sync with the map.
points={row['regionId']:{'lat':row['representative_lat'],'lon':row['representative_lon'],'sourceISO':row['sourceISO']} for row in rows}
(ROOT/'data/derived/representative-points.json').write_text(json.dumps(points,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
for source_path in ['data/processed/geometries.json','data/derived/representative-points.csv','data/derived/geodata-manifest.json']:
    copyfile(ROOT/source_path,ROOT/'public/downloads'/Path(source_path).name)
