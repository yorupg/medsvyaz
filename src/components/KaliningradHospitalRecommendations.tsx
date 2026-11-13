import type {MedicalProposalCatalog,MedicalProposal} from './kaliningradPortfolio';
import './KaliningradHospitalRecommendations.css';
export type {MedicalProposalCatalog} from './kaliningradPortfolio';
const fmt=(x:number,decimals=0)=>x.toLocaleString('ru-RU',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
const proposalTitle:Record<MedicalProposalCatalog['proposalClass'],string>={
  public_integrated:'Рейтинг новых больниц с поликлиническим отделением',
  private_paid:'Рейтинг размещения платных клиник'
};
const proposalIntro:Record<MedicalProposalCatalog['proposalClass'],string>={
  public_integrated:'Подбор из существующих населённых пунктов рядом с дорогами. Каждый объект трактуется как больница с поликлиническим отделением: он влияет и на больничную, и на амбулаторную части индекса. Возрастные группы учитываются только при выборе места.',
  private_paid:'Подбираются до трёх городов для платных клиник. Рейтинг сочетает размер рынка, расстояние до конкурентов, влияние на амбулаторную доступность и возрастную структуру спроса. Частная клиника отмечается на карте зелёной звездой.'
};
const labels:Record<MedicalProposal['kind'],string>={
  public_hospital_polyclinic:'Больница с поликлиническим отделением',
  private_paid_clinic:'Платная клиника'
};

export function KaliningradHospitalRecommendations({data,selected,onSelect,onClose}: {
  data:MedicalProposalCatalog;selected:string|null;onSelect:(s:MedicalProposal)=>void;onClose:()=>void;
}) {
  const isPrivate=data.proposalClass==='private_paid';
  return <aside className="kaliningrad-hospital-side" aria-label="Рейтинг предлагаемых новых медицинских учреждений">
    <div className="kaliningrad-hospital-head">
      <div><span className="eyebrow">МОДЕЛЬНЫЕ ПРЕДЛОЖЕНИЯ · {isPrivate?'ПЛАТНЫЕ КЛИНИКИ':'3 ОБЪЕКТА'}</span><h3>{proposalTitle[data.proposalClass]}</h3></div>
      <button type="button" className="kaliningrad-hospital-close" onClick={onClose} aria-label="Закрыть рейтинг">×</button>
    </div>
    <p className="kaliningrad-hospital-description">{proposalIntro[data.proposalClass]} <strong>Это отдельная исследовательская модель, её баллы нельзя сравнивать с основным МИЭД 85/10/5.</strong> Подбор предварительный: существующие учреждения могут отсутствовать в каталоге, и их нужно проверить.</p>
    <div className="kaliningrad-hospital-portfolio">
      <span>Экспериментальный показатель 55/35/10 · исходно → все проекты</span>
      <strong>{fmt(data.baselineIndex,2)} → {fmt(data.indexAfterThree,2)}</strong>
      <b>{data.totalGain>=0?'+':''}{fmt(data.totalGain,2)} балла</b>
      <small>{data.coverageDefinition}</small>
      <small>Население поселений, затронутых всем портфелем: {fmt(data.portfolio.affectedPopulation)}.</small>
    </div>
    <div className="kaliningrad-hospital-cards">
      {data.candidates.map(item=><button key={item.id} type="button"
        className={'kaliningrad-hospital-card '+(selected===item.id?'is-selected':'')}
        aria-pressed={selected===item.id} onClick={()=>onSelect(item)}>
        <div className="kaliningrad-hospital-card-title"><span className={'kaliningrad-hospital-star '+(isPrivate?'is-private':'')}>
          ★</span>
        <span><strong>№{item.rank} · {item.settlement}</strong><small>{item.municipality}</small></span>
        <b>{item.indexIncrement>0?'+':''}{fmt(item.indexIncrement,2)} эксп.</b></div>
        <div className="kaliningrad-proposal-kind">{labels[item.kind]}</div>
        <div className="kaliningrad-hospital-card-stats"><span>Охват: <b>{fmt(item.capturedPeople)}</b> жителей (оценка)</span><span>Эксп. показатель после этапа: <b>{fmt(item.indexAfter,2)}</b></span></div>
        <div className="kaliningrad-hospital-card-stats"><span>Рейтинг: <b>{fmt(item.rankScore,1)}/100</b></span><span>Пунктов с эффектом: <b>{fmt(item.affectedSettlements)}</b></span></div>
        <small>Возрастные оценки поселения: дети — {fmt(item.estimatedAge.children0_17)}, 18–54 — {fmt(item.estimatedAge.adults18_54)}, 55+ — {fmt(item.estimatedAge.older55_plus)}.</small>
        <small>До дорожного узла: {fmt(item.snapDistanceMeters)} м · ближайшая больница: {fmt(item.nearestExistingHospitalKm,1)} км · ближайшая поликлиника: {fmt(item.nearestExistingPolyclinicKm,1)} км{item.nearestPrivateClinicKm!=null?` · ближайшая частная клиника: ${fmt(item.nearestPrivateClinicKm,1)} км`:''}.</small>
        <span className="kaliningrad-hospital-link">Показать звезду на карте →</span>
      </button>)}
    </div>
    <details className="kaliningrad-hospital-method"><summary>Методика и ограничения</summary>
      {data.selectionPolicy&&<p>{data.selectionPolicy}</p>}
      {data.selectionCaveat&&<p>{data.selectionCaveat}</p>}
      <p>{data.ageEstimates}</p>
      <p>{data.validation}</p>
      {data.medicalScope&&<p>{data.medicalScope}</p>}
      <ul>{data.sourceUrls.map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>
    </details>
  </aside>;
}
