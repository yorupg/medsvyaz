#!/usr/bin/env python3
"""Expose provenance-tagged census samples without treating synthetic routing as regional data."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
scope = json.loads((ROOT / 'data/target-regions.json').read_text(encoding='utf-8'))
raw = json.loads((ROOT / 'data/raw/synthetic-samples.json').read_text(encoding='utf-8'))
result = {}
for item in scope:
    region = item['id']
    if region in ('kaliningrad', 'ivanovo', 'pskov'):
        continue
    observed = []
    for settlement in raw.get(region, {}).get('settlements', []):
        if not settlement['provenance'].startswith('tochno-allsettlements-2021; OKTMO '):
            continue
        observed.append({
            'id': settlement['id'], 'name': settlement['name'],
            'settlementType': settlement['name'].split(' ', 1)[0],
            'municipality': settlement['municipality'], 'lat': settlement['lat'],
            'lon': settlement['lon'], 'population': settlement['population'],
            'populationYear': 2021, 'sourceUrl': 'https://tochno.st/datasets/allsettlements',
            'provenance': settlement['provenance'],
        })
    result[region] = {
        'status': 'sample_only' if observed else 'no_data',
        'warning': 'Неполная выборка реальных переписных точек. Без больниц и дорожного графа индекс и покрытие региона не рассчитываются.' if observed else 'Подтверждённых переписных точек в локальной выборке нет.',
        'sourceId': 'tochno-allsettlements-2021' if observed else None,
        'settlements': observed,
    }

path = ROOT / 'data/processed/target-settlement-samples.json'
path.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print('Observed samples:', sum(bool(x['settlements']) for x in result.values()), 'regions,', sum(len(x['settlements']) for x in result.values()), 'points')
