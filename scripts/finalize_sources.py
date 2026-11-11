#!/usr/bin/env python3
"""Update the website's source registry from the archived download evidence."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'data/sources.json'
sources=json.loads(path.read_text())
sources=[s for s in sources if s['id'] not in ['synthetic-regional-v3','geofabrik-kaliningrad','rosstat-population','gusev-profile','routing-order']
         and not s['id'].startswith('osm-expanded-') and s['id'] not in ['geonames-ru-coordinate-audit','osm-place-coordinate-audit','synthetic-regional-v4']]
names={r['id']:r['name'] for r in json.loads((ROOT/'data/regions.json').read_text())}
for rid,url in json.loads((ROOT/'data/raw/expanded/selection.json').read_text()).items():
    evidence=json.loads((ROOT/('data/raw/expanded/'+rid+'.osm.pbf.source.json')).read_text())
    summary=json.loads((ROOT/('data/processed/expanded/'+rid+'-summary.json')).read_text())
    sources.append({'id':'osm-expanded-'+rid,'title':names[rid]+' · дороги, поселения и больничные площадки OSM',
        'publisher':'© OpenStreetMap contributors; региональная выгрузка OpenStreetMap France',
        'url':evidence['url'],'group':'Региональные геоданные','version':str(evidence['lastModified']),
        'publicationDate':None,'retrievalDate':'2026-11-10',
        'coverage':f"{summary['settlementCount']} переписных поселений; {summary['facilityCount']} отобранных больничных объектов; {summary['nodes']} узлов направленного графа",
        'format':'OSM PBF; производные JSON.gz, CSV и JSON','license':'ODbL 1.0 · © OpenStreetMap contributors','status':'partial',
        'usage':'Реальные автомобильные дороги и больничные объекты; уточнение координат именованных поселений. Общие больницы выбираются единым фильтром по тегам и названию; поликлиники, стоматологии и специализированные учреждения исключены. SHA-256: '+evidence['sha256'],
        'limitations':'Профиль mapped-hospital: объект проверен в архивной выгрузке OSM. Клиническое направление, возможность приёма, режим 24/7 и вместимость не заявляются. Скорости — модельные; дороги за границей выгрузки не включены.'})
common={'publicationDate':None,'retrievalDate':'2026-11-10','status':'partial'}
sources.extend([
 {**common,'id':'geonames-ru-coordinate-audit','title':'GeoNames · проверка координат реальных поселений',
  'publisher':'GeoNames','url':'https://download.geonames.org/export/dump/RU.zip','group':'Координаты',
  'version':'RU export retrieved 2026-11-10','coverage':'Выбранные именованные поселения синтетических моделей',
  'format':'TSV в ZIP; производный журнал JSON','license':'Creative Commons Attribution 4.0',
  'usage':'Сопоставление по нормализованному названию, близости и контуру региона. При нескольких близких одноимённых пунктах замена не производится.',
  'limitations':'Точка представляет поселение, а не каждый дом. Население GeoNames не используется: веса сохраняются по ВПН-2021.'},
 {**common,'id':'osm-place-coordinate-audit','title':'OpenStreetMap place · уточнение координат исходных пилотов',
  'publisher':'© OpenStreetMap contributors','url':'https://www.openstreetmap.org/copyright','group':'Координаты',
  'version':'Archived OSM PBF, November 2026','coverage':'Калининградская, Ивановская и Псковская области',
  'format':'OSM nodes; JSON journal','license':'ODbL 1.0',
  'usage':'Однозначное сопоставление названий населённых пунктов с узлами place. Исходные координаты сохранены; исправленная точка применяется и на карте, и в маршрутизации.',
  'limitations':'Привязка точки к дороге ограничена 500 м и представляет модель подъезда.'},
 {'id':'synthetic-regional-v4','title':'52 синтетические модели с реальными переписными точками',
  'publisher':'Команда HTTPS','url':None,'group':'Синтетические модели','version':'synthetic-v4-2026-11-10-pop10',
  'publicationDate':'2026-11-10','retrievalDate':'2026-11-10','coverage':'52 региона вне набора 33 реальных дорожных расчётов',
  'format':'JSON; детерминированный генератор TypeScript','license':'Данные: CC BY, GeoNames CC BY 4.0; модельные связи: CC0',
  'status':'synthetic','usage':'Реальные названия, переписные веса и проверяемые координаты. Городская часть Москвы и Санкт-Петербурга учитывается без двойного счёта. Сеть калибруется по пилотам с отдельными горным, северным и городским профилями; географические группы островных территорий разделены.',
  'limitations':'Дорожные связи и центры условные; результаты относятся к выборке модели. В агрегаты реальных данных не включаются.'}
])
for s in sources:
    if s['id']=='tochno-allsettlements-2021':
        s.update(retrievalDate='2026-11-10',coverage='Полные региональные перечни 33 регионов; выборки для 52 синтетических моделей',
                 usage='Переписные веса населения ВПН-2021. Муниципальные и региональные агрегаты не суммируются с поселениями. В анализ включаются пункты с населением от 10; покрытие считается относительно всех поселений исходного файла. Городские остатки федеральных городов получены вычитанием подчинённых населённых пунктов.')
assert len({s['id'] for s in sources})==len(sources)
path.write_text(json.dumps(sources,ensure_ascii=False,indent=2)+'\n')
print('Registered',len(sources),'sources, including 30 archived regional road datasets.')
