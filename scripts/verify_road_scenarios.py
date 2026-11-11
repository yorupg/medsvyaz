"""Independent SciPy smoke-check of precomputed pilot infill candidates.
This measures mathematical route effects only; it does not certify the route safe.
"""
from pathlib import Path
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
import numpy as np, json, brotli
root=Path(__file__).resolve().parents[1]
cands=json.loads((root/'data/planning/algorithmic-road-candidates.json').read_text())['corridors']
for name in ('kaliningrad','ivanovo','pskov'):
    d=json.loads(brotli.decompress((root/f'data/processed/{name}-pilot.json.br').read_bytes()))
    ids={v['id']:i for i,v in enumerate(d['nodes'])};n=len(ids)
    rows=[];cols=[];vals=[]
    for e in d['edges']:
        if not e['allowed']:continue
        a=ids[e['from']];b=ids[e['to']];rows.append(b);cols.append(a);vals.append(e['minutes'])
        if not e['directed']:rows.append(a);cols.append(b);vals.append(e['minutes'])
    source=[ids[f['nodeId']] for f in d['facilities'] if f['profile']==d['profile'] and f['verified']]
    settle=[s for s in d['settlements'] if s.get('nodeId') in ids]
    subs=np.array([ids[s['nodeId']] for s in settle]);
    def run(c=None):
        r=rows[:];q=cols[:];v=vals[:]
        if c:
            a=ids[c['fromNodeId']];b=ids[c['toNodeId']];t=c['lengthKmEstimate']*60/c['modelSpeedKmh'];
            r.extend((a,b));q.extend((b,a));v.extend((t,t))
        dist=dijkstra(coo_matrix((v,(r,q)),shape=(n,n)).tocsr(),indices=source,directed=True,min_only=True)
        times=dist[subs];mask=np.isfinite(times)
        return 100*np.mean(np.where(times[mask]<=15,1,np.exp2(-(times[mask]-15)/25))),times
    base,orig=run()
    out=[]
    for c in cands:
        if c['datasetId']!=d['id']:continue
        gain,arr=run(c);deltas=orig-arr
        affected=[(s['name'],float(delta)) for s,delta in zip(settle,deltas) if np.isfinite(delta) and delta>.001]
        if gain>base:
            out.append({'hub':c['originHub'],'road_km':c['lengthKmEstimate'],'baseline':base,'after':gain,'delta':gain-base,'affected':len(affected),'example':sorted(affected,key=lambda x:-x[1])[:2]})
    out.sort(key=lambda x:-x['delta'])
    assert out, f'{name}: no real improvements after rerouting'
    print(name, json.dumps(out[0],ensure_ascii=False))
