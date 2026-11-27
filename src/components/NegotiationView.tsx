import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarCheck,
  Clock,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  LEAD_ORIGIN_OPTIONS,
  NEGOTIATION_STAGES,
  OBJECTION_OPTIONS,
  SERVICE_TYPE_LABELS,
} from '../data/defaultPricing';
import {
  LeadOrigin,
  LeadQuoteRecord,
  NegotiationStage,
  PotentialHelperRecord,
  PricingConfig,
  ServiceType,
} from '../types/pricing';
import {
  computeNegotiationAnalytics,
  formatDateBr,
  getLocalDateString,
  getMinutesSinceCreated,
  isLeadDueToday,
  isSeasonalPromoValid,
} from '../utils/negotiationEngine';
import { CalendarWorkspaceBridge } from '../utils/googleCalendarApi';
import { NegotiationWorkspace } from './NegotiationWorkspace';
import { HelpersManager } from './HelpersManager';

export type NegotiationSubTab = 'hoje' | 'todos' | 'painel' | 'ajudantes';

interface NegotiationViewProps {
  leads: LeadQuoteRecord[];
  helpers: PotentialHelperRecord[];
  config: PricingConfig;
  mapsApiKey: string;
  selectedLeadId: string | null;
  onSelectLeadId: (id: string | null) => void;
  onUpdateLead: (updated: LeadQuoteRecord) => void;
  onCreateQuickLead: (lead: LeadQuoteRecord) => void;
  onDeleteLead: (id: string) => void;
  onSavePotentialHelper: (lead: LeadQuoteRecord) => void;
  onAddHelper: (helper: PotentialHelperRecord) => void;
  onUpdateHelper: (id: string, patch: Partial<PotentialHelperRecord>) => void;
  onDeleteHelper: (id: string) => void;
  /** Aba que abre primeiro (ex.: 'ajudantes' quando vem da Agenda). */
  initialSubTab?: NegotiationSubTab;
  onGoToCalculator: () => void;
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

export const NegotiationView: React.FC<NegotiationViewProps> = ({
  leads,
  helpers,
  config,
  mapsApiKey,
  selectedLeadId,
  onSelectLeadId,
  onUpdateLead,
  onCreateQuickLead,
  onDeleteLead,
  onSavePotentialHelper,
  onAddHelper,
  onUpdateHelper,
  onDeleteHelper,
  initialSubTab = 'hoje',
  onGoToCalculator,
  calendarIntegration,
}) => {
  const [subTab, setSubTab] = useState<NegotiationSubTab>(initialSubTab);
  const [stageFilter, setStageFilter] = useState<'Todos' | NegotiationStage>(
    'Todos'
  );
  const [searchTerm, setSearchTerm] = useState('');

  // Form rápido para adicionar lead direto em Negociação
  const [showQuickForm, setShowQuickForm] = useState(false);
  const [qName, setQName] = useState('');
  const [qPhone, setQPhone] = useState('');
  const [qCity, setQCity] = useState('');
  const [qOrigin, setQOrigin] = useState<LeadOrigin | ''>('');
  const [qAdCode, setQAdCode] = useState('');
  const [qTierId, setQTierId] = useState(config.tiers[3]?.id || config.tiers[0].id);
  const [qServiceType, setQServiceType] = useState<ServiceType>('recorrente');

  const dueTodayLeads = useMemo(() => {
    return leads.filter((l) => isLeadDueToday(l));
  }, [leads]);

  const filteredAllLeads = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return leads.filter((l) => {
      const matchesStage = stageFilter === 'Todos' || l.stage === stageFilter;
      const matchesQuery =
        !q ||
        l.clientName.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        (l.phone ?? '').toLowerCase().includes(q);
      return matchesStage && matchesQuery;
    });
  }, [leads, stageFilter, searchTerm]);

  const analytics = useMemo(
    () => computeNegotiationAnalytics(leads),
    [leads]
  );

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === selectedLeadId) ?? null,
    [leads, selectedLeadId]
  );

  const seasonalPromoActive = isSeasonalPromoValid(
    config.negotiation.seasonalPromo
  );

  const handleCreateQuickLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qName.trim() || !qOrigin) return;
    const tier =
      config.tiers.find((t) => t.id === qTierId) ?? config.tiers[0];
    const basePrice =
      qServiceType === 'deep_clean'
        ? tier.deepClean
        : qServiceType === 'move_in_out'
        ? Math.round((tier.deepClean * (1 + config.moveInOutPercent / 100)) / 5) * 5
        : tier.primeiraLimpeza;
    const today = getLocalDateString();

    const newLead: LeadQuoteRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      clientName: qName.trim(),
      phone: qPhone.trim(),
      email: '',
      zipCode: '',
      city: qCity.trim(),
      desiredDate: '',
      bestContact: '',
      origin: qOrigin,
      adCode: qOrigin === 'Facebook' ? qAdCode.trim() : '',
      notes: '',
      squareFeet: null,
      houseLabel: tier.label,
      effectiveHouseLabel: tier.label,
      serviceType: qServiceType,
      frequency: qServiceType === 'recorrente' ? 'quinzenal' : null,
      visitaAvulsaOption: null,
      houseCondition: 'padrao',
      petsOption: 'nenhum',
      tablePricePrimary: basePrice,
      promoPercent: null,
      promoName: '',
      finalPricePrimary: basePrice,
      tablePriceRecurring: qServiceType === 'recorrente' ? tier.quinzenal : null,
      finalPriceRecurring: qServiceType === 'recorrente' ? tier.quinzenal : null,
      aiConfidence: null,
      aiEstado: null,
      status: 'Enviado',
      lossReason: '',
      stage: 'Novo',
      objection: null,
      concession: null,
      followUpStep: 0,
      nextFollowUpDate: today,
      firstOutboundAt: null,
      firstInboundAt: null,
      lastOutboundAt: null,
      lastInboundAt: null,
      consecutiveOutboundCount: 0,
      blockedUntilDate: null,
      hibernateUntilDate: null,
      priceAlreadySent: false,
      lastGeneratedMessage: null,
      interactionHistory: [],
      dayOption1: config.defaultDayOption1 || 'Tuesday',
      dayOption2: config.defaultDayOption2 || 'Thursday',
    };

    onCreateQuickLead(newLead);
    setQName('');
    setQPhone('');
    setQCity('');
    setQOrigin('');
    setQAdCode('');
    setShowQuickForm(false);
    onSelectLeadId(newLead.id);
  };

  if (selectedLead) {
    const isHelperSaved = helpers.some(
      (h) =>
        h.sourceLeadId === selectedLead.id ||
        (selectedLead.phone && h.phone === selectedLead.phone)
    );
    return (
      <NegotiationWorkspace
        lead={selectedLead}
        allLeads={leads}
        config={config}
        mapsApiKey={mapsApiKey}
        isHelperSaved={isHelperSaved}
        onBack={() => onSelectLeadId(null)}
        onUpdateLead={onUpdateLead}
        onSavePotentialHelper={onSavePotentialHelper}
        onDeleteLead={onDeleteLead}
        calendarIntegration={calendarIntegration}
      />
    );
  }

  const renderLeadCard = (lead: LeadQuoteRecord) => {
    const objLabel = OBJECTION_OPTIONS.find(
      (o) => o.id === lead.objection
    )?.label;
    const minutes = getMinutesSinceCreated(lead.createdAt);

    return (
      <div
        key={lead.id}
        className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#0B6273]/50 transition-colors flex flex-wrap items-center justify-between gap-3"
      >
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">
              {lead.clientName || 'Lead sem nome'}
            </span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded border ${
                STAGE_BADGE_CLASSES[lead.stage]
              }`}
            >
              {lead.stage}
            </span>
            {lead.stage === 'Novo' && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${
                  minutes <= 5
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-red-50 text-red-700 border-red-200'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>{minutes} min (meta 5 min)</span>
              </span>
            )}
            {objLabel && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                Objeção: {objLabel}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
            <span>{lead.city || 'Cidade não informada'}</span>
            <span className="text-slate-300">·</span>
            <span>{lead.effectiveHouseLabel || lead.houseLabel}</span>
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
            <span className="text-slate-300">·</span>
            <span className="font-mono font-semibold text-[#0B6273]">
              ${lead.finalPricePrimary}
            </span>
            {lead.followUpStep !== 'hibernar' ? (
              <>
                <span className="text-slate-300">·</span>
                <span>
                  Follow-up: Dia {lead.followUpStep}
                  {lead.nextFollowUpDate
                    ? ` (${formatDateBr(lead.nextFollowUpDate)})`
                    : ''}
                </span>
              </>
            ) : (
              lead.hibernateUntilDate && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>
                    Hibernar até {formatDateBr(lead.hibernateUntilDate)}
                  </span>
                </>
              )
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSelectLeadId(lead.id)}
          className="h-10 px-4 rounded-lg bg-[#0B6273] text-white text-xs sm:text-sm font-medium hover:bg-[#084E5C] transition-colors whitespace-nowrap shrink-0"
        >
          Abrir conversa
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Cabeçalho e Sub-abas de Negociação */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <span className="text-xs font-medium text-[#0B6273]">
              Módulo de Negociação
            </span>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              Follow-up, objeções e fechamento
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {seasonalPromoActive && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                Promoção sazonal ativa:{' '}
                {config.negotiation.seasonalPromo.name} (
                {config.negotiation.seasonalPromo.percent}%)
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowQuickForm((v) => !v)}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg bg-[#0B6273] text-white text-xs sm:text-sm font-medium hover:bg-[#084E5C] transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Novo lead rápido</span>
            </button>
          </div>
        </div>

        {/* Formulário rápido para novo lead direto na Negociação */}
        {showQuickForm && (
          <form
            onSubmit={handleCreateQuickLead}
            className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
          >
            <div className="text-xs font-semibold text-slate-800">
              Cadastrar novo lead (entra na etapa &quot;Novo&quot; — Dia 0)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <input
                type="text"
                required
                value={qName}
                onChange={(e) => setQName(e.target.value)}
                placeholder="Nome do lead *"
                className="h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
              />
              <input
                type="tel"
                value={qPhone}
                onChange={(e) => setQPhone(e.target.value)}
                placeholder="Telefone"
                className="h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
              />
              <input
                type="text"
                value={qCity}
                onChange={(e) => setQCity(e.target.value)}
                placeholder="Cidade (CT)"
                className="h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
              />
              <select
                required
                value={qOrigin}
                onChange={(e) => {
                  const val = e.target.value as LeadOrigin | '';
                  setQOrigin(val);
                  if (val !== 'Facebook') setQAdCode('');
                }}
                className="h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
              >
                <option value="">Origem do lead *</option>
                {LEAD_ORIGIN_OPTIONS.map((originOpt) => (
                  <option key={originOpt} value={originOpt}>
                    {originOpt}
                  </option>
                ))}
              </select>
              {qOrigin === 'Facebook' && (
                <input
                  type="text"
                  value={qAdCode}
                  onChange={(e) => setQAdCode(e.target.value)}
                  placeholder="Código anúncio (ex: AD-04F)"
                  className="h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base font-mono"
                />
              )}
              <select
                value={qTierId}
                onChange={(e) => setQTierId(e.target.value)}
                className="h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
              >
                {config.tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select
                value={qServiceType}
                onChange={(e) =>
                  setQServiceType(e.target.value as ServiceType)
                }
                className="h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
              >
                <option value="recorrente">Recorrente</option>
                <option value="primeira_avulsa">1ª limpeza avulsa</option>
                <option value="deep_clean">Deep clean</option>
                <option value="move_in_out">Move-in/Move-out</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQuickForm(false)}
                className="h-9 px-3 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 bg-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="h-9 px-4 rounded-lg bg-[#0B6273] text-white text-xs font-medium hover:bg-[#084E5C]"
              >
                Adicionar e abrir
              </button>
            </div>
          </form>
        )}

        {/* Sub-abas */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSubTab('hoje')}
            className={`inline-flex items-center justify-center gap-2 h-10 px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              subTab === 'hoje'
                ? 'bg-[#0B6273] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <CalendarCheck className="w-4 h-4 shrink-0" />
            <span>Hoje ({dueTodayLeads.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('todos')}
            className={`inline-flex items-center justify-center gap-2 h-10 px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              subTab === 'todos'
                ? 'bg-[#0B6273] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>Todos os leads ({leads.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('painel')}
            className={`inline-flex items-center justify-center gap-2 h-10 px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              subTab === 'painel'
                ? 'bg-[#0B6273] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>Painel de Negociação</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('ajudantes')}
            className={`inline-flex items-center justify-center gap-2 h-10 px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              subTab === 'ajudantes'
                ? 'bg-[#0B6273] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <UserPlus className="w-4 h-4 shrink-0" />
            <span>Ajudantes ({helpers.length})</span>
          </button>
        </div>
      </section>

      {/* ABA HOJE */}
      {subTab === 'hoje' && (
        <section className="space-y-4">
          {dueTodayLeads.length === 0 ? (
            leads.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
                <p className="text-sm text-slate-600">
                  Nenhum lead salvo ainda. Calcule um orçamento ou use &quot;Novo
                  lead rápido&quot; para iniciar uma conversa.
                </p>
                <button
                  type="button"
                  onClick={onGoToCalculator}
                  className="inline-flex items-center h-10 px-4 rounded-lg bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C]"
                >
                  Ir para Calculadora
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs sm:text-sm text-slate-600">
                    Nenhum follow-up vencendo hoje. Escolha um lead recente abaixo
                    para abrir o espaço de conversa:
                  </p>
                  <button
                    type="button"
                    onClick={() => setSubTab('todos')}
                    className="h-9 px-3 rounded-lg border border-[#0B6273] text-[#0B6273] text-xs font-medium hover:bg-[#EAF4F6] whitespace-nowrap shrink-0"
                  >
                    Ver todos os leads ({leads.length})
                  </button>
                </div>
                <div className="space-y-3">
                  {leads.slice(0, 6).map(renderLeadCard)}
                </div>
              </div>
            )
          ) : (
            <div className="space-y-3">{dueTodayLeads.map(renderLeadCard)}</div>
          )}
        </section>
      )}

      {/* ABA TODOS OS LEADS */}
      {subTab === 'todos' && (
        <section className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar lead por nome, cidade ou telefone..."
                className="w-full h-11 sm:h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-base"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['Todos', ...NEGOTIATION_STAGES] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStageFilter(st)}
                  className={`min-h-[34px] px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    stageFilter === st
                      ? 'bg-[#0B6273] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {filteredAllLeads.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              Nenhum lead encontrado nesta etapa.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAllLeads.map(renderLeadCard)}
            </div>
          )}
        </section>
      )}

      {/* ABA PAINEL DE NEGOCIAÇÃO */}
      {subTab === 'painel' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Concessões usadas + Preço médio fechado vs Ideal */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-3">
              <h3 className="text-base font-semibold text-slate-900">
                Concessões usadas
              </h3>
              <div className="text-3xl font-bold font-mono tabular-nums text-[#0B6273]">
                {analytics.totalConcessionsUsed}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1">
                <div className="p-2 rounded bg-slate-50 border border-slate-200">
                  Valor (extra grátis):{' '}
                  <strong className="font-mono text-slate-900">
                    {analytics.concessionsByType.valor}
                  </strong>
                </div>
                <div className="p-2 rounded bg-slate-50 border border-slate-200">
                  Preço Competitivo:{' '}
                  <strong className="font-mono text-slate-900">
                    {analytics.concessionsByType.preco}
                  </strong>
                </div>
                <div className="p-2 rounded bg-slate-50 border border-slate-200">
                  Promoção sazonal:{' '}
                  <strong className="font-mono text-slate-900">
                    {analytics.concessionsByType.sazonal}
                  </strong>
                </div>
                <div className="p-2 rounded bg-slate-50 border border-slate-200">
                  Pacote 2 Horas:{' '}
                  <strong className="font-mono text-slate-900">
                    {analytics.concessionsByType.pacote_2h}
                  </strong>
                </div>
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-3">
              <h3 className="text-base font-semibold text-slate-900">
                Preço médio fechado vs Preço Ideal
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-xs text-slate-500">
                    Média fechada ({analytics.closedCount})
                  </span>
                  <span className="text-3xl font-bold font-mono tabular-nums text-[#0B6273]">
                    ${analytics.avgClosedPrice}
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-slate-500">
                    Média do Ideal
                  </span>
                  <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                    ${analytics.avgIdealPriceOnClosed}
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-600">
                Diferença média:{' '}
                <strong className="font-mono text-slate-900">
                  {analytics.diffFromIdealDollar >= 0 ? '+' : '-'}$
                  {Math.abs(analytics.diffFromIdealDollar)} (
                  {analytics.diffFromIdealPercent >= 0 ? '+' : ''}
                  {analytics.diffFromIdealPercent}%)
                </strong>{' '}
                em relação ao preço Ideal da tabela.
              </p>
            </section>
          </div>

          {/* Taxa de fechamento por objeção */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
              Taxa de fechamento por objeção
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-2 pr-3 font-semibold">Objeção</th>
                    <th className="py-2 px-2 text-right font-semibold">Leads</th>
                    <th className="py-2 px-2 text-right font-semibold">
                      Fecharam
                    </th>
                    <th className="py-2 px-2 text-right font-semibold">
                      Perderam
                    </th>
                    <th className="py-2 pl-2 text-right font-semibold">Taxa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.byObjection.map((row) => (
                    <tr key={row.objection}>
                      <td className="py-2.5 pr-3 text-slate-900 font-medium">
                        {row.label}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums">
                        {row.total}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-700">
                        {row.won}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-red-600">
                        {row.lost}
                      </td>
                      <td className="py-2.5 pl-2 text-right font-mono tabular-nums font-bold text-[#0B6273]">
                        {row.closingRate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Motivos de perda */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-3">
            <h3 className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
              Motivos de perda
            </h3>
            {analytics.lossReasons.length === 0 ? (
              <p className="text-xs text-slate-500">
                Nenhum lead marcado como &quot;Perdido&quot; até o momento.
              </p>
            ) : (
              <div className="space-y-2">
                {analytics.lossReasons.map((item) => (
                  <div
                    key={item.reason}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs sm:text-sm"
                  >
                    <span className="text-slate-800">{item.reason}</span>
                    <span className="font-mono tabular-nums font-semibold text-red-700 shrink-0">
                      {item.count} ({item.percent}%)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ABA AJUDANTES (equipe + candidatos) */}
      {subTab === 'ajudantes' && (
        <HelpersManager
          helpers={helpers}
          onAddHelper={onAddHelper}
          onUpdateHelper={onUpdateHelper}
          onDeleteHelper={onDeleteHelper}
        />
      )}
    </div>
  );
};
