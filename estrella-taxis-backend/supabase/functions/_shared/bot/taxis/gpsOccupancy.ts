import {flag,record} from '../../tracking/contracts.ts';
/** New bridge attestation is mandatory: the legacy bridge fabricated false for missing io_3. */
export function gpsOccupancy(attributes:unknown):boolean|null {
 if(!record(attributes))return null;
 const value=flag(attributes.occupied);
 if(attributes.taxiAvailability==='free'&&value===false)return false;
 if(attributes.taxiAvailability==='occupied'&&value===true)return true;
 return null;
}
