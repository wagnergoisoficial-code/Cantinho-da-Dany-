import { LeadQuoteRecord } from '../types/pricing';
import { GoogleCalendarEvent } from './googleCalendarApi';

/**
 * Lembretes para o cliente (versão grátis, sem envio automático).
 * O app monta a mensagem e a Dani toca em WhatsApp, SMS ou Copiar.
 *
 * Datas e horários são calculados no fuso de Connecticut
 * (America/New_York), mesmo que o celular esteja em outro fuso.
 */

export type ReminderKind = 'confirmacao' | 'a_caminho' | 'avaliacao';

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  confirmacao: 'Confirmar (1 dia antes)',
  a_caminho: 'Estamos a caminho',
  avaliacao: 'Pedir avaliação',
};

export const CLIENT_TIME_ZONE = 'America/New_York';

export interface ReminderService {
  event: GoogleCalendarEvent;
  /** 'hoje' ou 'amanha' no fuso do cliente. */
  day: 'hoje' | 'amanha';
  dateKey: string;
  clientName: string;
  firstName: string;
  phone: string;
  address: string;
  /** Ex.: "Saturday, November 28" */
  dateLabelEn: string;
  /** Ex.: "9:00 AM" */
  timeLabelEn: string;
  /** Ex.: "09:00" para a tela em português. */
  timeLabelPt: string;
  endsAt: Date | null;
  startsAt: Date | null;
  matchedLeadId: string | null;
}

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLIENT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data YYYY-MM-DD no fuso do cliente. */
export function clientDateKey(date: Date): string {
  return ymdFormatter.format(date);
}

function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days, 12));
  return dt.toISOString().slice(0, 10);
}

function eventDateKey(event: GoogleCalendarEvent): string {
  if (event.start?.dateTime) {
    const dt = new Date(event.start.dateTime);
    if (!Number.isNaN(dt.getTime())) return clientDateKey(dt);
  }
  if (event.start?.date) return event.start.date.slice(0, 10);
  return '';
}

function formatDateLabelEn(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  return dt.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(date: Date, locale: 'en-US' | 'pt-BR'): string {
  return date.toLocaleTimeString(locale, {
    timeZone: CLIENT_TIME_ZONE,
    hour: locale === 'en-US' ? 'numeric' : '2-digit',
    minute: '2-digit',
  });
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readDescriptionField(description: string, labels: string[]): string {
  for (const line of description.split(/\r?\n/)) {
    const match = /^\s*([^:]+):\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = normalizeName(match[1]);
    if (labels.includes(key)) return match[2].trim();
  }
  return '';
}

/** Tenta achar um telefone americano em qualquer parte do texto. */
function findPhoneInText(text: string): string {
  const match = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(text);
  return match ? match[0].trim() : '';
}

/**
 * Lê o nome do cliente do título do evento.
 * O app cria eventos como "Limpeza - Emily (Norwalk)".
 */
function nameFromSummary(summary: string): string {
  let text = summary.trim();
  text = text.replace(/\([^)]*\)/g, ' ');
  text = text.replace(
    /^\s*(limpeza|cleaning|deep\s*clean(ing)?|move[\s-]*(in|out)[^-:]*|faxina)\s*[-:–—]?\s*/i,
    ''
  );
  text = text.split(/\s[-–—|]\s/)[0] || '';
  return text.replace(/\s+/g, ' ').trim();
}

const CLEANING_HINT =
  /\b(limpeza|cleaning|clean|faxina|deep|move[\s-]*(in|out)|cliente)\b/i;

/** Evento parece um serviço de limpeza com cliente (e não folga ou compromisso pessoal). */
export function looksLikeCleaningService(
  event: GoogleCalendarEvent,
  matchedLead: LeadQuoteRecord | null
): boolean {
  if (!event.start?.dateTime) return false; // dia inteiro = folga/bloqueio
  if (matchedLead) return true;
  const description = event.description || '';
  if (/^\s*(cliente|telefone)\s*:/im.test(description)) return true;
  return CLEANING_HINT.test(event.summary || '');
}

function matchLead(
  history: LeadQuoteRecord[],
  phone: string,
  name: string
): LeadQuoteRecord | null {
  const phoneDigits = digitsOnly(phone).slice(-10);
  if (phoneDigits.length === 10) {
    const byPhone = history.find(
      (rec) => digitsOnly(rec.phone || '').slice(-10) === phoneDigits
    );
    if (byPhone) return byPhone;
  }
  const normalized = normalizeName(name);
  if (normalized.length >= 3) {
    const byName = history.filter(
      (rec) => normalizeName(rec.clientName || '') === normalized
    );
    // Só usa o nome quando não há dúvida (um único lead com esse nome).
    if (byName.length === 1) return byName[0];
  }
  return null;
}

export interface ReminderServicesResult {
  services: ReminderService[];
  /** Compromissos de hoje/amanhã com horário que não parecem limpeza. */
  skipped: ReminderService[];
}

/** Dados do serviço lidos de um evento com horário (sem o "hoje/amanhã"). */
export type CalendarServiceInfo = Omit<ReminderService, 'day'> & {
  /** Parece limpeza com cliente (e não folga ou compromisso pessoal). */
  isCleaning: boolean;
  /** Cidade do lead casado no histórico, quando houver. */
  leadCity: string;
};

/**
 * Lê nome, telefone, endereço, data e horário de um evento da agenda,
 * completando pelo histórico de leads. Retorna null para eventos de dia inteiro.
 */
export function describeCalendarService(
  event: GoogleCalendarEvent,
  history: LeadQuoteRecord[]
): CalendarServiceInfo | null {
  if (!event.start?.dateTime) return null;
  const dateKey = eventDateKey(event);
  if (!dateKey) return null;

  const description = event.description || '';
  const nameFromDescription = readDescriptionField(description, ['cliente', 'client', 'nome', 'name']);
  const phoneFromDescription =
    readDescriptionField(description, ['telefone', 'phone', 'celular', 'tel']) ||
    findPhoneInText(description) ||
    findPhoneInText(event.location || '');
  const summaryName = nameFromSummary(event.summary || '');
  const rawName =
    nameFromDescription && normalizeName(nameFromDescription) !== 'nao informado'
      ? nameFromDescription
      : summaryName;

  const lead = matchLead(history, phoneFromDescription, rawName);
  const clientName = (lead?.clientName || rawName || '').trim();
  const phone = (phoneFromDescription || lead?.phone || '').trim();
  const leadAddress = lead
    ? [lead.streetAddress, lead.city, lead.zipCode]
        .filter((v) => Boolean(v && String(v).trim()))
        .join(', ')
    : '';
  const address = (event.location || '').trim() || leadAddress;

  const startsAt = new Date(event.start.dateTime);
  const endsAt = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  const validStart = Number.isNaN(startsAt.getTime()) ? null : startsAt;
  const validEnd = endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null;

  return {
    event,
    dateKey,
    clientName,
    firstName: clientName.split(/\s+/)[0] || '',
    phone,
    address,
    dateLabelEn: formatDateLabelEn(dateKey),
    timeLabelEn: validStart ? formatTime(validStart, 'en-US') : '',
    timeLabelPt: validStart ? formatTime(validStart, 'pt-BR') : '',
    startsAt: validStart,
    endsAt: validEnd,
    matchedLeadId: lead?.id ?? null,
    isCleaning: looksLikeCleaningService(event, lead),
    leadCity: (lead?.city || '').trim(),
  };
}

export { addDaysToKey as addDaysToDateKey };

export function buildReminderServices(
  events: GoogleCalendarEvent[],
  history: LeadQuoteRecord[],
  now: Date = new Date()
): ReminderServicesResult {
  const todayKey = clientDateKey(now);
  const tomorrowKey = addDaysToKey(todayKey, 1);
  const services: ReminderService[] = [];
  const skipped: ReminderService[] = [];

  for (const event of events) {
    const dateKey = eventDateKey(event);
    if (dateKey !== todayKey && dateKey !== tomorrowKey) continue;
    const info = describeCalendarService(event, history);
    if (!info) continue;
    const { isCleaning, leadCity: _leadCity, ...rest } = info;
    const item: ReminderService = {
      ...rest,
      day: dateKey === todayKey ? 'hoje' : 'amanha',
    };
    if (isCleaning) services.push(item);
    else skipped.push(item);
  }

  const byStart = (a: ReminderService, b: ReminderService) =>
    (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0);
  services.sort(byStart);
  skipped.sort(byStart);
  return { services, skipped };
}

/** Quais mensagens fazem sentido para o serviço agora. */
export function availableReminderKinds(service: ReminderService): ReminderKind[] {
  if (service.day === 'amanha') return ['confirmacao'];
  return ['a_caminho', 'avaliacao', 'confirmacao'];
}

/** Mensagem sugerida primeiro: amanhã = confirmar; hoje = a caminho até o fim do serviço, depois avaliação. */
export function suggestedReminderKind(
  service: ReminderService,
  now: Date = new Date()
): ReminderKind {
  if (service.day === 'amanha') return 'confirmacao';
  if (service.endsAt && now.getTime() >= service.endsAt.getTime()) return 'avaliacao';
  return 'a_caminho';
}

export interface ReminderMessageResult {
  text: string;
  /** Motivo para bloquear o envio (ex.: falta o link do Google Reviews). */
  blockedReason: string | null;
}

export function buildReminderMessage(
  kind: ReminderKind,
  service: ReminderService,
  googleReviewLink: string
): ReminderMessageResult {
  const hi = service.firstName ? `Hi ${service.firstName}` : 'Hi there';
  const when =
    service.day === 'hoje'
      ? `today, ${service.dateLabelEn}`
      : `tomorrow, ${service.dateLabelEn}`;
  const at = service.timeLabelEn ? ` at ${service.timeLabelEn}` : '';
  const where = service.address ? ` at ${service.address}` : '';

  switch (kind) {
    case 'confirmacao':
      return {
        text:
          `${hi}, this is Dani from Dany Clean Pro. Just confirming your cleaning ${when}${at}` +
          `${service.address ? `, ${service.address}` : ''}. ` +
          `Please reply YES to confirm, or let us know if you need to change anything. Thank you!`,
        blockedReason: null,
      };
    case 'a_caminho':
      return {
        text:
          `${hi}, this is Dani from Dany Clean Pro. We are on our way to your home${where} ` +
          `for your cleaning${service.timeLabelEn ? ` scheduled for ${service.timeLabelEn}` : ''}. ` +
          `See you soon!`,
        blockedReason: null,
      };
    case 'avaliacao': {
      const link = googleReviewLink.trim();
      return {
        text:
          `${hi}, thank you for choosing Dany Clean Pro today. ` +
          `If you are happy with the cleaning, a quick Google review would mean a lot to us:\n` +
          `${link || '[link do Google Reviews]'}\nThank you so much!`,
        blockedReason: link
          ? null
          : 'Cadastre o link do Google Reviews em Ajustes para liberar este envio.',
      };
    }
    default:
      return { text: '', blockedReason: 'Tipo de lembrete desconhecido.' };
  }
}

/* ------------------------------------------------------------------ */
/* Marcação "enviado" (fica só neste navegador)                         */
/* ------------------------------------------------------------------ */

export const REMINDERS_SENT_STORAGE_KEY = 'dany_clean_pro_reminders_sent_v1';
const SENT_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;

export type ReminderSentMap = Record<string, string>;

export function reminderSentKey(eventId: string, kind: ReminderKind): string {
  return `${eventId}::${kind}`;
}

export function loadReminderSentMap(): ReminderSentMap {
  try {
    const raw = window.localStorage.getItem(REMINDERS_SENT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const now = Date.now();
    const result: ReminderSentMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const time = Date.parse(value);
      if (Number.isFinite(time) && now - time < SENT_MAX_AGE_MS) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/** Retorna false se o navegador não deixou salvar. */
export function saveReminderSentMap(map: ReminderSentMap): boolean {
  try {
    window.localStorage.setItem(REMINDERS_SENT_STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}
