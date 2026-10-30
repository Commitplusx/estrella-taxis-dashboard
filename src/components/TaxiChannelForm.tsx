import { useState } from "react";
import { Power, Save } from "lucide-react";
import type { AdminChannel } from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";
import { channelPhone, splitChannelPhone } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/channelPhone.ts';
import { customerPhone } from '../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/customerAccess.ts';
import TaxiPhoneField, { type TaxiPhoneValue } from './TaxiPhoneField';
interface Props {
  channel: AdminChannel | null;
  tenantId: string;
  busy: boolean;
  canEdit: boolean;
  runtimeReady: boolean;
  onSave: (
    waba: string,
    revision: number,
    payload: Record<string, unknown>,
  ) => void;
}
export default function TaxiChannelForm(
  { channel, busy, canEdit, runtimeReady, onSave }: Props,
) {
  const [number, setNumber] = useState<TaxiPhoneValue>(() => splitChannelPhone(channel?.waba ?? ''));
  const [dispatcher, setDispatcher] = useState<TaxiPhoneValue>(() => splitChannelPhone(channel?.dispatcher ?? ''));
  const targetNumber = channelPhone(number.country, number.national);
  const dispatcherNumber = dispatcher.national.trim() ? channelPhone(dispatcher.country, dispatcher.national) : null;
  const dispatcherMatchesBot = Boolean(dispatcherNumber && targetNumber && customerPhone(dispatcherNumber) === customerPhone(targetNumber));
  const renaming = Boolean(channel && targetNumber && targetNumber !== channel.waba);
  const [form, setForm] = useState({
    name: channel?.name ?? "",
    city: channel?.city ?? "",
    lat: String(channel?.centerLat ?? 16.25),
    lng: String(channel?.centerLng ?? -92.13),
    radius: String(channel?.radiusKm ?? 20),
    mode: channel?.pricingMode ?? "h3_zone_max",
    base: channel?.baseCents === null || !channel
      ? ""
      : String(channel.baseCents / 100),
    km: channel?.perKmCents === null || !channel
      ? ""
      : String(channel.perKmCents / 100),
    enabled: channel?.enabled ?? false,
  });
  const [expected] = useState(channel?.revision ?? 0),
    [error, setError] = useState("");
  const change = (
    key:
      | "name"
      | "city"
      | "lat"
      | "lng"
      | "radius"
      | "base"
      | "km",
    value: string,
  ) => setForm((f) => ({ ...f, [key]: value }));
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const money = (v: string) =>
      v.trim() === "" ? null : Math.round(Number(v) * 100);
    if (
      !targetNumber || !form.name || !form.city ||
      !Number.isFinite(Number(form.lat)) ||
      !Number.isFinite(Number(form.lng)) || Number(form.radius) <= 0
    ) {
      setError("Completa el número, nombre, ciudad y cobertura de la base.");
      return;
    }
    if (dispatcher.national.trim() && !dispatcherNumber) { setError('Revisa el país y el teléfono de atención de la base.'); return; }
    if (dispatcherMatchesBot) { setError('El teléfono de atención debe ser distinto al WhatsApp del bot para que una persona reciba las alertas.'); return; }
    if (form.mode === 'road_distance' && (money(form.base) === null || !Number.isFinite(money(form.base)) || Number(money(form.base)) < 0 ||
      money(form.km) === null || !Number.isFinite(money(form.km)) || Number(money(form.km)) <= 0)) {
      setError('Para cobrar por carretera escribe la tarifa base y un precio por kilómetro mayor que cero. Si cobras por zonas, elige Por zonas H3.'); return;
    }
    if (renaming && channel?.enabled) { setError('Primero guarda el canal en pausa antes de corregir su número.'); return; }
    setError("");
    onSave(targetNumber, expected, {
      name: form.name,
      city: form.city,
      dispatcher: dispatcherNumber,
      centerLat: Number(form.lat),
      centerLng: Number(form.lng),
      radiusKm: Number(form.radius),
      pricingMode: form.mode,
      baseCents: money(form.base),
      perKmCents: money(form.km),
      enabled: renaming ? false : form.enabled,
    });
  };
  return (
    <form className="taxi-config" onSubmit={save}>
      <div>
        <h2>WhatsApp de la base</h2>
        <p>Configura el número que atenderá a tus clientes. Las zonas y tarifas pertenecen a la base.</p>
      </div>
      <fieldset disabled={busy || !canEdit} className="taxi-fields">
        <label>
          Nombre de la base<input
            value={form.name}
            onChange={(e) => change("name", e.target.value)}
            maxLength={120}
            required
          />
        </label>
        <TaxiPhoneField label="Número de WhatsApp" value={number} onChange={setNumber} required disabled={channel?.enabled}
          help={channel?.enabled ? 'Guarda el canal en pausa para editar el número.' : 'Debe coincidir exactamente con YCloud. Si allí aparece +521, conserva el 1 antes de los diez dígitos.'} />
        <label>
          Ciudad<input
            value={form.city}
            onChange={(e) => change("city", e.target.value)}
            maxLength={200}
            required
          />
        </label>
        <TaxiPhoneField label="WhatsApp para avisos de atención humana (opcional)" value={dispatcher} onChange={setDispatcher}
          help={dispatcherMatchesBot ? 'Usa el WhatsApp de una persona o déjalo vacío para atender desde Conversaciones.' : 'Las solicitudes quedan en Conversaciones. Agrega este número si también quieres alertas por WhatsApp. Las ofertas de viaje llegan al chofer vinculado a la unidad.'} />
        <label>
          Latitud del centro<input
            type="number"
            step="any"
            min="-90"
            max="90"
            value={form.lat}
            onChange={(e) => change("lat", e.target.value)}
            required
          />
        </label>
        <label>
          Longitud del centro<input
            type="number"
            step="any"
            min="-180"
            max="180"
            value={form.lng}
            onChange={(e) => change("lng", e.target.value)}
            required
          />
        </label>
        <label>
          Radio de servicio, en km<input
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={form.radius}
            onChange={(e) => change("radius", e.target.value)}
            required
          />
        </label>
        <label>
          Cómo se calcula el precio<select
            value={form.mode}
            onChange={(e) =>
              setForm({
                ...form,
                mode: e.target.value === "road_distance"
                  ? "road_distance"
                  : "h3_zone_max",
              })}
          >
            <option value="h3_zone_max">Por zonas H3</option>
            <option value="road_distance">
              Base + distancia por carretera
            </option>
          </select>
        </label>
        {form.mode === "road_distance" && (
          <>
            <label>
              Tarifa base, MXN<input
                type="number"
                min="0"
                step="0.01"
                value={form.base}
                onChange={(e) => change("base", e.target.value)}
              />
            </label>
            <label>
              Precio por kilómetro, MXN<input
                type="number"
                min="0"
                step="0.01"
                value={form.km}
                onChange={(e) => change("km", e.target.value)}
              />
            </label>
          </>
        )}
        <label className="taxi-enable">
          <input
            type="checkbox"
            checked={!renaming && form.enabled}
            disabled={renaming || !runtimeReady && !form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          <span>
            <strong>Permitir que el bot atienda este canal</strong>
            <small>
              {runtimeReady
                ? "El servidor también comprobará las zonas, conductores y permisos del plan."
                : "WhatsApp aún no está listo en el servidor. Puedes guardar el canal apagado."}
            </small>
          </span>
          <Power size={20} />
        </label>
      </fieldset>
      {renaming && <p className="taxi-notice">Al guardar se corregirá el número y se conservarán sus zonas y tarifas. El canal quedará en pausa. Si ya tiene conversaciones o viajes, usa un canal nuevo para conservar su historial.</p>}
      {error && <p className="taxi-error" role="alert">{error}</p>}
      <div className="taxi-form-footer">
        <p>Los datos se guardan en el servidor y quedan ligados a esta base.</p>
        <button
          className="taxi-primary"
          disabled={busy || !canEdit}
          type="submit"
        >
          <Save size={18} />
          {busy ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </form>
  );
}
