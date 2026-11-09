/** Reproduce each real pilot and keep synthetic results separate. */
import {writeFileSync,copyFileSync,readFileSync} from 'node:fs';
import {calculate} from '../shared/engine';
import {studyDatasets,realDatasets,baselineResults,studyComparison,scenariosFor} from '../server/study';
const reports=Object.entries(studyDatasets).map(([regionId,d])=>({regionId,synthetic:d.synthetic,label:d.synthetic?'Синтетическая сеть — не оценка региона':'Реальные исходники, модельное время',datasetId:d.id,version:d.version,index:baselineResults[regionId].value,population:baselineResults[regionId].population,coverage:baselineResults[regionId].populationCoverage,settlements:d.settlements.length}));
const cell=(v:unknown)=>'"'+String(v??'').replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';
const pilots=process.argv.includes('--synthetic-only')?JSON.parse(readFileSync('data/derived/study-summary.json','utf8')).pilots:Object.fromEntries(Object.entries(realDatasets).map(([regionId,d])=>{
 const scenarios=scenariosFor(d).map(edge=>({edge,...Object.fromEntries(['baseline','improvement','closure'].map(scenario=>{const c=studyComparison(regionId,{scenario:scenario as 'baseline'|'improvement'|'closure',edgeId:edge.id})!;return [scenario,{index:c.after.value,delta:c.delta,affectedPopulation:c.affectedPopulation,unreachableSettlements:c.after.unreachableSettlements}];}))}));
 const calculation={...d,edges:d.edges.map(({geometry,...e})=>e)};
 const sensitivity=[30,45,60,90,120].flatMap(threshold=>[.8,1,1.2].map(timeScale=>{const r=calculate(calculation,{threshold,timeScale});return {threshold,timeScale,index:r.value,withinThresholdShare:r.withinThresholdShare,meanMinutes:r.meanMinutes};}));
 const prefix=regionId==='kaliningrad'?'pilot':regionId;
 writeFileSync('data/derived/'+prefix+'-calculation.csv','\uFEFF'+[['Тип данных','Реальные исходники; модельное время; ВПН-2021; T=60'],['Пункт','Муниципалитет','Население','Время, мин','Баллы 0–100','Статус','Больница'],...baselineResults[regionId].points.map(p=>[p.name,p.municipality,p.population,p.minutes,p.score===null?null:p.score*100,p.status,p.facilityId])].map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n');
 for(const file of [prefix+'-calculation.csv',prefix+'-independent-check.json'])copyFileSync('data/derived/'+file,'public/downloads/'+file);
 copyFileSync(regionId==='kaliningrad'?'data/raw/pilot/kaliningrad_settlements_2021.csv':'data/raw/'+regionId+'/settlements-2021.csv','public/downloads/'+regionId+'-settlements-2021.csv');
 copyFileSync('data/raw/'+(regionId==='kaliningrad'?'pilot':regionId)+'/facilities_verified.json','public/downloads/'+(regionId==='kaliningrad'?'pilot':regionId)+'-facilities.json');
 return [regionId,{scenarios,sensitivity,independentCheck:'data/derived/'+prefix+'-independent-check.json'}];
}));
const summary={preparedAt:'2026-11-09',nationalIndex:null,reason:'Real and synthetic datasets are never combined into a national index; selected facilities do not establish a clinical-quality ranking',reports,pilots};
writeFileSync('data/derived/study-summary.json',JSON.stringify(summary,null,2)+'\n');
for(const f of ['study-summary.json','synthetic-calibration.json'])copyFileSync('data/derived/'+f,'public/downloads/'+f);
copyFileSync('data/raw/pilot/registry_2026.xlsx','public/downloads/registry_2026.xlsx');
console.table(reports.filter(r=>!r.synthetic));
