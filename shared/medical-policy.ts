import eligibility from '../data/reference/kaliningrad-index-eligibility.json';
import type {Dataset} from './schema';

/** Kaliningrad: a visible marker, a paid-service tag, or verified=true alone
 * cannot admit a clinic to the free-care calculation. Preserve the hospital
 * profile; maternity, specialist and primary-care trips need their own profile.
 */
export function isCalculationFacility(d:Dataset,f:Dataset['facilities'][number]):boolean{
 if(d.synthetic)return true;
 if(f.id==='__proposal__facility')return true; // hypothetical free public site
 if(!f.verified)return false;
 if(d.regionId!=='kaliningrad')return true;
 return eligibility.facilities.some(e=>e.id===f.id&&e.osmId===f.osmId&&e.freeCareAvailable);
}
