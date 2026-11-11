#!/usr/bin/env python3
"""Independent equal-settlement aggregation with math.fsum, not TS reductions."""
from pathlib import Path
import json,math,hashlib
root=Path(__file__).resolve().parents[1]
checks={}
for file in sorted((root/'data/derived/v4-baselines').glob('*.json')):
 r=json.loads(file.read_text());points=r['points'];included=[p for p in points if p['status'] in ('reachable','unreachable')]
 times=sorted(p['minutes'] for p in included if p['minutes'] is not None)
 n=len(included);numerator=math.fsum(0 if p['minutes'] is None else (math.exp2(-p['minutes']/30) if hasattr(math,'exp2') else 2.0**(-p['minutes']/30)) for p in included)
 index=100*numerator/n if n else None
 quantile=lambda q:times[max(0,math.ceil(q*len(times))-1)] if times else None
 bounds={'lower':100*numerator/len(points),'upper':100*(numerator+len(points)-n)/len(points)} if points and n else {'lower':None,'upper':None}
 shares={str(t):sum(x>t for x in times)/len(times) if times else None for t in (60,90)}
 assert index is not None and abs(index-r['value'])<1e-9,file.name
 assert n==r['includedSettlements']==r['denominator'],file.name
 assert quantile(.5)==r['medianMinutes'] and quantile(.9)==r['p90Minutes'],file.name
 for key,value in shares.items():assert abs(value-r['overMinutesShares'][key])<1e-12,file.name
 for key,value in bounds.items():assert abs(value-r['indexBounds'][key])<1e-9,file.name
 # Scores from source times only: population is not read in this calculation.
 checks[file.stem]={'index':index,'includedSettlements':n,'includedPopulation':sum(p['population'] or 0 for p in included),'medianMinutes':quantile(.5),'p90Minutes':quantile(.9),'overMinutesShares':shares,'indexBounds':bounds,'sourceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'methodologyVersion':'4.0.0','weighting':'settlement'}
assert len(checks)==85,len(checks)
for target in [root/'data/derived/v4-independent-checks.json',root/'public/downloads/v4-independent-checks.json']:
 target.write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
print('Python independent v4 validation: 85 indices, denominators, quantiles, tail shares, bounds passed.')
