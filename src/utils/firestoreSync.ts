import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { DEFAULT_PRICING_CONFIG } from '../data/defaultPricing';
import {
  LeadInteractionEntry,
  LeadQuoteRecord,
  MapsRouteInsight,
  PotentialHelperRecord,
  PricingConfig,
} from '../types/pricing';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  isAuthorizedFirebaseUser,
} from './firebaseClient';
import { getLocalDateString } from './negotiationEngine';
import {
  FirestoreMigrationLocalState,
  PreMigrationBackupRecord,
  buildBackupPayload,
  hasLocalPricingSaved,
  loadFirestoreMigrationState,
  loadLastBackupAt,
  loadPotentialHelpers,
  loadPreMigrationLocalBackup,
  loadPricingConfig,
  loadQuoteHistory,
  normalizeQuoteRecord,
  sanitizeHelpersList,
  saveFirestoreMigrationState,
  savePreMigrationLocalBackup,
  upgradePricingConfig,
} from './storage';

export const WORKSPACE_ID = 'dany_clean_pro';
const WORKSPACE_NAME = 'Dany Clean Pro';
const WORKSPACE_OWNER_EMAIL = 'wagnergoisoficial@gmail.com';
// Mantém <= 10 operações por lote para respeitar o limite do Firestore de 20 chamadas exists()/get() por writeBatch nas regras de segurança
const BATCH_CHUNK_SIZE = 10;

export interface SyncMetaRecord {
  lastBackupAt: string | null;
  migrationCompletedAt: string | null;
  migratedByEmail: string | null;
  migratedLeadCount: number;
  migratedHelperCount: number;
  recordVersion: number;
}

export interface MigrationResult {
  ran: boolean;
  migratedLeads: number;
  migratedHelpers: number;
  externalBackupTriggered: boolean;
}

function clampString(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val : fallback;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function clampNonEmpty(val: unknown, maxLen: number, fallback: string): string {
  const s = clampString(val, maxLen).trim();
  return s || clampString(fallback, maxLen);
}

function clampOptionalString(
  val: unknown,
  maxLen: number
): string | null {
  if (typeof val !== 'string' || !val) return null;
  return val.length > maxLen ? val.slice(0, maxLen) : val;
}

function nonNegNum(val: unknown, fallback = 0): number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0
    ? val
    : fallback;
}

function optNonNegNum(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0
    ? val
    : null;
}

export function normalizeDocId(rawId: string): string {
  const cleaned = rawId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function getAuthenticatedUserEmail(): string {
  const user = auth.currentUser;
  if (!user || !isAuthorizedFirebaseUser(user) || !user.email) {
    throw new Error('Sessão autorizada do Firebase não encontrada.');
  }
  return user.email.trim().toLowerCase();
}

function extractIsoUpdatedAt(
  data: Record<string, unknown>,
  fallbackIso: string
): string {
  const ts = data.serverUpdatedAt;
  if (ts instanceof Timestamp) {
    return ts.toDate().toISOString();
  }
  if (
    ts &&
    typeof ts === 'object' &&
    'toDate' in ts &&
    typeof (ts as { toDate: () => Date }).toDate === 'function'
  ) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof data.updatedAt === 'string' && data.updatedAt) {
    return data.updatedAt;
  }
  return fallbackIso;
}

export function toFirestorePricingPayload(
  config: PricingConfig,
  userEmail: string,
  recordVersion: number,
  nowIso: string
) {
  const safe = upgradePricingConfig(config) ?? DEFAULT_PRICING_CONFIG;
  return {
    workspaceId: WORKSPACE_ID,
    schemaVersion: 4,
    recordVersion: Math.max(1, Math.floor(recordVersion)),
    updatedAt: clampNonEmpty(nowIso, 64, new Date().toISOString()),
    serverUpdatedAt: serverTimestamp(),
    updatedByEmail: clampNonEmpty(userEmail.toLowerCase(), 160, WORKSPACE_OWNER_EMAIL),
    tiers: stripUndefinedDeep(safe.tiers).slice(0, DEFAULT_PRICING_CONFIG.tiers.length),
    moveInOutPercent: nonNegNum(safe.moveInOutPercent, 0),
    conditionModeratePercent: nonNegNum(safe.conditionModeratePercent, 0),
    conditionHeavyPercent: nonNegNum(safe.conditionHeavyPercent, 0),
    petOnePrice: nonNegNum(safe.petOnePrice, 0),
    petTwoPlusPrice: nonNegNum(safe.petTwoPlusPrice, 0),
    deepCleanRangeMarginPercent: nonNegNum(safe.deepCleanRangeMarginPercent, 0),
    defaultDayOption1: clampNonEmpty(safe.defaultDayOption1, 40, 'Tuesday'),
    defaultDayOption2: clampNonEmpty(safe.defaultDayOption2, 40, 'Thursday'),
    cityFixedDays: stripUndefinedDeep(safe.cityFixedDays).slice(0, 100),
    serviceBaseLocation: clampNonEmpty(
      safe.serviceBaseLocation,
      200,
      DEFAULT_PRICING_CONFIG.serviceBaseLocation
    ),
    serviceMaxRadiusMiles: Math.max(1, nonNegNum(safe.serviceMaxRadiusMiles, 35)),
    servedCities: safe.servedCities
      .slice(0, 200)
      .map((c) => clampString(c, 100))
      .filter(Boolean),
    companyFacts: clampString(safe.companyFacts, 12000),
    extras: {
      forno: nonNegNum(safe.extras.forno, 0),
      geladeira: nonNegNum(safe.extras.geladeira, 0),
      janelaPorUnidade: nonNegNum(safe.extras.janelaPorUnidade, 0),
      armarios: nonNegNum(safe.extras.armarios, 0),
      roupaDeCama: nonNegNum(safe.extras.roupaDeCama, 0),
    },
    visitaAvulsa: {
      fogaoEForno: nonNegNum(safe.visitaAvulsa.fogaoEForno, 0),
      geladeira: nonNegNum(safe.visitaAvulsa.geladeira, 0),
      fornoEGeladeira: nonNegNum(safe.visitaAvulsa.fornoEGeladeira, 0),
      soJanelasMinimo: nonNegNum(safe.visitaAvulsa.soJanelasMinimo, 0),
    },
    negotiation: {
      competitiveDiscountPercent: nonNegNum(
        safe.negotiation.competitiveDiscountPercent,
        0
      ),
      minimumFloorPercent: nonNegNum(safe.negotiation.minimumFloorPercent, 0),
      twoHourPackagePrice: nonNegNum(safe.negotiation.twoHourPackagePrice, 0),
      defaultHibernateDate: clampString(
        safe.negotiation.defaultHibernateDate,
        40
      ),
      seasonalPromo: {
        active: Boolean(safe.negotiation.seasonalPromo.active),
        name: clampString(safe.negotiation.seasonalPromo.name, 120),
        percent: nonNegNum(safe.negotiation.seasonalPromo.percent, 0),
        expiresAt: clampString(safe.negotiation.seasonalPromo.expiresAt, 40),
      },
    },
  };
}

function sanitizeMapsInsightForFirestore(
  insight: MapsRouteInsight | null | undefined
): Record<string, unknown> | null {
  if (!insight) return null;
  return stripUndefinedDeep({
    baseAddressFormatted: clampString(insight.baseAddressFormatted, 300),
    baseLat: typeof insight.baseLat === 'number' ? insight.baseLat : null,
    baseLng: typeof insight.baseLng === 'number' ? insight.baseLng : null,
    leadAddressFormatted: clampString(insight.leadAddressFormatted, 300),
    leadLat: typeof insight.leadLat === 'number' ? insight.leadLat : null,
    leadLng: typeof insight.leadLng === 'number' ? insight.leadLng : null,
    distanceMiles:
      typeof insight.distanceMiles === 'number' ? insight.distanceMiles : null,
    durationMinutes:
      typeof insight.durationMinutes === 'number'
        ? insight.durationMinutes
        : null,
    encodedPolyline:
      typeof insight.encodedPolyline === 'string'
        ? insight.encodedPolyline.slice(0, 60000)
        : null,
    inServiceArea:
      typeof insight.inServiceArea === 'boolean' ? insight.inServiceArea : null,
    maxRadiusMiles: nonNegNum(insight.maxRadiusMiles, 35),
    mapsAvailable: Boolean(insight.mapsAvailable),
    mapsError: insight.mapsError ? clampString(insight.mapsError, 500) : null,
    groundingSummaryPt: clampString(insight.groundingSummaryPt, 4000),
    groundingSources: Array.isArray(insight.groundingSources)
      ? insight.groundingSources.slice(0, 20).map((s) => ({
          title: clampString(s.title, 200),
          uri: clampString(s.uri, 1000),
          reviewSnippets: Array.isArray(s.reviewSnippets)
            ? s.reviewSnippets.slice(0, 5).map((r) => clampString(r, 500))
            : [],
        }))
      : [],
    checkedAt: clampNonEmpty(insight.checkedAt, 64, new Date().toISOString()),
  });
}

function toFirestoreLeadPayload(
  lead: LeadQuoteRecord,
  userEmail: string,
  recordVersion: number,
  nowIso: string,
  preserveCreatedAt?: string
) {
  const normalized = normalizeQuoteRecord(lead) ?? lead;
  const docId = normalizeDocId(normalized.id);
  const interactions = Array.isArray(normalized.interactionHistory)
    ? normalized.interactionHistory
        .slice(-500)
        .map((entry) => stripUndefinedDeep(entry))
    : [];

  return {
    workspaceId: WORKSPACE_ID,
    schemaVersion: 4,
    recordVersion: Math.max(1, Math.floor(recordVersion)),
    updatedAt: clampNonEmpty(nowIso, 64, new Date().toISOString()),
    serverUpdatedAt: serverTimestamp(),
    updatedByEmail: clampNonEmpty(userEmail.toLowerCase(), 160, WORKSPACE_OWNER_EMAIL),
    id: docId,
    createdAt: clampNonEmpty(preserveCreatedAt || normalized.createdAt, 64, nowIso),
    clientName: clampNonEmpty(normalized.clientName, 200, 'Lead sem nome'),
    phone: clampString(normalized.phone, 80),
    email: clampString(normalized.email, 180),
    streetAddress: clampString(normalized.streetAddress, 250),
    zipCode: clampString(normalized.zipCode, 32),
    city: clampString(normalized.city, 120),
    desiredDate: clampString(normalized.desiredDate, 120),
    bestContact: clampString(normalized.bestContact, 120),
    origin: clampString(normalized.origin, 64),
    adCode: clampString(normalized.adCode, 120),
    notes: clampString(normalized.notes, 6000),
    squareFeet: optNonNegNum(normalized.squareFeet),
    houseLabel: clampNonEmpty(normalized.houseLabel, 120, '2 quartos, 2 banheiros'),
    effectiveHouseLabel: clampNonEmpty(
      normalized.effectiveHouseLabel,
      120,
      normalized.houseLabel || '2 quartos, 2 banheiros'
    ),
    serviceType: normalized.serviceType,
    frequency: normalized.frequency ?? null,
    visitaAvulsaOption: normalized.visitaAvulsaOption ?? null,
    houseCondition: normalized.houseCondition ?? null,
    petsOption: normalized.petsOption ?? null,
    tablePricePrimary: nonNegNum(normalized.tablePricePrimary, 0),
    promoPercent: optNonNegNum(normalized.promoPercent),
    promoName: clampString(normalized.promoName, 120),
    finalPricePrimary: nonNegNum(normalized.finalPricePrimary, 0),
    tablePriceRecurring: optNonNegNum(normalized.tablePriceRecurring),
    finalPriceRecurring: optNonNegNum(normalized.finalPriceRecurring),
    aiConfidence: optNonNegNum(normalized.aiConfidence),
    aiEstado: normalized.aiEstado ?? null,
    status: normalized.status,
    lossReason: clampString(normalized.lossReason, 500),
    stage: normalized.stage,
    objection: normalized.objection ?? null,
    concession: normalized.concession
      ? stripUndefinedDeep(normalized.concession)
      : null,
    followUpStep: normalized.followUpStep,
    nextFollowUpDate: clampOptionalString(normalized.nextFollowUpDate, 64),
    firstOutboundAt: clampOptionalString(normalized.firstOutboundAt, 64),
    firstInboundAt: clampOptionalString(normalized.firstInboundAt, 64),
    lastOutboundAt: clampOptionalString(normalized.lastOutboundAt, 64),
    lastInboundAt: clampOptionalString(normalized.lastInboundAt, 64),
    consecutiveOutboundCount: nonNegNum(normalized.consecutiveOutboundCount, 0),
    blockedUntilDate: clampOptionalString(normalized.blockedUntilDate, 64),
    hibernateUntilDate: clampOptionalString(normalized.hibernateUntilDate, 64),
    priceAlreadySent: Boolean(normalized.priceAlreadySent),
    lastGeneratedMessage: normalized.lastGeneratedMessage
      ? stripUndefinedDeep(normalized.lastGeneratedMessage)
      : null,
    interactionHistory: interactions,
    mapsInsight: sanitizeMapsInsightForFirestore(normalized.mapsInsight),
    dayOption1: clampString(normalized.dayOption1 || 'Tuesday', 40),
    dayOption2: clampString(normalized.dayOption2 || 'Thursday', 40),
  };
}

function toFirestoreHelperPayload(
  helper: PotentialHelperRecord,
  userEmail: string,
  recordVersion: number,
  nowIso: string,
  preserveSavedAt?: string
) {
  const docId = normalizeDocId(helper.id);
  return {
    workspaceId: WORKSPACE_ID,
    schemaVersion: 1,
    recordVersion: Math.max(1, Math.floor(recordVersion)),
    updatedAt: clampNonEmpty(nowIso, 64, new Date().toISOString()),
    serverUpdatedAt: serverTimestamp(),
    updatedByEmail: clampNonEmpty(userEmail.toLowerCase(), 160, WORKSPACE_OWNER_EMAIL),
    id: docId,
    name: clampNonEmpty(helper.name, 200, 'Contato sem nome'),
    phone: clampString(helper.phone, 80),
    email: clampString(helper.email, 180),
    city: clampString(helper.city, 120),
    notes: clampString(helper.notes, 4000),
    savedAt: clampNonEmpty(preserveSavedAt || helper.savedAt, 64, nowIso),
    sourceLeadId: helper.sourceLeadId
      ? normalizeDocId(helper.sourceLeadId)
      : null,
  };
}

export function mergeInteractionHistories(
  first: LeadInteractionEntry[] = [],
  second: LeadInteractionEntry[] = []
): LeadInteractionEntry[] {
  const byId = new Map<string, LeadInteractionEntry>();
  for (const item of first) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const item of second) {
    if (item?.id && !byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-500);
}

export function mergeLeadRecords(
  remote: LeadQuoteRecord,
  local: LeadQuoteRecord
): LeadQuoteRecord {
  const remoteVer = remote.recordVersion ?? 1;
  const localVer = local.recordVersion ?? 1;
  const remoteTs = Date.parse(remote.updatedAt || remote.createdAt || '') || 0;
  const localTs = Date.parse(local.updatedAt || local.createdAt || '') || 0;

  const preferRemote =
    remoteVer > localVer || (remoteVer === localVer && remoteTs >= localTs);
  const primary = preferRemote ? remote : local;
  const secondary = preferRemote ? local : remote;

  return {
    ...primary,
    id: remote.id,
    createdAt: remote.createdAt || local.createdAt,
    mapsInsight: primary.mapsInsight ?? secondary.mapsInsight ?? null,
    interactionHistory: mergeInteractionHistories(
      remote.interactionHistory || [],
      local.interactionHistory || []
    ),
    recordVersion: Math.max(remoteVer, localVer),
  };
}

export function mergePricingTiersWithDefaults(
  remoteRaw: unknown,
  fallbackConfig: PricingConfig = DEFAULT_PRICING_CONFIG
): PricingConfig | null {
  const direct = upgradePricingConfig(remoteRaw);
  if (direct) return direct;

  if (!remoteRaw || typeof remoteRaw !== 'object' || Array.isArray(remoteRaw)) {
    return null;
  }
  const obj = remoteRaw as Record<string, unknown>;
  if (!Array.isArray(obj.tiers) || obj.tiers.length === 0) {
    return null;
  }

  const remoteTierById = new Map<string, Record<string, unknown>>();
  for (const item of obj.tiers) {
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).id === 'string'
    ) {
      remoteTierById.set(
        (item as Record<string, unknown>).id as string,
        item as Record<string, unknown>
      );
    }
  }

  const fallbackTiers =
    fallbackConfig.tiers.length === DEFAULT_PRICING_CONFIG.tiers.length
      ? fallbackConfig.tiers
      : DEFAULT_PRICING_CONFIG.tiers;

  const mergedTiers = fallbackTiers.map(
    (fallbackTier) => remoteTierById.get(fallbackTier.id) ?? fallbackTier
  );

  return upgradePricingConfig({
    ...obj,
    tiers: mergedTiers,
  });
}

export interface ReconcileOptions {
  fromCache?: boolean;
  explicitlyDeletedIds?: ReadonlySet<string>;
  pendingLocalIds?: ReadonlySet<string>;
}

export function reconcileRemoteLeadsWithLocal(
  remoteLeads: LeadQuoteRecord[],
  localLeads: LeadQuoteRecord[],
  options: ReconcileOptions = {}
): { leads: LeadQuoteRecord[]; preservedLocalOnly: boolean } {
  const deleted = options.explicitlyDeletedIds;
  const pending = options.pendingLocalIds;

  // Nunca sobrescrever dados locais com snapshot vazio (cache offline ou Firestore vazio)
  if (remoteLeads.length === 0 && localLeads.length > 0) {
    const remainingLocal = deleted
      ? localLeads.filter((l) => !deleted.has(normalizeDocId(l.id)))
      : [...localLeads];
    if (remainingLocal.length > 0 || options.fromCache) {
      return {
        leads: remainingLocal.sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        ),
        preservedLocalOnly: !options.fromCache,
      };
    }
  }

  const localByDocId = new Map<string, LeadQuoteRecord>();
  for (const local of localLeads) {
    localByDocId.set(normalizeDocId(local.id), local);
  }

  const mergedByDocId = new Map<string, LeadQuoteRecord>();
  for (const remote of remoteLeads) {
    const docId = normalizeDocId(remote.id);
    if (deleted?.has(docId)) continue;
    const localMatch = localByDocId.get(docId);
    mergedByDocId.set(
      docId,
      localMatch ? mergeLeadRecords(remote, localMatch) : remote
    );
  }

  if (pending) {
    for (const local of localLeads) {
      const docId = normalizeDocId(local.id);
      if (pending.has(docId) && !mergedByDocId.has(docId) && !deleted?.has(docId)) {
        mergedByDocId.set(docId, local);
      }
    }
  }

  const leads = Array.from(mergedByDocId.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  return { leads, preservedLocalOnly: false };
}

export function reconcileRemoteHelpersWithLocal(
  remoteHelpers: PotentialHelperRecord[],
  localHelpers: PotentialHelperRecord[],
  options: ReconcileOptions = {}
): { helpers: PotentialHelperRecord[]; preservedLocalOnly: boolean } {
  const deleted = options.explicitlyDeletedIds;
  const pending = options.pendingLocalIds;

  if (remoteHelpers.length === 0 && localHelpers.length > 0) {
    const remainingLocal = deleted
      ? localHelpers.filter((h) => !deleted.has(normalizeDocId(h.id)))
      : [...localHelpers];
    if (remainingLocal.length > 0 || options.fromCache) {
      return {
        helpers: remainingLocal.sort((a, b) =>
          b.savedAt.localeCompare(a.savedAt)
        ),
        preservedLocalOnly: !options.fromCache,
      };
    }
  }

  const localByDocId = new Map<string, PotentialHelperRecord>();
  for (const local of localHelpers) {
    localByDocId.set(normalizeDocId(local.id), local);
  }

  const mergedByDocId = new Map<string, PotentialHelperRecord>();
  for (const remote of remoteHelpers) {
    const docId = normalizeDocId(remote.id);
    if (deleted?.has(docId)) continue;
    const localMatch = localByDocId.get(docId);
    if (!localMatch) {
      mergedByDocId.set(docId, remote);
      continue;
    }
    const remoteVer = remote.recordVersion ?? 1;
    const localVer = localMatch.recordVersion ?? 1;
    const remoteTs = Date.parse(remote.updatedAt || remote.savedAt || '') || 0;
    const localTs = Date.parse(localMatch.updatedAt || localMatch.savedAt || '') || 0;
    const preferRemote =
      remoteVer > localVer || (remoteVer === localVer && remoteTs >= localTs);
    mergedByDocId.set(docId, {
      ...(preferRemote ? remote : localMatch),
      id: remote.id,
      savedAt: remote.savedAt || localMatch.savedAt,
      recordVersion: Math.max(remoteVer, localVer),
    });
  }

  if (pending) {
    for (const local of localHelpers) {
      const docId = normalizeDocId(local.id);
      if (pending.has(docId) && !mergedByDocId.has(docId) && !deleted?.has(docId)) {
        mergedByDocId.set(docId, local);
      }
    }
  }

  const helpers = Array.from(mergedByDocId.values()).sort((a, b) =>
    b.savedAt.localeCompare(a.savedAt)
  );
  return { helpers, preservedLocalOnly: false };
}

export async function ensureWorkspaceRoot(
  userEmail: string
): Promise<void> {
  const wsPath = `workspaces/${WORKSPACE_ID}`;
  const wsRef = doc(db, 'workspaces', WORKSPACE_ID);
  try {
    const snap = await getDocFromServer(wsRef);
    if (!snap.exists()) {
      await setDoc(wsRef, {
        workspaceId: WORKSPACE_ID,
        name: WORKSPACE_NAME,
        ownerEmail: WORKSPACE_OWNER_EMAIL,
        schemaVersion: 1,
        recordVersion: 1,
        updatedByEmail: userEmail.toLowerCase(),
        serverUpdatedAt: serverTimestamp(),
      });
      await getDocFromServer(wsRef);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, wsPath);
  }
}

export async function savePricingToFirestore(
  config: PricingConfig
): Promise<void> {
  const userEmail = getAuthenticatedUserEmail();
  const path = `workspaces/${WORKSPACE_ID}/settings/pricing`;
  const ref = doc(db, 'workspaces', WORKSPACE_ID, 'settings', 'pricing');

  try {
    await ensureWorkspaceRoot(userEmail);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const existingVersion = snap.exists()
        ? Number(snap.data()?.recordVersion || 1)
        : 0;
      const nextVersion = existingVersion + 1;
      const nowIso = new Date().toISOString();
      const payload = toFirestorePricingPayload(
        config,
        userEmail,
        nextVersion,
        nowIso
      );
      tx.set(ref, payload);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertLeadToFirestore(
  lead: LeadQuoteRecord,
  options?: { mergeConversationsWithExisting?: boolean }
): Promise<void> {
  const userEmail = getAuthenticatedUserEmail();
  const docId = normalizeDocId(lead.id);
  const path = `workspaces/${WORKSPACE_ID}/leads/${docId}`;
  const ref = doc(db, 'workspaces', WORKSPACE_ID, 'leads', docId);

  try {
    await ensureWorkspaceRoot(userEmail);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const nowIso = new Date().toISOString();

      if (!snap.exists()) {
        const payload = toFirestoreLeadPayload(
          { ...lead, id: docId },
          userEmail,
          1,
          nowIso
        );
        tx.set(ref, payload);
        return;
      }

      const rawExisting = snap.data() as Record<string, unknown>;
      const rawExistingCreatedAt =
        typeof rawExisting.createdAt === 'string' && rawExisting.createdAt
          ? rawExisting.createdAt
          : undefined;
      const existingLead = normalizeQuoteRecord({
        ...rawExisting,
        updatedAt: extractIsoUpdatedAt(rawExisting, nowIso),
      });
      const existingVersion = Number(rawExisting.recordVersion || 1);

      const mergedLead: LeadQuoteRecord =
        existingLead && options?.mergeConversationsWithExisting !== false
          ? {
              ...lead,
              id: docId,
              createdAt: rawExistingCreatedAt || existingLead.createdAt || lead.createdAt,
              interactionHistory: mergeInteractionHistories(
                existingLead.interactionHistory || [],
                lead.interactionHistory || []
              ),
              mapsInsight: lead.mapsInsight ?? existingLead.mapsInsight ?? null,
            }
          : {
              ...lead,
              id: docId,
              createdAt: rawExistingCreatedAt || existingLead?.createdAt || lead.createdAt,
            };

      const payload = toFirestoreLeadPayload(
        mergedLead,
        userEmail,
        existingVersion + 1,
        nowIso,
        rawExistingCreatedAt
      );
      tx.set(ref, payload);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteLeadFromFirestore(leadId: string): Promise<void> {
  const docId = normalizeDocId(leadId);
  const path = `workspaces/${WORKSPACE_ID}/leads/${docId}`;
  try {
    await deleteDoc(doc(db, 'workspaces', WORKSPACE_ID, 'leads', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertHelperToFirestore(
  helper: PotentialHelperRecord
): Promise<void> {
  const userEmail = getAuthenticatedUserEmail();
  const docId = normalizeDocId(helper.id);
  const path = `workspaces/${WORKSPACE_ID}/helpers/${docId}`;
  const ref = doc(db, 'workspaces', WORKSPACE_ID, 'helpers', docId);

  try {
    await ensureWorkspaceRoot(userEmail);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const nowIso = new Date().toISOString();
      if (!snap.exists()) {
        tx.set(
          ref,
          toFirestoreHelperPayload({ ...helper, id: docId }, userEmail, 1, nowIso)
        );
        return;
      }
      const rawExisting = snap.data() as Record<string, unknown>;
      const existingVersion = Number(rawExisting.recordVersion || 1);
      const rawExistingSavedAt =
        typeof rawExisting.savedAt === 'string' && rawExisting.savedAt
          ? rawExisting.savedAt
          : undefined;
      const savedAt = rawExistingSavedAt || helper.savedAt;
      tx.set(
        ref,
        toFirestoreHelperPayload(
          { ...helper, id: docId, savedAt },
          userEmail,
          existingVersion + 1,
          nowIso,
          rawExistingSavedAt
        )
      );
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteHelperFromFirestore(
  helperId: string
): Promise<void> {
  const docId = normalizeDocId(helperId);
  const path = `workspaces/${WORKSPACE_ID}/helpers/${docId}`;
  try {
    await deleteDoc(doc(db, 'workspaces', WORKSPACE_ID, 'helpers', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateSyncMetaLastBackup(isoDate: string): Promise<void> {
  const userEmail = getAuthenticatedUserEmail();
  const path = `workspaces/${WORKSPACE_ID}/meta/sync`;
  const ref = doc(db, 'workspaces', WORKSPACE_ID, 'meta', 'sync');

  try {
    await ensureWorkspaceRoot(userEmail);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const nowIso = new Date().toISOString();
      const existing = snap.exists() ? snap.data() : {};
      const nextVersion = snap.exists()
        ? Number(existing.recordVersion || 1) + 1
        : 1;
      tx.set(ref, {
        workspaceId: WORKSPACE_ID,
        schemaVersion: 1,
        recordVersion: nextVersion,
        lastBackupAt: clampOptionalString(isoDate, 64),
        migrationCompletedAt: clampOptionalString(
          existing.migrationCompletedAt,
          64
        ),
        migratedByEmail: clampOptionalString(existing.migratedByEmail, 160),
        migratedLeadCount: Number(existing.migratedLeadCount || 0),
        migratedHelperCount: Number(existing.migratedHelperCount || 0),
        updatedAt: nowIso,
        serverUpdatedAt: serverTimestamp(),
        updatedByEmail: userEmail.toLowerCase(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function importBackupBundleToFirestore(
  pricingConfig: PricingConfig,
  leads: LeadQuoteRecord[],
  helpers: PotentialHelperRecord[],
  backupTimestampIso: string
): Promise<void> {
  const userEmail = getAuthenticatedUserEmail();
  await ensureWorkspaceRoot(userEmail);

  await savePricingToFirestore(pricingConfig);

  for (const lead of leads) {
    await upsertLeadToFirestore(lead, { mergeConversationsWithExisting: true });
  }

  for (const helper of helpers) {
    await upsertHelperToFirestore(helper);
  }

  await updateSyncMetaLastBackup(backupTimestampIso);
}

function triggerExternalJsonBackupDownload(
  pricingConfig: PricingConfig,
  history: LeadQuoteRecord[],
  helpers: PotentialHelperRecord[]
): boolean {
  try {
    const payload = buildBackupPayload(pricingConfig, history, helpers);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStamp = getLocalDateString();
    const link = document.createElement('a');
    link.href = url;
    link.download = `dany-clean-pro-pre-migracao-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.warn('Não foi possível disparar o download automático do JSON:', err);
    return false;
  }
}

export interface MigrationBatchOp {
  collection: 'settings' | 'leads' | 'helpers';
  docId: string;
  payload: Record<string, unknown>;
  sourcePricing?: PricingConfig;
  sourceLead?: LeadQuoteRecord;
  sourceHelper?: PotentialHelperRecord;
}

export interface MigrationRemoteSnapshot {
  pricingRaw: Record<string, unknown> | null;
  leadsRaw: Array<{ id: string; data: Record<string, unknown> }>;
  helpersRaw: Array<{ id: string; data: Record<string, unknown> }>;
  metaRaw: Record<string, unknown> | null;
}

export interface MigrationLocalData {
  userEmail: string;
  localPricing: PricingConfig;
  localLeads: LeadQuoteRecord[];
  localHelpers: PotentialHelperRecord[];
  localLastBackup: string | null;
  localMigrationState: FirestoreMigrationLocalState | null;
  preMigrationBackup: PreMigrationBackupRecord | null;
  hasSavedLocalConfig: boolean;
}

export interface MigrationAdapter {
  ensureWorkspace: (userEmail: string) => Promise<void>;
  fetchServerState: () => Promise<MigrationRemoteSnapshot>;
  commitBatchChunk: (ops: MigrationBatchOp[]) => Promise<void>;
  verifyServerState: () => Promise<{
    settingsValid: boolean;
    leadIds: Set<string>;
    helperIds: Set<string>;
  }>;
  finalizeSyncMeta: (metaInput: {
    userEmail: string;
    completedAt: string;
    localLastBackup: string | null;
    leadCount: number;
    helperCount: number;
  }) => Promise<void>;
  savePreMigrationBackup: (record: PreMigrationBackupRecord) => void;
  triggerExternalBackupDownload: (
    pricing: PricingConfig,
    leads: LeadQuoteRecord[],
    helpers: PotentialHelperRecord[]
  ) => boolean;
  saveLocalMigrationState: (state: FirestoreMigrationLocalState) => void;
}

function hasUnpushedLeadChanges(
  localLead: LeadQuoteRecord,
  remoteLead: LeadQuoteRecord,
  remoteVersion: number
): boolean {
  const remoteInteractionIds = new Set(
    (remoteLead.interactionHistory || []).map((entry) => entry.id)
  );
  const hasMissingInteraction = (localLead.interactionHistory || []).some(
    (entry) => entry?.id && !remoteInteractionIds.has(entry.id)
  );
  if (hasMissingInteraction) return true;

  const localVer = localLead.recordVersion ?? 0;
  const localTs = Date.parse(localLead.updatedAt || '') || 0;
  const remoteTs = Date.parse(remoteLead.updatedAt || remoteLead.createdAt || '') || 0;
  return localTs > remoteTs && localVer >= remoteVersion;
}

export async function executeSafeMigration(
  localData: MigrationLocalData,
  adapter: MigrationAdapter
): Promise<MigrationResult> {
  const {
    userEmail,
    localPricing,
    localLeads,
    localHelpers,
    localLastBackup,
    localMigrationState,
    preMigrationBackup,
    hasSavedLocalConfig,
  } = localData;

  await adapter.ensureWorkspace(userEmail);

  const remoteState = await adapter.fetchServerState();

  const remotePricingValid = remoteState.pricingRaw
    ? upgradePricingConfig(remoteState.pricingRaw)
    : null;

  const remoteLeadMap = new Map<
    string,
    { lead: LeadQuoteRecord; recordVersion: number; rawCreatedAt?: string }
  >();
  for (const item of remoteState.leadsRaw) {
    const normalized = normalizeQuoteRecord({
      ...item.data,
      id: item.id,
      updatedAt: extractIsoUpdatedAt(item.data, new Date().toISOString()),
    });
    if (normalized) {
      const remoteDocId = normalizeDocId(item.id || normalized.id);
      const rawCreatedAt =
        typeof item.data.createdAt === 'string' && item.data.createdAt
          ? item.data.createdAt
          : undefined;
      remoteLeadMap.set(remoteDocId, {
        lead: { ...normalized, id: remoteDocId },
        recordVersion: Number(item.data.recordVersion || 1),
        rawCreatedAt,
      });
    }
  }

  const remoteHelperMap = new Map<
    string,
    { helper: PotentialHelperRecord; recordVersion: number; rawSavedAt?: string }
  >();
  for (const item of remoteState.helpersRaw) {
    const [normalized] = sanitizeHelpersList([
      {
        ...item.data,
        id: item.id,
        updatedAt: extractIsoUpdatedAt(item.data, new Date().toISOString()),
      },
    ]);
    if (normalized) {
      const remoteDocId = normalizeDocId(item.id || normalized.id);
      const rawSavedAt =
        typeof item.data.savedAt === 'string' && item.data.savedAt
          ? item.data.savedAt
          : undefined;
      remoteHelperMap.set(remoteDocId, {
        helper: { ...normalized, id: remoteDocId },
        recordVersion: Number(item.data.recordVersion || 1),
        rawSavedAt,
      });
    }
  }

  // Deduplica leads e contatos locais por docId normalizado antes de montar o lote
  const dedupLocalLeads = new Map<string, LeadQuoteRecord>();
  for (const localLead of localLeads) {
    const docId = normalizeDocId(localLead.id);
    const existingDup = dedupLocalLeads.get(docId);
    dedupLocalLeads.set(
      docId,
      existingDup ? mergeLeadRecords(existingDup, { ...localLead, id: docId }) : { ...localLead, id: docId }
    );
  }

  const dedupLocalHelpers = new Map<string, PotentialHelperRecord>();
  for (const localHelper of localHelpers) {
    const docId = normalizeDocId(localHelper.id);
    if (!dedupLocalHelpers.has(docId)) {
      dedupLocalHelpers.set(docId, { ...localHelper, id: docId });
    }
  }

  const leadsToCreate: LeadQuoteRecord[] = [];
  const leadsToMergeUpdate: Array<{
    merged: LeadQuoteRecord;
    nextVersion: number;
    rawCreatedAt?: string;
  }> = [];

  for (const [docId, localLead] of dedupLocalLeads.entries()) {
    const remoteEntry = remoteLeadMap.get(docId);
    if (!remoteEntry) {
      leadsToCreate.push(localLead);
    } else if (
      hasUnpushedLeadChanges(
        localLead,
        remoteEntry.lead,
        remoteEntry.recordVersion
      )
    ) {
      const merged = mergeLeadRecords(remoteEntry.lead, localLead);
      leadsToMergeUpdate.push({
        merged,
        nextVersion: remoteEntry.recordVersion + 1,
        rawCreatedAt: remoteEntry.rawCreatedAt,
      });
    }
  }

  const helpersNeedingUpload: PotentialHelperRecord[] = [];
  for (const [docId, localHelper] of dedupLocalHelpers.entries()) {
    if (!remoteHelperMap.has(docId)) {
      helpersNeedingUpload.push(localHelper);
    }
  }

  const needsPricingWrite =
    !remotePricingValid &&
    (hasSavedLocalConfig ||
      localLeads.length > 0 ||
      localHelpers.length > 0 ||
      Boolean(remoteState.pricingRaw));

  const remoteMigrationCompleted = Boolean(
    remoteState.metaRaw && remoteState.metaRaw.migrationCompletedAt
  );

  const nothingPending =
    remoteMigrationCompleted &&
    !needsPricingWrite &&
    leadsToCreate.length === 0 &&
    leadsToMergeUpdate.length === 0 &&
    helpersNeedingUpload.length === 0;

  if (nothingPending) {
    if (!localMigrationState) {
      adapter.saveLocalMigrationState({
        completedAt: String(
          remoteState.metaRaw?.migrationCompletedAt || new Date().toISOString()
        ),
        userEmail,
        leadCount: remoteLeadMap.size,
        helperCount: remoteHelperMap.size,
        externalJsonExported: true,
      });
    }
    return {
      ran: false,
      migratedLeads: 0,
      migratedHelpers: 0,
      externalBackupTriggered: false,
    };
  }

  // Passo 1 e 2: Backup local imutável + backup externo em JSON antes da escrita remota
  const nowIso = new Date().toISOString();
  const hasExistingPreBackup = Boolean(
    preMigrationBackup &&
      preMigrationBackup.payload.history.length >= localLeads.length &&
      preMigrationBackup.payload.helpers.length >= localHelpers.length
  );

  if (!hasExistingPreBackup) {
    const backupPayload = buildBackupPayload(
      localPricing,
      localLeads,
      localHelpers
    );
    adapter.savePreMigrationBackup({
      createdAt: nowIso,
      userEmail,
      payload: backupPayload,
    });
  }

  const shouldTriggerDownload =
    !hasExistingPreBackup &&
    (localLeads.length > 0 || localHelpers.length > 0 || hasSavedLocalConfig);
  const externalBackupTriggered = shouldTriggerDownload
    ? adapter.triggerExternalBackupDownload(
        localPricing,
        localLeads,
        localHelpers
      )
    : false;

  // Passo 3: Monta operações respeitando limites de lote (<= 200 ops/batch) e integridade das 8 faixas
  const operations: MigrationBatchOp[] = [];
  const expectedLeadIds: string[] = [];
  const expectedHelperIds: string[] = [];

  if (needsPricingWrite) {
    const pricingToPersist = remoteState.pricingRaw
      ? mergePricingTiersWithDefaults(remoteState.pricingRaw, localPricing) ??
        localPricing
      : localPricing;
    const nextPricingVersion = remoteState.pricingRaw
      ? Number(remoteState.pricingRaw.recordVersion || 1) + 1
      : 1;
    operations.push({
      collection: 'settings',
      docId: 'pricing',
      payload: toFirestorePricingPayload(
        pricingToPersist,
        userEmail,
        nextPricingVersion,
        nowIso
      ),
      sourcePricing: pricingToPersist,
    });
  }

  for (const localLead of leadsToCreate) {
    const docId = normalizeDocId(localLead.id);
    const normalizedLead = { ...localLead, id: docId };
    expectedLeadIds.push(docId);
    operations.push({
      collection: 'leads',
      docId,
      payload: toFirestoreLeadPayload(
        normalizedLead,
        userEmail,
        1,
        nowIso
      ),
      sourceLead: normalizedLead,
    });
  }

  for (const item of leadsToMergeUpdate) {
    const docId = normalizeDocId(item.merged.id);
    const normalizedLead = { ...item.merged, id: docId };
    expectedLeadIds.push(docId);
    operations.push({
      collection: 'leads',
      docId,
      payload: toFirestoreLeadPayload(
        normalizedLead,
        userEmail,
        item.nextVersion,
        nowIso,
        item.rawCreatedAt
      ),
      sourceLead: normalizedLead,
    });
  }

  for (const localHelper of helpersNeedingUpload) {
    const docId = normalizeDocId(localHelper.id);
    const normalizedHelper = { ...localHelper, id: docId };
    expectedHelperIds.push(docId);
    operations.push({
      collection: 'helpers',
      docId,
      payload: toFirestoreHelperPayload(
        normalizedHelper,
        userEmail,
        1,
        nowIso
      ),
      sourceHelper: normalizedHelper,
    });
  }

  for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
    const chunk = operations.slice(i, i + BATCH_CHUNK_SIZE);
    await adapter.commitBatchChunk(chunk);
  }

  // Passo 4: Confirmação obrigatória no servidor antes de marcar migração concluída
  const verified = await adapter.verifyServerState();

  for (const leadId of expectedLeadIds) {
    if (!verified.leadIds.has(leadId)) {
      throw new Error(
        `Falha na confirmação de persistência do lead ${leadId} no servidor Firestore.`
      );
    }
  }

  for (const helperId of expectedHelperIds) {
    if (!verified.helperIds.has(helperId)) {
      throw new Error(
        `Falha na confirmação de persistência do contato ${helperId} no servidor Firestore.`
      );
    }
  }

  if (
    (hasSavedLocalConfig || localLeads.length > 0 || needsPricingWrite) &&
    !verified.settingsValid
  ) {
    throw new Error(
      'Falha na confirmação de persistência das configurações comerciais (8 faixas) no servidor Firestore.'
    );
  }

  const completedAt = new Date().toISOString();
  await adapter.finalizeSyncMeta({
    userEmail,
    completedAt,
    localLastBackup,
    leadCount: verified.leadIds.size,
    helperCount: verified.helperIds.size,
  });

  adapter.saveLocalMigrationState({
    completedAt,
    userEmail,
    leadCount: verified.leadIds.size,
    helperCount: verified.helperIds.size,
    externalJsonExported: externalBackupTriggered || Boolean(preMigrationBackup),
  });

  return {
    ran: true,
    migratedLeads: leadsToCreate.length + leadsToMergeUpdate.length,
    migratedHelpers: helpersNeedingUpload.length,
    externalBackupTriggered,
  };
}

let activeMigrationPromise: Promise<MigrationResult> | null = null;

export async function runSafeLocalToFirestoreMigration(): Promise<MigrationResult> {
  if (activeMigrationPromise) {
    return activeMigrationPromise;
  }

  const run = async (): Promise<MigrationResult> => {
    const userEmail = getAuthenticatedUserEmail();
    const localPricing = loadPricingConfig();
    const localLeads = loadQuoteHistory();
    const localHelpers = loadPotentialHelpers();
    const localLastBackup = loadLastBackupAt();
    const localMigrationState = loadFirestoreMigrationState();
    const preMigrationBackup = loadPreMigrationLocalBackup();
    const hasSavedLocalConfig = hasLocalPricingSaved();

    const settingsRef = doc(db, 'workspaces', WORKSPACE_ID, 'settings', 'pricing');
    const leadsColRef = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'leads'),
      where('workspaceId', '==', WORKSPACE_ID)
    );
    const helpersColRef = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'helpers'),
      where('workspaceId', '==', WORKSPACE_ID)
    );
    const metaRef = doc(db, 'workspaces', WORKSPACE_ID, 'meta', 'sync');

    const adapter: MigrationAdapter = {
      ensureWorkspace: ensureWorkspaceRoot,
      fetchServerState: async () => {
        try {
          const [
            remotePricingSnap,
            remoteLeadsSnap,
            remoteHelpersSnap,
            remoteMetaSnap,
          ] = await Promise.all([
            getDocFromServer(settingsRef),
            getDocsFromServer(leadsColRef),
            getDocsFromServer(helpersColRef),
            getDocFromServer(metaRef),
          ]);
          return {
            pricingRaw: remotePricingSnap.exists()
              ? (remotePricingSnap.data() as Record<string, unknown>)
              : null,
            leadsRaw: remoteLeadsSnap.docs.map((d) => ({
              id: d.id,
              data: d.data() as Record<string, unknown>,
            })),
            helpersRaw: remoteHelpersSnap.docs.map((d) => ({
              id: d.id,
              data: d.data() as Record<string, unknown>,
            })),
            metaRaw: remoteMetaSnap.exists()
              ? (remoteMetaSnap.data() as Record<string, unknown>)
              : null,
          };
        } catch (error) {
          return handleFirestoreError(
            error,
            OperationType.GET,
            `workspaces/${WORKSPACE_ID}`
          );
        }
      },
      commitBatchChunk: async (ops) => {
        try {
          const batch = writeBatch(db);
          for (const op of ops) {
            if (op.collection === 'settings') {
              batch.set(settingsRef, op.payload);
            } else if (op.collection === 'leads') {
              batch.set(
                doc(db, 'workspaces', WORKSPACE_ID, 'leads', op.docId),
                op.payload
              );
            } else {
              batch.set(
                doc(db, 'workspaces', WORKSPACE_ID, 'helpers', op.docId),
                op.payload
              );
            }
          }
          await batch.commit();
        } catch (batchError) {
          // Fallback transacional por documento: resolve colisões de recordVersion/createdAt
          // e identifica o caminho exato caso algum documento ainda falhe nas regras
          console.warn(
            'Lote de migração falhou; aplicando fallback transacional por documento:',
            batchError
          );
          for (const op of ops) {
            if (op.collection === 'settings') {
              const cfg =
                op.sourcePricing ??
                upgradePricingConfig(op.payload) ??
                localPricing;
              await savePricingToFirestore(cfg);
            } else if (op.collection === 'leads') {
              const lead =
                op.sourceLead ??
                normalizeQuoteRecord({ ...op.payload, id: op.docId });
              if (!lead) {
                handleFirestoreError(
                  batchError,
                  OperationType.WRITE,
                  `workspaces/${WORKSPACE_ID}/leads/${op.docId}`
                );
              }
              await upsertLeadToFirestore(lead, {
                mergeConversationsWithExisting: true,
              });
            } else {
              const helper =
                op.sourceHelper ??
                sanitizeHelpersList([{ ...op.payload, id: op.docId }])[0];
              if (!helper) {
                handleFirestoreError(
                  batchError,
                  OperationType.WRITE,
                  `workspaces/${WORKSPACE_ID}/helpers/${op.docId}`
                );
              }
              await upsertHelperToFirestore(helper);
            }
          }
        }
      },
    verifyServerState: async () => {
      try {
        const [verifiedSettings, verifiedLeads, verifiedHelpers] =
          await Promise.all([
            getDocFromServer(settingsRef),
            getDocsFromServer(leadsColRef),
            getDocsFromServer(helpersColRef),
          ]);
        const settingsValid =
          verifiedSettings.exists() &&
          Boolean(upgradePricingConfig(verifiedSettings.data()));
        return {
          settingsValid,
          leadIds: new Set(verifiedLeads.docs.map((d) => d.id)),
          helperIds: new Set(verifiedHelpers.docs.map((d) => d.id)),
        };
      } catch (error) {
        return handleFirestoreError(
          error,
          OperationType.GET,
          `workspaces/${WORKSPACE_ID}/migration_verify`
        );
      }
    },
    finalizeSyncMeta: async ({
      userEmail: actorEmail,
      completedAt,
      localLastBackup: backupIso,
      leadCount,
      helperCount,
    }) => {
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(metaRef);
          const existing = snap.exists() ? snap.data() : {};
          const nextVersion = snap.exists()
            ? Number(existing.recordVersion || 1) + 1
            : 1;
          tx.set(metaRef, {
            workspaceId: WORKSPACE_ID,
            schemaVersion: 1,
            recordVersion: nextVersion,
            lastBackupAt: clampOptionalString(
              existing.lastBackupAt || backupIso,
              64
            ),
            migrationCompletedAt: completedAt,
            migratedByEmail: actorEmail,
            migratedLeadCount: leadCount,
            migratedHelperCount: helperCount,
            updatedAt: completedAt,
            serverUpdatedAt: serverTimestamp(),
            updatedByEmail: actorEmail,
          });
        });
        await getDocFromServer(metaRef);
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.WRITE,
          `workspaces/${WORKSPACE_ID}/meta/sync`
        );
      }
    },
    savePreMigrationBackup: savePreMigrationLocalBackup,
    triggerExternalBackupDownload: triggerExternalJsonBackupDownload,
    saveLocalMigrationState: saveFirestoreMigrationState,
  };

    return executeSafeMigration(
      {
        userEmail,
        localPricing,
        localLeads,
        localHelpers,
        localLastBackup,
        localMigrationState,
        preMigrationBackup,
        hasSavedLocalConfig,
      },
      adapter
    );
  };

  activeMigrationPromise = run().finally(() => {
    activeMigrationPromise = null;
  });
  return activeMigrationPromise;
}

export interface SnapshotMetaInfo {
  fromCache: boolean;
}

export interface WorkspaceSubscriptionHandlers {
  onPricing: (config: PricingConfig) => void;
  onLeads: (leads: LeadQuoteRecord[], meta: SnapshotMetaInfo) => void;
  onHelpers: (helpers: PotentialHelperRecord[], meta: SnapshotMetaInfo) => void;
  onSyncMeta: (meta: SyncMetaRecord) => void;
  onError: (err: Error) => void;
}

export function subscribeWorkspaceData(
  handlers: WorkspaceSubscriptionHandlers
): () => void {
  const settingsPath = `workspaces/${WORKSPACE_ID}/settings/pricing`;
  const leadsPath = `workspaces/${WORKSPACE_ID}/leads`;
  const helpersPath = `workspaces/${WORKSPACE_ID}/helpers`;
  const metaPath = `workspaces/${WORKSPACE_ID}/meta/sync`;

  const unsubPricing = onSnapshot(
    doc(db, 'workspaces', WORKSPACE_ID, 'settings', 'pricing'),
    (snap) => {
      if (!snap.exists()) return;
      const raw = snap.data() as Record<string, unknown>;
      const upgraded = upgradePricingConfig({
        ...raw,
        updatedAt: extractIsoUpdatedAt(raw, new Date().toISOString()),
      });
      if (upgraded) {
        handlers.onPricing(upgraded);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, settingsPath);
      } catch (wrapped) {
        handlers.onError(wrapped as Error);
      }
    }
  );

  const leadsQuery = query(
    collection(db, 'workspaces', WORKSPACE_ID, 'leads'),
    where('workspaceId', '==', WORKSPACE_ID)
  );
  const helpersQuery = query(
    collection(db, 'workspaces', WORKSPACE_ID, 'helpers'),
    where('workspaceId', '==', WORKSPACE_ID)
  );

  const unsubLeads = onSnapshot(
    leadsQuery,
    (snap) => {
      const records: LeadQuoteRecord[] = [];
      for (const docSnap of snap.docs) {
        const raw = docSnap.data() as Record<string, unknown>;
        const normalized = normalizeQuoteRecord({
          ...raw,
          updatedAt: extractIsoUpdatedAt(raw, new Date().toISOString()),
        });
        if (normalized) records.push(normalized);
      }
      records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      handlers.onLeads(records, { fromCache: snap.metadata.fromCache });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, leadsPath);
      } catch (wrapped) {
        handlers.onError(wrapped as Error);
      }
    }
  );

  const unsubHelpers = onSnapshot(
    helpersQuery,
    (snap) => {
      const rawList = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          ...raw,
          updatedAt: extractIsoUpdatedAt(raw, new Date().toISOString()),
        };
      });
      const sanitized = sanitizeHelpersList(rawList);
      sanitized.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      handlers.onHelpers(sanitized, { fromCache: snap.metadata.fromCache });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, helpersPath);
      } catch (wrapped) {
        handlers.onError(wrapped as Error);
      }
    }
  );

  const unsubMeta = onSnapshot(
    doc(db, 'workspaces', WORKSPACE_ID, 'meta', 'sync'),
    (snap) => {
      if (!snap.exists()) return;
      const raw = snap.data() as Record<string, unknown>;
      handlers.onSyncMeta({
        lastBackupAt:
          typeof raw.lastBackupAt === 'string' ? raw.lastBackupAt : null,
        migrationCompletedAt:
          typeof raw.migrationCompletedAt === 'string'
            ? raw.migrationCompletedAt
            : null,
        migratedByEmail:
          typeof raw.migratedByEmail === 'string' ? raw.migratedByEmail : null,
        migratedLeadCount: Number(raw.migratedLeadCount || 0),
        migratedHelperCount: Number(raw.migratedHelperCount || 0),
        recordVersion: Number(raw.recordVersion || 1),
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, metaPath);
      } catch (wrapped) {
        handlers.onError(wrapped as Error);
      }
    }
  );

  return () => {
    unsubPricing();
    unsubLeads();
    unsubHelpers();
    unsubMeta();
  };
}
