#!/usr/bin/env python3
"""Independent baseline MIED v5 recomputation from origin travel times (no TS calculations).
Copies prepared results into public downloads. Legacy v4 source-times are retained as audit baseline.
"""
from pathlib import Path
from math import fsum
import json, csv, shutil, hashlib

ROOT=Path(__file__).resolve().parents[1]
OLD=ROOT/'data/derived/v4-baselines'
NEW=ROOT/'data/derived/v5-baselines'
PUBLIC=ROOT/'public/downloads'
SOURCES=json.loads((ROOT/'data/regions.json').read_text())
NAMES={r['id']:r['name'] for r in SOURCES}
SUMMARY=ROOT/'data/derived/study-summary.json'
ARCHIVE=ROOT/'data/derived/archive-v4-study-summary.json'
if not ARCHIVE.exists():shutil.copyfile(SUMMARY,ARCHIVE)
prev=json.loads(ARCHIVE.read_text())
NEW.mkdir(exist_ok=True,parents=True)
(PUBLIC/'v5').mkdir(exist_ok=True,parents=True)

def access(t,tau=40):
 if t is None:return 0.0
 return 1.0 if t<=15 else 2.0**(-(t-15)/(tau-15))

def dump(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

def make_csv(path,rows):
 with path.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f,delimiter=';',quoting=csv.QUOTE_ALL);w.writerows(rows)

checks={};v5scores={};reports=[];syn=[];comps=[]
for oldSource in sorted(OLD.glob('*.json')):
 rid=oldSource.stem
 source=(NEW/(rid+'.json')) if (NEW/(rid+'.json')).exists() else oldSource
 old=json.loads(source.read_text())
 included=[p for p in old['points'] if p['score'] is not None]
 assert len(included)==old['includedSettlements']==old['denominator'],rid
 numerator=fsum(access(p['minutes']) for p in included)
 score=100*numerator/len(included) if included else None
 if old['methodologyVersion']=='5.0.0':assert abs(score-old['value'])<1e-8,('Cached v5 index mismatch:',rid)
 new=json.loads(json.dumps(old))
 new.update(methodologyVersion='5.0.0',threshold=40,numerator=numerator,value=score)
 for p in new['points']:
  p['score']=access(p['minutes']) if p['status'] in ('reachable','unreachable') else None
 nTotal=len(new['points']);nIncluded=len(included)
 new['indexBounds']={'lower':100*numerator/nTotal if nTotal else None,'upper':100*(numerator+(nTotal-nIncluded))/nTotal if nTotal else None}
 new['withinThresholdSettlements']=sum(p['minutes'] is not None and p['minutes']<=40 for p in included)
 new['withinThresholdPopulation']=sum((p['population'] or 0) for p in included if p['minutes'] is not None and p['minutes']<=40)
 new['withinThresholdShare']=new['withinThresholdSettlements']/len(included) if included else None
 dump(NEW/(rid+'.json'),new)
 independent={'index':score,'includedSettlements':len(included),'includedPopulation':new['population'],'medianMinutes':new['medianMinutes'],'p90Minutes':new['p90Minutes'],'overMinutesShares':new['overMinutesShares'],'indexBounds':new['indexBounds'],'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'methodologyVersion':'5.0.0','weighting':'settlement','comfortMinutes':15,'tau':40}
 checks[rid]=independent;v5scores[rid]=new
 legacy=next((r for r in prev['reports']+prev['syntheticExamples'] if r['regionId']==rid),None)
 assert legacy,rid
 record={**legacy,'legacyIndexV4':old['value'],'index':score,'methodologyVersion':'5.0.0','threshold':40,'indexBounds':new['indexBounds']}
 (syn if old['synthetic'] else reports).append(record)
 comps.append({'regionId':rid,'name':NAMES[rid],'synthetic':old['synthetic'],'before':old['value'],'after':score,'delta':score-old['value'],'settlementCoverage':new['settlementCoverage']})
 make_csv(PUBLIC/'v5'/(rid+'-calculation.csv'),[['Поселение','ID','Муниципалитет','Население (справочно)','Время, мин','МИЭД v5, баллы','Статус','Больница']]+[[p['name'],p['id'],p['municipality'],p['population'],p['minutes'],p['score']*100 if p['score'] is not None else None,p['status'],p['facilityId']] for p in new['points']])

assert len(checks)==85,(len(checks))
# Keep a verified archive of the past study summary, do not silently overwrite legacy sources.
archivePublic=PUBLIC/'archive/mied-v4-equal-settlements'
archivePublic.mkdir(parents=True,exist_ok=True)
archivePath=archivePublic/'study-summary.json'
if not archivePath.exists():shutil.copyfile(ARCHIVE,archivePath)

updated={**prev,'methodologyVersion':'5.0.0','defaultThreshold':40,'comfortMinutes':15,'sensitivityThresholds':[30,40,50,60],
 'nationalIndex':None,'reports':reports,'syntheticExamples':syn,'legacyComparison':'archive/mied-v4-equal-settlements/study-summary.json',
 'pilots':{rid:{**content,'methodologyVersion':'5.0.0','threshold':40,'independentCheck':'v5-independent-checks.json',
 'sensitivity':[{'threshold':tau,'timeScale':scale,'index':(100*fsum(access(p['minutes']*scale if p['minutes'] is not None else None,tau) for p in v5scores[rid]['points'] if p['score'] is not None)/v5scores[rid]['denominator']) if v5scores[rid]['denominator'] else None} for tau in [30,40,50,60] for scale in [.8,1,1.2]]}
            for rid,content in prev.get('pilots',{}).items()}}
# Old precomputed scenario and facility-selection numbers belong to v4 only; flag them, do not invent v5 outcomes.
for report in updated['pilots'].values():report['scenarios']='Динамический пересчёт v5 на сайте /api/study/:id/compare; старые сценарные числа v4 сохранены в архиве.'
for path in (SUMMARY,PUBLIC/'study-summary.json'):dump(path,updated)
for path in (ROOT/'data/derived/v5-independent-checks.json',PUBLIC/'v5-independent-checks.json'):dump(path,checks)

for synthetic,records in [(False,reports),(True,syn)]:
 make_csv(PUBLIC/(('synthetic' if synthetic else 'observed')+'-regional-indices.csv'),
 [['Регион','МИЭД v5, τ=40, комфорт 15 мин','Поселений в расчёте','Всего поселений','Покрытие поселений','Тип данных']]+[[NAMES[r['regionId']],r['index'],r['includedSettlements'],r['settlements'],r['settlementCoverage'],r['label']] for r in records])
make_csv(PUBLIC/'v5-regional-comparison.csv', [['Регион','Статус данных','v4: экспонента τ=30','v5: комфорт 15 и τ=40','Изменение индекса (п.п.)','Покрытие поселений']]+[[row['name'],'Синтетика' if row['synthetic'] else 'Реальная дорожная модель',row['before'],row['after'],row['delta'],row['settlementCoverage']] for row in comps])
print('OK: independently checked 85 v5 indexes from times; values and downloadable tables updated.')
print('Real regional examples:',[(r['regionId'],round(r['index'],3)) for r in reports[:3]])
