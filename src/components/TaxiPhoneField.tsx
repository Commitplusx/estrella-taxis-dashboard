import { useId } from 'react';
import { channelCountries, channelPhone } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/channelPhone.ts';
export interface TaxiPhoneValue { country: string; national: string }
export default function TaxiPhoneField({ label, value, onChange, disabled = false, required = false, help }: {
  label: string; value: TaxiPhoneValue; onChange: (value: TaxiPhoneValue) => void; disabled?: boolean; required?: boolean; help?: string;
}) {
  const id = useId();
  const complete = channelPhone(value.country, value.national);
  return <div className="taxi-phone-field">
    <label htmlFor={id}>{label}</label>
    <div className="taxi-phone-inputs">
      <select aria-label={'País de ' + label} value={value.country} disabled={disabled} onChange={e => onChange({ ...value, country: e.target.value })}>
        {channelCountries.map(country => <option key={country.id} value={country.id}>{country.label}</option>)}
      </select>
      <input id={id} type="tel" autoComplete="tel-national" inputMode="tel" value={value.national} maxLength={24} required={required}
        disabled={disabled} onChange={e => onChange({ ...value, national: e.target.value })} aria-describedby={id + '-help'} placeholder="Número local" />
    </div>
    <small id={id + '-help'}>{complete ? `Se guardará como ${complete}. ` : ''}{help}</small>
  </div>;
}
