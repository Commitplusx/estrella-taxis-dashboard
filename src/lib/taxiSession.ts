import type { AdminContext } from "../../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts";

export interface AccountSessionPorts {
  clearCredential: () => void;
  issueCredential: () => Promise<string>;
  saveCredential: (credential: string) => void;
  readContext: () => Promise<AdminContext>;
}

/** Mint from the current cookie before reading any tenant or role. */
export async function bindTaxiAccount(userId: number, ports: AccountSessionPorts): Promise<AdminContext> {
  ports.clearCredential();
  try {
    const credential = await ports.issueCredential();
    ports.saveCredential(credential);
    const account = await ports.readContext();
    if (!Number.isSafeInteger(userId) || userId <= 0 || account.actorId !== userId) {
      throw new Error("La sesión cambió de cuenta. Inicia sesión de nuevo.");
    }
    return account;
  } catch (error: unknown) {
    ports.clearCredential();
    throw error;
  }
}

/** Only a failed cookie lookup may resume a saved login; a failed role check may not. */
export async function restoreTrackingUser<User>(ports: {
  cookieUser: () => Promise<User>;
  savedCredential: () => string | null;
  resumeUser: (credential: string) => Promise<User>;
}): Promise<User> {
  try {
    return await ports.cookieUser();
  } catch (error: unknown) {
    const saved = ports.savedCredential();
    if (!saved) throw error;
    return ports.resumeUser(saved);
  }
}
