import {useEffect,useMemo,useState,useRef} from 'react';
import {Link} from 'react-router-dom';
import {Download,ArrowUpRight} from 'lucide-react';
import type {Dataset,IndexResult} from '../../shared/schema';
import type {StudyDescription,StudyComparison} from '../study';
import {useApi,format,percent,Note,Loading,ErrorBox,downloadCsv,downloadJson,Status} from '../lib';
import {ScenarioBars,TimeDistribution,SectorChart} from './Charts';
import {JourneyExplorer} from './JourneyExplorer';
import {PILOT_ROAD_DEFAULTS} from '../../shared/schema';
import {StudyMap} from './StudyMap';
import {excludeDuplicateBaseline,type MedicalCatalog} from './KaliningradMedicalOverlay';
import {proposalBaselineResult,portfolioResult,type MedicalProposalCatalog,type MedicalProposalClass} from './kaliningradPortfolio';
import {EconomicsModule} from './EconomicsModule';
import {GeoMap} from './GeoMap';
import {AnomalyPanel} from './AnomalyPanel';
export function StudyNotice({synthetic}:{synthetic:boolean}){return <Note>{synthetic?'Синтетическая модель: переписные точки, условные центры и дорожные связи.':'Реальные геоданные: поселения ВПН-2021, дорожный граф OSM и выбранные медицинские объекты. Профиль и подтверждение объектов зависят от региона.'} Время поездки рассчитано по модели.</Note>;}
export function StudyWorkspace({regionId,initialScenario='baseline',showEconomics=false,showPeers=false}:{regionId:string;initialScenario?:string;showEconomics?:boolean;showPeers?:boolean}){
 const routeMap = useRef<HTMLElement>(null);
 const info=useApi<StudyDescription>('/api/study/'+regionId);
 const [threshold,setThreshold]=useState(40),[scenario,setScenario]=useState(initialScenario),[scope,setScope]=useState<'edge'|'point'|'region'>('edge'),[edge,setEdge]=useState(''),[multiplier,setMultiplier]=useState(1.5),[timeScale,setTimeScale]=useState(1),[q,setQ]=useState(''),[municipality,setMunicipality]=useState(''),[page,setPage]=useState(0),[mapView,setMapView]=useState(true),[pointId,setPointId]=useState('');
 const d=info.data,edgeId=d?.scenarios.some(e=>e.id===edge)?edge:d?.scenarios[0]?.id;
 const isAuto=['improvement','new_road','new_facility'].includes(scenario);
 const [roadBenefit,setRoadBenefit]=useState(PILOT_ROAD_DEFAULTS);
 const pilot=regionId==='kaliningrad';
 const [proposalMode,setProposalMode]=useState<MedicalProposalClass|null>(null);
 const proposalUrls:Record<MedicalProposalClass,string>={public_integrated:'/data/kaliningrad-public-medical-proposals.json',private_paid:'/data/kaliningrad-private-clinic-proposals.json'};
 const proposalApi=useApi<MedicalProposalCatalog>(pilot&&proposalMode?proposalUrls[proposalMode]:null);
 const experimentalApi=useApi<{regionId:string;kind:string;result:IndexResult}>(pilot?'/api/study/kaliningrad/experimental?threshold='+threshold+'&timeScale='+timeScale:null);
 const medicalCatalogApi=useApi<MedicalCatalog>(d&&!d.synthetic?'/data/medical-catalogs/'+regionId+'.json':null);
 const benefitParams=pilot?new URLSearchParams({minRoadMinutes:String(roadBenefit.minRoadMinutes),minRoadPercent:String(roadBenefit.minRoadPercent)}).toString():'';
 const query=new URLSearchParams({threshold:String(threshold),scenario,scope:isAuto?scope:'edge',...(isAuto&&scope==='point'&&pointId?{pointId}:{}),multiplier:String(multiplier),timeScale:String(timeScale),...(!isAuto||scope==='edge'&&scenario==='improvement'?(edgeId?{edgeId}:{}):{})}).toString()+(pilot && scenario==='new_road'?'&'+benefitParams:'');
 const comparison=useApi<StudyComparison>('/api/study/'+regionId+'/compare?'+query);
 const network=useApi<Dataset>(d?.synthetic?'/api/study/'+regionId+'/dataset':null);
 const c=comparison.data;
 const experimentalBaseline=experimentalApi.data?.result??null;
 const proposalActive=Boolean(pilot && proposalMode && proposalApi.data && experimentalBaseline && c?.options.threshold===40 && c.options.timeScale===1 && c.options.scenario==='baseline');
 const proposalBaseline=useMemo(()=>proposalActive && experimentalBaseline && proposalApi.data ? proposalBaselineResult(experimentalBaseline,proposalApi.data) : null,[proposalActive,experimentalBaseline,proposalApi.data]);
 const calculatedPortfolio=useMemo(()=>proposalActive && experimentalBaseline && proposalApi.data ? portfolioResult(experimentalBaseline,proposalApi.data) : null,[proposalActive,experimentalBaseline,proposalApi.data]);
 // The primary regional result NEVER switches to the experimental formula.
 const r=c?.after;
 function toggleProposal(mode:MedicalProposalClass){
   if(proposalMode===mode){setProposalMode(null);return;}
   // Saved pilot portfolios exist only for τ=40 min, travel-time scale ×1.
   setScenario('baseline');setScope('edge');setThreshold(40);setTimeScale(1);
   setProposalMode(mode);
 }
 useEffect(()=>setProposalMode(null),[regionId]);
 const displayedResult=(c && c.options.threshold===threshold && c.options.timeScale===timeScale && c.options.scenario===scenario ? r
   : scenario==='baseline' && threshold===40 && timeScale===1 ? d?.baseline : null);
 const changedRoutes=useMemo(()=>{
  if(!c) return [];
  const before=new Map(c.baseline.points.map(p=>[p.id,p]));
  const change=(p:typeof c.after.points[number])=>{
   const original=before.get(p.id);
   if(!original) return 0;
   if(original.minutes!==null && p.status==='unreachable') return Infinity;
   return Math.abs((p.minutes??0)-(original.minutes??0));
  };
  return c.after.points.filter(p=>{
   const original=before.get(p.id);
   return original && (original.facilityId!==p.facilityId || original.path.join('|')!==p.path.join('|'));
  }).sort((a,b)=>change(b)-change(a));
 },[c]);
 const selectedName=c?.baseline.points.find(p=>p.id===pointId)?.name ?? '';
 function selectScenario(value:string){
  setProposalMode(null);
  if(value==='new_road'||value==='new_facility') setScope('region');
  setScenario(value);
 }
 function selectMapPoint(id:string){
  if(!id && isAuto && scope==='point'){
   setScope('edge');
   setScenario('baseline');
  }
  setPointId(id);
 }
 const pendingRoadFocus=useRef('');
 useEffect(()=>{
  if(c && pendingRoadFocus.current && (c.options.scenario==='new_road'||c.options.scenario==='improvement') && (pendingRoadFocus.current===pointId || pendingRoadFocus.current==='region')){
   routeMap.current?.scrollIntoView({block:'start'});
   pendingRoadFocus.current='';
  }
 },[c,pointId]);
 const focusedProject=useRef('');
 useEffect(()=>{
  if(!c||!['new_road','new_facility'].includes(scenario)||scope!=='region'||!c.investmentSuggestion){focusedProject.current='';return;}
  const key=[regionId,scenario,threshold,timeScale,c.investmentSuggestion.title].join('|');
  if(focusedProject.current===key)return;
  focusedProject.current=key;
  // A region-wide project changes routes only for a subset of settlements;
  // start on a settlement whose route ACTUALLY changes, never an unaffected one.
  if(changedRoutes.length && !changedRoutes.some(p=>p.id===pointId))setPointId(changedRoutes[0].id);
 },[c,regionId,scenario,scope,threshold,timeScale]);
 const lastComparison=useRef<StudyComparison|null>(null);if(c)lastComparison.current=c;const economicComparison=c??lastComparison.current;
 const rows=useMemo(()=>r?.points.filter(p=>(!q||p.name.toLocaleLowerCase('ru').includes(q.toLocaleLowerCase('ru')))&&(!municipality||p.municipality===municipality))??[],[r,q,municipality]);
 const municipalities=useMemo(()=>[...new Set(r?.points.map(p=>p.municipality)??[])].sort((a,b)=>a.localeCompare(b,'ru')),[r]);
 const visibleMedicalCount=useMemo(()=>{
  if(!d||d.synthetic||!medicalCatalogApi.data)return null;
  const visibleTypes=new Set(['public_hospital','public_adult_polyclinic','public_children_polyclinic','private_paid']);
  const baselineHospitals=d.facilities.filter(f=>!f.id.startsWith('catalog-'));
  const extra=excludeDuplicateBaseline(medicalCatalogApi.data.facilities.filter(f=>visibleTypes.has(f.type)),baselineHospitals).length;
  return baselineHospitals.length + extra;
 },[d,medicalCatalogApi.data]);
 const currentPage=Math.min(page,Math.max(0,Math.ceil(rows.length/25)-1));
 const exportRows=()=>{if(!c||!d)return;downloadCsv([['Тип данных',d.synthetic?'Сценарная модель с условными дорогами':'Реальные исходники; модельные времена'],['Набор',d.id,'Версия',d.version,'τ',threshold,'Множитель времён',timeScale],['Пункт','Муниципалитет','Население','Модельное время, мин','Оценка 0–100','Статус','Медучреждение','Путь — id рёбер'],...rows.map(p=>[p.name,p.municipality,p.population,p.minutes,p.score===null?null:100*p.score,p.status,p.facilityId,p.path.join('|')])],regionId+'-calculation.csv');};
 if(info.error)return <ErrorBox message={info.error} retry={info.retry}/>;if(!d)return <Loading/>;
 return <div className="study-workspace"><div className="study-heading"><div><span className="eyebrow">{d.synthetic?'СИНТЕТИЧЕСКАЯ МОДЕЛЬ':'РЕАЛЬНЫЕ ДАННЫЕ'}</span><h2>{d.profileLabel}</h2><p>{d.coverageLabel}</p></div><Status value={d.synthetic?'synthetic':d.profile==='mapped-hospital'?'osm':'observed'}/></div>
 <section className="index-spotlight" aria-label="Главные показатели транспортной доступности">
   <div className="index-spotlight-main"><span className="eyebrow">ОСНОВНОЙ МИЭД v6.1 · ЕДИНАЯ МЕТОДИКА 85/10/5</span><div className="index-spotlight-value">{displayedResult?.value==null?'—':displayedResult.value.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} <small>/ 100</small></div><p>85% — ближайшее подходящее бесплатное медучреждение, 10% — второе ближайшее, 5% — устойчивость маршрута · τ = {threshold} мин. Вес: 75,2% по поселениям и 24,8% по населению.</p>{scenario!=='baseline'&&<p className="index-spotlight-delta">Δ к исходной сети: {c?.delta!=null&&c.delta>0?'+':''}{format(c?.delta,2)} балла</p>}</div>
   <div className="index-spotlight-facts"><div><span>Поселений в расчёте</span><strong>{format(displayedResult?.includedSettlements,0)} / {format(d.settlementCount,0)}</strong></div><div><span>Время P90</span><strong>{format(displayedResult?.p90Minutes,1)} мин</strong></div><div><span>Доля в пределах τ</span><strong>{percent(displayedResult?.withinThresholdShare)}</strong></div><div><span>Медучреждения на карте</span><strong>{format(visibleMedicalCount??d.facilityCount,0)} <small>{pilot?'· больницы, поликлиники и частные клиники':d.profile==='mapped-hospital'?'· OSM без подтверждения профиля':d.synthetic?'· условные':'· подтверждены источниками'}</small></strong></div></div>
 </section>
 {pilot&&<section className="panel kaliningrad-experiment-panel" aria-label="Экспериментальная модель Калининградской области">
   <div className="panel-heading"><h3>Калининград · расширенный эксперимент (55/35/10)</h3><span className="status status-partial">Не для общероссийского сравнения</span></div>
   <p>Отдельная оценка: 55% — поездка до больницы, 35% — до государственной поликлиники, 10% — устойчивость больничного маршрута. В основной МИЭД 85/10/5 она не подставляется.</p>
   {experimentalApi.error?<Note tone="warning">Не удалось получить экспериментальный показатель: {experimentalApi.error}</Note>:experimentalBaseline?<div className="kaliningrad-experiment-values"><strong>Исходный расширенный показатель: {format(experimentalBaseline.value,2)} / 100</strong><span> P90 до больницы: {format(experimentalBaseline.hospitalP90Minutes??experimentalBaseline.p90Minutes,1)} мин · P90 до поликлиники: {format(experimentalBaseline.clinicP90Minutes,1)} мин</span></div>:<p>Загружается отдельный расчёт…</p>}
   {proposalActive&&proposalApi.data&&proposalBaseline&&calculatedPortfolio&&experimentalBaseline&&<div className="kaliningrad-experiment-values"><strong>Экспериментальный портфель «{proposalMode==='private_paid'?'платные клиники':'больницы с поликлиникой'}»: {format(proposalBaseline.value,2)} → {format(calculatedPortfolio.value,2)} / 100</strong><span>Расчётная разница: {proposalApi.data.totalGain>=0?'+':''}{format(proposalApi.data.totalGain,2)} балла (по сохранённой экспериментальной базе). {proposalMode==='private_paid'?'Для платных клиник это условная оценка как для бесплатной амбулаторной помощи; основной индекс от них не меняется.':'Основной индекс и общероссийский рейтинг этим значением не заменяются.'}</span>{experimentalBaseline.value!=null&&Math.abs(experimentalBaseline.value-proposalApi.data.baselineIndex)>.12&&<p>Обратите внимание: экспериментальный каталог проектов рассчитан на другой версии медицинской базы; результаты портфеля требуют повторного пересчёта.</p>}</div>}
   <p className="fine-print">Поликлиники OSM для экспериментального расчёта требуют проверки по реестрам, включая действующий профиль и условия бесплатного приёма. Исторические проекты — аналитические гипотезы, а не решения о строительстве.</p>
 </section>}
 <div className="filters study-controls study-controls-medical"><label>Параметр τ<select aria-label="Параметр τ" value={threshold} onChange={e=>{setProposalMode(null);setThreshold(Number(e.target.value));}}>{[30,40,50,60].map(t=><option key={t} value={t}>{t} мин</option>)}</select></label><label>Чувствительность времён<select aria-label="Множитель всех времён" value={timeScale} onChange={e=>{setProposalMode(null);setTimeScale(Number(e.target.value));}}><option value="0.8">×0,8 · на 20% короче</option><option value="1">×1 · базовые допущения</option><option value="1.2">×1,2 · на 20% дольше</option></select></label><p className="study-control-explanation"><strong>τ</strong> — время поездки, при котором функция доступности снижается до 50% (поездки до 15 минут получают максимальную оценку). <strong>Чувствительность времён</strong> — проверка изменения результатов, если все расчётные поездки занимают на 20% меньше или больше времени.</p></div>
{!d.synthetic&&medicalCatalogApi.data&&!medicalCatalogApi.data.facilities.some(f=>f.officiallyVerified===true&&['public_adult_polyclinic','public_children_polyclinic'].includes(f.type))&&<Note tone="warning">В расчётной базе этого региона пока нет подтверждённых поликлинических точек. Основной МИЭД 85/10/5 рассчитывается по известным подходящим учреждениям. Отсутствие таких точек не доказывает отсутствие поликлиник. Картографический слой OSM сам по себе не расширяет состав расчётных учреждений. Для обновления каталога выполните <code>python scripts/build_regional_medical_catalogs.py --refresh-osm</code> и перезапустите сервер. Отсутствие записи не доказывает отсутствия поликлиники.</Note>}{!d.synthetic&&!('hasRouting' in d ? Boolean(d.hasRouting) : true)&&<AnomalyPanel regionId={regionId} threshold={threshold} timeScale={timeScale} hasRouting={false} onSelect={setPointId}/>}{comparison.error?<ErrorBox message={comparison.error} retry={comparison.retry}/>:comparison.loading?<Loading/>:r&&c&&<>
 <AnomalyPanel regionId={regionId} threshold={threshold} timeScale={timeScale} hasRouting={'hasRouting' in d ? Boolean(d.hasRouting) : true} onSelect={id=>{setScenario('baseline');setScope('edge');setPointId(id);document.querySelector('.study-visuals')?.scrollIntoView({behavior:'smooth',block:'start'});}}/>{<div className="regional-improvement-actions" role="group" aria-label="Сценарии развития медицинской и дорожной сети"><button type="button" className={scenario==='new_facility'?'active':''} onClick={()=>selectScenario('new_facility')}>★ Основной МИЭД · предложить государственную больницу</button><button type="button" className={scenario==='new_road'?'active':''} onClick={()=>selectScenario('new_road')}>↗ Основной МИЭД · предложить новую дорогу</button>{scenario!=='baseline'&&<button type="button" className="reset" onClick={()=>selectScenario('baseline')}>Исходная сеть</button>}<small>Оба проекта оцениваются по единому основному МИЭД v6.1 (85/10/5) во всех регионах, в том числе в Калининградской области; это предварительные гипотезы, не утверждённые места строительства. {d.synthetic?'Здесь используется синтетическая дорожная сеть.':''}</small></div>}<div className={pilot?"study-visuals study-visuals-pilot":"study-visuals"}><section ref={routeMap} className="panel no-padding"><div className="panel-heading inset"><h3>{d.synthetic?'Как устроена поездка':'Поселения, больницы и маршруты'}</h3>{d.synthetic&&<div className="segmented"><button className={mapView?'active':''} onClick={()=>setMapView(true)}>Поездка</button><button className={!mapView?'active':''} onClick={()=>setMapView(false)}>Регион</button></div>}</div>{d.synthetic?(mapView&&network.data?<JourneyExplorer chosen={pointId} onPoint={setPointId} dataset={network.data} comparison={c} onEdge={setEdge} edgeId={edgeId??''}/>:<GeoMap regionId={regionId}/>):<StudyMap regionId={regionId} query={query} pointId={pointId} onPoint={selectMapPoint} onQuickScenario={selectScenario} comparison={c} portfolioEnabled={Boolean(proposalMode)} proposalMode={proposalMode} onProposalModeChange={toggleProposal} portfolioCatalog={proposalApi.data} portfolioLoading={proposalApi.loading} portfolioError={proposalApi.error} portfolioAfter={calculatedPortfolio}/>}</section><section className="panel"><h3>Сравнение вариантов</h3>{proposalActive&&<p className="kaliningrad-comparison-note">Здесь сравнивается только основной МИЭД 85/10/5. Изменение экспериментального портфеля 55/35/10 показано выше и на панели предложений.</p>}<ScenarioBars baseline={c.baseline} after={r}/><dl className="metrics-list"><div><dt>Затронуто жителей в основном сценарии{d.synthetic?' выборки':''}</dt><dd>{format(c.affectedPopulation,0)}</dd></div><div><dt>Медианное время</dt><dd>{format(r.medianMinutes,2)} мин</dd></div><div><dt>90-й процентиль · ближайшее бесплатное учреждение</dt><dd>{format(r.hospitalP90Minutes??r.p90Minutes,2)} мин</dd></div>{r.clinicP90Minutes!==undefined&&<div><dt>90-й процентиль · поликлиники</dt><dd>{format(r.clinicP90Minutes,2)} мин</dd></div>}<div><dt>Поселений в расчёте</dt><dd>{format(r.includedSettlements,0)}</dd></div><div><dt>Существующих медицинских площадок</dt><dd>{d.facilityCount}</dd></div>{c.proposedFacilities.length>0&&<div><dt>Проектных площадок</dt><dd>{c.proposedFacilities.length}</dd></div>}</dl><p>Наименьшая доступность: {r.points.filter(p=>p.score!==null).sort((a,b)=>a.score!-b.score!).slice(0,5).map(p=>p.name+' ('+format(p.minutes)+' мин)').join(' · ')||'нет данных'}</p><p>Доля поселений в пределах 30 / 60 / 90 / 120 минут: {[30,60,90,120].map(t=>`${t} мин — ${percent(r.withinMinutesShares[String(t) as '30'|'60'|'90'|'120'])}`).join(' · ')}</p><p className="fine-print">Среднее и медиана относятся к достижимым поселениям с равными весами. Основной индекс использует 75,2% равных весов поселений и 24,8% весов по численности населения. Доли по временным интервалам считаются по поселениям.</p><Link className="text-link" to={'/sources?region='+regionId}>Источники данных<ArrowUpRight size={15}/></Link></section></div>
{scenario!=='baseline'&&<section className="study-scenario-details"><strong>{scenario==='new_facility'?'Результат подбора новой больницы с поликлиническим отделением':scenario==='new_road'?'Результат подбора новой дороги':'Выбранный сценарий'}</strong>{c.investmentSuggestion?<><p>{c.investmentSuggestion.title}. {c.investmentSuggestion.rationale}</p><p>Поселений с эффектом: {format(c.investmentSuggestion.affectedSettlements,0)} · жителей: {format(c.investmentSuggestion.estimatedBeneficiaries,0)}{c.investmentSuggestion.distanceKm==null?'':` · длина: ${format(c.investmentSuggestion.distanceKm,2)} км`}.</p><p className="fine-print">{c.investmentSuggestion.technicalWarning}</p></>:<p>Среди проверенных кандидатов положительного эффекта при текущих исходных данных не найдено. Это не доказывает, что инфраструктурные изменения невозможны.</p>}</section>}<StudyNotice synthetic={d.synthetic}/>
 {!proposalActive&&c.comparisonWarning&&<Note tone="warning">{c.comparisonWarning}</Note>}<div className="study-export-row"><span>МИЭД {displayedResult?.methodologyVersion??d.medicalMethodologyVersion??'6.1.0'} · τ = {threshold} · данные {d.version} · {d.date} · {d.synthetic?'СЦЕНАРНАЯ МОДЕЛЬ':'МОДЕЛЬ НА РЕАЛЬНЫХ ДАННЫХ'}</span><button className="btn small outline" onClick={exportRows}><Download size={15}/>CSV таблицы</button><button className="btn small outline" onClick={()=>downloadJson({description:d,comparison:{...c,after:r},experimental:pilot?experimentalApi.data:undefined,experimentalPortfolio:proposalActive?proposalApi.data:undefined},regionId+'-result.json')}><Download size={15}/>JSON расчёта</button><a className="btn small outline" href={'/api/study/'+regionId+'/dataset'} download><Download size={15}/>Исходный набор</a></div>

 <div className="study-scenario-details"><strong>Как выбираются новые учреждения и дороги</strong><p><code>МИЭД = 100 · Σᵢ (0,752/N + 0,248·pᵢ/P) · [0,85·A(t₁ᵢ) + 0,10·A(t₂ᵢ) + 0,05·A(tустᵢ)]</code>. Первое и второе время относятся к двум разным бесплатным медицинским площадкам; для второго учреждения выбирается иной дорожный узел. Все регионы, включая Калининград, используют эту формулу в общем рейтинге.</p><p>Для новой государственной больницы с поликлиническим отделением рассматриваются населённые пункты с низкой доступностью, исключаются точки слишком близко к известным учреждениям, затем для каждой альтернативы добавляется гипотетический объект и пересчитываются все кратчайшие маршруты и МИЭД. Побеждает кандидат с наибольшим фактическим приростом общего индекса. Для дорог аналогично пересчитывается граф с новой связью: эскизы не являются проверенными проектами строительства.</p><p>В расширенном пилоте Калининграда отдельно рассматриваются больничная и амбулаторная доступность (55/35/10). Возрастная структура влияет на ранжирование экспериментальных мест размещения, но не на общероссийский индекс. Коммерческий спрос для частной клиники — отдельная гипотеза: платная клиника не повышает фактический индекс гарантированной бесплатной помощи.</p></div>
 <div className="dashboard-grid study-charts"><section className="panel"><h3>Распределение времени поездки</h3><TimeDistribution result={r}/></section><section className="panel"><h3>{d.synthetic?'Различия внутри выборки':'Муниципальные различия'}</h3><SectorChart result={r}/></section></div>
 <section className="panel study-point-table"><div className="panel-heading"><h3>Расчёт по каждому пункту</h3><span>{rows.length} строк</span></div><div className="study-table-filters"><label>Название<input aria-label="Найти населённый пункт" placeholder="Найти пункт…" value={q} onChange={e=>{setQ(e.target.value);setPage(0);}}/></label><label>{'Муниципалитет / зона'}<select value={municipality} onChange={e=>{setMunicipality(e.target.value);setPage(0);}}><option value="">Все</option>{municipalities.map(m=><option key={m}>{m}</option>)}</select></label></div><div className="table-scroll"><table><thead><tr><th>Пункт</th><th>Население{d.synthetic?' выборки':''}</th><th>Время, мин</th><th>Коэффициент</th><th>Вклад, баллы</th><th>Медучреждение</th><th>Состояние</th></tr></thead><tbody>{rows.slice(currentPage*25,currentPage*25+25).map(p=><tr key={p.id} className={p.id===pointId?'is-selected':''}><td>{p.name}<small className="cell-secondary">{p.municipality}</small><button className="study-point-action" onClick={()=>{setPointId(p.id);routeMap.current?.scrollIntoView({behavior:'smooth',block:'start'});}}>Показать маршрут на карте ↗</button></td><td>{format(p.population,0)}</td><td>{format(p.minutes)}</td><td>{format(p.score,3)}</td><td>{format(p.score===null||!r.denominator?null:100*p.score*(r.weighting==='hybrid'?(0.752/r.includedSettlements+0.248*(p.population??0)/r.population):r.weighting==='settlement'?1/r.denominator:(p.population??0)/r.denominator),3)}</td><td>{[...d.facilities,...c.proposedFacilities].find(f=>f.id===p.facilityId)?.name??proposalApi.data?.candidates.find(f=>f.id===p.facilityId)?.name??'—'}</td><td>{p.status==='reachable'?'Рассчитан':p.status==='unreachable'?'Нет пути в сценарии':'Вне расчёта'}</td></tr>)}</tbody></table></div><div className="study-pagination"><button className="btn small outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Назад</button><span>Страница {currentPage+1} из {Math.max(1,Math.ceil(rows.length/25))}</span><button className="btn small outline" disabled={(currentPage+1)*25>=rows.length} onClick={()=>setPage(currentPage+1)}>Далее</button></div></section>
 </>}
 <details className="panel study-assumptions"><summary>Данные, допущения и воспроизводимость</summary><p>Охват населения: {r?percent(r.populationCoverage):'—'}. Пунктов вне расчёта: {r?.missingSettlements??0}, из них с неподтверждённым маршрутом: {r?.unverifiedRoutes??0}.</p><ul>{d.assumptions.map(a=><li key={a}>{a}</li>)}</ul><p>Набор {d.id} · {d.nodes.toLocaleString('ru')} узлов · {d.edges.toLocaleString('ru')} связей · {d.facilityCount} расчётных больничных площадок. {d.synthetic?'Фиксированный seed: '+String(d.metadata.seed):'Координаты поселений представляют одну точку, поэтому внутригородские различия и подъезд до каждого дома не измеряются.'}</p>{pilot?<p>Только Калининградская область — экспериментальный МИЭД v6.2: <code>Scoreᵢ = 0,55·A(Hᵢ) + 0,35·A(Pᵢ) + 0,10·A(Rᵢ)</code>, где H — ближайшая больница, P — поликлиника, R — устойчивость больничного маршрута.</p>:<p>Общерегиональный МИЭД v6.1: <code>Scoreᵢ = 0,85·A(T₁ᵢ) + 0,10·A(T₂ᵢ) + 0,05·A(Rᵢ)</code>, где T₁ и T₂ — время до двух разных ближайших бесплатных больниц или поликлиник по дорожной сети, R — устойчивость маршрута. Платные частные клиники не участвуют в расчёте.</p>}<p>Для обоих вариантов <code>МИЭД = 100 × Σᵢ (0,752/N + 0,248·pᵢ/P) · Scoreᵢ</code>. Возрастные группы учитываются только при подборе новых медплощадок, но не в самом индексе. Оценки двух методик нельзя напрямую сравнивать.</p></details>
 {showEconomics&&economicComparison&&<EconomicsModule regionId={regionId} description={d} comparison={economicComparison}/>}
 </div>;
}
