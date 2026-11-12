import {useApi,format,Note} from '../lib';
type Audit={regionId:string;facilityCount:number;officiallySelected:number;osmOnly:number;withAddress:number;medicalProfileConfirmed:boolean;meaning:string};
export function FacilityDataQuality({regionId}:{regionId:string}){
 const {data}=useApi<Record<string,Audit>>('/downloads/medical-facility-coverage.json');
 const a=data?.[regionId];if(!a)return null;
 return <section className="panel facility-evidence-panel"><h3>Достоверность медицинских данных</h3>
   <div className="facility-evidence-grid"><div><span>Больничных площадок</span><strong>{format(a.facilityCount,0)}</strong></div><div><span>Подбор по официальным источникам</span><strong>{format(a.officiallySelected,0)}</strong></div><div><span>Только OSM</span><strong>{format(a.osmOnly,0)}</strong></div><div><span>С адресом в исходном наборе</span><strong>{format(a.withAddress,0)}</strong></div></div>
   {a.medicalProfileConfirmed?<Note>Для пилота больничные площадки отобраны по официальным подтверждающим источникам. Клиническая маршрутизация и работа конкретного отделения не проверены.</Note>:<Note tone="warning">Для этого региона используются картографически отмеченные больницы OSM. Наличие объекта на карте не подтверждает его медицинский профиль, участие в ОМС и фактический приём пациентов. Рейтинг регионов требует сверки с реестрами ТФОМС/ФРМО.</Note>}
   <p className="fine-print">Проведён аудит происхождения всех площадок. <a href="/downloads/medical-facilities-needing-verification.csv" download>Скачать список для сверки с официальными реестрами (CSV)</a>.</p>
 </section>;
}
