import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Gift,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  COPILOT_OBJECTION_LABELS,
  FREQUENCY_LABELS,
  SERVICE_TYPE_LABELS,
} from '../data/defaultPricing';
import {
  ConcessionRecord,
  CopilotAnalysisResult,
  LeadInteractionEntry,
  LeadQuoteRecord,
  NegotiationStage,
  ObjectionType,
  PricingConfig,
} from '../types/pricing';
import { apiFetch } from '../utils/apiClient';
import { resolveDateOptionsForCity } from '../utils/dateOptions';
import { CalendarAvailabilityResult } from '../utils/googleCalendarApi';
import { isCityInServedList } from '../utils/messageBuilder';
import {
  checkNameMismatch,
  formatDateBr,
  formatDateEnShort,
  getLocalDateString,
  getNextFollowUpAfterStep,
  validateNegotiationCompliance,
  validatePortugueseCompliance,
} from '../utils/negotiationEngine';
import {
  ResolvedLeadPricing,
  resolveLeadPricingFromEngine,
} from '../utils/pricingEngine';

interface ConversationThreadPanelProps {
  lead: LeadQuoteRecord;
  config: PricingConfig;
  resolvedPricing?: ResolvedLeadPricing;
  calendarAvailability?: CalendarAvailabilityResult | null;
  existingClientConcession: ConcessionRecord | null;
  idealPrice: number;
  competitivePrice: number;
  minimumPrice: number;
  onUpdateLead: (updated: LeadQuoteRecord) => void;
  onSavePotentialHelper: (lead: LeadQuoteRecord) => void;
  onJumpToConcessions?: () => void;
}

function formatMessageTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ConversationThreadPanel: React.FC<ConversationThreadPanelProps> = ({
  lead,
  config,
  resolvedPricing,
  calendarAvailability,
  existingClientConcession,
  idealPrice,
  competitivePrice,
  minimumPrice,
  onUpdateLead,
  onSavePotentialHelper,
  onJumpToConcessions,
}) => {
  const today = getLocalDateString();
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const pricing = useMemo(
    () => resolvedPricing ?? resolveLeadPricingFromEngine(lead, config),
    [resolvedPricing, lead, config]
  );
  const calendarVerified = Boolean(calendarAvailability?.verifiedAvailable);

  const [copilotClientInput, setCopilotClientInput] = useState('');
  const [copilotResult, setCopilotResult] =
    useState<CopilotAnalysisResult | null>(null);
  const [copilotReplyEn, setCopilotReplyEn] = useState('');
  const [copilotReplyPt, setCopilotReplyPt] = useState('');
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotCopied, setCopilotCopied] = useState(false);
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const [copilotSentFeedback, setCopilotSentFeedback] = useState<string | null>(
    null
  );

  const resolvedDates = useMemo(
    () =>
      resolveDateOptionsForCity(
        lead.city,
        config.cityFixedDays,
        lead.dayOption1 || config.defaultDayOption1,
        lead.dayOption2 || config.defaultDayOption2
      ),
    [
      lead.city,
      lead.dayOption1,
      lead.dayOption2,
      config.cityFixedDays,
      config.defaultDayOption1,
      config.defaultDayOption2,
    ]
  );

  // Reset composer when switching leads
  useEffect(() => {
    setCopilotClientInput('');
    setCopilotResult(null);
    setCopilotReplyEn('');
    setCopilotReplyPt('');
    setCopilotError(null);
    setCopilotSentFeedback(null);
  }, [lead.id]);

  // Ordena a conversa cronologicamente (mais antiga no topo, mais nova embaixo)
  const chronologicalTurns = useMemo<LeadInteractionEntry[]>(() => {
    const raw = lead.interactionHistory ?? [];
    if (raw.length === 0 && lead.lastGeneratedMessage?.english) {
      return [
        {
          id: 'legacy-last-msg',
          createdAt: lead.lastGeneratedMessage.generatedAt || lead.createdAt,
          clientMessageEn: '',
          clientMessagePt: '',
          objection: lead.lastGeneratedMessage.objection ?? 'duvida_sem_objeccao',
          sentReplyEn: lead.lastGeneratedMessage.english,
          sentReplyPt: lead.lastGeneratedMessage.portuguese,
          step: lead.lastGeneratedMessage.step,
          kind: 'initial_quote',
        },
      ];
    }

    return [...raw].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    });
  }, [lead.interactionHistory, lead.lastGeneratedMessage, lead.createdAt]);

  useEffect(() => {
    if (chronologicalTurns.length > 0) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [chronologicalTurns.length]);

  const previousOutboundMessages = useMemo(
    () =>
      [
        ...chronologicalTurns.map((entry) => entry.sentReplyEn),
        lead.lastGeneratedMessage?.english ?? '',
      ]
        .map((m) => m.trim())
        .filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx),
    [chronologicalTurns, lead.lastGeneratedMessage]
  );

  const copilotNameCheck = checkNameMismatch(lead.clientName, copilotReplyEn);
  const copilotCompliance = validateNegotiationCompliance(copilotReplyEn, {
    calendarVerified,
  });
  const copilotPtIssues = validatePortugueseCompliance(copilotReplyPt, {
    calendarVerified,
  });
  const allCopilotViolations = Array.from(
    new Set([...copilotCompliance.violations, ...copilotPtIssues])
  );
  const copilotCopyBlocked =
    !copilotReplyEn.trim() || allCopilotViolations.length > 0;

  const copyText = async (text: string, onDone: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    onDone();
  };

  const handleAnalyzeCopilot = async () => {
    setCopilotError(null);
    setCopilotSentFeedback(null);
    if (!copilotClientInput.trim()) {
      setCopilotError('Cole a mensagem da cliente antes de gerar a próxima resposta.');
      return;
    }

    setIsCopilotLoading(true);
    try {
      const response = await apiFetch('/api/copilot-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientMessage: copilotClientInput.trim(),
          clientName: lead.clientName,
          origin: lead.origin || '',
          adCode: lead.adCode || '',
          city: lead.city,
          cityAlreadyServed: isCityInServedList(lead.city, config.servedCities),
          cityWeekdayForProof: resolvedDates.proofWeekdayEn,
          dayOption1: resolvedDates.dates[0].en,
          dayOption2: resolvedDates.dates[1].en,
          calendarVerified,
          verifiedSlotsEn: calendarVerified
            ? calendarAvailability?.verifiedSlots.map((s) => s.en) ?? []
            : [],
          verifiedSlotsPt: calendarVerified
            ? calendarAvailability?.verifiedSlots.map((s) => s.pt) ?? []
            : [],
          companyFacts: config.companyFacts,
          houseLabel: lead.effectiveHouseLabel || lead.houseLabel,
          serviceType: SERVICE_TYPE_LABELS[lead.serviceType],
          isRecurring: pricing.isRecurring,
          frequency: lead.frequency ? FREQUENCY_LABELS[lead.frequency] : null,
          desiredDate: lead.desiredDate,
          notes: lead.notes,
          stage: lead.stage,
          followUpStep: lead.followUpStep,
          priceAlreadySent: lead.priceAlreadySent,
          finalPricePrimary: pricing.initialFinalPrice,
          finalPriceRecurring: pricing.recurringFinalPrice,
          recurringPriceStatus: pricing.recurringStatus,
          idealPrice,
          competitivePrice,
          minimumPrice,
          twoHourPackagePrice: config.negotiation.twoHourPackagePrice,
          previousOutboundMessages,
          conversationHistory: chronologicalTurns.map((t) => ({
            createdAt: t.createdAt,
            clientMessageEn: t.clientMessageEn,
            sentReplyEn: t.sentReplyEn,
            objection: t.objection,
          })),
          concessionAlreadyUsedByClient: Boolean(existingClientConcession),
          concession: lead.concession
            ? {
                ...lead.concession,
                deadlineDate: formatDateEnShort(lead.concession.deadlineDate),
              }
            : null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<
        CopilotAnalysisResult
      > & { error?: string };

      if (
        !response.ok ||
        (!payload.replyEnglish && !payload.needsDaniConfirmation)
      ) {
        throw new Error(
          payload.error || 'Não foi possível gerar a resposta do Copiloto agora.'
        );
      }

      const needsConfirmation = Boolean(payload.needsDaniConfirmation);

      const fullResult: CopilotAnalysisResult = {
        clientMessageEn: copilotClientInput.trim(),
        clientMessagePt: (payload.clientMessagePt ?? '').trim(),
        realIntentPt: (payload.realIntentPt ?? '').trim(),
        identifiedObjection:
          payload.identifiedObjection || 'duvida_sem_objeccao',
        recommendedStrategyPt: (payload.recommendedStrategyPt ?? '').trim(),
        nextMoveHintPt: (payload.nextMoveHintPt ?? '').trim(),
        replyEnglish: needsConfirmation
          ? ''
          : (payload.replyEnglish ?? '').trim(),
        replyPortuguese: needsConfirmation
          ? ''
          : (payload.replyPortuguese ?? '').trim(),
        needsDaniConfirmation: needsConfirmation,
        confirmWithDaniReasonPt: (payload.confirmWithDaniReasonPt ?? '').trim(),
        analyzedAt: new Date().toISOString(),
      };

      setCopilotResult(fullResult);
      setCopilotReplyEn(fullResult.replyEnglish);
      setCopilotReplyPt(fullResult.replyPortuguese);
    } catch (err) {
      setCopilotError(
        err instanceof Error ? err.message : 'Erro ao consultar o Copiloto.'
      );
    } finally {
      setIsCopilotLoading(false);
    }
  };

  const handleLogClientOnly = () => {
    const text = copilotClientInput.trim();
    if (!text) return;
    const nowIso = new Date().toISOString();
    const entry: LeadInteractionEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: nowIso,
      clientMessageEn: text,
      clientMessagePt: copilotResult?.clientMessagePt ?? '',
      realIntentPt: copilotResult?.realIntentPt ?? '',
      objection: copilotResult?.identifiedObjection ?? lead.objection ?? 'duvida_sem_objeccao',
      sentReplyEn: '',
      sentReplyPt: '',
      step: lead.followUpStep,
      kind: 'client_note',
    };

    onUpdateLead({
      ...lead,
      firstInboundAt: lead.firstInboundAt ?? nowIso,
      lastInboundAt: nowIso,
      consecutiveOutboundCount: 0,
      blockedUntilDate: null,
      interactionHistory: [...(lead.interactionHistory ?? []), entry],
    });

    setCopilotClientInput('');
    setCopilotResult(null);
    setCopilotReplyEn('');
    setCopilotReplyPt('');
    setCopilotError(null);
    setCopilotSentFeedback('Mensagem da cliente registrada na conversa.');
  };

  const handleMarkCopilotReplySent = () => {
    if (!copilotReplyEn.trim()) return;
    const nowIso = new Date().toISOString();
    const detectedObj =
      copilotResult?.identifiedObjection ?? 'duvida_sem_objeccao';
    const mappedObjection: ObjectionType | null =
      detectedObj !== 'duvida_sem_objeccao'
        ? (detectedObj as ObjectionType)
        : lead.objection;

    if (mappedObjection === 'procurando_emprego') {
      onSavePotentialHelper(lead);
    }

    const next = getNextFollowUpAfterStep(
      lead.followUpStep,
      today,
      config.negotiation.defaultHibernateDate,
      mappedObjection
    );

    const updatedStage: NegotiationStage =
      mappedObjection === 'eu_te_aviso'
        ? 'Objeção'
        : lead.stage === 'Novo' || lead.stage === 'Aguardando fotos'
        ? mappedObjection && detectedObj !== 'duvida_sem_objeccao'
          ? 'Objeção'
          : 'Orçamento enviado'
        : next.nextStage ?? lead.stage;

    const historyEntry: LeadInteractionEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: nowIso,
      clientMessageEn: copilotClientInput.trim(),
      clientMessagePt: copilotResult?.clientMessagePt ?? '',
      realIntentPt: copilotResult?.realIntentPt ?? '',
      recommendedStrategyPt: copilotResult?.recommendedStrategyPt ?? '',
      objection: detectedObj,
      sentReplyEn: copilotReplyEn.trim(),
      sentReplyPt: copilotReplyPt.trim(),
      step: lead.followUpStep,
      kind: 'copilot_turn',
    };

    onUpdateLead({
      ...lead,
      stage: updatedStage,
      status:
        updatedStage === 'Agendado' || updatedStage === 'Cliente fixo'
          ? 'Fechou'
          : updatedStage === 'Perdido'
          ? 'Perdeu'
          : 'Enviado',
      objection: mappedObjection,
      followUpStep: next.nextStep,
      nextFollowUpDate: next.nextDate,
      blockedUntilDate: next.blockedUntilDate,
      hibernateUntilDate: next.hibernateUntilDate ?? lead.hibernateUntilDate,
      firstInboundAt: lead.firstInboundAt ?? nowIso,
      lastInboundAt: nowIso,
      firstOutboundAt: lead.firstOutboundAt ?? nowIso,
      lastOutboundAt: nowIso,
      consecutiveOutboundCount: 1,
      priceAlreadySent:
        lead.priceAlreadySent || /\$\s*\d+/.test(copilotReplyEn),
      lastGeneratedMessage: {
        english: copilotReplyEn.trim(),
        portuguese: copilotReplyPt.trim(),
        generatedAt: nowIso,
        step: lead.followUpStep,
        objection: mappedObjection,
      },
      interactionHistory: [...(lead.interactionHistory ?? []), historyEntry],
    });

    // Limpa o rascunho atual para ficar pronto para a próxima mensagem da cliente
    setCopilotClientInput('');
    setCopilotResult(null);
    setCopilotReplyEn('');
    setCopilotReplyPt('');
    setCopilotError(null);
    setCopilotSentFeedback(
      next.nextStep === 'hibernar'
        ? `Turno salvo na conversa! Lead movido para Hibernar até ${formatDateBr(
            next.hibernateUntilDate
          )}.`
        : `Turno salvo na conversa! Cole a próxima resposta quando a cliente retornar (próximo follow-up: Dia ${next.nextStep}, ${formatDateBr(
            next.nextDate
          )}).`
    );
  };

  const handleDiscardDraft = () => {
    setCopilotResult(null);
    setCopilotReplyEn('');
    setCopilotReplyPt('');
    setCopilotError(null);
  };

  const shouldHighlightConcessionShortcut =
    copilotResult &&
    !existingClientConcession &&
    (copilotResult.identifiedObjection === 'caro' ||
      copilotResult.identifiedObjection === 'comparando_precos' ||
      copilotResult.identifiedObjection === 'quanto_por_hora');

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
      {/* Cabeçalho limpo sem pílulas decorativas */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="space-y-0.5">
          <h3 className="text-base sm:text-lg font-bold text-slate-900">
            Espaço de conversa estratégica
          </h3>
          <p className="text-xs text-slate-500">
            Cole cada resposta da cliente na sequência. A IA lê toda a conversa
            para gerar a próxima resposta sem repetir argumentos nem decidir
            descontos.
          </p>
        </div>
        <div className="text-xs text-slate-600 font-mono tabular-nums flex flex-wrap items-center gap-y-1">
          <span>
            {chronologicalTurns.length}{' '}
            {chronologicalTurns.length === 1 ? 'turno' : 'turnos'}
          </span>
          <span className="mx-1.5 text-slate-300" aria-hidden="true">
            ·
          </span>
          <span>Inicial ${pricing.initialFinalPrice}</span>
          {pricing.isRecurring && (
            <>
              <span className="mx-1.5 text-slate-300" aria-hidden="true">
                ·
              </span>
              <span>
                Recorrente:{' '}
                {pricing.recurringStatus === 'available' &&
                pricing.recurringFinalPrice !== null
                  ? `$${pricing.recurringFinalPrice}/visita`
                  : 'a confirmar'}
              </span>
            </>
          )}
          <span className="mx-1.5 text-slate-300" aria-hidden="true">
            ·
          </span>
          <span
            className={
              existingClientConcession ? 'text-amber-700 font-semibold' : 'text-[#0B6273]'
            }
          >
            {existingClientConcession
              ? 'Concessão já usada'
              : 'Sem concessão aplicada'}
          </span>
        </div>
      </div>

      {/* Linha do tempo cronológica da conversa */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4 max-h-[280px] overflow-y-auto space-y-3">
        {chronologicalTurns.length === 0 ? (
          <div className="py-4 px-3 text-center space-y-1">
            <p className="text-sm font-medium text-slate-700">
              A conversa com {lead.clientName || 'este lead'} começa aqui.
            </p>
            <p className="text-xs text-slate-500 max-w-lg mx-auto">
              Cole no campo abaixo a mensagem que a cliente enviou para receber
              a análise estratégica e a próxima resposta pronta.
            </p>
          </div>
        ) : (
          chronologicalTurns.map((entry, idx) => (
            <div key={entry.id} className="space-y-2.5">
              {entry.clientMessageEn && (
                <div className="flex flex-col items-start">
                  <div className="text-[11px] text-slate-500 mb-1 px-1">
                    <span>Cliente</span>
                    <span className="mx-1.5 text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatMessageTime(entry.createdAt)}
                    </span>
                    {entry.objection && (
                      <>
                        <span className="mx-1.5 text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-amber-800 font-medium">
                          {COPILOT_OBJECTION_LABELS[entry.objection]}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="w-full sm:w-auto sm:max-w-[82%] rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 space-y-1.5">
                    <p className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
                      {entry.clientMessageEn}
                    </p>
                    {entry.clientMessagePt && (
                      <p className="text-xs text-slate-500 pt-1.5 border-t border-slate-100 whitespace-pre-wrap">
                        Tradução: {entry.clientMessagePt}
                      </p>
                    )}
                    {entry.realIntentPt && (
                      <p className="text-[11px] text-slate-500">
                        Intenção: {entry.realIntentPt}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {entry.sentReplyEn && (
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1 px-1">
                    <span>
                      {idx === 0 && entry.kind === 'initial_quote'
                        ? 'Dani · Orçamento inicial'
                        : `Dani · Dia ${entry.step}`}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatMessageTime(entry.createdAt)}
                    </span>
                  </div>
                  <div className="w-full sm:w-auto sm:max-w-[82%] rounded-xl bg-[#EAF4F6] border border-[#0B6273]/25 px-3.5 py-2.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
                        {entry.sentReplyEn}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(entry.sentReplyEn, () => {
                            setCopiedTurnId(entry.id);
                            window.setTimeout(() => setCopiedTurnId(null), 1800);
                          })
                        }
                        title="Copiar esta mensagem"
                        className="p-1.5 rounded-md text-[#0B6273] hover:bg-white/70 transition-colors shrink-0"
                      >
                        {copiedTurnId === entry.id ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    {entry.sentReplyPt && (
                      <p className="text-xs text-slate-600 pt-1.5 border-t border-[#0B6273]/15 whitespace-pre-wrap">
                        PT: {entry.sentReplyPt}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Área contínua para colar a próxima mensagem da cliente */}
      <div className="space-y-3 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="copilot-client-message"
            className="text-sm font-bold text-[#0B6273]"
          >
            Cole aqui a mensagem da cliente (em inglês)
          </label>
          <span className="text-xs text-slate-500">
            {calendarVerified && calendarAvailability?.verifiedSlots.length ? (
              <>
                Horários livres verificados no Google Calendar:{' '}
                <strong className="text-slate-700">
                  {calendarAvailability.verifiedSlots.map((s) => s.en).join(' ou ')}
                </strong>
              </>
            ) : (
              <>
                Sugestões de datas (a confirmar na agenda)
                {resolvedDates.isFixedCityDay
                  ? ` (${lead.city} · ${resolvedDates.fixedWeekdayPt})`
                  : ''}
                :{' '}
                <strong className="text-slate-700">
                  {resolvedDates.dates[0].en}
                </strong>{' '}
                ou{' '}
                <strong className="text-slate-700">
                  {resolvedDates.dates[1].en}
                </strong>
              </>
            )}
          </span>
        </div>

        <textarea
          id="copilot-client-message"
          rows={3}
          value={copilotClientInput}
          onChange={(e) => {
            setCopilotClientInput(e.target.value);
            setCopilotError(null);
            setCopilotSentFeedback(null);
          }}
          placeholder='Cole aqui a resposta que a cliente mandou (ex: "Hi, what cleaning services do you offer and how much for a 3-bedroom home?")'
          className="w-full p-3.5 rounded-lg border-2 border-[#0B6273]/40 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleAnalyzeCopilot}
            disabled={isCopilotLoading || !copilotClientInput.trim()}
            className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            <span>
              {isCopilotLoading
                ? 'Analisando conversa...'
                : 'Analisar e gerar próxima resposta'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleLogClientOnly}
            disabled={isCopilotLoading || !copilotClientInput.trim()}
            className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-3.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs sm:text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquarePlus className="w-4 h-4" />
            <span>Só registrar msg da cliente</span>
          </button>
        </div>

        {copilotError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {copilotError}
          </div>
        )}

        {copilotSentFeedback && (
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{copilotSentFeedback}</span>
          </div>
        )}
      </div>

      {/* Leitura estratégica + Rascunho editável da próxima resposta */}
      {copilotResult && (
        <div className="space-y-4 pt-4 border-t border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <span className="text-xs font-semibold text-slate-600 block">
                (a) Tradução fiel em português
              </span>
              <p className="text-sm text-slate-800">
                {copilotResult.clientMessagePt}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <span className="text-xs font-semibold text-slate-600 block">
                (b) O que a cliente quer de verdade
              </span>
              <p className="text-sm font-medium text-slate-900">
                {copilotResult.realIntentPt}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200 space-y-1">
              <span className="text-xs font-semibold text-amber-800 block">
                (c) Objeção identificada
              </span>
              <p className="text-sm font-semibold text-amber-950">
                {COPILOT_OBJECTION_LABELS[copilotResult.identifiedObjection]}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[#EAF4F6]/80 border border-[#0B6273]/25 space-y-1.5">
              <span className="text-xs font-semibold text-[#0B6273] block">
                (d) Estratégia recomendada
              </span>
              <p className="text-sm text-slate-900">
                {copilotResult.recommendedStrategyPt}
              </p>
              {copilotResult.nextMoveHintPt && (
                <p className="text-xs text-[#084E5C] pt-1 border-t border-[#0B6273]/15">
                  <strong>Próximo passo:</strong> {copilotResult.nextMoveHintPt}
                </p>
              )}
              {shouldHighlightConcessionShortcut && onJumpToConcessions && (
                <button
                  type="button"
                  onClick={onJumpToConcessions}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B6273] hover:underline pt-0.5"
                >
                  <Gift className="w-3.5 h-3.5" />
                  <span>Quer oferecer extra de valor ou preço competitivo? Ir para Concessões</span>
                </button>
              )}
            </div>
          </div>

          {copilotResult.needsDaniConfirmation ? (
            <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-400 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
                <span>Confirmar com a Dani</span>
              </div>
              <p className="text-xs sm:text-sm text-amber-900">
                {copilotResult.confirmWithDaniReasonPt ||
                  'A cliente perguntou algo que não está em Fatos da empresa. Nenhuma resposta foi gerada para não inventar informações.'}
              </p>
              <p className="text-xs text-amber-800">
                Você pode clicar em &ldquo;Só registrar msg da cliente&rdquo; acima após conferir com a Dani.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#0B6273]">
                    (e) Próxima resposta (Inglês Americano)
                  </label>
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      copilotCompliance.wordCount > 60
                        ? 'text-red-600 font-semibold'
                        : 'text-slate-500'
                    }`}
                  >
                    {copilotCompliance.wordCount} / 60 palavras
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={copilotReplyEn}
                  onChange={(e) => setCopilotReplyEn(e.target.value)}
                  className="w-full p-3 rounded-lg border border-slate-300 text-base text-slate-900 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Tradução da resposta (Português)
                </label>
                <textarea
                  rows={4}
                  value={copilotReplyPt}
                  onChange={(e) => setCopilotReplyPt(e.target.value)}
                  className="w-full p-3 rounded-lg border border-slate-200 text-base text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25"
                />
              </div>
            </div>
          )}

          {allCopilotViolations.length > 0 &&
            (copilotReplyEn.trim() || copilotReplyPt.trim()) && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-300 text-xs font-semibold text-red-700 space-y-1">
                {allCopilotViolations.map((v) => (
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

          {copilotNameCheck.hasMismatch && copilotReplyEn.trim() && (
            <div className="p-2.5 rounded-md bg-red-50 border border-red-300 flex items-center gap-2 text-xs font-semibold text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Confira o nome antes de enviar. (Cadastro:{' '}
                {copilotNameCheck.expectedFirstName} · Mensagem:{' '}
                {copilotNameCheck.detectedName})
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {!copilotResult.needsDaniConfirmation && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    !copilotCopyBlocked &&
                    copyText(copilotReplyEn, () => {
                      setCopilotCopied(true);
                      window.setTimeout(() => setCopilotCopied(false), 2200);
                    })
                  }
                  disabled={copilotCopyBlocked}
                  title={
                    allCopilotViolations.length > 0
                      ? allCopilotViolations.join(' · ')
                      : 'Copiar resposta em inglês'
                  }
                  className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
                >
                  {copilotCopied ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copiar resposta</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleMarkCopilotReplySent}
                  disabled={!copilotReplyEn.trim()}
                  className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 rounded-lg border border-[#0B6273] text-[#0B6273] bg-white text-sm font-medium hover:bg-[#EAF4F6] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Send className="w-4 h-4" />
                  <span>Registrar na conversa e preparar próxima</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleDiscardDraft}
              className="inline-flex items-center justify-center gap-1.5 h-11 sm:h-10 px-3 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpar rascunho</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
