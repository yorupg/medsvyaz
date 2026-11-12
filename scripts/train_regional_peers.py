#!/usr/bin/env python3
"""Leave-one-municipality-out geographic peer baseline for EVERY observed region.

This is a diagnostic relative to the existing v5 dataset, not a prediction of
actual medical care or proof of deficient infrastructure. No network fetch.
The archived v5 baseline determines actual road access; *never* train on
synthetic regions or use facility status beyond its stated evidence level.
"""
from __future__ import annotations
import argparse
import brotli
import csv
import json
from collections import Counter
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public/downloads'
K = 20
FIELDS = ['id','name','municipality','actual','expected','gap','nearest','nearestKm','facility','minutes','directKm','featureNearby15','featureNearby30']


def read_br(path: Path) -> dict:
    return json.loads(brotli.decompress(path.read_bytes()))


def haversine(lat, lon, fs):
    lat, lon = np.radians([lat, lon])
    points = np.radians(np.asarray([[f['lat'],f['lon']] for f in fs], dtype=float))
    a = np.sin((points[:, 0]-lat)/2)**2 + np.cos(lat)*np.cos(points[:, 0])*np.sin((points[:,1]-lon)/2)**2
    return 12742.0176*np.arcsin(np.sqrt(np.clip(a,0,1)))


def regional_report(id: str):
    expanded = id not in ('kaliningrad','ivanovo','pskov')
    path = ROOT / ('data/processed/expanded/' + id + '.json.br' if expanded else 'data/processed/' + id + '-pilot.json.br')
    dataset = read_br(path)
    if dataset['synthetic']:
        raise ValueError('Synthetic region cannot be trained: '+id)
    baseline = json.loads((ROOT / 'data/derived/v5-baselines' / (id+'.json')).read_text())
    # Baseline is calculated by the live TypeScript formula; use that model outcome.
    points_by_id = {p['id']:p for p in baseline['points']}
    facilities = [f for f in dataset['facilities'] if f.get('profile') == dataset['profile'] and f.get('verified') and 'day' in f.get('periods',[])]
    fs_by_id = {f['id']:f for f in facilities}
    if len(facilities)<2:
        return dict(status='insufficient_facilities', regionId=id, total=len(dataset['settlements']), included=0,
                    facilities=len(facilities), rows=[],warning='Менее двух больничных площадок для построения признаков географического соседства')
    rows=[];features=[]
    for s in dataset['settlements']:
        p=points_by_id.get(s['id'])
        if (not p or p['status'] != 'reachable' or p['score'] is None or p['facilityId'] not in fs_by_id or
            s.get('lat') is None or s.get('lon') is None or p['minutes'] is None):
            continue
        km = haversine(s['lat'],s['lon'],facilities)
        nearest = np.argsort(km)[:2]
        closest = facilities[int(nearest[0])]
        chosen = fs_by_id[p['facilityId']]
        chosen_km = float(haversine(s['lat'],s['lon'],[chosen])[0])
        nearby15,nearby30=int(np.sum(km<=15)),int(np.sum(km<=30))
        features.append([float(km[nearest[0]]),float(km[nearest[1]]),nearby15,nearby30])
        rows.append(dict(id=s['id'],name=s['name'],municipality=s.get('municipality') or 'Не указан',
            actual=100*float(p['score']),minutes=float(p['minutes']),nearest=closest['name'],
            nearestKm=float(km[nearest[0]]),facility=chosen['name'],directKm=chosen_km,
            featureNearby15=nearby15,featureNearby30=nearby30))
    N=len(rows)
    groups=np.array([p['municipality'] for p in rows])
    counts=Counter(groups)
    if N<K+1 or len(counts)<2 or max(counts.values())>=N-K:
        return dict(status='insufficient_groups', regionId=id, total=len(dataset['settlements']), included=N,
                    facilities=len(facilities), municipalities=len(counts),rows=[],
                    warning='Недостаточно пунктов из других муниципалитетов для независимого сравнения')
    X=StandardScaler().fit_transform(np.asarray(features,float))
    # Global feature scaling sees only *unlabelled* geography; outcomes always
    # come from other municipalities, never the target's own municipality.
    tree=cKDTree(X)
    # Query enough neighbours to skip even the largest municipality completely.
    candidate_count=min(N, K+max(counts.values()))
    _, neighbors=tree.query(X,k=candidate_count,workers=-1)
    neighbors=np.atleast_2d(neighbors)
    y=np.asarray([p['actual'] for p in rows])
    expected=np.empty(N,dtype=float);median=np.empty(N,dtype=float)
    for i, group in enumerate(groups):
        others=neighbors[i][groups[neighbors[i]]!=group][:K]
        if len(others)<K:
            raise AssertionError(f'{id}: leaked/insufficient peers at {i}')
        expected[i]=np.mean(y[others])
    for group in counts:
        mask=groups==group
        median[mask]=np.median(y[~mask])
    for i,p in enumerate(rows):
        p['expected']=float(expected[i]);p['gap']=float(expected[i]-y[i])
    rows.sort(key=lambda p:(-p['gap'],p['id']))
    def record(p):
        return {field:round(p[field],3) if isinstance(p[field],float) else p.get(field) for field in FIELDS}
    with (DEST / f'{id}-peers.csv').open('w',encoding='utf-8-sig',newline='') as out:
        writer=csv.DictWriter(out,fieldnames=FIELDS);writer.writeheader();writer.writerows(record(p) for p in rows)
    top=[record(p) for p in rows if p['gap']>0][:10]
    return dict(status='available',regionId=id,methodologyVersion='5.0.0',threshold=40,timeScale=1,
        target='МИЭД поселения по дорожному графу, 0–100',features='2 ближайшие площадки по прямой; количество площадок в 15 и 30 км',
        validation='Leave-one-municipality-out: все соседи для прогноза находятся в других муниципалитетах',
        scaling='StandardScaler на географических признаках всей территории без целевой переменной',
        total=len(dataset['settlements']),included=N,facilities=len(facilities),municipalities=len(counts),peers=K,
        mae=round(float(np.mean(np.abs(y-expected))),2),medianBaselineMae=round(float(np.mean(np.abs(y-median))),2),
        evidence='official-selected-sites' if not expanded else 'osm-unverified-medical-profile',
        sourceDataset=dataset['id'],sourceVersion=dataset['version'],
        caveat='Отрицательное отклонение — сигнал для проверки дорожного графа и медицинских данных, не доказательство дефицита дорог или медицинской помощи.',
        rows=top)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--region');args=parser.parse_args()
    ids=['ivanovo','pskov']+[p.stem[:-8] for p in sorted((ROOT/'data/processed/expanded').glob('*-summary.json'))]
    # Don't overwrite historically independently validated Kaliningrad reference.
    # Other two pilots are created the same way as the 30 expanded regions.
    if args.region:
        ids=[args.region]
    summary={}
    # Preserve the separately checked Kaliningrad LOMO fit and its route/detour audit.
    if not args.region:
        preserved=json.loads((DEST/'kaliningrad-peers.json').read_text())
        summary['kaliningrad']={k:preserved.get(k) for k in ('status','included','total','facilities','municipalities','mae','medianBaselineMae','evidence')}
    for id in ids:
        try:
            data=regional_report(id)
            (DEST/f'{id}-peers.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            summary[id]={k:data.get(k) for k in ('status','included','total','facilities','municipalities','mae','medianBaselineMae','evidence')}
            print(id,data['status'],data.get('included'),data.get('mae'),flush=True)
        except Exception as error:
            summary[id]={'status':'error','error':str(error)}
            print(id,'ERROR',error,flush=True)
            if args.region:raise
    (ROOT/'data/derived/regional-ml-audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    if any(item['status']=='error' for item in summary.values()):
        raise SystemExit('Failed in regions: '+','.join(k for k,v in summary.items() if v['status']=='error'))

if __name__=='__main__':main()
