/** Plausible scenario models: observed census samples where available; hypothetical roads and centres. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import regions from '../data/regions.json';
import {calculate,validateDataset} from '../shared/engine';
import type {Dataset} from '../shared/schema';
const samples=JSON.parse(readFileSync(existsSync('data/processed/audited-synthetic-samples.json')?'data/processed/audited-synthetic-samples.json':'data/raw/synthetic-samples.json','utf8')) as Record<string,{observedSettlements:boolean;sourceSettlementCount:number;observationUnit?:string;settlements:Dataset['settlements']}>;
const km=(a:{lon:number;lat:number},b:{lon:number;lat:number})=>{const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad;return 12742.0176*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2)));};
const med=(a:number[])=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
const detours:number[]=[],speeds:number[]=[],urbanTimes:number[]=[];
for(const id of ['kaliningrad','ivanovo','pskov']){
 const d=JSON.parse(readFileSync('data/processed/'+id+'-pilot.json','utf8')) as Dataset;
 const result=calculate({...d,edges:d.edges.map(({geometry,...e})=>e)}),edges=new Map(d.edges.map(e=>[e.id,e])),fs=new Map(d.facilities.map(f=>[f.id,f])),ss=new Map(d.settlements.map(s=>[s.id,s]));
 for(const p of result.points){if(p.population!>=10000&&p.minutes!==null&&p.minutes>0&&p.minutes<60)urbanTimes.push(p.minutes);if(p.status!=='reachable'||!p.minutes||!p.facilityId)continue;const s=ss.get(p.id)!,f=fs.get(p.facilityId)!;const direct=km(s as {lon:number;lat:number},f as {lon:number;lat:number});if(direct<3)continue;const length=p.path.reduce((sum,id)=>sum+(edges.get(id)?.lengthKm??0),0);const detour=length/direct;if(detour>=1&&detour<5){detours.push(detour);speeds.push(length/p.minutes*60);}}
}
const calibration={pilotRegions:['kaliningrad','ivanovo','pskov'],routeSampleSize:detours.length,medianDetour:med(detours),medianEffectiveSpeedKmh:med(speeds),medianLargeSettlementMinutes:med(urbanTimes)};
const expandedIds=new Set(Object.keys(JSON.parse(readFileSync('data/raw/expanded/selection.json','utf8'))));
const mountain=new Set(['dagestan','altai-republic','tuva','karachay-cherkessia','ingushetia','chechnya']);
const remote=new Set(['sakha','chukotka','kamchatka','magadan','nenets','yamalo-nenets','khanty-mansi','komi','khabarovsk','krasnoyarsk']);
const urban=new Set(['moscow','saint-petersburg','sevastopol']);
const output:Record<string,Dataset>={};
for(const r of regions.filter(r=>samples[r.id]&&!expandedIds.has(r.id)&&!['donetsk','luhansk','kherson','zaporizhzhia'].includes(r.id))){
 const sample=samples[r.id],seed=createHash('sha256').update('medsvyaz-synthetic-v4:'+r.id).digest().readUInt32LE();let state=seed;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const settlements=sample.settlements.filter(s=>s.population!==null&&s.population>=10).map(s=>({...s,nodeId:s.id}));
 const terrain=urban.has(r.id)?{id:'urban',detour:1.05,speed:.6}:mountain.has(r.id)?{id:'mountain',detour:1.35,speed:.65}:remote.has(r.id)?{id:'remote',detour:1.2,speed:.72}:{id:'regional',detour:1,speed:1};
 const nodes=settlements.map(s=>({id:s.id,x:s.lon!,y:s.lat!})),edges:Dataset['edges']=[],links=new Set<string>();
 const groupOf=(s:Dataset['settlements'][number])=>{
  if(r.id==='sakhalin')return s.lon!<144?'sakhalin':s.lon!>152?'paramushir':s.lat!>44.7?'iturup':s.lon!<146.1?'kunashir':'shikotan';
  if(r.id==='kamchatka')return s.lon!>163.8?'commander-and-eastern':s.lat!<=57?'southern-road-area':s.municipality;
  if(r.id==='chukotka')return s.municipality;
  if(r.id==='sakha'&&s.lat!>66)return s.municipality;
  return 'main';
 };
 const groups=new Map<string,number[]>();
 for(let i=0;i<settlements.length;i++){const key=groupOf(settlements[i]);groups.set(key,[...(groups.get(key)??[]),i]);}
 const add=(a:number,b:number)=>{if(a===b||groupOf(settlements[a])!==groupOf(settlements[b]))return;const key=[a,b].sort((a,b)=>a-b).join(':');if(links.has(key))return;links.add(key);const direct=km(settlements[a] as {lon:number;lat:number},settlements[b] as {lon:number;lat:number});const length=Math.max(.05,direct*calibration.medianDetour*terrain.detour*(.95+random()*.1));const speed=direct<5?22:Math.min(65,Math.max(18,calibration.medianEffectiveSpeedKmh*terrain.speed*(.85+random()*.3)));edges.push({id:'link-'+key.replace(':','-'),from:nodes[a].id,to:nodes[b].id,minutes:length/speed*60,directed:false,allowed:true,kind:'road',name:settlements[a].name+' ↔ '+settlements[b].name,lengthKm:length,speedSource:'Synthetic distance × empirical road detour × regional terrain assumption; calibrated speed adjusted by stated terrain profile'});};
 const centreIndices:number[]=[];
 for(const members of groups.values()){
  // Separate island/remote groups have no invented inter-island car road.
  const connected=new Set([members[0]]);
  while(connected.size<members.length){let best=[0,0,Infinity];for(const a of connected)for(const b of members)if(!connected.has(b)){const dist=km(settlements[a] as {lon:number;lat:number},settlements[b] as {lon:number;lat:number});if(dist<best[2])best=[a,b,dist];}add(best[0],best[1]);connected.add(best[1]);}
  for(const a of members)for(const b of members.filter(b=>b!==a).sort((b,c)=>km(settlements[a] as {lon:number;lat:number},settlements[b] as {lon:number;lat:number})-km(settlements[a] as {lon:number;lat:number},settlements[c] as {lon:number;lat:number})).slice(0,2))add(a,b);
  const large=members.filter(i=>settlements[i].population!>=20000);
  const count=Math.min(members.length,12,Math.max(members.length>1?2:1,Math.ceil(members.length/12),large.length));
  const centres=members.slice(0,Math.min(count,large.length||1));
  while(centres.length<count){const available=members.filter(i=>!centres.includes(i));const chosen=available.sort((a,b)=>{
   const merit=(i:number)=>Math.sqrt(settlements[i].population!)*Math.min(...centres.map(j=>km(settlements[i] as {lon:number;lat:number},settlements[j] as {lon:number;lat:number})));
   return merit(b)-merit(a);
  })[0];centres.push(chosen);}
  centreIndices.push(...centres);
 }
 const facilities:Dataset['facilities']=centreIndices.map((idx,i)=>{const s=settlements[idx];return {id:'model-centre-'+i,name:'Условный центр '+(i+1)+' · '+s.name,nodeId:'model-hospital-'+i,profile:'selected-public-hospital',periods:['day'],verified:false,lat:s.lat,lon:s.lon,provenance:'Hypothetical centre at an actual sampled locality; not an observed healthcare facility'};});
 for(const [i,f] of facilities.entries()){
  const s=settlements[centreIndices[i]];nodes.push({id:f.nodeId,x:s.lon!,y:s.lat!});
  const minutes=Math.min(35,Math.max(5,4+3.4*Math.log10(Math.max(100,s.population!)/100)))*(.9+random()*.2);
  edges.push({id:'centre-access-'+i,from:s.id,to:f.nodeId,minutes,directed:false,allowed:true,kind:'access',name:'Условный городской подъезд к центру '+(i+1),lengthKm:minutes*22/60,speedSource:'Synthetic intra-settlement approach at 22 km/h; population-scaled 5–35 minutes, not a surveyed entrance'});
 }
 const d:Dataset={id:'synthetic-'+r.id,version:'synthetic-v4-2026-11-10-pop10',title:r.name+' · сценарная модель',regionId:r.id,synthetic:true,date:'2026-11-09',profile:'selected-public-hospital',profileLabel:'Поездка к условным медицинским центрам',mode:'car',trip:'to-facility',sourceIds:['synthetic-regional-v4',...(sample.observedSettlements?['tochno-allsettlements-2021']:[]),...(settlements.some(s=>s.provenance.includes('geonames.org'))?['geonames-ru-coordinate-audit']:[])],license:sample.observedSettlements?'Observed census inputs: CC BY (Tochno/Rosstat); synthetic connections: CC0':'CC0 synthetic points and connections; historical outlines ODbL',expectedPopulation:settlements.reduce((sum,s)=>sum+s.population!,0),coverageLabel:sample.observedSettlements?`${settlements.length} реальных поселений в выборке; дороги и центры условные`:`${settlements.length} условных поселений; переписных данных для модели нет`,assumptions:[sample.observedSettlements?'Названия, координаты и численность выбранных поселений взяты из ВПН-2021. Это пространственная выборка, а не все поселения и не население региона.':'Координаты сгенерированы внутри исторического контура; веса взяты из распределения численности поселений Калининградского пилота. Это не сведения о населении этой территории.','Внутригородской подъезд к условному центру добавлен отдельно: 5–35 минут в зависимости от населения. Время условное; нулевое время для всего города не используется.','Дороги и медицинские центры условные. Положение центра в городе не подтверждает существование там больницы.','Сеть связывает соседние точки внутри географических групп. Между Сахалином и Курильскими островами условные автомобильные дороги не добавляются; удалённые районы Чукотки и Камчатки моделируются отдельно.','Длина условного пути равна геодезическому расстоянию с коэффициентом извилистости; коэффициент и эффективная скорость откалиброваны по маршрутам трёх реальных пилотов.','Паромы, море, горные перевалы, сезонные разрывы и фактические дорожные обходы не восстановлены. Для протяжённых регионов перенос калибровки особенно неопределён.','Выборка включает 12 крупнейших точек источника и пространственно разнесённые малые поселения. Доли и индекс относятся только к этой выборке.','Региональный профиль: '+terrain.id+'; коэффициент извилистости ×'+terrain.detour+', эффективная скорость ×'+terrain.speed+'. Это региональное допущение, а не измерение.',...(sample.observationUnit?[sample.observationUnit+'; городская часть Москвы и Санкт-Петербурга получает вес остатка переписного итога после вычитания подчинённых городов и поселков. Пересекающиеся итоги не суммируются.']:[]),'Синтетическая модель служит исследованию сценариев и не является оценкой реального региона или основанием для рейтинга. В реальный общероссийский индекс не включается.'],metadata:{seed,generator:'scripts/build_synthetic.ts',generatorVersion:'synthetic-regional-v4',observedSettlements:sample.observedSettlements,sourceSettlementCount:sample.sourceSettlementCount,calibration,terrainProfile:terrain,observationUnit:sample.observationUnit??'Census settlements',geographicGroups:groups.size,centreRule:'Large sampled settlements plus spatial coverage; 1–12 hypothetical centres per geographic group',connectivityRule:'Within-group MST + two nearest neighbours; separate islands and remote geographic groups',usage:'Scenario illustration; geography-aware assumptions, not validated regional inference'},nodes,edges,settlements,facilities};output[r.id]=validateDataset(d);
}
writeFileSync('data/processed/synthetic-regions.json',JSON.stringify(output)+'\n');writeFileSync('data/derived/synthetic-calibration.json',JSON.stringify(calibration,null,2)+'\n');console.log('Generated',Object.keys(output).length,'models; calibration:',calibration);
