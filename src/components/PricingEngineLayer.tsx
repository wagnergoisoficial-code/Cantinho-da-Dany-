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
    <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Faixa executiva de resumo do preço */}
      <div className="bg-[#0C232B] text-white px-5 py-5 sm:px-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">
              02. Resumo do orçamento
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Tabela arredondada para múltiplo de $5
            </p>
          </div>
          {hasPromo && (
            <span className="text-xs font-mono font-semibold text-emerald-300">
              -{calc.promoPercent}% oferta
            </span>
          )}
        </div>

        <div
          className={`grid gap-4 pt-1 ${
            calc.isRecurring && calc.recurringTablePrice !== null
              ? 'grid-cols-2 divide-x divide-white/10'
              : 'grid-cols-1'
          }`}
        >
          <div className="space-y-1">
            <span className="block text-xs text-slate-300">
              {calc.primaryLabel}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono tabular-nums tracking-tight text-white">
                ${finalPrimaryPrice}
              </span>
              {hasPromo && (
                <span className="text-sm font-mono tabular-nums text-slate-400 line-through">
                  ${calc.primaryTablePrice}
                </span>
              )}
            </div>
          </div>

          {calc.isRecurring &&
            calc.recurringTablePrice !== null &&
            calc.recurringLabel && (
              <div className="pl-4 space-y-1">
                <span className="block text-xs text-slate-300">
                  {calc.recurringLabel}
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold font-mono tabular-nums tracking-tight text-[#6ED2E2]">
                    ${finalRecurringPrice ?? calc.recurringTablePrice}
                  </span>
                  <span className="text-xs text-slate-300">/visita</span>
                </div>
              </div>
            )}
        </div>

        {deepCleanRangeMax !== null && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/10 text-xs text-slate-200">
            <span>
              Faixa enviada na mensagem (+{deepCleanRangeMarginPercent}%)
            </span>
            <span className="font-mono font-semibold tabular-nums text-[#6ED2E2]">
              ${finalPrimaryPrice} a ${deepCleanRangeMax}
            </span>
          </div>
        )}
      </div>

      {/* Corpo de ajuste fino e memória de cálculo */}
      <div className="p-5 sm:p-6 space-y-5">
        {/* Ajuste de preço final */}
        <div
          className={`grid gap-3 ${
            calc.isRecurring && calc.recurringTablePrice !== null
              ? 'grid-cols-1 sm:grid-cols-2'
              : 'grid-cols-1'
          }`}
        >
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="finalPrimaryPrice"
                className="text-xs font-medium text-slate-700"
              >
                Preço final inicial
              </label>
              {isPrimaryCustom ? (
                <button
                  type="button"
                  onClick={onResetPrimaryToTable}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#0B6273] hover:underline whitespace-nowrap"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{hasPromo ? 'Usar promoção' : 'Usar tabela'}</span>
                </button>
              ) : (
                <span className="text-xs text-slate-400 font-mono tabular-nums">
                  Tabela ${calc.primaryTablePrice}
                </span>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono font-semibold text-slate-400">
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
                className="w-full h-11 pl-8 pr-3 rounded-xl border border-slate-300 bg-white text-lg font-bold font-mono tabular-nums text-[#0B6273] focus:outline-none focus:ring-2 focus:ring-[#0B6273]/20 focus:border-[#0B6273]"
              />
            </div>
          </div>

          {calc.isRecurring &&
            calc.recurringTablePrice !== null &&
            calc.recurringLabel && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="finalRecurringPrice"
                    className="text-xs font-medium text-slate-700"
                  >
                    Preço final recorrente
                  </label>
                  {isRecurringCustom ? (
                    <button
                      type="button"
                      onClick={onResetRecurringToTable}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#0B6273] hover:underline whitespace-nowrap"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Usar tabela</span>
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400 font-mono tabular-nums">
                      Tabela ${calc.recurringTablePrice}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono font-semibold text-slate-400">
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
                    className="w-full h-11 pl-8 pr-3 rounded-xl border border-slate-300 bg-white text-lg font-bold font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/20 focus:border-[#0B6273]"
                  />
                </div>
              </div>
            )}
        </div>

        {/* Promoção opcional */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-4 border-t border-slate-100">
          <div className="sm:col-span-4">
            <label
              htmlFor="promoPercent"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Promoção (%)
            </label>
            <div className="relative">
              <input
                id="promoPercent"
                type="number"
                min={0}
                max={100}
                step={1}
                value={promoPercent}
                onChange={(e) => onChangePromoPercent(e.target.value)}
                placeholder="0"
                className="w-full h-10 pl-3 pr-8 rounded-xl border border-slate-200 bg-slate-50/70 font-mono tabular-nums text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/20 focus:border-[#0B6273]"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">
                %
              </span>
            </div>
          </div>

          <div className="sm:col-span-8">
            <label
              htmlFor="promoName"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Nome da oferta (opcional)
            </label>
            <input
              id="promoName"
              type="text"
              value={promoName}
              onChange={(e) => onChangePromoName(e.target.value)}
              placeholder="Ex: Thanksgiving"
              className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/70 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/20 focus:border-[#0B6273]"
            />
          </div>
        </div>

        {/* Memória de cálculo enxuta */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-700">
              Composição — {calc.primaryLabel}
            </div>
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
              <div className="flex items-baseline justify-between gap-2 text-xs pt-1 border-t border-slate-100">
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

          {calc.isRecurring &&
            calc.recurringTablePrice !== null &&
            calc.recurringLabel && (
              <div className="space-y-1.5 pt-3 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-700">
                  Composição — {calc.recurringLabel}
                </div>
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
                <p className="text-[11px] text-slate-500 pt-0.5">
                  Extras pontuais aplicados somente na Primeira limpeza.
                </p>
              </div>
            )}
        </div>
      </div>
    </section>
  );
};
