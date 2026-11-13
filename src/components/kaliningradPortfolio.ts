import type {IndexResult} from '../../shared/schema';

export type PortfolioPoint = {
  id:string;
  baselineMinutes:number|null;
  afterMinutes:number|null;
  baselineClinicMinutes?:number|null;
  afterClinicMinutes?:number|null;
  baselineScore:number|null;
  afterScore:number|null;
  afterFacilityId:string;
  afterBackupMinutes:number|null;
  afterRobustMinutes:number|null;
};

export type MedicalProposalKind='public_hospital_polyclinic'|'private_paid_clinic';
export type MedicalProposalClass='public_integrated'|'private_paid';

export type MedicalProposal = {
  id:string;
  rank:number;
  kind:MedicalProposalKind;
  proposalClass:MedicalProposalClass;
  careLevel:'integrated-hospital-and-polyclinic'|'paid-outpatient-clinic';
  name:string;
  lat:number;
  lon:number;
  settlement:string;
  municipality:string;
  population:number;
  snapDistanceMeters:number;
  nearestExistingHospitalKm:number;
  nearestExistingPolyclinicKm:number;
  nearestPrivateClinicKm?:number;
  nearbyPublicPolyclinics15km:number;
  affectedSettlements:number;
  capturedPeople:number;
  weightedCapture:number;
  baselineIndex:number;
  previousPortfolioIndex:number;
  indexAfter:number;
  indexIncrement:number;
  rankScore:number;
  rankImpact:number;
  impactType:string;
  estimatedAge:{children0_17:number;adults18_54:number;older55_plus:number};
};

export type MedicalProposalCatalog = {
  regionId:string;
  methodologyVersion:string;
  proposalClass:MedicalProposalClass;
  scoreModel:string;
  computedWith:string;
  baselineIndex:number;
  indexAfterThree:number;
  totalGain:number;
  candidates:MedicalProposal[];
  sourceUrls:string[];
  ageEstimates:string;
  coverageDefinition:string;
  validation:string;
  selectionCaveat?:string;
  selectionPolicy?:string;
  medicalScope?:string;
  populationCounts?:string;
  ageWeights?:Record<string,number>;
  portfolio:{
    affectedPopulation:number;
    affectedSettlements:number;
    includedSettlements:number;
    medianMinutes:number;
    p90Minutes:number;
    withinMinutesShares:Record<'30'|'60'|'90'|'120',number>;
    pointResults:PortfolioPoint[];
  };
};

function applyPointScores(baseline:IndexResult,catalog:MedicalProposalCatalog,mode:'baseline'|'after'):IndexResult {
  const changes=new Map(catalog.portfolio.pointResults.map(p=>[p.id,p]));
  const points=baseline.points.map(p=>{
    const x=changes.get(p.id);
    if(!x)return p;
    return {
      ...p,
      minutes:mode==='baseline'?x.baselineMinutes:x.afterMinutes,
      clinicMinutes:mode==='baseline'?x.baselineClinicMinutes??null:x.afterClinicMinutes??null,
      score:mode==='baseline'?x.baselineScore:x.afterScore,
      facilityId:mode==='after'?(x.afterFacilityId||p.facilityId):p.facilityId,
      backupMinutes:mode==='after'?x.afterBackupMinutes:p.backupMinutes,
      robustMinutes:mode==='after'?x.afterRobustMinutes:p.robustMinutes,
      path:p.path,
    };
  });
  const included=points.filter(p=>p.score!==null);
  const reachable=points.filter(p=>p.minutes!==null && p.score!==null);
  const within=reachable.filter(p=>(p.minutes??Infinity)<=baseline.threshold);
  const population=included.reduce((sum,p)=>sum+(p.population??0),0);
  const denominator=included.length;
  const numerator=included.reduce((sum,p)=>sum+
    p.score!*(0.752/Math.max(1,denominator)+0.248*(p.population??0)/Math.max(1,population)),0);
  const resultValue=mode==='baseline'?catalog.baselineIndex:catalog.indexAfterThree;
  const quantile=(key:'minutes'|'clinicMinutes',q:number)=>{
    const values=points.map(p=>p[key]).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)).sort((a,b)=>a-b);
    return values.length?values[Math.max(0,Math.ceil(values.length*q)-1)]:null;
  };
  return {
    ...baseline,
    value:resultValue,
    numerator,
    denominator:denominator?1:0,
    population,
    territorialIndex:denominator?100*included.reduce((sum,p)=>sum+p.score!,0)/denominator:null,
    populationIndex:population?100*included.reduce((sum,p)=>sum+(p.population??0)*p.score!,0)/population:null,
    points,
    includedSettlements:catalog.portfolio.includedSettlements,
    meanMinutes:reachable.length?reachable.reduce((n,p)=>n+(p.minutes??0),0)/reachable.length:null,
    medianMinutes:mode==='after'?catalog.portfolio.medianMinutes:baseline.medianMinutes,
    p90Minutes:quantile('minutes',0.9),
    hospitalP90Minutes:quantile('minutes',0.9),
    clinicMedianMinutes:quantile('clinicMinutes',0.5),
    clinicP90Minutes:quantile('clinicMinutes',0.9),
    withinThresholdSettlements:within.length,
    withinThresholdShare:denominator?within.length/denominator:null,
    withinMinutesShares:mode==='after'?catalog.portfolio.withinMinutesShares:baseline.withinMinutesShares,
    withinThresholdPopulation:within.reduce((sum,p)=>sum+(p.population??0),0),
    warnings:[...(baseline.warnings??[]),
      mode==='after'
        ? 'Калининградский пользовательский индекс: 55% — ближайшая больница, 35% — ближайшая поликлиника, 10% — устойчивость больничного маршрута. Возрастные группы использованы только для выбора мест новых объектов.'
        : 'Показана пользовательская базовая версия индекса для Калининградской области: 55% — ближайшая больница, 35% — ближайшая поликлиника, 10% — устойчивость больничного маршрута.'
    ],
  };
}

export function proposalBaselineResult(baseline:IndexResult,catalog:MedicalProposalCatalog):IndexResult {
  return applyPointScores(baseline,catalog,'baseline');
}

export function portfolioResult(baseline:IndexResult,catalog:MedicalProposalCatalog):IndexResult {
  return applyPointScores(baseline,catalog,'after');
}
