import {
  friendlyCalendarApiError,
  friendlyNetworkError,
} from './googleCalendarErrors';

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
    super('Sua conexão com a agenda expirou. Toque em Conectar para renovar (não pede permissões de novo).');
    this.name = 'GoogleCalendarAuthExpiredError';
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
    throw friendlyNetworkError();
  }

  if (response.status === 401) {
    throw new GoogleCalendarAuthExpiredError();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => ({}))) as Parameters<
    typeof friendlyCalendarApiError
  >[1];

  if (!response.ok) {
    console.error('Google Calendar API error:', response.status, data);
    throw friendlyCalendarApiError(response.status, data);
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
    maxResults: '200',
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
