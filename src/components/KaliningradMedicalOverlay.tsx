import {useEffect,useMemo,useState} from 'react';
import L from 'leaflet';
import type {Dataset} from '../../shared/schema';
import './KaliningradMedicalOverlay.css';

/** Ownership is the PRIMARY classification. fee=yes alone NEVER implies private. */
export type MedicalCategory =
  'public_hospital' | 'public_adult_polyclinic' | 'public_children_polyclinic' |
  'private_paid';
export type MedicalType='hospital'|'adult_polyclinic'|'children_polyclinic'|'ambulatory'|'other_clinic';
export type MedicalPlace = {
  id:string; name:string; type:MedicalCategory; medicalType:MedicalType; lat:number; lon:number;
  address?:string; ownership?:'public'|'private'|'unknown';
  feeStatus?:'paid-tagged'|'paid-confirmed'|'free-tagged'|'free-confirmed'|'unknown';
  sourceUrl?:string; officiallyVerified?:boolean; classificationReason?:string;
  verificationSourceUrl?:string; reviewComment?:string; hasOsmName?:boolean; website?:string|null;
};
export type MedicalCatalog = {
  regionId:string; generatedAt?:string; source?:string; count?:number;
  completeness?:string; indexEffect?:string; facilities:MedicalPlace[];
};
type BaselineFacility = Dataset['facilities'][number];
export const MEDICAL_CATEGORIES:{id:MedicalCategory;label:string;symbol:string;color:string;group:'public'|'private'}[] = [
  {id:'public_hospital',label:'Больницы (реестр / OSM)',symbol:'+',color:'#c3384c',group:'public'},
  {id:'public_adult_polyclinic',label:'Взрослые и общие поликлиники (OSM / реестр)',symbol:'П',color:'#2474bf',group:'public'},
  {id:'public_children_polyclinic',label:'Детские поликлиники (OSM / реестр)',symbol:'Д',color:'#9450c1',group:'public'},
  {id:'private_paid',label:'Частные платные клиники (классификация OSM)',symbol:'₽',color:'#2b9b56',group:'private'},
];
const categories = new Map(MEDICAL_CATEGORIES.map(c=>[c.id,c]));
const norm = (v:string)=>v.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,'');
function distanceMetres(a:{lat:number;lon:number},b:{lat:number;lon:number}) {
  const r=Math.PI/180, dy=(a.lat-b.lat)*r, dx=(a.lon-b.lon)*r;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(dy/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dx/2)**2)));
}
/** Avoid overlaying OSM copies of the ten baseline hospitals. */
export function excludeDuplicateBaseline(facilities:MedicalPlace[],base:BaselineFacility[]) {
  return facilities.filter(f=>!base.some(b=>
    b.id!=='__proposal__facility' && b.lat!==undefined && b.lon!==undefined &&
    f.medicalType==='hospital' && distanceMetres(f,{lat:b.lat,lon:b.lon})<80 &&
    (distanceMetres(f,{lat:b.lat,lon:b.lon})<22 || norm(f.name)===norm(b.name) ||
      norm(f.name).includes(norm(b.name)) || norm(b.name).includes(norm(f.name)))
  ));
}
function iconFor(type:MedicalCategory) {
  const {color,symbol}=categories.get(type)!;
  // Only hardcoded category definitions are interpolated into HTML.
  return L.divIcon({className:'medsvyaz-medical-marker',
    html:`<span style="background:${color}">${symbol}</span>`,
    iconSize:[29,29],iconAnchor:[14,14],popupAnchor:[0,-15]});
}
function makePopup(place:MedicalPlace) {
  const root=document.createElement('div');
  const name=document.createElement('strong');name.textContent=place.name;root.append(name);
  const type=document.createElement('div');type.textContent=categories.get(place.type)?.label??'Медучреждение';root.append(type);
  if(place.address){const address=document.createElement('div');address.textContent=place.address;root.append(address);}
  const info=document.createElement('small');
  if(place.ownership==='public' && place.feeStatus==='paid-tagged')
    info.textContent='Государственная организация. OSM указывает на платные услуги, но это НЕ меняет форму собственности.';
  else if(place.ownership==='public')
    info.textContent='Государственная/муниципальная организация по имеющимся признакам; условия приёма уточняются.';
  else if(place.type==='private_paid')
    info.textContent=place.feeStatus==='paid-confirmed'?'Частная организация; платный приём подтверждён ручной сверкой.':'Частная организация с пометкой о платном приёме в OSM. Цены уточняйте в клинике.';
  else
    info.textContent='Тип медицинского объекта взят из OSM; форма собственности/условия оплаты ещё не подтверждены.';
  root.append(info,document.createElement('br'));
  if(place.ownership==='public'&&!place.officiallyVerified){const warning=document.createElement('small');warning.textContent='Государственная принадлежность предполагается по названию OSM; проверить по официальному реестру.';root.append(warning,document.createElement('br'));}
  const note=document.createElement('small');note.textContent='Картографический слой не означает автоматическое включение объекта в основной МИЭД. Эксперимент Калининграда отдельно учитывает время до поликлиники; возрастные группы используются только в исследовательском подборе площадок.';root.append(note);
  const addLink=(url:string,label:string)=>{
    if(!/^https:\/\//.test(url))return;
    const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;
    root.append(document.createElement('br'),a);
  };
  if(place.sourceUrl?.startsWith('https://www.openstreetmap.org/'))addLink(place.sourceUrl,'Объект OpenStreetMap');
  if(place.verificationSourceUrl)addLink(place.verificationSourceUrl,'Сайт сети / сведения об услугах');
  if(place.website&&place.website.startsWith('https://'))addLink(place.website,'Сайт учреждения');
  return root;
}

export function useKaliningradMedicalOverlay(map:L.Map|null,regionId:string,baseline:BaselineFacility[]) {
  const [catalog,setCatalog]=useState<MedicalCatalog|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [retry,setRetry]=useState(0);
  const [officialNames,setOfficialNames]=useState<string[]>([]);
  // Show only classified facilities used in the final Kaliningrad interface.
  const [enabled,setEnabled]=useState<Set<MedicalCategory>>(()=>new Set(MEDICAL_CATEGORIES.map(c=>c.id)));
  const [showLabels,setShowLabels]=useState(false);
  const [search,setSearch]=useState('');
  useEffect(()=>{
    if(!regionId){setCatalog(null);setError(null);return;}
    const controller=new AbortController();setLoading(true);setError(null);
    fetch('/data/medical-catalogs/'+encodeURIComponent(regionId)+'.json',{signal:controller.signal,cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw new Error('Не найден включённый в ZIP медицинский каталог (HTTP '+response.status+'). Проверьте распаковку в корень проекта.');
        return response.json();
      }).then((payload:unknown)=>{
        const parsed=payload as Partial<MedicalCatalog>;
        if(parsed.regionId!==regionId||!Array.isArray(parsed.facilities))throw new Error('Некорректный JSON-каталог');
        const allowed=new Set(MEDICAL_CATEGORIES.map(c=>c.id));
        const entries=parsed.facilities.filter(f=>f && allowed.has(f.type) &&
          typeof f.name==='string' && Number.isFinite(f.lat)&&Number.isFinite(f.lon));
        setCatalog({regionId,facilities:entries,generatedAt:parsed.generatedAt,source:parsed.source,count:parsed.count,completeness:parsed.completeness,indexEffect:parsed.indexEffect});
      }).catch(e=>{if(!controller.signal.aborted){setCatalog(null);setError(e instanceof Error?e.message:String(e));}})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[regionId,retry]);

  useEffect(()=>{
    if(regionId!=='kaliningrad'){setOfficialNames([]);return;}
    const controller=new AbortController();
    fetch('/data/kaliningrad-public-organizations-2026.json',{signal:controller.signal})
      .then(r=>r.ok?r.json():null)
      .then((data:unknown)=>{
        if(controller.signal.aborted)return;
        const entries=(data as {organizations?:{name?:string}[]} | null)?.organizations;
        setOfficialNames(Array.isArray(entries)?entries.map(x=>x.name).filter((name):name is string=>typeof name==='string'):[]);
      }).catch(()=>{if(!controller.signal.aborted)setOfficialNames([]);});
    return()=>controller.abort();
  },[regionId]);
  const importedFacilities=useMemo(()=>excludeDuplicateBaseline(catalog?.facilities??[],baseline),[catalog,baseline]);
  const counts=useMemo(()=>{
    const values=Object.fromEntries(MEDICAL_CATEGORIES.map(c=>[c.id,0])) as Record<MedicalCategory,number>;
    for(const place of importedFacilities)values[place.type]++;
    return values;
  },[importedFacilities]);
  useEffect(()=>{
    if(!map||!catalog)return;
    const group=L.layerGroup().addTo(map);
    const markers:L.Marker[]=[];
    for(const item of importedFacilities){
      if(!enabled.has(item.type))continue;
      if(search && !norm([item.name,item.address??''].join(' ')).includes(norm(search)))continue;
      const marker=L.marker([item.lat,item.lon],{icon:iconFor(item.type),title:item.name,alt:item.name}).addTo(group);
      marker.bindPopup(makePopup(item));
      const tip=document.createElement('span');tip.textContent=`${categories.get(item.type)?.label}: ${item.name}`;
      marker.bindTooltip(tip,{direction:'right',offset:[16,0],opacity:0.97,className:'medsvyaz-medical-tooltip'});
      markers.push(marker);
    }
    const refreshLabels=()=>{
      const bounds=map.getBounds().pad(0.03);
      for(const marker of markers){
        if(showLabels && map.getZoom()>=12 && bounds.contains(marker.getLatLng()))marker.openTooltip();
        else marker.closeTooltip();
      }
    };
    map.on('zoomend',refreshLabels);map.on('moveend',refreshLabels);refreshLabels();
    return()=>{map.off('zoomend',refreshLabels);map.off('moveend',refreshLabels);group.remove();};
  },[map,regionId,catalog,importedFacilities,enabled,showLabels,search]);
  return {catalog,importedFacilities,counts,error,loading,enabled,setEnabled,showLabels,setShowLabels,retry:()=>setRetry(n=>n+1),officialNames,search,setSearch};
}
export type MedicalOverlayState = ReturnType<typeof useKaliningradMedicalOverlay>;

export function KaliningradMedicalControls({state,baseHospitals,regionId}:{state:MedicalOverlayState;baseHospitals:number;regionId:string}) {
  const publicCount=baseHospitals+MEDICAL_CATEGORIES.filter(c=>c.group==='public').reduce((sum,c)=>sum+state.counts[c.id],0);
  const privateCount=state.counts.private_paid;
  return <section className="medsvyaz-medical-controls" aria-label="Типы и собственность медицинских учреждений">
    <div className="medsvyaz-medical-title"><strong>{regionId==='kaliningrad'?'Медицинские учреждения Калининградской области':'Медицинские учреждения региона'}</strong>
      <span>На карте: {baseHospitals + state.importedFacilities.filter(f=>state.enabled.has(f.type)).length} точек · включая {baseHospitals} расчётных больничных площадок, {publicCount-baseHospitals} дополнительных больниц и поликлиник по источникам и {privateCount} частных платных клиник</span></div>
    <div className="medsvyaz-medical-filters" role="group" aria-label="Фильтры учреждений">
      {MEDICAL_CATEGORIES.map(item=><label key={item.id} className="medsvyaz-medical-choice">
        <input type="checkbox" checked={state.enabled.has(item.id)} onChange={e=>state.setEnabled(prev=>{
          const next=new Set(prev);if(e.target.checked)next.add(item.id);else next.delete(item.id);return next;
        })}/>
        <span className="medsvyaz-medical-key" style={{backgroundColor:item.color}} aria-hidden="true">{item.symbol}</span>
        <span>{item.label} <small>({state.counts[item.id]+(item.id==='public_hospital'?baseHospitals:0)})</small></span>
      </label>)}
    </div>
    <div className="medsvyaz-medical-search"><label>Поиск учреждения или адреса <input type="search" placeholder="Например, детская поликлиника, Гусев, Эдкар" value={state.search} onChange={e=>state.setSearch(e.target.value)}/></label>
    <small>Роддома, ФАП, амбулатории и объекты без установленного типа не выводятся. Для реальных регионов OSM подтверждает географическую отметку, но не лицензированный медицинский профиль. В синтетических регионах все дополнительные учреждения условные.</small></div>
    {state.officialNames.length>0&&<details className="medsvyaz-medical-official-list">
      <summary>Справочный список: {state.officialNames.length} наименование государственных организаций (не все филиалы; координаты здесь не заданы)</summary>
      <ul>{state.officialNames.map(name=><li key={name}>{name}</li>)}</ul>
    </details>}
    <div className="medsvyaz-medical-footer">
      <label><input type="checkbox" checked={state.showLabels} onChange={e=>state.setShowLabels(e.target.checked)}/> Подписи начиная с масштаба 12</label>
      {state.loading&&<span role="status">Загрузка медицинского каталога…</span>}
      {state.error&&<span role="status" className="medsvyaz-medical-error">{state.error} <button type="button" onClick={state.retry}>Повторить</button></span>}
      {!state.loading&&!state.error&&<span>© OpenStreetMap contributors (ODbL). Для расширения базы всех реальных регионов выполните импорт OSM на своём компьютере; отсутствующие точки нельзя считать доказательством отсутствия клиник. Медицинские профили требуют проверки.</span>}
    </div>
  </section>;
}
