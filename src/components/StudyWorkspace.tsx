import {useEffect,useMemo,useState,useRef} from 'react';
import {Link} from 'react-router-dom';
import {Download,ArrowUpRight,FlaskConical,MapPin} from 'lucide-react';
import type {Dataset} from '../../shared/schema';
import type {StudyDescription,StudyComparison} from '../study';
import {useApi,format,percent,Note,Loading,ErrorBox,downloadCsv,downloadJson,Status} from '../lib';
import {ScenarioBars,TimeDistribution,SectorChart} from './Charts';
import {JourneyExplorer} from './JourneyExplorer';
import {PILOT_ROAD_DEFAULTS} from '../../shared/schema';
import {PilotRoadComparison} from './PilotRoadComparison';
import {RoadOptions} from './RoadOptions';
import {RegionalPeers} from './RegionalPeers';
import {FacilityDataQuality} from './FacilityDataQuality';
import {StudyMap} from './StudyMap';
import {EconomicsModule} from './EconomicsModule';
import {CalculationQuality,FacilitySelectionAudit} from './CalculationQuality';
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
 const benefitParams=pilot?new URLSearchParams({minRoadMinutes:String(roadBenefit.minRoadMinutes),minRoadPercent:String(roadBenefit.minRoadPercent)}).toString():'';
 const query=new URLSearchParams({threshold:String(threshold),scenario,scope:isAuto?scope:'edge',...(isAuto&&scope==='point'&&pointId?{pointId}:{}),multiplier:String(multiplier),timeScale:String(timeScale),...(!isAuto||scope==='edge'&&scenario==='improvement'?(edgeId?{edgeId}:{}):{})}).toString()+(pilot && scenario==='new_road'?'&'+benefitParams:'');
 const comparison=useApi<StudyComparison>('/api/study/'+regionId+'/compare?'+query);
 const network=useApi<Dataset>(d?.synthetic?'/api/study/'+regionId+'/dataset':null);
 const c=comparison.data,r=c?.after;
 const displayedResult=c && c.options.threshold===threshold && c.options.timeScale===timeScale && c.options.scenario===scenario ? r
   : scenario==='baseline' && threshold===40 && timeScale===1 ? d?.baseline : null;
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
  if(value==='new_road'||value==='new_facility') setScope(pointId?'point':'region');
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
 const currentPage=Math.min(page,Math.max(0,Math.ceil(rows.length/25)-1));
 const exportRows=()=>{if(!c||!d)return;downloadCsv([['Тип данных',d.synthetic?'Сценарная модель с условными дорогами':'Реальные исходники; модельные времена'],['Набор',d.id,'Версия',d.version,'τ',threshold,'Множитель времён',timeScale],['Пункт','Муниципалитет','Население','Модельное время, мин','Оценка 0–100','Статус','Больница','Путь — id рёбер'],...rows.map(p=>[p.name,p.municipality,p.population,p.minutes,p.score===null?null:100*p.score,p.status,p.facilityId,p.path.join('|')])],regionId+'-calculation.csv');};
 if(info.error)return <ErrorBox message={info.error} retry={info.retry}/>;if(!d)return <Loading/>;
 return <div className="study-workspace"><div className="study-heading"><div><span className="eyebrow">{d.synthetic?'СИНТЕТИЧЕСКАЯ МОДЕЛЬ':'РЕАЛЬНЫЕ ДАННЫЕ'}</span><h2>{d.profileLabel}</h2><p>{d.coverageLabel}</p></div><Status value={d.synthetic?'synthetic':d.profile==='mapped-hospital'?'osm':'observed'}/></div>
 <section className="index-spotlight" aria-label="Главные показатели транспортной доступности">
   <div className="index-spotlight-main"><span className="eyebrow">ГЛАВНЫЙ РЕЗУЛЬТАТ · МИЭД v6.1</span><div className="index-spotlight-value">{format(displayedResult?.value,2)} <small>/ 100</small></div><p>Территориальная доступность для среднего поселения · τ = {threshold} мин</p>{scenario!=='baseline'&&<p className="index-spotlight-delta">Δ к исходной сети: {c?.delta!=null&&c.delta>0?'+':''}{format(c?.delta,3)} балла</p>}</div>
   <div className="index-spotlight-facts"><div><span>Поселений в расчёте</span><strong>{format(displayedResult?.includedSettlements,0)} / {format(d.settlementCount,0)}</strong></div><div><span>Время P90</span><strong>{format(displayedResult?.p90Minutes,1)} мин</strong></div><div><span>Доля в пределах τ</span><strong>{percent(displayedResult?.withinThresholdShare)}</strong></div><div><span>Больничные площадки</span><strong>{format(d.facilityCount,0)} <small>{d.profile==='mapped-hospital'?'· OSM без подтверждения профиля':d.synthetic?'· условные':'· подтверждены источниками'}</small></strong></div></div>
 </section>
 <div className="filters study-controls"><label>Сценарий<select aria-label="Сценарий расчёта" value={scenario} onChange={e=>selectScenario(e.target.value)}><option value="baseline">Исходная сеть</option><option value="improvement">Ускорить существующую дорогу · без новой трассы</option><option value="new_road">Предложить новую дорогу · проект</option><option value="new_facility">Добавить медплощадку в модель · гипотеза</option><option value="closure">Закрыть участок</option></select></label>{isAuto&&<label>Масштаб улучшения<select aria-label="Масштаб улучшения" value={scope} onChange={e=>setScope(e.target.value as 'edge'|'point'|'region')}><option value="edge" disabled={scenario!=='improvement'}>Один выбранный участок</option><option value="point" disabled={!pointId}>Маршрут выбранного поселения{pointId?'':' · сначала выберите пункт'}</option><option value="region">Весь регион · автоматический подбор</option></select></label>}<label>{d.synthetic?'Модельная связь':'Дорожный объект OSM'}<select aria-label="Дорожный участок" disabled={isAuto&&(scope!=='edge'||scenario!=='improvement')} value={edgeId??''} onChange={e=>setEdge(e.target.value)}>{d.scenarios.map(e=><option key={e.id} value={e.id}>{e.name}{e.lengthKm?' · '+format(e.lengthKm,2)+' км':''}</option>)}</select></label><label>Параметр τ<select aria-label="Параметр τ" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}>{[30,40,50,60].map(t=><option key={t} value={t}>{t} мин</option>)}</select></label><label>Чувствительность времён<select aria-label="Множитель всех времён" value={timeScale} onChange={e=>setTimeScale(Number(e.target.value))}><option value="0.8">×0,8 · на 20% короче</option><option value="1">×1 · базовые допущения</option><option value="1.2">×1,2 · на 20% дольше</option></select></label>{scenario==='improvement'&&<label>Делитель времени: ×{format(multiplier,2)}<input aria-label="Делитель времени участка" type="range" min="1" max="2" step="0.1" value={multiplier} onChange={e=>setMultiplier(Number(e.target.value))}/></label>}</div>
 {pilot && (showPeers || scenario==='new_road') && <div className="filters study-controls pilot-road-filters">
  <label>Минимальная экономия, мин<select aria-label="Минимальная экономия, мин" value={roadBenefit.minRoadMinutes} onChange={e=>setRoadBenefit({...roadBenefit,minRoadMinutes:Number(e.target.value)})}>{[0,2,5,10,15].map(v=><option key={v}>{v}</option>)}</select></label>
  <label>Минимальная экономия, %<select aria-label="Минимальная экономия, %" value={roadBenefit.minRoadPercent} onChange={e=>setRoadBenefit({...roadBenefit,minRoadPercent:Number(e.target.value)})}>{[0,5,10,15,25].map(v=><option key={v}>{v}</option>)}</select></label>
 </div>}

 {scenario!=='baseline'&&<Note tone="warning">{scenario==='new_facility'?'Сценарий проектной медицинской площадки: подбираем населённый пункт-кандидат, добавляем гипотетическое место оказания помощи, пересчитываем все пути. Существование медицинского профиля, лицензии, персонала и стоимость не подтверждены.':scenario==='new_road'&&pilot?'Калининградская область. Учитывается длина трассы после обхода отмеченных на карте зданий и воды. Проверка выполнена для шести исходных коридоров.':scenario==='new_road'?'Сценарий новой дороги: для реальных территорий предлагается короткое недостающее соединение между существующими дорожными узлами рядом с населённым пунктом, а не произвольный объезд через регион. Каждый проект действительно пересчитывается. Это только предварительный эскиз: отсутствие пересечения с военными зонами, водой, ООПТ и частными землями не подтверждено; строить без проверки нельзя.':scenario==='improvement'?(scope==='region'?'До четырёх существующих дорожных объектов ускоряются по прогнозному приросту доступности.':'Для существующего участка уменьшается модельное время. Геометрия базового и улучшенного пути МОЖЕТ совпадать, если альтернативный путь не стал выгоднее.'): 'Закрытый участок исключается, модель ищет объезды.'}</Note>}
 {!d.synthetic&&!('hasRouting' in d ? Boolean(d.hasRouting) : true)&&<AnomalyPanel regionId={regionId} threshold={threshold} timeScale={timeScale} hasRouting={false} onSelect={setPointId}/>}{comparison.error?<ErrorBox message={comparison.error} retry={comparison.retry}/>:comparison.loading?<Loading/>:r&&c&&<>
 <AnomalyPanel regionId={regionId} threshold={threshold} timeScale={timeScale} hasRouting={'hasRouting' in d ? Boolean(d.hasRouting) : true} onSelect={id=>{setScenario('baseline');setScope('edge');setPointId(id);document.querySelector('.study-visuals')?.scrollIntoView({behavior:'smooth',block:'start'});}}/><div className="study-visuals"><section ref={routeMap} className="panel no-padding"><div className="panel-heading inset"><h3>{d.synthetic?'Как устроена поездка':'Поселения, больницы и маршруты'}</h3>{d.synthetic&&<div className="segmented"><button className={mapView?'active':''} onClick={()=>setMapView(true)}>Поездка</button><button className={!mapView?'active':''} onClick={()=>setMapView(false)}>Регион</button></div>}</div>{d.synthetic?(mapView&&network.data?<JourneyExplorer chosen={pointId} onPoint={setPointId} dataset={network.data} comparison={c} onEdge={setEdge} edgeId={edgeId??''}/>:<GeoMap regionId={regionId}/>):<StudyMap regionId={regionId} query={query} pointId={pointId} onPoint={selectMapPoint} onQuickScenario={selectScenario} comparison={c}/>}</section><section className="panel"><h3>Сравнение вариантов</h3><ScenarioBars baseline={c.baseline} after={r}/><dl className="metrics-list"><div><dt>Затронуто жителей{d.synthetic?' выборки':''}</dt><dd>{format(c.affectedPopulation,0)}</dd></div><div><dt>Медианное время</dt><dd>{format(r.medianMinutes)} мин</dd></div><div><dt>90-й процентиль</dt><dd>{format(r.p90Minutes)} мин</dd></div><div><dt>Поселений в расчёте</dt><dd>{format(r.includedSettlements,0)}</dd></div><div><dt>Существующих медицинских площадок</dt><dd>{d.facilityCount}</dd></div>{c.proposedFacilities.length>0&&<div><dt>Проектных площадок</dt><dd>{c.proposedFacilities.length}</dd></div>}</dl><p>Наименьшая доступность: {r.points.filter(p=>p.score!==null).sort((a,b)=>a.score!-b.score!).slice(0,5).map(p=>p.name+' ('+format(p.minutes)+' мин)').join(' · ')||'нет данных'}</p><p>Доля поселений в пределах 30 / 60 / 90 / 120 минут: {[30,60,90,120].map(t=>`${t} мин — ${percent(r.withinMinutesShares[String(t) as '30'|'60'|'90'|'120'])}`).join(' · ')}</p><p className="fine-print">Среднее и медиана относятся к достижимым поселениям с равными весами. Основной индекс использует 75,2% равных весов поселений и 24,8% весов по численности населения. Доли по временным интервалам считаются по поселениям.</p><Link className="text-link" to={'/sources?region='+regionId}>Источники данных<ArrowUpRight size={15}/></Link></section></div>
 {showPeers&&<RoadOptions benefitParams={benefitParams} key={regionId+'-'+threshold+'-'+timeScale} regionId={regionId} threshold={threshold} timeScale={timeScale}
   synthetic={d.synthetic} onOpen={id=>{
    setPointId(id);
    setScope('point');
    setScenario('new_road');
    setMapView(true);
    pendingRoadFocus.current=id;
    if(c?.options.scenario==='new_road' && c.options.scope==='point' && pointId===id)routeMap.current?.scrollIntoView({block:'start'});
   }}/>}

 {showPeers && !d.synthetic && scenario==='baseline' && threshold===40 && timeScale===1 &&
   <RegionalPeers key={regionId} regionId={regionId} onRoute={id=>{
     setPointId(id);
     setMapView(true);
     routeMap.current?.scrollIntoView({behavior:'smooth',block:'start'});
   }}/>}
 {showPeers && !d.synthetic && scenario==='baseline' && (threshold!==40 || timeScale!==1) && <Note>ML-поиск аномалий рассчитан для τ=40 минут и масштаба ×1. Выберите эти параметры, чтобы увидеть сопоставимую оценку.</Note>}

<StudyNotice synthetic={d.synthetic}/>
<FacilityDataQuality regionId={regionId}/>
 {c.comparisonWarning&&<Note tone="warning">{c.comparisonWarning}</Note>}<CalculationQuality result={r}/>{!d.synthetic&&<FacilitySelectionAudit regionId={regionId}/>}<div className="study-export-row"><span>МИЭД v6.1 · τ = {threshold} · данные {d.version} · {d.date} · {d.synthetic?'СЦЕНАРНАЯ МОДЕЛЬ':'МОДЕЛЬ НА РЕАЛЬНЫХ ДАННЫХ'}</span><button className="btn small outline" onClick={exportRows}><Download size={15}/>CSV таблицы</button><button className="btn small outline" onClick={()=>downloadJson({description:d,comparison:c},regionId+'-result.json')}><Download size={15}/>JSON расчёта</button><a className="btn small outline" href={'/api/study/'+regionId+'/dataset'} download><Download size={15}/>Исходный набор</a></div>
 {['new_road','new_facility'].includes(scenario)&&!c.investmentSuggestion&&<Note tone="warning">{pilot&&scenario==='new_road' ? 'Для выбранного масштаба нет проверенной трассы с требуемой экономией. Можно сравнить улучшение существующей дороги.' : scope==='point' ? `Для пункта «${selectedName}» среди проверенных вариантов ${scenario==='new_road'?'нет новой дороги':'нет новой медплощадки'}, улучшающей его маршрут. На карте показан исходный путь.` : 'Среди проверенных вариантов нет проекта, улучшающего доступность региона.'}</Note>}
 {c.investmentSuggestion&&<div className="study-scenario-details investment-proposal"><strong>Проектное предложение {scope==='point'?'для маршрута: '+selectedName:'для региона'}</strong><h3>{c.investmentSuggestion.title}</h3><p>{c.investmentSuggestion.rationale}</p><div className="proposal-stats"><span>Поселений с изменённым временем: <b>{c.investmentSuggestion.affectedSettlements}</b></span><span>Жителей таких поселений: <b>{format(c.investmentSuggestion.estimatedBeneficiaries,0)}</b></span>{c.investmentSuggestion.distanceKm!==null&&<span>Оценочная длина коридора: <b>{format(c.investmentSuggestion.distanceKm,2)} км</b></span>}</div><p className="fine-print">{c.investmentSuggestion.technicalWarning}</p></div>}
 {pilot && scenario==='new_road'&&<PilotRoadComparison current={c} query={query} onImprove={()=>{
   setScope(scope==='point'?'point':'region');setScenario('improvement');setMapView(true);
   pendingRoadFocus.current=pointId||'region';
 }}/>}
 {scenario!=='baseline'&&<div className="study-scenario-details"><strong>Проверить результат на карте</strong><p>Маршруты с изменённой геометрией или новым пунктом назначения: {changedRoutes.length}.  {scenario==='improvement'?'Ускорение дороги может изменить только время, не геометрию.':''}</p>{changedRoutes.length>0&&!(isAuto&&scope==='point')&&<label className="project-affected-picker">Поселение с реальным изменением расчётного маршрута<select value={changedRoutes.some(p=>p.id===pointId)?pointId:changedRoutes[0].id} onChange={e=>{setPointId(e.target.value);routeMap.current?.scrollIntoView({behavior:'smooth',block:'start'});}}>{changedRoutes.slice(0,150).map(p=><option key={p.id} value={p.id}>{p.name} · {format(c.baseline.points.find(x=>x.id===p.id)?.minutes)} → {format(p.minutes)} мин</option>)}</select><button className="btn small outline" onClick={()=>{setPointId(changedRoutes[0].id);routeMap.current?.scrollIntoView({behavior:'smooth',block:'start'});}}>↗ Показать наиболее заметное изменение</button></label>}{changedRoutes.length===0&&<p>Для данного сценария путь может остаться прежним. Смотрите изменение времени и индекса либо выберите другой сценарий.</p>}</div>}
 <div className="study-scenario-details"><strong>Как выбираются маршруты и улучшения</strong><p>{c.selectionRule}</p>{scenario==='improvement'&&scope!=='edge'&&<p>{c.selectedRoads.length?'Выбраны объекты: '+c.selectedRoads.map(x=>x.name+' ('+x.affectedOrigins+' исходных маршрутов)').join('; '):'Подходящих участков для улучшения не найдено. Проверьте выбранный пункт и данные.'}</p>}<p>Во всех сценариях пересчитывается кратчайший путь по новому графу. Для новых дорог геометрия и время — только гипотеза; для новой медплощадки клиническая пригодность не подтверждена. Для ускорения существующей дороги геометрия может не измениться.</p></div>
 <div className="dashboard-grid study-charts"><section className="panel"><h3>Распределение времени поездки</h3><TimeDistribution result={r}/></section><section className="panel"><h3>{d.synthetic?'Различия внутри выборки':'Муниципальные различия'}</h3><SectorChart result={r}/></section></div>
 <section className="panel study-point-table"><div className="panel-heading"><h3>Расчёт по каждому пункту</h3><span>{rows.length} строк</span></div><div className="study-table-filters"><label>Название<input aria-label="Найти населённый пункт" placeholder="Найти пункт…" value={q} onChange={e=>{setQ(e.target.value);setPage(0);}}/></label><label>{'Муниципалитет / зона'}<select value={municipality} onChange={e=>{setMunicipality(e.target.value);setPage(0);}}><option value="">Все</option>{municipalities.map(m=><option key={m}>{m}</option>)}</select></label></div><div className="table-scroll"><table><thead><tr><th>Пункт</th><th>Население{d.synthetic?' выборки':''}</th><th>Время, мин</th><th>Коэффициент</th><th>Вклад, баллы</th><th>Больница</th><th>Состояние</th></tr></thead><tbody>{rows.slice(currentPage*25,currentPage*25+25).map(p=><tr key={p.id} className={p.id===pointId?'is-selected':''}><td>{p.name}<small className="cell-secondary">{p.municipality}</small><button className="study-point-action" onClick={()=>{setPointId(p.id);routeMap.current?.scrollIntoView({behavior:'smooth',block:'start'});}}>Показать маршрут на карте ↗</button></td><td>{format(p.population,0)}</td><td>{format(p.minutes)}</td><td>{format(p.score,3)}</td><td>{format(p.score===null||!r.denominator?null:100*p.score*(r.weighting==='hybrid'?(0.752/r.includedSettlements+0.248*(p.population??0)/r.population):r.weighting==='settlement'?1/r.denominator:(p.population??0)/r.denominator),3)}</td><td>{[...d.facilities,...c.proposedFacilities].find(f=>f.id===p.facilityId)?.name??'—'}</td><td>{p.status==='reachable'?'Рассчитан':p.status==='unreachable'?'Нет пути в сценарии':'Вне расчёта'}</td></tr>)}</tbody></table></div><div className="study-pagination"><button className="btn small outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Назад</button><span>Страница {currentPage+1} из {Math.max(1,Math.ceil(rows.length/25))}</span><button className="btn small outline" disabled={(currentPage+1)*25>=rows.length} onClick={()=>setPage(currentPage+1)}>Далее</button></div></section>
 </>}
 <details className="panel study-assumptions"><summary>Данные, допущения и воспроизводимость</summary><p>Охват населения: {r?percent(r.populationCoverage):'—'}. Пунктов вне расчёта: {r?.missingSettlements??0}, из них с неподтверждённым маршрутом: {r?.unverifiedRoutes??0}.</p><ul>{d.assumptions.map(a=><li key={a}>{a}</li>)}</ul><p>Набор {d.id} · {d.nodes.toLocaleString('ru')} узлов · {d.edges.toLocaleString('ru')} связей · {d.facilityCount} центров. {d.synthetic?'Фиксированный seed: '+String(d.metadata.seed):'Координаты поселений представляют одну точку, поэтому внутригородские различия и подъезд до каждого дома не измеряются.'}</p><code>МИЭД v6.1: I = 100 × Σᵢ (0,752/N + 0,248 pᵢ/P) × [0,85 A(t₁ᵢ) + 0,10 A(t₂ᵢ) + 0,05 Uᵢ]; ускоренное снижение доступности после 60 минут</code></details>
 {showEconomics&&economicComparison&&<EconomicsModule regionId={regionId} description={d} comparison={economicComparison}/>}
 </div>;
}
