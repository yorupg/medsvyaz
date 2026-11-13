#!/usr/bin/env python3
"""Build labelled estimates for ALL 2021 settlements using official urban/rural age rates.
This is an ecological estimate, NOT observed age data for individual settlements.
"""
import pathlib, json, brotli, math
ROOT=pathlib.Path(__file__).resolve().parents[1]
demo=json.loads((ROOT/'data/demographics/kaliningrad-age-structure-2021.json').read_text())
d=json.loads(brotli.decompress((ROOT/'data/processed/kaliningrad-pilot.json.br').read_bytes()))
result=[]
for p in d['settlements']:
  total=p.get('population')
  typ='urban' if p.get('settlementType','').lower().strip() in ('г.','г','город','пгт','городской') else 'rural'
  if total is None:
    ages={'age0to17':None,'age18to54':None,'age55plus':None}
  else:
    rates=demo['splits'][typ]['shares']; keys=['age_0_17','age_18_54','age_55_plus']
    exact=[total*rates[k] for k in keys]
    values=[int(math.floor(x)) for x in exact]
    rest=total-sum(values)
    for idx in sorted(range(3),key=lambda i:(exact[i]-values[i]),reverse=True)[:rest]:values[idx]+=1
    ages=dict(zip(('age0to17','age18to54','age55plus'),values))
  result.append({'id':p['id'],'name':p['name'],'municipality':p['municipality'],'settlementType':p.get('settlementType'),
    'population2021':total,'populationSource':p.get('populationSourceUrl'),'modelledStructure':typ,'estimatedAges':ages})
payload={'regionId':'kaliningrad','totalSettlements':len(result),'datasetPopulation2021':sum(p.get('population') or 0 for p in d['settlements']),
  'rosstatReferencePopulation2021':demo['splits']['all']['population'],
  'rosstatAgeCounts':demo['splits']['all']['count'],'ageStructureSource':demo['sourceUrl'],
  'method':'Age counts per settlement = total settlement population in 2021 multiplied by official 2021 age share for Kaliningrad URBAN or RURAL residents; rounded preserving total.',
  'warning':'Age counts for individual settlements are ESTIMATES, not observed local Rosstat age data. 2021 census totals and 2021-01-01 population estimates differ; DO NOT substitute one total for the other. Age 18 is included with adults.',
  'settlements':result}
path=ROOT/'public/data/kaliningrad-settlement-ages-2021.json';path.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');print('Saved',len(result),'rows, total',payload['datasetPopulation2021'])
