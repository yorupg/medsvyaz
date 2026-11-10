import {EconomicRequestSchema,transportEffect,budgetMetrics,evaluateFinance,ECONOMICS_FORMULAS} from '../shared/economics';
import {studyDatasets,studyComparison,studyCatalogue} from './study';
import sources from '../data/economic-sources.json';
export {EconomicRequestSchema};
export function evaluateEconomics(input:unknown){
 const request=EconomicRequestSchema.parse(input),d=studyDatasets[request.regionId];
 if(!d)throw new Error('Регион не содержит расчётного набора');
 for(const s of request.scenarios)if(!d.edges.some(e=>e.id===s.edgeId))throw new Error('Дорожный участок не найден: '+s.edgeId);
 const rows=request.scenarios.map(s=>{
  const comparison=studyComparison(request.regionId,{threshold:request.threshold,timeScale:request.timeScale,scenario:s.scenario,edgeId:s.edgeId,multiplier:s.multiplier})!;
  const transport=transportEffect(comparison.baseline,comparison.after,request.accessLimit);
  return {id:s.id,name:s.name,edgeId:s.edgeId,scenario:s.scenario,multiplier:s.multiplier,
   transport,budget:budgetMetrics(transport,s.cost,request.budget),finance:evaluateFinance(s.finance,transport),
   costEvidence:{kind:'scenario_assumption',url:s.costSourceUrl,note:s.costNote,officialProjectMatchVerified:false},
   provenance:{regionId:request.regionId,datasetId:d.id,datasetVersion:d.version,methodologyVersion:comparison.after.methodologyVersion,threshold:comparison.after.threshold,profile:d.profile,synthetic:d.synthetic,facilityEvidence:comparison.after.facilityEvidence,sourceIds:d.sourceIds}};
 });
 const known=rows.filter(row=>row.budget.status==='comparable');
 const efficiency=[...known].sort((a,b)=>a.budget.costPerIndexPoint!-b.budget.costPerIndexPoint!);
 const feasible=known.filter(row=>row.budget.withinBudget===true).sort((a,b)=>b.transport.deltaIndex!-a.transport.deltaIndex!||a.budget.cost!-b.budget.cost!);
 const residents=[...known].filter(row=>row.budget.costPerAdditionalResident!==null).sort((a,b)=>a.budget.costPerAdditionalResident!-b.budget.costPerAdditionalResident!);
 return {formulaVersion:ECONOMICS_FORMULAS.version,regionId:request.regionId,title:studyCatalogue[request.regionId].title,request,rows,
  recommendation:{mostIndexGainWithinBudget:feasible[0]?.id??null,lowestCostPerIndexPoint:efficiency[0]?.id??null,lowestCostPerAdditionalResident:residents[0]?.id??null,
    excludedUnknownCosts:rows.filter(r=>r.budget.cost===null).map(r=>r.id),
    rule:'Mutually exclusive alternatives: maximize accessibility gain among affordable alternatives. Benefits of different roads are not added; a combined project requires a new transport calculation.'},
  formulas:ECONOMICS_FORMULAS,sources,
  caveats:['Транспортные эффекты получены расчётным движком из сценарного изменения дорожного времени, а не измерением эффекта реальных работ.','Ни одного подтверждённого совпадения выбранных модельных OSM-way с проектной сметой нет. Стоимость и финансовые вводные остаются сценарными; официальные бюджетные публикации доступны как ориентиры.','Затронутые жители не являются годовым пассажиропотоком. Экономия времени не является прямым денежным доходом.']};
}
export type EconomicEvaluation=ReturnType<typeof evaluateEconomics>;
