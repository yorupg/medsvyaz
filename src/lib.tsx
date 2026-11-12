import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {RefreshCw,ArrowUpRight,Info,TriangleAlert,Database} from 'lucide-react';
import {Link} from 'react-router-dom';
import type {Region} from '../shared/schema';
import {RELEASE} from '../shared/release';
export const format=(n:number|null|undefined,digits=1)=>n==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits}).format(n);
export const percent=(n:number|null|undefined)=>n==null?'—':format(n*100)+'%';
export const districtName=(id:string|null,ds:{id:string;name:string}[])=>ds.find(d=>d.id===id)?.name??'Вне перечня ФО';
export const statusLabels:Record<string,string>={verified:'Проверено',partial:'Частично проверено',needs_review:'Требует проверки',no_data:'Нет данных',calculation_error:'Ошибка расчёта',synthetic:'Синтетические данные',observed:'Официальные источники площадок',osm:'OSM · профиль не проверен'};
export function useApi<T>(url:string|null){
 const [result,setResult]=useState<{url:string;attempt:number;data:T|null;error:string}|null>(null);
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!url) return;
  const controller=new AbortController();
  fetch(url+(url.includes('?')?'&':'?')+'release='+RELEASE,{signal:controller.signal,cache:'no-store'})
   .then(async response=>{
    const body=await response.json();
    if(!response.ok) throw new Error(body.error??('Ошибка API '+response.status));
    if(!controller.signal.aborted) setResult({url,attempt,data:body,error:''});
   }).catch(reason=>{
    if(!controller.signal.aborted) setResult({url,attempt,data:null,error:reason.message});
   });
  return ()=>controller.abort();
 },[url,attempt]);
 const current=result?.url===url && result.attempt===attempt ? result : null;
 return {data:current?.data??null,error:current?.error??'',loading:Boolean(url&&!current),retry:()=>setAttempt(n=>n+1)};
}
const RegionContext=createContext<Region[]>([]);
export function RegionProvider({children}:{children:ReactNode}){const r=useApi<Region[]>('/api/regions');return <RegionContext.Provider value={r.data??[]}>{r.error&&<div className="global-error">Не удалось получить каталог. <button onClick={r.retry}>Повторить</button></div>}{children}</RegionContext.Provider>;}
export const useRegions=()=>useContext(RegionContext);
export function Status({value='no_data'}:{value?:string}){return <span className={`status status-${value}`}><span/>{statusLabels[value]??value}</span>;}
export function Empty({title='Подтверждённого расчёта пока нет',children,compact=false}:{title?:string;children?:ReactNode;compact?:boolean}){return <div className={`empty ${compact?'compact':''}`}><div className="empty-icon"><Database size={25}/></div><h3>{title}</h3><p>{children??'Для оценки нужны население поселений, дорожный граф и подтверждённый профиль медицинской помощи.'}</p></div>;}
export function ErrorBox({message,retry}:{message:string;retry:()=>void}){return <div className="error-box" role="alert"><TriangleAlert size={20}/><span>{message}</span><button className="btn small" onClick={retry}><RefreshCw size={15}/>Повторить</button></div>;}
export function Loading(){return <div className="loading" role="status"><span className="spinner"/>Загружаем данные…</div>;}
export function PageTitle({eyebrow,title,children,action}:{eyebrow:string;title:string;children?:ReactNode;action?:ReactNode}){return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{children&&<p>{children}</p>}</div>{action}</div>;}
export function Note({children,tone='info'}:{children:ReactNode;tone?:'info'|'warning'}){return <div className={`note ${tone}`}><Info size={18}/><div>{children}</div></div>;}
export function DemoNotice(){return <Note tone="warning"><strong>Синтетические данные.</strong> Вымышленная сеть для проверки модели. Значения не описывают российские территории и медицинские учреждения.</Note>;}
export function SectionLink({to,children}:{to:string;children:ReactNode}){return <Link className="text-link" to={to}>{children}<ArrowUpRight size={17}/></Link>;}
export function downloadJson(data:unknown,name:string){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export function downloadCsv(rows:unknown[][],name:string){const cell=(v:unknown)=>'"'+(typeof v==='number'&&Number.isFinite(v)?String(v):String(v??'').replace(/^[=+@-]/,"'$&")).replace(/"/g,'""')+'"';const text='\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
