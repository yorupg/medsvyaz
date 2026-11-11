#!/usr/bin/env python3
from pathlib import Path
import csv,json,shutil,hashlib
root=Path(__file__).resolve().parents[1];download=root/'public/downloads';archive=download/'archive/mied-v3-population';archive_calcs=archive/'results/calculations';archive_calcs.mkdir(exist_ok=True)
summary=json.loads((root/'data/derived/study-summary.json').read_text());checks=json.loads((root/'data/derived/v4-independent-checks.json').read_text())
for report in summary['reports']:
 rid=report['regionId'];prefix='pilot' if rid=='kaliningrad' else rid;r=json.loads((root/f'data/derived/v4-baselines/{rid}.json').read_text());target=download/f'{prefix}-calculation.csv'
 if target.exists() and not (archive_calcs/target.name).exists():shutil.copyfile(target,archive_calcs/target.name)
 with target.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f,delimiter=';');w.writerow(['Методика','ID пункта','Пункт','Население, справочно','Время, мин','Коэффициент τ=30','Вес поселения','Вклад, баллы','Статус','Больница'])
  for p in r['points']:w.writerow(['МИЭД v4.0; τ=30; равные веса',p['id'],p['name'],p['population'],p['minutes'],p['score'],1 if p['score'] is not None else '',100*p['score']/r['denominator'] if p['score'] is not None else '',p['status'],p['facilityId']])
 target=download/f'{prefix}-independent-check.json'
 if target.exists() and not (archive_calcs/target.name).exists():shutil.copyfile(target,archive_calcs/target.name)
 target.write_text(json.dumps(checks[rid],ensure_ascii=False,indent=2)+'\n')
 # Keep clearly named v3 files historical; never rewrite original independent inputs.
files=[{'path':str(f.relative_to(archive)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(archive.rglob('*')) if f.is_file() and f.name!='manifest.json']
(archive/'manifest.json').write_text(json.dumps({'methodology':'3.0.0','weighting':'population','tau':30,'files':files},ensure_ascii=False,indent=2)+'\n')
print('Exported final per-settlement tables and checks for 33 regions; archived previous tables.')
