import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Calendar,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  Lock,
  MessageSquareReply,
  Send,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import {
  CONCESSION_EXCHANGE_OPTIONS,
  FOLLOW_UP_STEPS_INFO,
  FREQUENCY_LABELS,
  LOSS_REASONS_SUGGESTIONS,
  NEGOTIATION_STAGES,
  OBJECTION_OPTIONS,
  SERVICE_TYPE_LABELS,
  VALUE_CONCESSION_SUGGESTIONS,
  VISITA_AVULSA_LABELS,
} from '../data/defaultPricing';
import {
  ConcessionExchangeCondition,
  ConcessionRecord,
  ConcessionType,
  FollowUpStep,
  LeadInteractionEntry,
  LeadQuoteRecord,
  MapsRouteInsight,
  NegotiationStage,
  ObjectionType,
  PricingConfig,
} from '../types/pricing';
import { apiFetch } from '../utils/apiClient';
import { resolveDateOptionsForCity } from '../utils/dateOptions';
import {
  CalendarWorkspaceBridge,
  countEventsByDateKey,
  evaluateCalendarSlotAvailability,
} from '../utils/googleCalendarApi';
import { isCityInServedList } from '../utils/messageBuilder';
import { ConversationThreadPanel } from './ConversationThreadPanel';
import { GoogleSignInButton } from './GoogleSignInButton';
import { LeadCalendarModal } from './LeadCalendarModal';
import { LeadMapsPanel } from './LeadMapsPanel';
import {
  addDaysToDateString,
  checkNameMismatch,
  computeNegotiationPrices,
  evaluateSendPermission,
  findClientConcession,
  formatDateBr,
  formatDateEnShort,
  getLocalDateString,
  getMinutesSinceCreated,
  getNextFollowUpAfterStep,
  isSeasonalPromoValid,
  validateNegotiationCompliance,
  validatePortugueseCompliance,
} from '../utils/negotiationEngine';
import { resolveLeadPricingFromEngine } from '../utils/pricingEngine';

interface NegotiationWorkspaceProps {
  lead: LeadQuoteRecord;
  allLeads: LeadQuoteRecord[];
  config: PricingConfig;
  mapsApiKey: string;
  isHelperSaved: boolean;
  onBack: () => void;
  onUpdateLead: (updated: LeadQuoteRecord) => void;
  onSavePotentialHelper: (lead: LeadQuoteRecord) => void;
  onDeleteLead: (id: string) => void;
  calendarIntegration: CalendarWorkspaceBridge;
}

const STAGE_BADGE_CLASSES: Record<NegotiationStage, string> = {
  Novo: 'bg-sky-50 text-sky-800 border-sky-200',
  'Aguardando fotos': 'bg-indigo-50 text-indigo-800 border-indigo-200',
  'Orçamento enviado': 'bg-[#EAF4F6] text-[#0B6273] border-[#0B6273]/30',
  Objeção: 'bg-amber-50 text-amber-800 border-amber-300',
  'Sem resposta': 'bg-orange-50 text-orange-800 border-orange-200',
  Agendado: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'Cliente fixo': 'bg-emerald-100 text-emerald-900 border-emerald-300',
  Perdido: 'bg-red-50 text-red-700 border-red-200',
  Hibernar: 'bg-slate-100 text-slate-700 border-slate-300',
};

export const NegotiationWorkspace: React.FC<NegotiationWorkspaceProps> = ({
  lead,
  allLeads,
  config,
  mapsApiKey,
  isHelperSaved,
  onBack,
  onUpdateLead,
  onSavePotentialHelper,
  calendarIntegration,
}) => {
  const today = getLocalDateString();
  const resolvedPricing = useMemo(
    () => resolveLeadPricingFromEngine(lead, config),
    [lead, config]
  );
  const { idealPrice, competitivePrice, minimumPrice } =
    computeNegotiationPrices(lead, config);
  const existingClientConcession = findClientConcession(lead, allLeads);
  const seasonalPromoValid = isSeasonalPromoValid(
    config.negotiation.seasonalPromo
  );

  // Estado local para formulário de concessão
  const [concessionTab, setConcessionTab] = useState<ConcessionType>('valor');
  const [valueDesc, setValueDesc] = useState(
    VALUE_CONCESSION_SUGGESTIONS[0].label
  );
  const [valueDollar, setValueDollar] = useState(
    String(VALUE_CONCESSION_SUGGESTIONS[0].defaultDollar)
  );
  const [proposedPrice, setProposedPrice] = useState(String(competitivePrice));
  const [exchangeCondition, setExchangeCondition] =
    useState<ConcessionExchangeCondition>('Fechar quinzenal');
  const [deadlineDate, setDeadlineDate] = useState(() =>
    addDaysToDateString(today, 3)
  );
  const concessionsRef = useRef<HTMLElement | null>(null);
  const [concessionError, setConcessionError] = useState<string | null>(null);
  const [concessionSavedNotice, setConcessionSavedNotice] = useState(false);

  // Estado do gerador Gemini (Follow-ups proativos)
  const [englishMsg, setEnglishMsg] = useState(
    lead.lastGeneratedMessage?.english ?? ''
  );
  const [portugueseMsg, setPortugueseMsg] = useState(
    lead.lastGeneratedMessage?.portuguese ?? ''
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sentFeedback, setSentFeedback] = useState<string | null>(null);
  const [calendarModalDateKey, setCalendarModalDateKey] = useState<
    string | null
  >(null);
  const [calendarScheduledMsg, setCalendarScheduledMsg] = useState<
    string | null
  >(null);

  const resolvedSuggestedDates = useMemo(
    () =>
      resolveDateOptionsForCity(
        lead.city,
        config.cityFixedDays,
        lead.dayOption1 || config.defaultDayOption1,
        lead.dayOption2 || config.defaultDayOption2
      ),
    [
      lead.city,
      config.cityFixedDays,
      lead.dayOption1,
      lead.dayOption2,
      config.defaultDayOption1,
      config.defaultDayOption2,
    ]
  );

  const calendarEventsByDate = useMemo(
    () => countEventsByDateKey(calendarIntegration.events),
    [calendarIntegration.events]
  );

  const workspaceCalendarAvailability = useMemo(() => {
    const durationHours =
      lead.serviceType === 'deep_clean' || lead.serviceType === 'move_in_out'
        ? 4
        : 3;
    return evaluateCalendarSlotAvailability(
      calendarIntegration,
      resolvedSuggestedDates.dates,
      durationHours
    );
  }, [calendarIntegration, resolvedSuggestedDates.dates, lead.serviceType]);

  const selectedCalendarName = useMemo(() => {
    const match = calendarIntegration.calendars.find(
      (c) => c.id === calendarIntegration.selectedCalendarId
    );
    return match ? match.summary : 'Agenda principal';
  }, [calendarIntegration.calendars, calendarIntegration.selectedCalendarId]);

  useEffect(() => {
    setEnglishMsg(lead.lastGeneratedMessage?.english ?? '');
    setPortugueseMsg(lead.lastGeneratedMessage?.portuguese ?? '');
    setProposedPrice(String(competitivePrice));
    setConcessionError(null);
    setConcessionSavedNotice(false);
    setGenError(null);
    setSentFeedback(null);
  }, [lead.id, competitivePrice]);

  const calendarVerified = workspaceCalendarAvailability.verifiedAvailable;
  const sendPermission = evaluateSendPermission(lead);
  const nameCheck = checkNameMismatch(lead.clientName, englishMsg);
  const compliance = validateNegotiationCompliance(englishMsg, {
    calendarVerified,
  });
  const ptIssues = validatePortugueseCompliance(portugueseMsg, {
    calendarVerified,
  });
  const allMessageViolations = Array.from(
    new Set([...compliance.violations, ...ptIssues])
  );
  const messageCopyBlocked =
    !englishMsg.trim() || allMessageViolations.length > 0;

  const minutesElapsed = getMinutesSinceCreated(lead.createdAt);

  const previousOutboundMessages = [
    ...(lead.interactionHistory ?? []).map((entry) => entry.sentReplyEn),
    lead.lastGeneratedMessage?.english ?? '',
  ]
    .map((m) => m.trim())
    .filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

  const selectedObjectionMeta = OBJECTION_OPTIONS.find(
    (o) => o.id === lead.objection
  );

  const handleChangeStage = (stage: NegotiationStage) => {
    const status =
      stage === 'Agendado' || stage === 'Cliente fixo'
        ? 'Fechou'
        : stage === 'Perdido'
        ? 'Perdeu'
        : 'Enviado';

    let nextFollowUpDate = lead.nextFollowUpDate;
    let followUpStep = lead.followUpStep;
    let hibernateUntilDate = lead.hibernateUntilDate;

    if (stage === 'Hibernar') {
      followUpStep = 'hibernar';
      nextFollowUpDate = null;
      hibernateUntilDate =
        lead.hibernateUntilDate ||
        config.negotiation.defaultHibernateDate ||
        addDaysToDateString(today, 90);
    } else if (stage === 'Agendado' || stage === 'Cliente fixo' || stage === 'Perdido') {
      nextFollowUpDate = null;
    }

    onUpdateLead({
      ...lead,
      stage,
      status,
      followUpStep,
      nextFollowUpDate,
      hibernateUntilDate,
      lossReason: stage === 'Perdido' ? lead.lossReason : '',
    });
  };

  const handleSelectObjection = (objId: ObjectionType) => {
    const isSame = lead.objection === objId;
    if (isSame) {
      onUpdateLead({
        ...lead,
        objection: null,
      });
      return;
    }

    let nextStage: NegotiationStage = 'Objeção';
    let blockedUntilDate = lead.blockedUntilDate;
    let nextFollowUpDate = lead.nextFollowUpDate;
    let followUpStep: FollowUpStep = lead.followUpStep;

    // Regra: depois de "eu te aviso", nenhuma mensagem antes de 2 dias -> agenda Dia 2
    if (objId === 'eu_te_aviso') {
      const day2Date = addDaysToDateString(today, 2);
      blockedUntilDate = day2Date;
      nextFollowUpDate = day2Date;
      followUpStep = 2;
    } else if (objId === 'procurando_emprego') {
      onSavePotentialHelper(lead);
    }

    onUpdateLead({
      ...lead,
      objection: objId,
      stage: nextStage,
      status: 'Enviado',
      blockedUntilDate,
      nextFollowUpDate,
      followUpStep,
    });
  };

  const handleRegisterClientReply = () => {
    const nowIso = new Date().toISOString();
    onUpdateLead({
      ...lead,
      firstInboundAt: lead.firstInboundAt ?? nowIso,
      lastInboundAt: nowIso,
      consecutiveOutboundCount: 0,
      blockedUntilDate: null,
    });
  };

  const handleApplyConcession = () => {
    setConcessionError(null);
    setConcessionSavedNotice(false);

    if (existingClientConcession) {
      setConcessionError(
        'Concessão já utilizada para este cliente (máximo 1 por cliente).'
      );
      return;
    }

    if (!deadlineDate) {
      setConcessionError(
        'Informe a data limite exata da concessão (regra obrigatória).'
      );
      return;
    }

    let concessionRecord: ConcessionRecord;
    let updatedFinalPrice = lead.finalPricePrimary;

    if (concessionTab === 'valor') {
      const dollar = Math.max(1, Math.round(Number(valueDollar) || 0));
      if (!valueDesc.trim()) {
        setConcessionError('Descreva o extra de valor gratuito na 1ª limpeza.');
        return;
      }
      concessionRecord = {
        type: 'valor',
        description: valueDesc.trim(),
        discountAmountDollar: dollar,
        proposedFinalPrice: null,
        exchangeCondition,
        deadlineDate,
        appliedAt: new Date().toISOString(),
      };
    } else if (concessionTab === 'preco') {
      const targetPrice = Math.round(Number(proposedPrice) || 0);
      if (targetPrice < minimumPrice) {
        setConcessionError(
          `Bloqueado: $${targetPrice} está abaixo do preço Mínimo ($${minimumPrice}).`
        );
        return;
      }
      const dollarOff = Math.max(0, idealPrice - targetPrice);
      if (dollarOff <= 0) {
        setConcessionError(
          'O preço competitivo deve oferecer ao menos $1 de desconto em dólar sobre o preço da tabela.'
        );
        return;
      }
      concessionRecord = {
        type: 'preco',
        description: `Preço Competitivo ($${dollarOff} off sobre a tabela)`,
        discountAmountDollar: dollarOff,
        proposedFinalPrice: targetPrice,
        exchangeCondition,
        deadlineDate,
        appliedAt: new Date().toISOString(),
      };
      updatedFinalPrice = targetPrice;
    } else if (concessionTab === 'sazonal') {
      if (!seasonalPromoValid) {
        setConcessionError('Promoção sazonal inativa ou expirada.');
        return;
      }
      const rawDiscount = Math.round(
        idealPrice * (config.negotiation.seasonalPromo.percent / 100)
      );
      const targetPrice = Math.max(minimumPrice, idealPrice - rawDiscount);
      const exactDollarOff = Math.max(0, idealPrice - targetPrice);
      concessionRecord = {
        type: 'sazonal',
        description: `Promoção sazonal ${config.negotiation.seasonalPromo.name}`,
        discountAmountDollar: exactDollarOff,
        proposedFinalPrice: targetPrice,
        exchangeCondition,
        deadlineDate: config.negotiation.seasonalPromo.expiresAt || deadlineDate,
        appliedAt: new Date().toISOString(),
      };
      updatedFinalPrice = targetPrice;
    } else {
      // Pacote 2 horas
      const pkgPrice = config.negotiation.twoHourPackagePrice;
      concessionRecord = {
        type: 'pacote_2h',
        description: `Pacote 2 Horas (cliente escolhe o que limpar)`,
        discountAmountDollar: Math.max(0, idealPrice - pkgPrice),
        proposedFinalPrice: pkgPrice,
        exchangeCondition,
        deadlineDate,
        appliedAt: new Date().toISOString(),
      };
    }

    onUpdateLead({
      ...lead,
      concession: concessionRecord,
      finalPricePrimary: updatedFinalPrice,
    });
    setConcessionSavedNotice(true);
  };

  const handleGenerateMessage = async () => {
    setGenError(null);
    setSentFeedback(null);

    if (!sendPermission.canSend) {
      setGenError(sendPermission.blockReason);
      return;
    }

    setIsGenerating(true);
    try {
      const resolvedDates = resolveDateOptionsForCity(
        lead.city,
        config.cityFixedDays,
        lead.dayOption1 || config.defaultDayOption1,
        lead.dayOption2 || config.defaultDayOption2
      );
      const response = await apiFetch('/api/generate-negotiation-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: lead.clientName,
          city: lead.city,
          cityAlreadyServed: isCityInServedList(lead.city, config.servedCities),
          cityWeekdayForProof: resolvedDates.proofWeekdayEn,
          dayOption1: resolvedDates.dates[0].en,
          dayOption2: resolvedDates.dates[1].en,
          calendarVerified,
          verifiedSlotsEn: calendarVerified
            ? workspaceCalendarAvailability.verifiedSlots.map((s) => s.en)
            : [],
          verifiedSlotsPt: calendarVerified
            ? workspaceCalendarAvailability.verifiedSlots.map((s) => s.pt)
            : [],
          companyFacts: config.companyFacts,
          houseLabel: lead.effectiveHouseLabel || lead.houseLabel,
          serviceType: SERVICE_TYPE_LABELS[lead.serviceType],
          isRecurring: resolvedPricing.isRecurring,
          frequency: lead.frequency ? FREQUENCY_LABELS[lead.frequency] : null,
          desiredDate: lead.desiredDate,
          notes: lead.notes,
          stage: lead.stage,
          followUpStep: lead.followUpStep,
          objection: lead.objection,
          priceAlreadySent: lead.priceAlreadySent,
          finalPricePrimary: resolvedPricing.initialFinalPrice,
          finalPriceRecurring: resolvedPricing.recurringFinalPrice,
          recurringPriceStatus: resolvedPricing.recurringStatus,
          idealPrice,
          competitivePrice,
          minimumPrice,
          twoHourPackagePrice: config.negotiation.twoHourPackagePrice,
          previousOutboundMessages,
          concession: lead.concession
            ? {
                ...lead.concession,
                deadlineDate: formatDateEnShort(lead.concession.deadlineDate),
              }
            : null,
        }),
      });

      const payload = (await response.json()) as {
        english?: string;
        portuguese?: string;
        error?: string;
      };

      if (!response.ok || !payload.english) {
        throw new Error(
          payload.error || 'Não foi possível gerar a mensagem agora.'
        );
      }

      const nextEnglish = payload.english.trim();
      const nextPortuguese = (payload.portuguese ?? '').trim();
      setEnglishMsg(nextEnglish);
      setPortugueseMsg(nextPortuguese);

      onUpdateLead({
        ...lead,
        lastGeneratedMessage: {
          english: nextEnglish,
          portuguese: nextPortuguese,
          generatedAt: new Date().toISOString(),
          step: lead.followUpStep,
          objection: lead.objection,
        },
      });
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : 'Erro ao gerar mensagem com IA.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyMessage = async () => {
    if (messageCopyBlocked) return;
    try {
      await navigator.clipboard.writeText(englishMsg);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = englishMsg;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const handleMarkMessageSent = () => {
    if (!sendPermission.canSend) {
      setGenError(sendPermission.blockReason);
      return;
    }

    const nowIso = new Date().toISOString();
    const next = getNextFollowUpAfterStep(
      lead.followUpStep,
      today,
      config.negotiation.defaultHibernateDate,
      lead.objection
    );

    const updatedStage =
      lead.stage === 'Novo' || lead.stage === 'Aguardando fotos'
        ? 'Orçamento enviado'
        : next.nextStage ?? lead.stage;

    const historyEntry: LeadInteractionEntry | null = englishMsg.trim()
      ? {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: nowIso,
          clientMessageEn: '',
          clientMessagePt: '',
          realIntentPt: '',
          objection: lead.objection ?? 'duvida_sem_objeccao',
          sentReplyEn: englishMsg.trim(),
          sentReplyPt: portugueseMsg.trim(),
          step: lead.followUpStep,
          kind: 'followup',
        }
      : null;

    onUpdateLead({
      ...lead,
      stage: updatedStage,
      status:
        updatedStage === 'Agendado' || updatedStage === 'Cliente fixo'
          ? 'Fechou'
          : updatedStage === 'Perdido'
          ? 'Perdeu'
          : 'Enviado',
      followUpStep: next.nextStep,
      nextFollowUpDate: next.nextDate,
      blockedUntilDate: next.blockedUntilDate,
      hibernateUntilDate: next.hibernateUntilDate ?? lead.hibernateUntilDate,
      firstOutboundAt: lead.firstOutboundAt ?? nowIso,
      lastOutboundAt: nowIso,
      consecutiveOutboundCount: lead.consecutiveOutboundCount + 1,
      priceAlreadySent:
        lead.priceAlreadySent || /\$\s*\d+/.test(englishMsg),
      lastGeneratedMessage: englishMsg.trim()
        ? {
            english: englishMsg.trim(),
            portuguese: portugueseMsg.trim(),
            generatedAt: nowIso,
            step: lead.followUpStep,
            objection: lead.objection,
          }
        : lead.lastGeneratedMessage,
      interactionHistory: historyEntry
        ? [...(lead.interactionHistory ?? []), historyEntry]
        : lead.interactionHistory ?? [],
    });

    setSentFeedback(
      next.nextStep === 'hibernar'
        ? `Enviada! Lead movido para Hibernar até ${formatDateBr(
            next.hibernateUntilDate
          )}.`
        : `Enviada! Próximo follow-up agendado: Dia ${next.nextStep} (${formatDateBr(
            next.nextDate
          )}).`
    );
  };

  const serviceSummary =
    lead.serviceType === 'visita_avulsa' && lead.visitaAvulsaOption
      ? `Visita avulsa · ${VISITA_AVULSA_LABELS[lead.visitaAvulsaOption]}`
      : lead.serviceType === 'recorrente' && lead.frequency
      ? `${SERVICE_TYPE_LABELS.recorrente} · ${FREQUENCY_LABELS[lead.frequency]}`
      : SERVICE_TYPE_LABELS[lead.serviceType];

  const houseSizeLabel =
    lead.serviceType === 'visita_avulsa'
      ? serviceSummary
      : `${lead.effectiveHouseLabel || lead.houseLabel}${
          lead.squareFeet ? ` · ${lead.squareFeet} sq ft` : ''
        }`;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Cabeçalho do lead */}
      {/* Cabeçalho compacto do lead + Etapa */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:px-6 sm:py-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0B6273] hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar para lista</span>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                {lead.clientName || 'Lead sem nome'}
              </h2>
              <span
                className={`text-xs font-semibold px-2.5 py-0.5 rounded-md border ${
                  STAGE_BADGE_CLASSES[lead.stage]
                }`}
              >
                {lead.stage}
              </span>
              {lead.stage === 'Novo' && (
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md border ${
                    minutesElapsed <= 5
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-red-50 text-red-700 border-red-200'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  <span>{minutesElapsed} min (meta: 5 min)</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs sm:text-sm text-slate-600">
              <span>{lead.city || 'Cidade não informada'}</span>
              <span className="text-slate-300">·</span>
              <span>{houseSizeLabel}</span>
              <span className="text-slate-300">·</span>
              <span className="font-mono font-semibold text-[#0B6273]">
                Inicial: ${resolvedPricing.initialFinalPrice}
              </span>
              {resolvedPricing.isRecurring && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono font-medium text-slate-800">
                    Recorrente:{' '}
                    {resolvedPricing.recurringStatus === 'available' &&
                    resolvedPricing.recurringFinalPrice !== null
                      ? `$${resolvedPricing.recurringFinalPrice}/visita`
                      : 'a confirmar'}
                  </span>
                </>
              )}
              {lead.origin && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>
                    {lead.origin === 'Facebook' && lead.adCode
                      ? `Facebook (${lead.adCode})`
                      : lead.origin}
                  </span>
                </>
              )}
              {lead.phone && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono tabular-nums">{lead.phone}</span>
                </>
              )}
              {lead.desiredDate && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>Data: {lead.desiredDate}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label className="sr-only" htmlFor="lead-stage-select">
              Etapa do lead
            </label>
            <select
              id="lead-stage-select"
              value={lead.stage}
              onChange={(e) =>
                handleChangeStage(e.target.value as NegotiationStage)
              }
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
            >
              {NEGOTIATION_STAGES.map((st) => (
                <option key={st} value={st}>
                  Etapa: {st}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleRegisterClientReply}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-[#0B6273] text-[#0B6273] bg-white text-xs sm:text-sm font-medium hover:bg-[#EAF4F6] transition-colors whitespace-nowrap"
            >
              <MessageSquareReply className="w-4 h-4" />
              <span>Cliente respondeu</span>
            </button>
          </div>
        </div>

        {lead.notes && (
          <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
            Obs.: {lead.notes}
          </p>
        )}

        {lead.stage === 'Perdido' && (
          <div className="bg-red-50/70 border border-red-200 rounded-lg p-3 space-y-2">
            <label className="block text-xs font-medium text-red-900">
              Motivo da perda (usado no Painel de Negociação)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {LOSS_REASONS_SUGGESTIONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() =>
                    onUpdateLead({
                      ...lead,
                      stage: 'Perdido',
                      status: 'Perdeu',
                      lossReason: reason,
                    })
                  }
                  className={`min-h-[34px] px-2.5 py-1 rounded text-xs border transition-colors ${
                    lead.lossReason === reason
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-white text-slate-700 border-red-200 hover:border-red-400'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={lead.lossReason}
              onChange={(e) =>
                onUpdateLead({
                  ...lead,
                  stage: 'Perdido',
                  status: 'Perdeu',
                  lossReason: e.target.value,
                })
              }
              placeholder="Ou digite o motivo específico..."
              className="w-full h-11 sm:h-10 px-3 rounded-md border border-red-200 bg-white text-base text-slate-900"
            />
          </div>
        )}

        {lead.stage === 'Hibernar' && (
          <div className="bg-slate-100 border border-slate-300 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-700">
              <strong className="font-semibold">Status Hibernar:</strong> lead
              pausado até a próxima temporada.
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-700">
                Retomar em:
              </label>
              <input
                type="date"
                value={
                  lead.hibernateUntilDate ||
                  config.negotiation.defaultHibernateDate
                }
                onChange={(e) =>
                  onUpdateLead({
                    ...lead,
                    hibernateUntilDate: e.target.value,
                  })
                }
                className="h-10 px-2.5 rounded-md border border-slate-300 bg-white text-base font-mono tabular-nums"
              />
            </div>
          </div>
        )}
      </section>

      {/* Disponibilidade real e agendamento no Google Calendar */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:px-6 sm:py-4 space-y-3">
        {!calendarIntegration.connected ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#EAF4F6] text-[#0B6273] flex items-center justify-center shrink-0 mt-0.5">
                  <Calendar className="w-4 h-4" />
                </div>
                <div className="text-xs text-slate-600">
                  <strong className="text-slate-900 block text-sm">
                    Google Calendar
                  </strong>
                  Conecte para ver sua disponibilidade real nas datas sugeridas e
                  agendar a limpeza direto na agenda.
                </div>
              </div>
              <GoogleSignInButton
                onClick={calendarIntegration.onSignIn}
                disabled={calendarIntegration.isLoggingIn}
                label={
                  calendarIntegration.isLoggingIn
                    ? 'Conectando...'
                    : 'Sign in with Google'
                }
              />
            </div>
            {calendarIntegration.error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                {calendarIntegration.error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Calendar className="w-4 h-4 text-[#0B6273]" />
                <span>Disponibilidade nas datas sugeridas</span>
                <span className="text-xs font-normal text-slate-500">
                  ({selectedCalendarName})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={calendarIntegration.onOpenCalendarTab}
                  className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Ver agenda
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCalendarModalDateKey(
                      resolvedSuggestedDates.dates[0].dateKey
                    )
                  }
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#0B6273] text-white text-xs font-semibold hover:bg-[#084E5C]"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  <span>Agendar limpeza</span>
                </button>
              </div>
            </div>

            {calendarIntegration.error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex flex-wrap items-center justify-between gap-2">
                <span>{calendarIntegration.error}</span>
                <GoogleSignInButton
                  onClick={calendarIntegration.onSignIn}
                  disabled={calendarIntegration.isLoggingIn}
                  label="Reconectar"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {resolvedSuggestedDates.dates.map((dateOpt) => {
                const count = (calendarEventsByDate[dateOpt.dateKey] || [])
                  .length;
                const isSyncedOk =
                  calendarIntegration.connected &&
                  Boolean(calendarIntegration.syncSucceeded) &&
                  !calendarIntegration.isLoading &&
                  !calendarIntegration.error;
                const verifiedSlot =
                  workspaceCalendarAvailability.verifiedSlots.find(
                    (s) => s.dateKey === dateOpt.dateKey
                  );
                return (
                  <button
                    key={dateOpt.dateKey}
                    type="button"
                    onClick={() => setCalendarModalDateKey(dateOpt.dateKey)}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50/70 hover:border-[#0B6273] hover:bg-[#EAF4F6]/50 transition-colors text-left"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900 capitalize">
                        {dateOpt.pt}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {verifiedSlot ? verifiedSlot.pt : dateOpt.en}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                        !isSyncedOk
                          ? 'bg-slate-100 text-slate-600 border-slate-300'
                          : verifiedSlot
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {calendarIntegration.isLoading
                        ? 'Verificando...'
                        : calendarIntegration.error
                        ? 'Erro na agenda'
                        : !isSyncedOk
                        ? 'A confirmar'
                        : verifiedSlot
                        ? count === 0
                          ? `Livre (${verifiedSlot.startTime})`
                          : `${count} ${count === 1 ? 'evento' : 'eventos'} · livre ${verifiedSlot.startTime}`
                        : `${count} ${count === 1 ? 'evento' : 'eventos'}`}
                    </span>
                  </button>
                );
              })}
            </div>

            {calendarScheduledMsg && (
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{calendarScheduledMsg}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ESPAÇO DE CONVERSA CONTÍNUA (prioridade principal) */}
      <ConversationThreadPanel
        lead={lead}
        config={config}
        resolvedPricing={resolvedPricing}
        calendarAvailability={workspaceCalendarAvailability}
        existingClientConcession={existingClientConcession}
        idealPrice={idealPrice}
        competitivePrice={competitivePrice}
        minimumPrice={minimumPrice}
        onUpdateLead={onUpdateLead}
        onSavePotentialHelper={onSavePotentialHelper}
        onJumpToConcessions={() =>
          concessionsRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          })
        }
      />

      {/* Mapa, rota e contexto da região (Google Maps + Gemini Maps Grounding) */}
      <LeadMapsPanel
        mapsApiKey={mapsApiKey}
        baseLocation={config.serviceBaseLocation}
        maxRadiusMiles={config.serviceMaxRadiusMiles}
        leadAddress={lead.streetAddress}
        leadCity={lead.city}
        leadZip={lead.zipCode}
        serviceType={lead.serviceType}
        insight={lead.mapsInsight ?? null}
        onInsightLoaded={(nextInsight: MapsRouteInsight) =>
          onUpdateLead({
            ...lead,
            mapsInsight: nextInsight,
          })
        }
        compact
      />

      {/* Calendário de Follow-up Automático */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              2. Calendário de follow-up automático
            </h3>
            <p className="text-xs text-slate-500">
              Dia 0 → Dia 2 (pagamento após ver limpo) → Dia 5 (prova social) → Dia 10 (opções
              1/2/3) → Hibernar.
            </p>
          </div>
          {lead.nextFollowUpDate && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-[#EAF4F6] text-[#0B6273] border border-[#0B6273]/25">
              <CalendarClock className="w-3.5 h-3.5" />
              <span>
                Próximo envio: Dia {lead.followUpStep} (
                {formatDateBr(lead.nextFollowUpDate)})
              </span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {FOLLOW_UP_STEPS_INFO.map((item) => {
            const isCurrent = lead.followUpStep === item.step;
            return (
              <button
                key={String(item.step)}
                type="button"
                onClick={() =>
                  onUpdateLead({
                    ...lead,
                    followUpStep: item.step,
                    stage: item.step === 'hibernar' ? 'Hibernar' : lead.stage,
                    hibernateUntilDate:
                      item.step === 'hibernar'
                        ? lead.hibernateUntilDate ||
                          config.negotiation.defaultHibernateDate
                        : lead.hibernateUntilDate,
                  })
                }
                className={`p-3 rounded-lg border text-left transition-colors ${
                  isCurrent
                    ? 'border-[#0B6273] bg-[#EAF4F6]/80'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-bold text-[#0B6273]">
                  {item.title}
                </div>
                <div className="text-xs text-slate-600 mt-1 leading-snug">
                  {item.subtitle}
                </div>
              </button>
            );
          })}
        </div>

        {lead.followUpStep === 5 && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900 font-medium">
            Lembrete do Dia 5: anexe um print de avaliação real de cliente junto
            com a mensagem!
          </div>
        )}
      </section>

      {/* 9 Botões de Objeção */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-base font-semibold text-slate-900">
            3. Objeção recebida
          </h3>
          <p className="text-xs text-slate-500">
            Toque na objeção que a cliente enviou para orientar a resposta e a
            estratégia.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {OBJECTION_OPTIONS.map((obj) => {
            const selected = lead.objection === obj.id;
            return (
              <button
                key={obj.id}
                type="button"
                onClick={() => handleSelectObjection(obj.id)}
                className={`min-h-[44px] px-3 py-2 rounded-lg border text-left text-xs sm:text-sm font-medium transition-colors ${
                  selected
                    ? 'bg-[#0B6273] text-white border-[#0B6273]'
                    : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {obj.label}
              </button>
            );
          })}
        </div>

        {selectedObjectionMeta && (
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
            <div>
              <strong className="text-slate-900">Estratégia:</strong>{' '}
              {selectedObjectionMeta.strategyHint}
            </div>

            {lead.objection === 'tem_avaliacoes' && (
              <div className="text-amber-800 font-medium">
                Lembrete: anexe print de avaliação real de cliente ao enviar a
                resposta.
              </div>
            )}

            {lead.objection === 'quanto_por_hora' && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="font-medium text-[#0B6273]">
                  Oferta recomendada: Pacote 2 Horas por $
                  {config.negotiation.twoHourPackagePrice} fixo (cliente escolhe
                  o que limpar).
                </span>
                {!existingClientConcession && (
                  <button
                    type="button"
                    onClick={() => setConcessionTab('pacote_2h')}
                    className="h-9 px-3 rounded-md bg-[#0B6273] text-white text-xs font-medium hover:bg-[#084E5C]"
                  >
                    Selecionar Pacote 2 Horas
                  </button>
                )}
              </div>
            )}

            {lead.objection === 'procurando_emprego' && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="font-medium text-emerald-800">
                  {isHelperSaved
                    ? 'Contato salvo na lista "Possíveis ajudantes".'
                    : 'Salvar contato na lista "Possíveis ajudantes".'}
                </span>
                {!isHelperSaved && (
                  <button
                    type="button"
                    onClick={() => onSavePotentialHelper(lead)}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Salvar em Possíveis ajudantes</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Regras de Concessão */}
      <section
        ref={concessionsRef}
        className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              4. Regras de concessão (máx. 1 por cliente)
            </h3>
            <p className="text-xs text-slate-500">
              Ordem obrigatória: 1º oferecer VALOR (extra grátis), só depois
              PREÇO (Competitivo, nunca abaixo do Mínimo). Sempre com valor
              exato em $ e data limite.
            </p>
          </div>
        </div>

        {/* Régua Ideal / Competitivo / Mínimo (1ª limpeza) */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
            <span className="block text-xs text-slate-500">
              Preço Ideal (1ª limpeza)
            </span>
            <span className="text-lg font-bold font-mono tabular-nums text-slate-900">
              ${idealPrice}
            </span>
          </div>
          <div className="p-3 rounded-lg border border-[#0B6273]/30 bg-[#EAF4F6]/60">
            <span className="block text-xs text-[#0B6273] font-medium">
              Competitivo (-{config.negotiation.competitiveDiscountPercent}%)
            </span>
            <span className="text-lg font-bold font-mono tabular-nums text-[#0B6273]">
              ${competitivePrice}
            </span>
          </div>
          <div className="p-3 rounded-lg border border-red-200 bg-red-50/50">
            <span className="block text-xs text-red-700 font-medium">
              Mínimo (piso)
            </span>
            <span className="text-lg font-bold font-mono tabular-nums text-red-700">
              ${minimumPrice}
            </span>
          </div>
        </div>
        {resolvedPricing.isRecurring && (
          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Preço recorrente por visita</strong>{' '}
              {lead.frequency ? `(${FREQUENCY_LABELS[lead.frequency]})` : ''}:{' '}
              {resolvedPricing.recurringStatus === 'available' &&
              resolvedPricing.recurringFinalPrice !== null ? (
                <span className="font-mono font-bold text-[#0B6273]">
                  ${resolvedPricing.recurringFinalPrice}/visita
                </span>
              ) : (
                <span className="font-semibold text-amber-800">
                  precisa ser confirmado com a Dani (registro sem recorrente confiável)
                </span>
              )}
            </span>
            <span className="text-[11px] text-slate-500">
              Separado do valor inicial (${resolvedPricing.initialFinalPrice})
            </span>
          </div>
        )}

        {/* Concessão já usada? Bloqueia outra */}
        {existingClientConcession ? (
          <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <Ban className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Concessão já usada para este cliente — nova concessão bloqueada
              </span>
            </div>
            <p className="text-xs text-amber-900">
              <strong>Aplicada:</strong> {existingClientConcession.description}{' '}
              (valor ${existingClientConcession.discountAmountDollar}) ·{' '}
              <strong>Em troca de:</strong>{' '}
              {existingClientConcession.exchangeCondition} ·{' '}
              <strong>Validade:</strong>{' '}
              {formatDateBr(existingClientConcession.deadlineDate)}.
            </p>
            {concessionSavedNotice && (
              <p className="text-xs font-medium text-emerald-800 pt-1">
                Concessão ativa! Se já colou a mensagem da cliente lá em cima,
                clique novamente em &quot;Analisar e gerar próxima resposta&quot;
                para incluí-la no texto.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setConcessionTab('valor')}
                className={`h-10 px-3 rounded-lg text-xs sm:text-sm font-medium border transition-colors ${
                  concessionTab === 'valor'
                    ? 'bg-[#0B6273] text-white border-[#0B6273]'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                1º Valor (extra grátis)
              </button>
              <button
                type="button"
                onClick={() => setConcessionTab('preco')}
                className={`h-10 px-3 rounded-lg text-xs sm:text-sm font-medium border transition-colors ${
                  concessionTab === 'preco'
                    ? 'bg-[#0B6273] text-white border-[#0B6273]'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                2º Preço Competitivo (só depois do Valor)
              </button>
              <button
                type="button"
                onClick={() => setConcessionTab('pacote_2h')}
                className={`h-10 px-3 rounded-lg text-xs sm:text-sm font-medium border transition-colors ${
                  concessionTab === 'pacote_2h'
                    ? 'bg-[#0B6273] text-white border-[#0B6273]'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                Pacote 2 Horas (${config.negotiation.twoHourPackagePrice})
              </button>
              {seasonalPromoValid && (
                <button
                  type="button"
                  onClick={() => setConcessionTab('sazonal')}
                  className={`h-10 px-3 rounded-lg text-xs sm:text-sm font-medium border transition-colors ${
                    concessionTab === 'sazonal'
                      ? 'bg-[#0B6273] text-white border-[#0B6273]'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  Sazonal ({config.negotiation.seasonalPromo.name})
                </button>
              )}
            </div>

            {concessionTab === 'valor' && (
              <div className="space-y-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex flex-wrap gap-1.5">
                  {VALUE_CONCESSION_SUGGESTIONS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setValueDesc(item.label);
                        setValueDollar(String(item.defaultDollar));
                      }}
                      className={`px-2.5 py-1 rounded text-xs border ${
                        valueDesc === item.label
                          ? 'bg-[#0B6273] text-white border-[#0B6273]'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      {item.label} (${item.defaultDollar})
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Extra gratuito na 1ª limpeza
                    </label>
                    <input
                      type="text"
                      value={valueDesc}
                      onChange={(e) => setValueDesc(e.target.value)}
                      className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Valor exato em dólar ($)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={valueDollar}
                      onChange={(e) => setValueDollar(e.target.value)}
                      className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono tabular-nums text-base"
                    />
                  </div>
                </div>
              </div>
            )}

            {concessionTab === 'preco' && (
              <div className="space-y-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Novo preço proposto (nunca abaixo de ${minimumPrice})
                    </label>
                    <input
                      type="number"
                      min={minimumPrice}
                      value={proposedPrice}
                      onChange={(e) => setProposedPrice(e.target.value)}
                      className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono tabular-nums text-base font-semibold"
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="text-xs text-slate-600 pb-2">
                      Desconto exato:{' '}
                      <strong className="font-mono text-slate-900">
                        $
                        {Math.max(
                          0,
                          idealPrice - (Math.round(Number(proposedPrice) || 0))
                        )}
                      </strong>{' '}
                      sobre o Preço Ideal (${idealPrice})
                    </div>
                  </div>
                </div>
              </div>
            )}

            {concessionTab === 'sazonal' && seasonalPromoValid && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                <strong>
                  Promoção Sazonal: {config.negotiation.seasonalPromo.name}
                </strong>{' '}
                — {config.negotiation.seasonalPromo.percent}% (respeitando piso
                mínimo de ${minimumPrice}). Validade:{' '}
                {formatDateBr(config.negotiation.seasonalPromo.expiresAt)}. Não
                acumula com outra concessão.
              </div>
            )}

            {concessionTab === 'pacote_2h' && (
              <div className="p-3 rounded-lg bg-[#EAF4F6] border border-[#0B6273]/30 text-xs text-slate-800">
                <strong>Pacote 2 Horas:</strong> preço fixo de{' '}
                <strong>${config.negotiation.twoHourPackagePrice}</strong>, onde
                a cliente escolhe os cômodos e prioridades para limpar dentro de
                2 horas.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Condição obrigatória (em troca de)
                </label>
                <select
                  value={exchangeCondition}
                  onChange={(e) =>
                    setExchangeCondition(
                      e.target.value as ConcessionExchangeCondition
                    )
                  }
                  className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
                >
                  {CONCESSION_EXCHANGE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Data limite exata da oferta
                </label>
                <input
                  type="date"
                  value={deadlineDate}
                  onChange={(e) => setDeadlineDate(e.target.value)}
                  className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono tabular-nums text-base"
                />
              </div>
            </div>

            {concessionError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                {concessionError}
              </div>
            )}

            <button
              type="button"
              onClick={handleApplyConcession}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] transition-colors"
            >
              <Gift className="w-4 h-4" />
              <span>Registrar concessão para este cliente</span>
            </button>
          </div>
        )}
      </section>

      {/* Gerador de Mensagem (Gemini) + Checagem antes de copiar */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              5. Gerador de mensagem (IA) e envio
            </h3>
            <p className="text-xs text-slate-500">
              {calendarVerified && workspaceCalendarAvailability.verifiedSlots.length ? (
                <>
                  Até 60 palavras, com tradução em português. Horários livres verificados no Google Calendar:{' '}
                  <strong className="text-slate-700">
                    {workspaceCalendarAvailability.verifiedSlots
                      .map((s) => s.en)
                      .join(' ou ')}
                  </strong>
                  .
                </>
              ) : (
                <>
                  Até 60 palavras, com tradução em português. Sugestões de datas para{' '}
                  {lead.city || 'esta cidade'}
                  {resolvedSuggestedDates.isFixedCityDay
                    ? ` (${resolvedSuggestedDates.fixedWeekdayPt})`
                    : ''}
                  :{' '}
                  <strong className="text-slate-700">
                    {resolvedSuggestedDates.dates[0].en}
                  </strong>{' '}
                  ou{' '}
                  <strong className="text-slate-700">
                    {resolvedSuggestedDates.dates[1].en}
                  </strong>
                  . Sem data e horário verificados na agenda, o rascunho pergunta a preferência e informa que a disponibilidade será confirmada.
                </>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={handleGenerateMessage}
            disabled={isGenerating || !sendPermission.canSend}
            className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            <span>
              {isGenerating ? 'Gerando...' : 'Gerar mensagem com IA'}
            </span>
          </button>
        </div>

        {/* Aviso de regra de envio (Eu te aviso 2 dias / Nunca 2 seguidas) */}
        {!sendPermission.canSend && sendPermission.blockReason && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2 text-xs text-amber-900">
              <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>{sendPermission.blockReason}</span>
            </div>
            {sendPermission.needsReplyFirst && (
              <button
                type="button"
                onClick={handleRegisterClientReply}
                className="h-9 px-3 rounded-md bg-white border border-amber-400 text-xs font-medium text-amber-900 hover:bg-amber-100 shrink-0"
              >
                Registrar resposta da cliente
              </button>
            )}
          </div>
        )}

        {genError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {genError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#0B6273]">
                Mensagem em Inglês Americano
              </label>
              <span
                className={`text-xs font-mono tabular-nums ${
                  compliance.wordCount > 60
                    ? 'text-red-600 font-semibold'
                    : 'text-slate-500'
                }`}
              >
                {compliance.wordCount} / 60 palavras
              </span>
            </div>
            <textarea
              rows={5}
              value={englishMsg}
              onChange={(e) => setEnglishMsg(e.target.value)}
              placeholder="Clique em 'Gerar mensagem com IA' para criar a resposta..."
              className="w-full p-3 rounded-lg border border-slate-300 text-base text-slate-900 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Tradução em Português
            </label>
            <textarea
              rows={5}
              value={portugueseMsg}
              onChange={(e) => setPortugueseMsg(e.target.value)}
              placeholder="A tradução aparecerá aqui..."
              className="w-full p-3 rounded-lg border border-slate-200 text-base text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25"
            />
          </div>
        </div>

        {allMessageViolations.length > 0 &&
          (englishMsg.trim() || portugueseMsg.trim()) && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-300 text-xs font-semibold text-red-700 space-y-1">
              {allMessageViolations.map((v) => (
                <div key={v} className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{v}</span>
                </div>
              ))}
              <div className="pt-1 text-[11px] font-medium text-red-600">
                Corrija os itens acima para liberar o botão Copiar.
              </div>
            </div>
          )}

        {/* 6. CHECAGEM ANTES DE COPIAR */}
        <div className="p-3.5 rounded-lg border border-slate-300 bg-slate-50 space-y-2.5">
          <div className="text-xs font-semibold text-slate-700">
            Checagem antes de copiar
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="bg-white border border-slate-200 rounded px-3 py-2">
              <span className="text-slate-500 block">Nome do lead</span>
              <strong className="text-slate-900">
                {lead.clientName || 'Não informado'}
              </strong>
            </div>
            <div className="bg-white border border-slate-200 rounded px-3 py-2">
              <span className="text-slate-500 block">Cidade</span>
              <strong className="text-slate-900">
                {lead.city || 'Não informada'}
              </strong>
            </div>
            <div className="bg-white border border-slate-200 rounded px-3 py-2">
              <span className="text-slate-500 block">Tamanho da casa</span>
              <strong className="text-slate-900">{houseSizeLabel}</strong>
            </div>
          </div>

          {nameCheck.hasMismatch && englishMsg.trim() && (
            <div className="p-2.5 rounded-md bg-red-50 border border-red-300 flex items-center gap-2 text-xs font-semibold text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Confira o nome antes de enviar. (Cadastro:{' '}
                {nameCheck.expectedFirstName} · Mensagem:{' '}
                {nameCheck.detectedName})
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleCopyMessage}
              disabled={messageCopyBlocked}
              title={
                allMessageViolations.length > 0
                  ? allMessageViolations.join(' · ')
                  : 'Copiar mensagem em inglês'
              }
              className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Copiado</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copiar mensagem</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleMarkMessageSent}
              disabled={!sendPermission.canSend}
              className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg border border-[#0B6273] text-[#0B6273] bg-white text-sm font-medium hover:bg-[#EAF4F6] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
              <span>Marcar como enviada (avançar follow-up)</span>
            </button>
          </div>

          {sentFeedback && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{sentFeedback}</span>
            </div>
          )}
        </div>
      </section>

      {calendarModalDateKey && (
        <LeadCalendarModal
          lead={lead}
          config={config}
          defaultDateKey={calendarModalDateKey}
          calendarName={selectedCalendarName}
          existingEvents={calendarIntegration.events}
          onClose={() => setCalendarModalDateKey(null)}
          onConfirmCreate={async (eventInput) => {
            await calendarIntegration.onCreateEvent(eventInput);
            onUpdateLead({
              ...lead,
              stage: 'Agendado',
              status: 'Fechou',
              nextFollowUpDate: null,
            });
            setCalendarScheduledMsg(
              `Limpeza agendada no Google Calendar para ${formatDateBr(
                eventInput.date
              )} às ${eventInput.startTime}. Lead marcado como Agendado.`
            );
            window.setTimeout(() => setCalendarScheduledMsg(null), 6000);
          }}
        />
      )}
    </div>
  );
};
