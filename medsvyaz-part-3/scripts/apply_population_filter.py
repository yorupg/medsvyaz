#!/usr/bin/env python3
"""Apply analysis population threshold to prepared datasets without altering raw sources.

The raw census/OSM files are archival sources and remain unchanged. Execute this
script after regenerating the pilot and synthetic source datasets.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIN_POPULATION = 10
NO_DATA_REGION_IDS = {'donetsk', 'luhansk', 'kherson', 'zaporizhzhia'}


def load(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


def save(path, value):
    (ROOT / path).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def filter_pilot(region):
    name = f'data/processed/{region}-pilot.json'
    d = load(name)
    initial = d['settlements']
    removed = {s['id'] for s in initial if s['population'] is None or s['population'] < MIN_POPULATION}
    d['settlements'] = [s for s in initial if s['id'] not in removed]
    # Settlement-access nodes are not roads and must not remain as anonymous dangling graph points.
    d['edges'] = [e for e in d['edges'] if not (e['kind'] == 'access' and e['id'].startswith('access-s-') and e['id'][7:] in removed)]
    d['nodes'] = [n for n in d['nodes'] if n['id'] not in removed]
    # Preserve the denominator from the full census extract, including excluded small settlements.
    d['expectedPopulation'] = d.get('expectedPopulation') or sum(s['population'] or 0 for s in initial)
    d['version'] = 'pilot-2026-11-10-pop10'
    d['coverageLabel'] = f'{len(d["settlements"])} поселений с численностью не менее 10 человек; модельные времена'
    d['metadata']['minimumPopulation'] = MIN_POPULATION
    d['metadata']['excludedSmallSettlements'] = d['metadata'].get('excludedSmallSettlements', 0) + len(removed)
    d['metadata']['excludedPopulation'] = d['metadata'].get('excludedPopulation', 0) + sum((s['population'] or 0) for s in initial if s['id'] in removed)
    d['metadata']['missingSnaps'] = sum(s['nodeId'] is None for s in d['settlements'])
    coords = [(s['lat'], s['lon']) for s in d['settlements']]
    if coords:
        d['metadata']['mapBounds'] = [[min(x for x, _ in coords), min(y for _, y in coords)], [max(x for x, _ in coords), max(y for _, y in coords)]]
    d['assumptions'] = [a for a in d['assumptions'] if 'все поселения' not in a.lower()]
    statement = 'Для исследования включены только населённые пункты с численностью не менее 10 человек по ВПН-2021; сырые архивные сведения сохранены.'
    if statement not in d['assumptions']: d['assumptions'].append(statement)
    save(name, d)
    print(region, 'kept', len(d['settlements']), 'excluded', len(removed), 'eligible population', d['expectedPopulation'])


def filter_synthetic():
    data = load('data/processed/synthetic-regions.json')
    data = {id: d for id, d in data.items() if id not in NO_DATA_REGION_IDS}
    for id, d in data.items():
        initial = d['settlements']
        removed = {s['id'] for s in initial if s['population'] is None or s['population'] < MIN_POPULATION}
        d['settlements'] = [s for s in initial if s['id'] not in removed]
        # Other nodes are routing junctions, not settlements. Preserve them for graph connectivity.
        for e in d['edges']:
            if e['from'] in removed or e['to'] in removed:
                e['name'] = 'Условная транзитная связь'
        d['version'] = 'synthetic-v3-2026-11-10-pop10'
        d['expectedPopulation'] = sum(s['population'] for s in d['settlements'])
        d['coverageLabel'] = f'{len(d["settlements"])} точек с населением от 10 человек; дороги и центры условные'
        d['metadata']['minimumPopulation'] = MIN_POPULATION
        d['metadata']['excludedSmallSettlements'] = d['metadata'].get('excludedSmallSettlements', 0) + len(removed)
        statement = 'Поселения с населением меньше 10 человек исключены из выборки и всех расчётов. Исключённые узлы могут оставаться транзитными вершинами условной сети без населения.'
        if statement not in d['assumptions']: d['assumptions'].append(statement)
    save('data/processed/synthetic-regions.json', data)
    samples = load('data/raw/synthetic-samples.json')
    for id in list(samples):
        if id in NO_DATA_REGION_IDS:
            del samples[id]
        else:
            samples[id]['settlements'] = [s for s in samples[id]['settlements'] if s['population'] is not None and s['population'] >= MIN_POPULATION]
            samples[id]['samplePopulation'] = sum(s['population'] for s in samples[id]['settlements'])
    save('data/raw/synthetic-samples.json', samples)
    print('synthetic regions:', len(data), 'no data:', sorted(NO_DATA_REGION_IDS))


if __name__ == '__main__':
    for region in ['kaliningrad', 'ivanovo', 'pskov']:
        filter_pilot(region)
    filter_synthetic()
