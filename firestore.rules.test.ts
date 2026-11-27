import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'gen-lang-client-0389558667';
const WORKSPACE_ID = 'dany_clean_pro';

function validLeadPayload(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    schemaVersion: 4,
    recordVersion: 1,
    updatedAt: '2026-11-26T09:00:00.000Z',
    serverUpdatedAt: serverTimestamp(),
    updatedByEmail: 'wagnergoisoficial@gmail.com',
    id: 'lead_1732610000000_ab12c',
    createdAt: '2026-11-26T09:00:00.000Z',
    clientName: 'Sarah Miller',
    phone: '2035550199',
    email: 'sarah@example.com',
    streetAddress: '123 Main St',
    zipCode: '06901',
    city: 'Stamford',
    desiredDate: 'Next Tuesday',
    bestContact: 'WhatsApp',
    origin: 'Facebook',
    adCode: 'FB-01',
    notes: '2 dogs',
    squareFeet: 1200,
    houseLabel: '2 quartos, 2 banheiros',
    effectiveHouseLabel: '2 quartos, 2 banheiros',
    serviceType: 'recorrente',
    frequency: 'quinzenal',
    visitaAvulsaOption: null,
    houseCondition: 'padrao',
    petsOption: 'um',
    tablePricePrimary: 190,
    promoPercent: null,
    promoName: '',
    finalPricePrimary: 190,
    tablePriceRecurring: 130,
    finalPriceRecurring: 130,
    aiConfidence: null,
    aiEstado: null,
    status: 'Enviado',
    lossReason: '',
    stage: 'Orçamento enviado',
    objection: null,
    concession: null,
    followUpStep: 2,
    nextFollowUpDate: '2026-11-28',
    firstOutboundAt: '2026-11-26T09:00:00.000Z',
    firstInboundAt: null,
    lastOutboundAt: '2026-11-26T09:00:00.000Z',
    lastInboundAt: null,
    consecutiveOutboundCount: 1,
    blockedUntilDate: null,
    hibernateUntilDate: null,
    priceAlreadySent: true,
    lastGeneratedMessage: null,
    interactionHistory: [],
    mapsInsight: null,
    dayOption1: 'Tuesday',
    dayOption2: 'Thursday',
    ...overrides,
  };
}

async function runTests() {
  const rules = readFileSync('./firestore.rules', 'utf8');
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'workspaces', WORKSPACE_ID), {
        workspaceId: WORKSPACE_ID,
        name: 'Dany Clean Pro',
        ownerEmail: 'wagnergoisoficial@gmail.com',
        schemaVersion: 1,
        recordVersion: 1,
        updatedByEmail: 'wagnergoisoficial@gmail.com',
        serverUpdatedAt: serverTimestamp(),
      });
    });

    const ownerDb = testEnv
      .authenticatedContext('uid-owner', {
        email: 'wagnergoisoficial@gmail.com',
        email_verified: true,
      })
      .firestore();

    const businessDb = testEnv
      .authenticatedContext('uid-dany', {
        email: 'danycleanenpro@gmail.com',
        email_verified: true,
      })
      .firestore();

    const unauthDb = testEnv.unauthenticatedContext().firestore();

    const attackerDb = testEnv
      .authenticatedContext('uid-attacker', {
        email: 'attacker@gmail.com',
        email_verified: true,
      })
      .firestore();

    const unverifiedSpoofDb = testEnv
      .authenticatedContext('uid-spoof', {
        email: 'wagnergoisoficial@gmail.com',
        email_verified: false,
      })
      .firestore();

    // Authorized create & read
    await assertSucceeds(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_1732610000000_ab12c'),
        validLeadPayload()
      )
    );
    await assertSucceeds(
      getDoc(doc(businessDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_1732610000000_ab12c'))
    );

    // Dirty Dozen 1: Unauthenticated read
    await assertFails(
      getDoc(doc(unauthDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_1732610000000_ab12c'))
    );

    // Dirty Dozen 2: Non-allowlisted authenticated user
    await assertFails(
      getDoc(doc(attackerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_1732610000000_ab12c'))
    );

    // Dirty Dozen 3: Email spoofing with email_verified: false
    await assertFails(
      setDoc(
        doc(unverifiedSpoofDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_spoof'),
        validLeadPayload({ id: 'lead_spoof' })
      )
    );

    // Dirty Dozen 4: Shadow / ghost field
    await assertFails(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_ghost'),
        validLeadPayload({ id: 'lead_ghost', isAdmin: true })
      )
    );

    // Dirty Dozen 5: ID poisoning
    await assertFails(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'bad id with spaces'),
        validLeadPayload({ id: 'bad id with spaces' })
      )
    );

    // Dirty Dozen 6: Workspace mismatch
    await assertFails(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_ws_mismatch'),
        validLeadPayload({ id: 'lead_ws_mismatch', workspaceId: 'other_workspace' })
      )
    );

    // Dirty Dozen 7: Client-forged serverUpdatedAt
    await assertFails(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_ts'),
        validLeadPayload({ id: 'lead_ts', serverUpdatedAt: new Date() })
      )
    );

    // Dirty Dozen 8: Version rollback on update
    await assertFails(
      updateDoc(doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_1732610000000_ab12c'), {
        recordVersion: 1,
        serverUpdatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen 9: Immutable createdAt tampering
    await assertFails(
      updateDoc(doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_1732610000000_ab12c'), {
        createdAt: '2020-01-01T00:00:00.000Z',
        recordVersion: 2,
        serverUpdatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen 10: Invalid enum injection
    await assertFails(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_enum'),
        validLeadPayload({ id: 'lead_enum', status: 'Hacked' })
      )
    );

    // Dirty Dozen 11: Oversized notes string (> 6000)
    await assertFails(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_huge'),
        validLeadPayload({ id: 'lead_huge', notes: 'x'.repeat(6001) })
      )
    );

    // Dirty Dozen 12: updatedByEmail spoofing
    await assertFails(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'leads', 'lead_email_spoof'),
        validLeadPayload({
          id: 'lead_email_spoof',
          updatedByEmail: 'danycleanenpro@gmail.com',
        })
      )
    );

    // Pricing settings: 8 tiers succeeds, 7 tiers fails
    const validTiers = [
      { id: '1q_1b', label: '1 quarto, 1 banheiro', refSqFt: 700, semanal: 100, quinzenal: 110, mensal: 150, primeiraLimpeza: 150, deepClean: 240 },
      { id: '1q_2b', label: '1 quarto, 2 banheiros', refSqFt: 800, semanal: 110, quinzenal: 115, mensal: 135, primeiraLimpeza: 160, deepClean: 260 },
      { id: '2q_1b', label: '2 quartos, 1 banheiro', refSqFt: 900, semanal: 110, quinzenal: 120, mensal: 135, primeiraLimpeza: 170, deepClean: 280 },
      { id: '2q_2b', label: '2 quartos, 2 banheiros', refSqFt: 1100, semanal: 120, quinzenal: 130, mensal: 150, primeiraLimpeza: 190, deepClean: 320 },
      { id: '3q_2b', label: '3 quartos, 2 banheiros', refSqFt: 1400, semanal: 135, quinzenal: 150, mensal: 175, primeiraLimpeza: 230, deepClean: 390 },
      { id: '3q_3b', label: '3 quartos, 3 banheiros', refSqFt: 1700, semanal: 150, quinzenal: 165, mensal: 195, primeiraLimpeza: 260, deepClean: 440 },
      { id: '4q_2_3b', label: '4 quartos, 2-3 banheiros', refSqFt: 2000, semanal: 165, quinzenal: 180, mensal: 210, primeiraLimpeza: 290, deepClean: 490 },
      { id: '5q_3pb', label: '5 quartos, 3+ banheiros', refSqFt: 2600, semanal: 200, quinzenal: 220, mensal: 255, primeiraLimpeza: 360, deepClean: 700 },
    ];
    const basePricing = {
      workspaceId: WORKSPACE_ID,
      schemaVersion: 4,
      recordVersion: 1,
      updatedAt: '2026-11-26T09:00:00.000Z',
      serverUpdatedAt: serverTimestamp(),
      updatedByEmail: 'wagnergoisoficial@gmail.com',
      tiers: validTiers,
      moveInOutPercent: 10,
      conditionModeratePercent: 10,
      conditionHeavyPercent: 25,
      petOnePrice: 10,
      petTwoPlusPrice: 20,
      deepCleanRangeMarginPercent: 20,
      defaultDayOption1: 'Tuesday',
      defaultDayOption2: 'Thursday',
      cityFixedDays: [{ city: 'Stamford', weekday: 'Thursday' }],
      serviceBaseLocation: 'Stamford, CT 06901',
      serviceMaxRadiusMiles: 35,
      servedCities: ['Stamford', 'Norwalk'],
      companyFacts: 'Dany Clean Pro',
      extras: { forno: 35, geladeira: 35, janelaPorUnidade: 15, armarios: 40, roupaDeCama: 10 },
      visitaAvulsa: { fogaoEForno: 90, geladeira: 90, fornoEGeladeira: 125, soJanelasMinimo: 90 },
      negotiation: {
        competitiveDiscountPercent: 10,
        minimumFloorPercent: 20,
        twoHourPackagePrice: 140,
        defaultHibernateDate: '2027-03-20',
        seasonalPromo: { active: false, name: 'Spring Refresh', percent: 15, expiresAt: '' },
      },
    };
    await assertFails(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'settings', 'pricing'),
        { ...basePricing, tiers: validTiers.slice(0, 7) }
      )
    );
    await assertSucceeds(
      setDoc(
        doc(ownerDb, 'workspaces', WORKSPACE_ID, 'settings', 'pricing'),
        basePricing
      )
    );

    assert.ok(true, 'All Firestore security rule assertions passed');
    console.log('Firestore rules emulator tests: ALL PASSED');
  } finally {
    await testEnv.cleanup();
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
