import {
  DEFAULT_CITY_FIXED_DAYS,
  DEFAULT_COMPANY_FACTS,
  DEFAULT_PRICING_CONFIG,
  HELPERS_DATA_VERSION,
  HELPERS_STORAGE_KEY,
  HISTORY_DATA_VERSION,
  HISTORY_STORAGE_KEY,
  LAST_BACKUP_STORAGE_KEY,
  LEAD_ORIGIN_OPTIONS,
  LEGACY_HISTORY_STORAGE_KEYS,
  LEGACY_PRICING_STORAGE_KEYS,
  MIGRATABLE_HISTORY_STORAGE_KEY_V3,
  MIGRATABLE_PRICING_STORAGE_KEY_V3,
  NEGOTIATION_STAGES,
  OBJECTION_OPTIONS,
  PRICING_CONFIG_VERSION,
  PRICING_STORAGE_KEY,
} from '../data/defaultPricing';
import {
  AppBackupPayload,
  ConcessionRecord,
  CopilotObjectionType,
  FollowUpStep,
  FrequencyType,
  HouseCondition,
  LeadInteractionEntry,
  LeadOrigin,
  LeadQuoteRecord,
  MapsGroundingSource,
  MapsRouteInsight,
  NegotiationStage,
  ObjectionType,
  PetsOption,
  PotentialHelperRecord,
  PricingConfig,
  QuoteStatus,
  ServiceType,
  VisitaAvulsaOption,
} from '../types/pricing';
import { formatOfficialCityName } from './cityFormatter';
import { normalizeWeekdayName } from './dateOptions';
import { addDaysToDateString, getLocalDateString } from './negotiationEngine';

const VALID_SERVICE_TYPES = new Set<ServiceType>([
  'recorrente',
  'primeira_avulsa',
  'deep_clean',
  'move_in_out',
  'visita_avulsa',
]);

const VALID_FREQUENCIES = new Set<FrequencyType>([
  'semanal',
  'quinzenal',
  'mensal',
]);

const VALID_CONDITIONS = new Set<HouseCondition>([
  'padrao',
  'moderado',
  'pesado',
]);

const VALID_PETS = new Set<PetsOption>(['nenhum', 'um', 'dois_ou_mais']);

const VALID_VISITA_OPTS = new Set<VisitaAvulsaOption>([
  'fogao_forno',
  'geladeira',
  'forno_geladeira',
  'so_janelas',
]);

const VALID_ORIGINS = new Set<LeadOrigin>(LEAD_ORIGIN_OPTIONS);
const VALID_STAGES = new Set<NegotiationStage>(NEGOTIATION_STAGES);
const VALID_STATUSES = new Set<QuoteStatus>(['Enviado', 'Fechou', 'Perdeu']);
const VALID_OBJECTIONS = new Set<ObjectionType>(
  OBJECTION_OPTIONS.map((o) => o.id)
);
const VALID_COPILOT_OBJECTIONS = new Set<CopilotObjectionType>([
  ...OBJECTION_OPTIONS.map((o) => o.id),
  'duvida_sem_objeccao',
]);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function isFiniteNonNeg(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function safeRemoveKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignora falhas de acesso ao localStorage
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignora falhas de quota/acesso ao localStorage
  }
}

function isValidBasePricingShape(candidate: unknown): candidate is Record<string, unknown> {
  if (!isPlainObject(candidate)) return false;
  if ('minimo' in candidate) return false;

  const tiers = candidate.tiers;
  if (!Array.isArray(tiers) || tiers.length !== DEFAULT_PRICING_CONFIG.tiers.length) {
    return false;
  }

  for (const tier of tiers) {
    if (!isPlainObject(tier)) return false;
    if ('minimo' in tier) return false;
    if (typeof tier.id !== 'string' || !tier.id) return false;
    if (typeof tier.label !== 'string' || !tier.label) return false;
    if (
      !isFiniteNonNeg(tier.refSqFt) ||
      tier.refSqFt <= 0 ||
      !isFiniteNonNeg(tier.semanal) ||
      !isFiniteNonNeg(tier.quinzenal) ||
      !isFiniteNonNeg(tier.mensal) ||
      !isFiniteNonNeg(tier.primeiraLimpeza) ||
      !isFiniteNonNeg(tier.deepClean)
    ) {
      return false;
    }
  }

  if (!isFiniteNonNeg(candidate.moveInOutPercent)) return false;

  const extras = candidate.extras;
  if (
    !isPlainObject(extras) ||
    !isFiniteNonNeg(extras.forno) ||
    !isFiniteNonNeg(extras.geladeira) ||
    !isFiniteNonNeg(extras.janelaPorUnidade) ||
    !isFiniteNonNeg(extras.armarios) ||
    !isFiniteNonNeg(extras.roupaDeCama)
  ) {
    return false;
  }

  const visitaAvulsa = candidate.visitaAvulsa;
  if (
    !isPlainObject(visitaAvulsa) ||
    !isFiniteNonNeg(visitaAvulsa.fogaoEForno) ||
    !isFiniteNonNeg(visitaAvulsa.geladeira) ||
    !isFiniteNonNeg(visitaAvulsa.fornoEGeladeira) ||
    !isFiniteNonNeg(visitaAvulsa.soJanelasMinimo)
  ) {
    return false;
  }

  const negotiation = candidate.negotiation;
  if (
    !isPlainObject(negotiation) ||
    !isFiniteNonNeg(negotiation.competitiveDiscountPercent) ||
    !isFiniteNonNeg(negotiation.minimumFloorPercent) ||
    !isFiniteNonNeg(negotiation.twoHourPackagePrice) ||
    typeof negotiation.defaultHibernateDate !== 'string' ||
    !isPlainObject(negotiation.seasonalPromo) ||
    typeof negotiation.seasonalPromo.active !== 'boolean' ||
    typeof negotiation.seasonalPromo.name !== 'string' ||
    !isFiniteNonNeg(negotiation.seasonalPromo.percent) ||
    typeof negotiation.seasonalPromo.expiresAt !== 'string'
  ) {
    return false;
  }

  return true;
}

/** Aceita só links http(s); qualquer outra coisa vira vazio. */
export function sanitizeReviewLink(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed : '';
  } catch {
    return '';
  }
}

export function upgradePricingConfig(candidate: unknown): PricingConfig | null {
  if (!isValidBasePricingShape(candidate)) return null;

  return {
    ...(candidate as unknown as PricingConfig),
    conditionModeratePercent: isFiniteNonNeg(candidate.conditionModeratePercent)
      ? candidate.conditionModeratePercent
      : DEFAULT_PRICING_CONFIG.conditionModeratePercent,
    conditionHeavyPercent: isFiniteNonNeg(candidate.conditionHeavyPercent)
      ? candidate.conditionHeavyPercent
      : DEFAULT_PRICING_CONFIG.conditionHeavyPercent,
    petOnePrice: isFiniteNonNeg(candidate.petOnePrice)
      ? candidate.petOnePrice
      : DEFAULT_PRICING_CONFIG.petOnePrice,
    petTwoPlusPrice: isFiniteNonNeg(candidate.petTwoPlusPrice)
      ? candidate.petTwoPlusPrice
      : DEFAULT_PRICING_CONFIG.petTwoPlusPrice,
    deepCleanRangeMarginPercent: isFiniteNonNeg(candidate.deepCleanRangeMarginPercent)
      ? candidate.deepCleanRangeMarginPercent
      : DEFAULT_PRICING_CONFIG.deepCleanRangeMarginPercent,
    defaultDayOption1:
      typeof candidate.defaultDayOption1 === 'string' && candidate.defaultDayOption1.trim()
        ? candidate.defaultDayOption1
        : DEFAULT_PRICING_CONFIG.defaultDayOption1,
    defaultDayOption2:
      typeof candidate.defaultDayOption2 === 'string' && candidate.defaultDayOption2.trim()
        ? candidate.defaultDayOption2
        : DEFAULT_PRICING_CONFIG.defaultDayOption2,
    cityFixedDays: Array.isArray(candidate.cityFixedDays)
      ? candidate.cityFixedDays
          .filter(
            (item): item is Record<string, unknown> =>
              isPlainObject(item) && typeof item.city === 'string' && Boolean(item.city.trim())
          )
          .map((item) => ({
            city: formatOfficialCityName(String(item.city).split(',')[0] || ''),
            weekday: normalizeWeekdayName(
              typeof item.weekday === 'string' ? item.weekday : 'Thursday',
              'Thursday'
            ),
          }))
          .filter((item) => Boolean(item.city))
      : [...DEFAULT_CITY_FIXED_DAYS],
    companyFacts:
      typeof candidate.companyFacts === 'string' && candidate.companyFacts.trim()
        ? candidate.companyFacts
        : DEFAULT_COMPANY_FACTS,
    serviceBaseLocation:
      typeof candidate.serviceBaseLocation === 'string' &&
      candidate.serviceBaseLocation.trim()
        ? candidate.serviceBaseLocation
        : DEFAULT_PRICING_CONFIG.serviceBaseLocation,
    serviceMaxRadiusMiles:
      isFiniteNonNeg(candidate.serviceMaxRadiusMiles) &&
      candidate.serviceMaxRadiusMiles > 0
        ? candidate.serviceMaxRadiusMiles
        : DEFAULT_PRICING_CONFIG.serviceMaxRadiusMiles,
    servedCities: Array.isArray(candidate.servedCities)
      ? Array.from(
          new Set(
            candidate.servedCities
              .filter((c): c is string => typeof c === 'string')
              .map((c) => formatOfficialCityName(c.split(',')[0] || ''))
              .filter(Boolean)
          )
        )
      : [...DEFAULT_PRICING_CONFIG.servedCities],
    teamWhatsAppNumbers: Array.isArray(candidate.teamWhatsAppNumbers)
      ? Array.from(
          new Set(
            candidate.teamWhatsAppNumbers
              .filter((n): n is string => typeof n === 'string')
              .map((n) => n.trim())
              .filter((n) => n.replace(/\D/g, '').length >= 10)
          )
        )
      : [],
    googleReviewLink: sanitizeReviewLink(candidate.googleReviewLink),
    homeStartAddress:
      typeof candidate.homeStartAddress === 'string'
        ? candidate.homeStartAddress.trim().slice(0, 200)
        : '',
  };
}

const MAPS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sanitizeMapsInsight(raw: unknown): MapsRouteInsight | null {
  if (!isPlainObject(raw)) return null;
  const checkedAt = asString(raw.checkedAt);
  const parsedTime = Date.parse(checkedAt);
  if (!Number.isFinite(parsedTime)) return null;
  if (Date.now() - parsedTime > MAPS_CACHE_MAX_AGE_MS) {
    return null;
  }

  const rawSources = Array.isArray(raw.groundingSources) ? raw.groundingSources : [];
  const groundingSources: MapsGroundingSource[] = rawSources
    .filter((s): s is Record<string, unknown> => isPlainObject(s))
    .map((s) => ({
      title: asString(s.title, 'Google Maps'),
      uri: asString(s.uri),
      reviewSnippets: Array.isArray(s.reviewSnippets)
        ? s.reviewSnippets.filter((item): item is string => typeof item === 'string')
        : undefined,
    }))
    .filter((s) => Boolean(s.uri));

  return {
    baseAddressFormatted: asString(raw.baseAddressFormatted),
    baseLat: typeof raw.baseLat === 'number' && Number.isFinite(raw.baseLat) ? raw.baseLat : null,
    baseLng: typeof raw.baseLng === 'number' && Number.isFinite(raw.baseLng) ? raw.baseLng : null,
    leadAddressFormatted: asString(raw.leadAddressFormatted),
    leadLat: typeof raw.leadLat === 'number' && Number.isFinite(raw.leadLat) ? raw.leadLat : null,
    leadLng: typeof raw.leadLng === 'number' && Number.isFinite(raw.leadLng) ? raw.leadLng : null,
    distanceMiles:
      typeof raw.distanceMiles === 'number' && Number.isFinite(raw.distanceMiles)
        ? raw.distanceMiles
        : null,
    durationMinutes:
      typeof raw.durationMinutes === 'number' && Number.isFinite(raw.durationMinutes)
        ? raw.durationMinutes
        : null,
    encodedPolyline: typeof raw.encodedPolyline === 'string' ? raw.encodedPolyline : undefined,
    inServiceArea: typeof raw.inServiceArea === 'boolean' ? raw.inServiceArea : null,
    maxRadiusMiles: isFiniteNonNeg(raw.maxRadiusMiles) ? raw.maxRadiusMiles : 35,
    mapsAvailable: Boolean(raw.mapsAvailable),
    mapsError: typeof raw.mapsError === 'string' ? raw.mapsError : null,
    groundingSummaryPt: asString(raw.groundingSummaryPt),
    groundingSources,
    checkedAt,
  };
}

export function loadPricingConfig(): PricingConfig {
  try {
    // Descarta chaves muito antigas incompatíveis (ex: v1/v2 com campo "minimo")
    for (const legacyKey of LEGACY_PRICING_STORAGE_KEYS) {
      safeRemoveKey(legacyKey);
    }

    const raw = window.localStorage.getItem(PRICING_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        isPlainObject(parsed) &&
        parsed.version === PRICING_CONFIG_VERSION
      ) {
        const upgraded = upgradePricingConfig(parsed.config);
        if (upgraded) return upgraded;
      }
      safeRemoveKey(PRICING_STORAGE_KEY);
    }

    // Migração segura de v3 -> v4 mantendo tabela de preços da usuária
    const rawV3 = window.localStorage.getItem(MIGRATABLE_PRICING_STORAGE_KEY_V3);
    if (rawV3) {
      const parsedV3 = JSON.parse(rawV3) as unknown;
      if (isPlainObject(parsedV3) && parsedV3.version === 3) {
        const upgraded = upgradePricingConfig(parsedV3.config);
        if (upgraded) {
          savePricingConfig(upgraded);
          safeRemoveKey(MIGRATABLE_PRICING_STORAGE_KEY_V3);
          return upgraded;
        }
      }
      safeRemoveKey(MIGRATABLE_PRICING_STORAGE_KEY_V3);
    }

    savePricingConfig(DEFAULT_PRICING_CONFIG);
    return DEFAULT_PRICING_CONFIG;
  } catch {
    safeRemoveKey(PRICING_STORAGE_KEY);
    return DEFAULT_PRICING_CONFIG;
  }
}

export function savePricingConfig(config: PricingConfig): void {
  safeSetItem(
    PRICING_STORAGE_KEY,
    JSON.stringify({
      version: PRICING_CONFIG_VERSION,
      config,
    })
  );
}

function inferDefaultStage(rec: Record<string, unknown>): NegotiationStage {
  const stage = rec.stage;
  if (typeof stage === 'string' && VALID_STAGES.has(stage as NegotiationStage)) {
    return stage as NegotiationStage;
  }
  if (rec.status === 'Fechou') return 'Agendado';
  if (rec.status === 'Perdeu') return 'Perdido';
  return 'Orçamento enviado';
}

function sanitizeConcession(raw: unknown): ConcessionRecord | null {
  if (!isPlainObject(raw)) return null;
  const validTypes = new Set(['valor', 'preco', 'sazonal', 'pacote_2h']);
  if (typeof raw.type !== 'string' || !validTypes.has(raw.type)) return null;

  const validExchanges = new Set([
    'Fechar quinzenal',
    'Fechar semanal',
    'Agendar em até 7 dias',
  ]);
  const exchangeCondition =
    typeof raw.exchangeCondition === 'string' &&
    validExchanges.has(raw.exchangeCondition)
      ? (raw.exchangeCondition as ConcessionRecord['exchangeCondition'])
      : 'Fechar quinzenal';

  return {
    type: raw.type as ConcessionRecord['type'],
    description: asString(raw.description, 'Concessão aplicada'),
    discountAmountDollar: Math.max(0, Number(raw.discountAmountDollar) || 0),
    proposedFinalPrice:
      typeof raw.proposedFinalPrice === 'number' &&
      Number.isFinite(raw.proposedFinalPrice)
        ? raw.proposedFinalPrice
        : null,
    exchangeCondition,
    deadlineDate: asString(raw.deadlineDate, getLocalDateString()),
    appliedAt: asString(raw.appliedAt, new Date().toISOString()),
  };
}

function sanitizeInteractionHistory(raw: unknown): LeadInteractionEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: LeadInteractionEntry[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const id = asString(item.id);
    if (!id) continue;
    const rawObj = asString(item.objection);
    const objection = VALID_COPILOT_OBJECTIONS.has(rawObj as CopilotObjectionType)
      ? (rawObj as CopilotObjectionType)
      : null;
    const stepRaw = item.step;
    const step: FollowUpStep =
      stepRaw === 0 ||
      stepRaw === 2 ||
      stepRaw === 5 ||
      stepRaw === 10 ||
      stepRaw === 'hibernar'
        ? stepRaw
        : 2;
    entries.push({
      id,
      createdAt: asString(item.createdAt, new Date().toISOString()),
      clientMessageEn: asString(item.clientMessageEn),
      clientMessagePt: asString(item.clientMessagePt),
      realIntentPt: asString(item.realIntentPt),
      objection,
      sentReplyEn: asString(item.sentReplyEn),
      sentReplyPt: asString(item.sentReplyPt),
      step,
    });
  }
  return entries;
}

export function normalizeQuoteRecord(
  input: unknown
): LeadQuoteRecord | null {
  if (!isPlainObject(input)) return null;

  const id = asString(input.id);
  if (!id) return null;

  const rawCreatedAt = asString(input.createdAt);
  const parsedCreatedDate = rawCreatedAt ? new Date(rawCreatedAt) : new Date();
  const validCreatedDate = Number.isNaN(parsedCreatedDate.getTime())
    ? new Date()
    : parsedCreatedDate;
  const createdAt = validCreatedDate.toISOString();
  const createdDateKey = getLocalDateString(validCreatedDate);

  const stage = inferDefaultStage(input);

  let serviceType: ServiceType = 'recorrente';
  let frequency: FrequencyType | null = null;
  const rawService = asString(input.serviceType);
  if (VALID_SERVICE_TYPES.has(rawService as ServiceType)) {
    serviceType = rawService as ServiceType;
  } else if (rawService === 'primeira_limpeza') {
    serviceType = 'primeira_avulsa';
  } else if (VALID_FREQUENCIES.has(rawService as FrequencyType)) {
    serviceType = 'recorrente';
    frequency = rawService as FrequencyType;
  }

  const rawFreq = asString(input.frequency);
  if (VALID_FREQUENCIES.has(rawFreq as FrequencyType)) {
    frequency = rawFreq as FrequencyType;
  }

  const rawStatus = asString(input.status);
  const status: QuoteStatus = VALID_STATUSES.has(rawStatus as QuoteStatus)
    ? (rawStatus as QuoteStatus)
    : stage === 'Agendado' || stage === 'Cliente fixo'
    ? 'Fechou'
    : stage === 'Perdido'
    ? 'Perdeu'
    : 'Enviado';

  const rawObjection = asString(input.objection);
  const objection: ObjectionType | null = VALID_OBJECTIONS.has(
    rawObjection as ObjectionType
  )
    ? (rawObjection as ObjectionType)
    : null;

  const rawOrigin = asString(input.origin);
  const origin: LeadOrigin | '' = VALID_ORIGINS.has(rawOrigin as LeadOrigin)
    ? (rawOrigin as LeadOrigin)
    : '';

  const rawStep = input.followUpStep;
  const followUpStep: FollowUpStep =
    rawStep === 0 ||
    rawStep === 2 ||
    rawStep === 5 ||
    rawStep === 10 ||
    rawStep === 'hibernar'
      ? rawStep
      : stage === 'Novo'
      ? 0
      : stage === 'Hibernar'
      ? 'hibernar'
      : 2;

  const rawMsg = isPlainObject(input.lastGeneratedMessage)
    ? {
        english: asString(input.lastGeneratedMessage.english),
        portuguese: asString(input.lastGeneratedMessage.portuguese),
        generatedAt: asString(
          input.lastGeneratedMessage.generatedAt,
          createdAt
        ),
        step: followUpStep,
        objection,
      }
    : null;

  const rawVisitaOpt = asString(input.visitaAvulsaOption);
  const visitaAvulsaOption = VALID_VISITA_OPTS.has(
    rawVisitaOpt as VisitaAvulsaOption
  )
    ? (rawVisitaOpt as VisitaAvulsaOption)
    : null;

  const rawHouseCond = asString(input.houseCondition);
  const houseCondition = VALID_CONDITIONS.has(rawHouseCond as HouseCondition)
    ? (rawHouseCond as HouseCondition)
    : null;

  const rawPets = asString(input.petsOption);
  const petsOption = VALID_PETS.has(rawPets as PetsOption)
    ? (rawPets as PetsOption)
    : null;

  const houseLabel = asString(input.houseLabel, '2 quartos, 2 banheiros');

  const lastOutboundAt =
    input.lastOutboundAt === null
      ? null
      : typeof input.lastOutboundAt === 'string'
      ? input.lastOutboundAt
      : stage === 'Novo'
      ? null
      : createdAt;

  const lastInboundAt =
    typeof input.lastInboundAt === 'string' ? input.lastInboundAt : null;

  const firstOutboundAt =
    input.firstOutboundAt === null
      ? null
      : typeof input.firstOutboundAt === 'string'
      ? input.firstOutboundAt
      : lastOutboundAt;

  const firstInboundAt =
    input.firstInboundAt === null
      ? null
      : typeof input.firstInboundAt === 'string'
      ? input.firstInboundAt
      : lastInboundAt;

  return {
    id,
    createdAt,
    clientName: asString(input.clientName, 'Lead sem nome') || 'Lead sem nome',
    phone: asString(input.phone),
    email: asString(input.email),
    streetAddress: asString(input.streetAddress),
    zipCode: asString(input.zipCode),
    city: asString(input.city),
    desiredDate: asString(input.desiredDate),
    bestContact: asString(input.bestContact),
    origin,
    adCode: asString(input.adCode),
    notes: asString(input.notes),
    squareFeet:
      typeof input.squareFeet === 'number' && Number.isFinite(input.squareFeet)
        ? input.squareFeet
        : null,
    houseLabel,
    effectiveHouseLabel: asString(input.effectiveHouseLabel, houseLabel),
    serviceType,
    frequency,
    visitaAvulsaOption,
    houseCondition,
    petsOption,
    tablePricePrimary: Math.max(0, Number(input.tablePricePrimary) || 0),
    promoPercent:
      typeof input.promoPercent === 'number' &&
      Number.isFinite(input.promoPercent)
        ? input.promoPercent
        : null,
    promoName: asString(input.promoName),
    finalPricePrimary: Math.max(0, Number(input.finalPricePrimary) || 0),
    tablePriceRecurring:
      typeof input.tablePriceRecurring === 'number' &&
      Number.isFinite(input.tablePriceRecurring)
        ? input.tablePriceRecurring
        : null,
    finalPriceRecurring:
      typeof input.finalPriceRecurring === 'number' &&
      Number.isFinite(input.finalPriceRecurring)
        ? input.finalPriceRecurring
        : null,
    aiConfidence:
      typeof input.aiConfidence === 'number' &&
      Number.isFinite(input.aiConfidence)
        ? input.aiConfidence
        : null,
    aiEstado: VALID_CONDITIONS.has(asString(input.aiEstado) as HouseCondition)
      ? (asString(input.aiEstado) as HouseCondition)
      : null,
    status,
    lossReason: asString(input.lossReason),
    stage,
    objection,
    concession: sanitizeConcession(input.concession),
    followUpStep,
    nextFollowUpDate:
      input.nextFollowUpDate === null
        ? null
        : typeof input.nextFollowUpDate === 'string'
        ? input.nextFollowUpDate
        : stage === 'Novo'
        ? createdDateKey
        : stage === 'Aguardando fotos' ||
          stage === 'Orçamento enviado' ||
          stage === 'Objeção' ||
          stage === 'Sem resposta'
        ? addDaysToDateString(createdDateKey, 2)
        : null,
    firstOutboundAt,
    firstInboundAt,
    lastOutboundAt,
    lastInboundAt,
    consecutiveOutboundCount:
      typeof input.consecutiveOutboundCount === 'number' &&
      Number.isFinite(input.consecutiveOutboundCount)
        ? Math.max(0, input.consecutiveOutboundCount)
        : stage === 'Novo'
        ? 0
        : 1,
    blockedUntilDate:
      typeof input.blockedUntilDate === 'string'
        ? input.blockedUntilDate
        : null,
    hibernateUntilDate:
      typeof input.hibernateUntilDate === 'string'
        ? input.hibernateUntilDate
        : null,
    priceAlreadySent:
      typeof input.priceAlreadySent === 'boolean'
        ? input.priceAlreadySent
        : stage !== 'Novo',
    lastGeneratedMessage: rawMsg,
    interactionHistory: sanitizeInteractionHistory(input.interactionHistory),
    mapsInsight: sanitizeMapsInsight(input.mapsInsight),
    dayOption1: asString(input.dayOption1, 'Tuesday') || 'Tuesday',
    dayOption2: asString(input.dayOption2, 'Thursday') || 'Thursday',
  };
}

export function loadQuoteHistory(): LeadQuoteRecord[] {
  try {
    for (const legacyKey of LEGACY_HISTORY_STORAGE_KEYS) {
      safeRemoveKey(legacyKey);
    }

    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        isPlainObject(parsed) &&
        parsed.version === HISTORY_DATA_VERSION &&
        Array.isArray(parsed.records)
      ) {
        return parsed.records
          .map((item) => normalizeQuoteRecord(item))
          .filter((item): item is LeadQuoteRecord => item !== null);
      }
      safeRemoveKey(HISTORY_STORAGE_KEY);
    }

    // Migração segura v3 -> v4 preservando histórico
    const rawV3 = window.localStorage.getItem(MIGRATABLE_HISTORY_STORAGE_KEY_V3);
    if (rawV3) {
      const parsedV3 = JSON.parse(rawV3) as unknown;
      if (
        isPlainObject(parsedV3) &&
        parsedV3.version === 3 &&
        Array.isArray(parsedV3.records)
      ) {
        const migrated = parsedV3.records
          .map((item) => normalizeQuoteRecord(item))
          .filter((item): item is LeadQuoteRecord => item !== null);
        saveQuoteHistory(migrated);
        safeRemoveKey(MIGRATABLE_HISTORY_STORAGE_KEY_V3);
        return migrated;
      }
      safeRemoveKey(MIGRATABLE_HISTORY_STORAGE_KEY_V3);
    }

    return [];
  } catch {
    safeRemoveKey(HISTORY_STORAGE_KEY);
    return [];
  }
}

export function saveQuoteHistory(records: LeadQuoteRecord[]): void {
  safeSetItem(
    HISTORY_STORAGE_KEY,
    JSON.stringify({
      version: HISTORY_DATA_VERSION,
      records,
    })
  );
}

export function sanitizeHelpersList(rawList: unknown): PotentialHelperRecord[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((h): h is Record<string, unknown> => isPlainObject(h) && Boolean(asString(h.id)))
    .map((h) => ({
      id: asString(h.id),
      name: asString(h.name, 'Sem nome'),
      phone: asString(h.phone),
      email: asString(h.email),
      city: asString(h.city),
      notes: asString(h.notes),
      savedAt: asString(h.savedAt, new Date().toISOString()),
      sourceLeadId: typeof h.sourceLeadId === 'string' ? h.sourceLeadId : undefined,
      isTeam: h.isTeam === true,
      serviceCities: Array.isArray(h.serviceCities)
        ? h.serviceCities
            .filter((c): c is string => typeof c === 'string')
            .map((c) => c.trim())
            .filter(Boolean)
            .slice(0, 30)
        : [],
      availableWeekdays: Array.isArray(h.availableWeekdays)
        ? Array.from(
            new Set(
              h.availableWeekdays.filter(
                (d): d is number => Number.isInteger(d) && d >= 0 && d <= 6
              )
            )
          ).sort()
        : [],
    }));
}

export function loadPotentialHelpers(): PotentialHelperRecord[] {
  try {
    const raw = window.localStorage.getItem(HELPERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const rawList =
      isPlainObject(parsed) &&
      parsed.version === HELPERS_DATA_VERSION &&
      Array.isArray(parsed.helpers)
        ? parsed.helpers
        : Array.isArray(parsed)
        ? parsed
        : null;

    if (!rawList) {
      safeRemoveKey(HELPERS_STORAGE_KEY);
      return [];
    }

    return sanitizeHelpersList(rawList);
  } catch {
    safeRemoveKey(HELPERS_STORAGE_KEY);
    return [];
  }
}

export function savePotentialHelpers(helpers: PotentialHelperRecord[]): void {
  safeSetItem(
    HELPERS_STORAGE_KEY,
    JSON.stringify({
      version: HELPERS_DATA_VERSION,
      helpers,
    })
  );
}

export function loadLastBackupAt(): string | null {
  try {
    const raw = window.localStorage.getItem(LAST_BACKUP_STORAGE_KEY);
    if (!raw) return null;
    const dt = new Date(raw);
    return Number.isNaN(dt.getTime()) ? null : raw;
  } catch {
    return null;
  }
}

export function saveLastBackupAt(isoString: string): void {
  safeSetItem(LAST_BACKUP_STORAGE_KEY, isoString);
}

export function isBackupOverdue(lastBackupAt: string | null, daysThreshold = 7): boolean {
  if (!lastBackupAt) return true;
  const ts = new Date(lastBackupAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > daysThreshold * 24 * 60 * 60 * 1000;
}

export function buildBackupPayload(
  pricingConfig: PricingConfig,
  history: LeadQuoteRecord[],
  helpers: PotentialHelperRecord[]
): AppBackupPayload {
  return {
    app: 'Dany Clean Pro',
    backupVersion: 1,
    exportedAt: new Date().toISOString(),
    pricingConfig,
    history,
    helpers,
  };
}

export function parseAndValidateBackupPayload(rawJson: string): {
  pricingConfig: PricingConfig;
  history: LeadQuoteRecord[];
  helpers: PotentialHelperRecord[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('O arquivo selecionado não é um JSON válido.');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Formato de backup inválido.');
  }

  const upgradedConfig = upgradePricingConfig(parsed.pricingConfig);
  if (!upgradedConfig) {
    throw new Error(
      'As configurações de preço no arquivo de backup estão incompletas ou incompatíveis.'
    );
  }

  if (!Array.isArray(parsed.history)) {
    throw new Error('Histórico de leads não encontrado no arquivo de backup.');
  }

  const normalizedHistory = parsed.history
    .map((item) => normalizeQuoteRecord(item))
    .filter((item): item is LeadQuoteRecord => item !== null);

  const normalizedHelpers = sanitizeHelpersList(parsed.helpers ?? []);

  return {
    pricingConfig: upgradedConfig,
    history: normalizedHistory,
    helpers: normalizedHelpers,
  };
}

export function clearAllSavedAppStorage(): void {
  for (const key of [
    PRICING_STORAGE_KEY,
    HISTORY_STORAGE_KEY,
    HELPERS_STORAGE_KEY,
    LAST_BACKUP_STORAGE_KEY,
    'dany_clean_pro_reminders_sent_v1',
    MIGRATABLE_PRICING_STORAGE_KEY_V3,
    MIGRATABLE_HISTORY_STORAGE_KEY_V3,
    ...LEGACY_PRICING_STORAGE_KEYS,
    ...LEGACY_HISTORY_STORAGE_KEYS,
  ]) {
    safeRemoveKey(key);
  }
}

export async function fileToCompressedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem.'));
    reader.onload = () => {
      const result = reader.result as string;
      const img = new Image();
      img.onerror = () => resolve(result);
      img.onload = () => {
        const maxDim = 1024;
        let { width, height } = img;
        if (!width || !height) {
          resolve(result);
          return;
        }
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(result);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        let compressed = canvas.toDataURL('image/jpeg', 0.78);
        if (compressed.length > 480_000) {
          compressed = canvas.toDataURL('image/jpeg', 0.62);
        }
        resolve(compressed);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}
