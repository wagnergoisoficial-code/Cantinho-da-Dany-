import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  Calendar,
  ChevronDown,
  Download,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings,
} from 'lucide-react';
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
import { MessageAndHistoryLayer } from './components/MessageAndHistoryLayer';
import { NegotiationSubTab, NegotiationView } from './components/NegotiationView';
import { QuickQuoteCard } from './components/QuickQuoteCard';
import { SmartScheduleSuggestions } from './components/SmartScheduleSuggestions';
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
  googleCalendarLogout,
  googleCalendarSignIn,
  googleCalendarSignInViaFirebase,
  initGoogleCalendarAuth,
} from './utils/googleCalendarAuth';
import { resolveDateOptionsForCity } from './utils/dateOptions';
import {
  CalendarWorkspaceBridge,
  CreateCalendarEventInput,
  GoogleCalendarAuthExpiredError,
  GoogleCalendarEvent,
  GoogleCalendarListItem,
  GoogleCalendarPermissionError,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  evaluateCalendarSlotAvailability,
  listGoogleCalendars,
  listUpcomingCalendarEvents,
} from './utils/googleCalendarApi';
import {
  signOutPrimarySession,
  subscribePrimaryAuth,
} from './utils/firebaseClient';
import {
  deleteHelperFromFirestore,
  deleteLeadFromFirestore,
  importBackupBundleToFirestore,
  normalizeDocId,
  reconcileRemoteHelpersWithLocal,
  reconcileRemoteLeadsWithLocal,
  runSafeLocalToFirestoreMigration,
  savePricingToFirestore,
  subscribeWorkspaceData,
  updateSyncMetaLastBackup,
  upsertHelperToFirestore,
  upsertLeadToFirestore,
} from './utils/firestoreSync';

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
    userEmail: string | null;
  }>({
    checking: true,
    authenticated: false,
    userEmail: null,
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('calculadora');
  // Aba que a Negociação abre: 'ajudantes' quando vem do botão da Agenda.
  const [negotiationStartTab, setNegotiationStartTab] =
    useState<NegotiationSubTab>('hoje');
  useEffect(() => {
    if (activeTab === 'negociacao' && negotiationStartTab !== 'hoje') {
      setNegotiationStartTab('hoje');
    }
  }, [activeTab, negotiationStartTab]);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [config, setConfig] = useState<PricingConfig>(() => loadPricingConfig());
  const [history, setHistory] = useState<LeadQuoteRecord[]>(() =>
    loadQuoteHistory()
  );
  const [helpers, setHelpers] = useState<PotentialHelperRecord[]>(() =>
    loadPotentialHelpers()
  );
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() =>
    loadLastBackupAt()
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncRetrying, setSyncRetrying] = useState(false);
  const [syncRetryNonce, setSyncRetryNonce] = useState(0);

  const historyRef = useRef(history);
  const helpersRef = useRef(helpers);
  const deletedLeadIdsRef = useRef<Set<string>>(new Set());
  const deletedHelperIdsRef = useRef<Set<string>>(new Set());
  const pendingLeadIdsRef = useRef<Set<string>>(new Set());
  const pendingHelperIdsRef = useRef<Set<string>>(new Set());

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

  // Estado em memória da integração com Google Calendar (token nunca vai para localStorage)
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
  const [calendarSyncSucceeded, setCalendarSyncSucceeded] = useState(false);

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
      void signOutPrimarySession().catch(() => undefined);
      setAuthStatus({
        checking: false,
        authenticated: false,
        userEmail: null,
      });
    });
    return () => setOnUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    return subscribePrimaryAuth((user, authorized) => {
      setAuthStatus({
        checking: false,
        authenticated: authorized,
        userEmail: authorized && user?.email ? user.email : null,
      });
    });
  }, []);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    helpersRef.current = helpers;
  }, [helpers]);

  useEffect(() => {
    if (!authStatus.authenticated) return;
    let active = true;
    let unsubscribeWorkspace: (() => void) | null = null;

    const startSync = async () => {
      try {
        await runSafeLocalToFirestoreMigration();
      } catch (err) {
        console.error('Erro na migração inicial para o Firestore:', err);
        if (!active) return;
        setSyncRetrying(false);
        setSyncError(
          'Falha na sincronização com a nuvem. Seus leads, conversas e configurações locais foram preservados.'
        );
        // Não inicia sincronização remota enquanto a migração não for concluída com sucesso
        return;
      }

      if (!active) return;
      setSyncError(null);
      setSyncRetrying(false);

      unsubscribeWorkspace = subscribeWorkspaceData({
        onPricing: (remoteConfig) => {
          if (!active) return;
          // WhatsApp da equipe, link de avaliação e endereço de saída ainda
          // não vão para a nuvem: ficam salvos neste aparelho.
          setConfig((prev) => {
            const merged: PricingConfig = {
              ...remoteConfig,
              teamWhatsAppNumbers: prev.teamWhatsAppNumbers,
              googleReviewLink: prev.googleReviewLink,
              homeStartAddress: prev.homeStartAddress,
            };
            savePricingConfig(merged);
            return merged;
          });
        },
        onLeads: (remoteLeads, meta) => {
          if (!active) return;
          const reconciled = reconcileRemoteLeadsWithLocal(
            remoteLeads,
            historyRef.current,
            {
              fromCache: meta.fromCache,
              explicitlyDeletedIds: deletedLeadIdsRef.current,
              pendingLocalIds: pendingLeadIdsRef.current,
            }
          );
          if (reconciled.preservedLocalOnly) {
            setSyncError(
              'A nuvem retornou vazia enquanto existem leads locais. Os dados locais foram preservados.'
            );
          }
          setHistory(reconciled.leads);
          saveQuoteHistory(reconciled.leads);
        },
        onHelpers: (remoteHelpers, meta) => {
          if (!active) return;
          const reconciled = reconcileRemoteHelpersWithLocal(
            remoteHelpers,
            helpersRef.current,
            {
              fromCache: meta.fromCache,
              explicitlyDeletedIds: deletedHelperIdsRef.current,
              pendingLocalIds: pendingHelperIdsRef.current,
            }
          );
          // Equipe, cidades e dias de cada ajudante ficam salvos neste aparelho.
          const localById = new Map(
            helpersRef.current.map((h) => [h.id, h] as const)
          );
          const withLocalTeamData = reconciled.helpers.map((h) => {
            const local = localById.get(h.id);
            return local
              ? {
                  ...h,
                  isTeam: local.isTeam,
                  serviceCities: local.serviceCities,
                  availableWeekdays: local.availableWeekdays,
                }
              : h;
          });
          setHelpers(withLocalTeamData);
          savePotentialHelpers(withLocalTeamData);
        },
        onSyncMeta: (meta) => {
          if (!active || !meta.lastBackupAt) return;
          setLastBackupAt(meta.lastBackupAt);
          saveLastBackupAt(meta.lastBackupAt);
        },
        onError: (err) => {
          console.error('Erro na sincronização em tempo real do Firestore:', err);
          if (!active) return;
          setSyncError(
            'Falha temporária na sincronização com a nuvem. Seus dados locais continuam salvos.'
          );
        },
      });
    };

    void startSync();

    return () => {
      active = false;
      if (unsubscribeWorkspace) {
        unsubscribeWorkspace();
      }
    };
  }, [authStatus.authenticated, syncRetryNonce]);

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

  const lastLoadedCalendarTokenRef = useRef<string | null>(null);

  const loadCalendarData = useCallback(
    async (
      token: string,
      preferredCalendarId?: string,
      options: { silentIfInsufficientScope?: boolean } = {}
    ) => {
      lastLoadedCalendarTokenRef.current = token;
      setCalendarLoading(true);
      setCalendarError(null);
      setCalendarSyncSucceeded(false);
      try {
        let list: GoogleCalendarListItem[] = [];
        try {
          list = await listGoogleCalendars(token);
        } catch (listErr) {
          if (
            listErr instanceof GoogleCalendarPermissionError &&
            !listErr.apiDisabled
          ) {
            list = [
              {
                id: 'primary',
                summary: 'Agenda principal',
                primary: true,
              },
            ];
          } else {
            throw listErr;
          }
        }

        if (list.length === 0) {
          list = [
            {
              id: 'primary',
              summary: 'Agenda principal',
              primary: true,
            },
          ];
        }
        setCalendars(list);

        const primaryCalendarEmail = list.find(
          (item) => item.primary && item.id.includes('@')
        )?.id;
        if (primaryCalendarEmail) {
          setCalendarUserEmail(primaryCalendarEmail);
        }

        const preferredEmailMatch = list.find(
          (item) =>
            item.id.toLowerCase() ===
            DEFAULT_GOOGLE_CALENDAR_EMAIL.toLowerCase()
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
        setCalendarSyncSucceeded(true);
      } catch (err) {
        setCalendarSyncSucceeded(false);
        if (
          err instanceof GoogleCalendarAuthExpiredError ||
          err instanceof GoogleCalendarPermissionError
        ) {
          lastLoadedCalendarTokenRef.current = null;
          clearGoogleCalendarAccessToken();
          setCalendarToken(null);
          setCalendars([]);
          setCalendarEvents([]);
          if (
            !(
              options.silentIfInsufficientScope &&
              err instanceof GoogleCalendarPermissionError &&
              err.insufficientScope
            )
          ) {
            setCalendarError(err.message);
          }
        } else {
          setCalendarError(
            err instanceof Error
              ? err.message
              : 'Erro ao carregar eventos do Google Calendar.'
          );
        }
      } finally {
        setCalendarLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const unsubscribe = initGoogleCalendarAuth(
      (user, token) => {
        setCalendarUserEmail(user.email || user.displayName || null);
        setCalendarToken(token);
        if (lastLoadedCalendarTokenRef.current !== token) {
          void loadCalendarData(token, undefined, {
            silentIfInsufficientScope: true,
          });
        }
      },
      () => {
        lastLoadedCalendarTokenRef.current = null;
        setCalendarToken(null);
        setCalendarUserEmail(null);
        setCalendars([]);
        setCalendarEvents([]);
        setCalendarSyncSucceeded(false);
      }
    );
    return () => unsubscribe();
  }, [loadCalendarData]);

  const handleCalendarSignIn = useCallback(async () => {
    setCalendarLoggingIn(true);
    setCalendarError(null);
    setCalendarSyncSucceeded(false);
    try {
      const result = await googleCalendarSignIn();
      if (result) {
        if (result.userEmail) {
          setCalendarUserEmail(result.userEmail);
        }
        setCalendarToken(result.accessToken);
        await loadCalendarData(result.accessToken);
      }
    } catch (err) {
      setCalendarSyncSucceeded(false);
      const message = err instanceof Error ? err.message : '';
      setCalendarError(
        message || 'Não foi possível conectar ao Google Calendar.'
      );
    } finally {
      setCalendarLoggingIn(false);
    }
  }, [loadCalendarData]);

  const handleCalendarSignInFallback = useCallback(async () => {
    setCalendarLoggingIn(true);
    setCalendarError(null);
    setCalendarSyncSucceeded(false);
    try {
      const result = await googleCalendarSignInViaFirebase(true);
      if (result) {
        if (result.userEmail) {
          setCalendarUserEmail(result.userEmail);
        }
        setCalendarToken(result.accessToken);
        await loadCalendarData(result.accessToken);
      }
    } catch (err) {
      setCalendarSyncSucceeded(false);
      const message = err instanceof Error ? err.message : '';
      setCalendarError(
        message || 'Não foi possível conectar ao Google Calendar.'
      );
    } finally {
      setCalendarLoggingIn(false);
    }
  }, [loadCalendarData]);

  const handleCalendarLogout = useCallback(async () => {
    lastLoadedCalendarTokenRef.current = null;
    await googleCalendarLogout();
    setCalendarToken(null);
    setCalendarUserEmail(null);
    setCalendars([]);
    setCalendarEvents([]);
    setSelectedCalendarId('primary');
    setCalendarError(null);
    setCalendarSyncSucceeded(false);
  }, []);

  const handleSelectCalendar = useCallback(
    async (nextCalendarId: string) => {
      setSelectedCalendarId(nextCalendarId);
      if (!calendarToken) {
        setCalendarSyncSucceeded(false);
        return;
      }
      setCalendarLoading(true);
      setCalendarError(null);
      setCalendarSyncSucceeded(false);
      try {
        const upcoming = await listUpcomingCalendarEvents(
          calendarToken,
          nextCalendarId,
          45
        );
        setCalendarEvents(upcoming);
        setCalendarSyncSucceeded(true);
      } catch (err) {
        setCalendarSyncSucceeded(false);
        if (
          err instanceof GoogleCalendarAuthExpiredError ||
          err instanceof GoogleCalendarPermissionError
        ) {
          clearGoogleCalendarAccessToken();
          setCalendarToken(null);
          setCalendars([]);
          setCalendarEvents([]);
        }
        setCalendarError(
          err instanceof Error
            ? err.message
            : 'Erro ao carregar a agenda selecionada.'
        );
      } finally {
        setCalendarLoading(false);
      }
    },
    [calendarToken]
  );

  const handleRefreshCalendar = useCallback(() => {
    if (!calendarToken) return;
    void loadCalendarData(calendarToken, selectedCalendarId);
  }, [calendarToken, selectedCalendarId, loadCalendarData]);

  const handleCreateCalendarEvent = useCallback(
    async (eventInput: CreateCalendarEventInput) => {
      if (!calendarToken) {
        throw new Error('Conecte o Google Calendar antes de agendar.');
      }
      try {
        await createGoogleCalendarEvent(
          calendarToken,
          selectedCalendarId,
          eventInput
        );
        const upcoming = await listUpcomingCalendarEvents(
          calendarToken,
          selectedCalendarId,
          45
        );
        setCalendarEvents(upcoming);
        setCalendarSyncSucceeded(true);
      } catch (err) {
        if (
          err instanceof GoogleCalendarAuthExpiredError ||
          err instanceof GoogleCalendarPermissionError
        ) {
          clearGoogleCalendarAccessToken();
          setCalendarToken(null);
          setCalendars([]);
          setCalendarEvents([]);
          setCalendarSyncSucceeded(false);
          setCalendarError(err.message);
        }
        throw err;
      }
    },
    [calendarToken, selectedCalendarId]
  );

  const handleDeleteCalendarEvent = useCallback(
    async (eventId: string) => {
      if (!calendarToken) {
        throw new Error('Conecte o Google Calendar antes de excluir.');
      }
      try {
        await deleteGoogleCalendarEvent(
          calendarToken,
          selectedCalendarId,
          eventId
        );
        const upcoming = await listUpcomingCalendarEvents(
          calendarToken,
          selectedCalendarId,
          45
        );
        setCalendarEvents(upcoming);
        setCalendarSyncSucceeded(true);
      } catch (err) {
        if (
          err instanceof GoogleCalendarAuthExpiredError ||
          err instanceof GoogleCalendarPermissionError
        ) {
          clearGoogleCalendarAccessToken();
          setCalendarToken(null);
          setCalendars([]);
          setCalendarEvents([]);
          setCalendarSyncSucceeded(false);
          setCalendarError(err.message);
        }
        throw err;
      }
    },
    [calendarToken, selectedCalendarId]
  );

  const calendarIntegration = useMemo<CalendarWorkspaceBridge>(
    () => ({
      connected: Boolean(calendarToken),
      userEmail: calendarUserEmail,
      isLoggingIn: calendarLoggingIn,
      isLoading: calendarLoading,
      error: calendarError,
      syncSucceeded: calendarSyncSucceeded,
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
      calendarSyncSucceeded,
      calendars,
      selectedCalendarId,
      calendarEvents,
      handleCalendarSignIn,
      handleRefreshCalendar,
      handleCreateCalendarEvent,
    ]
  );

  const calculatorCalendarAvailability = useMemo(() => {
    const resolvedDates = resolveDateOptionsForCity(
      input.city,
      config.cityFixedDays,
      input.dayOption1,
      input.dayOption2
    );
    const durationHours =
      input.serviceType === 'deep_clean' || input.serviceType === 'move_in_out'
        ? 4
        : 3;
    return evaluateCalendarSlotAvailability(
      calendarIntegration,
      resolvedDates.dates,
      durationHours
    );
  }, [
    calendarIntegration,
    input.city,
    input.dayOption1,
    input.dayOption2,
    input.serviceType,
    config.cityFixedDays,
  ]);

  const handleSaveConfig = (nextConfig: PricingConfig) => {
    const stampedConfig: PricingConfig = {
      ...nextConfig,
      updatedAt: new Date().toISOString(),
    };
    setConfig(stampedConfig);
    savePricingConfig(stampedConfig);
    void savePricingToFirestore(stampedConfig)
      .then(() => {
        setSyncError(null);
      })
      .catch((err) => {
        console.error('Erro ao salvar configurações no Firestore:', err);
        setSyncError(
          'Não foi possível sincronizar os ajustes na nuvem agora. Suas configurações locais foram preservadas.'
        );
      });
    setInput((prev) => ({
      ...prev,
      dayOption1:
        prev.dayOption1 === config.defaultDayOption1
          ? stampedConfig.defaultDayOption1
          : prev.dayOption1,
      dayOption2:
        prev.dayOption2 === config.defaultDayOption2
          ? stampedConfig.defaultDayOption2
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
    void updateSyncMetaLastBackup(nowIso).catch((err) => {
      console.error('Erro ao registrar data do backup no Firestore:', err);
    });
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

    void importBackupBundleToFirestore(
      restored.pricingConfig,
      restored.history,
      restored.helpers,
      nowIso
    ).catch((err) => {
      console.error('Erro ao sincronizar backup importado com Firestore:', err);
    });
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
        const isAuthFailure = response.status === 401 || response.status === 403;
        if (!isAuthFailure && response.status !== 400 && localResult.matchedFieldsCount > 0) {
          applyParsedLeadPayload(localResult.payload, 'Lido em 0,1 s');
          setParseLeadSummary(
            'IA indisponível no momento — campos detectados foram preenchidos pelo leitor local. Revise e complete os itens em amarelo.'
          );
          return;
        }
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
      if (
        !(err instanceof Error && /autenticação|acesso negado|sessão expirada/i.test(err.message)) &&
        localResult.matchedFieldsCount > 0
      ) {
        applyParsedLeadPayload(localResult.payload, 'Lido em 0,1 s');
        setParseLeadSummary(
          'IA indisponível no momento — campos detectados foram preenchidos pelo leitor local. Revise e complete os itens em amarelo.'
        );
      } else {
        setParseLeadError(
          err instanceof Error
            ? err.message
            : 'Erro ao interpretar a mensagem do lead.'
        );
      }
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
      config.cityFixedDays,
      calculatorCalendarAvailability
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
      updatedAt: nowIso,
    };

    const docId = normalizeDocId(newRecord.id);
    pendingLeadIdsRef.current.add(docId);
    setHistory((prev) => [newRecord, ...prev]);
    void upsertLeadToFirestore(newRecord)
      .then(() => {
        pendingLeadIdsRef.current.delete(docId);
        setSyncError(null);
      })
      .catch((err) => {
        console.error('Erro ao salvar lead no Firestore:', err);
        setSyncError(
          'Não foi possível enviar o lead para a nuvem agora. Ele foi mantido localmente.'
        );
      });
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
    const target = history.find((rec) => rec.id === id);
    if (!target) return;

    let stage: NegotiationStage = target.stage;
    if (status === 'Fechou') stage = 'Agendado';
    else if (status === 'Perdeu') stage = 'Perdido';
    else if (
      target.stage === 'Agendado' ||
      target.stage === 'Cliente fixo' ||
      target.stage === 'Perdido'
    ) {
      stage = 'Orçamento enviado';
    }
    const updatedRecord: LeadQuoteRecord = {
      ...target,
      status,
      lossReason,
      stage,
      updatedAt: new Date().toISOString(),
    };

    const docId = normalizeDocId(updatedRecord.id);
    pendingLeadIdsRef.current.add(docId);
    setHistory((prev) =>
      prev.map((rec) => (rec.id === id ? updatedRecord : rec))
    );
    void upsertLeadToFirestore(updatedRecord)
      .then(() => {
        pendingLeadIdsRef.current.delete(docId);
        setSyncError(null);
      })
      .catch((err) => {
        console.error('Erro ao atualizar status do lead no Firestore:', err);
        setSyncError(
          'Não foi possível sincronizar a atualização do lead na nuvem agora. Seus dados locais foram preservados.'
        );
      });
  };

  const handleUpdateNegotiationLead = (updated: LeadQuoteRecord) => {
    const stamped: LeadQuoteRecord = {
      ...updated,
      updatedAt: new Date().toISOString(),
    };
    const docId = normalizeDocId(stamped.id);
    pendingLeadIdsRef.current.add(docId);
    setHistory((prev) =>
      prev.map((rec) => (rec.id === stamped.id ? stamped : rec))
    );
    void upsertLeadToFirestore(stamped)
      .then(() => {
        pendingLeadIdsRef.current.delete(docId);
        setSyncError(null);
      })
      .catch((err) => {
        console.error('Erro ao atualizar negociação no Firestore:', err);
        setSyncError(
          'Não foi possível sincronizar a conversa na nuvem agora. Seus dados locais foram preservados.'
        );
      });
  };

  const handleCreateQuickLead = (newLead: LeadQuoteRecord) => {
    const stamped: LeadQuoteRecord = {
      ...newLead,
      updatedAt: newLead.updatedAt || new Date().toISOString(),
    };
    const docId = normalizeDocId(stamped.id);
    pendingLeadIdsRef.current.add(docId);
    setHistory((prev) => [stamped, ...prev]);
    void upsertLeadToFirestore(stamped)
      .then(() => {
        pendingLeadIdsRef.current.delete(docId);
        setSyncError(null);
      })
      .catch((err) => {
        console.error('Erro ao criar lead rápido no Firestore:', err);
        setSyncError(
          'Não foi possível enviar o lead para a nuvem agora. Ele foi mantido localmente.'
        );
      });
  };

  const handleDeleteRecord = (id: string) => {
    const docId = normalizeDocId(id);
    deletedLeadIdsRef.current.add(docId);
    pendingLeadIdsRef.current.delete(docId);
    setHistory((prev) => prev.filter((rec) => rec.id !== id));
    if (selectedNegotiationLeadId === id) {
      setSelectedNegotiationLeadId(null);
    }
    void deleteLeadFromFirestore(id)
      .then(() => {
        setSyncError(null);
      })
      .catch((err) => {
        console.error('Erro ao excluir lead no Firestore:', err);
        setSyncError(
          'Não foi possível confirmar a exclusão do lead na nuvem agora.'
        );
      });
  };

  const handleSavePotentialHelper = (lead: LeadQuoteRecord) => {
    const alreadyExists = helpers.some(
      (h) =>
        h.sourceLeadId === lead.id ||
        (lead.phone && h.phone && h.phone === lead.phone)
    );
    if (alreadyExists) return;

    const nowIso = new Date().toISOString();
    const newHelper: PotentialHelperRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: lead.clientName || 'Contato sem nome',
      phone: lead.phone || '',
      email: lead.email || '',
      city: lead.city || '',
      notes: lead.notes || '',
      savedAt: nowIso,
      updatedAt: nowIso,
      sourceLeadId: lead.id,
    };
    const docId = normalizeDocId(newHelper.id);
    pendingHelperIdsRef.current.add(docId);
    setHelpers((prev) => [newHelper, ...prev]);
    void upsertHelperToFirestore(newHelper)
      .then(() => {
        pendingHelperIdsRef.current.delete(docId);
        setSyncError(null);
      })
      .catch((err) => {
        console.error('Erro ao salvar ajudante no Firestore:', err);
        setSyncError(
          'Não foi possível sincronizar o contato na nuvem agora. Ele foi mantido localmente.'
        );
      });
  };

  const syncHelperToCloud = (helper: PotentialHelperRecord, failMessage: string) => {
    const docId = normalizeDocId(helper.id);
    pendingHelperIdsRef.current.add(docId);
    void upsertHelperToFirestore(helper)
      .then(() => {
        pendingHelperIdsRef.current.delete(docId);
        setSyncError(null);
      })
      .catch((err) => {
        console.error('Erro ao sincronizar ajudante no Firestore:', err);
        setSyncError(failMessage);
      });
  };

  const handleAddHelper = (helper: PotentialHelperRecord) => {
    const nowIso = new Date().toISOString();
    const newHelper: PotentialHelperRecord = {
      ...helper,
      savedAt: helper.savedAt || nowIso,
      updatedAt: nowIso,
    };
    setHelpers((prev) => [newHelper, ...prev]);
    syncHelperToCloud(
      newHelper,
      'Não foi possível sincronizar o contato na nuvem agora. Ele foi mantido localmente.'
    );
  };

  const handleUpdateHelper = (
    id: string,
    patch: Partial<PotentialHelperRecord>
  ) => {
    const target = helpers.find((h) => h.id === id);
    if (!target) return;
    const updatedHelper: PotentialHelperRecord = {
      ...target,
      ...patch,
      id: target.id,
      updatedAt: new Date().toISOString(),
    };
    setHelpers((prev) =>
      prev.map((h) => (h.id === id ? updatedHelper : h))
    );
    syncHelperToCloud(
      updatedHelper,
      'Não foi possível sincronizar o ajudante na nuvem agora. Seus dados locais foram preservados.'
    );
  };

  const handleOpenHelpers = () => {
    setNegotiationStartTab('ajudantes');
    setActiveTab('negociacao');
  };

  const handleDeleteHelper = (id: string) => {
    const docId = normalizeDocId(id);
    deletedHelperIdsRef.current.add(docId);
    pendingHelperIdsRef.current.delete(docId);
    setHelpers((prev) => prev.filter((h) => h.id !== id));
    void deleteHelperFromFirestore(id)
      .then(() => {
        setSyncError(null);
      })
      .catch((err) => {
        console.error('Erro ao excluir ajudante no Firestore:', err);
        setSyncError(
          'Não foi possível confirmar a exclusão do contato na nuvem agora.'
        );
      });
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
        onAuthenticated={() =>
          setAuthStatus((prev) => ({
            ...prev,
            checking: false,
            authenticated: true,
          }))
        }
      />
    );
  }

  const pageHeaderMeta: Record<ActiveTab, { title: string; subtitle: string }> = {
    calculadora: {
      title: 'Calculadora de Orçamento',
      subtitle: 'Monte a proposta com tabela oficial e copie pronta em inglês.',
    },
    negociacao: {
      title: 'Negociação e Leads',
      subtitle: 'Follow-ups do dia, conversas e Copiloto comercial.',
    },
    agenda: {
      title: 'Google Agenda',
      subtitle: 'Horários sincronizados e agendamento direto de limpezas.',
    },
    painel: {
      title: 'Painel e Histórico',
      subtitle: 'Desempenho comercial, conversões e lista completa de leads.',
    },
    configuracoes: {
      title: 'Configurações',
      subtitle: 'Tabela de preços, extras, cidades atendidas e backup.',
    },
  };

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    mobileLabel: string;
    icon: ComponentType<{ className?: string }>;
    badgeCount?: number;
    statusLabel?: string;
    onSelect: () => void;
  }> = [
    {
      id: 'calculadora',
      label: 'Calculadora',
      mobileLabel: 'Calcular',
      icon: Calculator,
      onSelect: () => runWithSettingsGuard(() => setActiveTab('calculadora')),
    },
    {
      id: 'negociacao',
      label: 'Negociação',
      mobileLabel: 'Leads',
      icon: MessageSquare,
      badgeCount: dueTodayCount,
      onSelect: () =>
        runWithSettingsGuard(() => {
          setSelectedNegotiationLeadId(null);
          setActiveTab('negociacao');
        }),
    },
    {
      id: 'agenda',
      label: 'Agenda',
      mobileLabel: 'Agenda',
      icon: Calendar,
      statusLabel: calendarToken ? 'Ativa' : undefined,
      onSelect: () => runWithSettingsGuard(() => setActiveTab('agenda')),
    },
    {
      id: 'painel',
      label: 'Painel e Histórico',
      mobileLabel: 'Painel',
      icon: BarChart3,
      onSelect: () => runWithSettingsGuard(() => setActiveTab('painel')),
    },
    {
      id: 'configuracoes',
      label: 'Configurações',
      mobileLabel: 'Ajustes',
      icon: Settings,
      onSelect: () => runWithSettingsGuard(() => setActiveTab('configuracoes')),
    },
  ];

  const userInitial = (authStatus.userEmail || 'D').charAt(0).toUpperCase();

  return (
    <OptionalMapsProvider mapsApiKey={mapsApiKey}>
      <div className="min-h-screen flex bg-[#F3F6F7] text-slate-900 overflow-x-hidden">
        {/* Sidebar executiva fixa (desktop) */}
        <aside className="hidden lg:flex lg:flex-col lg:w-[252px] lg:shrink-0 lg:sticky lg:top-0 lg:h-screen bg-[#0C232B] text-slate-100 border-r border-slate-900/20">
          <div className="h-16 px-5 flex items-center gap-3 border-b border-white/10">
            <button
              type="button"
              onClick={() =>
                runWithSettingsGuard(() => setActiveTab('calculadora'))
              }
              className="flex items-center gap-3 text-left min-w-0"
            >
              <span className="w-9 h-9 rounded-xl bg-[#0B6273] border border-white/15 flex items-center justify-center font-display font-bold text-xs tracking-tight text-white shrink-0">
                DC
              </span>
              <span className="font-display font-bold text-base tracking-tight text-white truncate whitespace-nowrap">
                Dany Clean Pro
              </span>
            </button>
          </div>

          <nav
            aria-label="Navegação principal"
            className="flex-1 px-3 py-4 space-y-1 overflow-y-auto"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onSelect}
                  className={`w-full flex items-center justify-between gap-2.5 px-3.5 h-10 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#0B6273] text-white shadow-xs'
                      : 'text-slate-300 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-white' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badgeCount !== undefined && item.badgeCount > 0 && (
                    <span
                      className={`text-xs font-mono tabular-nums font-semibold shrink-0 ${
                        isActive ? 'text-[#A9E8F2]' : 'text-[#6ED2E2]'
                      }`}
                    >
                      {item.badgeCount}
                    </span>
                  )}
                  {item.statusLabel && (
                    <span className="text-[11px] font-medium text-emerald-300 shrink-0">
                      {item.statusLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Rodapé da sidebar com conta conectada e ação real de sair */}
          <div className="p-3.5 border-t border-white/10">
            <div className="flex items-center justify-between gap-2.5 px-2 py-1.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white/10 text-white font-display font-semibold text-xs flex items-center justify-center shrink-0">
                  {userInitial}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate">
                    {authStatus.userEmail || 'Equipe autorizada'}
                  </div>
                  <div className="text-[11px] text-slate-400">Conta ativa</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void signOutPrimarySession()}
                title="Sair da conta"
                aria-label="Sair da conta"
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Área principal do back-office */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top bar enxuta */}
          <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200/80">
            <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-4">
              <div className="min-w-0 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    runWithSettingsGuard(() => setActiveTab('calculadora'))
                  }
                  className="lg:hidden w-8 h-8 rounded-lg bg-[#0C232B] text-white font-display font-bold text-xs flex items-center justify-center shrink-0"
                  aria-label="Ir para Calculadora"
                >
                  DC
                </button>
                <div className="min-w-0">
                  <h1 className="text-sm sm:text-base font-bold tracking-tight text-slate-900 truncate">
                    {pageHeaderMeta[activeTab].title}
                  </h1>
                  <p className="hidden sm:block text-xs text-slate-500 truncate">
                    {pageHeaderMeta[activeTab].subtitle}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleNewQuote}
                  className="inline-flex items-center gap-1.5 h-9 sm:h-10 px-3.5 sm:px-4 rounded-xl bg-[#0B6273] text-white text-xs sm:text-sm font-medium hover:bg-[#084E5C] transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Novo orçamento</span>
                </button>
                <button
                  type="button"
                  onClick={() => void signOutPrimarySession()}
                  title="Sair da conta"
                  aria-label="Sair da conta"
                  className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shrink-0"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 max-w-[1380px] w-full mx-auto px-3.5 sm:px-6 lg:px-8 pt-5 pb-24 lg:py-7">
        {syncError && (
          <div className="mb-5 p-3.5 rounded-2xl bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>{syncError}</span>
            </div>
            <button
              type="button"
              disabled={syncRetrying}
              onClick={() => {
                setSyncRetrying(true);
                setSyncRetryNonce((n) => n + 1);
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#0B6273] text-white text-xs font-semibold hover:bg-[#084E5C] disabled:opacity-60 shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncRetrying ? 'animate-spin' : ''}`}
              />
              <span>
                {syncRetrying
                  ? 'Sincronizando...'
                  : 'Tentar sincronizar novamente'}
              </span>
            </button>
          </div>
        )}
        {backupOverdue && activeTab !== 'configuracoes' && (
          <div className="mb-5 p-3.5 rounded-2xl bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-3">
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
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#0B6273] text-white text-xs font-semibold hover:bg-[#084E5C] shrink-0"
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
            <div className="space-y-5 sm:space-y-6">
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
              homeStartAddress={config.homeStartAddress}
            />

            <button
              type="button"
              onClick={() => setShowMoreDetails((v) => !v)}
              aria-expanded={showMoreDetails}
              aria-controls="maisDetalhes"
              className="w-full flex items-center justify-between gap-3 h-12 px-4 rounded-2xl border border-slate-200/90 bg-white text-sm font-semibold text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-slate-50 transition-colors"
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
              className="grid grid-cols-1 xl:grid-cols-12 gap-5 sm:gap-6 items-start"
            >
              {/* Coluna esquerda: entrada de dados e análise de fotos */}
              <div className="xl:col-span-7 space-y-5 sm:space-y-6 min-w-0">
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
              </div>

              {/* Coluna direita fixa (sticky no desktop): resumo do orçamento + proposta pronta */}
              <div className="xl:col-span-5 xl:sticky xl:top-[84px] space-y-5 sm:space-y-6 min-w-0">
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

                <MessageAndHistoryLayer
                  input={input}
                  calc={calc}
                  finalPrimaryPrice={finalPrimaryPrice}
                  finalRecurringPrice={finalRecurringPrice}
                  deepCleanRangeMarginPercent={config.deepCleanRangeMarginPercent}
                  servedCities={config.servedCities}
                  cityFixedDays={config.cityFixedDays}
                  calendarAvailability={calculatorCalendarAvailability}
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
              onSignInFallback={handleCalendarSignInFallback}
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
              config={config}
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
        </div>

        {/* Barra de navegação inferior (mobile e tablet) */}
        <nav
          aria-label="Navegação móvel"
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200/90 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="grid grid-cols-5 h-16 max-w-lg mx-auto px-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onSelect}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative flex flex-col items-center justify-center gap-1 rounded-lg transition-colors ${
                    isActive
                      ? 'text-[#0B6273] font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span className="relative inline-flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                    {item.badgeCount !== undefined && item.badgeCount > 0 && (
                      <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#0B6273] text-white text-[10px] font-mono font-bold tabular-nums flex items-center justify-center leading-none">
                        {item.badgeCount > 99 ? '99+' : item.badgeCount}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] leading-none truncate max-w-full px-0.5">
                    {item.mobileLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

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
