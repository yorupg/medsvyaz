import type {IndexResult} from '../../shared/schema';
import {METHODOLOGY} from '../../shared/schema';
import {accessibility,comfortFor} from '../../shared/engine';
import {format,percent,Note,useApi} from '../lib';

export function FacilitySelectionAudit({regionId}:{regionId:string}){
 const {data}=useApi<{strictExcluded:{id:string;name:string}[];strictSelection:{index:number|null;delta:number|null};dominantFacility:string|null;withoutDominant:{index:number|null;delta:number|null}}>('/api/study/'+regionId+'/bias-audit');
 if(!data)return null;
 return <section className="panel"><h3>Влияние отбора больничных площадок · архив v4</h3><p><strong>Исторический расчёт v4, τ=30 без комфортной зоны.</strong> Цифры ниже не относятся к текущему индексу v5; пересчёт влияния больниц по v5 потребуется выполнить отдельно.</p><p>Дополнительный фильтр по названиям исключает {data.strictExcluded.length} объектов с признаками отдельных корпусов, отделений, администрации или специализированной помощи. Индекс при таком отборе: {format(data.strictSelection.index,2)}; изменение: {format(data.strictSelection.delta,2)} п.п.</p><p>При исключении наиболее влиятельной площадки «{data.dominantFacility}» индекс составляет {format(data.withoutDominant.index,2)}; изменение: {format(data.withoutDominant.delta,2)} п.п.</p><p>Это проверка чувствительности, не утверждение о фактическом закрытии или пригодности учреждения. В обоих экспериментах население фиксировано; потерянные в модели маршруты получают ноль. Фильтр названий не заменяет официальную проверку медицинского профиля.</p></section>;
}

export function CalculationQuality({result:r}:{result:IndexResult}){
 return <section className="panel calculation-quality"><h3>Полнота и распределение времени поездки</h3>
 <div className="materials-stat-grid">
 {[['Медиана, мин',format(r.medianMinutes)],['90-й процентиль, мин',format(r.p90Minutes)],['Поездка более 60 минут',percent(r.overMinutesShares['60'])],['Поездка более 90 минут',percent(r.overMinutesShares['90'])]].map(([label,value])=><article key={label}><strong>{value}</strong><span>{label}</span></article>)}
 </div><p>Медиана, P90 и доли долгих поездок рассчитаны по поселениям с конечным маршрутом; вес каждого равен единице. Потерянные в сценарии маршруты: {format(r.unreachablePopulation,0)} жителей.</p>
 <p><strong>{r.synthetic?'Охват выборки':'Покрытие населения источника'}: {percent(r.populationCoverage)}</strong> · в расчёте {format(r.population,0)} из {format(r.expectedPopulation,0)} жителей. Без оценки: {format(r.excludedPopulation,0)} жителей; вне расчёта {r.missingSettlements} поселений.</p>
 {!r.synthetic&&<Note>Индекс {format(r.value,2)} относится к {r.includedSettlements} из {r.expectedSettlements} поселений ({percent(r.settlementCoverage)}). При неизвестной доступности остальных поселений границы оценки полного перечня: <strong>{format(r.indexBounds.lower,2)}–{format(r.indexBounds.upper,2)}</strong>. Это границы возможных значений, а не доверительный интервал и не замена пропусков фактической недостижимостью.</Note>}
 <h3>Чувствительность к τ · выбранный сценарий</h3><div className="table-scroll"><table aria-label="Чувствительность к параметру полуснижения"><thead><tr><th>τ, минут</th><th>Индекс, баллы</th><th>Методика</th></tr></thead><tbody>{METHODOLOGY.allowedThresholds.map(tau=>{
  const numerator=r.points.reduce((sum,p)=>sum+(p.score===null||p.minutes===null?0:accessibility(p.minutes,tau,comfortFor(r.methodologyVersion))),0);
  return <tr key={tau}><td>{tau}</td><td>{format(r.denominator?100*numerator/r.denominator:null,3)}</td><td>{tau===r.threshold?'МИЭД '+r.methodologyVersion+' · основной параметр':'МИЭД '+r.methodologyVersion+' · чувствительность'}</td></tr>;
 })}</tbody></table></div><p>Каждое значение рассчитано заново из времени поездки каждого поселения с единичным весом. Цветовая шкала 0–100 сохраняется.</p>
 </section>;
}
