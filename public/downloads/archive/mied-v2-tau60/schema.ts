import { z } from 'zod';

const id = z.string().min(1).max(120);
const finite = z.number().finite();
export const DatasetSchema = z.object({
  id, version: id, title: z.string(), regionId: id, synthetic: z.boolean(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  profile: id, profileLabel: z.string(), mode: z.literal('car'), trip: z.literal('to-facility'),
  sourceIds: z.array(id).min(1), license: z.string().min(1), assumptions: z.array(z.string()),
  expectedPopulation: finite.nonnegative().nullable(),
  coverageLabel:z.string().optional(), metadata:z.record(z.string(),z.unknown()).optional(),
  nodes: z.array(z.object({id, x: finite, y: finite})).min(1).max(1000000),
  edges: z.array(z.object({id, from: id, to: id, minutes: finite.positive(), directed: z.boolean(), allowed: z.boolean(), speedSource: z.string().min(1),name:z.string().optional(),osmWayId:z.string().optional(),highway:z.string().optional(),lengthKm:finite.nonnegative().optional(),kind:z.enum(['road','access']).optional(),geometry:z.array(z.tuple([finite,finite])).optional()})).max(500000),
  settlements: z.array(z.object({id, name: z.string(), nodeId: id.nullable(), population: finite.nonnegative().nullable(), municipality: z.string(), provenance: z.string().min(1),settlementType:z.string().optional(),populationYear:z.number().int().optional(),populationSourceUrl:z.string().url().optional(),lat:finite.optional(),lon:finite.optional(),snapMeters:finite.nonnegative().optional()})).max(100000),
  facilities: z.array(z.object({id, name: z.string(), nodeId: id, profile: id, periods: z.array(z.enum(['day','night'])).min(1), verified: z.boolean(), provenance: z.string().min(1),facilityType:z.string().optional(),careProfile:z.string().optional(),administrativeArea:z.string().optional(),lat:finite.optional(),lon:finite.optional(),officialAddress:z.string().optional(),sourceUrl:z.string().optional(),osmId:z.string().optional()})).max(10000)
});
export type Dataset = z.infer<typeof DatasetSchema>;
export const CalculationSchema = z.object({
  threshold: z.number().finite().min(1).max(360).default(60),
  period: z.enum(['day', 'night']).default('day'),
  scenario: z.enum(['baseline', 'improvement', 'closure']).default('baseline'),
  timeScale:z.number().finite().min(0.5).max(2).default(1),
  edgeId: id.optional(), multiplier: z.number().finite().min(1).max(3).default(1.5),
  cost: z.number().finite().positive().max(1e12).nullable().default(null)
}).strict();
export type CalculationOptions = z.infer<typeof CalculationSchema>;
export type QualityStatus = 'verified' | 'partial' | 'needs_review' | 'no_data' | 'calculation_error';
export type Region = { id:string; slug:string; name:string; districtId:string|null; type:string; isoCode:string|null; officialCode?:string|null; disputed?:boolean; geometryId?:string|null; geometryStatus?:string; population?:number|null; dataStatus?:QualityStatus; synthetic?:boolean; indexValue?:number|null; datasetId?:string; profileLabel?:string; settlementCount?:number; studyLabel?:string };
export type PointResult = {id:string; name:string; municipality:string; population:number|null; minutes:number|null; score:number|null; status:'reachable'|'unreachable'|'route_unverified'|'missing_population'|'missing_node'; facilityId:string|null; path:string[]};
export type IndexResult = {
  value:number|null; unit:'points'; status:QualityStatus; synthetic:boolean; methodologyVersion:string;
  datasetId:string; datasetVersion:string; sourceIds:string[]; period:'day'|'night'; profile:string; threshold:number;
  numerator:number; population:number; populationCoverage:number|null; expectedPopulation:number|null;
  includedSettlements:number; missingSettlements:number; unreachableSettlements:number;
  unverifiedRoutes:number;
  reachablePopulation:number; withinThresholdPopulation:number; withinThresholdShare:number|null;
  withinMinutesShares:Record<'30'|'60'|'90'|'120',number|null>;
  meanMinutes:number|null; medianMinutes:number|null; points:PointResult[]; warnings:string[];
};
export const METHODOLOGY = {id:'mied-car-v2',version:'2.0.0',status:'Базовая модель автомобильной доступности',defaultThreshold:60,allowedThresholds:[30,45,60,90],thresholdUnit:'минуты',profileRule:'Сравниваются только одинаковые профили, периоды, параметры τ и версии данных',formula:'Iᴿ(car)=100 × Σ[pᵢ 2^(−tᵢ/τ)] / Σpᵢ'};
export const DISTRICTS = [
  {id:'central',name:'Центральный',short:'ЦФО'}, {id:'northwestern',name:'Северо-Западный',short:'СЗФО'},
  {id:'southern',name:'Южный',short:'ЮФО'}, {id:'north-caucasian',name:'Северо-Кавказский',short:'СКФО'},
  {id:'volga',name:'Приволжский',short:'ПФО'}, {id:'ural',name:'Уральский',short:'УФО'},
  {id:'siberian',name:'Сибирский',short:'СФО'}, {id:'far-eastern',name:'Дальневосточный',short:'ДФО'}
];
export const INDEX_SCALE = [
  {min:0,max:20,color:'#da6667',label:'0–20'}, {min:20,max:40,color:'#e99a5b',label:'20–40'},
  {min:40,max:60,color:'#e7c85f',label:'40–60'}, {min:60,max:80,color:'#9bc685',label:'60–80'},
  {min:80,max:100,color:'#2b9978',label:'80–100'}
];
export function indexColor(value:number|null) {
 if(value===null||!Number.isFinite(value))return '#c5ced4';
 const t=Math.max(0,Math.min(100,value))/25,i=Math.min(3,Math.floor(t)),fraction=t-i;
 const stops=['#da6667','#e99a5b','#e7c85f','#9bc685','#2b9978'];
 const rgb=(hex:string)=>[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16));
 const a=rgb(stops[i]),b=rgb(stops[i+1]);
 return '#'+a.map((channel,n)=>Math.round(channel+(b[n]-channel)*fraction).toString(16).padStart(2,'0')).join('');
}
