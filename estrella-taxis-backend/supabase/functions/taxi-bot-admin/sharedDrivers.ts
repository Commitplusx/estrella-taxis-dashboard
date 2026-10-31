import type { FleetApi, FleetIdentity } from "../_shared/tracking/auth.ts";
import type { TrackingStore } from "../_shared/tracking/store.ts";
import type { BaseContact } from "../_shared/bot/taxis/contactAdmin.ts";
import {
  positiveId,
  record,
  TrackingError,
} from "../_shared/tracking/contracts.ts";
/** A shared driver keeps the same account and ownership; only exact authorized GPS grants are reconciled. */
export async function syncDriverUnits(
  actor: number,
  person: BaseContact,
  admin: FleetIdentity,
  fleet: FleetApi,
  store: TrackingStore,
  signal: AbortSignal,
): Promise<void> {
  const allowed = () =>
    store.rpc("taxi_owner_driver_link_allowed", {
      p_user: actor,
      p_contact: person.id,
    });
  if (!person.accountUserId || !admin.admin || await allowed() !== true) {
    throw new TrackingError(
      403,
      "driver_access_required",
      "La base debe completar el acceso de esta persona antes de vincularla.",
    );
  }
  const user = await fleet.get(
    "/users/" + person.accountUserId,
    admin.cookie,
    signal,
  );
  if (
    !record(user) || user.id !== person.accountUserId ||
    user.administrator !== false || user.disabled !== false ||
    user.readonly !== true
  ) {
    throw new TrackingError(
      409,
      "driver_access_disabled",
      "El acceso de esta persona está deshabilitado o requiere revisión de la base.",
    );
  }
  const ids = await store.rpc("taxi_person_devices", {
    p_contact: person.id,
    p_primary: person.deviceId,
  });
  if (
    !Array.isArray(ids) || ids.length > 21 || !ids.every(positiveId) ||
    !ids.length
  ) {
    throw new TrackingError(
      502,
      "invalid_devices",
      "No pudimos comprobar sus unidades autorizadas.",
    );
  }
  const load = async () => {
    const raw = await fleet.get(
      "/devices?userId=" + person.accountUserId,
      admin.cookie,
      signal,
    );
    if (
      !Array.isArray(raw) || raw.length > 500 ||
      !raw.every((d) => record(d) && positiveId(d.id))
    ) {
      throw new TrackingError(
        502,
        "invalid_devices",
        "No pudimos comprobar los taxis de la cuenta.",
      );
    }
    return raw.filter(record).map((d) => Number(d.id));
  };
  const assigned = await load();
  // Do not broaden or erase an unrelated existing grant. The base must review inconsistent accounts.
  if (assigned.some((id) => !ids.includes(id))) {
    throw new TrackingError(
      409,
      "account_review",
      "Esta cuenta tiene otra asignación de GPS. La base debe revisarla antes de agregar este turno.",
    );
  }
  for (const deviceId of ids) {
    if (!assigned.includes(deviceId)) {
      await fleet.write("/permissions", "POST", admin.cookie, {
        userId: person.accountUserId,
        deviceId,
      }, signal);
    }
  }
  const verified = await load();
  if (
    verified.length !== ids.length ||
    verified.some((id) => !ids.includes(id)) || await allowed() !== true
  ) {
    throw new TrackingError(
      503,
      "driver_link_uncertain",
      "Falta confirmar el acceso a la unidad. Comprueba la misma solicitud antes de ponerlo en turno.",
    );
  }
}
