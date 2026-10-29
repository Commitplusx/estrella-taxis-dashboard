import { record } from "../../estrella-taxis-backend/supabase/functions/_shared/tracking/contracts.ts";
import {
  parsePackageRecord,
  parsePackageRows,
  parseTaxiCompanyPackageAssignment,
  parseTaxiCompanyPackageAssignments,
  type PackageRecord,
  type PackageWrite,
  type TaxiCompanyPackageAssignment,
} from "../../estrella-taxis-backend/supabase/functions/_shared/tracking/packages.ts";
import { trackingCall } from "./trackingClient";

function responseRecord(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error("El servidor devolvió una respuesta no válida para los planes.");
  return value;
}

export const packageAdminClient = {
  async list(): Promise<PackageRecord[]> {
    const response = responseRecord(await trackingCall("taxi-bot-admin", { action: "packages_list" }));
    return parsePackageRows(response.packages);
  },

  async listAssignments(): Promise<TaxiCompanyPackageAssignment[]> {
    const response = responseRecord(await trackingCall("taxi-bot-admin", { action: "packages_assignments_list" }));
    return parseTaxiCompanyPackageAssignments(response.assignments);
  },

  async assign(companyId: string, expectedPackageId: string | null, packageId: string | null): Promise<TaxiCompanyPackageAssignment> {
    const response = responseRecord(await trackingCall("taxi-bot-admin", {
      action: "packages_assign",
      companyId,
      expectedPackageId,
      packageId,
    }));
    if (response.state !== "saved") throw new Error("No se confirmó la asignación del plan.");
    return parseTaxiCompanyPackageAssignment(response.assignment);
  },

  async create(requestId: string, packageData: PackageWrite): Promise<PackageRecord> {
    const response = responseRecord(await trackingCall("taxi-bot-admin", {
      action: "packages_create",
      requestId,
      package: packageData,
    }));
    if (response.state !== "saved") throw new Error("No se confirmó la creación del plan.");
    return parsePackageRecord(response.package);
  },

  async update(id: string, packageData: PackageWrite): Promise<PackageRecord> {
    const response = responseRecord(await trackingCall("taxi-bot-admin", {
      action: "packages_update",
      id,
      package: packageData,
    }));
    if (response.state !== "saved") throw new Error("No se confirmó la actualización del plan.");
    return parsePackageRecord(response.package);
  },

  async remove(id: string): Promise<void> {
    const response = responseRecord(await trackingCall("taxi-bot-admin", {
      action: "packages_delete",
      id,
    }));
    if (response.state !== "deleted") throw new Error("No se confirmó la eliminación del plan.");
  },
};
