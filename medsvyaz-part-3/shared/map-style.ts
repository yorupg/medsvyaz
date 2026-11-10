import {indexColor,type Region} from './schema';

export const NO_DATA_TERRITORIES=new Set(['donetsk','luhansk','zaporizhzhia','kherson']);

/** A selection or pointer must not disguise data provenance or the index colour. */
export function regionStyle(region:Region|undefined,id:string,selected=false,hovered=false){
 const unavailable=NO_DATA_TERRITORIES.has(id)||region?.indexValue==null;
 const observed=Boolean(region?.datasetId&&!region.synthetic&&!unavailable);
 return {
  color:unavailable?'#aab3b9':selected||hovered?'#174c59':observed?'#244c58':'#71858b',
  weight:unavailable?.55:observed?(selected||hovered?3:2.2):(selected||hovered?1.5:.7),
  opacity:unavailable?.65:1,
  fillColor:indexColor(unavailable?null:region!.indexValue!),
  fillOpacity:unavailable?.72:.9,
  dashArray:unavailable?'2 5':region?.synthetic?'4 3':undefined,
 };
}

export function regionTooltip(region:Region|undefined,name:string){
 if(!region||NO_DATA_TERRITORIES.has(region.id)||region.indexValue==null)return name+' · Нет данных';
 return name+' · '+region.indexValue.toFixed(1)+' / 100 · '+(region.synthetic?'Синтетическая модель':'Реальные данные');
}
