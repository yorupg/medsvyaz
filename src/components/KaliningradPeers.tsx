import {useState} from 'react';
import {ErrorBox, Loading, format, useApi} from '../lib';

type Case = {
  id:string; name:string; municipality:string; actual:number; expected:number; gap:number;
  nearest:string; nearestKm:number; facility:string; directKm:number; routeKm:number; minutes:number;
};
type Report = {
  rows:Case[]; total:number; included:number; municipalities:number; facilities:number; peers:number;
  mae:number; medianBaselineMae:number; comparable:number; topTenOverlap:number;
};

export function KaliningradPeers({onRoute}:{onRoute:(id:string)=>void}) {
  const {data, error, retry} = useApi<Report>('/downloads/kaliningrad-peers.json');
  const [selected, setSelected] = useState('');
  if (error) return <ErrorBox message={error} retry={retry}/>;
  if (!data) return <Loading/>;
  const point = data.rows.find(row => row.id === selected) ?? data.rows[0];
  if (!point) return null;
  return <section className="panel peer-panel">
    <h2>Где доступность ниже ожидаемой?</h2>
    <p>Десять поселений с самым большим отставанием от пунктов с похожим расположением больниц.</p>
    <label>Поселение и разрыв в баллах
      <select value={point.id} onChange={event => setSelected(event.target.value)}>
        {data.rows.map((row, i) => <option key={row.id} value={row.id}>{i+1}. {row.name} · {format(row.gap,1)} балла</option>)}
      </select>
    </label>
    <small>{point.municipality}</small>
    <dl className="peer-metrics">
      <div><dt>Ожидаемо по расположению</dt><dd>{format(point.expected,1)}</dd></div>
      <div><dt>По дорожной сети</dt><dd>{format(point.actual,1)}</dd></div>
      <div><dt>Отставание, баллы</dt><dd>{format(point.gap,1)}</dd></div>
    </dl>
    <p><strong>{point.facility}</strong><br/>{format(point.directKm,1)} км по прямой до выбранной площадки · {format(point.routeKm,1)} км по сети · {format(point.minutes,0)} мин в модели.</p>
    {point.nearest!==point.facility && <p>Ближайшая по прямой площадка — {point.nearest} ({format(point.nearestKm,1)} км).</p>}
    <button type="button" className="btn outline" onClick={()=>onRoute(point.id)}>Показать маршрут на карте</button>
    <details><summary>Как рассчитана и проверена оценка ML</summary>
      <p>Для каждого пункта алгоритм k ближайших соседей находит {data.peers} поселений из других муниципалитетов. Он сравнивает расстояния по прямой до двух ближайших площадок и число площадок в радиусах 15 и 30 км. Ожидаемый балл — средняя дорожная доступность этих соседей.</p>
      <p>Проверены {data.included} из {data.total} пунктов с данными по {data.facilities} больничным площадкам. Включены только достижимые пункты. Каждый из {data.municipalities} муниципалитетов по очереди целиком исключался из обучения. Средняя абсолютная ошибка — {format(data.mae,2)} балла, у прогноза по медиане обучающей выборки — {format(data.medianBaselineMae,2)}.</p>
      <p>Среди {data.comparable} пунктов, где до выбранной площадки по прямой хотя бы 1 км, две первые десятки совпали по {data.topTenOverlap} пунктам: одна по разрыву баллов, другая по отношению длины маршрута к расстоянию по прямой. Большое отставание — повод проверить маршрут и координаты на карте.</p>
      <a href="/downloads/kaliningrad-peers.csv" download>Скачать расчёты по всем поселениям выборки (CSV)</a>
    </details>
  </section>;
}
