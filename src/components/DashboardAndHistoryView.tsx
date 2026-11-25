import React, { useMemo, useState } from 'react';
import { Calendar, Search, Trash2, X } from 'lucide-react';
import {
  FREQUENCY_LABELS,
  LOSS_REASONS_SUGGESTIONS,
  SERVICE_TYPE_LABELS,
  VISITA_AVULSA_LABELS,
} from '../data/defaultPricing';
import { LeadQuoteRecord, QuoteStatus } from '../types/pricing';
import {
  computeTestMeasurements,
  formatResponseMinutes,
} from '../utils/negotiationEngine';

interface DashboardAndHistoryViewProps {
  records: LeadQuoteRecord[];
  onUpdateStatus: (id: string, status: QuoteStatus, lossReason: string) => void;
  onDeleteRecord: (id: string) => void;
  onOpenNegotiation: (id: string) => void;
  onGoToCalculator: () => void;
}

const STATUS_OPTIONS: QuoteStatus[] = ['Enviado', 'Fechou', 'Perdeu'];

function toLocalDateKey(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const DashboardAndHistoryView: React.FC<
  DashboardAndHistoryViewProps
> = ({
  records,
  onUpdateStatus,
  onDeleteRecord,
  onOpenNegotiation,
  onGoToCalculator,
}) => {
  const [filterStatus, setFilterStatus] = useState<'Todos' | QuoteStatus>(
    'Todos'
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Painel: leads da semana, taxa de fechamento e preço médio
  const metrics = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const leadsThisWeek = records.filter((rec) => {
      const time = new Date(rec.createdAt).getTime();
      return Number.isFinite(time) && now - time <= sevenDaysMs;
    }).length;

    const total = records.length;
    const wonCount = records.filter((r) => r.status === 'Fechou').length;
    const closingRate = total > 0 ? Math.round((wonCount / total) * 100) : 0;

    const averagePrice =
      total > 0
        ? Math.round(
            records.reduce((acc, r) => acc + r.finalPricePrimary, 0) / total
          )
        : 0;

    return {
      leadsThisWeek,
      closingRate,
      wonCount,
      total,
      averagePrice,
    };
  }, [records]);

  const testMetrics = useMemo(() => computeTestMeasurements(records), [records]);

  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      const matchesStatus =
        filterStatus === 'Todos' || rec.status === filterStatus;
      const q = searchTerm.trim().toLowerCase();
      const matchesQuery =
        !q ||
        rec.clientName.toLowerCase().includes(q) ||
        rec.city.toLowerCase().includes(q) ||
        rec.houseLabel.toLowerCase().includes(q) ||
        (rec.phone ?? '').toLowerCase().includes(q) ||
        (rec.zipCode ?? '').toLowerCase().includes(q) ||
        (rec.origin ?? '').toLowerCase().includes(q) ||
        (rec.adCode ?? '').toLowerCase().includes(q);

      const dateKey = toLocalDateKey(rec.createdAt);
      const matchesDateFrom = !dateFrom || (dateKey !== '' && dateKey >= dateFrom);
      const matchesDateTo = !dateTo || (dateKey !== '' && dateKey <= dateTo);

      return matchesStatus && matchesQuery && matchesDateFrom && matchesDateTo;
    });
  }, [records, filterStatus, searchTerm, dateFrom, dateTo]);

  const hasActiveFilters =
    filterStatus !== 'Todos' ||
    searchTerm.trim() !== '' ||
    dateFrom !== '' ||
    dateTo !== '';

  const handleClearFilters = () => {
    setFilterStatus('Todos');
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Painel com os 3 indicadores */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Painel comercial
          </h2>
          <p className="text-xs text-slate-500">
            Indicadores calculados a partir dos orçamentos salvos neste
            navegador.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="border border-slate-200 rounded-lg p-4">
            <span className="block text-xs text-slate-500 mb-1">
              Leads da semana
            </span>
            <span className="text-3xl font-bold font-mono tabular-nums text-[#0B6273]">
              {metrics.leadsThisWeek}
            </span>
            <span className="block text-xs text-slate-500 mt-1">
              Últimos 7 dias
            </span>
          </div>

          <div className="border border-slate-200 rounded-lg p-4">
            <span className="block text-xs text-slate-500 mb-1">
              Taxa de fechamento
            </span>
            <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.closingRate}%
            </span>
            <span className="block text-xs text-slate-500 mt-1 font-mono tabular-nums">
              {metrics.wonCount} de {metrics.total} orçamentos
            </span>
          </div>

          <div className="border border-slate-200 rounded-lg p-4">
            <span className="block text-xs text-slate-500 mb-1">
              Preço médio
            </span>
            <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
              ${metrics.averagePrice}
            </span>
            <span className="block text-xs text-slate-500 mt-1">
              Média do Preço final
            </span>
          </div>
        </div>
      </section>

      {/* Medição do teste: por semana e por origem */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Medição do teste (semana e origem)
          </h2>
          <p className="text-xs text-slate-500">
            Quantos leads responderam, quantos fecharam e tempo médio até a
            primeira resposta.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/50">
            <span className="block text-xs text-slate-500">Total de leads</span>
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {testMetrics.totalLeads}
            </span>
          </div>
          <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/50">
            <span className="block text-xs text-slate-500">Responderam</span>
            <span className="text-2xl font-bold font-mono tabular-nums text-[#0B6273]">
              {testMetrics.totalResponded}
            </span>
          </div>
          <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/50">
            <span className="block text-xs text-slate-500">Fecharam</span>
            <span className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
              {testMetrics.totalClosed}
            </span>
          </div>
          <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/50">
            <span className="block text-xs text-slate-500">
              Tempo médio 1ª resposta
            </span>
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {formatResponseMinutes(testMetrics.overallAvgFirstResponseMinutes)}
            </span>
          </div>
        </div>

        {records.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-800">
                Por semana
              </h3>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Semana</th>
                      <th className="py-2 px-2 text-right font-semibold">Leads</th>
                      <th className="py-2 px-2 text-right font-semibold">Resp.</th>
                      <th className="py-2 px-2 text-right font-semibold">Fechou</th>
                      <th className="py-2 px-3 text-right font-semibold">1ª resp.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {testMetrics.byWeek.map((row) => (
                      <tr key={row.key}>
                        <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                          {row.label}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">
                          {row.leadsCount}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-[#0B6273]">
                          {row.respondedCount} ({row.respondedRate}%)
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-emerald-700">
                          {row.closedCount} ({row.closedRate}%)
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                          {formatResponseMinutes(row.avgFirstResponseMinutes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Por origem
                </h3>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3 font-semibold">Origem</th>
                        <th className="py-2 px-2 text-right font-semibold">Leads</th>
                        <th className="py-2 px-2 text-right font-semibold">Resp.</th>
                        <th className="py-2 px-2 text-right font-semibold">Fechou</th>
                        <th className="py-2 px-3 text-right font-semibold">1ª resp.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {testMetrics.byOrigin.map((row) => (
                        <tr key={row.key}>
                          <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                            {row.label}
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums">
                            {row.leadsCount}
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums text-[#0B6273]">
                            {row.respondedCount} ({row.respondedRate}%)
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums text-emerald-700">
                            {row.closedCount} ({row.closedRate}%)
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                            {formatResponseMinutes(row.avgFirstResponseMinutes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {testMetrics.byFacebookAdCode.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-slate-600">
                    Por código de anúncio (Facebook)
                  </h4>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <tbody className="divide-y divide-slate-100">
                        {testMetrics.byFacebookAdCode.map((row) => (
                          <tr key={row.key}>
                            <td className="py-1.5 px-3 font-mono font-medium text-slate-800">
                              {row.label}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                              {row.leadsCount} leads
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-[#0B6273]">
                              {row.respondedCount} resp.
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                              {row.closedCount} fech.
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Histórico em localStorage */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
        <div className="space-y-4 border-b border-slate-100 pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Histórico de orçamentos
              </h2>
              <p className="text-xs text-slate-500">
                Filtre leads por status (Enviado, Fechou, Perdeu) e por período.
              </p>
            </div>
            {records.length > 0 && (
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {filteredRecords.length} de {records.length} lead
                {records.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-2 md:col-span-3">
              <label
                htmlFor="historySearch"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Buscar lead
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="historySearch"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Nome, telefone, cidade ou ZIP"
                  className="w-full h-11 sm:h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
                />
              </div>
            </div>

            <div className="sm:col-span-2 md:col-span-2">
              <label
                htmlFor="filterStatusSelect"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Status do lead
              </label>
              <select
                id="filterStatusSelect"
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(e.target.value as 'Todos' | QuoteStatus)
                }
                className="w-full h-11 sm:h-10 px-3 rounded-lg border border-slate-300 text-base text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
              >
                <option value="Todos">Todos</option>
                {STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="filterDateFrom"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Data inicial
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="filterDateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full h-11 sm:h-10 pl-8 pr-2 rounded-lg border border-slate-300 text-base font-mono tabular-nums text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
                />
              </div>
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="filterDateTo"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Data final
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="filterDateTo"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full h-11 sm:h-10 pl-8 pr-2 rounded-lg border border-slate-300 text-base font-mono tabular-nums text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0B6273]/25 focus:border-[#0B6273]"
                />
              </div>
            </div>

            <div className="sm:col-span-2 md:col-span-1 flex justify-end">
              <button
                type="button"
                onClick={handleClearFilters}
                disabled={!hasActiveFilters}
                title="Limpar filtros"
                className="w-full h-11 sm:h-10 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" />
                <span>Limpar</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {(['Todos', ...STATUS_OPTIONS] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setFilterStatus(status)}
                className={`min-h-[36px] px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  filterStatus === status
                    ? 'bg-[#0B6273] text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {records.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm text-slate-600">
              Nenhum orçamento salvo ainda no histórico.
            </p>
            <button
              type="button"
              onClick={onGoToCalculator}
              className="inline-flex items-center h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C] transition-colors"
            >
              Criar primeiro orçamento
            </button>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            Nenhum orçamento encontrado para os filtros aplicados.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredRecords.map((rec) => {
              const formattedDate = new Date(rec.createdAt).toLocaleDateString(
                'pt-BR',
                {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                }
              );
              const serviceSubtitle =
                rec.serviceType === 'visita_avulsa' && rec.visitaAvulsaOption
                  ? `Visita avulsa · ${VISITA_AVULSA_LABELS[rec.visitaAvulsaOption]}`
                  : rec.serviceType === 'recorrente' && rec.frequency
                  ? `${SERVICE_TYPE_LABELS.recorrente} · ${FREQUENCY_LABELS[rec.frequency]}`
                  : SERVICE_TYPE_LABELS[rec.serviceType];

              return (
                <div key={rec.id} className="py-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold text-slate-900">
                          {rec.clientName || 'Lead sem nome'}
                        </span>
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#EAF4F6] text-[#0B6273] border border-[#0B6273]/25">
                          {rec.stage}
                        </span>
                        {rec.phone && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="text-xs text-slate-700 font-mono tabular-nums">
                              {rec.phone}
                            </span>
                          </>
                        )}
                        {rec.city && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-600">{rec.city}</span>
                          </>
                        )}
                        {rec.zipCode && (
                          <span className="text-xs text-slate-500 font-mono tabular-nums">
                            ({rec.zipCode})
                          </span>
                        )}
                        <span className="text-slate-300">·</span>
                        <span className="text-xs text-slate-500 font-mono tabular-nums">
                          {formattedDate}
                        </span>
                        {rec.origin && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                              {rec.origin === 'Facebook' && rec.adCode
                                ? `Facebook · ${rec.adCode}`
                                : rec.origin}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span>{serviceSubtitle}</span>
                        {rec.serviceType !== 'visita_avulsa' && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span>{rec.effectiveHouseLabel}</span>
                          </>
                        )}
                        {rec.squareFeet && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="font-mono tabular-nums">
                              {rec.squareFeet} sq ft
                            </span>
                          </>
                        )}
                        {rec.desiredDate && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-700">
                              Data desejada: {rec.desiredDate}
                            </span>
                          </>
                        )}
                        {rec.promoPercent && rec.promoPercent > 0 && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                              Promoção {rec.promoPercent}%
                              {rec.promoName ? ` (${rec.promoName})` : ''}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                      <div className="text-left sm:text-right">
                        <div className="text-sm font-bold font-mono tabular-nums text-[#0B6273]">
                          ${rec.finalPricePrimary}
                          {rec.finalPriceRecurring !== null && (
                            <span className="text-slate-700 font-medium">
                              {' '}
                              / rec. ${rec.finalPriceRecurring}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          Tabela: ${rec.tablePricePrimary}
                          {rec.tablePriceRecurring !== null
                            ? ` / $${rec.tablePriceRecurring}`
                            : ''}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 ml-auto sm:ml-0">
                        <button
                          type="button"
                          onClick={() => onOpenNegotiation(rec.id)}
                          className="h-9 sm:h-8 px-3 rounded-lg bg-[#0B6273] text-white text-xs font-medium hover:bg-[#084E5C] transition-colors whitespace-nowrap"
                        >
                          Negociar
                        </button>

                        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                          {STATUS_OPTIONS.map((st) => {
                            const isCurrent = rec.status === st;
                            let activeStyle = 'bg-white text-slate-900 shadow-sm';
                            if (isCurrent && st === 'Fechou') {
                              activeStyle = 'bg-emerald-600 text-white';
                            } else if (isCurrent && st === 'Perdeu') {
                              activeStyle = 'bg-red-600 text-white';
                            } else if (isCurrent && st === 'Enviado') {
                              activeStyle = 'bg-[#0B6273] text-white';
                            }
                            return (
                              <button
                                key={st}
                                type="button"
                                onClick={() =>
                                  onUpdateStatus(
                                    rec.id,
                                    st,
                                    st === 'Perdeu' ? rec.lossReason : ''
                                  )
                                }
                                className={`min-h-[34px] sm:min-h-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                                  isCurrent
                                    ? activeStyle
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                {st}
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => onDeleteRecord(rec.id)}
                          aria-label="Excluir registro"
                          className="w-10 h-10 sm:w-auto sm:h-auto sm:p-2 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Motivo da perda quando status === Perdeu */}
                  {rec.status === 'Perdeu' && (
                    <div className="bg-red-50/60 border border-red-200 rounded-lg p-3 space-y-2">
                      <label className="block text-xs font-medium text-red-900">
                        Motivo da perda
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {LOSS_REASONS_SUGGESTIONS.map((reason) => (
                          <button
                            key={reason}
                            type="button"
                            onClick={() =>
                              onUpdateStatus(rec.id, 'Perdeu', reason)
                            }
                            className={`min-h-[36px] px-2.5 py-1 rounded text-xs border transition-colors ${
                              rec.lossReason === reason
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
                        value={rec.lossReason}
                        onChange={(e) =>
                          onUpdateStatus(rec.id, 'Perdeu', e.target.value)
                        }
                        placeholder="Ou digite o motivo específico da perda..."
                        className="w-full h-11 sm:h-10 px-3 rounded-md border border-red-200 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-300"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
