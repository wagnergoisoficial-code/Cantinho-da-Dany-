import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Download } from 'lucide-react';
import {
  INITIAL_LEAD_STATE,
  SERVICE_TYPE_LABELS,
} from './data/defaultPricing';
import { AuthGate } from './components/AuthGate';
import { CalendarView } from './components/CalendarView';
import { DashboardAndHistoryView } from './components/DashboardAndHistoryView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LeadInputLayer } from './components/LeadInputLayer';
import { LeadMessageParserBox } from './components/LeadMessageParserBox';
import { QuickQuoteCard } from './components/QuickQuoteCard';
import { SmartScheduleSuggestions } from './components/SmartScheduleSuggestions';
import { MessageAndHistoryLayer } from './components/MessageAndHistoryLayer';
import { NegotiationSubTab, NegotiationView } from './components/NegotiationView';
import { PhotoAnalysisLayer } from './components/PhotoAnalysisLayer';
import { PricingEngineLayer } from './components/PricingEngineLayer';
import { SettingsView } from './components/SettingsView';
import {
  AiPhotoAnalysis,
  FrequencyType,
  HouseCondition,
  LeadInputState,
  LeadInteractionEntry,
  LeadQuoteRecord,
  MapsRouteInsight,
  NegotiationStage,
  ParsedLeadPayload,
  PotentialHelperRecord,
  PricingConfig,
  QuoteStatus,
  ServiceType,
  UploadedPhoto,
} from './types/pricing';
import { OptionalMapsProvider } from './components/LeadMapsPanel';
import { calculateQuote, mapRoomsToTierId } from './utils/pricingEngine';
import { buildQuoteMessages } from './utils/messageBuilder';
import {
  addDaysToDateString,
  getLocalDateString,
  isLeadDueToday,
} from './utils/negotiationEngine';
import { apiFetch, setOnUnauthorizedHandler } from './utils/apiClient';
import {
  buildBackupPayload,
  isBackupOverdue,
  loadLastBackupAt,
  loadPotentialHelpers,
  loadPricingConfig,
  loadQuoteHistory,
  parseAndValidateBackupPayload,
  saveLastBackupAt,
  savePotentialHelpers,
  savePricingConfig,
  saveQuoteHistory,
  sanitizeReviewLink,
} from './utils/storage';
import {
  formatOfficialCityName,
  inferConnecticutCityFromZip,
} from './utils/cityFormatter';
import { parseLeadLocally } from './utils/localLeadParser';
import {
  DEFAULT_GOOGLE_CALENDAR_EMAIL,
  clearGoogleCalendarAccessToken,
  getFreshGoogleCalendarAccessToken,
  getGoogleCalendarAccessToken,
  googleCalendarLogout,
  googleCalendarSignIn,
  hasGoogleCalendarAccount,
  initGoogleCalendarAuth,
  renewGoogleCalendarAccessToken,
} from './utils/googleCalendarAuth';
import { GoogleCalendarUserError } from './utils/googleCalendarErrors';
import {
  CalendarWorkspaceBridge,
  CreateCalendarEventInput,
  GoogleCalendarAuthExpiredError,
  GoogleCalendarEvent,
  GoogleCalendarListItem,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  listGoogleCalendars,
  listUpcomingCalendarEvents,
} from './utils/googleCalendarApi';

type ActiveTab =
  | 'calculadora'
  | 'negociacao'
  | 'agenda'
  | 'painel'
  | 'configuracoes';

export default function App() {
  const [authStatus, setAuthStatus] = useState<{
    checking: boolean;
    authenticated: boolean;
    mode: 'env' | 'setup_required' | 'claimed';
  }>({
    checking: true,
    authenticated: false,
    mode: 'env',
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('calculadora');
  const [config, setConfig] = useState<PricingConfig>(() => loadPricingConfig());
  const [history, setHistory] = useState<LeadQuoteRecord[]>(() =>
    loadQuoteHistory()
  );
  const [helpers, setHelpers] = useState<PotentialHelperRecord[]>(() =>
    loadPotentialHelpers()
  );
  // Aba que a Negociação abre: 'ajudantes' quando vem do botão da Agenda.
  const [negotiationStartTab, setNegotiationStartTab] =
    useState<NegotiationSubTab>('hoje');
  useEffect(() => {
    if (activeTab === 'negociacao' && negotiationStartTab !== 'hoje') {
      setNegotiationStartTab('hoje');
    }
  }, [activeTab, negotiationStartTab]);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() =>
    loadLastBackupAt()
  );
  const [selectedNegotiationLeadId, setSelectedNegotiationLeadId] = useState<
    string | null
  >(null);

  const [input, setInput] = useState<LeadInputState>(() => {
    const initialCfg = loadPricingConfig();
    return {
      ...INITIAL_LEAD_STATE,
      dayOption1: initialCfg.defaultDayOption1 || 'Tuesday',
      dayOption2: initialCfg.defaultDayOption2 || 'Thursday',
    };
  });
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [analysis, setAnalysis] = useState<AiPhotoAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [customPrimaryPrice, setCustomPrimaryPrice] = useState<number | null>(
    null
  );
  const [customRecurringPrice, setCustomRecurringPrice] = useState<
    number | null
  >(null);
  const [justSaved, setJustSaved] = useState(false);
  const [lastSavedLeadId, setLastSavedLeadId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [leadPasteText, setLeadPasteText] = useState('');
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [isParsingLead, setIsParsingLead] = useState(false);
  const [parseLeadError, setParseLeadError] = useState<string | null>(null);
  const [parseLeadSummary, setParseLeadSummary] = useState<string | null>(null);
  const [parseSourceBadge, setParseSourceBadge] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<Set<string>>(new Set());
  const [mapsApiKey, setMapsApiKey] = useState<string>(() =>
    String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  );
  const [mapsInsight, setMapsInsight] = useState<MapsRouteInsight | null>(null);

  // Guarda de alterações não salvas nos Ajustes
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingSettingsDraft, setPendingSettingsDraft] =
    useState<PricingConfig | null>(null);
  const [pendingNavAction, setPendingNavAction] = useState<(() => void) | null>(
    null
  );

  // Estado da integração com Google Calendar (o token fica salvo até vencer, ver googleCalendarAuth.ts)
  const [calendarToken, setCalendarToken] = useState<string | null>(null);
  const [calendarUserEmail, setCalendarUserEmail] = useState<string | null>(
    null
  );
  const [calendarLoggingIn, setCalendarLoggingIn] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] =
    useState<string>('primary');
  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEvent[]>(
    []
  );

  const calc = useMemo(() => calculateQuote(input, config), [input, config]);

  const finalPrimaryPrice =
    customPrimaryPrice ?? calc.effectiveDefaultPrimaryPrice;
  const finalRecurringPrice = calc.isRecurring
    ? customRecurringPrice ?? calc.recurringTablePrice
    : null;

  const dueTodayCount = useMemo(
    () => history.filter((rec) => isLeadDueToday(rec)).length,
    [history]
  );

  const backupOverdue = useMemo(
    () => history.length > 0 && isBackupOverdue(lastBackupAt, 7),
    [history.length, lastBackupAt]
  );

  useEffect(() => {
    setOnUnauthorizedHandler(() => {
      setAuthStatus((prev) => ({ ...prev, authenticated: false }));
    });
    return () => setOnUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch('/api/auth/status')
      .then((res) => res.json())
      .then(
        (data: {
          authenticated?: boolean;
          mode?: 'env' | 'setup_required' | 'claimed';
        }) => {
          if (!active) return;
          setAuthStatus({
            checking: false,
            authenticated: Boolean(data.authenticated),
            mode: data.mode || 'env',
          });
        }
      )
      .catch(() => {
        if (!active) return;
        setAuthStatus({
          checking: false,
          authenticated: false,
          mode: 'env',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authStatus.authenticated || mapsApiKey) return;
    let active = true;
    apiFetch('/api/maps/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { mapsApiKey?: string } | null) => {
        if (!active || !data?.mapsApiKey) return;
        setMapsApiKey(data.mapsApiKey.trim());
      })
      .catch(() => {
        // Ignora erro caso chave não esteja configurada
      });
    return () => {
      active = false;
    };
  }, [authStatus.authenticated, mapsApiKey]);

  useEffect(() => {
    saveQuoteHistory(history);
  }, [history]);

  useEffect(() => {
    savePotentialHelpers(helpers);
  }, [helpers]);

  useEffect(() => {
    if (activeTab !== 'configuracoes' || !settingsDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [activeTab, settingsDirty]);

  const resetCalendarState = useCallback(() => {
    setCalendarToken(null);
    setCalendars([]);
    setCalendarEvents([]);
  }, []);

  const describeCalendarError = useCallback(
    (err: unknown, fallback: string): string | null => {
      if (err instanceof GoogleCalendarUserError && err.silent) return null;
      return err instanceof Error && err.message ? err.message : fallback;
    },
    []
  );

  /**
   * Executa uma ação na agenda com um token válido. Se o token estiver perto
   * de vencer (ou o Google responder 401), renova automaticamente uma vez e
   * repete a ação. Chamado a partir de cliques, então a janela rápida do
   * Google não é bloqueada pelo navegador.
   */
  const withCalendarToken = useCallback(
    async <T,>(action: (token: string) => Promise<T>): Promise<T> => {
      let token = await getFreshGoogleCalendarAccessToken(true);
      if (!token) {
        throw new GoogleCalendarUserError(
          'Conecte o Google Agenda antes de continuar.',
          'calendar/not-connected'
        );
      }
      setCalendarToken(token);
      try {
        return await action(token);
      } catch (err) {
        if (!(err instanceof GoogleCalendarAuthExpiredError)) throw err;
        clearGoogleCalendarAccessToken();
        token = await renewGoogleCalendarAccessToken();
        setCalendarToken(token);
        return await action(token);
      }
    },
    []
  );

  const fetchCalendarData = useCallback(
    async (token: string, preferredCalendarId?: string) => {
      const list = await listGoogleCalendars(token);
      setCalendars(list);

      const preferredEmailMatch = list.find(
        (item) =>
          item.id.toLowerCase() === DEFAULT_GOOGLE_CALENDAR_EMAIL.toLowerCase()
      );

      const targetId =
        preferredCalendarId &&
        list.some((item) => item.id === preferredCalendarId)
          ? preferredCalendarId
          : preferredEmailMatch?.id ||
            list.find((item) => item.primary)?.id ||
            'primary';

      setSelectedCalendarId(targetId);
      const upcoming = await listUpcomingCalendarEvents(token, targetId, 45);
      setCalendarEvents(upcoming);
    },
    []
  );

  /** Carregamento automático (sem clique): nunca abre janela do Google. */
  const loadCalendarData = useCallback(
    async (token: string, preferredCalendarId?: string) => {
      setCalendarLoading(true);
      setCalendarError(null);
      try {
        await fetchCalendarData(token, preferredCalendarId);
      } catch (err) {
        if (err instanceof GoogleCalendarAuthExpiredError) {
          clearGoogleCalendarAccessToken();
          resetCalendarState();
        }
        setCalendarError(
          describeCalendarError(err, 'Erro ao carregar eventos do Google Agenda.')
        );
      } finally {
        setCalendarLoading(false);
      }
    },
    [fetchCalendarData, resetCalendarState, describeCalendarError]
  );

  useEffect(() => {
    const unsubscribe = initGoogleCalendarAuth(
      (user, token) => {
        // Recarregou a página com a conexão ainda válida: reconecta sozinho.
        setCalendarUserEmail(user.email || user.displayName || null);
        setCalendarToken(token);
        void loadCalendarData(token);
      },
      () => {
        setCalendarUserEmail(null);
        resetCalendarState();
      },
      (user) => {
        // Conta lembrada, mas o token venceu: um toque em Conectar renova.
        setCalendarUserEmail(user.email || user.displayName || null);
        resetCalendarState();
      }
    );
    return () => unsubscribe();
  }, [loadCalendarData, resetCalendarState]);

  const handleCalendarSignIn = useCallback(async () => {
    setCalendarLoggingIn(true);
    setCalendarError(null);
    try {
      const result = await googleCalendarSignIn();
      setCalendarUserEmail(
        result.user.email || result.user.displayName || null
      );
      setCalendarToken(result.accessToken);
      await loadCalendarData(result.accessToken, selectedCalendarId);
    } catch (err) {
      setCalendarError(
        describeCalendarError(err, 'Não foi possível conectar ao Google Agenda.')
      );
    } finally {
      setCalendarLoggingIn(false);
    }
  }, [loadCalendarData, describeCalendarError, selectedCalendarId]);

  const handleCalendarLogout = useCallback(async () => {
    await googleCalendarLogout();
    resetCalendarState();
    setCalendarUserEmail(null);
    setSelectedCalendarId('primary');
    setCalendarError(null);
  }, [resetCalendarState]);

  const handleCalendarActionError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof GoogleCalendarUserError && err.silent) return;
      if (!hasGoogleCalendarAccount() || !getGoogleCalendarAccessToken()) {
        resetCalendarState();
      }
      setCalendarError(describeCalendarError(err, fallback));
    },
    [resetCalendarState, describeCalendarError]
  );

  const handleSelectCalendar = useCallback(
    async (nextCalendarId: string) => {
      setSelectedCalendarId(nextCalendarId);
      if (!calendarToken) return;
      setCalendarLoading(true);
      setCalendarError(null);
      try {
        const upcoming = await withCalendarToken((token) =>
          listUpcomingCalendarEvents(token, nextCalendarId, 45)
        );
        setCalendarEvents(upcoming);
      } catch (err) {
        handleCalendarActionError(err, 'Erro ao carregar a agenda selecionada.');
      } finally {
        setCalendarLoading(false);
      }
    },
    [calendarToken, withCalendarToken, handleCalendarActionError]
  );

  const handleRefreshCalendar = useCallback(async () => {
    if (!hasGoogleCalendarAccount()) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      await withCalendarToken((token) =>
        fetchCalendarData(token, selectedCalendarId)
      );
    } catch (err) {
      handleCalendarActionError(err, 'Erro ao atualizar a agenda.');
    } finally {
      setCalendarLoading(false);
    }
  }, [
    selectedCalendarId,
    withCalendarToken,
    fetchCalendarData,
    handleCalendarActionError,
  ]);

  const handleCreateCalendarEvent = useCallback(
    async (eventInput: CreateCalendarEventInput) => {
      if (!hasGoogleCalendarAccount()) {
        throw new Error('Conecte o Google Agenda antes de agendar.');
      }
      try {
        const upcoming = await withCalendarToken(async (token) => {
          await createGoogleCalendarEvent(token, selectedCalendarId, eventInput);
          return listUpcomingCalendarEvents(token, selectedCalendarId, 45);
        });
        setCalendarEvents(upcoming);
      } catch (err) {
        handleCalendarActionError(err, 'Não foi possível criar o evento.');
        throw err;
      }
    },
    [selectedCalendarId, withCalendarToken, handleCalendarActionError]
  );

  const handleDeleteCalendarEvent = useCallback(
    async (eventId: string) => {
      if (!hasGoogleCalendarAccount()) {
        throw new Error('Conecte o Google Agenda antes de excluir.');
      }
      try {
        const upcoming = await withCalendarToken(async (token) => {
          await deleteGoogleCalendarEvent(token, selectedCalendarId, eventId);
          return listUpcomingCalendarEvents(token, selectedCalendarId, 45);
        });
        setCalendarEvents(upcoming);
      } catch (err) {
        handleCalendarActionError(err, 'Não foi possível excluir o evento.');
        throw err;
      }
    },
    [selectedCalendarId, withCalendarToken, handleCalendarActionError]
  );

  const calendarIntegration = useMemo<CalendarWorkspaceBridge>(
    () => ({
      connected: Boolean(calendarToken),
      userEmail: calendarUserEmail,
      isLoggingIn: calendarLoggingIn,
      isLoading: calendarLoading,
      error: calendarError,
      calendars,
      selectedCalendarId,
      events: calendarEvents,
      onSignIn: handleCalendarSignIn,
      onRefresh: handleRefreshCalendar,
      onCreateEvent: handleCreateCalendarEvent,
      onOpenCalendarTab: () => setActiveTab('agenda'),
    }),
    [
      calendarToken,
      calendarUserEmail,
      calendarLoggingIn,
      calendarLoading,
      calendarError,
      calendars,
      selectedCalendarId,
      calendarEvents,
      handleCalendarSignIn,
      handleRefreshCalendar,
      handleCreateCalendarEvent,
    ]
  );

  const handleSaveConfig = (nextConfig: PricingConfig) => {
    setConfig(nextConfig);
    savePricingConfig(nextConfig);
    setInput((prev) => ({
      ...prev,
      dayOption1:
        prev.dayOption1 === config.defaultDayOption1
          ? nextConfig.defaultDayOption1
          : prev.dayOption1,
      dayOption2:
        prev.dayOption2 === config.defaultDayOption2
          ? nextConfig.defaultDayOption2
          : prev.dayOption2,
    }));
    setSettingsDirty(false);
    setPendingSettingsDraft(null);
  };

  const handleDirtyChange = useCallback(
    (dirty: boolean, currentDraft: PricingConfig) => {
      setSettingsDirty(dirty);
      setPendingSettingsDraft(dirty ? currentDraft : null);
    },
    []
  );

  const runWithSettingsGuard = (action: () => void) => {
    if (activeTab === 'configuracoes' && settingsDirty) {
      setPendingNavAction(() => action);
      return;
    }
    action();
  };

  const handleExportBackup = () => {
    const payload = buildBackupPayload(config, history, helpers);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStamp = getLocalDateString();
    const link = document.createElement('a');
    link.href = url;
    link.download = `dany-clean-pro-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    const nowIso = new Date().toISOString();
    saveLastBackupAt(nowIso);
    setLastBackupAt(nowIso);
  };

  const handleImportBackup = (rawJson: string) => {
    const restored = parseAndValidateBackupPayload(rawJson);
    setConfig(restored.pricingConfig);
    savePricingConfig(restored.pricingConfig);
    setHistory(restored.history);
    saveQuoteHistory(restored.history);
    setHelpers(restored.helpers);
    savePotentialHelpers(restored.helpers);
    setSettingsDirty(false);
    setPendingSettingsDraft(null);

    const nowIso = new Date().toISOString();
    saveLastBackupAt(nowIso);
    setLastBackupAt(nowIso);
  };

  const clearMissingField = (field: string) => {
    if (field === 'origin') {
      setSaveError(null);
    }
    setMissingFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const resetQuoteAndOpenCalculator = () => {
    setInput({
      ...INITIAL_LEAD_STATE,
      dayOption1: config.defaultDayOption1 || 'Tuesday',
      dayOption2: config.defaultDayOption2 || 'Thursday',
    });
    setPhotos([]);
    setAnalysis(null);
    setAnalysisError(null);
    setCustomPrimaryPrice(null);
    setCustomRecurringPrice(null);
    setJustSaved(false);
    setLastSavedLeadId(null);
    setSaveError(null);
    setLeadPasteText('');
    setParseLeadError(null);
    setParseLeadSummary(null);
    setParseSourceBadge(null);
    setMissingFields(new Set());
    setMapsInsight(null);
    setActiveTab('calculadora');
  };

  const handleNewQuote = () => {
    runWithSettingsGuard(resetQuoteAndOpenCalculator);
  };

  const applyParsedLeadPayload = (
    payload: Partial<ParsedLeadPayload>,
    sourceBadge: 'Lido em 0,1 s' | 'Lido com IA'
  ) => {
    const zipCode = (payload.zip_code ?? '').trim();
    const rawCity = (payload.cidade ?? '').trim();
    const deducedCity = rawCity || inferConnecticutCityFromZip(zipCode);
    const formattedCity = deducedCity ? formatOfficialCityName(deducedCity) : '';

    const quartos =
      typeof payload.quartos === 'number' && Number.isFinite(payload.quartos)
        ? payload.quartos
        : null;
    const banheiros =
      typeof payload.banheiros === 'number' && Number.isFinite(payload.banheiros)
        ? payload.banheiros
        : null;
    const mappedTierId = mapRoomsToTierId(quartos, banheiros, config.tiers);

    const rawFreq =
      payload.frequencia && payload.frequencia !== 'nao_informado'
        ? payload.frequencia
        : '';
    const rawTipo =
      payload.tipo && payload.tipo !== 'nao_informado' ? payload.tipo : '';

    let nextServiceType: ServiceType = input.serviceType;
    let serviceIdentified = false;
    if (
      rawTipo === 'recorrente' ||
      rawTipo === 'deep_clean' ||
      rawTipo === 'move_in_out' ||
      rawTipo === 'visita_avulsa'
    ) {
      nextServiceType = rawTipo;
      serviceIdentified = true;
    } else if (
      rawFreq === 'semanal' ||
      rawFreq === 'quinzenal' ||
      rawFreq === 'mensal'
    ) {
      nextServiceType = 'recorrente';
      serviceIdentified = true;
    } else if (rawFreq === 'unica') {
      nextServiceType = 'primeira_avulsa';
      serviceIdentified = true;
    }

    let nextFrequency: FrequencyType = input.frequency;
    let frequencyIdentified = false;
    if (
      rawFreq === 'semanal' ||
      rawFreq === 'quinzenal' ||
      rawFreq === 'mensal'
    ) {
      nextFrequency = rawFreq;
      frequencyIdentified = true;
    }

    const promoActive = Boolean(payload.promocao);
    const promoPct =
      promoActive &&
      typeof payload.promocao_percentual === 'number' &&
      payload.promocao_percentual > 0
        ? String(payload.promocao_percentual)
        : '';
    const promoLabel = promoActive ? (payload.promocao_nome ?? '').trim() : '';

    const nextMissing = new Set<string>();
    const nome = (payload.nome ?? '').trim();
    const telefone = (payload.telefone ?? '').trim();
    const email = (payload.email ?? '').trim();
    const dataDesejada = (payload.data_desejada ?? '').trim();
    const melhorContato = (payload.melhor_contato ?? '').trim();
    const observacoes = (payload.observacoes ?? '').trim();

    if (!nome) nextMissing.add('clientName');
    if (!telefone) nextMissing.add('phone');
    if (!email) nextMissing.add('email');
    if (!zipCode) nextMissing.add('zipCode');
    if (!formattedCity) nextMissing.add('city');
    if (!dataDesejada) nextMissing.add('desiredDate');
    if (!melhorContato) nextMissing.add('bestContact');
    if (!mappedTierId) nextMissing.add('selectedTierId');
    if (!serviceIdentified) nextMissing.add('serviceType');
    if (nextServiceType === 'recorrente' && !frequencyIdentified) {
      nextMissing.add('frequency');
    }

    setInput((prev) => ({
      ...prev,
      clientName: nome,
      phone: telefone,
      email,
      zipCode,
      city: formattedCity,
      desiredDate: dataDesejada,
      bestContact: melhorContato,
      notes: observacoes,
      selectedTierId: mappedTierId ?? prev.selectedTierId,
      serviceType: nextServiceType,
      frequency: nextFrequency,
      promoPercent: promoPct,
      promoName: promoLabel,
    }));

    setCustomPrimaryPrice(null);
    setCustomRecurringPrice(null);
    setJustSaved(false);
    setMissingFields(nextMissing);
    setParseSourceBadge(sourceBadge);
    setParseLeadSummary(
      nextMissing.size > 0
        ? 'Campos preenchidos. Itens em amarelo ficaram vazios na mensagem — complete antes de enviar.'
        : 'Todos os campos principais foram preenchidos automaticamente.'
    );
  };

  const handleParseLead = async () => {
    if (!leadPasteText.trim()) return;
    setParseLeadError(null);
    setParseLeadSummary(null);
    setParseSourceBadge(null);

    // 1. Leitura local instantânea no navegador (sem chamar Gemini)
    const localResult = parseLeadLocally(leadPasteText);
    if (localResult.matchedFieldsCount >= 3) {
      applyParsedLeadPayload(localResult.payload, 'Lido em 0,1 s');
      return;
    }

    // 2. Fallback para Gemini Flash-Lite (sem thinking) apenas para texto livre (< 3 campos locais)
    setIsParsingLead(true);
    try {
      const response = await apiFetch('/api/parse-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: leadPasteText }),
      });

      let payload: Partial<ParsedLeadPayload> & { error?: string } = {};
      try {
        payload = (await response.json()) as Partial<ParsedLeadPayload> & {
          error?: string;
        };
      } catch {
        payload = {};
      }

      if (!response.ok) {
        if (response.status === 503 || response.status === 429) {
          throw new Error(
            payload.error ||
              'A IA está ocupada agora. Tente de novo em 1 minuto ou preencha os campos manualmente.'
          );
        }
        throw new Error(
          payload.error || 'Não foi possível interpretar a mensagem do lead.'
        );
      }

      applyParsedLeadPayload(payload, 'Lido com IA');
    } catch (err) {
      setParseLeadError(
        err instanceof Error
          ? err.message
          : 'Erro ao interpretar a mensagem do lead.'
      );
    } finally {
      setIsParsingLead(false);
    }
  };

  const handleAnalyzePhotos = async () => {
    if (photos.length === 0) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const response = await apiFetch('/api/analyze-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photos: photos.map((p) => ({
            mimeType: p.mimeType,
            data: p.dataUrl,
          })),
          serviceType: SERVICE_TYPE_LABELS[input.serviceType],
          houseLabel: calc.effectiveTier.label,
        }),
      });

      let payload: {
        error?: string;
        estado?: HouseCondition;
        justificativa?: string;
        alertas?: string[];
        confianca?: number;
      } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = {};
      }

      if (!response.ok || !payload.estado) {
        if (response.status === 413) {
          throw new Error(
            'As fotos ficaram muito grandes juntas. Tente remover algumas ou enviar até 4 fotos por vez.'
          );
        }
        if (response.status === 503 || response.status === 429) {
          throw new Error(
            payload.error ||
              'A IA está ocupada agora. Tente de novo em 1 minuto ou preencha os campos manualmente.'
          );
        }
        throw new Error(
          payload.error || 'Não foi possível concluir a análise das fotos.'
        );
      }

      setAnalysis({
        estado: payload.estado,
        justificativa: payload.justificativa || '',
        alertas: payload.alertas || [],
        confianca: payload.confianca ?? 0,
        analyzedAt: new Date().toISOString(),
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : '';
      const friendlyMessage =
        /failed to fetch|networkerror|load failed/i.test(rawMessage)
          ? 'Falha de conexão ao enviar as fotos para análise. Verifique a internet e tente novamente.'
          : rawMessage || 'Erro ao analisar as fotos.';
      setAnalysisError(friendlyMessage);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const saveLeadFromCalculator = (openConversationAfter: boolean) => {
    if (!input.origin) {
      setMissingFields((prev) => {
        const next = new Set(prev);
        next.add('origin');
        return next;
      });
      setSaveError(
        'Selecione a Origem do lead na Camada 1 antes de salvar no histórico.'
      );
      return;
    }

    setSaveError(null);
    const nowIso = new Date().toISOString();
    const today = getLocalDateString();
    const initialStage: NegotiationStage =
      input.serviceType === 'deep_clean' && photos.length === 0
        ? 'Aguardando fotos'
        : 'Orçamento enviado';

    const initialQuoteMsgs = buildQuoteMessages(
      input,
      calc,
      finalPrimaryPrice,
      finalRecurringPrice,
      config.deepCleanRangeMarginPercent,
      config.servedCities,
      new Date(),
      config.cityFixedDays
    );

    const initialInteraction: LeadInteractionEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: nowIso,
      clientMessageEn: leadPasteText.trim(),
      clientMessagePt: '',
      realIntentPt: 'Solicitação inicial de orçamento',
      objection: 'duvida_sem_objeccao',
      sentReplyEn: initialQuoteMsgs.english,
      sentReplyPt: initialQuoteMsgs.portuguese,
      step: 0,
      kind: 'initial_quote',
    };

    const newRecord: LeadQuoteRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: nowIso,
      clientName: input.clientName.trim() || 'Lead sem nome',
      phone: input.phone.trim(),
      email: input.email.trim(),
      streetAddress: (input.streetAddress || '').trim(),
      zipCode: input.zipCode.trim(),
      city: formatOfficialCityName(input.city),
      desiredDate: input.desiredDate.trim(),
      bestContact: input.bestContact.trim(),
      origin: input.origin,
      adCode: input.origin === 'Facebook' ? input.adCode.trim() : '',
      notes: input.notes.trim(),
      squareFeet: calc.parsedSqFt,
      houseLabel: calc.selectedTier.label,
      effectiveHouseLabel: calc.effectiveTier.label,
      serviceType: input.serviceType,
      frequency: input.serviceType === 'recorrente' ? input.frequency : null,
      visitaAvulsaOption:
        input.serviceType === 'visita_avulsa' ? input.visitaAvulsaOption : null,
      houseCondition:
        input.serviceType === 'visita_avulsa' ? null : input.houseCondition,
      petsOption:
        input.serviceType === 'visita_avulsa' ? null : input.petsOption,
      tablePricePrimary: calc.primaryTablePrice,
      promoPercent: calc.promoPercent > 0 ? calc.promoPercent : null,
      promoName: input.promoName.trim(),
      finalPricePrimary: finalPrimaryPrice,
      tablePriceRecurring: calc.recurringTablePrice,
      finalPriceRecurring: finalRecurringPrice,
      aiConfidence: analysis ? analysis.confianca : null,
      aiEstado: analysis ? analysis.estado : null,
      status: 'Enviado',
      lossReason: '',
      stage: initialStage,
      objection: null,
      concession: null,
      followUpStep: 2,
      nextFollowUpDate: addDaysToDateString(today, 2),
      firstOutboundAt: nowIso,
      firstInboundAt: null,
      lastOutboundAt: nowIso,
      lastInboundAt: null,
      consecutiveOutboundCount: 1,
      blockedUntilDate: null,
      hibernateUntilDate: null,
      priceAlreadySent: initialStage !== 'Aguardando fotos',
      lastGeneratedMessage: {
        english: initialQuoteMsgs.english,
        portuguese: initialQuoteMsgs.portuguese,
        generatedAt: nowIso,
        step: 0,
        objection: null,
      },
      interactionHistory: [initialInteraction],
      mapsInsight,
      dayOption1: input.dayOption1,
      dayOption2: input.dayOption2,
    };

    setHistory((prev) => [newRecord, ...prev]);
    setLastSavedLeadId(newRecord.id);
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 6000);

    if (openConversationAfter) {
      setSelectedNegotiationLeadId(newRecord.id);
      setActiveTab('negociacao');
    }
  };

  const handleSaveToHistory = () => saveLeadFromCalculator(false);
  const handleSaveAndOpenConversation = () => saveLeadFromCalculator(true);

  const handleUpdateStatus = (
    id: string,
    status: QuoteStatus,
    lossReason: string
  ) => {
    setHistory((prev) =>
      prev.map((rec) => {
        if (rec.id !== id) return rec;
        let stage: NegotiationStage = rec.stage;
        if (status === 'Fechou') stage = 'Agendado';
        else if (status === 'Perdeu') stage = 'Perdido';
        else if (
          rec.stage === 'Agendado' ||
          rec.stage === 'Cliente fixo' ||
          rec.stage === 'Perdido'
        ) {
          stage = 'Orçamento enviado';
        }
        return { ...rec, status, lossReason, stage };
      })
    );
  };

  const handleUpdateNegotiationLead = (updated: LeadQuoteRecord) => {
    setHistory((prev) =>
      prev.map((rec) => (rec.id === updated.id ? updated : rec))
    );
  };

  const handleCreateQuickLead = (newLead: LeadQuoteRecord) => {
    setHistory((prev) => [newLead, ...prev]);
  };

  const handleDeleteRecord = (id: string) => {
    setHistory((prev) => prev.filter((rec) => rec.id !== id));
    if (selectedNegotiationLeadId === id) {
      setSelectedNegotiationLeadId(null);
    }
  };

  const handleSavePotentialHelper = (lead: LeadQuoteRecord) => {
    setHelpers((prev) => {
      const alreadyExists = prev.some(
        (h) =>
          h.sourceLeadId === lead.id ||
          (lead.phone && h.phone && h.phone === lead.phone)
      );
      if (alreadyExists) return prev;
      const newHelper: PotentialHelperRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: lead.clientName || 'Contato sem nome',
        phone: lead.phone || '',
        email: lead.email || '',
        city: lead.city || '',
        notes: lead.notes || '',
        savedAt: new Date().toISOString(),
        sourceLeadId: lead.id,
      };
      return [newHelper, ...prev];
    });
  };

  const handleAddHelper = (helper: PotentialHelperRecord) => {
    setHelpers((prev) => [helper, ...prev]);
  };

  const handleUpdateHelper = (
    id: string,
    patch: Partial<PotentialHelperRecord>
  ) => {
    setHelpers((prev) =>
      prev.map((h) => (h.id === id ? { ...h, ...patch, id: h.id } : h))
    );
  };

  const handleOpenHelpers = () => {
    setNegotiationStartTab('ajudantes');
    setActiveTab('negociacao');
  };

  const handleDeleteHelper = (id: string) => {
    setHelpers((prev) => prev.filter((h) => h.id !== id));
  };

  const handleOpenNegotiation = (id: string) => {
    setSelectedNegotiationLeadId(id);
    setActiveTab('negociacao');
  };

  if (authStatus.checking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 text-sm text-slate-600">
          Carregando aplicativo...
        </div>
      </div>
    );
  }

  if (!authStatus.authenticated) {
    return (
      <AuthGate
        mode={authStatus.mode}
        onAuthenticated={() =>
          setAuthStatus((prev) => ({ ...prev, authenticated: true }))
        }
      />
    );
  }

  return (
    <OptionalMapsProvider mapsApiKey={mapsApiKey}>
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 overflow-x-hidden">
      {/* Top Bar Contract (3 zonas: Marca, Links, 1 Ação Primária) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-8">
          <button
            type="button"
            onClick={() =>
              runWithSettingsGuard(() => setActiveTab('calculadora'))
            }
            className="min-w-0 flex-1 sm:flex-initial text-sm sm:text-lg font-bold tracking-tight text-[#0B6273] text-left truncate"
          >
            Dany Clean Pro — Calculadora de Orçamento
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() =>
                runWithSettingsGuard(() => setActiveTab('calculadora'))
              }
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'calculadora'
                  ? 'border-[#0B6273] text-[#0B6273]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Calculadora
            </button>
            <button
              type="button"
              onClick={() =>
                runWithSettingsGuard(() => {
                  setSelectedNegotiationLeadId(null);
                  setActiveTab('negociacao');
                })
              }
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                activeTab === 'negociacao'
                  ? 'border-[#0B6273] text-[#0B6273]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Negociação</span>
              {dueTodayCount > 0 && (
                <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-md bg-[#0B6273] text-white font-mono tabular-nums">
                  {dueTodayCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => runWithSettingsGuard(() => setActiveTab('agenda'))}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                activeTab === 'agenda'
                  ? 'border-[#0B6273] text-[#0B6273]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Agenda</span>
              {calendarToken && (
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              )}
            </button>
            <button
              type="button"
              onClick={() => runWithSettingsGuard(() => setActiveTab('painel'))}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'painel'
                  ? 'border-[#0B6273] text-[#0B6273]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Painel e Histórico
            </button>
            <button
              type="button"
              onClick={() =>
                runWithSettingsGuard(() => setActiveTab('configuracoes'))
              }
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'configuracoes'
                  ? 'border-[#0B6273] text-[#0B6273]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Configurações
            </button>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleNewQuote}
              className="h-9 sm:h-10 px-3 sm:px-4 rounded-lg bg-[#0B6273] text-white text-xs sm:text-sm font-medium hover:bg-[#084E5C] transition-colors whitespace-nowrap shrink-0"
            >
              Novo orçamento
            </button>
          </div>
        </div>

        {/* Navegação mobile compacta */}
        <div className="md:hidden border-t border-slate-100 grid grid-cols-5 text-[11px] font-medium">
          <button
            type="button"
            onClick={() =>
              runWithSettingsGuard(() => setActiveTab('calculadora'))
            }
            className={`min-h-[42px] px-1 flex items-center justify-center text-center leading-tight border-b-2 transition-colors ${
              activeTab === 'calculadora'
                ? 'border-[#0B6273] text-[#0B6273] font-semibold bg-[#F0F7F9]/60'
                : 'border-transparent text-slate-600'
            }`}
          >
            Calcular
          </button>
          <button
            type="button"
            onClick={() =>
              runWithSettingsGuard(() => {
                setSelectedNegotiationLeadId(null);
                setActiveTab('negociacao');
              })
            }
            className={`min-h-[42px] px-1 flex items-center justify-center gap-1 text-center leading-tight border-b-2 transition-colors ${
              activeTab === 'negociacao'
                ? 'border-[#0B6273] text-[#0B6273] font-semibold bg-[#F0F7F9]/60'
                : 'border-transparent text-slate-600'
            }`}
          >
            <span>Leads</span>
            {dueTodayCount > 0 && (
              <span className="px-1 py-0.2 text-[10px] font-bold rounded bg-[#0B6273] text-white font-mono">
                {dueTodayCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => runWithSettingsGuard(() => setActiveTab('agenda'))}
            className={`min-h-[42px] px-1 flex items-center justify-center gap-1 text-center leading-tight border-b-2 transition-colors ${
              activeTab === 'agenda'
                ? 'border-[#0B6273] text-[#0B6273] font-semibold bg-[#F0F7F9]/60'
                : 'border-transparent text-slate-600'
            }`}
          >
            <span>Agenda</span>
            {calendarToken && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => runWithSettingsGuard(() => setActiveTab('painel'))}
            className={`min-h-[42px] px-1 flex items-center justify-center text-center leading-tight border-b-2 transition-colors ${
              activeTab === 'painel'
                ? 'border-[#0B6273] text-[#0B6273] font-semibold bg-[#F0F7F9]/60'
                : 'border-transparent text-slate-600'
            }`}
          >
            Histórico
          </button>
          <button
            type="button"
            onClick={() =>
              runWithSettingsGuard(() => setActiveTab('configuracoes'))
            }
            className={`min-h-[42px] px-1 flex items-center justify-center text-center leading-tight border-b-2 transition-colors ${
              activeTab === 'configuracoes'
                ? 'border-[#0B6273] text-[#0B6273] font-semibold bg-[#F0F7F9]/60'
                : 'border-transparent text-slate-600'
            }`}
          >
            Ajustes
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-8">
        {backupOverdue && activeTab !== 'configuracoes' && (
          <div className="mb-4 sm:mb-6 p-3.5 rounded-xl bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                <strong>Lembrete de backup:</strong>{' '}
                {lastBackupAt
                  ? 'seu último backup tem mais de 7 dias.'
                  : 'você ainda não exportou um backup dos seus dados.'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleExportBackup}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#0B6273] text-white text-xs font-semibold hover:bg-[#084E5C] shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar backup</span>
            </button>
          </div>
        )}
        {activeTab === 'calculadora' && (
          <ErrorBoundary
            scopeLabel="a Calculadora"
            onResetScope={() => setActiveTab('calculadora')}
          >
            <div className="space-y-4 sm:space-y-6">
              <LeadMessageParserBox
                text={leadPasteText}
                isParsing={isParsingLead}
                error={parseLeadError}
                parsedSummary={parseLeadSummary}
                parseSourceBadge={parseSourceBadge}
                onChangeText={(value) => {
                  setLeadPasteText(value);
                  setParseLeadError(null);
                }}
                onParse={handleParseLead}
                onClear={() => {
                  setLeadPasteText('');
                  setParseLeadError(null);
                  setParseLeadSummary(null);
                  setParseSourceBadge(null);
                }}
              />

              <QuickQuoteCard
                input={input}
                calc={calc}
                finalPrimaryPrice={finalPrimaryPrice}
                finalRecurringPrice={finalRecurringPrice}
                deepCleanRangeMarginPercent={config.deepCleanRangeMarginPercent}
                servedCities={config.servedCities}
                cityFixedDays={config.cityFixedDays}
                onChangeInput={(updater) => {
                  setInput(updater);
                  setJustSaved(false);
                }}
                onSaveToHistory={handleSaveToHistory}
                justSaved={justSaved}
                saveError={saveError}
                teamWhatsAppNumbers={config.teamWhatsAppNumbers}
              />

              <SmartScheduleSuggestions
                leadCity={input.city}
                leadZip={input.zipCode}
                leadStreetAddress={input.streetAddress}
                cityFixedDays={config.cityFixedDays}
                defaultDay1={input.dayOption1 || config.defaultDayOption1}
                defaultDay2={input.dayOption2 || config.defaultDayOption2}
                calendarIntegration={calendarIntegration}
              />

              <button
                type="button"
                onClick={() => setShowMoreDetails((v) => !v)}
                aria-expanded={showMoreDetails}
                aria-controls="maisDetalhes"
                className="w-full flex items-center justify-between gap-3 h-12 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
              >
                <span>
                  Mais detalhes
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    campos, preço, fotos e datas
                  </span>
                </span>
                <ChevronDown
                  className={`w-5 h-5 text-slate-500 transition-transform ${
                    showMoreDetails ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <div
                id="maisDetalhes"
                hidden={!showMoreDetails}
                className="space-y-4 sm:space-y-6"
              >
              <LeadInputLayer
                input={input}
                config={config}
                calc={calc}
                photos={photos}
                missingFields={missingFields}
                mapsApiKey={mapsApiKey}
                mapsInsight={mapsInsight}
                onMapsInsightChange={setMapsInsight}
                onClearMissingField={clearMissingField}
                onChange={(updater) => {
                  setInput(updater);
                  setJustSaved(false);
                }}
                onAddPhotos={(newPhotos) => {
                  setPhotos((prev) => [...prev, ...newPhotos].slice(0, 8));
                  setAnalysisError(null);
                }}
                onRemovePhoto={(id) => {
                  setPhotos((prev) => prev.filter((p) => p.id !== id));
                  setAnalysisError(null);
                }}
              />

              <PricingEngineLayer
                calc={calc}
                serviceType={input.serviceType}
                deepCleanRangeMarginPercent={config.deepCleanRangeMarginPercent}
                promoPercent={input.promoPercent}
                promoName={input.promoName}
                onChangePromoPercent={(value) => {
                  setInput((prev) => ({ ...prev, promoPercent: value }));
                  setCustomPrimaryPrice(null);
                  setJustSaved(false);
                }}
                onChangePromoName={(value) => {
                  setInput((prev) => ({ ...prev, promoName: value }));
                  setJustSaved(false);
                }}
                finalPrimaryPrice={finalPrimaryPrice}
                isPrimaryCustom={customPrimaryPrice !== null}
                onChangeFinalPrimary={(val) => {
                  setCustomPrimaryPrice(val);
                  setJustSaved(false);
                }}
                onResetPrimaryToTable={() => setCustomPrimaryPrice(null)}
                finalRecurringPrice={finalRecurringPrice}
                isRecurringCustom={customRecurringPrice !== null}
                onChangeFinalRecurring={(val) => {
                  setCustomRecurringPrice(val);
                  setJustSaved(false);
                }}
                onResetRecurringToTable={() => setCustomRecurringPrice(null)}
              />

              <PhotoAnalysisLayer
                photos={photos}
                analysis={analysis}
                isAnalyzing={isAnalyzing}
                error={analysisError}
                isVisitaAvulsa={input.serviceType === 'visita_avulsa'}
                onAnalyze={handleAnalyzePhotos}
                onApplyEstado={(estado) =>
                  setInput((prev) => ({ ...prev, houseCondition: estado }))
                }
              />

              <MessageAndHistoryLayer
                input={input}
                calc={calc}
                finalPrimaryPrice={finalPrimaryPrice}
                finalRecurringPrice={finalRecurringPrice}
                deepCleanRangeMarginPercent={config.deepCleanRangeMarginPercent}
                servedCities={config.servedCities}
                cityFixedDays={config.cityFixedDays}
                onChangeDays={(day1, day2) =>
                  setInput((prev) => ({
                    ...prev,
                    dayOption1: day1,
                    dayOption2: day2,
                  }))
                }
                onSaveToHistory={handleSaveToHistory}
                onSaveAndOpenConversation={handleSaveAndOpenConversation}
                onOpenLastSavedConversation={
                  lastSavedLeadId
                    ? () => handleOpenNegotiation(lastSavedLeadId)
                    : undefined
                }
                justSaved={justSaved}
                saveError={saveError}
              />
              </div>
            </div>
          </ErrorBoundary>
        )}

        {activeTab === 'negociacao' && (
          <ErrorBoundary
            scopeLabel="o módulo de Negociação"
            onResetScope={() => setSelectedNegotiationLeadId(null)}
          >
            <NegotiationView
              leads={history}
              helpers={helpers}
              config={config}
              mapsApiKey={mapsApiKey}
              selectedLeadId={selectedNegotiationLeadId}
              onSelectLeadId={setSelectedNegotiationLeadId}
              onUpdateLead={handleUpdateNegotiationLead}
              onCreateQuickLead={handleCreateQuickLead}
              onDeleteLead={handleDeleteRecord}
              onSavePotentialHelper={handleSavePotentialHelper}
              onAddHelper={handleAddHelper}
              onUpdateHelper={handleUpdateHelper}
              onDeleteHelper={handleDeleteHelper}
              initialSubTab={negotiationStartTab}
              onGoToCalculator={() => setActiveTab('calculadora')}
              calendarIntegration={calendarIntegration}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'agenda' && (
          <ErrorBoundary
            scopeLabel="a Agenda Google Calendar"
            onResetScope={() => setActiveTab('calculadora')}
          >
            <CalendarView
              connected={Boolean(calendarToken)}
              userEmail={calendarUserEmail}
              isLoggingIn={calendarLoggingIn}
              isLoading={calendarLoading}
              error={calendarError}
              calendars={calendars}
              selectedCalendarId={selectedCalendarId}
              events={calendarEvents}
              onSignIn={handleCalendarSignIn}
              onLogout={handleCalendarLogout}
              onSelectCalendar={handleSelectCalendar}
              onRefresh={handleRefreshCalendar}
              onCreateEvent={handleCreateCalendarEvent}
              onDeleteEvent={handleDeleteCalendarEvent}
              history={history}
              googleReviewLink={sanitizeReviewLink(config.googleReviewLink)}
              onOpenSettings={() => setActiveTab('configuracoes')}
              helpers={helpers}
              onOpenHelpers={handleOpenHelpers}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'painel' && (
          <ErrorBoundary
            scopeLabel="o Painel e Histórico"
            onResetScope={() => setActiveTab('calculadora')}
          >
            <DashboardAndHistoryView
              records={history}
              onUpdateStatus={handleUpdateStatus}
              onDeleteRecord={handleDeleteRecord}
              onOpenNegotiation={handleOpenNegotiation}
              onGoToCalculator={() => setActiveTab('calculadora')}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'configuracoes' && (
          <ErrorBoundary
            scopeLabel="as Configurações"
            onResetScope={() => setActiveTab('calculadora')}
          >
            <SettingsView
              config={config}
              lastBackupAt={lastBackupAt}
              backupOverdue={backupOverdue}
              onSaveConfig={handleSaveConfig}
              onExportBackup={handleExportBackup}
              onImportBackup={handleImportBackup}
              onDirtyChange={handleDirtyChange}
            />
          </ErrorBoundary>
        )}
      </main>

      {/* Modal de confirmação ao sair de Ajustes com alterações não salvas */}
      {pendingNavAction && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Alterações não salvas em Ajustes
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Você alterou configurações e ainda não salvou. O que deseja
                  fazer antes de sair?
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingNavAction(null)}
                className="h-10 px-3.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50"
              >
                Continuar editando
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = pendingNavAction;
                  setPendingNavAction(null);
                  setSettingsDirty(false);
                  setPendingSettingsDraft(null);
                  action();
                }}
                className="h-10 px-3.5 rounded-lg border border-red-200 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100"
              >
                Sair sem salvar
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = pendingNavAction;
                  if (pendingSettingsDraft) {
                    handleSaveConfig(pendingSettingsDraft);
                  }
                  setPendingNavAction(null);
                  action();
                }}
                className="h-10 px-4 rounded-lg bg-[#0B6273] text-white text-xs font-semibold hover:bg-[#084E5C]"
              >
                Salvar e sair
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </OptionalMapsProvider>
  );
}
