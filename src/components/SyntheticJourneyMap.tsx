import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import type {FeatureCollection,Geometry} from 'geojson';
import type {Dataset,PointResult} from '../../shared/schema';
import {populationRadius,pointMapColor,mapDistribution} from '../../shared/map-metrics';
import {MapDistributionPanel} from './MapDistribution';
import {format,useApi} from '../lib';
import type {MedicalCatalog} from './KaliningradMedicalOverlay';
import './KaliningradMedicalOverlay.css';
import 'leaflet/dist/leaflet.css';

type ShapeProps={regionId:string;name:string};

/** Geographic context and *hypothetical* links; straight segments are not OSM road geometry. */
export function SyntheticJourneyMap({dataset,pointId,route,edgeId,onPoint,results,threshold,timeScale,scenario,multiplier}:{dataset:Dataset;results:PointResult[];threshold:number;timeScale:number;scenario:string;multiplier:number;pointId:string;route:string[];edgeId:string;onPoint:(id:string)=>void}){
 const container=useRef<HTMLDivElement>(null);
 const map=useRef<L.Map|null>(null);
 const boundary=useRef<L.GeoJSON|null>(null);
 const layers=useRef<L.LayerGroup|null>(null);
 const onChoose=useRef(onPoint);onChoose.current=onPoint;
 const [tilesFailed,setTilesFailed]=useState(false);
 const longitude=(lon:number)=>lon<0?lon+360:lon;
 const geometry=useApi<FeatureCollection<Geometry,ShapeProps>>('/api/regions/'+encodeURIComponent(dataset.regionId)+'/geometry');
 const medical=useApi<MedicalCatalog>('/data/medical-catalogs/'+encodeURIComponent(dataset.regionId)+'.json');
 useEffect(()=>{
  if(!container.current)return;
  const m=L.map(container.current,{scrollWheelZoom:false,minZoom:3,maxZoom:15,preferCanvas:true});
  map.current=m;
  m.attributionControl.setPrefix('');
  m.setView([58,55],5);
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(m);
  tiles.on('tileerror',()=>setTilesFailed(true));
  const resize=new ResizeObserver(()=>m.invalidateSize());resize.observe(container.current);
  return()=>{resize.disconnect(); layers.current?.remove(); boundary.current?.remove(); m.remove(); map.current=null;};
 },[]);
 useEffect(()=>{
  const m=map.current;
  if(!m||!geometry.data?.features.length)return;
  boundary.current?.remove();
  const shape=structuredClone(geometry.data);
  const shift=(coords:unknown):unknown=>{
   if(Array.isArray(coords)&&typeof coords[0]==='number')return [(coords[0] as number)<0?(coords[0] as number)+360:coords[0],coords[1]];
   return (coords as unknown[]).map(shift);
  };
  shape.features.forEach(f=>{if('coordinates' in f.geometry)f.geometry.coordinates=shift(f.geometry.coordinates) as never;});
  const layer=L.geoJSON(shape,{style:{color:'#138c8a',weight:2,fillColor:'#96c4c6',fillOpacity:.12}}).addTo(m);
  boundary.current=layer;
  const b=layer.getBounds();if(b.isValid())m.fitBounds(b,{padding:[18,18],maxZoom:9});
  return()=>{layer.remove();};
 },[geometry.data]);
 useEffect(()=>{
  const m=map.current;if(!m)return;
  layers.current?.remove();
  const group=L.layerGroup().addTo(m);layers.current=group;
  const nodes=new Map(dataset.nodes.map(n=>[n.id,n])),byId=new Map(results.map(p=>[p.id,p])),maxPopulation=Math.max(1,...results.map(p=>p.population??0));
  const inRoute=new Set(route);
  for(const e of dataset.edges){
   if(e.kind==='access')continue;
   const a=nodes.get(e.from),b=nodes.get(e.to);
   if(!a||!b)continue;
   const highlight=inRoute.has(e.id),selected=e.id===edgeId;
   const line=L.polyline([[a.y,longitude(a.x)],[b.y,longitude(b.x)]],{
    color:e.id==='__proposal__road'?'#bf4e88':highlight?'#0d857f':selected?'#c78b31':'#648a90',weight:highlight?5:selected?3.5:1.4,
    opacity:highlight?1:(selected?0.9:0.42),dashArray:e.id==='__proposal__road'?'8 5':highlight?undefined:'5 5',interactive:highlight||selected
   }).addTo(group);
   if(highlight||selected)line.bindTooltip((e.name??'Условная связь')+(selected&&scenario==='closure'?' · закрыто в сценарии':' · '+format(e.minutes*timeScale/(selected&&scenario==='improvement'?multiplier:1))+' мин'));
  }
  for(const s of dataset.settlements){
   if(s.lat===undefined||s.lon===undefined)continue;
   const selected=s.id===pointId;
   const marker=L.circleMarker([s.lat,longitude(s.lon)],{radius:populationRadius(s.population,maxPopulation,false),color:selected?'#fff':'#b9dddd',weight:selected?2.5:1,fillColor:pointMapColor(byId.get(s.id)??{score:null}),fillOpacity:1}).addTo(group);
   const tip=document.createElement('span');tip.textContent=s.name+' · '+format(s.population,0)+' жителей · '+format(byId.get(s.id)?.minutes)+' мин · '+format(byId.get(s.id)?.score==null?null:byId.get(s.id)!.score!*100,1)+' балла';marker.bindTooltip(tip);
   marker.on('click',()=>onChoose.current(s.id));
  }
  for(const f of dataset.facilities){
   const n=nodes.get(f.nodeId);if(!n)continue;
   L.marker([n.y,longitude(n.x)],{icon:L.divIcon({className:'hospital-map-icon',html:'<span>+</span>',iconSize:[26,26],iconAnchor:[13,13]}),title:f.name}).addTo(group).bindTooltip(f.name+' · условная больница');
  }
  // Additional medical categories are explicitly SYNTHETIC and do not claim
  // real facilities on the map. The per-region seed is reproducible.
  const styles:{[key:string]:[string,string]}={public_adult_polyclinic:['П','#2474bf'],public_children_polyclinic:['Д','#9450c1'],private_paid:['₽','#2b9b56']};
  for(const f of medical.data?.facilities??[]){
   const style=styles[f.type];if(!style)continue;
   L.marker([f.lat,longitude(f.lon)],{icon:L.divIcon({className:'medsvyaz-medical-marker',html:`<span style=\"background:${style[1]}\">${style[0]}</span>`,iconSize:[29,29],iconAnchor:[14,14]}),title:f.name}).addTo(group).bindTooltip(f.name+' · условное учреждение, не реальная медорганизация');
  }
  return()=>{group.remove();};
 },[dataset,pointId,route.join('|'),edgeId,results,threshold,timeScale,scenario,multiplier,medical.data]);
 return <div className="journey-map-shell"><div className="journey-geo-map" ref={container} aria-label={'Географическая карта территории '+dataset.regionId+' с модельными пунктами и выбранной поездкой'}/><div className="journey-map-legend"><span>Цвет — баллы доступности · размер и вес поселений одинаковые · выбранное поселение — белая обводка</span><span><b className="map-route-key"/>Модельный путь</span><span><b className="hospital-key">+</b>Больница · <b>П/Д/₽</b> — модельные поликлиники и частные клиники</span></div>{tilesFailed&&<p className="map-offline-note">Подложка OSM недоступна. Контур и расчётные точки остаются на карте.</p>}<p className="journey-map-note">Поселения показаны по географическим координатам. Пунктир — связи синтетической дорожной модели.</p><MapDistributionPanel distribution={mapDistribution(results)} threshold={threshold}/></div>;
}
