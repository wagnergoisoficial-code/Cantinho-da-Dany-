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
import { buildQuoteMessages, countWords } from '../utils/messageBuilder';
import { formatOfficialCityName } from '../utils/cityFormatter';
import {
  WEEKDAY_CHOICES,
  normalizeWeekdayName,
  resolveDateOptionsForCity,
} from '../utils/dateOptions';
import {
  checkNameMismatch,
  validateNegotiationCompliance,
  validateSimplePunctuation,
} from '../utils/negotiationEngine';
import { VISITA_AVULSA_LABELS } from '../data/defaultPricing';

interface MessageAndHistoryLayerProps {
  input: LeadInputState;
  calc: PriceCalculationResult;
  finalPrimaryPrice: number;
  finalRecurringPrice: number | null;
  deepCleanRangeMarginPercent: number;
  servedCities: string[];
  cityFixedDays: CityFixedDayRule[];
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
  onChangeDays,
  onSaveToHistory,
  onSaveAndOpenConversation,
  onOpenLastSavedConversation,
  justSaved,
  saveError,
}) => {
  const [copied, setCopied] = useState(false);

  const missingName = !input.clientName.trim();
  const missingOrigin = !input.origin;
  const missingCity = !input.city.trim();

  const { english, portuguese } = buildQuoteMessages(
    input,
    calc,
    finalPrimaryPrice,
    finalRecurringPrice,
    deepCleanRangeMarginPercent,
    servedCities,
    new Date(),
    cityFixedDays
  );

  const wordCount = countWords(english);
  const compliance = validateNegotiationCompliance(english);
  const ptPunctuationIssues = validateSimplePunctuation(portuguese);
  const allViolations = Array.from(
    new Set([...compliance.violations, ...ptPunctuationIssues])
  );

  const copyBlocked =
    missingName || missingOrigin || missingCity || allViolations.length > 0;

  const missingFieldAlerts: string[] = [];
  if (missingName) missingFieldAlerts.push('Preencha o nome');
  if (missingOrigin) missingFieldAlerts.push('Preencha a origem');
  if (missingCity) missingFieldAlerts.push('Preencha a cidade');

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
    try {
      await navigator.clipboard.writeText(english);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = english;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <span className="text-xs font-medium text-[#0B6273]">Camada 4</span>
          <h2 className="text-lg font-semibold text-slate-900">
            Mensagem pronta e registro no histórico
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Usa sempre o Preço final informado na Camada 2 e datas reais sem feriados.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleCopy}
            disabled={copyBlocked}
            title={
              copyBlocked
                ? [...missingFieldAlerts, ...allViolations].join(' · ')
                : 'Copiar mensagem em inglês'
            }
            className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-3 sm:px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
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
            onClick={onSaveToHistory}
            className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-3 sm:px-4 rounded-lg border border-[#0B6273] text-[#0B6273] bg-white text-sm font-medium hover:bg-[#EAF4F6] transition-colors whitespace-nowrap shrink-0"
          >
            <BookmarkCheck className="w-4 h-4" />
            <span className="truncate">
              {justSaved ? 'Salvo como Enviado' : 'Salvar no histórico'}
            </span>
          </button>

          {onSaveAndOpenConversation && (
            <button
              type="button"
              onClick={onSaveAndOpenConversation}
              className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-3 sm:px-4 rounded-lg border border-slate-300 text-slate-800 bg-slate-50 text-sm font-medium hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <MessageSquare className="w-4 h-4 text-[#0B6273]" />
              <span>Salvar e abrir conversa</span>
            </button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-300 flex items-center gap-2 text-xs font-semibold text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {justSaved && onOpenLastSavedConversation && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
          <span>
            Lead salvo com a mensagem inicial. Quando a cliente responder,
            continue a conversa por lá.
          </span>
          <button
            type="button"
            onClick={onOpenLastSavedConversation}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#0B6273] text-white font-medium hover:bg-[#084E5C] whitespace-nowrap shrink-0"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Abrir espaço de conversa</span>
          </button>
        </div>
      )}

      {/* Checagem antes de copiar */}
      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
          <span>
            <strong>Nome:</strong> {input.clientName.trim() || 'Não informado'}
          </span>
          <span>
            <strong>Cidade:</strong> {input.city.trim() || 'Não informada'}
          </span>
          <span>
            <strong>Tamanho:</strong> {houseSizeSummary}
          </span>
          <span>
            <strong>Origem:</strong>{' '}
            {input.origin
              ? input.origin === 'Facebook' && input.adCode.trim()
                ? `Facebook (${input.adCode.trim()})`
                : input.origin
              : 'Não informada'}
          </span>
        </div>
        {missingFieldAlerts.length > 0 && (
          <div className="p-2.5 rounded bg-red-50 border border-red-300 flex items-start gap-2 text-xs font-semibold text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {missingFieldAlerts.join(' · ')} antes de copiar a mensagem.
            </span>
          </div>
        )}
        {allViolations.length > 0 && (
          <div className="p-2.5 rounded bg-red-50 border border-red-300 text-xs font-semibold text-red-700 space-y-1">
            {allViolations.map((v) => (
              <div key={v} className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{v}</span>
              </div>
            ))}
          </div>
        )}
        {nameCheck.hasMismatch && (
          <div className="p-2 rounded bg-red-50 border border-red-300 flex items-center gap-2 text-xs font-semibold text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Confira o nome antes de enviar.</span>
          </div>
        )}
      </div>

      {/* Opções de data: Deep clean pede fotos sem datas; cidades com dia fixo usam o dia configurado */}
      {input.serviceType === 'deep_clean' ? (
        <div className="p-3 rounded-lg bg-[#EAF4F6]/70 border border-[#0B6273]/20 text-xs text-slate-700">
          <strong>Deep cleaning:</strong> a primeira mensagem envia a faixa de
          preço e pede 3 fotos ou vídeo curto sem oferecer datas. Ao salvar, o
          lead vai automaticamente para <strong>Aguardando fotos</strong>.
        </div>
      ) : resolvedCityDates.isFixedCityDay ? (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
          <strong>
            Dia fixo para {formatOfficialCityName(input.city)}:{' '}
            {resolvedCityDates.fixedWeekdayPt}.
          </strong>{' '}
          Datas oferecidas na mensagem:{' '}
          <span className="font-medium text-slate-900">{resolvedDate1.en}</span>{' '}
          ou{' '}
          <span className="font-medium text-slate-900">{resolvedDate2.en}</span>
          .
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label
                htmlFor="dayOption1"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Dia da semana 1
              </label>
              <select
                id="dayOption1"
                value={day1Value}
                onChange={(e) => onChangeDays(e.target.value, day2Value)}
                className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 text-base text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
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
                Dia da semana 2
              </label>
              <select
                id="dayOption2"
                value={day2Value}
                onChange={(e) => onChangeDays(day1Value, e.target.value)}
                className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 text-base text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
              >
                {WEEKDAY_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.labelPt}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Datas oferecidas na mensagem:{' '}
            <span className="font-medium text-slate-700">
              {resolvedDate1.en}
            </span>{' '}
            ou{' '}
            <span className="font-medium text-slate-700">
              {resolvedDate2.en}
            </span>
            .
          </p>
        </div>
      )}

      {/* Mensagem em Inglês + Tradução em Português */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <div className="border border-slate-200 rounded-lg p-3.5 sm:p-4 bg-slate-50/50 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-[#0B6273]">
              Mensagem pronta (Inglês Americano)
            </h3>
            <span
              className={`text-xs font-mono tabular-nums shrink-0 ${
                wordCount > 60 ? 'text-red-600 font-semibold' : 'text-slate-500'
              }`}
            >
              {wordCount}/60 palavras
            </span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-900 leading-relaxed">
            {english}
          </pre>
        </div>

        <div className="border border-slate-200 rounded-lg p-3.5 sm:p-4 bg-white space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-700">
              Tradução em Português
            </h3>
            <span className="text-xs text-slate-500 shrink-0">
              Conferência rápida
            </span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-700 leading-relaxed">
            {portuguese}
          </pre>
        </div>
      </div>
    </section>
  );
};
