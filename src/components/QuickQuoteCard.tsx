import React, { useState } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  Check,
  Copy,
  MessageCircle,
  Smartphone,
  Zap,
} from 'lucide-react';
import {
  CityFixedDayRule,
  LeadInputState,
  LeadOrigin,
  PriceCalculationResult,
} from '../types/pricing';
import { LEAD_ORIGIN_OPTIONS } from '../data/defaultPricing';
import { computeDeepCleanRangeMax } from '../utils/pricingEngine';
import {
  buildSmsLink,
  buildWhatsAppLink,
  copyTextToClipboard,
  useQuoteMessage,
} from '../hooks/useQuoteMessage';

interface QuickQuoteCardProps {
  input: LeadInputState;
  calc: PriceCalculationResult;
  finalPrimaryPrice: number;
  finalRecurringPrice: number | null;
  deepCleanRangeMarginPercent: number;
  servedCities: string[];
  cityFixedDays: CityFixedDayRule[];
  onChangeInput: (updater: (prev: LeadInputState) => LeadInputState) => void;
  onSaveToHistory: () => void;
  justSaved: boolean;
  saveError?: string | null;
}

const inputClass =
  'w-full h-11 px-3 rounded-lg border border-red-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]';

export const QuickQuoteCard: React.FC<QuickQuoteCardProps> = ({
  input,
  calc,
  finalPrimaryPrice,
  finalRecurringPrice,
  deepCleanRangeMarginPercent,
  servedCities,
  cityFixedDays,
  onChangeInput,
  onSaveToHistory,
  justSaved,
  saveError,
}) => {
  const [copied, setCopied] = useState(false);

  const {
    english,
    allViolations,
    missingName,
    missingOrigin,
    missingCity,
    copyBlocked,
  } = useQuoteMessage({
    input,
    calc,
    finalPrimaryPrice,
    finalRecurringPrice,
    deepCleanRangeMarginPercent,
    servedCities,
    cityFixedDays,
  });

  const isDeepClean = input.serviceType === 'deep_clean';
  const deepCleanMax = isDeepClean
    ? Math.max(
        finalPrimaryPrice,
        computeDeepCleanRangeMax(finalPrimaryPrice, deepCleanRangeMarginPercent)
      )
    : null;

  const hasPhone = input.phone.replace(/\D/g, '').length > 0;
  const whatsappHref = buildWhatsAppLink(input.phone, english);
  const smsHref = buildSmsLink(input.phone, english);

  const handleCopy = async () => {
    if (copyBlocked) return;
    await copyTextToClipboard(english);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const blockedLinkProps = (href: string) =>
    copyBlocked
      ? {
          'aria-disabled': true,
          onClick: (e: React.MouseEvent) => e.preventDefault(),
          className:
            'pointer-events-none bg-slate-300 text-slate-500 cursor-not-allowed',
        }
      : {
          href,
          target: href.startsWith('http') ? '_blank' : undefined,
          rel: 'noopener noreferrer',
          className: '',
        };

  const wa = blockedLinkProps(whatsappHref);
  const sms = blockedLinkProps(smsHref);

  return (
    <section className="bg-white border-2 border-[#0B6273] rounded-xl p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-[#0B6273]" />
        <span className="text-xs font-medium text-[#0B6273]">
          Orçamento em 30 segundos
        </span>
      </div>

      {/* Preço */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-slate-500">
            {isDeepClean ? 'Faixa de preço' : calc.primaryLabel}
          </p>
          <p className="text-4xl sm:text-5xl font-bold text-slate-900 tabular-nums leading-tight">
            {isDeepClean
              ? `$${finalPrimaryPrice} a $${deepCleanMax}`
              : `$${finalPrimaryPrice}`}
          </p>
        </div>
        {finalRecurringPrice !== null && (
          <div>
            <p className="text-xs text-slate-500">
              {calc.recurringLabel ?? 'Manutenção'}
            </p>
            <p className="text-2xl sm:text-3xl font-semibold text-[#0B6273] tabular-nums leading-tight">
              ${finalRecurringPrice}
              <span className="text-sm font-normal text-slate-500">
                {' '}
                por visita
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Campos que faltam para liberar o envio */}
      {(missingName || missingCity || missingOrigin) && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 space-y-2.5">
          <p className="flex items-center gap-2 text-xs font-semibold text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Falta só isso para liberar o envio:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {missingName && (
              <input
                type="text"
                aria-label="Nome do cliente"
                placeholder="Nome do cliente"
                className={inputClass}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value)
                    onChangeInput((prev) => ({ ...prev, clientName: value }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            )}
            {missingCity && (
              <input
                type="text"
                aria-label="Cidade"
                placeholder="Cidade"
                className={inputClass}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value) onChangeInput((prev) => ({ ...prev, city: value }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            )}
            {missingOrigin && (
              <select
                aria-label="Origem do lead"
                value=""
                className={inputClass}
                onChange={(e) =>
                  onChangeInput((prev) => ({
                    ...prev,
                    origin: e.target.value as LeadOrigin,
                  }))
                }
              >
                <option value="">Origem do lead...</option>
                {LEAD_ORIGIN_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {allViolations.length > 0 && (
        <div className="p-2.5 rounded-lg bg-red-50 border border-red-300 text-xs font-semibold text-red-700 space-y-1">
          {allViolations.map((v) => (
            <div key={v} className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Mensagem pronta */}
      <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/60">
        <h3 className="text-xs font-semibold text-[#0B6273] mb-1.5">
          Mensagem pronta (Inglês)
        </h3>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-900 leading-relaxed">
          {english}
        </pre>
      </div>

      {/* Ações */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <a
          {...wa}
          className={`inline-flex items-center justify-center gap-2 h-12 px-4 rounded-lg text-sm font-semibold transition-colors ${
            wa.className || 'bg-[#25D366] text-white hover:bg-[#1EB656]'
          }`}
        >
          <MessageCircle className="w-5 h-5" />
          <span>Enviar no WhatsApp</span>
        </a>
        <a
          {...sms}
          className={`inline-flex items-center justify-center gap-2 h-12 px-4 rounded-lg text-sm font-semibold transition-colors ${
            sms.className || 'bg-[#0B6273] text-white hover:bg-[#084E5C]'
          }`}
        >
          <Smartphone className="w-5 h-5" />
          <span>Enviar por SMS</span>
        </a>
        <button
          type="button"
          onClick={handleCopy}
          disabled={copyBlocked}
          className="inline-flex items-center justify-center gap-2 h-12 px-4 rounded-lg border border-[#0B6273] text-[#0B6273] bg-white text-sm font-semibold hover:bg-[#EAF4F6] disabled:border-slate-300 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-5 h-5" />
              <span>Copiado</span>
            </>
          ) : (
            <>
              <Copy className="w-5 h-5" />
              <span>Copiar mensagem</span>
            </>
          )}
        </button>
      </div>

      {saveError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-300 flex items-center gap-2 text-xs font-semibold text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {hasPhone
            ? `Envia para ${input.phone.trim()}.`
            : 'Sem telefone no lead: o WhatsApp e o SMS vão pedir o contato.'}
        </span>
        <button
          type="button"
          onClick={onSaveToHistory}
          className="inline-flex items-center gap-1.5 font-medium text-[#0B6273] hover:underline py-1"
        >
          <BookmarkCheck className="w-4 h-4" />
          <span>{justSaved ? 'Salvo como Enviado' : 'Salvar no histórico'}</span>
        </button>
      </div>
    </section>
  );
};
