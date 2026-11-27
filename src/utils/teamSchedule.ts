import { LeadQuoteRecord, PotentialHelperRecord } from '../types/pricing';
import { GoogleCalendarEvent } from './googleCalendarApi';
import {
  CalendarServiceInfo,
  addDaysToDateKey,
  clientDateKey,
  describeCalendarService,
} from './clientReminders';
import { distanceMiles, resolveLocationText } from './smartSchedule';

/**
 * Escala da equipe (versão grátis).
 * Liga cada limpeza da agenda a um ou mais ajudantes e monta a mensagem
 * pronta para o WhatsApp. Nada é enviado automaticamente.
 * A escala fica salva só neste aparelho (localStorage).
 */

export const TEAM_SCHEDULE_STORAGE_KEY = 'dany_clean_pro_team_schedule_v1';
const TEAM_SCHEDULE_VERSION = 1;
/** Quantos dias para a frente a escala mostra. */
export const TEAM_SCHEDULE_HORIZON_DAYS = 7;
/** Escalas de serviços que já passaram há mais que isso são apagadas. */
const KEEP_PAST_DAYS = 21;
/** Cidade vizinha conta como "perto" até esta distância (linha reta). */
const NEAR_CITY_MILES = 5;
/** Duração assumida quando o evento não tem horário de fim. */
const DEFAULT_SERVICE_HOURS = 3;

export const WEEKDAY_SHORT_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAY_LONG_PT = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
];

export interface TeamAssignment {
  helperIds: string[];
  /** Data do serviço (YYYY-MM-DD, fuso de Connecticut), para limpar escalas antigas. */
  dateKey: string;
  /** helperId -> quando o aviso no WhatsApp foi aberto. */
  notifiedAt: Record<string, string>;
}

export type TeamScheduleMap = Record<string, TeamAssignment>;

export interface TeamService extends CalendarServiceInfo {
  /** Cidade do serviço reconhecida pelo endereço, título ou lead. */
  city: string;
  weekday: number;
}

/* ------------------------------------------------------------------ */
/* Salvar e carregar                                                    */
/* ------------------------------------------------------------------ */

export function loadTeamSchedule(now: Date = new Date()): TeamScheduleMap {
  try {
    const raw = window.localStorage.getItem(TEAM_SCHEDULE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const container = parsed as { version?: unknown; assignments?: unknown };
    if (container.version !== TEAM_SCHEDULE_VERSION) return {};
    const assignments = container.assignments;
    if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
      return {};
    }

    const oldestKey = addDaysToDateKey(clientDateKey(now), -KEEP_PAST_DAYS);
    const result: TeamScheduleMap = {};
    for (const [eventId, value] of Object.entries(assignments as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      const dateKey = typeof v.dateKey === 'string' ? v.dateKey : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey < oldestKey) continue;
      const helperIds = Array.isArray(v.helperIds)
        ? Array.from(
            new Set(v.helperIds.filter((id): id is string => typeof id === 'string' && Boolean(id)))
          )
        : [];
      const notifiedAt: Record<string, string> = {};
      if (v.notifiedAt && typeof v.notifiedAt === 'object' && !Array.isArray(v.notifiedAt)) {
        for (const [hid, iso] of Object.entries(v.notifiedAt as Record<string, unknown>)) {
          if (typeof iso === 'string' && helperIds.includes(hid)) notifiedAt[hid] = iso;
        }
      }
      if (helperIds.length === 0) continue;
      result[eventId] = { helperIds, dateKey, notifiedAt };
    }
    return result;
  } catch {
    return {};
  }
}

/** Retorna false se o navegador não deixou salvar. */
export function saveTeamSchedule(map: TeamScheduleMap): boolean {
  try {
    window.localStorage.setItem(
      TEAM_SCHEDULE_STORAGE_KEY,
      JSON.stringify({ version: TEAM_SCHEDULE_VERSION, assignments: map })
    );
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Serviços da agenda                                                   */
/* ------------------------------------------------------------------ */

export function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12)).getUTCDay();
}

function cityFromSummary(summary: string): string {
  const match = /\(([^)]+)\)/.exec(summary || '');
  return match ? match[1].trim() : '';
}

function resolveServiceCity(info: CalendarServiceInfo): string {
  const byAddress = resolveLocationText(info.address);
  if (byAddress) return byAddress.city;
  const fromTitle = cityFromSummary(info.event.summary || '');
  if (fromTitle) return resolveLocationText(fromTitle)?.city || fromTitle;
  if (info.leadCity) return resolveLocationText(info.leadCity)?.city || info.leadCity;
  return '';
}

/** Limpezas (com horário) de hoje até `days` dias à frente, em ordem. */
export function buildTeamServices(
  events: GoogleCalendarEvent[],
  history: LeadQuoteRecord[],
  now: Date = new Date(),
  days: number = TEAM_SCHEDULE_HORIZON_DAYS
): TeamService[] {
  const todayKey = clientDateKey(now);
  const lastKey = addDaysToDateKey(todayKey, days - 1);
  const list: TeamService[] = [];
  for (const event of events) {
    const info = describeCalendarService(event, history);
    if (!info || !info.isCleaning) continue;
    if (info.dateKey < todayKey || info.dateKey > lastKey) continue;
    list.push({
      ...info,
      city: resolveServiceCity(info),
      weekday: weekdayOfDateKey(info.dateKey),
    });
  }
  list.sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) ||
      (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)
  );
  return list;
}

/* ------------------------------------------------------------------ */
/* Sugestão de ajudante                                                 */
/* ------------------------------------------------------------------ */

function normalizeCity(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ct|ny|connecticut)\b/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasUsablePhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 10;
}

function serviceRange(s: TeamService): [number, number] | null {
  if (!s.startsAt) return null;
  const start = s.startsAt.getTime();
  const end = s.endsAt?.getTime() ?? start + DEFAULT_SERVICE_HOURS * 3_600_000;
  return [start, Math.max(end, start + 1)];
}

function overlaps(a: TeamService, b: TeamService): boolean {
  const ra = serviceRange(a);
  const rb = serviceRange(b);
  if (!ra || !rb) return a.dateKey === b.dateKey;
  return ra[0] < rb[1] && rb[0] < ra[1];
}

export type CityMatch =
  | { kind: 'mesma'; city: string }
  | { kind: 'perto'; city: string; miles: number }
  | { kind: 'nao' }
  | { kind: 'sem-cidades' }
  | { kind: 'servico-sem-cidade' };

export function matchHelperCity(helper: PotentialHelperRecord, serviceCity: string): CityMatch {
  const cities = (helper.serviceCities || []).filter(Boolean);
  if (cities.length === 0) return { kind: 'sem-cidades' };
  if (!serviceCity) return { kind: 'servico-sem-cidade' };
  const target = normalizeCity(serviceCity);
  const same = cities.find((c) => normalizeCity(c) === target);
  if (same) return { kind: 'mesma', city: same };

  const servicePoint = resolveLocationText(serviceCity);
  if (servicePoint) {
    let best: { city: string; miles: number } | null = null;
    for (const c of cities) {
      const p = resolveLocationText(c);
      if (!p) continue;
      const miles = distanceMiles(servicePoint, p);
      if (miles <= NEAR_CITY_MILES && (!best || miles < best.miles)) best = { city: c, miles };
    }
    if (best) return { kind: 'perto', city: best.city, miles: best.miles };
  }
  return { kind: 'nao' };
}

export interface HelperSuggestion {
  helper: PotentialHelperRecord;
  score: number;
  city: CityMatch;
  /** true = marcou o dia; false = não trabalha nesse dia; null = dias não cadastrados. */
  availableDay: boolean | null;
  /** Outro serviço no mesmo horário em que já está escalado. */
  busyWith: TeamService | null;
  /** Já está escalado neste serviço. */
  assignedHere: boolean;
  reasons: string[];
  warnings: string[];
}

export function rankHelpersForService(
  service: TeamService,
  team: PotentialHelperRecord[],
  allServices: TeamService[],
  schedule: TeamScheduleMap
): HelperSuggestion[] {
  const assignedHereIds = schedule[service.event.id]?.helperIds ?? [];
  const suggestions = team.map((helper): HelperSuggestion => {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = 0;

    const city = matchHelperCity(helper, service.city);
    if (city.kind === 'mesma') {
      score += 3;
      reasons.push(`Atende ${service.city}`);
    } else if (city.kind === 'perto') {
      score += 2;
      reasons.push(`Atende ${city.city} (${city.miles.toFixed(0)} mi)`);
    } else if (city.kind === 'nao') {
      score -= 1;
      warnings.push(`Não atende ${service.city}`);
    } else if (city.kind === 'sem-cidades') {
      warnings.push('Cidades não cadastradas');
    }

    const days = helper.availableWeekdays || [];
    let availableDay: boolean | null = null;
    if (days.length > 0) {
      availableDay = days.includes(service.weekday);
      if (availableDay) {
        score += 2;
        reasons.push(`Livre ${WEEKDAY_LONG_PT[service.weekday]}`);
      } else {
        score -= 3;
        warnings.push(`Não trabalha ${WEEKDAY_LONG_PT[service.weekday]}`);
      }
    } else {
      warnings.push('Dias não cadastrados');
    }

    const busyWith =
      allServices.find(
        (other) =>
          other.event.id !== service.event.id &&
          other.dateKey === service.dateKey &&
          (schedule[other.event.id]?.helperIds ?? []).includes(helper.id) &&
          overlaps(service, other)
      ) ?? null;
    if (busyWith) {
      score -= 5;
      warnings.push(
        `Já escalado${busyWith.timeLabelPt ? ` às ${busyWith.timeLabelPt}` : ''} com ${
          busyWith.clientName || 'outro cliente'
        }`
      );
    }

    if (!hasUsablePhone(helper.phone)) warnings.push('Sem telefone');

    return {
      helper,
      score,
      city,
      availableDay,
      busyWith,
      assignedHere: assignedHereIds.includes(helper.id),
      reasons,
      warnings,
    };
  });

  return suggestions.sort(
    (a, b) => b.score - a.score || a.helper.name.localeCompare(b.helper.name)
  );
}

/** A melhor sugestão só vale se não houver impedimento (dia errado ou horário ocupado). */
export function isRecommended(s: HelperSuggestion): boolean {
  return !s.assignedHere && !s.busyWith && s.availableDay !== false && s.score > 0;
}

/* ------------------------------------------------------------------ */
/* Mensagem para o ajudante                                             */
/* ------------------------------------------------------------------ */

function formatEndTimeEn(service: TeamService): string {
  if (!service.endsAt) return '';
  return service.endsAt.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function buildHelperMessage(helper: PotentialHelperRecord, service: TeamService): string {
  const first = (helper.name || '').trim().split(/\s+/)[0];
  const hi = first && first.toLowerCase() !== 'sem' ? `Hi ${first}` : 'Hi';
  const end = formatEndTimeEn(service);
  const time = service.timeLabelEn
    ? ` at ${service.timeLabelEn}${end ? ` (until about ${end})` : ''}`
    : '';
  const lines = [
    `${hi}, this is Dani from Dany Clean Pro. You are scheduled for a cleaning on ${service.dateLabelEn}${time}.`,
    service.address ? `Address: ${service.address}` : 'I will send you the address soon.',
  ];
  if (service.clientName) lines.push(`Client: ${service.clientName}`);
  lines.push('Please reply YES to confirm. Thank you!');
  return lines.join('\n');
}
