#!/usr/bin/env python3
"""Public, reproducible evidence audit for medical sites in all 33 real regions.

Unlike a map tag, a hospital's public-OМС participation and clinical profile
require checking original documents. This script records the gap without
inventing that verification. Sources in the three original pilots are marked
separately from OSM-only expanded regions.
"""
import brotli
import csv
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/downloads'

def load(id,expanded):
    path=ROOT/('data/processed/expanded/'+id+'.json.br' if expanded else 'data/processed/'+id+'-pilot.json.br')
    return json.loads(brotli.decompress(path.read_bytes()))

def main():
    regions=[(p.stem[:-8],True) for p in sorted((ROOT/'data/processed/expanded').glob('*-summary.json'))]
    regions += [(id,False) for id in ('kaliningrad','ivanovo','pskov')]
    result={}; pending=[]
    for id,expanded in regions:
        d=load(id,expanded)
        facilities=d['facilities']
        profileConfirmed=not expanded
        counts={'regionId':id,'datasetId':d['id'],'facilityCount':len(facilities),
            'officiallySelected':len(facilities) if profileConfirmed else 0,
            'osmOnly':len(facilities) if expanded else 0,
            'withAddress':sum(bool(f.get('officialAddress','').strip()) for f in facilities),
            'withCoordinates':sum(f.get('lon') is not None and f.get('lat') is not None for f in facilities),
            'medicalProfileConfirmed':profileConfirmed,
            'level':'pilot-official-selection' if profileConfirmed else 'osm-only',
            'meaning':'Подбор больниц по официальным подтверждающим источникам; профиль лечения и приём пациентов не подтверждены' if profileConfirmed else 'Есть именованный hospital-тег OSM; официальный реестр, клинический профиль и приём пациентов не сверены',
            'registryCheckRequired':expanded}
        result[id]=counts
        if expanded:
            for f in facilities:
                pending.append({'regionId':id,'osmId':f.get('osmId',''),'facilityId':f['id'],
                    'osmName':f['name'],'osmAddress':f.get('officialAddress') or '',
                    'osmUrl':f.get('sourceUrl',''), 'officialName':'', 'officialAddress':'',
                    'officialRegistryUrl':'','profileConfirmed':'','reviewedAt':'','reviewer':''})
    (ROOT/'data/derived/medical-facility-coverage.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    (OUT/'medical-facility-coverage.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    with (OUT/'medical-facilities-needing-verification.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(pending[0]));writer.writeheader();writer.writerows(pending)
    print('Regions:',len(result),'OSM-only facilities requiring registry/profile verification:',len(pending),
          'with OSM address:',sum(bool(p['osmAddress']) for p in pending))
    return result

if __name__=='__main__':main()
