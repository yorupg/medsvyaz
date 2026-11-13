#!/usr/bin/env python3
"""Offline audit of map-only vs eligible medical catalogs. No network or changes to data."""
import argparse
import csv
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGS = ROOT / 'public' / 'data' / 'medical-catalogs'
PUBLIC = {'public_hospital', 'public_adult_polyclinic', 'public_children_polyclinic'}
CLINICS = {'public_adult_polyclinic', 'public_children_polyclinic'}


def audit():
    rows = []
    for path in sorted(CATALOGS.glob('*.json')):
        payload = json.loads(path.read_text('utf-8'))
        facilities = payload['facilities']
        counts = Counter(f.get('type') for f in facilities)
        synthetic = bool(payload.get('synthetic')) or (bool(facilities) and all(f.get('sourceClass') == 'synthetic' for f in facilities))
        clinic_count = sum(counts.get(t, 0) for t in CLINICS)
        verified_clinics = sum(f.get('officiallyVerified') is True and f.get('type') in CLINICS and bool(f.get('roadNodeId')) for f in facilities)
        rows.append(dict(region=payload['regionId'], synthetic=synthetic,
                         map_points=len(facilities), hospitals=counts['public_hospital'],
                         adult_clinics=counts['public_adult_polyclinic'],
                         children_clinics=counts['public_children_polyclinic'],
                         private_paid=counts['private_paid'],
                         official_clinics_in_index=verified_clinics,
                         medical_quality='СИНТЕТИКА' if synthetic else (
                             'Есть подтверждённые поликлиники' if verified_clinics else
                             'Нет подтверждённых поликлиник в расчётной базе')))
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', type=Path, help='Optional CSV summary destination')
    args = parser.parse_args()
    rows = audit()
    real = [r for r in rows if not r['synthetic']]
    synthetic = [r for r in rows if r['synthetic']]
    print(f'Каталоги: {len(rows)}; реальные: {len(real)}; синтетические: {len(synthetic)}')
    print(f'Поликлиники на карте реальных регионов: {sum(r["adult_clinics"]+r["children_clinics"] for r in real)}')
    print(f'Подтверждённые поликлиники с привязкой к дорогам: {sum(r["official_clinics_in_index"] for r in real)}')
    print('ВАЖНО: отсутствие точки в каталоге не означает отсутствие действующего учреждения.')
    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        with args.csv.open('w', encoding='utf-8-sig', newline='') as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        print('CSV:', args.csv)


if __name__ == '__main__':
    main()
