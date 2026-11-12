import {BrainCircuit,MapPin,Route} from 'lucide-react';
import {format,useApi} from '../lib';
import type {MlReport} from '../../server/ml';

/** Shown only for a real baseline network. Selecting a row opens the actual route on StudyMap. */
export function AnomalyPanel({regionId,threshold,timeScale,hasRouting,onSelect}:{
 regionId:string;threshold:number;timeScale:number;hasRouting:boolean;onSelect:(id:string)=>void;
}){
 const url=hasRouting?'/api/study/'+encodeURIComponent(regionId)+'/anomalies?threshold='+threshold+'&timeScale='+timeScale:null;
 const {data,loading,error,retry}=useApi<MlReport>(url);
 return <section className="panel ml-anomalies" aria-labelledby="ml-anomaly-title">
  <div className="panel-heading"><h3 id="ml-anomaly-title"><BrainCircuit size={20}/> Где поездка сложнее, чем у похожих поселений</h3><span>ML · исследовательский анализ</span></div>
  <p>Модель k-ближайших соседей прогнозирует типичный балл по расстоянию <strong>по прямой</strong> до ближайшей больницы и количеству больниц в радиусе 50 км. Затем сравниваем прогноз с баллом, рассчитанным по дорогам. Основной индекс МИЭД при этом не меняется.</p>
  {!hasRouting?<p className="fine-print">В облегчённом архиве для этого региона есть сводный индекс, но нет полного дорожного графа. Откройте FULL-версию, чтобы получить ML-анализ и проверить маршруты.</p>:
   loading?<p>Рассчитываем сходство поселений…</p>:
   error?<p role="alert">Не удалось построить ML-анализ: {error} <button className="text-link" onClick={retry}>Повторить</button></p>:
   data?.status==='insufficient_data'?<p>{data.warning}</p>:
   data?.status==='ok'?<>
    <p className="fine-print">Исходная сеть · τ = {threshold} мин · масштаб времени ×{format(timeScale,1)}. Обучающих поселений: {data.trainingSamples} из {data.samples}; соседей: {data.neighbours}; ошибка leave-one-out MAE: {format(data.maePoints)} балла. Показываем разрывы от {format(data.minimumGapPoints)} балла.</p>
    {data.anomalies.length?<div className="ml-anomaly-list">{data.anomalies.map(a=><button type="button" key={a.id} className="ml-anomaly-item" onClick={()=>onSelect(a.id)} title="Открыть фактический дорожный маршрут">
     <span className="ml-anomaly-main"><strong>{a.name}</strong><small>{a.municipality}</small><span>Ожидание {format(a.expectedScore)} → по дорогам {format(a.actualScore)} / 100</span><span><MapPin size={13}/> Ближайшая по прямой: {a.nearestFacilityName} · {format(a.nearestDistanceKm)} км · объектов в радиусе 50 км: {a.facilitiesWithin50Km}</span><span><Route size={13}/> Расчётная поездка: {format(a.roadMinutes)} мин{a.routeFacilityName?' · '+a.routeFacilityName:''}</span></span>
     <span className="ml-anomaly-difference">−{format(a.gapPoints)}<small>балла</small><span>Открыть маршрут →</span></span>
    </button>)}</div>:<p>По выбранному порогу значимых отрицательных отклонений не найдено. Это не означает, что труднодоступных поселений нет.</p>}
    <p className="fine-print">Разрыв — повод проверить извилистую дорогу, мост, въезд в больницу или привязку точек. Он сам по себе не указывает причину. Ближайшая по прямой больница может отличаться от больницы, выбранной по минимальному дорожному времени. Ошибка leave-one-out — внутренняя проверка модели, не внешняя валидация.</p>
   </>:null}
 </section>;
}
