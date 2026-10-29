import { useState } from "react";
import { Power, Save } from "lucide-react";
import type { AdminChannel } from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";
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
  const [form, setForm] = useState({
    waba: channel?.waba ?? "",
    name: channel?.name ?? "",
    city: channel?.city ?? "",
    dispatcher: channel?.dispatcher ?? "",
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
      | "waba"
      | "name"
      | "city"
      | "dispatcher"
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
      !form.waba || !form.name || !form.city ||
      !Number.isFinite(Number(form.lat)) ||
      !Number.isFinite(Number(form.lng)) || Number(form.radius) <= 0
    ) {
      setError("Completa el número, nombre, ciudad y cobertura de la base.");
      return;
    }
    setError("");
    onSave(form.waba, expected, {
      name: form.name,
      city: form.city,
      dispatcher: form.dispatcher || null,
      centerLat: Number(form.lat),
      centerLng: Number(form.lng),
      radiusKm: Number(form.radius),
      pricingMode: form.mode,
      baseCents: money(form.base),
      perKmCents: money(form.km),
      enabled: form.enabled,
    });
  };
  return (
    <form className="taxi-config" onSubmit={save}>
      <div>
        <h2>WhatsApp de la base</h2>
        <p>Guarda el canal y prepara sus zonas. Activarlo es un paso aparte.</p>
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
        <label>
          Número de WhatsApp<input
            type="tel"
            value={form.waba}
            onChange={(e) => change("waba", e.target.value)}
            readOnly={Boolean(channel)}
            placeholder="+52…"
            required
          />
          <small>
            {channel
              ? "El número identifica este canal. Para otro número, crea un canal nuevo."
              : "Incluye el código de país. El número debe conectarse también con el proveedor."}
          </small>
        </label>
        <label>
          Ciudad<input
            value={form.city}
            onChange={(e) => change("city", e.target.value)}
            maxLength={200}
            required
          />
        </label>
        <label>
          Teléfono de atención de la base<input
            type="tel"
            value={form.dispatcher}
            onChange={(e) => change("dispatcher", e.target.value)}
            placeholder="+52…"
          />
          <small>
            Aquí llegan las solicitudes que requieren ayuda de una persona.
          </small>
        </label>
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
            checked={form.enabled}
            disabled={!runtimeReady && !form.enabled}
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
