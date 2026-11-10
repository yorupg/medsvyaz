#!/usr/bin/env python3
"""Independent per-origin reweighting. Never transform aggregate indices or edit inputs."""
import csv,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/derived'
PUBLIC=ROOT/'public/downloads'
NAMES={r['id']:r['name'] for r in json.loads((ROOT/'data/regions.json').read_text())}
TAUS=(20,30,45,60)

def save(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def quantile(points,q):
    total=sum(p['population'] for p in points)
    if not total:return None
    cumulative=0
    for p in sorted(points,key=lambda p:p['minutes']):
        cumulative+=p['population']
        if cumulative>=total*q:return p['minutes']

def main():
    rows=[];checks=[]
    for rid in [r['id'] for r in json.loads((ROOT/'data/target-regions.json').read_text())]:
        prefix='pilot' if rid=='kaliningrad' else rid
        if rid in ['kaliningrad','ivanovo','pskov']:
            source=OUT/(prefix+'-independent-points.json')
            points=json.loads(source.read_text())
            dataset=json.loads((ROOT/('data/processed/'+rid+'-pilot.json')).read_text())
            expected=dataset['expectedPopulation'];profile=dataset['profile'];facility_count=len(dataset['facilities'])
        else:
            source=ROOT/('data/processed/expanded/'+rid+'-summary.json')
            dataset=json.loads(source.read_text());points=dataset['baselinePoints']
            expected=dataset['expectedPopulation'];profile=dataset['profile'];facility_count=dataset['facilityCount']
        reachable=[p for p in points if p['status']=='reachable' and p['minutes'] is not None and p['population'] is not None]
        population=sum(p['population'] for p in reachable)
        def index(tau):return 100*sum(p['population']*2**(-p['minutes']/tau) for p in reachable)/population if population else None
        old,new=index(60),index(30)
        legacy=json.loads((PUBLIC/('archive/mied-v2-tau60/'+prefix+'-independent-check.json')).read_text())
        assert abs(old-legacy['index'])<1e-9,(rid,'legacy mismatch')
        excluded=expected-population
        median,p90=quantile(reachable,.5),quantile(reachable,.9)
        over={str(t):sum(p['population'] for p in reachable if p['minutes']>t)/population if population else None for t in (60,90)}
        bounds={'lower':new*population/expected if expected else None,'upper':(new*population+100*excluded)/expected if expected else None}
        check={'methodologyVersion':'3.0.0','tau':30,'period':'day','profile':profile,'index':new,
            'legacyIndexTau60':old,'includedPopulation':population,'sourcePopulation':expected,'populationCoverage':population/expected,
            'excludedPopulation':excluded,'indexBounds':bounds,'includedSettlements':len(reachable),'medianMinutes':median,
            'p90Minutes':p90,'overMinutesShares':over,'sensitivity':[{'threshold':tau,'index':index(tau)} for tau in TAUS],
            'sourceTimeFile':str(source.relative_to(ROOT)),'sourceTimeFileSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'method':'Independent Python sum of population × 2**(-origin_minutes/tau); stored point scores and regional indices are not inputs'}
        for directory in (OUT,PUBLIC):
            save(directory/(prefix+'-independent-check.json'),check)
            save(directory/(prefix+'-independent-check-v3.json'),check)
            with (directory/(prefix+'-calculation.csv')).open('w',encoding='utf-8-sig',newline='') as f:
                w=csv.writer(f,delimiter=';');w.writerow(['Методика','ID пункта','Пункт','Население','Время, мин','Коэффициент τ=30','Вклад, баллы','Статус','Больница'])
                for p in points:
                    score=2**(-p['minutes']/30) if p['status']=='reachable' and p['minutes'] is not None else None
                    w.writerow(['МИЭД v3.0; τ=30',p['id'],p['name'],p['population'],p['minutes'],score,100*p['population']*score/population if score is not None else None,p['status'],p.get('facilityId')])
        rows.append({'regionId':rid,'name':NAMES[rid],'synthetic':False,'profile':profile,
            'facilityEvidence':'official-source' if profile!='mapped-hospital' else 'osm-unverified-profile',
            'before':old,'after':new,'delta':new-old,'population':population,'sourcePopulation':expected,
            'coverage':population/expected,'excludedPopulation':excluded,'indexBounds':bounds,'medianMinutes':median,
            'p90Minutes':p90,'overMinutesShares':over,'settlements':len(points),'facilities':facility_count,'sensitivity':check['sensitivity']})
        checks.append(check)
        print(rid,f'{old:.6f} -> {new:.6f}',flush=True)
    result={'previousMethodology':{'version':'2.0.0','tau':60},'currentMethodology':{'version':'3.0.0','tau':30},
        'calculationRule':'Each index independently evaluated from per-origin times; unchanged road graph, facility selection and population cohort',
        'tailShareDenominator':'Population with a finite computed route; unreachable and unresolved population reported separately',
        'rows':rows}
    for directory in (OUT,PUBLIC):
        save(directory/'methodology-comparison.json',result)
        with (directory/'regional-indices-before-after.csv').open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.writer(f,delimiter=';');w.writerow(['Регион','Профиль данных','τ=60, v2.0','τ=30, v3.0','Изменение, п.п.','Покрытие','Медиана, мин','P90, мин','Доля >60 мин','Доля >90 мин','Население без оценки','Нижняя граница','Верхняя граница'])
            for r in rows:w.writerow([r['name'],r['facilityEvidence'],r['before'],r['after'],r['delta'],r['coverage'],r['medianMinutes'],r['p90Minutes'],r['overMinutesShares']['60'],r['overMinutesShares']['90'],r['excludedPopulation'],r['indexBounds']['lower'],r['indexBounds']['upper']])
    print('Independently recalculated',len(rows),'regions from origin times.')

if __name__=='__main__':main()
