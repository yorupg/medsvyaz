import {useState} from 'react';
import {ErrorBox, Loading, format, useApi, Note} from '../lib';

type Case={
 id:string;name:string;municipality:string;actual:number;expected:number;gap:number;
 nearest:string;nearestKm:number;facility:string;directKm:number;minutes:number;
 featureNearby15:number;featureNearby30:number;
};
type Report={
 status:'available'|'insufficient_facilities'|'insufficient_groups';regionId:string;rows:Case[];
 total:number;included:number;municipalities:number;facilities:number;peers:number;
 mae:number;medianBaselineMae:number;evidence:'official-selected-sites'|'osm-unverified-medical-profile';
 warning?:string;caveat?:string;
};

/** ML is a geographically-conditioned diagnostic, not the main connectivity index. */
export function RegionalPeers({regionId,onRoute}:{regionId:string;onRoute:(id:string)=>void}){
 const {data,error,retry}=useApi<Report>('/downloads/'+encodeURIComponent(regionId)+'-peers.json');
 const [selected,setSelected]=useState('');
 if(error)return <ErrorBox message={error} retry={retry}/>;
 if(!data)return <Loading/>;
 if(data.status!=='available')return <section className="panel peer-panel"><h2>Где доступность ниже ожидаемой?</h2><Note tone="warning">{data.warning??'Недостаточно данных для независимой ML-оценки.'}</Note></section>;
 const point=data.rows.find(row=>row.id===selected)??data.rows[0];
 return <section className="panel peer-panel">
  <div className="peer-panel-heading"><div><span className="eyebrow">ПРОВЕРКА АНОМАЛИЙ · ML</span><h2>Где доступность ниже ожидаемой?</h2></div><span className="peer-coverage">{format(data.included,0)} пунктов</span></div>
  <p>Десять поселений с наибольшим отставанием дорожной доступности от других пунктов с похожим географическим расположением больниц.</p>
  {data.evidence==='osm-unverified-medical-profile'&&<Note tone="warning">Географические признаки основаны на больничных объектах OSM. Их профиль и фактический приём пациентов не подтверждены официальными документами. Такой анализ — только повод проверить данные и маршрут.</Note>}
  {point?<>
   <label>Поселение и разрыв в баллах<select aria-label="Поселение с ML-отклонением" value={point.id} onChange={event=>setSelected(event.target.value)}>{data.rows.map((row,i)=><option key={row.id} value={row.id}>{i+1}. {row.name} · {format(row.gap,1)} балла</option>)}</select></label>
   <small>{point.municipality}</small>
   <dl className="peer-metrics"><div><dt>Ожидаемая оценка по географии</dt><dd>{format(point.expected,1)}</dd></div><div><dt>По дорожной сети</dt><dd>{format(point.actual,1)}</dd></div><div><dt>Отклонение, баллы</dt><dd>{format(point.gap,1)}</dd></div></dl>
   <p><strong>{point.facility}</strong><br/>{format(point.directKm,1)} км по прямой до выбранной площадки · {format(point.minutes,0)} мин в дорожной модели.</p>
   {point.nearest!==point.facility&&<p>Ближайшая по прямой площадка — {point.nearest} ({format(point.nearestKm,1)} км).</p>}
   <button type="button" className="btn outline" onClick={()=>onRoute(point.id)}>Показать маршрут на карте</button>
  </>:<Note>Положительных отклонений на данном наборе не найдено.</Note>}
  <details><summary>Методика и независимая проверка ML</summary>
   <p>Для каждого населённого пункта ищутся {data.peers} географически похожих пунктов из <b>других муниципалитетов</b>. Признаки: расстояния по прямой до двух ближайших площадок и число площадок в радиусах 15 и 30 км. Прогноз — средняя фактическая дорожная оценка соседей в модели МИЭД v5.</p>
   <p>Для {data.included} из {data.total} поселений найдены расчётные маршруты. Площадок: {data.facilities}. Муниципалитетов: {data.municipalities}. Проверка с исключением целого муниципалитета: MAE {format(data.mae,2)} балла. Базовый прогноз медианой соседних муниципалитетов: MAE {format(data.medianBaselineMae,2)}.</p>
   <p>Оценки подготовлены для исходной сети, τ=40 минут и масштаба времени ×1. Изменение сценария требует нового расчёта ML.</p>
   <p>Это исследовательский сигнал, а не подтверждение плохой дороги, ошибки дорожного графа либо недоступности медицинской помощи.</p>
   <a href={'/downloads/'+regionId+'-peers.csv'} download>Скачать полный ML-расчёт по региону (CSV)</a>
  </details>
 </section>;
}
