import {taxiQualityRequest}from"./quality.ts";
import { customerPhones, parseCustomerAccess } from '../_shared/bot/taxis/customerAccess.ts';
import { FleetApi, type FleetIdentity } from "../_shared/tracking/auth.ts";
import { record, TrackingError, uuid } from "../_shared/tracking/contracts.ts";
import { parseTaxiBase, taxiBaseColumns } from '../_shared/tracking/companies.ts';
import {
  corsHeaders,
  errorResponse,
  json,
  readJson,
} from "../_shared/tracking/http.ts";
import type { TrackingStore } from "../_shared/tracking/store.ts";
import { coord, phone, text } from "../_shared/bot/taxis/contracts.ts";
import {
  parsePackageRecord,
  parsePackageRows,
  parsePackageWrite,
  parseTaxiCompanyPackageAssignment,
  parseTaxiCompanyPackageAssignments,
} from "../_shared/tracking/packages.ts";
import {
  cells,
  channelFromRow,
  exact,
  parseCommand,
  parseAdminPlan,
} from "../_shared/bot/taxis/adminContracts.ts";
import { taxiH3Cell, taxiH3Scope } from "../_shared/bot/taxis/h3.ts";
import { cellToLatLng } from "h3-js";
import { getDistanceFromLatLonInKm } from "../_shared/algorithms/headingMatcher.ts";
export interface AdminDependencies {
  fleet: FleetApi;
  store: TrackingStore;
  runtimeReady: boolean;
}
export function createTaxiAdminHandler(
  deps: AdminDependencies,
): (req: Request) => Promise<Response> {
  async function access(
    identity: FleetIdentity,
  ): Promise<{ tenant: string | null; configure: boolean }> {
    if (identity.admin) return { tenant: null, configure: true };
    const rows = await deps.store.read(
      "perfiles",
      new URLSearchParams({
        select: "empresa_id,rol",
        traccar_user_id: "eq." + identity.userId,
        limit: "2",
      }),
    );
    const p = rows[0];
    if (
      rows.length !== 1 || !record(p) ||
      (p.rol !== "admin_empresa" && p.rol !== "operador")
    ) {
      throw new TrackingError(
        403,
        "admin_forbidden",
        "Tu cuenta no tiene una base asignada para entrar al panel.",
      );
    }
    return { tenant: uuid(p.empresa_id), configure: p.rol === "admin_empresa" };
  }
  async function company(tenant: string) {
    const rows = await deps.store.read(
      "empresas",
      new URLSearchParams({
        select:
          "id,nombre_empresa,tipo_negocio,activo,paquete:paquetes(activo,incluye_whatsapp)",
        id: "eq." + tenant,
        limit: "1",
      }),
    );
    const e = rows[0];
    if (!record(e) || e.tipo_negocio !== "taxi") {
      throw new TrackingError(
        403,
        "taxi_company_required",
        "Selecciona una base de taxis.",
      );
    }
    return e;
  }
  return async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json({
        error: "Usa el panel para consultar o guardar.",
        code: "method_not_allowed",
      }, 405);
    }
    try {
      const raw = await readJson(req, 16384);
      if (!record(raw) || typeof raw.action !== "string") {
        throw new TrackingError(
          400,
          "invalid_admin_request",
          "Faltan los datos de la consulta.",
        );
      }
      const identity = await deps.fleet.identity(req),
        scope = await access(identity);
      if (raw.action === 'companies_list') {
        exact(raw, ['action']);
        const query = new URLSearchParams({
          select: taxiBaseColumns, tipo_negocio: 'eq.taxi', order: 'nombre_empresa.asc', limit: '101',
        });
        if (scope.tenant) query.set('id', 'eq.' + scope.tenant);
        const rows = await deps.store.read('empresas', query);
        if (rows.length > 100) throw new TrackingError(413, 'company_limit', 'Hay más de cien bases. Acota la consulta antes de continuar.');
        const bases = rows.map(parseTaxiBase);
        if (new Set(bases.map(base => base.id)).size !== bases.length || scope.tenant && bases.some(base => base.id !== scope.tenant)) {
          throw new TrackingError(502, 'invalid_base_scope', 'No pudimos comprobar las bases de tu cuenta.');
        }
        return json({ bases, canManage: identity.admin });
      }
      if (raw.action === 'companies_set_active') {
        exact(raw, ['action', 'companyId', 'expectedActive', 'active']);
        if (!identity.admin) throw new TrackingError(403, 'superadmin_required', 'Sólo el superadministrador puede activar o desactivar una base.');
        const id = uuid(raw.companyId);
        if (typeof raw.expectedActive !== 'boolean' || typeof raw.active !== 'boolean') {
          throw new TrackingError(400, 'invalid_base_status', 'Actualiza la base antes de cambiar su estado.');
        }
        const rows = await deps.store.read('empresas', new URLSearchParams({
          select: taxiBaseColumns, id: 'eq.' + id, tipo_negocio: 'eq.taxi', limit: '1',
        }));
        if (!rows.length) throw new TrackingError(404, 'taxi_company_not_found', 'No encontramos esa base de taxis.');
        const current = parseTaxiBase(rows[0]);
        if (current.id !== id) throw new TrackingError(502, 'invalid_base_scope', 'No pudimos comprobar la base solicitada.');
        if (current.activo === raw.active) return json({ state: 'saved', base: current });
        if (current.activo !== raw.expectedActive) {
          throw new TrackingError(409, 'company_status_conflict', 'El estado cambió. Actualiza la lista antes de volver a intentarlo.');
        }
        const saved = await deps.store.writeCompanyStatus(id, raw.expectedActive, raw.active);
        if (saved.length !== 1) throw new TrackingError(409, 'company_status_conflict', 'El estado cambió mientras guardabas. Actualiza la lista.');
        const base = parseTaxiBase(saved[0]);
        if (base.id !== id || base.activo !== raw.active) {
          throw new TrackingError(503, 'company_status_uncertain', 'No se confirmó el estado guardado. Actualiza la lista antes de repetir.');
        }
        return json({ state: 'saved', base });
      }
      if (raw.action.startsWith("packages_")) {
        if (!identity.admin) {
          throw new TrackingError(
            403,
            "superadmin_required",
            "Sólo el superadministrador puede administrar los planes.",
          );
        }
        if (raw.action === "packages_list") {
          exact(raw, ["action"]);
          const rows = await deps.store.read(
            "paquetes",
            new URLSearchParams({
              select: "id,nombre,precio_mensual,incluye_bot,incluye_whatsapp,activo,features,limite_vehiculos,permisos_sistema",
              order: "precio_mensual.asc",
              limit: "100",
            }),
          );
          return json({ packages: parsePackageRows(rows) });
        }
        if (raw.action === "packages_assignments_list") {
          exact(raw, ["action"]);
          const rows = await deps.store.read(
            "empresas",
            new URLSearchParams({
              select: "id,nombre_empresa,ciudad,activo,paquete_id",
              tipo_negocio: "eq.taxi",
              order: "nombre_empresa.asc",
              limit: "101",
            }),
          );
          if (rows.length > 100) {
            throw new TrackingError(413, "company_limit", "Hay más de cien bases. Acota la asignación de planes antes de continuar.");
          }
          return json({ assignments: parseTaxiCompanyPackageAssignments(rows) });
        }
        if (raw.action === "packages_assign") {
          exact(raw, ["action", "companyId", "expectedPackageId", "packageId"]);
          const companyId = uuid(raw.companyId);
          const expectedPackageId = raw.expectedPackageId === null ? null : uuid(raw.expectedPackageId);
          const packageId = raw.packageId === null ? null : uuid(raw.packageId);
          const companyRows = await deps.store.read(
            "empresas",
            new URLSearchParams({
              select: "id,nombre_empresa,ciudad,activo,paquete_id,tipo_negocio",
              id: "eq." + companyId,
              limit: "1",
            }),
          );
          const companyRow = companyRows[0];
          if (!record(companyRow) || companyRow.tipo_negocio !== "taxi") {
            throw new TrackingError(404, "taxi_company_not_found", "No encontramos esa base de taxis.");
          }
          const current = parseTaxiCompanyPackageAssignment(companyRow);
          if (current.paquete_id !== expectedPackageId) {
            throw new TrackingError(409, "package_assignment_conflict", "La asignación cambió. Actualiza la pantalla antes de guardar.");
          }
          if (packageId !== null) {
            const packageRows = await deps.store.read(
              "paquetes",
              new URLSearchParams({
                select: "id,activo",
                id: "eq." + packageId,
                limit: "1",
              }),
            );
            const targetPackage = packageRows[0];
            if (!record(targetPackage)) {
              throw new TrackingError(404, "package_not_found", "Ese plan ya no existe. Actualiza la lista.");
            }
            if (targetPackage.activo !== true) {
              throw new TrackingError(409, "package_inactive", "Activa el plan antes de asignarlo a una base.");
            }
          }
          const updatedRows = await deps.store.writeCompanyPackage(companyId, expectedPackageId, packageId);
          if (updatedRows.length !== 1) {
            throw new TrackingError(409, "package_assignment_conflict", "La asignación cambió. Actualiza la pantalla antes de guardar.");
          }
          const updated = parseTaxiCompanyPackageAssignment(updatedRows[0]);
          if (updated.paquete_id !== packageId) {
            throw new TrackingError(503, "package_assignment_uncertain", "No se confirmó el plan guardado. Actualiza la lista antes de volver a intentarlo.");
          }
          return json({ state: "saved", assignment: updated });
        }
        if (raw.action === "packages_create") {
          exact(raw, ["action", "requestId", "package"]);
          const id = uuid(raw.requestId);
          const payload = parsePackageWrite(raw.package);
          const rows = await deps.store.writePackages(
            "POST",
            new URLSearchParams({ on_conflict: "id" }),
            { id, ...payload },
          );
          if (rows.length !== 1) {
            throw new TrackingError(503, "package_create_uncertain", "No se confirmó el plan. Actualiza la lista antes de volver a intentar.");
          }
          return json({ state: "saved", package: parsePackageRecord(rows[0]) });
        }
        if (raw.action === "packages_update") {
          exact(raw, ["action", "id", "package"]);
          const id = uuid(raw.id);
          const rows = await deps.store.writePackages(
            "PATCH",
            new URLSearchParams({ id: "eq." + id }),
            parsePackageWrite(raw.package),
          );
          if (rows.length !== 1) {
            throw new TrackingError(404, "package_not_found", "El plan ya no existe. Actualiza la lista.");
          }
          return json({ state: "saved", package: parsePackageRecord(rows[0]) });
        }
        if (raw.action === "packages_delete") {
          exact(raw, ["action", "id"]);
          const id = uuid(raw.id);
          const rows = await deps.store.writePackages(
            "DELETE",
            new URLSearchParams({ id: "eq." + id }),
          );
          return json({ state: "deleted", deleted: rows.length === 1 });
        }
        throw new TrackingError(400, "invalid_package_action", "Esa operación de planes no está disponible.");
      }
      if (raw.action === "context") {
        exact(raw, ["action"]);
        const query = new URLSearchParams({
          select: "id,nombre_empresa,paquete:paquetes(id,nombre,precio_mensual,incluye_bot,incluye_whatsapp,activo,permisos_sistema)",
          tipo_negocio: "eq.taxi",
          order: "nombre_empresa.asc",
          limit: "101",
        });
        if (scope.tenant) query.set("id", "eq." + scope.tenant);
        const companies = await deps.store.read("empresas", query);
        if (companies.length > 100) {
          throw new TrackingError(
            413,
            "tenant_limit",
            "Hay más de cien bases. Hace falta acotar la administración antes de cargarlas.",
          );
        }
        const tenants = companies.map((t) => {
          if (!record(t) || !text(t.nombre_empresa, 120)) {
            throw new TrackingError(
              502,
              "admin_bad_company",
              "No pudimos leer una base.",
            );
          }
          return { id: uuid(t.id), name: String(t.nombre_empresa),
            plan: record(t.paquete) && t.paquete.activo === true ? parseAdminPlan(t.paquete) : null };
        });
        if (!tenants.length) {
          return json({
            actorId: identity.userId,
            tenants: [],
            channels: [],
            runtimeReady: deps.runtimeReady,
            canConfigure: scope.configure,
          });
        }
        const channels = await deps.store.read(
          "taxi_bot_channels",
          new URLSearchParams({
            select: "*",
            tenant_id: "in.(" + tenants.map((t) => t.id).join(",") + ")",
            order: "name.asc",
            limit: "101",
          }),
        );
        if (channels.length > 100) {
          throw new TrackingError(
            413,
            "channel_limit",
            "Hay demasiados canales para una sola consulta.",
          );
        }
        return json({
          actorId: identity.userId,
          tenants,
          channels: channels.map(channelFromRow),
          runtimeReady: deps.runtimeReady,
          canConfigure: scope.configure,
        });
      }
      const tenant = uuid(raw.tenantId);
      if (raw.action === 'customer_access' || raw.action === 'set_customer_access') {
        if (scope.tenant && scope.tenant !== tenant) throw new TrackingError(403,'tenant_forbidden','Esa base no pertenece a tu cuenta.');
        await company(tenant);
        if (raw.action === 'customer_access') {
          exact(raw,['action','tenantId']);
          const access = parseCustomerAccess(await deps.store.rpc('taxi_bot_customer_access_read',{p_tenant:tenant}));
          return json({...access,restricted:true});
        }
        exact(raw,['action','tenantId','requestId','revision','phones']);
        if (!scope.configure) throw new TrackingError(403,'configure_forbidden','Sólo la administración de Pompeyo puede cambiar los números autorizados.');
        if (typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new TrackingError(400,'invalid_revision','Actualiza la lista antes de guardar.');
        const result = await deps.store.rpc('taxi_bot_customer_access_apply',{p_tenant:tenant,p_actor:identity.userId,p_request:uuid(raw.requestId),p_expected:raw.revision,p_phones:customerPhones(raw.phones)});
        if (!record(result) || typeof result.state !== 'string') throw new TrackingError(503,'access_result_uncertain','No se confirmó el guardado. Comprueba la misma solicitud.');
        if (result.state !== 'saved') throw new TrackingError(409,result.state,'La lista cambió o la solicitud ya se usó. Actualiza antes de editar.');
        return json({...parseCustomerAccess(result),restricted:true,state:'saved'});
      }
      const waba = phone(raw.waba);
      if (!waba) {
        throw new TrackingError(
          400,
          "invalid_channel",
          "Completa el número de WhatsApp.",
        );
      }
      if (scope.tenant && scope.tenant !== tenant) {
        throw new TrackingError(
          403,
          "tenant_forbidden",
          "Esa base no pertenece a tu cuenta.",
        );
      }
      const tenantRow = await company(tenant);
      const rows = await deps.store.read(
        "taxi_bot_channels",
        new URLSearchParams({
          select: "*",
          tenant_id: "eq." + tenant,
          waba: "eq." + waba,
          limit: "1",
        }),
      );
      const channel = rows.length ? channelFromRow(rows[0]) : null;
      if(['quality','quality_attempts','quality_trace','quality_review','training_export'].includes(raw.action)){if(!channel)throw new TrackingError(404,'channel_not_found','Primero configura el canal.');const result=await taxiQualityRequest(raw,tenant,waba,identity.userId,scope.configure,deps.store);if(result)return result;}

      if (["zones", "operations", "quote"].includes(raw.action)) {
        if (!channel) {
          throw new TrackingError(
            404,
            "channel_not_found",
            "Primero guarda la configuración del canal.",
          );
        }
        const input: Record<string, unknown> = {};
        if (raw.action === "zones") {
          exact(raw, [
            "action",
            "tenantId",
            "waba",
            "source",
            "cells",
            "after",
            "search",
          ]);
          if (raw.cells !== undefined) input.cells = cells(raw.cells, 500);
          if (raw.source !== undefined) {
            if (raw.source !== "base" && raw.source !== "catalog") {
              throw new TrackingError(
                400,
                "invalid_source",
                "Elige las zonas de la base o el catálogo existente.",
              );
            }
            input.source = raw.source;
          }
          if (raw.after !== undefined) {
            if (!taxiH3Cell(raw.after)) {
              throw new TrackingError(
                400,
                "invalid_cursor",
                "Vuelve a cargar la lista de zonas.",
              );
            }
            input.after = raw.after;
          }
          if (raw.search !== undefined) {
            if (typeof raw.search !== "string" || raw.search.length > 100) {
              throw new TrackingError(
                400,
                "invalid_search",
                "Escribe una búsqueda más corta.",
              );
            }
            input.search = raw.search;
          }
        } else if (raw.action === "operations") {
          exact(raw, ["action", "tenantId", "waba", "customer"]);
          if (raw.customer !== undefined) {
            const customer = phone(raw.customer);
            if (!customer) {
              throw new TrackingError(
                400,
                "invalid_customer",
                "Selecciona una conversación válida.",
              );
            }
            input.customer = customer;
          }
        } else {
          exact(raw, ["action", "tenantId", "waba", "origin", "destination"]);
          const o = raw.origin, d = raw.destination;
          if (
            !record(o) || !record(d) || !coord(o.lat, o.lng) ||
            !coord(d.lat, d.lng) || typeof o.lng !== "number" ||
            typeof d.lng !== "number"
          ) {
            throw new TrackingError(
              400,
              "invalid_location",
              "Marca la recogida y el destino en el mapa.",
            );
          }
          if (
            getDistanceFromLatLonInKm(
                o.lat,
                o.lng,
                channel.centerLat,
                channel.centerLng,
              ) > channel.radiusKm ||
            getDistanceFromLatLonInKm(
                d.lat,
                d.lng,
                channel.centerLat,
                channel.centerLng,
              ) > channel.radiusKm
          ) return json({ state: "outside_service_area", mode: "h3_zone_max" });
          Object.assign(
            input,
            taxiH3Scope({
              text: "Recogida",
              lat: o.lat,
              lng: o.lng,
              placeId: null,
            }, { text: "Destino", lat: d.lat, lng: d.lng, placeId: null }),
          );
        }
        return json(
          await deps.store.rpc("taxi_bot_admin_read", {
            p_tenant: tenant,
            p_waba: waba,
            p_view: raw.action,
            p_input: input,
          }),
        );
      }
      const command = parseCommand(raw);
      if (
        ["configure", "upsert_zones", "assign_catalog", "remove_zones"]
          .includes(command.action) && !scope.configure
      ) {
        throw new TrackingError(
          403,
          "configure_forbidden",
          "Sólo la administración de la base puede cambiar zonas y tarifas.",
        );
      }
      if (command.action === "configure") {
        if (
          Number(command.payload.baseCents) > 1000000 ||
          Number(command.payload.perKmCents) > 1000000
        ) {
          throw new TrackingError(
            400,
            "invalid_rate",
            "La tarifa por distancia supera el límite permitido.",
          );
        }
        if (command.payload.enabled) {
          const p = tenantRow.paquete;
          if (tenantRow.activo !== true) {
            throw new TrackingError(409, 'activation_incomplete', 'La base está inactiva. Actívala en Bases y canales antes de encender WhatsApp.');
          }
          if (!record(p) || p.activo !== true || p.incluye_whatsapp !== true) {
            throw new TrackingError(409, 'activation_incomplete', 'Asigna a esta base un plan activo que incluya WhatsApp en Planes y asignación.');
          }
          if (
            !deps.runtimeReady
          ) {
            throw new TrackingError(
              409,
              "activation_incomplete",
              "WhatsApp todavía no está listo en el servidor. Puedes guardar el canal apagado mientras completas la conexión.",
            );
          }
        }
      } else if (
        command.action === "upsert_zones" || command.action === "assign_catalog"
      ) {
        if (!channel) {
          throw new TrackingError(
            404,
            "channel_not_found",
            "Primero guarda la configuración del canal.",
          );
        }
        for (const cell of cells(command.payload.cells)) {
          const [lat, lng] = cellToLatLng(cell);
          if (
            getDistanceFromLatLonInKm(
              lat,
              lng,
              channel.centerLat,
              channel.centerLng,
            ) > channel.radiusKm
          ) {
            throw new TrackingError(
              400,
              "outside_service_area",
              "La selección sale de la cobertura de esta base. Ajusta el área o su cobertura.",
            );
          }
        }
      }
      const result = await deps.store.rpc("taxi_bot_admin_apply", {
        p_tenant: tenant,
        p_waba: waba,
        p_actor: identity.userId,
        p_request: command.requestId,
        p_expected: command.revision,
        p_action: command.action,
        p_payload: command.payload,
      });
      if (!record(result) || typeof result.state !== "string") {
        throw new TrackingError(
          503,
          "admin_result_uncertain",
          "No se confirmó el guardado. Comprueba la misma solicitud antes de volver a editar.",
        );
      }
      if (result.state === "saved" || result.state === "queued") {
        return json(result);
      }
      if (result.state === "not_found") {
        throw new TrackingError(
          404,
          "admin_not_found",
          "La conversación o canal ya no está disponible.",
        );
      }
      const errors: Record<string, string> = {
        revision_conflict:
          "Alguien cambió estos datos. Actualiza el panel y revisa el cambio antes de guardar.",
        request_conflict:
          "Esta solicitud ya se usó con otros datos. Actualiza el panel.",
        channel_conflict: "Ese número ya pertenece a otra base.",
        invalid_catalog:
          "La selección contiene celdas que ya no tienen una tarifa válida en el catálogo. Actualiza y revísalas.",
        activation_incomplete:
          "Agrega al menos un conductor y las zonas antes de activar el bot.",
        send_forbidden:
          "Para escribir, toma la conversación, verifica que el canal esté activo y que el cliente haya hablado en las últimas 24 horas.",
      };
      throw new TrackingError(
        409,
        result.state,
        errors[result.state] ?? "No se aplicó el cambio. Actualiza el panel.",
      );
    } catch (error: unknown) {
      return errorResponse(error);
    }
  };
}
