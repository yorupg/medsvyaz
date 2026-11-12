import {useState} from 'react';
import type {RoadOption} from '../../shared/engine';
import {ErrorBox,format,useApi} from '../lib';

export function RoadOptions({regionId,threshold,timeScale,synthetic,benefitParams,onOpen}:{
 regionId:string;threshold:number;timeScale:number;synthetic:boolean;benefitParams:string;onOpen:(pointId:string)=>void
}){
 const {data,error,retry}=useApi<{rows:RoadOption[]}>(
  '/api/study/'+encodeURIComponent(regionId)+'/road-options?threshold='+threshold+'&timeScale='+timeScale+(benefitParams?'&'+benefitParams:'')
 );
 const [query,setQuery]=useState('');
 const [limit,setLimit]=useState(5);
 const rows=data?.rows??[];
 const term=query.trim().toLocaleLowerCase('ru');
 const matches=rows.filter(p=>(p.name+' '+p.municipality).toLocaleLowerCase('ru').includes(term));
 return <section className="panel road-options" aria-label="Поселения с предложением новой дороги">
  <h2>Где новая дорога сократит поездку?</h2>
  <p>Поселения, для которых проверенный на графе вариант сокращает путь до больницы и повышает доступность. Первыми показаны маршруты с наибольшей экономией времени.</p>
  {regionId==='kaliningrad'&&<p className="fine-print">Проверка трассы по зданиям и водным объектам OpenStreetMap от 08.11.2026. Для включения в список должны выполняться оба условия экономии.</p>}
  {error?<ErrorBox message={error} retry={retry}/>:!data?<p role="status">Проверяем варианты для региона…</p>:rows.length===0?
   <p role="status">{regionId==='kaliningrad'?'Среди проверенных трасс ни одна не проходит выбранные пороги экономии.':'При этих параметрах среди рассмотренных вариантов нет новой дороги, улучшающей маршрут поселения.'}</p>:<>
   <small>{synthetic?'Учебная модель':'Расчёт по дорожной сети'} · Подходящих поселений: {rows.length}</small>
   {rows.length>5&&<label>Найти поселение или муниципалитет
    <input type="search" value={query} onChange={e=>{setQuery(e.target.value);setLimit(5)}}/>
   </label>}
   {matches.length===0?<p>По вашему запросу поселений не найдено.</p>:
    <ul>{matches.slice(0,limit).map(p=><li key={p.id}><div><strong>{p.name}</strong><small>{p.municipality}</small>
      <span>{format(p.before,2)} → {format(p.after,2)} мин · экономия {format(p.before-p.after,2)} мин</span></div>
      <button type="button" className="btn small outline" aria-label={'Открыть предложение: '+p.name+' · '+p.municipality} onClick={()=>onOpen(p.id)}>Открыть предложение</button>
    </li>)}</ul>}
   {matches.length>limit&&<button className="text-link" onClick={()=>setLimit(n=>n+10)}>Показать ещё ({matches.length-limit})</button>}
  </>}
 </section>;
}
