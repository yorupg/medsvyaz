from pathlib import Path
import json,csv,shutil
root=Path(__file__).resolve().parents[1]
source=root/'data/derived/v6-extended';public=root/'public/downloads';v61=public/'v6.1';v61.mkdir(exist_ok=True,parents=True)
allfiles=sorted(f for f in source.glob('*.json') if f.stem not in ('summary','corridors'))
rows=[]
for f in allfiles:
 j=json.loads(f.read_bytes())
 a={k:j.get(k) for k in ['regionId','synthetic','value','territorialIndex','populationIndex','sourceIndexV5','includedSettlements','includedPopulation','facilityNodes','stressWayIds','travelTimeDriftCount']}
 rows.append(a)
 forcsv=[['Поселение','Муниципалитет','Население','Ближайшая больница (мин)','Запасная больница (мин)','Ухудшенное время (мин)','Оценка S (0-100)','Статус','Медплощадка ближайшая','Резервная медплощадка']]
 for p in j['points']:
  forcsv.append([p['name'],p['municipality'],p['population'],p['minutes'],p['backupMinutes'],p['robustMinutes'],p['score']*100 if p['score'] is not None else None,p['status'],p['facilityId'],p['backupFacilityId']])
 with (v61/(j['regionId']+'-calculation.csv')).open('w',encoding='utf-8-sig',newline='') as fp:
  w=csv.writer(fp,delimiter=';');w.writerows(forcsv)
source.joinpath('summary.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
source.joinpath('corridors.json').write_text(json.dumps({r['regionId']:r['stressWayIds'] for r in rows},ensure_ascii=False,indent=2)+'\n')
(v61/'summary.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
with (v61/'v6.1-indices.csv').open('w',encoding='utf-8-sig',newline='') as fp:
 w=csv.writer(fp,delimiter=';');w.writerow(['Регион','Синтетическая модель','МИЭД v6.1','Территориальный компонент','Демографический компонент','МИЭД v5','Поселений в расчёте','Население в расчёте','Узлов медплощадок','Сценариев перекрытия','Совпадение со старым временем']);
 for r in rows:w.writerow([r['regionId'],r['synthetic'],r['value'],r['territorialIndex'],r['populationIndex'],r['sourceIndexV5'],r['includedSettlements'],r['includedPopulation'],r['facilityNodes'],len(r['stressWayIds']),r['travelTimeDriftCount']])
# Keep old summary under v5 archive and publish updated values in the canonical JSON report.
existing=root/'data/derived/study-summary.json';current=json.loads(existing.read_bytes());archive=root/'data/derived/archive-v5-study-summary-v61-migration.json'
if not archive.exists():shutil.copyfile(existing,archive)
byid={r['regionId']:r for r in rows}
for key in ('reports','syntheticExamples'):
 for report in current.get(key,[]):
  m=byid.get(report.get('regionId'))
  if not m:continue
  report.update(legacyIndexV5=report.get('index'),index=m['value'],methodologyVersion='6.1.0',threshold=40,
                territorialIndex=m['territorialIndex'],populationIndex=m['populationIndex'],\
                backupAndStressCalculated=True)
current.update(methodologyVersion='6.1.0',defaultThreshold=40,comfortMinutes=15,longTripBreakMinutes=60,longTripGamma=2,
               weightTerritory=.752,weightPopulation=.248,weightNearest=.85,weightBackup=.10,weightStress=.05,
               calculatedRegions=85,nationalIndex=None,
               methodCaution='Запасная медплощадка и три перекрытия оцениваются только в пределах модельного графа и реестра; не доказана полнота медучреждений и риск дороги')
for p in (existing,public/'study-summary.json'):p.write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n')
for synthetic,name in [(False,'observed-regional-indices.csv'),(True,'synthetic-regional-indices.csv')]:
 with (public/name).open('w',encoding='utf-8-sig',newline='') as fp:
  w=csv.writer(fp,delimiter=';');w.writerow(['Регион','МИЭД v6.1','По поселениям','По населению','МИЭД v5','Включено поселений','Тип данных']);
  for r in rows:
   if bool(r['synthetic'])==synthetic:w.writerow([r['regionId'],r['value'],r['territorialIndex'],r['populationIndex'],r['sourceIndexV5'],r['includedSettlements'],'Синтетика' if synthetic else 'Реальный дорожный граф'])
print('rows',len(rows),'real',sum(not r['synthetic'] for r in rows),'synthetic',sum(bool(r['synthetic']) for r in rows))
print('score bounds:',min(x['value'] for x in rows),max(x['value'] for x in rows),'drift count',sum(x['travelTimeDriftCount'] for x in rows))
