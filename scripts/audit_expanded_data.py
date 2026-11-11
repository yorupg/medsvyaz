#!/usr/bin/env python3
"""Recheck all prepared graphs and publish consistently defined denominators.

Reads source census rows, repairs road snapping, and recomputes independent
point times and summaries. Does not download or alter archival primary inputs.
"""
import argparse,csv,gzip,json,math
from pathlib import Path
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from repair_road_snaps import repair_snaps
from graph_integrity import unique_segment_ids

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/processed/expanded'
RAW=ROOT/'data/raw/expanded'

def dump(path,data):path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')

def audit(rid):
    path=OUT/(rid+'.json.gz')
    with gzip.open(path,'rt') as f:d=json.load(f)
    id_repairs=unique_segment_ids(d)
    if id_repairs:dump(ROOT/('public/downloads/'+rid+'-edge-id-audit.json'),id_repairs)
    audit=repair_snaps(d)
    audit_path=ROOT/('public/downloads/'+rid+'-road-snap-audit.json')
    previous=json.loads(audit_path.read_text()) if audit_path.exists() else []
    dump(audit_path,previous+audit)
    with (RAW/(rid+'-settlements-2021.csv')).open(encoding='utf-8-sig') as f:
        rows=list(csv.DictReader(f,delimiter=';'))
    d['expectedPopulation']=sum(max(0,int(r['population'])) for r in rows if r['population'].lstrip('-').isdigit())
    d['metadata']['populationDenominator']='All settlement rows of the source census extract, including settlements below the analysis threshold of 10'
    ids={n['id']:i for i,n in enumerate(d['nodes'])};arcs={}
    for e in d['edges']:
        if not e['allowed']:continue
        a,b=ids[e['from']],ids[e['to']]
        arcs[a,b]=min(arcs.get((a,b),math.inf),e['minutes'])
        if not e['directed']:arcs[b,a]=min(arcs.get((b,a),math.inf),e['minutes'])
    graph=csr_matrix((list(arcs.values()),([a for a,b in arcs],[b for a,b in arcs])),shape=(len(ids),len(ids)))
    times,_,targets=dijkstra(graph.T,indices=[ids[f['nodeId']] for f in d['facilities']],min_only=True,return_predecessors=True)
    facility_by_node={ids[f['nodeId']]:f['id'] for f in d['facilities']}
    points=[]
    for s in d['settlements']:
        t=float(times[ids[s['nodeId']]]) if s['nodeId'] is not None else math.inf
        p={k:s[k] for k in ['id','name','municipality','population']}
        p.update(minutes=t if math.isfinite(t) else None,score=2**(-t/60) if math.isfinite(t) else None,
                 facilityId=facility_by_node.get(int(targets[ids[s['nodeId']]])) if math.isfinite(t) else None,
                 status='reachable' if math.isfinite(t) else 'missing_node' if s['nodeId'] is None else 'route_unverified')
        points.append(p)
    included=[p for p in points if p['score'] is not None]
    population=sum(p['population'] for p in included)
    for p in points:p['contributionPoints']=100*p['population']*p['score']/population if p['score'] is not None else None
    check={'methodologyVersion':'2.0.0','tau':60,'period':'day','profile':d['profile'],
           'index':100*sum(p['population']*p['score'] for p in included)/population,
           'includedPopulation':population,'sourcePopulation':d['expectedPopulation'],
           'populationCoverage':population/d['expectedPopulation'],
           'includedSettlements':len(included),'reachableSettlements':len(included),
           'method':'Independent SciPy directed sparse Dijkstra; parallel arcs minimized; unverified routes excluded'}
    for folder in [ROOT/'data/derived',ROOT/'public/downloads']:
        dump(folder/(rid+'-independent-check.json'),check)
        with (folder/(rid+'-calculation.csv')).open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=list(points[0]),delimiter=';');writer.writeheader();writer.writerows(points)
    with gzip.open(path,'wt',compresslevel=5) as f:json.dump(d,f,ensure_ascii=False,separators=(',',':'))
    summary={k:v for k,v in d.items() if k not in ['nodes','edges','settlements']}
    summary.update(nodes=len(d['nodes']),edges=len(d['edges']),settlementCount=len(d['settlements']),
                   facilityCount=len(d['facilities']),independentCheck=check,baselinePoints=points)
    dump(OUT/(rid+'-summary.json'),summary)
    print(rid,'snaps repaired',len(audit),'index',round(check['index'],6),'coverage',round(check['populationCoverage']*100,3),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--region');args=parser.parse_args()
    for rid in [args.region] if args.region else sorted(p.name.removesuffix('.json.gz') for p in OUT.glob('*.json.gz')):
        audit(rid)
    dump(OUT/'catalogue.json',{p.name.removesuffix('-summary.json'):json.loads(p.read_text()) for p in OUT.glob('*-summary.json')})
