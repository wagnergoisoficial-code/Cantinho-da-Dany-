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
  FREQUENCY_LABELS,
  INITIAL_LEAD_STATE,
  LEAD_ORIGIN_OPTIONS,
  NEGOTIATION_STAGES,
  OBJECTION_OPTIONS,
  SERVICE_TYPE_LABELS,
} from '../data/defaultPricing';
import {
  FrequencyType,
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
import {
  calculateQuote,
  resolveLeadPricingFromEngine,
} from '../utils/pricingEngine';
import { CalendarWorkspaceBridge } from '../utils/googleCalendarApi';
import { NegotiationWorkspace } from './NegotiationWorkspace';

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
  onUpdateHelperNotes: (id: string, notes: string) => void;
  onDeleteHelper: (id: string) => void;
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
  onUpdateHelperNotes,
  onDeleteHelper,
  onGoToCalculator,
  calendarIntegration,
}) => {
  const [subTab, setSubTab] = useState<NegotiationSubTab>('hoje');
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
  const [qFrequency, setQFrequency] = useState<FrequencyType>('quinzenal');
  const [qCustomPrimaryPrice, setQCustomPrimaryPrice] = useState<number | null>(
    null
  );
  const [qCustomRecurringPrice, setQCustomRecurringPrice] = useState<
    number | null
  >(null);

  const quickCalc = useMemo(
    () =>
      calculateQuote(
        {
          ...INITIAL_LEAD_STATE,
          selectedTierId: qTierId,
          serviceType: qServiceType,
          frequency: qFrequency,
          houseCondition: 'padrao',
          petsOption: 'nenhum',
          dayOption1: config.defaultDayOption1 || 'Tuesday',
          dayOption2: config.defaultDayOption2 || 'Thursday',
        },
        config
      ),
    [qTierId, qServiceType, qFrequency, config]
  );

  const quickPrimaryPrice =
    qCustomPrimaryPrice ?? quickCalc.effectiveDefaultPrimaryPrice;
  const quickRecurringPrice = quickCalc.isRecurring
    ? qCustomRecurringPrice ?? quickCalc.recurringTablePrice
    : null;

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
      squareFeet: quickCalc.parsedSqFt,
      houseLabel: quickCalc.selectedTier.label,
      effectiveHouseLabel: quickCalc.effectiveTier.label,
      serviceType: qServiceType,
      frequency: quickCalc.isRecurring ? qFrequency : null,
      visitaAvulsaOption: null,
      houseCondition: 'padrao',
      petsOption: 'nenhum',
      tablePricePrimary: quickCalc.primaryTablePrice,
      promoPercent: null,
      promoName: '',
      finalPricePrimary: quickPrimaryPrice,
      tablePriceRecurring: quickCalc.isRecurring
        ? quickCalc.recurringTablePrice
        : null,
      finalPriceRecurring: quickRecurringPrice,
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
    setQFrequency('quinzenal');
    setQCustomPrimaryPrice(null);
    setQCustomRecurringPrice(null);
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
        className="p-4 sm:px-5 rounded-2xl border border-slate-200/90 bg-white hover:border-[#0B6273]/40 hover:bg-slate-50/40 transition-colors flex flex-wrap items-center justify-between gap-3"
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
            {(() => {
              const pricing = resolveLeadPricingFromEngine(lead, config);
              return (
                <span className="font-mono font-semibold text-[#0B6273]">
                  Inicial ${pricing.initialFinalPrice}
                  {pricing.isRecurring && (
                    <span className="text-slate-700 font-medium">
                      {' '}
                      · Recorrente:{' '}
                      {pricing.recurringStatus === 'available' &&
                      pricing.recurringFinalPrice !== null
                        ? `$${pricing.recurringFinalPrice}/visita`
                        : 'a confirmar'}
                    </span>
                  )}
                </span>
              );
            })()}
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
    <div className="space-y-5 sm:space-y-6">
      {/* Cabeçalho e Sub-abas de Negociação */}
      <section className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-slate-900">
              Follow-up, objeções e fechamento
            </h2>
            {seasonalPromoActive ? (
              <p className="text-xs text-emerald-700 font-medium mt-0.5">
                Promoção sazonal ativa: {config.negotiation.seasonalPromo.name} (
                {config.negotiation.seasonalPromo.percent}%)
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-0.5">
                Acompanhe retornos do dia, gerencie conversas e avance leads.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowQuickForm((v) => !v)}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-[#0B6273] text-white text-xs sm:text-sm font-medium hover:bg-[#084E5C] transition-colors whitespace-nowrap shrink-0"
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
                onChange={(e) => {
                  setQTierId(e.target.value);
                  setQCustomPrimaryPrice(null);
                  setQCustomRecurringPrice(null);
                }}
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
                onChange={(e) => {
                  setQServiceType(e.target.value as ServiceType);
                  setQCustomPrimaryPrice(null);
                  setQCustomRecurringPrice(null);
                }}
                className="h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
              >
                <option value="recorrente">Recorrente</option>
                <option value="primeira_avulsa">1ª limpeza avulsa</option>
                <option value="deep_clean">Deep clean</option>
                <option value="move_in_out">Move-in/Move-out</option>
              </select>
              {qServiceType === 'recorrente' && (
                <select
                  value={qFrequency}
                  onChange={(e) => {
                    setQFrequency(e.target.value as FrequencyType);
                    setQCustomPrimaryPrice(null);
                    setQCustomRecurringPrice(null);
                  }}
                  className="h-11 sm:h-10 px-3 rounded-lg border border-slate-300 bg-white text-base"
                >
                  <option value="semanal">{FREQUENCY_LABELS.semanal}</option>
                  <option value="quinzenal">{FREQUENCY_LABELS.quinzenal}</option>
                  <option value="mensal">{FREQUENCY_LABELS.mensal}</option>
                </select>
              )}
            </div>

            {/* Valores separados: Preço inicial x Preço recorrente por visita (reutiliza motor da Calculadora) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-2.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="block text-xs font-semibold text-slate-700">
                    Preço inicial (1ª limpeza)
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    Tabela: ${quickCalc.primaryTablePrice}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-sm font-mono text-slate-500">$</span>
                  <input
                    type="number"
                    min={0}
                    step={5}
                    aria-label="Preço inicial (1ª limpeza)"
                    value={quickPrimaryPrice}
                    onChange={(e) => {
                      const val = Math.max(0, Math.round(Number(e.target.value) || 0));
                      setQCustomPrimaryPrice(val);
                    }}
                    className="w-24 h-9 px-2.5 rounded-md border border-slate-300 bg-white font-mono tabular-nums text-sm font-semibold text-right text-[#0B6273]"
                  />
                </div>
              </div>

              {quickCalc.isRecurring && quickRecurringPrice !== null && (
                <div className="p-2.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-700">
                      Preço recorrente (por visita · {FREQUENCY_LABELS[qFrequency]})
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      Tabela: ${quickCalc.recurringTablePrice}/visita
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-sm font-mono text-slate-500">$</span>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      aria-label="Preço recorrente (por visita)"
                      value={quickRecurringPrice}
                      onChange={(e) => {
                        const val = Math.max(0, Math.round(Number(e.target.value) || 0));
                        setQCustomRecurringPrice(val);
                      }}
                      className="w-24 h-9 px-2.5 rounded-md border border-slate-300 bg-white font-mono tabular-nums text-sm font-semibold text-right text-slate-900"
                    />
                  </div>
                </div>
              )}
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
        <div className="grid grid-cols-2 sm:inline-flex sm:flex-wrap gap-1 p-1 rounded-xl bg-slate-100/90 border border-slate-200/70">
          <button
            type="button"
            onClick={() => setSubTab('hoje')}
            className={`inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              subTab === 'hoje'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarCheck
              className={`w-4 h-4 shrink-0 ${
                subTab === 'hoje' ? 'text-[#0B6273]' : 'text-slate-400'
              }`}
            />
            <span>
              Hoje{' '}
              <span className="font-mono tabular-nums text-xs text-slate-500">
                ({dueTodayLeads.length})
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('todos')}
            className={`inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              subTab === 'todos'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users
              className={`w-4 h-4 shrink-0 ${
                subTab === 'todos' ? 'text-[#0B6273]' : 'text-slate-400'
              }`}
            />
            <span>
              Todos os leads{' '}
              <span className="font-mono tabular-nums text-xs text-slate-500">
                ({leads.length})
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('painel')}
            className={`inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              subTab === 'painel'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3
              className={`w-4 h-4 shrink-0 ${
                subTab === 'painel' ? 'text-[#0B6273]' : 'text-slate-400'
              }`}
            />
            <span>Painel de Negociação</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('ajudantes')}
            className={`inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              subTab === 'ajudantes'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserPlus
              className={`w-4 h-4 shrink-0 ${
                subTab === 'ajudantes' ? 'text-[#0B6273]' : 'text-slate-400'
              }`}
            />
            <span>
              Possíveis ajudantes{' '}
              <span className="font-mono tabular-nums text-xs text-slate-500">
                ({helpers.length})
              </span>
            </span>
          </button>
        </div>
      </section>

      {/* ABA HOJE */}
      {subTab === 'hoje' && (
        <section className="space-y-4">
          {dueTodayLeads.length === 0 ? (
            leads.length === 0 ? (
              <div className="bg-white border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-8 text-center space-y-3">
                <p className="text-sm text-slate-600">
                  Nenhum lead salvo ainda. Calcule um orçamento ou use &quot;Novo
                  lead rápido&quot; para iniciar uma conversa.
                </p>
                <button
                  type="button"
                  onClick={onGoToCalculator}
                  className="inline-flex items-center h-10 px-4 rounded-xl bg-[#0B6273] text-white text-sm font-medium hover:bg-[#084E5C]"
                >
                  Ir para Calculadora
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-white border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
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

      {/* ABA POSSÍVEIS AJUDANTES */}
      {subTab === 'ajudantes' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-semibold text-slate-900">
              Possíveis ajudantes
            </h3>
            <p className="text-xs text-slate-500">
              Contatos salvos automaticamente quando alguém seleciona
              &quot;Estou procurando emprego&quot;.
            </p>
          </div>

          {helpers.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              Nenhum contato salvo em Possíveis ajudantes ainda.
            </p>
          ) : (
            <div className="space-y-3">
              {helpers.map((helper) => (
                <div
                  key={helper.id}
                  className="p-3.5 rounded-lg border border-slate-200 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-900">
                        {helper.name || 'Sem nome'}
                      </span>
                      {helper.phone && (
                        <span className="ml-2 text-xs font-mono text-slate-600">
                          {helper.phone}
                        </span>
                      )}
                      {helper.city && (
                        <span className="ml-2 text-xs text-slate-500">
                          · {helper.city}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteHelper(helper.id)}
                      className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                      aria-label="Remover possível ajudante"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={helper.notes}
                    onChange={(e) =>
                      onUpdateHelperNotes(helper.id, e.target.value)
                    }
                    placeholder="Anotações sobre experiência, região, disponibilidade..."
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-base text-slate-900"
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
