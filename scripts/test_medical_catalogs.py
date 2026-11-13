#!/usr/bin/env python3
"""Offline regression checks for bundled medical catalogs and proposals."""
import json, math
from pathlib import Path
R=Path(__file__).resolve().parents[1]
folder=R/'public/data/medical-catalogs'
files=list(folder.glob('*.json'))
assert len(files)==85, f'Expected 85 catalogs, found {len(files)}'
real=[];synthetic=[]
for f in files:
    d=json.loads(f.read_text('utf-8'))
    assert d['regionId']==f.stem, f
    entries=d['facilities']
    assert isinstance(entries,list)
    ids=[p['id'] for p in entries]
    assert len(ids)==len(set(ids)),f'Duplicate ID in {f.name}'
    for v in entries:
        assert v['type'] in ('public_hospital','public_adult_polyclinic','public_children_polyclinic','private_paid')
        assert math.isfinite(v['lat']) and -90<=v['lat']<=90
        assert math.isfinite(v['lon']) and -180<=v['lon']<=180
        if d['synthetic']:assert v.get('sourceClass')=='synthetic'
        if v.get('sourceClass')=='osm-snapshot':assert v.get('officiallyVerified') is not True
    (synthetic if d['synthetic'] else real).append(f)
assert len(real)==33 and len(synthetic)==52,(len(real),len(synthetic))
for scenario in ['public-medical-proposals','private-clinic-proposals']:
    d=json.loads((R/f'public/data/kaliningrad-{scenario}.json').read_text('utf-8'))
    assert d['scoreModel']=='hospital-0.55+polyclinic-0.35+robust-0.10'
    assert len(d['candidates'])==3
    assert abs(d['indexAfterThree']-d['baselineIndex']-d['totalGain'])<.0002
    items=d['portfolio']['pointResults']
    assert len(items)==964
    assert len([p for p in items if p['afterScore'] is not None])==959
    print(scenario, d['baselineIndex'], d['indexAfterThree'], d['totalGain'])
print('PASS: catalogs 33 real + 52 synthetic; coordinates and proposals valid')
