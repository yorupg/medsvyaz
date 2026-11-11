import {z} from 'zod';
import type {IndexResult} from './schema';

const amount=z.number().finite().min(0).max(1e12).nullable();
const webUrl=z.string().max(2000).url().refine(value=>['https:','http:'].includes(new URL(value).protocol)).nullable();
export const FinanceSchema=z.object({investment:amount,annualTrips:z.number().finite().min(0).max(1e10).nullable(),valueOfTime:amount,annualOperatingCost:amount,annualCashBenefit:amount,horizon:z.number().int().min(1).max(50).nullable(),discountRate:z.number().finite().min(0).max(1).nullable()}).strict();
export type FinanceInput=z.infer<typeof FinanceSchema>;
export const emptyFinance:FinanceInput={investment:null,annualTrips:null,valueOfTime:null,annualOperatingCost:null,annualCashBenefit:null,horizon:null,discountRate:null};
export const EconomicRequestSchema=z.object({regionId:z.string().min(1).max(120),threshold:z.number().finite().min(1).max(360).default(30),accessLimit:z.number().finite().min(1).max(360).default(60),timeScale:z.number().finite().min(.5).max(2).default(1),budget:amount,
 scenarios:z.array(z.object({id:z.string().min(1).max(100),name:z.string().min(1).max(150),edgeId:z.string().min(1).max(120),scenario:z.enum(['improvement','closure']).default('improvement'),multiplier:z.number().finite().min(1).max(3),cost:amount,costSourceUrl:webUrl,costNote:z.string().max(2000),finance:FinanceSchema}).strict()).min(1).max(5)
}).strict().refine(o=>new Set(o.scenarios.map(s=>s.id)).size===o.scenarios.length,'Идентификаторы вариантов должны быть уникальны');
export type EconomicRequest=z.infer<typeof EconomicRequestSchema>;
export function transportEffect(baseline:IndexResult,after:IndexResult,accessLimit:number){
 if(!Number.isFinite(accessLimit)||accessLimit<=0)throw new Error('Некорректный предел времени охвата');
 if(baseline.datasetId!==after.datasetId||baseline.datasetVersion!==after.datasetVersion||baseline.methodologyVersion!==after.methodologyVersion||baseline.threshold!==after.threshold||baseline.profile!==after.profile||baseline.period!==after.period||baseline.synthetic!==after.synthetic)throw new Error('Несопоставимые транспортные результаты');
 const before=new Map(baseline.points.map(p=>[p.id,p]));
 if(after.points.length!==before.size||after.population!==baseline.population)throw new Error('Для сравнения необходимо одинаковое население');
 let settlementMinutesSaved=0;
 let newlyCoveredSettlements=0,lostCoverageSettlements=0,benefitingSettlements=0;
 let populationMinutesSaved=0,benefitingPopulation=0,benefitingMinutes=0,newlyCoveredPopulation=0,lostCoveragePopulation=0,commonPopulation=0,baselineCoveredPopulation=0,afterCoveredPopulation=0;
 for(const point of after.points){
  const previous=before.get(point.id);if(!previous||previous.population!==point.population||(previous.score===null)!==(point.score===null))throw new Error('Состав расчётной когорты изменился');
  if(previous.score===null)continue;
  const population=point.population??0;
  const oldCovered=previous.minutes!==null&&previous.minutes<=accessLimit,newCovered=point.minutes!==null&&point.minutes<=accessLimit;
  if(oldCovered)baselineCoveredPopulation+=population;if(newCovered)afterCoveredPopulation+=population;
  if(newCovered&&!oldCovered){newlyCoveredPopulation+=population;newlyCoveredSettlements++;}if(oldCovered&&!newCovered){lostCoveragePopulation+=population;lostCoverageSettlements++;}
  if(previous.minutes===null||point.minutes===null)continue;
  const saved=previous.minutes-point.minutes;settlementMinutesSaved+=saved;commonPopulation+=population;populationMinutesSaved+=population*saved;
  if(saved>1e-9){benefitingSettlements++;benefitingPopulation+=population;benefitingMinutes+=population*saved;}
 }
 return {baselineIndex:baseline.value,afterIndex:after.value,deltaIndex:baseline.value!==null&&after.value!==null?after.value-baseline.value:null,
  baselineMeanMinutes:baseline.meanMinutes,afterMeanMinutes:after.meanMinutes,
  settlementMinutesSaved,populationMinutesSaved,meanMinutesSaved:commonPopulation?populationMinutesSaved/commonPopulation:null,
  meanMinutesSavedForBeneficiaries:benefitingPopulation?benefitingMinutes/benefitingPopulation:0,
  benefitingPopulation,newlyCoveredPopulation,lostCoveragePopulation,benefitingSettlements,newlyCoveredSettlements,lostCoverageSettlements,settlements:baseline.includedSettlements,settlementCoverage:baseline.settlementCoverage,weighting:baseline.weighting,baselineCoveredPopulation,afterCoveredPopulation,accessLimit,
  population:baseline.population,populationCoverage:baseline.populationCoverage,unreachableBefore:baseline.unreachablePopulation,unreachableAfter:after.unreachablePopulation,
  timeSavingDefinition:'Population-weighted time saving for one hypothetical trip per resident with finite times in both variants; not an annual trip count',
  annualTripBasis:'Annual trips of residents whose travel time improves; the annual volume must be entered as a scenario assumption'};
}
export type TransportEffect=ReturnType<typeof transportEffect>;
export function budgetMetrics(effect:TransportEffect,cost:number|null,budget:number|null){
 for(const value of [cost,budget])if(value!==null&&(!Number.isFinite(value)||value<0))throw new Error('Некорректная стоимость или бюджет');
 return {cost,costPerAdditionalSettlement:cost!==null&&effect.newlyCoveredSettlements>0?cost/effect.newlyCoveredSettlements:null,costPerIndexPoint:cost!==null&&effect.deltaIndex!==null&&effect.deltaIndex>1e-9?cost/effect.deltaIndex:null,
 costPerAdditionalResident:cost!==null&&effect.newlyCoveredPopulation>0?cost/effect.newlyCoveredPopulation:null,
 withinBudget:cost===null||budget===null?null:cost<=budget,
 status:cost===null?'missing_cost':effect.deltaIndex===null||effect.deltaIndex<=1e-9?'no_accessibility_gain':'comparable'};
}
export function constantCashFlow(investment:number,annualNet:number,horizon:number,discountRate:number){
 if(!Number.isFinite(investment)||investment<=0||!Number.isFinite(annualNet)||!Number.isInteger(horizon)||horizon<1||horizon>50||!Number.isFinite(discountRate)||discountRate<0||discountRate>1)throw new Error('Некорректные параметры денежного потока');
 let npv=-investment,cumulative=-investment,discountedPayback:number|null=null;
 const flows=[{year:0,net:-investment,discounted:-investment,cumulative:-investment,discountedCumulative:-investment}];
 for(let year=1;year<=horizon;year++){
  const discounted=annualNet/(1+discountRate)**year,previous=npv;
  cumulative+=annualNet;npv+=discounted;
  if(discountedPayback===null&&previous<0&&npv>=0&&discounted>0)discountedPayback=year-1+(-previous)/discounted;
  flows.push({year,net:annualNet,discounted,cumulative,discountedCumulative:npv});
 }
 const simple=annualNet>0?investment/annualNet:null;
 return {npv,roi:(annualNet*horizon-investment)/investment,paybackYears:simple!==null&&simple<=horizon?simple:null,discountedPaybackYears:discountedPayback,annualNet,flows};
}
export function evaluateFinance(input:FinanceInput,effect:TransportEffect){
 const f=FinanceSchema.parse(input);
 const sharedMissing=(['investment','annualOperatingCost','horizon','discountRate'] as const).filter(k=>f[k]===null);
 if(f.investment===0)sharedMissing.push('investment');
 const financialMissing=[...new Set([...sharedMissing,...(f.annualCashBenefit===null?['annualCashBenefit']:[])])];
 const economicMissing=[...new Set([...sharedMissing,...(f.annualTrips===null?['annualTrips']:[]),...(f.valueOfTime===null?['valueOfTime']:[])])];
 // This model values savings of beneficiaries. It must not claim to price travel
 // losses or lost routes using the same beneficiary-only trip assumption.
 if(effect.lostCoverageSettlements>0||effect.lostCoveragePopulation>0||effect.settlementMinutesSaved < -1e-9||effect.populationMinutesSaved < -1e-9)economicMissing.push('travelHarmNotMonetized');
 const annualTimeBenefit=f.annualTrips!==null&&f.valueOfTime!==null?f.annualTrips*effect.meanMinutesSavedForBeneficiaries/60*f.valueOfTime:null;
 const financial=financialMissing.length?null:constantCashFlow(f.investment!,f.annualCashBenefit!-f.annualOperatingCost!,f.horizon!,f.discountRate!);
 const economic=economicMissing.length?null:constantCashFlow(f.investment!,annualTimeBenefit!-f.annualOperatingCost!,f.horizon!,f.discountRate!);
 return {inputs:f,financial,economic,financialMissing,economicMissing,annualTimeBenefit,
  financialDefinition:'Direct annual cash inflows or budget cash savings minus operating costs. Time valuation is excluded.',
  economicDefinition:'Value of saved travel time minus operating costs; a societal benefit, not revenue or budget profit.',
  assumptions:['All entered financial parameters are scenario assumptions unless separately documented.','Constant annual volumes and costs; end-of-year flows; upfront investment at year 0.','Prices and discount rate must be consistent (all real or all nominal); no automatic inflation adjustment.','No terminal value, tax, financing structure or induced-trip benefits are assumed.']};
}
export const ECONOMICS_FORMULAS={version:'economics-2.0-settlement-index',indexCost:'C / ΔI (руб. за 1 балл из 100)',residentCost:'C / N_added, where t_before > accessLimit and t_after <= accessLimit',timeBenefit:'annualTrips_of_beneficiaries × meanMinutesSavedForBeneficiaries / 60 × valueOfTimeRubPerHour',npv:'−I₀ + Σₜ₌₁ᴴ CFₜ/(1+r)^t',roi:'(Σₜ₌₁ᴴ CFₜ − I₀)/I₀; undiscounted horizon ROI',payback:'I₀ / constant positive annual CF, only if within the selected horizon'};
