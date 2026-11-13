#!/usr/bin/env python3
"""One command to refresh real regional OSM medical points and print index readiness.

  python scripts/refresh_all_region_medical.py

Run this on the host before `docker compose up --build -d` so that JSON medical
catalogs are copied into the image and the server recalculates v6.2 on launch.
No synthetic coordinates are passed off as observed. No GitHub writes.
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'scripts'
FOLDER = ROOT / 'public/data/medical-catalogs'


def report():
    records=[]
    for file in sorted(FOLDER.glob('*.json')):
        d=json.loads(file.read_text(encoding='utf-8'))
        counts=Counter(item['type'] for item in d['facilities'])
        clinic_sites=[f for f in d['facilities'] if f['type'] in ('public_adult_polyclinic','public_children_polyclinic')]
        suitable=[f for f in clinic_sites if isinstance(f.get('roadNodeId'),str) and f.get('ownership') != 'private']
        if not d['synthetic']:
            records.append((file.stem, len(d['facilities']),len(clinic_sites),len(suitable),counts['private_paid']))
    print('\n=== Готовность медицинских каталогов и индексов ===')
    print('Регион                         Все объекты  Поликлиники  Привязаны к дороге  Частные')
    for name,total,poly,connected,private in records:
        print(f'{name:30} {total:11d} {poly:12d} {connected:18d} {private:7d}')
    prepared=sum(x[3]>0 for x in records)
    print(f'\nИндекс v6.2 сможет быть рассчитан в {prepared} из {len(records)} реальных регионов.')
    print('В регионах без привязанных поликлиник временно сохраняется v6.1 — НЕ искусственный нулевой показатель поликлинической помощи.')
    print('Наличие OSM-точки не доказывает право на бесплатный приём или профиль конкретного отделения.')
    return prepared,len(records)


def main():
    p=argparse.ArgumentParser(description='Refresh OSM-based regional medical catalogs before Docker build')
    p.add_argument('--offline',action='store_true',help='Rebuild only from previously downloaded local tiles')
    p.add_argument('--skip-kaliningrad-rankings',action='store_true',help='Do not recompute the 3+3 Kaliningrad sites')
    p.add_argument('--threads',type=int,default=6,help='Concurrent download threads (default: 6)')
    args=p.parse_args()
    cmd=[sys.executable, str(SCRIPTS/'build_regional_medical_catalogs.py')]
    if not args.offline:cmd.append('--refresh-osm')
    cmd.extend(['--threads',str(max(1,min(args.threads,12)))])
    print('Шаг 1/3: формируем географические каталоги медицинских учреждений.',flush=True)
    subprocess.run(cmd,cwd=ROOT,check=True)
    print('Шаг 2/3: проверяем базовые данные.',flush=True)
    subprocess.run([sys.executable,str(SCRIPTS/'test_medical_catalogs.py')],cwd=ROOT,check=True)
    if not args.skip_kaliningrad_rankings:
        print('Шаг 3/3: пересчитываем предложения Калининградской области по обновлённой базе.',flush=True)
        subprocess.run([sys.executable,str(SCRIPTS/'build_kaliningrad_rankings_v62.py')],cwd=ROOT,check=True)
    report()
    print('\nГотово. Пересоберите сервер: docker compose up --build -d')
    print('На страницах регионов значения МИЭД v6.2 и предложений будут вычислены по текущим данным сервером; сохранённые исторические v6.1 числа останутся архивными.')


if __name__=='__main__':main()
