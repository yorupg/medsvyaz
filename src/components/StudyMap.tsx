import {useEffect,useMemo,useRef,useState} from 'react';
import L from 'leaflet';
import type {FeatureCollection} from 'geojson';
import type {Dataset,PointResult,IndexResult} from '../../shared/schema';
import type {StudyComparison} from '../study';
import {populationRadius,pointMapColor,type MapDistribution} from '../../shared/map-metrics';
import {MapDistributionPanel} from './MapDistribution';
import {useApi,format,Loading,ErrorBox} from '../lib';
import 'leaflet/dist/leaflet.css';
import {Legend} from './GeoMap';
import {KaliningradMedicalControls,useKaliningradMedicalOverlay} from './KaliningradMedicalOverlay';
import {KaliningradHospitalRecommendations} from './KaliningradHospitalRecommendations';
import type {MedicalProposalCatalog,MedicalProposal,MedicalProposalClass} from './kaliningradPortfolio';
type MapPoint=PointResult&{lat:number;lon:number;snapMeters:number};
type MapData={threshold:number;indexValue:number|null;distribution:MapDistribution;points:MapPoint[];facilities:Dataset['facilities'];bounds:[[number,number],[number,number]];selectedRoad:{id:string;name:string;geometry:[number,number][];proposed?:boolean}[]};
type RouteData=PointResult&{coordinates:{id:string;kind:string;coordinates:[number,number][]}[]};
type RouteMode='baseline'|'improved'|'both';
type AgeEstimate={id:string;estimatedAges:{age0to17:number|null;age18to54:number|null;age55plus:number|null}};
type AgeData={regionId:string;rosstatReferencePopulation2021:number;datasetPopulation2021:number;rosstatAgeCounts:Record<string,number>;warning:string;settlements:AgeEstimate[]};
export function StudyMap({query,regionId,pointId,onPoint,onQuickScenario,comparison,portfolioEnabled,proposalMode,onProposalModeChange,portfolioCatalog,portfolioLoading,portfolioError,portfolioAfter}:{query:string;regionId:string;pointId:string;onPoint:(id:string)=>void;onQuickScenario:(scenario:'new_road'|'new_facility')=>void;comparison:StudyComparison;portfolioEnabled:boolean;proposalMode:MedicalProposalClass|null;onProposalModeChange:(mode:MedicalProposalClass)=>void;portfolioCatalog:MedicalProposalCatalog|null;portfolioLoading:boolean;portfolioError:string;portfolioAfter:IndexResult|null}){
 const data=useApi<MapData>('/api/study/'+regionId+'/map?'+query),container=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layers=useRef<L.LayerGroup|null>(null),routeLayer=useRef<L.FeatureGroup|null>(null);
 const [tileError,setTileError]=useState(false),[showTowns,setShowTowns]=useState(true),[weighted,setWeighted]=useState(false),[routeMode,setRouteMode]=useState<RouteMode>('improved');
 const [inspect,setInspect]=useState(false);
 const [mapReady,setMapReady]=useState(false);
 const medical=useKaliningradMedicalOverlay(mapReady?map.current:null,regionId,data.data?.facilities??[]);
 const [focusedHospitalRecommendation,setFocusedHospitalRecommendation]=useState<string|null>(null);
 const ageData=useApi<AgeData>(regionId==='kaliningrad'?'/data/kaliningrad-settlement-ages-2021.json':null);
 const ageLookup=useMemo(()=>new Map((ageData.data?.settlements??[]).map(x=>[x.id,x.estimatedAges])),[ageData.data]);
 const recommendationMarkers=useRef<Map<string,L.Marker>>(new Map());
 const proposal=regionId==='kaliningrad'?comparison.proposedEdges[0]:undefined;
 const obstacleData=useApi<Record<string,FeatureCollection>>(inspect&&proposal?'/data/kaliningrad-road-obstacles.json':null);
 const features=proposal?obstacleData.data?.[proposal.from+'|'+proposal.to]:null;
 const portfolioApplied=Boolean(regionId==='kaliningrad' && portfolioEnabled && proposalMode && portfolioAfter && portfolioCatalog);
 // The map's colours and population-weighted contributions use ONLY common MIED.
 // Experimental stars are an annotation layer, never a replacement of map scores.
 const shownPoints=data.data?.points??[];
 const targetResult=comparison.after;
 const includedPoints=targetResult?.includedSettlements??0, includedPopulation=targetResult?.population??0;
 const point=useMemo(()=>shownPoints.find(p=>p.id===pointId)??null,[shownPoints,pointId]);
 const routeUrl=point?'/api/study/'+regionId+'/route/'+encodeURIComponent(point.id):null;
 const baseQuery=useMemo(()=>{const params=new URLSearchParams(query);params.set('scenario','baseline');params.set('scope','edge');params.delete('pointId');return params.toString();},[query]);
 const baseline=useApi<RouteData>(routeUrl?routeUrl+'?'+baseQuery:null);
 const improved=useApi<RouteData>(routeUrl?routeUrl+'?'+query:null);
 const basePoint=comparison.baseline.points.find(p=>p.id===pointId),afterPoint=targetResult?.points.find(p=>p.id===pointId);

 useEffect(()=>{if(!container.current)return;const m=L.map(container.current,{scrollWheelZoom:false,minZoom:4,preferCanvas:regionId!=='kaliningrad',maxZoom:18});map.current=m;setMapReady(true);m.setView([57,35],6);m.attributionControl.setPrefix('');const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · ODbL',maxZoom:19}).addTo(m);tiles.on('tileerror',()=>setTileError(true));const resize=new ResizeObserver(()=>m.invalidateSize());resize.observe(container.current);return()=>{resize.disconnect(); routeLayer.current?.remove(); layers.current?.remove(); m.remove(); map.current=null;};},[]);
 useEffect(()=>{const m=map.current;if(!m||!data.data)return;layers.current?.remove();const group=L.layerGroup().addTo(m);layers.current=group;
  const maxPopulation=Math.max(1,...shownPoints.map(p=>p.population??0));
  if(showTowns)for(const p of shownPoints){if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;const marker=L.circleMarker([p.lat,p.lon],{radius:populationRadius(p.population,maxPopulation,weighted),color:p.id===pointId?'#143544':p.score===null?'#647888':'#fff',weight:p.id===pointId?3:1,fillColor:pointMapColor(p),fillOpacity:.88}).addTo(group);const tip=document.createElement('span');tip.textContent=p.name+' · '+format(p.minutes)+' мин · '+format(p.population,0)+' жителей (справочно) · вклад '+format(p.score===null||!includedPoints||!includedPopulation?null:100*p.score*(.752/includedPoints+.248*(p.population??0)/includedPopulation),4)+' балла';marker.bindTooltip(tip);marker.on('click',()=>onPoint(p.id));const el=marker.getElement();if(el){el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-label','Маршрут: '+p.name+' · '+p.id);el.addEventListener('keydown',e=>{if((e as KeyboardEvent).key==='Enter')onPoint(p.id);});}}
  for(const f of data.data.facilities){if(f.id.startsWith('catalog-')||f.lat===undefined||f.lon===undefined)continue;const isProposal=f.id==='__proposal__facility';if(!isProposal&&!medical.enabled.has('public_hospital'))continue;const marker=L.marker([f.lat,f.lon],{icon:L.divIcon({className:isProposal?'hospital-map-icon proposed-hospital-icon':'medsvyaz-medical-marker',html:isProposal?'<span>?</span>':'<span style="background:#c3384c">+</span>',iconSize:isProposal?[26,26]:[29,29],iconAnchor:isProposal?[13,13]:[14,14]}),title:f.name,alt:f.name}).addTo(group);const popup=document.createElement('div');const title=document.createElement('strong');title.textContent=f.name;popup.append(title,document.createElement('br'),document.createTextNode(f.officialAddress??''));marker.bindPopup(popup);const tip=document.createElement('span');tip.textContent=(isProposal?'Проектная медплощадка: ':'Круглосуточный стационар, категория «Государственные больницы»: ')+f.name;marker.bindTooltip(tip);}
  for(const road of data.data.selectedRoad.filter(road=>road.geometry?.length && !(proposal && road.proposed && routeMode==='baseline')))L.polyline(road.geometry.map(([x,y])=>[y,x] as [number,number]),{smoothFactor:road.proposed?0:1,color:road.proposed?'#bf4e88':query.includes('closure')?'#d05262':'#e69b24',weight:road.proposed?6:5,opacity:.9,dashArray:road.proposed?'11 7':query.includes('closure')?'7 6':undefined}).addTo(group);
 },[data.data,showTowns,query,weighted,pointId,onPoint,proposal,routeMode,regionId,medical.enabled,includedPoints,includedPopulation,shownPoints]);
 useEffect(()=>{
  const m=map.current;
  if(!m || !portfolioApplied || !portfolioCatalog || regionId!=='kaliningrad'){
   recommendationMarkers.current.clear();return;
  }
  const layer=L.layerGroup().addTo(m);recommendationMarkers.current.clear();
  for(const site of portfolioCatalog.candidates){
   const popup=document.createElement('div');const title=document.createElement('strong');title.textContent=site.name;
   const detail=document.createElement('p');detail.textContent=(site.kind==='private_paid_clinic'?'Платная клиника':'Больница с поликлиническим отделением')+' (гипотеза). Прирост МИЭД: '+site.indexIncrement.toFixed(2)+' балла. Охват: '+site.capturedPeople+' человек (оценка).';
   popup.append(title,detail);
   const marker=L.marker([site.lat,site.lon],{title:'Проектное учреждение №'+site.rank+' — '+site.settlement,
     icon:L.divIcon({className:'kaliningrad-proposed-star'+(site.proposalClass==='private_paid'?' is-private':'')+(focusedHospitalRecommendation===site.id?' is-selected':''),html:'<span>★</span>',iconSize:[40,40],iconAnchor:[20,20]})}).addTo(layer);
   marker.bindPopup(popup);
   marker.on('click',()=>{setFocusedHospitalRecommendation(site.id);m.flyTo([site.lat,site.lon],13,{duration:0.6});});
   recommendationMarkers.current.set(site.id,marker);
  }
  return()=>{layer.remove();recommendationMarkers.current.clear();};
 },[portfolioApplied,portfolioCatalog,regionId,mapReady,proposalMode]);
 const focusRecommendedHospital=(site:MedicalProposal)=>{
  setFocusedHospitalRecommendation(site.id);
  const m=map.current;
  if(!m)return;
  m.flyTo([site.lat,site.lon],14,{duration:0.7});
  recommendationMarkers.current.get(site.id)?.openPopup();
  for(const marker of recommendationMarkers.current.values())marker.getElement()?.classList.remove('is-selected');
  recommendationMarkers.current.get(site.id)?.getElement()?.classList.add('is-selected');
 };
 useEffect(()=>{if(data.data?.bounds)map.current?.fitBounds(data.data.bounds,{padding:[15,15]});},[regionId,JSON.stringify(data.data?.bounds)]);
 useEffect(()=>{const m=map.current;routeLayer.current?.remove();if(!m||!point)return;const group=L.featureGroup().addTo(m);routeLayer.current=group;
  const draw=(r:RouteData|null,color:string,dash:boolean)=>{if(!r||r.id!==point.id)return;for(const segment of r.coordinates)L.polyline(segment.coordinates.map(([x,y])=>[y,x] as [number,number]),{smoothFactor:segment.id==='__proposal__road'?0:1,color:segment.id==='__proposal__road'?'#b83d81':color,weight:segment.kind==='access'?3:5,opacity:.95,dashArray:dash||segment.kind==='access'?'7 6':undefined,interactive:false}).addTo(group);};
  if(portfolioApplied || routeMode==='baseline'||routeMode==='both')draw(baseline.data,'#566c84',true);
  if(!portfolioApplied && (routeMode==='improved'||routeMode==='both'))draw(improved.data,'#087d78',false);
  if(group.getLayers().length)m.fitBounds(group.getBounds(),{padding:[35,35],maxZoom:13});
 },[baseline.data,improved.data,pointId,routeMode,point?.id,portfolioApplied]);
 useEffect(()=>{
  const m=map.current;
  if(!inspect||!features||!proposal?.geometry||!m)return;
  const layer=L.geoJSON(features,{interactive:false,style:f=>{
   const water=f?.properties?.kind==='water';
   return {color:water?'#297bb0':'#6a584e',fillColor:water?'#6bbde1':'#a28976',weight:1.3,fillOpacity:0.55};
  }}).addTo(m);
  layer.bringToBack();
  m.fitBounds(L.latLngBounds(proposal.geometry.map(([x,y])=>[y,x])),{padding:[40,40],maxZoom:17});
  return ()=>{layer.remove();};
 },[inspect,features,proposal,improved.data,baseline.data,routeMode]);
 const hasScenario=!portfolioApplied && new URLSearchParams(query).get('scenario')!=='baseline';
 const proposalScenario=['new_road','new_facility'].includes(new URLSearchParams(query).get('scenario')??'');
 const proposalExists=comparison.proposedEdges.length>0||comparison.proposedFacilities.length>0;
 const selectedPathChanged=Boolean(basePoint&&afterPoint&&(basePoint.facilityId!==afterPoint.facilityId||basePoint.path.join('|')!==afterPoint.path.join('|')));
 const selectedImproved=Boolean(selectedPathChanged&&basePoint?.minutes!=null&&afterPoint?.minutes!=null&&afterPoint.minutes<basePoint.minutes-0.001);
 useEffect(()=>setRouteMode(proposalScenario?(selectedImproved?'both':'baseline'):(hasScenario?'both':'baseline')),[query,selectedImproved]);
 const proposedFacilityName=comparison.proposedFacilities.find(f=>f.id===afterPoint?.facilityId)?.name;
 const deltaScore=basePoint?.score!=null&&afterPoint?.score!=null?100*(afterPoint.score-basePoint.score):null;
 const deltaTime=basePoint?.minutes!=null&&afterPoint?.minutes!=null?afterPoint.minutes-basePoint.minutes:null;
 return <div className="study-map-wrap">
  <div className="study-map-index-summary" aria-live="polite"><strong>Основной МИЭД 85/10/5 · данный регион</strong><span>{format(comparison.baseline.value,2)} → {format(comparison.after.value,2)} / 100</span><small>{comparison.delta!=null?(comparison.delta>=0?'+':'')+format(comparison.delta,2)+' балла по основному индексу':'Нет сопоставимого изменения'}. {portfolioApplied?'Звёзды на карте — отдельный экспериментальный портфель 55/35/10, не изменение основного МИЭД.':''}</small></div>
  {proposal && <div className="study-route-buttons"><button type="button" aria-pressed={inspect} onClick={()=>{setInspect(!inspect);if(!inspect)setRouteMode('improved');}}>{inspect?'Скрыть препятствия':'Рассмотреть трассу и препятствия'}</button>
   {inspect&&<small>Дома — коричневые, вода — голубая, новая дорога — розовая. © OpenStreetMap, 08.11.2026.</small>}
   {inspect&&obstacleData.error&&<ErrorBox message={obstacleData.error} retry={obstacleData.retry}/>}</div>}
  {regionId==='kaliningrad'&&<div className="kaliningrad-proposals-action"><button type="button" aria-expanded={portfolioEnabled&&proposalMode==='public_integrated'} aria-controls="kaliningrad-proposal-list" onClick={()=>{onProposalModeChange('public_integrated');setFocusedHospitalRecommendation(null);}}>★ {portfolioEnabled&&proposalMode==='public_integrated'?'Скрыть экспериментальные предложения':'Пилот: три больницы с поликлиникой · 55/35/10'}</button><button type="button" className="private" aria-expanded={portfolioEnabled&&proposalMode==='private_paid'} aria-controls="kaliningrad-proposal-list" onClick={()=>{onProposalModeChange('private_paid');setFocusedHospitalRecommendation(null);}}>★ {portfolioEnabled&&proposalMode==='private_paid'?'Скрыть платные клиники':'Пилот: платные клиники · 55/35/10'}</button><small>{proposalMode==='private_paid'?'Частные клиники ранжируются по размеру города, удалённости от конкурентов и влиянию на амбулаторную часть индекса; на карте — зелёные звёзды.':'Гос. сценарий: больница с поликлиническим отделением. В общем индексе возрастные группы не учитываются, но используются при выборе мест.'}</small></div>}
  <div className={'kaliningrad-hospital-layout '+(portfolioEnabled&&regionId==='kaliningrad'?'is-open':'')}>
   <div className="study-map-canvas" ref={container} aria-label="Карта населённых пунктов, больниц и проектов"/>
   {portfolioEnabled&&regionId==='kaliningrad'&&<div id="kaliningrad-proposal-list">{portfolioLoading?<Loading/>:portfolioError?<p className="map-offline-note" role="alert">{portfolioError}</p>:portfolioCatalog?<KaliningradHospitalRecommendations data={portfolioCatalog} selected={focusedHospitalRecommendation} onSelect={focusRecommendedHospital} onClose={()=>proposalMode&&onProposalModeChange(proposalMode)}/>:null}</div>}
  </div>{data.loading&&<div className="study-map-loading"><Loading/></div>}{data.error&&<ErrorBox message={data.error} retry={data.retry}/>}
  {<KaliningradMedicalControls state={medical} regionId={regionId} baseHospitals={(data.data?.facilities??[]).filter(f=>f.id!=='__proposal__facility'&&!f.id.startsWith('catalog-')).length}/>}
  {regionId==='kaliningrad'&&ageData.data&&<details className="kaliningrad-age-summary"><summary>Возрастные группы жителей · данные Росстата и оценки по поселениям</summary>
    <p>Росстат, 01.01.2021: дети 0–17 — {ageData.data.rosstatAgeCounts.age_0_17.toLocaleString('ru-RU')}, взрослые 18–54 — {ageData.data.rosstatAgeCounts.age_18_54.toLocaleString('ru-RU')}, жители 55+ — {ageData.data.rosstatAgeCounts.age_55_plus.toLocaleString('ru-RU')}.</p>
    <p>Население набора поселений по ВПН-2021: {ageData.data.datasetPopulation2021.toLocaleString('ru-RU')}; на 01.01.2021 Росстат оценивает регион в {ageData.data.rosstatReferencePopulation2021.toLocaleString('ru-RU')}. Это разные даты/методы учёта.</p>
    <p>Возрастные числа каждого поселения — <strong>модельная оценка</strong> по городской или сельской структуре области, не измеренный возрастной состав данного поселения. 18-летние включены во взрослую группу, чтобы учесть всех жителей. <a href="https://rosstat.gov.ru/storage/mediabank/Bul_chislen_nasel-pv_01-01-2021.pdf" target="_blank" rel="noreferrer">Официальная таблица Росстата</a>.</p>
    </details>}
  <div className="study-map-toolbar"><label className="map-point-picker">Маршрут от поселения<select aria-label="Поселение на карте" value={pointId} onChange={e=>onPoint(e.target.value)}><option value="">Выберите пункт</option>{[...(data.data?.points??[])].sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(p=><option key={p.id} value={p.id}>{p.name} · {p.municipality}</option>)}</select></label><label className="checkbox"><input type="checkbox" checked={showTowns} onChange={e=>setShowTowns(e.target.checked)}/>Поселения</label><button className="btn small outline" onClick={()=>data.data?.bounds&&map.current?.fitBounds(data.data.bounds)}>Вся область</button><label>Размер точек<select aria-label="Размер точек поселений" value={weighted?'population':'equal'} onChange={e=>setWeighted(e.target.value==='population')}><option value="population">По населению</option><option value="equal">Одинаковый</option></select></label><span><b className="hospital-key">+</b> {(data.data?.facilities??[]).filter(f=>f.id!=='__proposal__facility'&&!f.id.startsWith('catalog-')).length} базовых больничных площадок {data.data?.facilities.some(f=>f.id==='__proposal__facility')?' · ? проектная площадка':''}</span></div>
  {point&&hasScenario&&<div className="study-route-buttons" aria-label="Сравнение маршрутов"><button type="button" className={routeMode==='baseline'?'active':''} onClick={()=>setRouteMode('baseline')}>↗ Базовый маршрут</button><button type="button" className={routeMode==='improved'?'active':''} disabled={proposalScenario&&!selectedImproved} onClick={()=>setRouteMode('improved')}>↗ Маршрут после проекта</button><button type="button" className={routeMode==='both'?'active':''} disabled={proposalScenario&&!selectedImproved} onClick={()=>setRouteMode('both')}>Сравнить два маршрута</button></div>}
  {point&&!hasScenario&&!portfolioApplied&&<div className="study-route-buttons" aria-label="Базовый маршрут"><button type="button" className="active" onClick={()=>setRouteMode('baseline')}>↗ Базовый маршрут</button><span className="study-route-hint">Сценарии новых медучреждений включаются отдельными кнопками над картой. Кнопки государственных проектов по основному МИЭД расположены над картой.</span></div>}{point&&!portfolioApplied&&<div className={'proposal-route-result '+(proposalScenario&&!selectedImproved?'proposal-route-warning':'')} aria-live="polite"><strong>{!hasScenario?'Текущий путь до существующей медицинской площадки':proposalScenario&&!proposalExists?'Проектное улучшение не найдено':proposalScenario&&!selectedImproved?'Выбранный пункт не затронут проектом':afterPoint?.status==='unreachable'?'После закрытия участка путь недоступен':selectedPathChanged?'Маршрут выбранного пункта изменился':'Маршрут проходит по прежним участкам'}</strong><span>Время: {format(basePoint?.minutes)} → {format(afterPoint?.minutes)} мин · Доступность: {format(basePoint?.score==null?null:basePoint.score*100)} → {format(afterPoint?.score==null?null:afterPoint.score*100)} / 100</span>{proposedFacilityName&&<span>Новое проектное назначение: {proposedFacilityName}</span>}{proposalScenario&&!selectedImproved&&<span>На карте показан исходный маршрут выбранного поселения.</span>}</div>}{tileError&&<p className="map-offline-note">Фоновая карта недоступна. Локальные точки и расчётные маршруты остаются доступны.</p>}<div className="study-map-legend"><Legend threshold={data.data?.threshold} points/></div><p className="journey-map-note">{weighted?'Размер точек отражает население.':'Размер точек одинаковый.'} Основной МИЭД v6.1 для всех регионов: 85% — ближайшее бесплатное медучреждение, 10% — второе ближайшее, 5% — устойчивость маршрута. Эксперимент 55/35/10 для Калининграда показан отдельно. Частные платные клиники не входят в общий индекс. Возрастные группы в индекс не входят. Серый пунктир — базовый путь, бирюзовая линия — путь после активного проектного сценария, знак ? — проектная медплощадка. Эскизы дорог требуют инженерной проверки. Значки на карте не подтверждают статус лицензирования и бесплатного приёма.</p>{data.data&&!portfolioApplied&&<MapDistributionPanel distribution={data.data.distribution} threshold={data.data.threshold}/>}
  {baseline.error&&<ErrorBox message={baseline.error} retry={baseline.retry}/ >}{improved.error&&<ErrorBox message={improved.error} retry={improved.retry}/ >}
  <div className="study-map-detail">{point?<><strong>{point.name}</strong>{regionId==='kaliningrad'&&ageLookup.get(point.id)&&<span className="study-age-point">Оценка населения по возрастам: 0–17 — {format(ageLookup.get(point.id)?.age0to17,0)}, 18–54 — {format(ageLookup.get(point.id)?.age18to54,0)}, 55+ — {format(ageLookup.get(point.id)?.age55plus,0)} (доли городского/сельского населения Росстат-2021, не измерено в данном пункте).</span>}<span>Было: {format(basePoint?.minutes)} мин → Стало: {format(afterPoint?.minutes)} мин {deltaTime!==null?'('+((deltaTime>0?'+':'')+format(deltaTime))+' мин)':''}</span><span>Доступность пункта: {format(basePoint?.score==null?null:100*basePoint.score,2)} → {format(afterPoint?.score==null?null:100*afterPoint.score,2)} / 100 · Δ {deltaScore===null?'—':(deltaScore>=0?'+':'')+format(deltaScore,2)} балла</span>{portfolioApplied&&<small>Серая линия и значения маршрута относятся к основному МИЭД. Звёзды портфеля — экспериментальные площадки; изменения 55/35/10 приведены отдельно, они не заменяют основной индекс. {proposalMode==='private_paid'?'У частных клиник меняется только амбулаторная часть индекса.':'Новый объект считается больницей с поликлиническим отделением.'}</small>}<small>{(point.facilityId)?'Пункт назначения после сценария: '+(data.data?.facilities.find(f=>f.id===(point.facilityId))?.name??portfolioCatalog?.candidates.find(f=>f.id===point.facilityId)?.name??(point.facilityId))+' · ':''}{(afterPoint?.status??point.status)==='missing_node'?'Нет привязки к сети':(afterPoint?.status??point.status)==='unreachable'?'Недоступно в выбранном сценарии':(afterPoint?.status??point.status)==='route_unverified'?'Нет подтверждённого модельного маршрута':'Пути рассчитаны алгоритмом Дейкстры по соответствующей дорожной сети.'}</small><button className="text-link" onClick={()=>onPoint('')}>Снять выбор</button></>:<><strong>От поселения к бесплатному медучреждению</strong><span>Выберите точку, чтобы увидеть расчётное время и оценку доступности до и после выбранного портфеля.</span></>}</div>
 </div>;
}
