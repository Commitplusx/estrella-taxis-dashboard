import { test } from 'node:test';
import assert from 'node:assert/strict';
import {taxiAppAccess,type TaxiAppRole}from'../src/lib/taxiAppAccess.ts';
import { bindTaxiAccount, restoreTrackingUser } from '../src/lib/taxiSession.ts';
import type { AdminContext } from '../estrella-taxis-backend/supabase/functions/_shared/bot/taxis/adminContracts.ts';

for(const role of ['owner','owner_driver','driver']satisfies TaxiAppRole[])test('application access stays scoped for '+role,()=>{
 const access=taxiAppAccess(role);assert.equal(access.personal,true);assert.equal(access.ownsTaxi,role!=='driver');
 for(const route of ['/map','/devices','/drivers'])assert.equal(access.canOpen(route),true);
 for(const route of ['/dashboard','/reports','/replay','/notifications'])assert.equal(access.canOpen(route),role!=='driver');
 for(const route of ['/users','/groups','/packages','/bot','/taxi-bot','/zonas-tarifas','/geofences','/maintenance','/settings'])assert.equal(access.canOpen(route),false);
 assert.equal(access.peopleLabel,role==='driver'?'Mi taxi y turno':'Mi taxi y choferes');assert.equal(access.home,'/drivers');
});
test('an unverified application role exposes no route',()=>{const access=taxiAppAccess(null);for(const path of ['/map','/drivers','/users'])assert.equal(access.canOpen(path),false);assert.equal(access.roleLabel,'Sin acceso');});
for(const role of ['superadmin','admin_empresa','operador']satisfies TaxiAppRole[])test('base role retains its existing route controls: '+role,()=>{assert.equal(taxiAppAccess(role).personal,false);assert.equal(taxiAppAccess(role).canOpen('/map'),true);});

function fixture(actorId: number) {
  let saved: string | null = 'account-B-credential';
  const account: AdminContext = { actorId, tenants: [], channels: [], runtimeReady: false, canConfigure: false };
  return {
    ports: {
      clearCredential: () => { saved = null; },
      issueCredential: async () => { assert.equal(saved, null); return 'account-A-credential'; },
      saveCredential: (credential: string) => { saved = credential; },
      readContext: async () => { assert.equal(saved, 'account-A-credential'); return account; },
    },
    saved: () => saved,
  };
}

test('changing account replaces the old credential before loading tenant or role', async () => {
  const f = fixture(42);
  assert.equal((await bindTaxiAccount(42, f.ports)).actorId, 42);
  assert.equal(f.saved(), 'account-A-credential');
});

test('a restored cookie A never resumes saved account B after a context failure', async () => {
  const f = fixture(99);
  let resumed = 0;
  const user = await restoreTrackingUser({
    cookieUser: async () => ({ id: 42 }), savedCredential: f.saved,
    resumeUser: async () => { resumed++; return { id: 99 }; },
  });
  await assert.rejects(bindTaxiAccount(user.id, f.ports), /cambió de cuenta/);
  assert.equal(resumed, 0);
  assert.equal(f.saved(), null);
});

test('an absent cookie resumes the explicit saved credential before binding a fresh account', async () => {
  const f = fixture(42);
  let resumed = 0;
  const user = await restoreTrackingUser({
    cookieUser: async (): Promise<{ id: number }> => { throw new Error('expired'); },
    savedCredential: f.saved,
    resumeUser: async (credential) => { assert.equal(credential, 'account-B-credential'); resumed++; return { id: 42 }; },
  });
  assert.equal((await bindTaxiAccount(user.id, f.ports)).actorId, 42);
  assert.equal(resumed, 1);
});

test('failed context validation removes the newly issued credential without retrying', async () => {
  const f = fixture(42);
  let reads = 0;
  await assert.rejects(bindTaxiAccount(42, { ...f.ports, readContext: async () => { reads++; throw new Error('forbidden'); } }), /forbidden/);
  assert.equal(reads, 1);
  assert.equal(f.saved(), null);
});
