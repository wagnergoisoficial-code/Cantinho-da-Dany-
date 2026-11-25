export type WeekdayName =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

export interface WeekdayChoice {
  value: WeekdayName;
  labelPt: string;
  shortPt: string;
  dayIndex: number; // 0 = Sunday .. 6 = Saturday
}

export const WEEKDAY_CHOICES: WeekdayChoice[] = [
  { value: 'Monday', labelPt: 'Segunda-feira', shortPt: 'segunda', dayIndex: 1 },
  { value: 'Tuesday', labelPt: 'Terça-feira', shortPt: 'terça', dayIndex: 2 },
  { value: 'Wednesday', labelPt: 'Quarta-feira', shortPt: 'quarta', dayIndex: 3 },
  { value: 'Thursday', labelPt: 'Quinta-feira', shortPt: 'quinta', dayIndex: 4 },
  { value: 'Friday', labelPt: 'Sexta-feira', shortPt: 'sexta', dayIndex: 5 },
  { value: 'Saturday', labelPt: 'Sábado', shortPt: 'sábado', dayIndex: 6 },
  { value: 'Sunday', labelPt: 'Domingo', shortPt: 'domingo', dayIndex: 0 },
];

const EN_WEEKDAYS: Record<number, WeekdayName> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

const EN_MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const PT_SHORT_WEEKDAYS: Record<number, string> = {
  0: 'domingo',
  1: 'segunda',
  2: 'terça',
  3: 'quarta',
  4: 'quinta',
  5: 'sexta',
  6: 'sábado',
};

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function normalizeWeekdayName(
  raw: string | null | undefined,
  fallback: WeekdayName = 'Tuesday'
): WeekdayName {
  const cleaned = stripAccents(raw || '');
  if (!cleaned) return fallback;

  if (cleaned.startsWith('mon') || cleaned.startsWith('segunda')) return 'Monday';
  if (cleaned.startsWith('tue') || cleaned.startsWith('terca')) return 'Tuesday';
  if (cleaned.startsWith('wed') || cleaned.startsWith('quarta')) return 'Wednesday';
  if (cleaned.startsWith('thu') || cleaned.startsWith('quinta')) return 'Thursday';
  if (cleaned.startsWith('fri') || cleaned.startsWith('sexta')) return 'Friday';
  if (cleaned.startsWith('sat') || cleaned.startsWith('sabado')) return 'Saturday';
  if (cleaned.startsWith('sun') || cleaned.startsWith('domingo')) return 'Sunday';

  return fallback;
}

export function getWeekdayChoice(
  raw: string | null | undefined,
  fallback: WeekdayName = 'Tuesday'
): WeekdayChoice {
  const normalized = normalizeWeekdayName(raw, fallback);
  return (
    WEEKDAY_CHOICES.find((item) => item.value === normalized) ??
    WEEKDAY_CHOICES[1]
  );
}

/**
 * Checks the 6 required US holidays:
 * - New Year's Day (Jan 1)
 * - Memorial Day (last Monday of May)
 * - July 4th (Jul 4)
 * - Labor Day (first Monday of September)
 * - Thanksgiving (4th Thursday of November)
 * - Christmas Day (Dec 25)
 */
export function isUsHoliday(date: Date): boolean {
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();
  const dow = date.getDay(); // 0 = Sun, 1 = Mon .. 6 = Sat

  // New Year's Day
  if (month === 0 && day === 1) return true;
  // Memorial Day: last Monday of May (May has 31 days -> day >= 25)
  if (month === 4 && dow === 1 && day >= 25) return true;
  // July 4th (Independence Day)
  if (month === 6 && day === 4) return true;
  // Labor Day: first Monday of September
  if (month === 8 && dow === 1 && day <= 7) return true;
  // Thanksgiving: 4th Thursday of November
  if (month === 10 && dow === 4 && day >= 22 && day <= 28) return true;
  // Christmas Day
  if (month === 11 && day === 25) return true;

  return false;
}

export interface ResolvedDateOption {
  weekday: WeekdayName;
  date: Date;
  dateKey: string; // YYYY-MM-DD
  en: string; // e.g. "Tuesday, Dec 1"
  pt: string; // e.g. "terça, 01/12"
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateOptionEn(date: Date): string {
  const weekday = EN_WEEKDAYS[date.getDay()];
  const month = EN_MONTHS_SHORT[date.getMonth()];
  const day = date.getDate();
  return `${weekday}, ${month} ${day}`;
}

export function formatDateOptionPt(date: Date): string {
  const weekday = PT_SHORT_WEEKDAYS[date.getDay()];
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${weekday}, ${day}/${month}`;
}

/**
 * Finds the next upcoming real date for the selected weekday,
 * NEVER today (starts at +1 day minimum) and NEVER on US holidays.
 */
export function getNextAvailableWeekdayDate(
  weekdayRaw: string | null | undefined,
  fromDate: Date = new Date(),
  fallback: WeekdayName = 'Tuesday',
  minOffsetDays = 1
): ResolvedDateOption {
  const choice = getWeekdayChoice(weekdayRaw, fallback);
  const startBase = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate()
  );

  const safeMinOffset = Math.max(1, Math.floor(minOffsetDays));

  for (let offset = safeMinOffset; offset <= 90; offset += 1) {
    const candidate = new Date(
      startBase.getFullYear(),
      startBase.getMonth(),
      startBase.getDate() + offset
    );
    if (candidate.getDay() === choice.dayIndex && !isUsHoliday(candidate)) {
      return {
        weekday: choice.value,
        date: candidate,
        dateKey: toDateKey(candidate),
        en: formatDateOptionEn(candidate),
        pt: formatDateOptionPt(candidate),
      };
    }
  }

  // Fallback seguro caso algo improvável aconteça
  const fallbackDate = new Date(
    startBase.getFullYear(),
    startBase.getMonth(),
    startBase.getDate() + safeMinOffset
  );
  return {
    weekday: EN_WEEKDAYS[fallbackDate.getDay()],
    date: fallbackDate,
    dateKey: toDateKey(fallbackDate),
    en: formatDateOptionEn(fallbackDate),
    pt: formatDateOptionPt(fallbackDate),
  };
}

export function getTwoSuggestedDateOptions(
  day1Raw: string | null | undefined,
  day2Raw: string | null | undefined,
  fromDate: Date = new Date()
): [ResolvedDateOption, ResolvedDateOption] {
  const first = getNextAvailableWeekdayDate(day1Raw, fromDate, 'Tuesday', 1);
  let second = getNextAvailableWeekdayDate(day2Raw, fromDate, 'Thursday', 1);

  if (first.dateKey === second.dateKey) {
    second = getNextAvailableWeekdayDate(day2Raw, first.date, 'Thursday', 1);
  }

  const ordered = [first, second].sort((a, b) =>
    a.dateKey.localeCompare(b.dateKey)
  );
  return [ordered[0], ordered[1]];
}

function normalizeCityLookupKey(raw: string): string {
  return stripAccents((raw || '').split(',')[0] || '');
}

export interface CityResolvedDateOptions {
  isFixedCityDay: boolean;
  fixedWeekday: WeekdayName | null;
  fixedWeekdayPt: string | null;
  dates: [ResolvedDateOption, ResolvedDateOption];
  proofWeekdayEn: WeekdayName;
}

export function resolveDateOptionsForCity(
  city: string | null | undefined,
  cityFixedDays: Array<{ city: string; weekday: string }> = [],
  defaultDay1: string | null | undefined = 'Tuesday',
  defaultDay2: string | null | undefined = 'Thursday',
  referenceDate: Date = new Date()
): CityResolvedDateOptions {
  const cityKey = normalizeCityLookupKey(city || '');
  const matchedRule = cityKey
    ? cityFixedDays.find(
        (rule) => normalizeCityLookupKey(rule.city) === cityKey
      )
    : undefined;

  if (matchedRule) {
    const fixedChoice = getWeekdayChoice(matchedRule.weekday, 'Thursday');
    const dates = getTwoSuggestedDateOptions(
      fixedChoice.value,
      fixedChoice.value,
      referenceDate
    );
    return {
      isFixedCityDay: true,
      fixedWeekday: fixedChoice.value,
      fixedWeekdayPt: fixedChoice.labelPt,
      dates,
      proofWeekdayEn: fixedChoice.value,
    };
  }

  const dates = getTwoSuggestedDateOptions(defaultDay1, defaultDay2, referenceDate);
  return {
    isFixedCityDay: false,
    fixedWeekday: null,
    fixedWeekdayPt: null,
    dates,
    proofWeekdayEn: normalizeWeekdayName(defaultDay1, 'Tuesday'),
  };
}

