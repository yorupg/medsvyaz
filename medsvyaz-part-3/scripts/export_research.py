#!/usr/bin/env python3
"""Publish analytical tables after npm run calculate; retain primary raw files."""
import csv,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DOWNLOADS=ROOT/'public/downloads'
summary=json.loads((ROOT/'data/derived/study-summary.json').read_text())
names={r['id']:r['name'] for r in json.loads((ROOT/'data/regions.json').read_text())}
for rid in ['kaliningrad','ivanovo','pskov']:
    d=json.loads((ROOT/('data/processed/'+rid+'-pilot.json')).read_text())
    prefix='pilot' if rid=='kaliningrad' else rid
    with (DOWNLOADS/(rid+'-settlements-2021.csv')).open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=['id','name','municipality','population','populationYear','lat','lon','provenance'],extrasaction='ignore',delimiter=';')
        writer.writeheader();writer.writerows(d['settlements'])
    (DOWNLOADS/(prefix+'-facilities.json')).write_text(json.dumps(d['facilities'],ensure_ascii=False,indent=2)+'\n')
    folder='pilot' if rid=='kaliningrad' else rid
    shutil.copyfile(ROOT/('data/raw/'+folder+'/coordinate-overrides.json'),DOWNLOADS/(rid+'-coordinate-audit.json'))
for cohort,file in [('reports','observed-regional-indices.csv'),('syntheticExamples','synthetic-regional-indices.csv')]:
    with (DOWNLOADS/file).open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.writer(f,delimiter=';')
        writer.writerow(['Регион','Профиль','МИЭД v3.0, τ=30','Поселений','Больничных площадок','Население в расчете','Население источника','Покрытие населения','Тип данных'])
        for r in summary[cohort]:writer.writerow([names[r['regionId']],r['profile'],r['index'],r['settlements'],r['facilities'],r['population'],r['sourcePopulation'],r['coverage'],'Синтетическая модель' if r['synthetic'] else 'Реальные данные'])
print('Exported',len(summary['reports']),'observed indices and',len(summary['syntheticExamples']),'synthetic indices; tau=30.')
