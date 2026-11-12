#!/usr/bin/env python3
"""Independent SciPy validation of archived infill-road hypotheses (v5).

Parallel directed arcs must be reduced by MINIMUM cost, not SUMMED (the
implicit behaviour of COO->CSR). Directed paths use reversed arcs from each
hospital to origins. This verifies route arithmetic only, not buildability.
"""
import argparse
import json
import math
from pathlib import Path

import brotli
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

ROOT = Path(__file__).resolve().parents[1]
PILOTS = ('kaliningrad', 'ivanovo', 'pskov')


def directed_min_arcs(edges, node_index, additional=None):
    """Return min travel time for each directed arc, preserving one-way rules."""
    arcs = {}
    def insert(a, b, minutes):
        if not math.isfinite(minutes) or minutes < 0:
            raise ValueError('Invalid edge cost')
        key = node_index[a], node_index[b]
        arcs[key] = min(arcs.get(key, math.inf), float(minutes))
    for edge in edges:
        if not edge['allowed']:
            continue
        insert(edge['to'], edge['from'], edge['minutes'])  # reversed for facilities-to-origin routing
        if not edge['directed']:
            insert(edge['from'], edge['to'], edge['minutes'])
    if additional:
        a = additional['fromNodeId']; b = additional['toNodeId']
        t = additional['lengthKmEstimate']*60/additional['modelSpeedKmh']
        insert(a,b,t);insert(b,a,t)
    return arcs


def graph_from_arcs(arcs, count):
    row, col, weights = [], [], []
    for (a,b),cost in arcs.items():
        row.append(a); col.append(b); weights.append(cost)
    return csr_matrix((weights,(row,col)),shape=(count,count))


def accessibility(times):
    scores = np.where(times<=15,1,np.exp2(-(times-15)/25))
    return scores


def run_pilot(name):
    d = json.loads(brotli.decompress((ROOT/f'data/processed/{name}-pilot.json.br').read_bytes()))
    ids={v['id']:i for i,v in enumerate(d['nodes'])}
    facilities=[f for f in d['facilities'] if f['profile']==d['profile'] and f['verified'] and 'day' in f['periods']]
    sources=np.asarray([ids[f['nodeId']] for f in facilities],dtype=int)
    settlements=[s for s in d['settlements'] if s.get('nodeId') in ids]
    origins=np.asarray([ids[s['nodeId']] for s in settlements],dtype=int)
    arcs=directed_min_arcs(d['edges'],ids)
    def route(candidate=None):
        updated = {**arcs}
        if candidate:
            proposal=directed_min_arcs([],ids,candidate)
            for key,val in proposal.items():updated[key]=min(updated.get(key,math.inf),val)
        times=dijkstra(graph_from_arcs(updated,len(ids)),indices=sources,directed=True,min_only=True)[origins]
        valid=np.isfinite(times)
        return (100*float(np.mean(accessibility(times[valid]))) if np.any(valid) else None),times
    base,orig=route()
    with (ROOT/'data/derived/v5-baselines'/f'{name}.json').open() as f:
        expected=json.load(f)['value']
    # Both calculations exclude unknown routes and use the very same graph, so
    # disagreement is a real regression, not a different quality threshold.
    if not np.isclose(base,expected,atol=1e-5,rtol=0):
        raise AssertionError(f'{name}: SciPy {base:.8f} != TypeScript baseline {expected:.8f}')
    cands=json.loads((ROOT/'data/planning/algorithmic-road-candidates.json').read_text())['corridors']
    results=[]
    for cand in cands:
        if cand['datasetId']!=d['id']:continue
        score,times=route(cand)
        with np.errstate(invalid="ignore"):
            delta=orig-times
        affected=[{'name':s['name'],'savedMinutes':round(float(v),3)} for s,v in zip(settlements,delta) if np.isfinite(v) and v>0.001]
        if score is not None and score>base+1e-9:
            results.append(dict(id=cand.get('id'),hub=cand['originHub'],roadKm=cand['lengthKmEstimate'],
                before=round(base,6),after=round(score,6),delta=round(score-base,6),
                affected=len(affected),examples=sorted(affected,key=lambda x:-x['savedMinutes'])[:2]))
    results.sort(key=lambda x:-x['delta'])
    return {'region':name,'status':'checked','baseline':round(base,6),'matchesLiveEngine':True,
            'testedCandidates':sum(c['datasetId']==d['id'] for c in cands),'improvingCandidates':len(results),
            'best':results[0] if results else None,'results':results,
            'caution':'Checks travel-time mathematics, not legal or physical feasibility of the proposed road.'}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--region',choices=PILOTS);args=parser.parse_args()
    reports=[run_pilot(name) for name in ([args.region] if args.region else PILOTS)]
    output=ROOT/'data/derived/road-scenarios-independent-v5-fixed.json'
    output.write_text(json.dumps({'method':'SciPy directed Dijkstra / min duplicate arc', 'reports':reports},ensure_ascii=False,indent=2)+'\n')
    for row in reports:
        print(row['region'],json.dumps({k:v for k,v in row.items() if k!='results'},ensure_ascii=False))

if __name__=='__main__':main()
