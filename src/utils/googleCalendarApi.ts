export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
}

export interface CreateCalendarEventInput {
  summary: string;
  location?: string;
  description?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  durationHours: number;
}

export interface CalendarWorkspaceBridge {
  connected: boolean;
  syncSucceeded?: boolean;
  userEmail: string | null;
  isLoggingIn: boolean;
  isLoading: boolean;
  error: string | null;
  calendars: GoogleCalendarListItem[];
  selectedCalendarId: string;
  events: GoogleCalendarEvent[];
  onSignIn: () => void;
  onRefresh: () => void;
  onCreateEvent: (input: CreateCalendarEventInput) => Promise<void>;
  onOpenCalendarTab: () => void;
}

export class GoogleCalendarAuthExpiredError extends Error {
  constructor() {
    super('Sessão do Google Calendar expirada. Conecte novamente para continuar.');
    this.name = 'GoogleCalendarAuthExpiredError';
  }
}

export class GoogleCalendarPermissionError extends Error {
  readonly status: number;
  readonly apiDisabled: boolean;
  readonly insufficientScope: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      apiDisabled?: boolean;
      insufficientScope?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'GoogleCalendarPermissionError';
    this.status = options.status ?? 403;
    this.apiDisabled = Boolean(options.apiDisabled);
    this.insufficientScope = Boolean(options.insufficientScope);
  }
}

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

async function calendarFetch<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new Error(
      'Sem conexão com o Google Calendar no momento. Verifique sua internet e clique em Atualizar.'
    );
  }

  if (response.status === 401) {
    throw new GoogleCalendarAuthExpiredError();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => ({}))) as {
    error?: {
      message?: string;
      status?: string;
      errors?: Array<{ reason?: string; message?: string }>;
    };
  };

  if (response.status === 403) {
    const rawMessage = data?.error?.message || '';
    const statusText = data?.error?.status || '';
    const reason = data?.error?.errors?.[0]?.reason || '';
    const combined = `${statusText} ${reason} ${rawMessage}`;

    if (
      /accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(
        combined
      )
    ) {
      throw new GoogleCalendarPermissionError(
        'A API do Google Calendar não está ativada para este aplicativo no projeto Google Cloud. Ative a integração do Google Calendar e tente novamente.',
        { status: 403, apiDisabled: true }
      );
    }

    if (
      /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.*scope|insufficient authentication/i.test(
        combined
      )
    ) {
      throw new GoogleCalendarPermissionError(
        'Permissão do Google Calendar não concedida pela conta Google. Clique em "Sign in with Google" novamente e marque todas as permissões da agenda.',
        { status: 403, insufficientScope: true }
      );
    }

    throw new GoogleCalendarPermissionError(
      rawMessage
        ? `Acesso negado ao Google Calendar: ${rawMessage}`
        : 'Acesso negado ao Google Calendar (HTTP 403). Reconecte sua conta e confirme as permissões da agenda.',
      { status: 403 }
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        `Erro ao comunicar com o Google Calendar (HTTP ${response.status}).`
    );
  }

  return data as T;
}

export async function listGoogleCalendars(
  accessToken: string
): Promise<GoogleCalendarListItem[]> {
  const data = await calendarFetch<{ items?: GoogleCalendarListItem[] }>(
    `${CALENDAR_API_BASE}/users/me/calendarList?minAccessRole=reader`,
    accessToken
  );
  const items = Array.isArray(data.items) ? data.items : [];
  return items.sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
}

export async function listUpcomingCalendarEvents(
  accessToken: string,
  calendarId = 'primary',
  daysAhead = 45
): Promise<GoogleCalendarEvent[]> {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0
  );
  const endWindow = new Date(
    startOfToday.getTime() + daysAhead * 24 * 60 * 60 * 1000
  );

  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: startOfToday.toISOString(),
    timeMax: endWindow.toISOString(),
    maxResults: '250',
  });

  const data = await calendarFetch<{ items?: GoogleCalendarEvent[] }>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    accessToken
  );

  return (data.items || []).filter((evt) => evt.status !== 'cancelled');
}

function buildStartEndIso(
  date: string,
  startTime: string,
  durationHours: number
): { startIso: string; endIso: string; timeZone: string } {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = startTime.split(':').map(Number);
  const startDate = new Date(y, (m || 1) - 1, d || 1, hh || 9, mm || 0, 0);
  const safeDurationMs = Math.max(0.5, durationHours || 2) * 60 * 60 * 1000;
  const endDate = new Date(startDate.getTime() + safeDurationMs);
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';

  return {
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
    timeZone,
  };
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: CreateCalendarEventInput
): Promise<GoogleCalendarEvent> {
  const { startIso, endIso, timeZone } = buildStartEndIso(
    input.date,
    input.startTime,
    input.durationHours
  );

  return calendarFetch<GoogleCalendarEvent>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        summary: input.summary.trim(),
        location: (input.location || '').trim() || undefined,
        description: (input.description || '').trim() || undefined,
        start: { dateTime: startIso, timeZone },
        end: { dateTime: endIso, timeZone },
      }),
    }
  );
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: CreateCalendarEventInput
): Promise<GoogleCalendarEvent> {
  const { startIso, endIso, timeZone } = buildStartEndIso(
    input.date,
    input.startTime,
    input.durationHours
  );

  return calendarFetch<GoogleCalendarEvent>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        summary: input.summary.trim(),
        location: (input.location || '').trim() || '',
        description: (input.description || '').trim() || '',
        start: { dateTime: startIso, timeZone },
        end: { dateTime: endIso, timeZone },
      }),
    }
  );
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  await calendarFetch<void>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export function getCalendarEventDateKey(event: GoogleCalendarEvent): string {
  if (event.start?.date) {
    return event.start.date.slice(0, 10);
  }
  if (event.start?.dateTime) {
    const dt = new Date(event.start.dateTime);
    if (!Number.isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return '';
}

export function formatCalendarEventTimeRange(event: GoogleCalendarEvent): string {
  if (event.start?.date && !event.start?.dateTime) {
    return 'Dia inteiro';
  }
  if (!event.start?.dateTime) return '';
  const startDt = new Date(event.start.dateTime);
  if (Number.isNaN(startDt.getTime())) return '';
  const startLabel = startDt.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (event.end?.dateTime) {
    const endDt = new Date(event.end.dateTime);
    if (!Number.isNaN(endDt.getTime())) {
      const endLabel = endDt.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return `${startLabel} – ${endLabel}`;
    }
  }
  return startLabel;
}

export function countEventsByDateKey(
  events: GoogleCalendarEvent[]
): Record<string, GoogleCalendarEvent[]> {
  const map: Record<string, GoogleCalendarEvent[]> = {};
  for (const evt of events) {
    const key = getCalendarEventDateKey(evt);
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(evt);
  }
  return map;
}

export interface CalendarAvailabilitySlot {
  dateKey: string;
  startTime: string;
  en: string;
  pt: string;
}

export interface CalendarAvailabilityResult {
  verifiedAvailable: boolean;
  reason:
    | 'verified'
    | 'disconnected'
    | 'error'
    | 'loading'
    | 'days_only'
    | 'no_free_slots';
  verifiedSlots: CalendarAvailabilitySlot[];
}

const CANDIDATE_SLOT_TIMES = [
  { startTime: '09:00', enTime: '9:00 AM', ptTime: '09:00' },
  { startTime: '13:00', enTime: '1:00 PM', ptTime: '13:00' },
  { startTime: '10:00', enTime: '10:00 AM', ptTime: '10:00' },
  { startTime: '14:00', enTime: '2:00 PM', ptTime: '14:00' },
] as const;

function parseDateKeyLocal(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isSlotFreeOnDate(
  dateKey: string,
  startTime: string,
  durationHours: number,
  events: GoogleCalendarEvent[]
): boolean {
  const baseDate = parseDateKeyLocal(dateKey);
  if (!baseDate) return false;
  const [hh, mm] = startTime.split(':').map(Number);
  const slotStartMs = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hh || 9,
    mm || 0,
    0,
    0
  ).getTime();
  const slotEndMs = slotStartMs + Math.max(1, durationHours) * 60 * 60 * 1000;

  for (const evt of events) {
    if (evt.status === 'cancelled') continue;

    // All-day event: start.date inclusive, end.date exclusive in Google Calendar API
    if (evt.start?.date && !evt.start?.dateTime) {
      const startDateKey = evt.start.date.slice(0, 10);
      const endDateKey = evt.end?.date ? evt.end.date.slice(0, 10) : '';
      if (endDateKey && endDateKey > startDateKey) {
        if (dateKey >= startDateKey && dateKey < endDateKey) return false;
      } else if (dateKey === startDateKey) {
        return false;
      }
      continue;
    }

    if (evt.start?.dateTime) {
      const evtStartMs = Date.parse(evt.start.dateTime);
      if (!Number.isFinite(evtStartMs)) continue;
      const evtEndMs = evt.end?.dateTime
        ? Date.parse(evt.end.dateTime)
        : evtStartMs + 60 * 60 * 1000;
      const safeEndMs = Number.isFinite(evtEndMs)
        ? evtEndMs
        : evtStartMs + 60 * 60 * 1000;
      if (slotStartMs < safeEndMs && slotEndMs > evtStartMs) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Only returns verifiedAvailable=true when Google Calendar is connected,
 * the query succeeded without error, and at least one concrete date + time
 * slot is confirmed free inside the fetched calendar window.
 */
export function evaluateCalendarSlotAvailability(
  bridge:
    | Pick<
        CalendarWorkspaceBridge,
        'connected' | 'syncSucceeded' | 'isLoading' | 'error' | 'events'
      >
    | null
    | undefined,
  dateOptions: Array<{ dateKey: string; en: string; pt: string }>,
  durationHours = 3,
  referenceDate: Date = new Date(),
  syncedDaysAhead = 45
): CalendarAvailabilityResult {
  if (!bridge || !bridge.connected) {
    return { verifiedAvailable: false, reason: 'disconnected', verifiedSlots: [] };
  }
  if (bridge.error) {
    return { verifiedAvailable: false, reason: 'error', verifiedSlots: [] };
  }
  if (bridge.isLoading) {
    return { verifiedAvailable: false, reason: 'loading', verifiedSlots: [] };
  }
  if (!bridge.syncSucceeded) {
    return { verifiedAvailable: false, reason: 'days_only', verifiedSlots: [] };
  }

  const refStart = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  ).getTime();

  const verifiedSlots: CalendarAvailabilitySlot[] = [];

  for (const dateOpt of dateOptions) {
    const dt = parseDateKeyLocal(dateOpt.dateKey);
    if (!dt) continue;
    const diffDays = Math.round((dt.getTime() - refStart) / (24 * 60 * 60 * 1000));
    if (diffDays < 1 || diffDays >= syncedDaysAhead) continue;

    for (const candidate of CANDIDATE_SLOT_TIMES) {
      if (
        isSlotFreeOnDate(
          dateOpt.dateKey,
          candidate.startTime,
          durationHours,
          bridge.events || []
        )
      ) {
        verifiedSlots.push({
          dateKey: dateOpt.dateKey,
          startTime: candidate.startTime,
          en: `${dateOpt.en} at ${candidate.enTime}`,
          pt: `${dateOpt.pt} às ${candidate.ptTime}`,
        });
        break;
      }
    }
  }

  if (verifiedSlots.length === 0) {
    return {
      verifiedAvailable: false,
      reason: 'no_free_slots',
      verifiedSlots: [],
    };
  }

  return {
    verifiedAvailable: true,
    reason: 'verified',
    verifiedSlots,
  };
}
