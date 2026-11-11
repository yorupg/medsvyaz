#!/usr/bin/env python3
"""Independent stdlib Dijkstra check and public exports for the three real pilots.

Raw census and OSM snapshots are never edited. Run from the repository root.
"""
import csv
import heapq
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PILOTS = {
    'kaliningrad': ('pilot', 'data/raw/pilot/kaliningrad_settlements_2021.csv'),
    'ivanovo': ('ivanovo', 'data/raw/ivanovo/settlements-2021.csv'),
    'pskov': ('pskov', 'data/raw/pskov/settlements-2021.csv'),
}
TAUS = (30, 45, 60, 90)


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def route_times(dataset):
    reverse = {node['id']: [] for node in dataset['nodes']}
    for edge in dataset['edges']:
        if not edge['allowed']:
            continue
        reverse[edge['to']].append((edge['from'], edge['minutes']))
        if not edge['directed']:
            reverse[edge['from']].append((edge['to'], edge['minutes']))
    facilities = [f for f in dataset['facilities'] if f['verified'] and f['profile'] == dataset['profile'] and 'day' in f['periods']]
    distance = {f['nodeId']: 0.0 for f in facilities}
    targets = {f['nodeId']: f['id'] for f in facilities}
    heap = [(0.0, f['nodeId']) for f in facilities]
    heapq.heapify(heap)
    while heap:
        minutes, node = heapq.heappop(heap)
        if minutes != distance[node]:
            continue
        for previous, cost in reverse[node]:
            candidate = minutes + cost
            if candidate < distance.get(previous, math.inf):
                distance[previous] = candidate
                targets[previous] = targets[node]
                heapq.heappush(heap, (candidate, previous))
    return distance, targets


def main():
    report = []
    for region, (prefix, raw_name) in PILOTS.items():
        path = ROOT / f'data/processed/{region}-pilot.json'
        dataset = json.loads(path.read_text(encoding='utf-8'))
        with (ROOT / raw_name).open(encoding='utf-8-sig', newline='') as source:
            raw_rows = list(csv.DictReader(source, delimiter=';'))
        source_population = sum(max(0, int(row['population'])) for row in raw_rows)
        assert source_population >= sum(s['population'] or 0 for s in dataset['settlements'])
        raw_by_id = {row['oktmo']: row for row in raw_rows}
        for settlement in dataset['settlements']:
            source_row = raw_by_id[settlement['id'][2:]]
            assert int(source_row['population']) == settlement['population']
            settlement['settlementType'] = source_row['object_name'].split(' ', 1)[0]
            settlement['populationYear'] = 2021
            settlement['populationSourceUrl'] = 'https://tochno.st/datasets/allsettlements'
        for facility in dataset['facilities']:
            facility['facilityType'] = 'стационарная больничная площадка'
            facility['careProfile'] = 'стационарная помощь; специальности и доступность коек не подтверждены'
            facility['administrativeArea'] = raw_rows[0]['region']
        dataset['expectedPopulation'] = source_population
        dataset['version'] = 'pilot-2026-11-10-mied-v2'
        dataset['date'] = '2026-11-10'
        dataset['metadata']['populationDenominator'] = 'All settlement rows in the stored 2021 census extract, including population < 10'
        dataset['metadata']['confirmedUnreachableIds'] = []
        dataset['coverageLabel'] = f"{len(dataset['settlements'])} поселений с населением от 10 человек; покрытие относительно всех пунктов исходного файла"
        path.write_text(json.dumps(dataset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        distance, targets = route_times(dataset)
        points = []
        for settlement in sorted(dataset['settlements'], key=lambda item: item['id']):
            node = settlement['nodeId']
            population = settlement['population']
            if population is None:
                status, minutes, facility = 'missing_population', None, None
            elif node is None:
                status, minutes, facility = 'missing_node', None, None
            elif node not in distance:
                status, minutes, facility = 'route_unverified', None, None
            else:
                status, minutes, facility = 'reachable', distance[node], targets[node]
            points.append({'id': settlement['id'], 'name': settlement['name'], 'municipality': settlement['municipality'], 'population': population, 'minutes': minutes, 'status': status, 'facilityId': facility})
        included = [p for p in points if p['status'] == 'reachable']
        population = sum(p['population'] for p in included)
        numerator = sum(p['population'] * 2 ** (-p['minutes'] / 60) for p in included)
        index = 100 * numerator / population if population else None
        check = {'methodologyVersion': '2.0.0', 'tau': 60, 'period': 'day', 'index': index,
                 'includedPopulation': population, 'sourcePopulation': source_population,
                 'populationCoverage': population / source_population,
                 'includedSettlements': len(included),
                 'missingSettlements': len(points) - len(included),
                 'unverifiedRoutes': sum(p['status'] == 'route_unverified' for p in points),
                 'reachableSettlements': len(included),
                 'method': 'Independent Python heapq multi-source reverse Dijkstra on directed OSM graph; unverified routes excluded'}
        for directory in ('data/derived', 'public/downloads'):
            save(ROOT / directory / f'{prefix}-independent-check.json', check)
            save(ROOT / directory / f'{prefix}-independent-points.json', points)
            with (ROOT / directory / f'{prefix}-calculation.csv').open('w', encoding='utf-8-sig', newline='') as output:
                writer = csv.writer(output, delimiter=';', quoting=csv.QUOTE_ALL)
                writer.writerow(['Методика', 'ID пункта', 'Пункт', 'Муниципалитет', 'Население', 'Время, мин', 'Коэффициент', 'Вклад в индекс, баллы', 'Статус', 'Больница'])
                for p in points:
                    score = 2 ** (-p['minutes'] / 60) if p['minutes'] is not None else None
                    writer.writerow(['МИЭД v2.0; τ=60; частичный расчёт', p['id'], p['name'], p['municipality'], p['population'], p['minutes'], score, 100 * p['population'] * score / population if score is not None and population else None, p['status'], p['facilityId']])
        report.append({'regionId': region, 'status': 'partial', 'index': index, 'population': population,
                       'sourcePopulation': source_population, 'coverage': population / source_population,
                       'settlements': len(dataset['settlements']), 'includedSettlements': len(included), 'facilities': len(dataset['facilities']),
                       'unverifiedRoutes': check['unverifiedRoutes'], 'datasetId': dataset['id'], 'version': dataset['version'],
                       'sensitivity': {str(tau): 100 * sum(p['population'] * 2 ** (-p['minutes'] / tau) for p in included) / population for tau in TAUS}})
        print(region, 'index', round(index, 6), 'coverage', round(population / source_population * 100, 3), 'routes to verify', check['unverifiedRoutes'], flush=True)
    scope = json.loads((ROOT / 'data/target-regions.json').read_text(encoding='utf-8'))
    sample_path = ROOT / 'data/processed/target-settlement-samples.json'
    samples = json.loads(sample_path.read_text(encoding='utf-8')) if sample_path.exists() else {}
    by_id = {item['regionId']: item for item in report}
    summary = {'methodologyVersion': '2.0.0', 'preparedAt': '2026-11-10', 'nationalIndex': None,
               'reason': 'Independent verification of the three original official-source pilots; the full study summary is generated by npm run calculate',
               'reports': [by_id.get(item['id'], {'regionId': item['id'], 'status': 'no_data', 'index': None, 'coverage': None,
                                                   'observedSampleSettlements': len(samples.get(item['id'], {}).get('settlements', []))}) for item in scope]}
    for directory in ('data/derived', 'public/downloads'):
        save(ROOT / directory / 'pilot-check-summary.json', summary)


if __name__ == '__main__':
    main()
