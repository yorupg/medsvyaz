import {useState} from 'react';
import type {StudyComparison} from '../study';
import {ErrorBox,format,useApi} from '../lib';

function effects(c:StudyComparison){
 const before=new Map(c.baseline.points.map(p=>[p.id,p.minutes]));
 let faster=0,within40=0;
 for(const p of c.after.points){
  const t=before.get(p.id);
  if(t==null || p.minutes===null)continue;
  if(t-p.minutes>0.001)faster++;
  if(t>40 && p.minutes<=40)within40++;
 }
 return {faster,within40};
}

export function PilotRoadComparison({current,query,onImprove}:{
 current:StudyComparison;query:string;onImprove:()=>void
}){
 const [open,setOpen]=useState(false);
 const params=new URLSearchParams(query);
 params.set('scenario','improvement');
 if(params.get('scope')!=='point')params.set('scope','region');
 params.delete('edgeId');
 const alternative=useApi<StudyComparison>(open?'/api/study/kaliningrad/compare?'+params:null);
 const id=current.options.scope==='point'?current.options.pointId:undefined;
 const origin=current.baseline.points.find(p=>p.id===id);
 const impact=effects(current);
 return <section className="panel pilot-road-compare">
  <h3>{origin?'Варианты для поездки из пункта «'+origin.name+'»':'Влияние дороги на область'}</h3>
  {current.investmentSuggestion && <p>Быстрее до больницы доберутся поселения: <b>{impact.faster}</b>.
   Впервые уложатся в 40 минут: <b>{impact.within40}</b>. МИЭД области: <b>{format(current.baseline.value,4)} → {format(current.after.value,4)}</b>.</p>}
  <button type="button" className="btn small outline" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Свернуть сравнение':'Проверить улучшение существующей дороги'}</button>
  {open && (alternative.error?<ErrorBox message={alternative.error} retry={alternative.retry}/>:!alternative.data?<p role="status">Пересчитываем поездки по существующим дорогам…</p>:<>
   <p>Та же исходная сеть и те же параметры поездки. В альтернативе скорость на выбранном существующем участке или группе участков умножается на {format(current.options.multiplier,2)}.</p>
   <div className="table-scroll"><table><thead><tr><th>Сценарий</th>{id&&<th>До больницы, мин</th>}<th>Поселений с выигрышем</th><th>Впервые в пределах 40 мин</th><th>Δ МИЭД области</th></tr></thead><tbody>
    {([{title:'Исходная сеть',c:current,base:true},{title:'Новая дорога',c:current,base:false},{title:'Улучшение существующей дороги',c:alternative.data,base:false}]).map(({title,c,base})=>{
     const impact=effects(c),missing=!base && title==='Новая дорога' && !c.investmentSuggestion;
     return <tr key={title}><th>{title}{missing&&<small className="cell-secondary">Нет подходящего проекта</small>}</th>
      {id&&<td>{missing?'—':format((base?c.baseline:c.after).points.find(p=>p.id===id)?.minutes,2)}</td>}
      <td>{missing?'—':base?0:impact.faster}</td><td>{missing?'—':base?0:impact.within40}</td><td>{missing?'—':base?'0':format(c.delta,4)}</td></tr>;
    })}
   </tbody></table></div>
   {alternative.data.selectedRoads.length>0&&<><p>Существующие участки: {alternative.data.selectedRoads.map(s=>s.name).join(', ')}.</p><button type="button" className="btn small outline" onClick={onImprove}>Открыть улучшение на карте</button></>}
  </>)}
 </section>;
}
