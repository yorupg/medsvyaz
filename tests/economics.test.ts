import {describe,it,expect} from 'vitest';
import {constantCashFlow,emptyFinance,evaluateFinance,transportEffect,budgetMetrics,EconomicRequestSchema} from '../shared/economics';
import {calculate,compareScenario,validateDataset} from '../shared/engine';
import demo from '../data/examples/demo.json';
const comparison=()=>compareScenario(validateDataset(demo),{scenario:'improvement',edgeId:'ce',multiplier:1.5});
describe('Economic formulas and use of actual transport outputs',()=>{
 it('matches manual NPV, ROI and payback with zero discount',()=>{
  const f=constantCashFlow(100,60,2,0);expect(f.npv).toBe(20);expect(f.roi).toBe(.2);expect(f.paybackYears).toBeCloseTo(100/60);expect(f.discountedPaybackYears).toBeCloseTo(100/60);
  expect(f.flows.map(p=>p.discountedCumulative)).toEqual([-100,-40,20]);
 });
 it('discounts end-of-year flows and interpolates discounted payback',()=>{
  const f=constantCashFlow(100,60,2,.1);expect(f.npv).toBeCloseTo(-100+60/1.1+60/1.1**2,10);
  expect(f.discountedPaybackYears).toBeCloseTo(1+(100-60/1.1)/(60/1.1**2),10);
 });
 it('reports no payback for losses or a horizon too short and rejects invalid inputs',()=>{
  expect(constantCashFlow(100,-20,10,.1).paybackYears).toBeNull();expect(constantCashFlow(100,10,2,0).paybackYears).toBeNull();
  for(const values of [[0,1,2,0],[100,1,0,0],[100,1,1.5,0],[100,1,2,-.1],[100,Infinity,2,0]])expect(()=>constantCashFlow(values[0],values[1],values[2],values[3])).toThrow();
 });
 it('derives gains, crossed time threshold and saved time from real comparison points',()=>{
  const c=comparison(),e=transportEffect(c.baseline,c.after,30);
  const before=new Map(c.baseline.points.map(p=>[p.id,p]));
  const newly=c.after.points.filter(p=>p.score!==null&&p.minutes!==null&&p.minutes<=30&&(before.get(p.id)!.minutes===null||before.get(p.id)!.minutes!>30)).reduce((sum,p)=>sum+(p.population??0),0);
  expect(e.deltaIndex).toBeCloseTo(c.delta!,10);expect(e.newlyCoveredPopulation).toBe(newly);
  const affected=c.after.points.filter(p=>p.minutes!==null&&before.get(p.id)!.minutes!==null&&p.minutes<before.get(p.id)!.minutes!);
  expect(e.benefitingPopulation).toBe(affected.reduce((sum,p)=>sum+(p.population??0),0));
  expect(e.populationMinutesSaved).toBeCloseTo(affected.reduce((sum,p)=>sum+(p.population??0)*(before.get(p.id)!.minutes!-p.minutes!),0));
 });
 it('never substitutes unknown cost or zero new coverage with a finite cost ratio',()=>{
  const c=comparison(),e=transportEffect(c.baseline,c.after,360);
  expect(budgetMetrics(e,null,100).costPerIndexPoint).toBeNull();expect(budgetMetrics(e,100,100).costPerAdditionalResident).toBeNull();
  expect(budgetMetrics({...e,deltaIndex:0},100,100).costPerIndexPoint).toBeNull();
  expect(budgetMetrics(e,0,0).costPerIndexPoint).toBe(0);
 });
 it('keeps societal time benefits out of financial profit',()=>{
  const c=comparison(),e=transportEffect(c.baseline,c.after,60);
  const f=evaluateFinance({...emptyFinance,investment:100,annualTrips:1000,valueOfTime:600,annualOperatingCost:0,horizon:2,discountRate:0},e);
  expect(f.financial).toBeNull();expect(f.economic).not.toBeNull();
  expect(f.annualTimeBenefit).toBeCloseTo(1000*e.meanMinutesSavedForBeneficiaries/60*600);
  const cash=evaluateFinance({...f.inputs,annualCashBenefit:0},e);
  expect(cash.financial!.npv).toBe(-100);expect(cash.financial!.roi).toBe(-1);
  expect(cash.economic!.npv).toBe(f.economic!.npv);
 });
 it('does not invent missing financial values or turn population into annual trips',()=>{
  const c=comparison(),f=evaluateFinance(emptyFinance,transportEffect(c.baseline,c.after,60));
  expect(f.financial).toBeNull();expect(f.economic).toBeNull();expect(f.annualTimeBenefit).toBeNull();expect(f.economicMissing).toContain('annualTrips');
 });
 it('does not report a complete societal NPV when travel losses are not monetized',()=>{
  const c=comparison(),e=transportEffect(c.baseline,c.after,60);
  const f=evaluateFinance({...emptyFinance,investment:100,annualTrips:1000,valueOfTime:600,annualCashBenefit:0,annualOperatingCost:0,horizon:2,discountRate:0},{...e,populationMinutesSaved:-1});
  expect(f.financial!.npv).toBe(-100);expect(f.economic).toBeNull();expect(f.economicMissing).toContain('travelHarmNotMonetized');
 });
 it('rejects incompatible populations, versions and unsafe source links',()=>{
  const c=comparison();expect(()=>transportEffect(c.baseline,{...c.after,population:0},60)).toThrow();
  expect(()=>transportEffect(c.baseline,{...c.after,threshold:60},60)).toThrow();
  const input={regionId:'kaliningrad',budget:null,scenarios:[{id:'v',name:'V',edgeId:'ce',multiplier:1.5,cost:null,costSourceUrl:'javascript:alert(1)',costNote:'',finance:emptyFinance}]};
  expect(()=>EconomicRequestSchema.parse(input)).toThrow();
 });
});
