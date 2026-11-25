import {
  ConcessionRecord,
  FollowUpStep,
  LeadOrigin,
  LeadQuoteRecord,
  NegotiationStage,
  ObjectionType,
  PricingConfig,
  SeasonalPromoConfig,
} from '../types/pricing';
import { LEAD_ORIGIN_OPTIONS, OBJECTION_OPTIONS } from '../data/defaultPricing';
import { roundToNearest5 } from './pricingEngine';

export function getLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return getLocalDateString(dt);
}

export function formatDateBr(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('pt-BR');
}

export function formatDateEnShort(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function isSeasonalPromoValid(promo: SeasonalPromoConfig): boolean {
  if (!promo.active || !promo.name.trim() || promo.percent <= 0) {
    return false;
  }
  if (!promo.expiresAt) return true;
  const today = getLocalDateString();
  return promo.expiresAt >= today;
}

export function computeNegotiationPrices(
  lead: LeadQuoteRecord,
  config: PricingConfig
): {
  idealPrice: number;
  competitivePrice: number;
  minimumPrice: number;
} {
  const idealPrice = Math.max(0, lead.tablePricePrimary || 0);
  if (lead.serviceType === 'visita_avulsa') {
    const floor =
      lead.visitaAvulsaOption === 'so_janelas'
        ? config.visitaAvulsa.soJanelasMinimo
        : idealPrice;
    return {
      idealPrice,
      competitivePrice: idealPrice,
      minimumPrice: Math.min(idealPrice, floor),
    };
  }

  const compPct = Math.min(
    50,
    Math.max(0, config.negotiation.competitiveDiscountPercent || 10)
  );
  const minPct = Math.min(
    60,
    Math.max(compPct, config.negotiation.minimumFloorPercent || 20)
  );

  const minimumPrice = Math.max(
    50,
    roundToNearest5(idealPrice * (1 - minPct / 100))
  );
  const rawCompetitive = roundToNearest5(idealPrice * (1 - compPct / 100));
  const competitivePrice = Math.max(minimumPrice, rawCompetitive);

  return {
    idealPrice,
    competitivePrice,
    minimumPrice,
  };
}

function normalizePhone(phone: string | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

export function findClientConcession(
  lead: LeadQuoteRecord,
  allLeads: LeadQuoteRecord[]
): ConcessionRecord | null {
  if (lead.concession) return lead.concession;

  const phone = normalizePhone(lead.phone);
  const email = (lead.email ?? '').trim().toLowerCase();
  const name = lead.clientName.trim().toLowerCase();

  for (const other of allLeads) {
    if (!other.concession) continue;
    if (other.id === lead.id) return other.concession;

    const otherPhone = normalizePhone(other.phone);
    const otherEmail = (other.email ?? '').trim().toLowerCase();
    const otherName = other.clientName.trim().toLowerCase();

    if (phone && otherPhone && phone === otherPhone) return other.concession;
    if (email && otherEmail && email === otherEmail) return other.concession;
    if (
      name &&
      name !== 'lead sem nome' &&
      otherName === name &&
      other.city.trim().toLowerCase() === lead.city.trim().toLowerCase()
    ) {
      return other.concession;
    }
  }

  return null;
}

export function isTerminalStage(stage: NegotiationStage): boolean {
  return stage === 'Agendado' || stage === 'Cliente fixo' || stage === 'Perdido';
}

export function getMinutesSinceCreated(createdAt: string): number {
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

export function isLeadDueToday(lead: LeadQuoteRecord): boolean {
  if (isTerminalStage(lead.stage)) return false;

  const today = getLocalDateString();

  if (lead.stage === 'Hibernar') {
    return Boolean(lead.hibernateUntilDate && lead.hibernateUntilDate <= today);
  }

  if (lead.blockedUntilDate && lead.blockedUntilDate > today) {
    return false;
  }

  if (lead.stage === 'Novo') {
    return true;
  }

  if (lead.nextFollowUpDate && lead.nextFollowUpDate <= today) {
    return true;
  }

  return false;
}

export function evaluateSendPermission(lead: LeadQuoteRecord): {
  canSend: boolean;
  blockReason: string | null;
  needsReplyFirst: boolean;
  inEuTeAvisoCooldown: boolean;
} {
  if (isTerminalStage(lead.stage)) {
    return {
      canSend: true,
      blockReason: null,
      needsReplyFirst: false,
      inEuTeAvisoCooldown: false,
    };
  }

  const today = getLocalDateString();

  // Regra: depois de "Eu te aviso", nenhuma mensagem antes de 2 dias
  if (lead.blockedUntilDate && lead.blockedUntilDate > today) {
    return {
      canSend: false,
      blockReason: `Bloqueado até ${formatDateBr(lead.blockedUntilDate)} — regra: depois de "Eu te aviso", nenhuma mensagem antes de 2 dias.`,
      needsReplyFirst: false,
      inEuTeAvisoCooldown: true,
    };
  }

  // Regra: nunca duas mensagens seguidas sem resposta da cliente no mesmo dia/etapa
  const lastOutboundDate = lead.lastOutboundAt
    ? getLocalDateString(new Date(lead.lastOutboundAt))
    : null;
  const clientRepliedAfterOutbound =
    Boolean(lead.lastInboundAt) &&
    (!lead.lastOutboundAt ||
      new Date(lead.lastInboundAt!).getTime() >
        new Date(lead.lastOutboundAt).getTime());

  if (
    lead.consecutiveOutboundCount >= 1 &&
    !clientRepliedAfterOutbound &&
    (lastOutboundDate === today ||
      (lead.nextFollowUpDate !== null && lead.nextFollowUpDate > today))
  ) {
    const nextDateLabel = lead.nextFollowUpDate
      ? ` ou aguarde o follow-up em ${formatDateBr(lead.nextFollowUpDate)}`
      : '';
    return {
      canSend: false,
      blockReason: `Aguardando resposta da cliente (nunca enviar duas mensagens seguidas sem resposta). Registre "Cliente respondeu"${nextDateLabel}.`,
      needsReplyFirst: true,
      inEuTeAvisoCooldown: false,
    };
  }

  return {
    canSend: true,
    blockReason: null,
    needsReplyFirst: false,
    inEuTeAvisoCooldown: false,
  };
}

export function getNextFollowUpAfterStep(
  currentStep: FollowUpStep,
  today: string,
  defaultHibernateDate: string,
  objection: ObjectionType | null
): {
  nextStep: FollowUpStep;
  nextDate: string | null;
  nextStage: NegotiationStage | null;
  blockedUntilDate: string | null;
  hibernateUntilDate: string | null;
} {
  if (objection === 'eu_te_aviso') {
    const day2Date = addDaysToDateString(today, 2);
    return {
      nextStep: 2,
      nextDate: day2Date,
      nextStage: 'Objeção',
      blockedUntilDate: day2Date,
      hibernateUntilDate: null,
    };
  }

  if (currentStep === 0) {
    return {
      nextStep: 2,
      nextDate: addDaysToDateString(today, 2),
      nextStage: 'Sem resposta',
      blockedUntilDate: null,
      hibernateUntilDate: null,
    };
  }

  if (currentStep === 2) {
    return {
      nextStep: 5,
      nextDate: addDaysToDateString(today, 3), // Dia 5 a partir do Dia 2
      nextStage: 'Sem resposta',
      blockedUntilDate: null,
      hibernateUntilDate: null,
    };
  }

  if (currentStep === 5) {
    return {
      nextStep: 10,
      nextDate: addDaysToDateString(today, 5), // Dia 10 a partir do Dia 5
      nextStage: 'Sem resposta',
      blockedUntilDate: null,
      hibernateUntilDate: null,
    };
  }

  // Após Dia 10 -> Hibernar até a próxima temporada
  return {
    nextStep: 'hibernar',
    nextDate: null,
    nextStage: 'Hibernar',
    blockedUntilDate: null,
    hibernateUntilDate: defaultHibernateDate || addDaysToDateString(today, 90),
  };
}

export function checkNameMismatch(
  clientName: string,
  englishMessage: string
): {
  hasMismatch: boolean;
  detectedName: string | null;
  expectedFirstName: string;
} {
  const trimmedName = clientName.trim();
  if (!trimmedName || trimmedName.toLowerCase() === 'lead sem nome') {
    return { hasMismatch: false, detectedName: null, expectedFirstName: '' };
  }

  const expectedFirstName = trimmedName.split(/\s+/)[0] || '';
  const greetingMatch = englishMessage.match(
    /\b(?:Hi|Hello|Hey|Dear)\s+([A-Z][a-zA-ZÀ-ÿ'-]+)/
  );

  if (!greetingMatch) {
    return { hasMismatch: false, detectedName: null, expectedFirstName };
  }

  const detectedName = greetingMatch[1];
  const ignoredWords = new Set(['there', 'friend', 'neighbor', 'everyone']);
  if (ignoredWords.has(detectedName.toLowerCase())) {
    return {
      hasMismatch: true,
      detectedName,
      expectedFirstName,
    };
  }

  const hasMismatch =
    detectedName.toLowerCase() !== expectedFirstName.toLowerCase();

  return { hasMismatch, detectedName, expectedFirstName };
}

export function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

const EMOJI_REGEX = /[\p{Extended_Pictographic}\u{FE0F}]/u;

export function validateSimplePunctuation(text: string): string[] {
  const issues: string[] = [];
  if (!text.trim()) return issues;

  if (/\*\*|__/.test(text)) {
    issues.push('Contém formatação em negrito (** ou __), proibida em mensagens de celular.');
  } else if (/\*/.test(text)) {
    issues.push('Contém asterisco (*), proibido nas mensagens.');
  }

  if (/[—–]/.test(text)) {
    issues.push('Contém travessão (— ou –). Use apenas ponto ou vírgula.');
  }

  if (/[•◦▪]/.test(text) || /(?:^|\n)\s*[-*•◦▪]\s+/.test(text)) {
    issues.push('Contém marcador ou formato de lista. Use texto corrido.');
  }

  if (/\.{3}|…/.test(text)) {
    issues.push('Contém reticências (... ou …), proibidas nas mensagens.');
  }

  if (/#/.test(text)) {
    issues.push('Contém hashtag (#), proibida nas mensagens.');
  }

  if (EMOJI_REGEX.test(text)) {
    issues.push('Contém emoji, proibido nas mensagens.');
  }

  const exclamationCount = (text.match(/!/g) || []).length;
  if (exclamationCount > 1) {
    issues.push('Máximo de 1 ponto de exclamação (!) na mensagem inteira.');
  }

  return issues;
}

export function validateNegotiationCompliance(englishMessage: string): {
  wordCount: number;
  violations: string[];
} {
  const wordCount = countWords(englishMessage);
  const violations: string[] = [];

  if (wordCount > 60) {
    violations.push(`Mensagem com ${wordCount} palavras (máximo permitido: 60).`);
  }

  violations.push(...validateSimplePunctuation(englishMessage));

  const questionCount = (englishMessage.match(/\?/g) || []).length;
  if (questionCount > 1) {
    violations.push('Use apenas uma única pergunta no final da mensagem.');
  }

  if (/\b(licensed|insured|bonded|background[-\s]?checked)\b/i.test(englishMessage)) {
    violations.push('Contém termo proibido (licensed / insured / bonded / background-checked).');
  }

  if (/\b\d+\s*\+?\s*(reviews?|stars?|years?(\s+of\s+experience)?)\b/i.test(englishMessage)) {
    violations.push('Cita quantidade de avaliações ou anos de experiência.');
  }

  if (/\bup\s+to\b/i.test(englishMessage) || /\baté\s+\d+\s*%/i.test(englishMessage)) {
    violations.push('Contém "up to" ou "até X%". Todo desconto deve ter valor exato em $ e data limite.');
  }

  if (
    /\b(i\s+clean\s+every\s+home\s+myself|personally\s+clean|clean\s+it\s+myself|dany\s+cleans?\s+every)\b/i.test(
      englishMessage
    )
  ) {
    violations.push('Evite prometer que a Dani limpa pessoalmente todas as casas.');
  }

  if (
    /\b(same\s+(trusted\s+)?(person|team|cleaner)|never\s+a\s+stranger)\b/i.test(
      englishMessage
    )
  ) {
    violations.push('Evite prometer a mesma pessoa ou mesma equipe em toda visita.');
  }

  if (
    /\b(i\s+hope\s+this\s+(message\s+)?finds\s+you\s+well|certainly|i'd\s+be\s+delighted|i\s+would\s+be\s+delighted|please\s+don't\s+hesitate)\b/i.test(
      englishMessage
    )
  ) {
    violations.push('Contém frase automática/robótica. Prefira tom natural de celular.');
  }

  if (/\bbiweekly\b/i.test(englishMessage)) {
    violations.push('Troque "biweekly" por "every other week".');
  }

  if (/\bwe\s+have\s+openings?\b/i.test(englishMessage)) {
    violations.push('Use primeira pessoa ("I have an opening"), nunca "We have openings".');
  }

  if (/\b(?:which|what)\s+day\s+works\s+best\b/i.test(englishMessage)) {
    violations.push('Proibido pergunta aberta de dia. Termine com duas datas específicas e "Which works better for you?".');
  }

  return { wordCount, violations };
}

export interface ObjectionAnalyticsRow {
  objection: ObjectionType;
  label: string;
  total: number;
  won: number;
  lost: number;
  closingRate: number;
}

export interface LossReasonRow {
  reason: string;
  count: number;
  percent: number;
}

export interface NegotiationAnalytics {
  byObjection: ObjectionAnalyticsRow[];
  lossReasons: LossReasonRow[];
  totalConcessionsUsed: number;
  concessionsByType: Record<'valor' | 'preco' | 'sazonal' | 'pacote_2h', number>;
  closedCount: number;
  avgClosedPrice: number;
  avgIdealPriceOnClosed: number;
  diffFromIdealDollar: number;
  diffFromIdealPercent: number;
}

export function computeNegotiationAnalytics(
  leads: LeadQuoteRecord[]
): NegotiationAnalytics {
  const byObjection: ObjectionAnalyticsRow[] = OBJECTION_OPTIONS.map((meta) => {
    const matching = leads.filter((l) => l.objection === meta.id);
    const won = matching.filter(
      (l) =>
        l.stage === 'Agendado' ||
        l.stage === 'Cliente fixo' ||
        l.status === 'Fechou'
    ).length;
    const lost = matching.filter(
      (l) => l.stage === 'Perdido' || l.status === 'Perdeu'
    ).length;
    const closingRate =
      matching.length > 0 ? Math.round((won / matching.length) * 100) : 0;

    return {
      objection: meta.id,
      label: meta.label,
      total: matching.length,
      won,
      lost,
      closingRate,
    };
  });

  const lostLeads = leads.filter(
    (l) => l.stage === 'Perdido' || l.status === 'Perdeu'
  );
  const reasonMap = new Map<string, number>();
  for (const l of lostLeads) {
    const key = l.lossReason.trim() || 'Motivo não informado';
    reasonMap.set(key, (reasonMap.get(key) ?? 0) + 1);
  }
  const lossReasons: LossReasonRow[] = Array.from(reasonMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({
      reason,
      count,
      percent:
        lostLeads.length > 0 ? Math.round((count / lostLeads.length) * 100) : 0,
    }));

  const concessionsByType = {
    valor: 0,
    preco: 0,
    sazonal: 0,
    pacote_2h: 0,
  };
  let totalConcessionsUsed = 0;
  for (const l of leads) {
    if (l.concession) {
      totalConcessionsUsed++;
      concessionsByType[l.concession.type]++;
    }
  }

  const closedLeads = leads.filter(
    (l) =>
      l.stage === 'Agendado' ||
      l.stage === 'Cliente fixo' ||
      l.status === 'Fechou'
  );

  const avgClosedPrice =
    closedLeads.length > 0
      ? Math.round(
          closedLeads.reduce((acc, l) => acc + l.finalPricePrimary, 0) /
            closedLeads.length
        )
      : 0;
  const avgIdealPriceOnClosed =
    closedLeads.length > 0
      ? Math.round(
          closedLeads.reduce((acc, l) => acc + l.tablePricePrimary, 0) /
            closedLeads.length
        )
      : 0;

  const diffFromIdealDollar = avgClosedPrice - avgIdealPriceOnClosed;
  const diffFromIdealPercent =
    avgIdealPriceOnClosed > 0
      ? Math.round((diffFromIdealDollar / avgIdealPriceOnClosed) * 100)
      : 0;

  return {
    byObjection,
    lossReasons,
    totalConcessionsUsed,
    concessionsByType,
    closedCount: closedLeads.length,
    avgClosedPrice,
    avgIdealPriceOnClosed,
    diffFromIdealDollar,
    diffFromIdealPercent,
  };
}

export interface MeasurementSummaryRow {
  key: string;
  label: string;
  leadsCount: number;
  respondedCount: number;
  respondedRate: number;
  closedCount: number;
  closedRate: number;
  avgFirstResponseMinutes: number | null;
}

export interface TestMeasurementMetrics {
  totalLeads: number;
  totalResponded: number;
  totalClosed: number;
  overallAvgFirstResponseMinutes: number | null;
  byWeek: MeasurementSummaryRow[];
  byOrigin: MeasurementSummaryRow[];
  byFacebookAdCode: MeasurementSummaryRow[];
}

function getWeekStartDateKey(isoStr: string): string {
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return '';
  const day = dt.getDay(); // 0=Dom..6=Sáb
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + diffToMonday);
  return getLocalDateString(monday);
}

function formatWeekLabel(mondayKey: string): string {
  if (!mondayKey) return 'Sem data';
  const sundayKey = addDaysToDateString(mondayKey, 6);
  const startParts = mondayKey.split('-');
  const endParts = sundayKey.split('-');
  return `${startParts[2]}/${startParts[1]} – ${endParts[2]}/${endParts[1]}`;
}

export function formatResponseMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function didLeadRespond(lead: LeadQuoteRecord): boolean {
  if (lead.firstInboundAt || lead.lastInboundAt) return true;
  if (lead.objection !== null) return true;
  if (
    lead.interactionHistory &&
    lead.interactionHistory.some(
      (entry) =>
        entry.kind === 'copilot_turn' ||
        entry.kind === 'client_note' ||
        (!entry.kind && Boolean(entry.clientMessageEn?.trim()))
    )
  ) {
    return true;
  }
  if (
    lead.stage === 'Agendado' ||
    lead.stage === 'Cliente fixo' ||
    lead.status === 'Fechou'
  ) {
    return true;
  }
  return false;
}

function isLeadClosed(lead: LeadQuoteRecord): boolean {
  return (
    lead.stage === 'Agendado' ||
    lead.stage === 'Cliente fixo' ||
    lead.status === 'Fechou'
  );
}

function getFirstResponseMinutes(lead: LeadQuoteRecord): number | null {
  const outboundIso = lead.firstOutboundAt ?? lead.lastOutboundAt;
  if (!outboundIso) return null;
  const createdMs = new Date(lead.createdAt).getTime();
  const outboundMs = new Date(outboundIso).getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(outboundMs)) return null;
  return Math.max(0, Math.round((outboundMs - createdMs) / 60000));
}

function summarizeGroup(
  key: string,
  label: string,
  items: LeadQuoteRecord[]
): MeasurementSummaryRow {
  const leadsCount = items.length;
  const respondedCount = items.filter(didLeadRespond).length;
  const closedCount = items.filter(isLeadClosed).length;
  const responseTimes = items
    .map(getFirstResponseMinutes)
    .filter((v): v is number => v !== null);
  const avgFirstResponseMinutes =
    responseTimes.length > 0
      ? Math.round(
          responseTimes.reduce((acc, v) => acc + v, 0) / responseTimes.length
        )
      : null;

  return {
    key,
    label,
    leadsCount,
    respondedCount,
    respondedRate:
      leadsCount > 0 ? Math.round((respondedCount / leadsCount) * 100) : 0,
    closedCount,
    closedRate:
      leadsCount > 0 ? Math.round((closedCount / leadsCount) * 100) : 0,
    avgFirstResponseMinutes,
  };
}

export function computeTestMeasurements(
  leads: LeadQuoteRecord[]
): TestMeasurementMetrics {
  const overall = summarizeGroup('all', 'Todos', leads);

  const weekBuckets = new Map<string, LeadQuoteRecord[]>();
  for (const lead of leads) {
    const wk = getWeekStartDateKey(lead.createdAt) || 'sem-data';
    const arr = weekBuckets.get(wk) ?? [];
    arr.push(lead);
    weekBuckets.set(wk, arr);
  }
  const byWeek: MeasurementSummaryRow[] = Array.from(weekBuckets.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 8)
    .map(([wk, arr]) =>
      summarizeGroup(wk, wk === 'sem-data' ? 'Sem data' : formatWeekLabel(wk), arr)
    );

  const originBuckets = new Map<string, LeadQuoteRecord[]>();
  for (const origin of LEAD_ORIGIN_OPTIONS) {
    originBuckets.set(origin, []);
  }
  const unspecified: LeadQuoteRecord[] = [];
  for (const lead of leads) {
    const org = (lead.origin || '').trim() as LeadOrigin | '';
    if (org && originBuckets.has(org)) {
      originBuckets.get(org)!.push(lead);
    } else {
      unspecified.push(lead);
    }
  }

  const byOrigin: MeasurementSummaryRow[] = Array.from(originBuckets.entries())
    .filter(([, arr]) => arr.length > 0)
    .map(([org, arr]) => summarizeGroup(org, org, arr));
  if (unspecified.length > 0) {
    byOrigin.push(summarizeGroup('nao_informada', 'Sem origem informada', unspecified));
  }
  byOrigin.sort((a, b) => b.leadsCount - a.leadsCount);

  // Sub-agrupamento por código de anúncio do Facebook
  const adCodeBuckets = new Map<string, LeadQuoteRecord[]>();
  for (const lead of leads) {
    if (lead.origin === 'Facebook' && lead.adCode && lead.adCode.trim()) {
      const code = lead.adCode.trim().toUpperCase();
      const arr = adCodeBuckets.get(code) ?? [];
      arr.push(lead);
      adCodeBuckets.set(code, arr);
    }
  }
  const byFacebookAdCode: MeasurementSummaryRow[] = Array.from(
    adCodeBuckets.entries()
  )
    .sort((a, b) => b[1].length - a[1].length)
    .map(([code, arr]) => summarizeGroup(code, `Facebook · ${code}`, arr));

  return {
    totalLeads: overall.leadsCount,
    totalResponded: overall.respondedCount,
    totalClosed: overall.closedCount,
    overallAvgFirstResponseMinutes: overall.avgFirstResponseMinutes,
    byWeek,
    byOrigin,
    byFacebookAdCode,
  };
}
