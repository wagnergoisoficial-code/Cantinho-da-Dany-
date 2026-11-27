import React, { useState } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  Check,
  Copy,
  MessageSquare,
} from 'lucide-react';
import {
  CityFixedDayRule,
  LeadInputState,
  PriceCalculationResult,
} from '../types/pricing';
import { copyTextToClipboard, useQuoteMessage } from '../hooks/useQuoteMessage';
import { formatOfficialCityName } from '../utils/cityFormatter';
import {
  WEEKDAY_CHOICES,
  normalizeWeekdayName,
  resolveDateOptionsForCity,
} from '../utils/dateOptions';
import { checkNameMismatch } from '../utils/negotiationEngine';
import { CalendarAvailabilityResult } from '../utils/googleCalendarApi';
import { VISITA_AVULSA_LABELS } from '../data/defaultPricing';

interface MessageAndHistoryLayerProps {
  input: LeadInputState;
  calc: PriceCalculationResult;
  finalPrimaryPrice: number;
  finalRecurringPrice: number | null;
  deepCleanRangeMarginPercent: number;
  servedCities: string[];
  cityFixedDays: CityFixedDayRule[];
  calendarAvailability?: CalendarAvailabilityResult | null;
  onChangeDays: (day1: string, day2: string) => void;
  onSaveToHistory: () => void;
  onSaveAndOpenConversation?: () => void;
  onOpenLastSavedConversation?: () => void;
  justSaved: boolean;
  saveError?: string | null;
}

export const MessageAndHistoryLayer: React.FC<MessageAndHistoryLayerProps> = ({
  input,
  calc,
  finalPrimaryPrice,
  finalRecurringPrice,
  deepCleanRangeMarginPercent,
  servedCities,
  cityFixedDays,
  calendarAvailability,
  onChangeDays,
  onSaveToHistory,
  onSaveAndOpenConversation,
  onOpenLastSavedConversation,
  justSaved,
  saveError,
}) => {
  const [copied, setCopied] = useState(false);
  const [previewLang, setPreviewLang] = useState<'en' | 'pt'>('en');

  const {
    calendarVerified,
    english,
    portuguese,
    wordCount,
    allViolations,
    missingName,
    missingFieldAlerts,
    copyBlocked,
  } = useQuoteMessage({
    input,
    calc,
    finalPrimaryPrice,
    finalRecurringPrice,
    deepCleanRangeMarginPercent,
    servedCities,
    cityFixedDays,
    calendarAvailability,
  });

  const resolvedCityDates = resolveDateOptionsForCity(
    input.city,
    cityFixedDays,
    input.dayOption1,
    input.dayOption2
  );
  const [resolvedDate1, resolvedDate2] = resolvedCityDates.dates;
  const day1Value = normalizeWeekdayName(input.dayOption1, 'Tuesday');
  const day2Value = normalizeWeekdayName(input.dayOption2, 'Thursday');

  const nameCheck = missingName
    ? { hasMismatch: false, expectedFirstName: '' }
    : checkNameMismatch(input.clientName, english);
  const houseSizeSummary = calc.isVisitaAvulsa
    ? `Visita avulsa · ${VISITA_AVULSA_LABELS[input.visitaAvulsaOption]}`
    : `${calc.effectiveTier.label}${
        calc.parsedSqFt ? ` · ${calc.parsedSqFt} sq ft` : ''
      }`;

  const handleCopy = async () => {
    if (copyBlocked) return;
    await copyTextToClipboard(english);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  return (
    <section className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            04. Proposta pronta
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Usa o preço final e datas reais sem feriados.
          </p>
        </div>

        <span
          className={`text-xs font-mono tabular-nums ${
            wordCount > 60 ? 'text-red-600 font-semibold' : 'text-slate-500'
          }`}
        >
          {wordCount}/60 palavras
        </span>
      </div>

      {/* Resumo compacto de checagem */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
        <span className="font-medium text-slate-900">
          {input.clientName.trim() || 'Sem nome'}
        </span>
        <span className="text-slate-300" aria-hidden="true">
          ·
        </span>
        <span>{input.city.trim() || 'Sem cidade'}</span>
        <span className="text-slate-300" aria-hidden="true">
          ·
        </span>
        <span>{houseSizeSummary}</span>
        <span className="text-slate-300" aria-hidden="true">
          ·
        </span>
        <span>
          {input.origin
            ? input.origin === 'Facebook' && input.adCode.trim()
              ? `Facebook (${input.adCode.trim()})`
              : input.origin
            : 'Sem origem'}
        </span>
      </div>

      {missingFieldAlerts.length > 0 && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-xs font-medium text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {missingFieldAlerts.join(' · ')} antes de copiar a mensagem.
          </span>
        </div>
      )}

      {allViolations.length > 0 && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700 space-y-1">
          {allViolations.map((v) => (
            <div key={v} className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{v}</span>
            </div>
          ))}
        </div>
      )}

      {nameCheck.hasMismatch && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 text-xs font-medium text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Confira o nome antes de enviar.</span>
        </div>
      )}

      {/* Opções de data */}
      {input.serviceType === 'deep_clean' ? (
        <div className="p-3 rounded-xl bg-[#EAF4F6]/70 border border-[#0B6273]/20 text-xs text-slate-700">
          <strong>Deep cleaning:</strong> envia a faixa de preço e pede 3 fotos
          ou vídeo curto sem oferecer datas. Ao salvar, entra em{' '}
          <strong>Aguardando fotos</strong>.
        </div>
      ) : resolvedCityDates.isFixedCityDay ? (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
          <div>
            <strong>
              Dia fixo ({formatOfficialCityName(input.city)}):{' '}
              {resolvedCityDates.fixedWeekdayPt}.
            </strong>{' '}
            {calendarVerified && calendarAvailability?.verifiedSlots.length
              ? 'Livres no Google Calendar:'
              : 'Datas de referência (a confirmar):'}{' '}
            {calendarVerified && calendarAvailability?.verifiedSlots.length ? (
              <span className="font-medium text-slate-900">
                {calendarAvailability.verifiedSlots.map((s) => s.pt).join(' · ')}
              </span>
            ) : (
              <>
                <span className="font-medium text-slate-900">
                  {resolvedDate1.en}
                </span>{' '}
                ou{' '}
                <span className="font-medium text-slate-900">
                  {resolvedDate2.en}
                </span>
                .
              </>
            )}
          </div>
          {!calendarVerified && (
            <div className="text-[11px] text-slate-500">
              Agenda desconectada ou sem horário livre confirmado: o rascunho
              pergunta a preferência e avisa que a disponibilidade será
              confirmada.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="dayOption1"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Dia opção 1
              </label>
              <select
                id="dayOption1"
                value={day1Value}
                onChange={(e) => onChangeDays(e.target.value, day2Value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/70 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/20 focus:border-[#0B6273]"
              >
                {WEEKDAY_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.labelPt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="dayOption2"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Dia opção 2
              </label>
              <select
                id="dayOption2"
                value={day2Value}
                onChange={(e) => onChangeDays(day1Value, e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/70 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/20 focus:border-[#0B6273]"
              >
                {WEEKDAY_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.labelPt}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {calendarVerified && calendarAvailability?.verifiedSlots.length ? (
              <>
                Livres no Google Calendar:{' '}
                <span className="font-medium text-slate-700">
                  {calendarAvailability.verifiedSlots
                    .map((s) => s.en)
                    .join(' ou ')}
                </span>
                .
              </>
            ) : (
              <>
                Referência: {resolvedDate1.en} ou {resolvedDate2.en}. Sem
                horário confirmado na agenda, o texto pergunta a preferência e
                informa que vai confirmar disponibilidade.
              </>
            )}
          </p>
        </div>
      )}

      {/* Controle segmentado EN / PT */}
      <div className="space-y-2.5">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setPreviewLang('en')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              previewLang === 'en'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Inglês (enviar)
          </button>
          <button
            type="button"
            onClick={() => setPreviewLang('pt')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              previewLang === 'pt'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tradução PT
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-900 leading-relaxed">
            {previewLang === 'en' ? english : portuguese}
          </pre>
        </div>
      </div>

      {/* Ações principais */}
      <div className="space-y-2.5 pt-1">
        <button
          type="button"
          onClick={handleCopy}
          disabled={copyBlocked}
          title={
            copyBlocked
              ? [...missingFieldAlerts, ...allViolations].join(' · ')
              : 'Copiar mensagem em inglês'
          }
          className="w-full inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-[#0B6273] text-white text-sm font-semibold hover:bg-[#084E5C] disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" />
              <span>Mensagem copiada</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              <span>Copiar mensagem em inglês</span>
            </>
          )}
        </button>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onSaveToHistory}
            className="inline-flex items-center justify-center gap-2 h-10 px-3 rounded-xl border border-slate-300 text-slate-800 bg-white text-xs sm:text-sm font-medium hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <BookmarkCheck className="w-4 h-4 text-[#0B6273]" />
            <span className="truncate">
              {justSaved ? 'Salvo como Enviado' : 'Salvar no histórico'}
            </span>
          </button>

          {onSaveAndOpenConversation && (
            <button
              type="button"
              onClick={onSaveAndOpenConversation}
              className="inline-flex items-center justify-center gap-2 h-10 px-3 rounded-xl border border-[#0B6273]/30 text-[#0B6273] bg-[#EAF4F6]/60 text-xs sm:text-sm font-medium hover:bg-[#EAF4F6] transition-colors whitespace-nowrap"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Salvar e abrir conversa</span>
            </button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 text-xs font-medium text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {justSaved && onOpenLastSavedConversation && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
          <span>Lead salvo com a mensagem inicial.</span>
          <button
            type="button"
            onClick={onOpenLastSavedConversation}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#0B6273] text-white font-medium hover:bg-[#084E5C] whitespace-nowrap shrink-0"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Abrir conversa</span>
          </button>
        </div>
      )}
    </section>
  );
};
