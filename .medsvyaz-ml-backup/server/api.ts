import {evaluateEconomics,EconomicRequestSchema} from './economics';
import economicSources from '../data/economic-sources.json';
import {readFileSync,existsSync} from 'node:fs';
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {secureHeaders} from 'hono/secure-headers';
import {z} from 'zod';
import regionsRaw from '../data/regions.json';
import targetRegions from '../data/target-regions.json';
import targetSettlementSamples from '../data/processed/target-settlement-samples.json';
import geometry from '../data/processed/geometries.json';
import demoRaw from '../data/examples/demo.json';
import exampleKaliningrad from '../data/examples/kaliningrad.json';
import exampleIvanovo from '../data/examples/ivanovo.json';
import exampleTyumen from '../data/examples/tyumen.json';
import examplesManifest from '../data/examples/manifest.json';
import points from '../data/derived/representative-points.json';
import geodataManifest from '../data/derived/geodata-manifest.json';
import sources from '../data/sources.json';
import {DISTRICTS,METHODOLOGY,LEGACY_METHODOLOGY,POPULATION_METHODOLOGY,CalculationSchema,type Dataset,type Region} from '../shared/schema';
import {calculate,compareScenario,validateDataset,summarizePoints} from '../shared/engine';
import {openapi} from './openapi';
import {RELEASE} from '../shared/release';
import {realDatasets,pilot,studyDatasets,baselineResults,studyDescription,studyComparison,studyMap,studyRoute,studyCatalogue,studyRoadOptions,studyDatasetIds,realRegionIds,isRealRegion,aggregateCohorts} from './study';

export interface RunStore {save(id:string,payload:unknown):Promise<void>;get(id:string):Promise<unknown|null>}
const examples:Record<string,Dataset>={kaliningrad:validateDataset(exampleKaliningrad),ivanovo:validateDataset(exampleIvanovo),tyumen:validateDataset(exampleTyumen)};
const exampleList=examplesManifest.map(item=>{const dataset=examples[item.regionId]; const baseline=calculate(dataset,{threshold:METHODOLOGY.defaultThreshold}); const improvement=compareScenario(dataset,{threshold:METHODOLOGY.defaultThreshold,scenario:'improvement',edgeId:'ce',multiplier:1.5}); const closure=compareScenario(dataset,{threshold:METHODOLOGY.defaultThreshold,scenario:'closure',edgeId:'ce'}); return {...item,referencePoint:points[item.regionId as keyof typeof points]??null,baseline,improvement:{value:improvement.after.value,delta:improvement.delta,affectedPopulation:improvement.affectedPopulation},closure:{value:closure.after.value,delta:closure.delta,affectedPopulation:closure.affectedPopulation}};});
const geometryFeatures=geometry.features as unknown as {properties:{regionId:string};geometry:unknown;type:string}[];
const geometryIds=new Set(geometryFeatures.map(f=>f.properties.regionId));
export const regions:Region[]=regionsRaw.map(r=>{const d=studyCatalogue[r.id];return {...r,slug:r.id,geometryId:geometryIds.has(r.id)?r.id:null,geometryStatus:geometryIds.has(r.id)?'historical':'missing',population:d?.expectedPopulation??null,dataStatus:!d?'no_data':d.synthetic?'needs_review':baselineResults[r.id].status,synthetic:d?.synthetic??false,indexValue:baselineResults[r.id]?.value??null,facilityEvidence:baselineResults[r.id]?.facilityEvidence,populationCoverage:baselineResults[r.id]?.populationCoverage??null,indexBounds:baselineResults[r.id]?.indexBounds,datasetId:d?.id,profileLabel:d?.profileLabel,settlementCount:d?.settlementCount,studyLabel:!d?'Нет данных':d.synthetic?'Синтетическая модель':'Реальные исходные данные'};});
const missing=(regionId:string|null=null)=>({value:null,unit:'points',status:'no_data',coverage:{population:null,regions:0},methodologyVersion:METHODOLOGY.version,sourceIds:[],period:null,profile:null,regionId,warnings:['Для расчёта нужны согласованные данные населения, графа и подходящих медицинских учреждений.']});
const aliases:Record<string,string>={'kaliningrad-oblast':'kaliningrad','moscow-region':'moscow-oblast'};
function lookup(id:string){return regions.find(r=>r.id===id)??regions.find(r=>r.id===aliases[id]);}
export function createApi(store?:RunStore){
 const app=new Hono();
 app.use('*',secureHeaders());
 app.use('*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('X-MedSvyaz-Version',RELEASE);await next();});
 app.use('*',bodyLimit({maxSize:2*1024*1024,onError:c=>c.json({error:'Размер запроса превышает 2 МБ'},413)}));
 app.onError((err,c)=>{if(err instanceof z.ZodError)return c.json({error:'Некорректные параметры',details:err.issues.map(i=>({path:i.path,message:i.message}))},400);console.error('[api]',err.message);return c.json({error:'Не удалось выполнить запрос. Проверьте параметры и повторите попытку.'},500);});
 app.get('/economics/sources',c=>c.json(economicSources));
 app.post('/economics/evaluate',async c=>{const input=EconomicRequestSchema.parse(await c.req.json());if(!studyCatalogue[input.regionId])return c.json({error:'Регион не содержит расчётного набора'},404);const d=studyDatasets[input.regionId];if(input.scenarios.some(s=>!d.edges.some(e=>e.id===s.edgeId)))return c.json({error:'Дорожный участок не найден'},400);return c.json(evaluateEconomics(input));});
 app.get('/health',c=>c.json({status:'ok',version:RELEASE,realDatasets:Object.keys(realDatasets).length,syntheticDatasets:studyDatasetIds.length-realRegionIds.length}));
 app.get('/openapi.json',c=>c.json(openapi));
 app.get('/regions',c=>{const q=c.req.query('q')?.toLocaleLowerCase('ru'),district=c.req.query('district');return c.json(regions.filter(r=>(!q||r.name.toLocaleLowerCase('ru').includes(q))&&(!district||r.districtId===district||(district==='unassigned'&&r.districtId===null))));});
 app.get('/study-scope',c=>c.json({methodologyVersion:METHODOLOGY.version,regions:targetRegions.map(item=>({id:item.id,reason:item.reason,region:lookup(item.id),result:baselineResults[item.id]??missing(item.id)}))}));
 app.get('/federal-districts',c=>c.json(DISTRICTS.map(d=>({...d,count:regions.filter(r=>r.districtId===d.id).length}))));
 app.get('/geo-summary',c=>c.json({manifest:geodataManifest,points}));
 app.get('/examples',c=>c.json({synthetic:true,examples:exampleList,warning:'Три географически подписанных примера используют вымышленные сети, население и учреждения. Нельзя интерпретировать как рейтинг субъектов.'}));
 app.get('/examples/:regionId/dataset',c=>{const id=c.req.param('regionId');return examples[id]?c.json(examples[id]):c.json({error:'Учебный набор не найден'},404);});
 app.get('/examples/:regionId/compare',c=>{const id=c.req.param('regionId'),d=examples[id];if(!d)return c.json({error:'Учебный набор не найден'},404);const opts=CalculationSchema.parse({methodologyVersion:c.req.query('methodologyVersion'),...(c.req.query('threshold')?{threshold:Number(c.req.query('threshold'))}:{}),period:c.req.query('period')??'day',scenario:c.req.query('scenario')??'improvement',edgeId:'ce',multiplier:1.5});return c.json({regionId:id,synthetic:true,...compareScenario(d,opts)});});
 const roadBenefit=(q:Record<string,string>)=>({
  ...(q.minRoadMinutes===undefined?{}:{minRoadMinutes:Number(q.minRoadMinutes)}),
  ...(q.minRoadPercent===undefined?{}:{minRoadPercent:Number(q.minRoadPercent)})
 });
 const studyOptions=(query:Record<string,string>)=>CalculationSchema.parse({...roadBenefit(query),methodologyVersion:query.methodologyVersion,...(query.threshold?{threshold:Number(query.threshold)}:{}),period:query.period??'day',scenario:query.scenario??'baseline',scope:query.scope??'edge',...(query.pointId?{pointId:query.pointId}:{}),...(query.edgeId?{edgeId:query.edgeId}:{}),multiplier:Number(query.multiplier??1.5),timeScale:Number(query.timeScale??1),cost:query.cost?Number(query.cost):null});

 app.get('/methodology-comparison',c=>c.json(existsSync('data/derived/methodology-comparison.json')?JSON.parse(readFileSync('data/derived/methodology-comparison.json','utf8')):{rows:[]}));
 app.get('/study/:id/bias-audit',c=>{const all=existsSync('data/derived/facility-selection-audit.json')?JSON.parse(readFileSync('data/derived/facility-selection-audit.json','utf8')):{};return c.json(all[c.req.param('id')]??null);});
 app.get('/study/:id',c=>{const d=studyDescription(c.req.param('id'));return d?c.json(d):c.json({error:'Набор не найден'},404);});
 app.get('/study/:id/road-options',c=>{
  const region=lookup(c.req.param('id'));
  if(!region)return c.json({error:'Регион не найден'},404);
  if(!studyCatalogue[region.id])return c.json({status:'no_data',rows:[]});
  const params=c.req.query();
  const options=CalculationSchema.parse({...roadBenefit(params),threshold:params.threshold?Number(params.threshold):undefined,timeScale:Number(params.timeScale??1)});
  return c.json({status:'available',rows:studyRoadOptions(region.id,options)});
 });
 app.get('/study/:id/compare',c=>{const id=c.req.param('id');if(!studyDatasets[id])return c.json({error:'Набор не найден'},404);const options=studyOptions(c.req.query());if(options.edgeId&&!studyDatasets[id].edges.some(e=>e.id===options.edgeId))return c.json({error:'Участок не найден'},400);if(!studyDatasets[id].synthetic&&options.period==='night')return c.json({error:'Ночной режим учреждений не подтверждён'},400);return c.json({regionId:id,synthetic:studyDatasets[id].synthetic,...studyComparison(id,options)});});
 app.get('/study/:id/dataset',c=>{const d=realDatasets[c.req.param('id')]??studyDatasets[c.req.param('id')];if(!d)return c.json({error:'Набор не найден'},404);c.header('Content-Disposition','attachment; filename="'+d.id+'.json"');return c.json(d);});
 app.get('/study/:id/map',c=>{if(!isRealRegion(c.req.param('id')))return c.json({error:'Для этого набора используется карта модельной сети'},400);const o=studyOptions(c.req.query());if(o.period==='night')return c.json({error:'Ночной режим не подтверждён'},400);return c.json(studyMap(c.req.param('id'),o));});
 app.get('/study/:id/route/:pointId',c=>{if(!isRealRegion(c.req.param('id')))return c.json({error:'Для этого набора используется карта модельной сети'},400);const o=studyOptions(c.req.query());if(o.period==='night')return c.json({error:'Ночной режим не подтверждён'},400);const r=studyRoute(c.req.param('id'),c.req.param('pointId'),o);return r?c.json(r):c.json({error:'Пункт не найден'},404);});
 app.get('/geometry',c=>{c.header('Cache-Control','public, max-age=86400');return c.json(geometry);});
 app.get('/regions/:id',c=>{const r=lookup(c.req.param('id'));return r?c.json(r):c.json({error:'Регион не найден'},404);});
 app.get('/regions/:id/settlement-sample',c=>{const r=lookup(c.req.param('id'));if(!r)return c.json({error:'Регион не найден'},404);return c.json(targetSettlementSamples[r.id as keyof typeof targetSettlementSamples]??{status:'no_data',warning:'Выборка не подготовлена.',sourceId:null,settlements:[]});});
 app.get('/regions/:id/geometry',c=>{const r=lookup(c.req.param('id'));if(!r)return c.json({error:'Регион не найден'},404);return c.json({type:'FeatureCollection',features:geometryFeatures.filter(f=>f.properties.regionId===r.id)});});
 app.get('/regions/:id/index',c=>{const r=lookup(c.req.param('id'));if(!r)return c.json({error:'Регион не найден'},404);return c.json(baselineResults[r.id]?summarizePoints(studyCatalogue[r.id],baselineResults[r.id].points,{methodologyVersion:studyOptions(c.req.query()).methodologyVersion,threshold:studyOptions(c.req.query()).threshold}):missing(r.id));});
 app.get('/regions/:id/facilities',c=>{const r=lookup(c.req.param('id'));if(!r)return c.json({error:'Регион не найден'},404);return c.json({status:!studyCatalogue[r.id]?'no_data':studyCatalogue[r.id].synthetic?'needs_review':'partial',synthetic:studyCatalogue[r.id]?.synthetic,items:studyCatalogue[r.id]?.facilities??[]});});
 app.get('/regions/:id/sources',c=>{const r=lookup(c.req.param('id'));if(!r)return c.json({error:'Регион не найден'},404);const used=studyCatalogue[r.id]?.sourceIds??[];const ids=new Set(['geoboundaries-2017',...used,...(['crimea','sevastopol'].includes(r.id)?['geoboundaries-crimea-2017']:[]),...(['donetsk','luhansk','kherson','zaporizhzhia'].includes(r.id)?['geoboundaries-additional-2017']:[])]);return c.json(sources.filter(s=>ids.has(s.id)));}); app.get('/national-index',c=>{const results=realRegionIds.map(id=>baselineResults[id]);const total=aggregateCohorts(results);return c.json({...missing(),cohorts:total.cohorts,coveredIndex:total.value,coveredPopulation:total.population,includedRegions:results.filter(r=>r.value!==null).length,excludedRegions:regions.length-results.filter(r=>r.value!==null).length,totalRegions:regions.length,label:'Общероссийский индекс не рассчитан'});});
 app.get('/sources',c=>c.json(sources));
 app.get('/methodology',c=>c.json({...METHODOLOGY,previous:POPULATION_METHODOLOGY,legacy:LEGACY_METHODOLOGY}));
 app.get('/data-quality',c=>c.json({regions:regions.length,geometries:geometryIds.size,geoSource:'geoboundaries-2017',geoSources:geodataManifest.sourceIds,sourceYear:2017,syntheticExamples:studyDatasetIds.length-realRegionIds.length,calculatedRegions:realRegionIds.length,populationCoverage:baselineResults.kaliningrad.populationCoverage,geometryYear:2017,checks:[{name:'Уникальность идентификаторов',passed:new Set(regions.map(r=>r.id)).size===regions.length},{name:'Принадлежность к ФО',passed:regions.every(r=>r.districtId===null||DISTRICTS.some(d=>d.id===r.districtId))}],profiles:[...new Set(Object.values(baselineResults).filter(r=>!r.synthetic).map(r=>r.profile))]}));
 app.get('/demo/dataset',c=>c.json(demoRaw));
 app.get('/dashboard',c=>{
  const scope=c.req.query('scope')??'russia';
  if(scope==='demo'){const o=CalculationSchema.parse({methodologyVersion:c.req.query('methodologyVersion'),...(c.req.query('threshold')?{threshold:Number(c.req.query('threshold'))}:{}),period:c.req.query('period')??'day',scenario:c.req.query('scenario')??'baseline',edgeId:c.req.query('edgeId')??'ce',multiplier:Number(c.req.query('multiplier')??1.5)});return c.json({scope:'demo',synthetic:true,...compareScenario(validateDataset(demoRaw),o)});}
  const region=lookup(scope);
  if(region){
   const options=studyOptions({...c.req.query(),scope:'edge'});
   // Older clients sent the demo-only ce edge for every territory.
   if(!studyDatasets[region.id])return c.json({scope:region.id,regions:[region],results:[],summary:missing(region.id),calculatedRegions:0});
   if(options.edgeId==='ce'&&!studyDatasets[region.id].edges.some(e=>e.id==='ce'))options.edgeId=undefined;
   if(options.edgeId&&!studyDatasets[region.id].edges.some(e=>e.id===options.edgeId))return c.json({error:'Участок не найден'},400);
   if(!studyDatasets[region.id].synthetic&&options.period==='night')return c.json({error:'Ночной режим учреждений не подтверждён'},400);
   const comparison=studyComparison(region.id,options)!;
   return c.json({scope:region.id,synthetic:studyDatasets[region.id].synthetic,regions:[region],results:[comparison.after],summary:comparison.after,calculatedRegions:1,populationCoverage:comparison.after.populationCoverage,...comparison});
  }
  const filtered=scope==='russia'?regions:regions.filter(r=>r.districtId===scope);
  if(!filtered.length)return c.json({error:'Территория не найдена'},404);
  const results=filtered.flatMap(r=>baselineResults[r.id]?[baselineResults[r.id]]:[]);const real=results.filter(r=>!r.synthetic);
  return c.json({scope,regions:filtered,results,realResults:real,syntheticResults:results.filter(r=>r.synthetic),summary:real.length?aggregateCohorts(real):missing(),calculatedRegions:results.length,realCalculatedRegions:real.length,syntheticCalculatedRegions:results.length-real.length,populationCoverage:null,label:'Реальные и синтетические результаты показаны отдельно. Смешанный индекс не рассчитывается.'});
 });
 app.post('/scenarios/calculate',async c=>{const input=z.object({datasetId:z.string(),options:CalculationSchema}).strict().parse(await c.req.json());const dataset=input.datasetId==='demo-network'?demoRaw:studyDatasets[studyDatasetIds.find(id=>studyCatalogue[id].id===input.datasetId)??''];if(!dataset)return c.json({error:'Подтверждённый набор не найден. Учебный расчёт доступен отдельно.'},404);const d=validateDataset(dataset);if(['improvement','closure'].includes(input.options.scenario)&&!d.edges.some(e=>e.id===input.options.edgeId))return c.json({error:'Выберите существующий участок сети'},400);const comparison=compareScenario(d,input.options);const signature=JSON.stringify({dataset:d,options:input.options,methodology:METHODOLOGY.version});const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature));const runId=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');const payload={runId,calculatedAt:new Date().toISOString(),persistent:Boolean(store),...comparison};if(store)await store.save(runId,payload);return c.json(payload);});
 app.get('/runs/:id',async c=>{const result=store?await store.get(c.req.param('id')):null;return result?c.json(result as object):c.json({error:'Сохранённый расчёт не найден. В размещённой версии скачайте JSON результата.'},404);});
 app.notFound(c=>c.json({error:'Маршрут API не найден'},404));
 return app;
}
export const api=createApi();
