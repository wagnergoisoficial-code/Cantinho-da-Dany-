/**
 * Agenda inteligente: sugere as datas em que a Dany já atende perto do
 * novo cliente, para reduzir deslocamento.
 *
 * Tudo é calculado no próprio aparelho, sem chamadas pagas:
 * - o endereço de cada serviço vem do campo "Local" do evento no Google
 *   Calendar (e, se estiver vazio, do título do evento);
 * - o endereço vira coordenada por uma tabela fixa de CEPs/cidades de
 *   Connecticut e do sul de NY (src/data/zipCoordinates.ts);
 * - a distância é em linha reta (fórmula de Haversine), em milhas.
 */
import { ZIP_COORDS_RAW } from '../data/zipCoordinates';
import {
  formatDateOptionEn,
  formatDateOptionPt,
  getWeekdayChoice,
  isUsHoliday,
  resolveDateOptionsForCity,
} from './dateOptions';
import {
  GoogleCalendarEvent,
  getCalendarEventDateKey,
} from './googleCalendarApi';
import { inferConnecticutCityFromZip } from './cityFormatter';

/** Raio máximo pedido: nada acima de 10 milhas conta como "perto". */
export const SMART_SCHEDULE_MAX_RADIUS_MILES = 10;
/** Até 5 milhas é "muito perto". */
export const SMART_SCHEDULE_CLOSE_RADIUS_MILES = 5;
/** Dias com esta quantidade de serviços (com horário) já são "dia cheio". */
export const SMART_SCHEDULE_MAX_JOBS_PER_DAY = 3;
/** Quantos dias à frente olhar (a agenda carrega 45). */
export const SMART_SCHEDULE_HORIZON_DAYS = 28;
/** Quantas sugestões com vizinho mostrar. */
export const SMART_SCHEDULE_MAX_NEAR_RESULTS = 5;

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Cidade reconhecida (para mostrar ao usuário). */
  city: string;
  /** Precisão: CEP é mais preciso que só o nome da cidade. */
  source: 'zip' | 'city';
}

interface ZipRow {
  lat: number;
  lng: number;
  city: string;
  state: string;
}

function normalizeText(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let zipIndex: Map<string, ZipRow> | null = null;
let cityIndex: Map<string, GeoPoint> | null = null;
let cityNamesLongestFirst: string[] = [];

function ensureIndexes(): void {
  if (zipIndex && cityIndex) return;
  zipIndex = new Map();
  const cityAcc = new Map<
    string,
    { latSum: number; lngSum: number; n: number; city: string; isCt: boolean }
  >();

  for (const line of ZIP_COORDS_RAW.split('\n')) {
    const parts = line.trim().split('|');
    if (parts.length !== 5) continue;
    const [zip, latRaw, lngRaw, city, state] = parts;
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    zipIndex.set(zip, { lat, lng, city, state });

    const key = normalizeText(city);
    const isCt = state === 'CT';
    const prev = cityAcc.get(key);
    // Nome repetido em CT e NY: fica com Connecticut (região principal).
    if (!prev || (isCt && !prev.isCt)) {
      cityAcc.set(key, { latSum: lat, lngSum: lng, n: 1, city, isCt });
    } else if (prev.isCt === isCt) {
      prev.latSum += lat;
      prev.lngSum += lng;
      prev.n += 1;
    }
  }

  cityIndex = new Map();
  for (const [key, acc] of cityAcc) {
    cityIndex.set(key, {
      lat: acc.latSum / acc.n,
      lng: acc.lngSum / acc.n,
      city: acc.city,
      source: 'city',
    });
  }
  cityNamesLongestFirst = Array.from(cityIndex.keys()).sort(
    (a, b) => b.length - a.length
  );
}

function pointFromZip(zip: string): GeoPoint | null {
  ensureIndexes();
  const row = zipIndex!.get(zip);
  if (!row) return null;
  // Usa o nome "oficial" da cidade quando o CEP é de Connecticut.
  const officialCity = inferConnecticutCityFromZip(zip) || row.city;
  return { lat: row.lat, lng: row.lng, city: officialCity, source: 'zip' };
}

function pointFromCityName(raw: string): GeoPoint | null {
  ensureIndexes();
  const key = normalizeText(raw);
  if (!key) return null;
  return cityIndex!.get(key) ?? null;
}

const locationCache = new Map<string, GeoPoint | null>();

/**
 * Reconhece um local em texto livre ("12 Main St, Norwalk, CT 06850",
 * "Norwalk", "06850"...). Resultado fica em cache na memória.
 */
export function resolveLocationText(text: string | null | undefined): GeoPoint | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  if (locationCache.has(raw)) return locationCache.get(raw)!;

  let result: GeoPoint | null = null;

  // 1) CEP de 5 dígitos (pega o último, que costuma ser o do endereço).
  const zips = raw.match(/\b\d{5}\b/g) || [];
  for (let i = zips.length - 1; i >= 0 && !result; i -= 1) {
    result = pointFromZip(zips[i]);
  }

  // 2) Partes separadas por vírgula que sejam exatamente uma cidade.
  if (!result) {
    for (const part of raw.split(',')) {
      const cleaned = part.replace(/\b(ct|ny|usa|us|eua)\b/gi, '').trim();
      result = pointFromCityName(cleaned);
      if (result) break;
    }
  }

  // 3) Nome de cidade em qualquer lugar do texto (o mais longo primeiro,
  //    para "New Canaan" ganhar de "Canaan").
  if (!result) {
    ensureIndexes();
    const haystack = ` ${normalizeText(raw)} `;
    for (const name of cityNamesLongestFirst) {
      if (name.length < 4) continue; // evita falsos positivos curtos
      if (haystack.includes(` ${name} `)) {
        result = cityIndex!.get(name) ?? null;
        break;
      }
    }
  }

  locationCache.set(raw, result);
  return result;
}

/** Local do cliente: CEP primeiro, depois cidade, depois endereço. */
export function resolveLeadLocation(input: {
  zipCode?: string | null;
  city?: string | null;
  streetAddress?: string | null;
}): GeoPoint | null {
  const zipDigits = (input.zipCode || '').replace(/\D/g, '').slice(0, 5);
  if (zipDigits.length === 5) {
    const byZip = pointFromZip(zipDigits);
    if (byZip) return byZip;
  }
  const byCity = pointFromCityName((input.city || '').split(',')[0] || '');
  if (byCity) return byCity;
  return resolveLocationText(
    [input.streetAddress, input.city, input.zipCode].filter(Boolean).join(', ')
  );
}

export function distanceMiles(a: GeoPoint, b: GeoPoint): number {
  const R = 3958.8; // raio da Terra em milhas
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const DAY_OFF_PATTERN =
  /\b(folga|off|day off|ferias|vacation|bloquead[oa]|blocked|feriado|holiday|nao agendar|indisponivel)\b/;

function isDayOffEvent(evt: GoogleCalendarEvent): boolean {
  return DAY_OFF_PATTERN.test(normalizeText(evt.summary || ''));
}

export type SmartSuggestionTier = 'muito-perto' | 'perto' | 'sem-vizinho';

export interface SmartDateSuggestion {
  dateKey: string;
  date: Date;
  pt: string;
  en: string;
  /** Distância até o serviço mais próximo do dia (null = sem vizinho). */
  distanceMiles: number | null;
  /** Cidade do serviço vizinho. */
  nearCity: string | null;
  /** Mesmo nome de cidade e sem CEP para diferenciar. */
  sameCity: boolean;
  /** Eventos já marcados no dia. */
  eventsCount: number;
  tier: SmartSuggestionTier;
}

export interface SmartScheduleResult {
  status: 'ok' | 'lead-sem-local';
  leadPlace: GeoPoint | null;
  near: SmartDateSuggestion[];
  others: SmartDateSuggestion[];
  /** Eventos com horário que não deu para localizar (sem "Local"). */
  unlocatedEventsCount: number;
  fixedWeekdayPt: string | null;
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildSmartScheduleSuggestions(params: {
  leadZip?: string | null;
  leadCity?: string | null;
  leadStreetAddress?: string | null;
  events: GoogleCalendarEvent[];
  cityFixedDays: Array<{ city: string; weekday: string }>;
  defaultDay1: string;
  defaultDay2: string;
  referenceDate?: Date;
}): SmartScheduleResult {
  const referenceDate = params.referenceDate ?? new Date();
  const leadPlace = resolveLeadLocation({
    zipCode: params.leadZip,
    city: params.leadCity,
    streetAddress: params.leadStreetAddress,
  });

  // Janela já existente: dia fixo da cidade (Ajustes) + dias padrão.
  const standard = resolveDateOptionsForCity(
    params.leadCity,
    params.cityFixedDays,
    params.defaultDay1,
    params.defaultDay2,
    referenceDate
  );
  const fixedDayIndex = standard.isFixedCityDay
    ? getWeekdayChoice(standard.fixedWeekday).dayIndex
    : null;

  // Agrupa eventos por dia.
  const byDay = new Map<string, GoogleCalendarEvent[]>();
  for (const evt of params.events) {
    const key = getCalendarEventDateKey(evt);
    if (!key) continue;
    const list = byDay.get(key);
    if (list) list.push(evt);
    else byDay.set(key, [evt]);
  }

  const dayInfo = (key: string) => {
    const list = byDay.get(key) || [];
    const dayOff = list.some(isDayOffEvent);
    const timed = list.filter((e) => Boolean(e.start?.dateTime));
    return {
      list,
      dayOff,
      full: timed.length >= SMART_SCHEDULE_MAX_JOBS_PER_DAY,
    };
  };

  const near: SmartDateSuggestion[] = [];
  const nearKeys = new Set<string>();
  let unlocatedEventsCount = 0;

  const start = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );

  for (let offset = 1; offset <= SMART_SCHEDULE_HORIZON_DAYS; offset += 1) {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + offset
    );
    if (isUsHoliday(date)) continue;
    if (fixedDayIndex !== null && date.getDay() !== fixedDayIndex) continue;

    const key = toDateKey(date);
    const info = dayInfo(key);
    if (info.list.length === 0) continue;

    let best: { miles: number; city: string; sameCity: boolean } | null = null;
    for (const evt of info.list) {
      if (isDayOffEvent(evt)) continue;
      const place =
        resolveLocationText(evt.location) ??
        (evt.location ? null : resolveLocationText(evt.summary));
      if (!place) {
        if (evt.start?.dateTime) unlocatedEventsCount += 1;
        continue;
      }
      if (!leadPlace) continue;
      const miles = distanceMiles(leadPlace, place);
      const sameCity =
        normalizeText(place.city) === normalizeText(leadPlace.city) &&
        (place.source === 'city' || leadPlace.source === 'city');
      if (!best || miles < best.miles) {
        best = { miles, city: place.city, sameCity };
      }
    }

    if (!leadPlace || !best || info.dayOff || info.full) continue;
    if (best.miles > SMART_SCHEDULE_MAX_RADIUS_MILES) continue;

    near.push({
      dateKey: key,
      date,
      pt: formatDateOptionPt(date),
      en: formatDateOptionEn(date),
      distanceMiles: Math.round(best.miles * 10) / 10,
      nearCity: best.city,
      sameCity: best.sameCity,
      eventsCount: info.list.length,
      tier:
        best.miles <= SMART_SCHEDULE_CLOSE_RADIUS_MILES ? 'muito-perto' : 'perto',
    });
    nearKeys.add(key);
  }

  // Mais perto primeiro; empate (até 1 milha de diferença) vai para o mais cedo.
  near.sort((a, b) => {
    const diff = (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0);
    if (Math.abs(diff) >= 1) return diff;
    return a.dateKey.localeCompare(b.dateKey);
  });
  const topNear = near.slice(0, SMART_SCHEDULE_MAX_NEAR_RESULTS);

  // Dias padrão (sem vizinho) aparecem depois, sem distância.
  const others: SmartDateSuggestion[] = [];
  for (const opt of standard.dates) {
    if (nearKeys.has(opt.dateKey)) continue;
    if (others.some((o) => o.dateKey === opt.dateKey)) continue;
    const info = dayInfo(opt.dateKey);
    if (info.dayOff) continue;
    others.push({
      dateKey: opt.dateKey,
      date: opt.date,
      pt: opt.pt,
      en: opt.en,
      distanceMiles: null,
      nearCity: null,
      sameCity: false,
      eventsCount: info.list.length,
      tier: 'sem-vizinho',
    });
  }

  return {
    status: leadPlace ? 'ok' : 'lead-sem-local',
    leadPlace,
    near: topNear,
    others,
    unlocatedEventsCount,
    fixedWeekdayPt: standard.fixedWeekdayPt,
  };
}

/** "3 milhas de um serviço em Norwalk" */
export function describeNearSuggestion(s: SmartDateSuggestion): string {
  if (s.distanceMiles === null || !s.nearCity) return 'Sem serviço por perto';
  if (s.sameCity) return `Serviço na mesma cidade (${s.nearCity})`;
  if (s.distanceMiles < 1) return `Menos de 1 milha de um serviço em ${s.nearCity}`;
  const miles = s.distanceMiles.toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
  });
  return `${miles} ${s.distanceMiles === 1 ? 'milha' : 'milhas'} de um serviço em ${s.nearCity}`;
}
