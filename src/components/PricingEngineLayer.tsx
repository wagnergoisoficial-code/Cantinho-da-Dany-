import React from 'react';
import { RotateCcw } from 'lucide-react';
import { PriceCalculationResult, ServiceType } from '../types/pricing';
import { computeDeepCleanRangeMax } from '../utils/pricingEngine';

interface PricingEngineLayerProps {
  calc: PriceCalculationResult;
  serviceType: ServiceType;
  deepCleanRangeMarginPercent: number;
  promoPercent: string;
  promoName: string;
  onChangePromoPercent: (value: string) => void;
  onChangePromoName: (value: string) => void;
  finalPrimaryPrice: number;
  isPrimaryCustom: boolean;
  onChangeFinalPrimary: (value: number) => void;
  onResetPrimaryToTable: () => void;
  finalRecurringPrice: number | null;
  isRecurringCustom: boolean;
  onChangeFinalRecurring: (value: number) => void;
  onResetRecurringToTable: () => void;
}

export const PricingEngineLayer: React.FC<PricingEngineLayerProps> = ({
  calc,
  serviceType,
  deepCleanRangeMarginPercent,
  promoPercent,
  promoName,
  onChangePromoPercent,
  onChangePromoName,
  finalPrimaryPrice,
  isPrimaryCustom,
  onChangeFinalPrimary,
  onResetPrimaryToTable,
  finalRecurringPrice,
  isRecurringCustom,
  onChangeFinalRecurring,
  onResetRecurringToTable,
}) => {
  const hasPromo = calc.promoPercent > 0 && calc.primaryPromoPrice !== null;
  const deepCleanRangeMax =
    serviceType === 'deep_clean'
      ? Math.max(
          finalPrimaryPrice,
          computeDeepCleanRangeMax(finalPrimaryPrice, deepCleanRangeMarginPercent)
        )
      : null;

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-4">
        <div>
          <span className="text-xs font-medium text-[#0B6273]">Camada 2</span>
          <h2 className="text-lg font-semibold text-slate-900">
            Motor de preço
          </h2>
        </div>
        <span className="text-xs text-slate-500">
          Preço da tabela arredondado para o múltiplo de $5 mais próximo
        </span>
      </div>

      {/* Campo editável de Promoção (%) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 bg-[#F0F7F9]/70 border border-[#0B6273]/20 rounded-xl p-3.5 sm:p-4">
        <div>
          <label
            htmlFor="promoPercent"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Promoção (%) — desconto sobre o Preço da tabela
          </label>
          <div className="flex items-center gap-2">
            <input
              id="promoPercent"
              type="number"
              min={0}
              max={100}
              step={1}
              value={promoPercent}
              onChange={(e) => onChangePromoPercent(e.target.value)}
              placeholder="0"
              className="w-28 h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
            />
            <span className="text-sm font-medium text-slate-600">%</span>
          </div>
        </div>

        <div>
          <label
            htmlFor="promoName"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Nome da oferta (opcional, citado na mensagem)
          </label>
          <input
            id="promoName"
            type="text"
            value={promoName}
            onChange={(e) => onChangePromoName(e.target.value)}
            placeholder="Ex: Thanksgiving"
            className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
          />
        </div>
      </div>

      {/* Blocos de Preço da tabela + Preço com promoção + Preço final editável */}
      <div
        className={`grid gap-5 ${
          calc.isRecurring ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {/* Bloco 1: Serviço Principal / Primeira Limpeza */}
        <div className="border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 bg-slate-50/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {calc.primaryLabel}
            </h3>
            {isPrimaryCustom && (
              <button
                type="button"
                onClick={onResetPrimaryToTable}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#0B6273] hover:underline whitespace-nowrap py-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>
                  {hasPromo
                    ? 'Voltar ao preço com promoção'
                    : 'Voltar ao preço da tabela'}
                </span>
              </button>
            )}
          </div>

          <div
            className={`grid grid-cols-1 ${
              hasPromo ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
            } gap-3 sm:gap-4`}
          >
            <div className="bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4">
              <span className="block text-xs text-slate-500 mb-1">
                Preço da tabela
              </span>
              <span
                className={`text-2xl font-bold font-mono tabular-nums ${
                  hasPromo ? 'text-slate-400 line-through' : 'text-slate-900'
                }`}
              >
                ${calc.primaryTablePrice}
              </span>
            </div>

            {hasPromo && (
              <div className="bg-emerald-50/70 border border-emerald-300 rounded-lg p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-xs font-medium text-emerald-800">
                    Preço com promoção
                  </span>
                  <span className="text-xs font-mono font-semibold text-emerald-700">
                    -{calc.promoPercent}%
                  </span>
                </div>
                <span className="text-2xl font-bold font-mono tabular-nums text-emerald-800">
                  ${calc.primaryPromoPrice}
                </span>
              </div>
            )}

            <div className="bg-white border border-[#0B6273]/40 rounded-lg p-3.5 sm:p-4">
              <label
                htmlFor="finalPrimaryPrice"
                className="block text-xs font-medium text-[#0B6273] mb-1"
              >
                Preço final (editável na hora)
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-mono font-semibold text-slate-500">
                  $
                </span>
                <input
                  id="finalPrimaryPrice"
                  type="number"
                  min={0}
                  step={1}
                  value={finalPrimaryPrice}
                  onChange={(e) =>
                    onChangeFinalPrimary(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full text-2xl font-bold font-mono tabular-nums text-[#0B6273] bg-transparent focus:outline-none"
                />
              </div>
            </div>
          </div>

          {deepCleanRangeMax !== null && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg bg-[#EAF4F6] border border-[#0B6273]/30 text-xs text-[#0B6273]">
              <span className="font-medium">
                Faixa usada na mensagem inicial do Deep clean (+{deepCleanRangeMarginPercent}%):
              </span>
              <span className="text-sm font-bold font-mono tabular-nums">
                ${finalPrimaryPrice} a ${deepCleanRangeMax}
              </span>
            </div>
          )}

          {/* Detalhamento */}
          <div className="space-y-1.5 pt-2 border-t border-slate-200/70">
            {calc.primaryBreakdown.map((line, idx) => (
              <div
                key={`${line.label}-${idx}`}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <div className="text-slate-600">
                  <span>{line.label}</span>
                  {line.note && (
                    <span className="text-[#0B6273] ml-1.5">· {line.note}</span>
                  )}
                </div>
                <span
                  className={`font-mono tabular-nums shrink-0 ${
                    line.included
                      ? 'text-[#0B6273] font-medium'
                      : 'text-slate-800'
                  }`}
                >
                  {line.included ? 'incluído' : `$${line.amount}`}
                </span>
              </div>
            ))}
            {hasPromo && (
              <div className="flex items-baseline justify-between gap-2 text-xs pt-1 border-t border-slate-200/60">
                <span className="text-emerald-700 font-medium">
                  Promoção (-{calc.promoPercent}%
                  {promoName.trim() ? ` · ${promoName.trim()}` : ''})
                </span>
                <span className="font-mono tabular-nums text-emerald-700 font-medium shrink-0">
                  -${calc.primaryDiscountAmount}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Bloco 2: Recorrente (apenas quando Tipo = Recorrente) */}
        {calc.isRecurring &&
          calc.recurringTablePrice !== null &&
          calc.recurringLabel && (
            <div className="border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 bg-[#F0F7F9]/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {calc.recurringLabel}
                </h3>
                {isRecurringCustom && (
                  <button
                    type="button"
                    onClick={onResetRecurringToTable}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#0B6273] hover:underline whitespace-nowrap py-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Voltar ao preço da tabela</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4">
                  <span className="block text-xs text-slate-500 mb-1">
                    Preço da tabela
                  </span>
                  <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                    ${calc.recurringTablePrice}
                  </span>
                </div>

                <div className="bg-white border border-[#0B6273]/40 rounded-lg p-3.5 sm:p-4">
                  <label
                    htmlFor="finalRecurringPrice"
                    className="block text-xs font-medium text-[#0B6273] mb-1"
                  >
                    Preço final (editável na hora)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg font-mono font-semibold text-slate-500">
                      $
                    </span>
                    <input
                      id="finalRecurringPrice"
                      type="number"
                      min={0}
                      step={1}
                      value={finalRecurringPrice ?? calc.recurringTablePrice}
                      onChange={(e) =>
                        onChangeFinalRecurring(
                          Math.max(0, Number(e.target.value) || 0)
                        )
                      }
                      className="w-full text-2xl font-bold font-mono tabular-nums text-[#0B6273] bg-transparent focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-200/70">
                {calc.recurringBreakdown.map((line, idx) => (
                  <div
                    key={`${line.label}-${idx}`}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="text-slate-600">{line.label}</span>
                    <span className="font-mono tabular-nums text-slate-800 shrink-0">
                      ${line.amount}
                    </span>
                  </div>
                ))}
                <p className="text-xs text-slate-500 pt-1">
                  Extras pontuais foram calculados apenas na Primeira limpeza.
                </p>
              </div>
            </div>
          )}
      </div>
    </section>
  );
};
