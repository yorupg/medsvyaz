import {describe,it,expect} from 'vitest';
import {createApi} from '../server/api';
import {studyDatasets,scenariosFor,studyComparison} from '../server/study';
import {emptyFinance} from '../shared/economics';
const app=createApi();
describe('Economics API',()=>{
 it('evaluates actual road alternatives, ranks only affordable improving variants and reports provenance',async()=>{
  const edgeId=scenariosFor(studyDatasets.kaliningrad)[0].id;
  const scenario=(id:string,multiplier:number,cost:number|null)=>({id,name:id,edgeId,multiplier,cost,costSourceUrl:null,costNote:'Test fixture; not actual financial data',finance:emptyFinance});
  const response=await app.request('/economics/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({regionId:'kaliningrad',budget:1000,scenarios:[scenario('a',1.5,500),scenario('b',2,2000),scenario('unknown',3,null)]})});
  expect(response.status).toBe(200);const data=await response.json();
  const actual=studyComparison('kaliningrad',{scenario:'improvement',edgeId,multiplier:1.5})!;
  expect(data.rows[0].transport.deltaIndex).toBeCloseTo(actual.delta!,9);
  expect(data.rows[0].provenance.datasetId).toBe(studyDatasets.kaliningrad.id);expect(data.rows[0].finance.financial).toBeNull();
  expect(data.recommendation.mostIndexGainWithinBudget).toBe('a');expect(data.recommendation.excludedUnknownCosts).toEqual(['unknown']);
  expect(data.rows[0].costEvidence.officialProjectMatchVerified).toBe(false);
 },30000);
 it('rejects invalid horizons, unknown regions and unknown roads',async()=>{
  const s={id:'a',name:'a',edgeId:'missing',multiplier:1.5,cost:null,costSourceUrl:null,costNote:'',finance:emptyFinance};
  const send=(regionId:string,scenario=s)=>app.request('/economics/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({regionId,budget:null,scenarios:[scenario]})});
  expect((await send('missing')).status).toBe(404);expect((await send('kaliningrad')).status).toBe(400);
  expect((await send('kaliningrad',{...s,finance:{...emptyFinance,horizon:0}})).status).toBe(400);
 });
});
