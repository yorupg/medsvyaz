#!/usr/bin/env python3
"""Create three transparently synthetic region-labelled examples for testing the A2 algorithm.
No actual residents, hospitals, routes, travel times or population figures are implied.
"""
import copy,csv,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
base=json.loads((ROOT/'data/examples/demo.json').read_text(encoding='utf8'))
samples=[
  {'regionId':'kaliningrad','name':'Калининградская область','coeff':1.0,'population':[500,1200,800,700,1500,300,100], 'summary':'Эталонная учебная дорожная сеть'},
  {'regionId':'ivanovo','name':'Ивановская область','coeff':0.72,'population':[700,900,850,900,700,650,300], 'summary':'Условно более короткие поездки'},
  {'regionId':'tyumen','name':'Тюменская область','coeff':1.6,'population':[350,700,1000,500,900,1200,450], 'summary':'Условно более длительные поездки'}
]
rows={kind:[] for kind in ('nodes','edges','settlements','facilities')}
manifest=[]
for cfg in samples:
 d=copy.deepcopy(base);slug=cfg['regionId']
 d['id']='example-'+slug;d['version']='example-2026-11-09-v1';d['title']='УЧЕБНАЯ МОДЕЛЬ — '+cfg['name'];d['regionId']=slug
 d['sourceIds']=['synthetic-v1','synthetic-regional-examples'];d['license']='CC0 1.0 (вымышленные расчётные данные); ODbL 1.0 (фоновая карта)'
 d['assumptions']=[
   'ВСЕ расчётные значения синтетические; они не характеризуют эту область.',
   'Название региона служит только для демонстрации масштаба исследования на реальной географической карте.',
   'Все пункты, центры, минуты и веса созданы алгоритмически для проверки работы индекса.',
   'Координаты узлов x/y — условные позиции на схеме, НЕ широта/долгота.',
   f'Времена рёбер = времена исходной вымышленной сети × {cfg["coeff"]}; это не измерения.',
   'Исследуем условный профиль экстренной помощи, период суток день, порог 60 минут.',
   'В улучшении ускоряется условная связь ce в 1,5 раза; в закрытии ce исключается.'
 ]
 for e in d['edges']:
  e['minutes']=round(e['minutes']*cfg['coeff'],2)
  e['speedSource']=f'СИНТЕТИКА: demo.json × {cfg["coeff"]}'
 for s,population in zip(d['settlements'],cfg['population']):
  s['name']='Условный '+s['name'].lower()
  s['population']=population
  s['municipality']='Учебная зона (не муниципалитет)'
  s['provenance']='synthetic-v1; генератор scripts/build_examples.py'
 d['expectedPopulation']=sum(cfg['population'])
 for f in d['facilities']:
  f['name']='Вымышленный '+f['name'].lower()
  f['provenance']='synthetic-v1; учреждение не существует'
 out=ROOT/'data/examples'/f'{slug}.json'
 out.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 manifest.append({'id':d['id'],'regionId':slug,'regionName':cfg['name'],'title':cfg['summary'],'synthetic':True,'version':d['version'],'datasetUrl':f'/api/examples/{slug}/dataset','source':'data/examples/'+slug+'.json','scenarioEdgeId':'ce','scenarioMultiplier':1.5,'units':{'population':'условных жителей','edges.minutes':'минуты (условно)','index':'баллы 0–100'},'comparability':'Все три — учебные сети, один профиль, период и порог. Различия обусловлены придуманными временами и весами.'})
 for kind in rows:
  for x in d[kind]:
   record={'datasetId':d['id'],'regionId':slug,'synthetic':True,'version':d['version'],**x}
   if kind=='facilities':record['periods']='|'.join(record['periods'])
   rows[kind].append(record)
(ROOT/'data/examples/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
for kind,records in rows.items():
 path=ROOT/'data/derived'/f'example-{kind}.csv'
 with path.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(records[0]));w.writeheader();w.writerows(records)
print('Созданы 3 учебных набора и 4 таблицы CSV; реальных времён и больниц не добавлено.')
