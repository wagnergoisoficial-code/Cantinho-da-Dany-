import {
  CityFixedDayRule,
  FrequencyType,
  LeadInputState,
  LeadOrigin,
  PriceCalculationResult,
} from '../types/pricing';
import { DEFAULT_CITY_FIXED_DAYS } from '../data/defaultPricing';
import { formatOfficialCityName } from './cityFormatter';
import { resolveDateOptionsForCity } from './dateOptions';
import { computeDeepCleanRangeMax } from './pricingEngine';

const FREQUENCY_PT: Record<FrequencyType, string> = {
  semanal: 'semanal',
  quinzenal: 'quinzenal',
  mensal: 'mensal',
};

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function getBedroomCount(tierId: string, tierLabel: string): string {
  const idMatch = /^(\d+)/.exec(tierId.trim());
  if (idMatch) return idMatch[1];
  const labelMatch = /^(\d+)/.exec(tierLabel.trim());
  if (labelMatch) return labelMatch[1];
  return '2';
}

function formatOriginEn(origin: LeadOrigin | ''): string {
  if (!origin) return 'on [Origem]';
  switch (origin) {
    case 'Facebook':
      return 'on Facebook';
    case 'Thumbtack':
      return 'on Thumbtack';
    case 'Nextdoor':
      return 'on Nextdoor';
    case 'Site':
      return 'on our website';
    case 'Ligação':
      return 'on the phone';
    case 'Indicação':
      return 'on a referral';
    case 'Outro':
      return 'on our form';
    default:
      return `on ${origin}`;
  }
}

function formatOriginPt(origin: LeadOrigin | ''): string {
  if (!origin) return 'por [Origem]';
  switch (origin) {
    case 'Facebook':
      return 'pelo Facebook';
    case 'Thumbtack':
      return 'pelo Thumbtack';
    case 'Nextdoor':
      return 'pelo Nextdoor';
    case 'Site':
      return 'pelo site';
    case 'Ligação':
      return 'por ligação';
    case 'Indicação':
      return 'por indicação';
    case 'Outro':
      return 'por outro canal';
    default:
      return `por ${origin}`;
  }
}

function normalizeCityKey(raw: string): string {
  const cleaned = formatOfficialCityName(raw.split(',')[0] || '');
  return cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function isCityInServedList(
  city: string,
  servedCities: string[] = []
): boolean {
  const target = normalizeCityKey(city);
  if (!target) return false;
  return servedCities.some((item) => normalizeCityKey(item) === target);
}

function formatExtrasEn(
  input: LeadInputState,
  mode: 'standard' | 'deep_clean' | 'move_in_out',
  compact = false
): string {
  const items: string[] = [];
  if (mode === 'standard' && input.extras.forno) {
    items.push(compact ? 'oven' : 'inside oven');
  }
  if (mode !== 'move_in_out' && input.extras.geladeira) {
    items.push(compact ? 'fridge' : 'inside fridge');
  }
  if (mode === 'standard' && input.extras.janelas) {
    const qty = Math.max(1, Math.round(input.extras.windowCount || 1));
    items.push(`${qty} window${qty > 1 ? 's' : ''}`);
  }
  if (mode !== 'move_in_out' && input.extras.armarios) {
    items.push(compact ? 'cabinets' : 'inside cabinets');
  }
  if (input.extras.roupaDeCama) {
    items.push('bed linens');
  }
  return items.length > 0 ? items.join(', ') : '';
}

function formatExtrasPt(
  input: LeadInputState,
  mode: 'standard' | 'deep_clean' | 'move_in_out'
): string {
  const items: string[] = [];
  if (mode === 'standard' && input.extras.forno) items.push('forno por dentro');
  if (mode !== 'move_in_out' && input.extras.geladeira) {
    items.push('geladeira por dentro');
  }
  if (mode === 'standard' && input.extras.janelas) {
    const qty = Math.max(1, Math.round(input.extras.windowCount || 1));
    items.push(`${qty} janela${qty > 1 ? 's' : ''} e peitoris`);
  }
  if (mode !== 'move_in_out' && input.extras.armarios) {
    items.push('armários por dentro');
  }
  if (input.extras.roupaDeCama) {
    const beds = Math.max(1, Math.round(input.extras.bedCount || 1));
    items.push(`roupa de cama (${beds} cama${beds > 1 ? 's' : ''})`);
  }
  return items.length > 0 ? items.join(', ') : '';
}

/**
 * Picks the longest candidate that fits within 60 words; if all exceed 60,
 * picks the shortest candidate.
 */
function pickWithinWordLimit(candidates: string[], maxWords = 60): string {
  for (const candidate of candidates) {
    if (countWords(candidate) <= maxWords) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

export function buildQuoteMessages(
  input: LeadInputState,
  calc: PriceCalculationResult,
  finalPrimaryPrice: number,
  finalRecurringPrice: number | null,
  deepCleanRangeMarginPercent = 20,
  servedCities: string[] = [],
  referenceDate: Date = new Date(),
  cityFixedDays: CityFixedDayRule[] = DEFAULT_CITY_FIXED_DAYS
): { english: string; portuguese: string } {
  const firstName = input.clientName.trim().split(/\s+/)[0] || '';
  const nameDisplay = firstName || '[Nome]';
  const greetingPt = firstName ? `Oi ${firstName},` : 'Oi [Nome],';

  const originEn = formatOriginEn(input.origin);
  const originPt = formatOriginPt(input.origin);

  const firstSentenceEn = `Hi ${nameDisplay}, this is Dani from Dany Clean Pro. You requested a cleaning quote ${originEn}.`;
  const firstSentencePt = `${greetingPt} aqui é a Dani da Dany Clean Pro. Você pediu um orçamento de limpeza ${originPt}.`;

  const bedrooms = getBedroomCount(
    calc.effectiveTier.id,
    calc.effectiveTier.label
  );
  const bedroomWordPt = Number(bedrooms) === 1 ? 'quarto' : 'quartos';
  const officialCity = formatOfficialCityName(input.city);
  const cityDisplay = officialCity || '[Cidade]';
  const homeScopeEn = `For your ${bedrooms}-bedroom home in ${cityDisplay}`;
  const homeScopePt = `Para sua casa de ${bedrooms} ${bedroomWordPt} em ${cityDisplay}`;

  const showNeighborhoodProof =
    Boolean(officialCity) && isCityInServedList(officialCity, servedCities);
  const proofEn = showNeighborhoodProof
    ? ` We already clean homes in ${officialCity}.`
    : '';
  const proofPt = showNeighborhoodProof
    ? ` Já limpamos casas em ${officialCity}.`
    : '';

  const resolvedCityDates = resolveDateOptionsForCity(
    officialCity,
    cityFixedDays,
    input.dayOption1,
    input.dayOption2,
    referenceDate
  );
  const [date1, date2] = resolvedCityDates.dates;

  const closingFullEn = `I have an opening on ${date1.en} or ${date2.en}. Which works better for you?`;
  const closingCompactEn = `I have an opening ${date1.en} or ${date2.en}. Which works better for you?`;
  const closingPt = `Tenho horário disponível em ${date1.pt} ou ${date2.pt}. Qual funciona melhor para você?`;

  const hasPromo = calc.promoPercent > 0;
  const promoTagEn = hasPromo ? ` (${calc.promoPercent}% off)` : '';
  const promoTagPt = hasPromo
    ? input.promoName.trim()
      ? ` (${calc.promoPercent}% de desconto, ${input.promoName.trim()})`
      : ` (${calc.promoPercent}% de desconto)`
    : '';

  if (calc.isVisitaAvulsa) {
    let serviceEn = '';
    let servicePt = '';
    if (input.visitaAvulsaOption === 'fogao_forno') {
      serviceEn = 'stove and inside oven cleaning';
      servicePt = 'limpeza de fogão e forno por dentro';
    } else if (input.visitaAvulsaOption === 'geladeira') {
      serviceEn = 'inside fridge cleaning';
      servicePt = 'limpeza da geladeira por dentro';
    } else if (input.visitaAvulsaOption === 'forno_geladeira') {
      serviceEn = 'inside oven and fridge cleaning';
      servicePt = 'limpeza de forno e geladeira por dentro';
    } else {
      const qty = Math.max(1, Math.round(input.extras.windowCount || 1));
      serviceEn = `window cleaning (${qty} window${qty > 1 ? 's' : ''})`;
      servicePt = `limpeza de janelas (${qty} janela${qty > 1 ? 's' : ''} e peitoris)`;
    }

    const english = pickWithinWordLimit([
      `${firstSentenceEn}\n\n${homeScopeEn}, ${serviceEn} is $${finalPrimaryPrice}${promoTagEn}.${proofEn} ${closingFullEn}`,
      `${firstSentenceEn}\n\n${homeScopeEn}, ${serviceEn} is $${finalPrimaryPrice}${promoTagEn}.${proofEn} ${closingCompactEn}`,
      `${firstSentenceEn}\n\n${homeScopeEn}, ${serviceEn} is $${finalPrimaryPrice}.${proofEn} ${closingCompactEn}`,
    ]);

    const portuguese = `${firstSentencePt}\n\n${homeScopePt}, o serviço de ${servicePt} fica $${finalPrimaryPrice}${promoTagPt}.${proofPt} ${closingPt}`;

    return { english, portuguese };
  }

  if (input.serviceType === 'recorrente') {
    const freqPt = FREQUENCY_PT[input.frequency];
    const recurringAmount = finalRecurringPrice ?? finalPrimaryPrice;
    const extrasFull = formatExtrasEn(input, 'standard', false);
    const extrasCompact = formatExtrasEn(input, 'standard', true);
    const extrasPt = formatExtrasPt(input, 'standard');
    const extrasFullClause = extrasFull ? ` (including ${extrasFull})` : '';
    const extrasCompactClause = extrasCompact
      ? ` (incl. ${extrasCompact})`
      : '';
    const extrasLinePt = extrasPt ? ` (incluindo ${extrasPt})` : '';

    if (input.frequency === 'mensal') {
      const biweeklyOption =
        calc.biweeklyTablePrice ?? calc.effectiveTier.quinzenal;
      const biweeklyLongEn = `or $${biweeklyOption} a visit if you'd like it every two weeks`;
      const biweeklyShortEn = `or $${biweeklyOption} every other week`;
      const biweeklyClausePt = `ou $${biweeklyOption} por visita se preferir a cada duas semanas`;

      const english = pickWithinWordLimit([
        `${firstSentenceEn}\n\n${homeScopeEn}, your first cleaning${extrasFullClause} is $${finalPrimaryPrice}${promoTagEn} and monthly visits are $${recurringAmount}, ${biweeklyLongEn}.${proofEn} ${closingFullEn}`,
        `${firstSentenceEn}\n\n${homeScopeEn}, first cleaning${extrasCompactClause} is $${finalPrimaryPrice}${promoTagEn} and monthly is $${recurringAmount}, ${biweeklyLongEn}.${proofEn} ${closingCompactEn}`,
        `${firstSentenceEn}\n\n${homeScopeEn}, first cleaning $${finalPrimaryPrice}${promoTagEn}, monthly $${recurringAmount}, ${biweeklyLongEn}.${proofEn} ${closingCompactEn}`,
        `${firstSentenceEn}\n\n${homeScopeEn}, first cleaning is $${finalPrimaryPrice}${promoTagEn} and monthly is $${recurringAmount}, ${biweeklyShortEn}.${proofEn} ${closingFullEn}`,
        `${firstSentenceEn}\n\n${homeScopeEn}, first cleaning $${finalPrimaryPrice}, monthly $${recurringAmount}, ${biweeklyShortEn}.${proofEn} ${closingCompactEn}`,
      ]);

      const portuguese = `${firstSentencePt}\n\n${homeScopePt}, sua primeira limpeza${extrasLinePt} fica $${finalPrimaryPrice}${promoTagPt} e as visitas mensais ficam $${recurringAmount}, ${biweeklyClausePt}.${proofPt} ${closingPt}`;

      return { english, portuguese };
    }

    const recurringPhraseFullEn =
      input.frequency === 'quinzenal'
        ? `visits every other week are $${recurringAmount} per visit`
        : `ongoing weekly visits are $${recurringAmount} per visit`;
    const recurringPhraseShortEn =
      input.frequency === 'quinzenal'
        ? `visits every other week are $${recurringAmount}`
        : `weekly visits are $${recurringAmount}`;

    const english = pickWithinWordLimit([
      `${firstSentenceEn}\n\n${homeScopeEn}, your first cleaning${extrasFullClause} is $${finalPrimaryPrice}${promoTagEn} and ${recurringPhraseFullEn}.${proofEn} ${closingFullEn}`,
      `${firstSentenceEn}\n\n${homeScopeEn}, first cleaning${extrasCompactClause} is $${finalPrimaryPrice}${promoTagEn} and ${recurringPhraseShortEn}.${proofEn} ${closingFullEn}`,
      `${firstSentenceEn}\n\n${homeScopeEn}, first cleaning is $${finalPrimaryPrice}${promoTagEn} and ${recurringPhraseShortEn}.${proofEn} ${closingCompactEn}`,
      `${firstSentenceEn}\n\n${homeScopeEn}, first cleaning $${finalPrimaryPrice}, ${recurringPhraseShortEn}.${proofEn} ${closingCompactEn}`,
    ]);

    const portuguese = `${firstSentencePt}\n\n${homeScopePt}, sua primeira limpeza${extrasLinePt} fica $${finalPrimaryPrice}${promoTagPt} e a manutenção ${freqPt} fica $${recurringAmount} por visita.${proofPt} ${closingPt}`;

    return { english, portuguese };
  }

  if (input.serviceType === 'deep_clean') {
    const rangeMin = finalPrimaryPrice;
    const rangeMax = Math.max(
      rangeMin,
      computeDeepCleanRangeMax(rangeMin, deepCleanRangeMarginPercent)
    );
    const deepIntroEn = `Hi ${nameDisplay}, this is Dani from Dany Clean Pro. You requested a deep cleaning quote ${originEn}.`;
    const deepIntroPt = `${greetingPt} aqui é a Dani da Dany Clean Pro. Você pediu um orçamento de deep cleaning ${originPt}.`;
    const deepScopeEn = `For your ${bedrooms}-bedroom home it's usually $${rangeMin} to $${rangeMax}${promoTagEn}.`;

    const english = pickWithinWordLimit([
      `${deepIntroEn}\n\n${deepScopeEn} For an exact price, could you text me 3 photos or a short video of the kitchen, main bathroom and living room? No need to tidy up first. If you'd rather, I can stop by.`,
      `${deepIntroEn}\n\n${deepScopeEn} For an exact price, could you text me 3 photos or a video of the kitchen, main bathroom and living room? No need to tidy up first. If you'd rather, I can stop by.`,
      `${deepIntroEn}\n\n${deepScopeEn} For an exact price, could you text me 3 photos or a video of the kitchen, main bathroom and living room? No need to tidy first. Or I can stop by.`,
      `${deepIntroEn}\n\n${deepScopeEn} For an exact price, send 3 photos or a video of the kitchen, main bath and living room? No need to tidy first. Or I can stop by.`,
    ]);

    const portuguese = `${deepIntroPt}\n\nPara sua casa de ${bedrooms} ${bedroomWordPt} geralmente fica de $${rangeMin} a $${rangeMax}${promoTagPt}. Para fechar o valor exato, pode me enviar 3 fotos ou um vídeo curto da cozinha, banheiro principal e sala? Não precisa arrumar antes. Se preferir, posso passar aí.`;

    return { english, portuguese };
  }

  if (input.serviceType === 'move_in_out') {
    const extraAddons = formatExtrasEn(input, 'move_in_out', true);
    const addonsEn = extraAddons ? `, ${extraAddons}` : '';
    const extraAddonsPt = formatExtrasPt(input, 'move_in_out');
    const addonsPt = extraAddonsPt ? ` Além de ${extraAddonsPt}.` : '';

    const english = pickWithinWordLimit([
      `${firstSentenceEn}\n\n${homeScopeEn}, move-in and move-out cleaning is $${finalPrimaryPrice}${promoTagEn} (includes oven, fridge, cabinets, windows${addonsEn}).${proofEn} ${closingFullEn}`,
      `${firstSentenceEn}\n\n${homeScopeEn}, move-in and move-out is $${finalPrimaryPrice}${promoTagEn} (oven, fridge, cabinets, windows included).${proofEn} ${closingCompactEn}`,
      `${firstSentenceEn}\n\n${homeScopeEn}, move-in and move-out is $${finalPrimaryPrice} (oven, fridge, cabinets, windows).${proofEn} ${closingCompactEn}`,
    ]);

    const portuguese = `${firstSentencePt}\n\n${homeScopePt}, a limpeza move-in e move-out fica $${finalPrimaryPrice}${promoTagPt}, já incluindo forno, geladeira, armários e janelas por dentro.${addonsPt}${proofPt} ${closingPt}`;

    return { english, portuguese };
  }

  // Primeira limpeza avulsa
  const extrasFull = formatExtrasEn(input, 'standard', false);
  const extrasCompact = formatExtrasEn(input, 'standard', true);
  const extrasPt = formatExtrasPt(input, 'standard');
  const extrasFullClause = extrasFull ? ` (including ${extrasFull})` : '';
  const extrasCompactClause = extrasCompact ? ` (incl. ${extrasCompact})` : '';
  const extrasPtClause = extrasPt ? ` (incluindo ${extrasPt})` : '';

  const english = pickWithinWordLimit([
    `${firstSentenceEn}\n\n${homeScopeEn}, your cleaning total${extrasFullClause} is $${finalPrimaryPrice}${promoTagEn}.${proofEn} ${closingFullEn}`,
    `${firstSentenceEn}\n\n${homeScopeEn}, your cleaning total${extrasCompactClause} is $${finalPrimaryPrice}${promoTagEn}.${proofEn} ${closingCompactEn}`,
    `${firstSentenceEn}\n\n${homeScopeEn}, cleaning is $${finalPrimaryPrice}.${proofEn} ${closingCompactEn}`,
  ]);

  const portuguese = `${firstSentencePt}\n\n${homeScopePt}, sua limpeza${extrasPtClause} fica $${finalPrimaryPrice}${promoTagPt}.${proofPt} ${closingPt}`;

  return { english, portuguese };
}
