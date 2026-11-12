#!/usr/bin/env python3
"""Independent arithmetic check of all v6.1 cached indices, coverage and time dominance.
Run separately from the graph-generation code. Does not certify medical completeness.
"""
from pathlib import Path
import json,math,sys
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'data/derived/v6-extended'

def a(t,tau=40):
 if t is None:return 0.
 if t<=15:return 1.
 return 2**(-((t-15) if t<=60 else (45+2*(t-60)))/(tau-15))

results=[];bad=[]
for f in folder.glob('*.json'):
 if f.stem in ('summary','corridors'):continue
 d=json.loads(f.read_bytes());rows=d['points'];valid=[]
 for p in rows:
  if p['status'] in ('reachable','unreachable') and p['population'] is not None:
   primary=p['minutes'];secondary=p['backupMinutes'];robust=p['robustMinutes']
   if primary is not None and secondary is not None and secondary+1e-6<primary:bad.append((d['regionId'],p['id'],'backup shorter'))
   if primary is not None and robust is not None and robust+1e-6<primary:bad.append((d['regionId'],p['id'],'stress shorter'))
   score=.85*a(primary)+.10*a(secondary)+.05*a(robust)
   if abs(score-p['score'])>1e-9:bad.append((d['regionId'],p['id'],'score mismatch'))
   valid.append((p['population'],score))
 n=len(valid);pop=sum(v for v,_ in valid)
 if not n or not pop:bad.append((d['regionId'],'empty model'));continue
 terr=100*math.fsum(s for _,s in valid)/n
 demo=100*math.fsum(p*s for p,s in valid)/pop
 total=.752*terr+.248*demo
 if not math.isclose(d['value'],total,abs_tol=1e-8):bad.append((d['regionId'],'index mismatch',total,d['value']))
 if not (0<=total<=100):bad.append((d['regionId'],'bounds'))
 if d['travelTimeDriftCount']:bad.append((d['regionId'],'baseline times drift',d['travelTimeDriftCount']))
 results.append((d['regionId'],bool(d['synthetic']),total))
assert len(results)==85,(len(results),bad[:5]);assert sum(not r[1] for r in results)==33;assert sum(r[1] for r in results)==52
assert not bad,bad[:30]
print(f'PASS: {len(results)} independently checked v6.1 indexes; 33 OSM-road models + 52 synthetic; score bounds 0–100; no source-time drift')
print('Primary pilots:',{r[0]:round(r[2],4) for r in results if r[0] in ['kaliningrad','ivanovo','pskov']})
