import type {Dataset} from './schema';

export type MedicalCategory = 'public_hospital'|'public_polyclinic'|'private_paid'|'public_ambulatory'|'public_maternity'|'needs_review';
export type MedicalType = 'hospital'|'polyclinic'|'clinic'|'ambulatory'|'maternity'|'unknown';
export type MedicalPlace = {
 id:string;name:string;type:MedicalCategory;medicalType:MedicalType;lat:number;lon:number;
 address?:string;ownership?:'public'|'private'|'unknown';ownershipConfirmed?:boolean;
 feeStatus?:'paid-tagged'|'paid-confirmed'|'free-tagged'|'free-confirmed'|'unknown';
 omsAvailable?:boolean|null;sourceUrl?:string;officiallyVerified?:boolean;classificationReason?:string;
 verificationSourceUrl?:string|null;reviewComment?:string;website?:string|null;
 evidenceStatus?:'registry-matched'|'provider-confirmed'|'osm-only';evidenceScope?:string;
 existenceStatus?:string;categoryConfidence?:string;baselineFacilityId?:string|null;indexEligible?:boolean;
};
export type MedicalCatalog = {
 regionId:string;schemaVersion?:number;generatedAt?:string;source?:string;count?:number;
 completeness?:string;indexEffect?:string;facilities:MedicalPlace[];
};
export const MEDICAL_CATEGORIES:{id:MedicalCategory;label:string;symbol:string;color:string}[] = [
 {id:'public_hospital',label:'Государственные больницы',symbol:'+',color:'#c3384c'},
 {id:'public_polyclinic',label:'Поликлиники',symbol:'П',color:'#2474bf'},
 {id:'private_paid',label:'Частные платные клиники',symbol:'₽',color:'#c77914'},
 {id:'public_ambulatory',label:'Амбулатории и ФАП',symbol:'А',color:'#17886b'},
 {id:'public_maternity',label:'Роддома и перинатальные центры',symbol:'Р',color:'#9450c1'},
 {id:'needs_review',label:'Вид учреждения не определён',symbol:'?',color:'#87929a'},
];
const norm=(s:string)=>s.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,'');
export function matchesMedicalSearch(place:MedicalPlace,query:string){
 const text=norm([place.name,place.address??''].join(' '));
 // Registry addresses contain «ул.», «д.» and postcodes between search words.
 return (query.match(/[\p{L}\p{N}]+/gu)??[]).every(word=>text.includes(norm(word)));
}

/** Exact OSM identity / reviewed facility ID; never hide unrelated nearby clinics. */
export function mergeMedicalFacilities(places:MedicalPlace[],baseline:Dataset['facilities']):MedicalPlace[]{
 const merged=places.map(p=>({...p}));
 for(const f of baseline){
  if(f.id==='__proposal__facility'||f.lat===undefined||f.lon===undefined)continue;
  const osmId=f.osmId?'osm-'+f.osmId.replace('/','-'):undefined;
  const existing=merged.find(p=>p.baselineFacilityId===f.id||p.id===osmId);
  if(existing){
   // Route endpoints and hospital markers must refer to the SAME saved point.
   existing.lat=f.lat;existing.lon=f.lon;existing.baselineFacilityId=f.id;
   if(!existing.address)existing.address=f.officialAddress;
  }else{
   merged.push({id:osmId??f.id,name:f.name,type:'public_hospital',medicalType:'hospital',lat:f.lat,lon:f.lon,
    address:f.officialAddress,sourceUrl:f.sourceUrl,baselineFacilityId:f.id,indexEligible:true,
    ownership:'public',omsAvailable:true,officiallyVerified:f.verified,evidenceStatus:'registry-matched'});
  }
 }
 return merged;
}
