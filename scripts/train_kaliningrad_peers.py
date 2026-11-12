"""Rebuild the fixed v5 daytime peer estimates from the release road graph."""
import csv
import json
import subprocess
from pathlib import Path

import numpy as np
from sklearn.neighbors import KNeighborsRegressor
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public' / 'downloads'
K = 20


def distances(point, facilities):
    coords = np.radians([[f['lat'], f['lon']] for f in facilities])
    lat, lon = np.radians([point['lat'], point['lon']])
    h = np.sin((coords[:, 0] - lat) / 2)**2
    h += np.cos(lat) * np.cos(coords[:, 0]) * np.sin((coords[:, 1] - lon) / 2)**2
    return 12742 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def main():
    payload = subprocess.check_output(['node', '--import', 'tsx', 'scripts/kaliningrad-ml-input.ts'], cwd=ROOT)
    data = json.loads(payload)
    fs, points = data['facilities'], data['points']
    features = []
    for p in points:
        km = distances(p, fs)
        ordered = np.sort(km)
        features.append([ordered[0], ordered[1], sum(km <= 15), sum(km <= 30)])
        target = next(i for i, f in enumerate(fs) if f['id'] == p['facilityId'])
        p.update(nearestKm=ordered[0], nearest=fs[int(np.argmin(km))]['name'],
                 facility=fs[target]['name'], directKm=km[target])
        # Short straight-line trips make ratios unstable. Still include them in ML.
        p['detour'] = p['routeKm'] / km[target] if km[target] >= 1 else None

    x = np.asarray(features)
    y = np.asarray([p['actual'] for p in points])
    groups = np.asarray([p['municipality'] for p in points])
    expected = np.zeros(len(y))
    constant = np.zeros(len(y))
    for group in np.unique(groups):
        test = groups == group
        scaler = StandardScaler().fit(x[~test])
        model = KNeighborsRegressor(n_neighbors=K, algorithm='brute')
        model.fit(scaler.transform(x[~test]), y[~test])
        expected[test] = model.predict(scaler.transform(x[test]))
        constant[test] = np.median(y[~test])

    for p, typical in zip(points, expected):
        p.update(expected=float(typical), gap=float(typical - p['actual']))
    ranked = sorted(points, key=lambda p: (-p['gap'], p['id']))
    # Both rankings use the same eligible points when measuring overlap.
    comparable = [p for p in ranked if p['detour'] is not None]
    detours = sorted(comparable, key=lambda p: (-p['detour'], p['id']))
    overlap = len({p['id'] for p in comparable[:10]} & {p['id'] for p in detours[:10]})
    summary = dict(total=data['total'], included=len(points), municipalities=len(set(groups)),
                   facilities=len(fs), peers=K, mae=round(float(np.mean(abs(y-expected))), 2),
                   medianBaselineMae=round(float(np.mean(abs(y-constant))), 2),
                   comparable=len(comparable), topTenOverlap=overlap)
    fields = ['id','name','municipality','actual','expected','gap','nearest','nearestKm','facility',
              'minutes','routeKm','directKm','detour']
    def record(p):
        return {k:round(p[k], 3) if isinstance(p[k], float) else p[k] for k in fields}

    with (DEST / 'kaliningrad-peers.csv').open('w', encoding='utf-8-sig', newline='') as out:
        writer = csv.DictWriter(out, fieldnames=fields)
        writer.writeheader()
        writer.writerows(map(record, ranked))
    report = dict(**summary, rows=[record(p) for p in ranked[:10] if p['gap'] > 0])
    (DEST / 'kaliningrad-peers.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(summary)


if __name__ == '__main__':
    main()
