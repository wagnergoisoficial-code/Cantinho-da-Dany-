import {
  BreakdownLine,
  HouseCondition,
  HouseTier,
  LeadInputState,
  LeadQuoteRecord,
  PetsOption,
  PriceCalculationResult,
  PricingConfig,
} from '../types/pricing';
import {
  FREQUENCY_LABELS,
  INITIAL_LEAD_STATE,
  VISITA_AVULSA_LABELS,
} from '../data/defaultPricing';

export function roundToNearest5(value: number): number {
  return Math.round(value / 5) * 5;
}

export function getConditionMultiplier(
  condition: HouseCondition,
  config?: Pick<PricingConfig, 'conditionModeratePercent' | 'conditionHeavyPercent'>
): number {
  if (condition === 'moderado') {
    const pct = config?.conditionModeratePercent ?? 10;
    return Math.max(0, pct) / 100;
  }
  if (condition === 'pesado') {
    const pct = config?.conditionHeavyPercent ?? 25;
    return Math.max(0, pct) / 100;
  }
  return 0;
}

export function getPetsAddon(
  pets: PetsOption,
  config?: Pick<PricingConfig, 'petOnePrice' | 'petTwoPlusPrice'>
): number {
  if (pets === 'um') return Math.max(0, config?.petOnePrice ?? 10);
  if (pets === 'dois_ou_mais') return Math.max(0, config?.petTwoPlusPrice ?? 20);
  return 0;
}

export function computeDeepCleanRangeMax(
  basePrice: number,
  marginPercent: number
): number {
  const safeMargin = Math.max(0, Number(marginPercent) || 0);
  return roundToNearest5(Math.max(0, basePrice) * (1 + safeMargin / 100));
}

export function resolveEffectiveTier(
  tiers: HouseTier[],
  selectedTierId: string,
  squareFeetRaw: string
): {
  selectedTier: HouseTier;
  effectiveTier: HouseTier;
  tierUpgradedBySqFt: boolean;
  sqFtThreshold: number;
  parsedSqFt: number | null;
} {
  const selectedIndex = Math.max(
    0,
    tiers.findIndex((t) => t.id === selectedTierId)
  );
  const selectedTier = tiers[selectedIndex] ?? tiers[0];
  const sqFtThreshold = Math.round(selectedTier.refSqFt * 1.3);

  const trimmed = squareFeetRaw.trim();
  const parsed = trimmed ? Number(trimmed) : NaN;
  const parsedSqFt = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  if (parsedSqFt !== null && parsedSqFt > sqFtThreshold) {
    const nextIndex = Math.min(selectedIndex + 1, tiers.length - 1);
    const effectiveTier = tiers[nextIndex];
    return {
      selectedTier,
      effectiveTier,
      tierUpgradedBySqFt: nextIndex > selectedIndex,
      sqFtThreshold,
      parsedSqFt,
    };
  }

  return {
    selectedTier,
    effectiveTier: selectedTier,
    tierUpgradedBySqFt: false,
    sqFtThreshold,
    parsedSqFt,
  };
}

export function mapRoomsToTierId(
  quartos: number | null,
  banheiros: number | null,
  tiers: HouseTier[]
): string | null {
  if (quartos === null && banheiros === null) return null;
  const q = quartos ?? (banheiros !== null && banheiros >= 3 ? 3 : 2);
  const b = banheiros ?? (q >= 3 ? 2 : 1);

  let targetId = '2q_2b';
  if (q >= 5) {
    targetId = '5q_3pb';
  } else if (q === 4) {
    targetId = '4q_2_3b';
  } else if (q === 3) {
    targetId = b >= 3 ? '3q_3b' : '3q_2b';
  } else if (q === 2) {
    targetId = b >= 2 ? '2q_2b' : '2q_1b';
  } else {
    targetId = b >= 2 ? '1q_2b' : '1q_1b';
  }

  return tiers.some((t) => t.id === targetId) ? targetId : tiers[0]?.id ?? null;
}

export function parsePromoPercent(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(100, Math.round(num * 100) / 100);
}

function computePromoValues(tablePrice: number, promoPercent: number) {
  if (promoPercent <= 0) {
    return {
      primaryPromoPrice: null,
      primaryDiscountAmount: 0,
      effectiveDefaultPrimaryPrice: tablePrice,
    };
  }
  const discounted = Math.max(
    0,
    Math.round(tablePrice * (1 - promoPercent / 100))
  );
  return {
    primaryPromoPrice: discounted,
    primaryDiscountAmount: Math.max(0, tablePrice - discounted),
    effectiveDefaultPrimaryPrice: discounted,
  };
}

export function calculateQuote(
  input: LeadInputState,
  config: PricingConfig
): PriceCalculationResult {
  const {
    selectedTier,
    effectiveTier,
    tierUpgradedBySqFt,
    sqFtThreshold,
    parsedSqFt,
  } = resolveEffectiveTier(
    config.tiers,
    input.selectedTierId,
    input.squareFeet
  );

  // Visita avulsa: ignora tabela de casas, estado da casa e pets
  if (input.serviceType === 'visita_avulsa') {
    const breakdown: BreakdownLine[] = [];
    let rawTotal = 0;

    if (input.visitaAvulsaOption === 'fogao_forno') {
      rawTotal = config.visitaAvulsa.fogaoEForno;
      breakdown.push({
        label: VISITA_AVULSA_LABELS.fogao_forno,
        amount: rawTotal,
      });
    } else if (input.visitaAvulsaOption === 'geladeira') {
      rawTotal = config.visitaAvulsa.geladeira;
      breakdown.push({
        label: VISITA_AVULSA_LABELS.geladeira,
        amount: rawTotal,
      });
    } else if (input.visitaAvulsaOption === 'forno_geladeira') {
      rawTotal = config.visitaAvulsa.fornoEGeladeira;
      breakdown.push({
        label: VISITA_AVULSA_LABELS.forno_geladeira,
        amount: rawTotal,
      });
    } else {
      const qty = Math.max(1, Math.round(input.extras.windowCount || 1));
      const calcWindows = qty * config.extras.janelaPorUnidade;
      const minWindows = config.visitaAvulsa.soJanelasMinimo;
      rawTotal = Math.max(minWindows, calcWindows);
      breakdown.push({
        label: `Só janelas (${qty} × $${config.extras.janelaPorUnidade})`,
        amount: calcWindows,
        note:
          calcWindows < minWindows
            ? `Aplicado mínimo avulso de $${minWindows}`
            : undefined,
      });
    }

    const promoPercent = parsePromoPercent(input.promoPercent);
    const roundedTotal = roundToNearest5(rawTotal);
    const promoVals = computePromoValues(roundedTotal, promoPercent);

    return {
      isRecurring: false,
      isVisitaAvulsa: true,
      isDeepCleanScope: false,
      selectedTier,
      effectiveTier,
      tierUpgradedBySqFt: false,
      sqFtThreshold,
      parsedSqFt,
      primaryTablePrice: roundedTotal,
      promoPercent,
      ...promoVals,
      deepCleanRangeMax: null,
      primaryLabel: `Visita avulsa · ${VISITA_AVULSA_LABELS[input.visitaAvulsaOption]}`,
      primaryBreakdown: breakdown,
      recurringTablePrice: null,
      biweeklyTablePrice: null,
      recurringLabel: null,
      recurringBreakdown: [],
    };
  }

  const isMoveInOut = input.serviceType === 'move_in_out';
  const isDeepClean = input.serviceType === 'deep_clean';
  const isDeepCleanScope = isDeepClean || isMoveInOut;
  const conditionMult = getConditionMultiplier(input.houseCondition, config);
  const petsCost = getPetsAddon(input.petsOption, config);

  // Extras calculados para a limpeza principal/inicial
  const extrasLines: BreakdownLine[] = [];
  let extrasTotal = 0;

  if (isDeepCleanScope) {
    extrasLines.push({
      label: 'Forno por dentro',
      amount: 0,
      included: true,
    });
    extrasLines.push({
      label: 'Janelas por dentro (abre e limpa o peitoril)',
      amount: 0,
      included: true,
    });
  } else {
    if (input.extras.forno) {
      extrasTotal += config.extras.forno;
      extrasLines.push({
        label: 'Forno por dentro',
        amount: config.extras.forno,
      });
    }
    if (input.extras.janelas) {
      const qty = Math.max(1, Math.round(input.extras.windowCount || 1));
      const cost = qty * config.extras.janelaPorUnidade;
      extrasTotal += cost;
      extrasLines.push({
        label: `Janelas (${qty} × $${config.extras.janelaPorUnidade})`,
        amount: cost,
      });
    }
  }

  // Move-in/Move-out inclui armários, forno e geladeira por dentro a $0
  if (isMoveInOut) {
    extrasLines.push({
      label: 'Geladeira por dentro',
      amount: 0,
      included: true,
    });
    extrasLines.push({
      label: 'Armários por dentro',
      amount: 0,
      included: true,
    });
  } else {
    if (input.extras.geladeira) {
      extrasTotal += config.extras.geladeira;
      extrasLines.push({
        label: 'Geladeira por dentro',
        amount: config.extras.geladeira,
      });
    }

    if (input.extras.armarios) {
      extrasTotal += config.extras.armarios;
      extrasLines.push({
        label: 'Armários por dentro',
        amount: config.extras.armarios,
      });
    }
  }

  if (input.extras.roupaDeCama) {
    const beds = Math.max(1, Math.round(input.extras.bedCount || 1));
    const cost = beds * config.extras.roupaDeCama;
    extrasTotal += cost;
    extrasLines.push({
      label: `Roupa de cama (${beds} ${beds === 1 ? 'cama' : 'camas'} × $${config.extras.roupaDeCama})`,
      amount: cost,
    });
  }

  // Base da visita principal
  let baseAmount = 0;
  let primaryLabel = '';

  if (input.serviceType === 'recorrente') {
    baseAmount = effectiveTier.primeiraLimpeza;
    primaryLabel = 'Primeira limpeza';
  } else if (input.serviceType === 'primeira_avulsa') {
    baseAmount = effectiveTier.primeiraLimpeza;
    primaryLabel = 'Primeira limpeza avulsa';
  } else if (input.serviceType === 'deep_clean') {
    baseAmount = effectiveTier.deepClean;
    primaryLabel = 'Deep clean';
  } else {
    baseAmount = effectiveTier.deepClean * (1 + config.moveInOutPercent / 100);
    primaryLabel = `Move-in/Move-out (Deep clean + ${config.moveInOutPercent}%)`;
  }

  const conditionAmount = baseAmount * conditionMult;
  const primaryRaw = baseAmount + conditionAmount + petsCost + extrasTotal;
  const primaryTablePrice = roundToNearest5(primaryRaw);
  const promoPercent = parsePromoPercent(input.promoPercent);
  const promoVals = computePromoValues(primaryTablePrice, promoPercent);
  const deepCleanRangeMax = isDeepClean
    ? computeDeepCleanRangeMax(
        promoVals.effectiveDefaultPrimaryPrice,
        config.deepCleanRangeMarginPercent ?? 20
      )
    : null;

  const primaryBreakdown: BreakdownLine[] = [
    {
      label: `Base (${effectiveTier.label})`,
      amount: Number(baseAmount.toFixed(2)),
    },
  ];

  if (conditionAmount > 0) {
    primaryBreakdown.push({
      label: `Estado da casa (+${Math.round(conditionMult * 100)}%)`,
      amount: Number(conditionAmount.toFixed(2)),
    });
  }

  if (petsCost > 0) {
    primaryBreakdown.push({
      label: input.petsOption === 'um' ? 'Pets (1 pet)' : 'Pets (2+ pets)',
      amount: petsCost,
    });
  }

  primaryBreakdown.push(...extrasLines);

  // Quando for Recorrente, calcula também o preço recorrente separado
  if (input.serviceType === 'recorrente') {
    const freqBase = effectiveTier[input.frequency];
    const recurringConditionAmount = freqBase * conditionMult;
    const recurringRaw = freqBase + recurringConditionAmount + petsCost;
    const recurringTablePrice = roundToNearest5(recurringRaw);

    const recurringBreakdown: BreakdownLine[] = [
      {
        label: `Base ${FREQUENCY_LABELS[input.frequency]} (${effectiveTier.label})`,
        amount: freqBase,
      },
    ];

    if (recurringConditionAmount > 0) {
      recurringBreakdown.push({
        label: `Estado da casa (+${Math.round(conditionMult * 100)}%)`,
        amount: Number(recurringConditionAmount.toFixed(2)),
      });
    }

    if (petsCost > 0) {
      recurringBreakdown.push({
        label: input.petsOption === 'um' ? 'Pets (1 pet)' : 'Pets (2+ pets)',
        amount: petsCost,
      });
    }

    const biweeklyTablePrice =
      input.frequency === 'mensal'
        ? roundToNearest5(
            effectiveTier.quinzenal +
              effectiveTier.quinzenal * conditionMult +
              petsCost
          )
        : null;

    return {
      isRecurring: true,
      isVisitaAvulsa: false,
      isDeepCleanScope: false,
      selectedTier,
      effectiveTier,
      tierUpgradedBySqFt,
      sqFtThreshold,
      parsedSqFt,
      primaryTablePrice,
      promoPercent,
      ...promoVals,
      deepCleanRangeMax: null,
      primaryLabel,
      primaryBreakdown,
      recurringTablePrice,
      biweeklyTablePrice,
      recurringLabel: `Recorrente (${FREQUENCY_LABELS[input.frequency]})`,
      recurringBreakdown,
    };
  }

  return {
    isRecurring: false,
    isVisitaAvulsa: false,
    isDeepCleanScope,
    selectedTier,
    effectiveTier,
    tierUpgradedBySqFt,
    sqFtThreshold,
    parsedSqFt,
    primaryTablePrice,
    promoPercent,
    ...promoVals,
    deepCleanRangeMax,
    primaryLabel,
    primaryBreakdown,
    recurringTablePrice: null,
    biweeklyTablePrice: null,
    recurringLabel: null,
    recurringBreakdown: [],
  };
}

export type RecurringPriceStatus =
  | 'not_applicable'
  | 'confirmed'
  | 'derived'
  | 'needs_confirmation';

export interface LeadPricingResolution {
  isRecurring: boolean;
  initialPrice: number;
  tableInitialPrice: number;
  recurringPrice: number | null;
  tableRecurringPrice: number | null;
  recurringStatus: RecurringPriceStatus;
  frequencyLabelPt: string | null;
  biweeklyTablePrice: number | null;
}

function normalizeLabelKey(raw: string | null | undefined): string {
  return (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function findMatchingTierForLead(
  houseLabel: string | null | undefined,
  tiers: HouseTier[]
): HouseTier | null {
  const target = normalizeLabelKey(houseLabel);
  if (!target || tiers.length === 0) return null;

  const exact = tiers.find(
    (t) =>
      normalizeLabelKey(t.label) === target ||
      normalizeLabelKey(t.id) === target
  );
  if (exact) return exact;

  const roomMatch = target.match(/(\d+)\s*quartos?\D+(\d+)\s*(?:\+\s*)?banheiros?/);
  if (roomMatch) {
    const q = Number(roomMatch[1]);
    const b = Number(roomMatch[2]);
    const tierId = mapRoomsToTierId(
      Number.isFinite(q) ? q : null,
      Number.isFinite(b) ? b : null,
      tiers
    );
    if (tierId) {
      return tiers.find((t) => t.id === tierId) ?? null;
    }
  }

  return null;
}

export function resolveLeadPricingSummary(
  lead: Pick<
    LeadQuoteRecord,
    | 'serviceType'
    | 'frequency'
    | 'houseLabel'
    | 'effectiveHouseLabel'
    | 'squareFeet'
    | 'houseCondition'
    | 'petsOption'
    | 'tablePricePrimary'
    | 'finalPricePrimary'
    | 'tablePriceRecurring'
    | 'finalPriceRecurring'
    | 'promoPercent'
    | 'promoName'
  >,
  config: PricingConfig
): LeadPricingResolution {
  const initialPrice = Math.max(0, Number(lead.finalPricePrimary) || 0);
  const tableInitialPrice = Math.max(
    0,
    Number(lead.tablePricePrimary) || initialPrice
  );

  if (lead.serviceType !== 'recorrente') {
    return {
      isRecurring: false,
      initialPrice,
      tableInitialPrice,
      recurringPrice: null,
      tableRecurringPrice: null,
      recurringStatus: 'not_applicable',
      frequencyLabelPt: null,
      biweeklyTablePrice: null,
    };
  }

  const validFrequency =
    lead.frequency === 'semanal' ||
    lead.frequency === 'quinzenal' ||
    lead.frequency === 'mensal'
      ? lead.frequency
      : null;

  const frequencyLabelPt = validFrequency
    ? FREQUENCY_LABELS[validFrequency]
    : null;

  const matchedEffectiveTier = findMatchingTierForLead(
    lead.effectiveHouseLabel,
    config.tiers
  );
  const matchedBaseTier = matchedEffectiveTier
    ? null
    : findMatchingTierForLead(lead.houseLabel, config.tiers);
  const matchedTier = matchedEffectiveTier ?? matchedBaseTier;

  const hasSufficientData = Boolean(
    validFrequency &&
      matchedTier &&
      lead.houseCondition !== null &&
      lead.petsOption !== null
  );

  const derivedCalc =
    hasSufficientData && validFrequency && matchedTier
      ? calculateQuote(
          {
            ...INITIAL_LEAD_STATE,
            squareFeet: matchedEffectiveTier
              ? ''
              : typeof lead.squareFeet === 'number' &&
                Number.isFinite(lead.squareFeet)
              ? String(lead.squareFeet)
              : '',
            selectedTierId: matchedTier.id,
            serviceType: 'recorrente',
            frequency: validFrequency,
            houseCondition: lead.houseCondition!,
            petsOption: lead.petsOption!,
            promoPercent:
              typeof lead.promoPercent === 'number' && lead.promoPercent > 0
                ? String(lead.promoPercent)
                : '',
            promoName: lead.promoName || '',
            dayOption1: config.defaultDayOption1 || 'Tuesday',
            dayOption2: config.defaultDayOption2 || 'Thursday',
          },
          config
        )
      : null;

  const referenceCalc =
    derivedCalc ??
    (matchedTier && validFrequency
      ? calculateQuote(
          {
            ...INITIAL_LEAD_STATE,
            squareFeet: matchedEffectiveTier
              ? ''
              : typeof lead.squareFeet === 'number' &&
                Number.isFinite(lead.squareFeet)
              ? String(lead.squareFeet)
              : '',
            selectedTierId: matchedTier.id,
            serviceType: 'recorrente',
            frequency: validFrequency,
            houseCondition: 'padrao',
            petsOption: 'nenhum',
          },
          config
        )
      : null);

  const storedFinalRecurring =
    typeof lead.finalPriceRecurring === 'number' &&
    Number.isFinite(lead.finalPriceRecurring) &&
    lead.finalPriceRecurring > 0
      ? lead.finalPriceRecurring
      : null;

  const storedTableRecurring =
    typeof lead.tablePriceRecurring === 'number' &&
    Number.isFinite(lead.tablePriceRecurring) &&
    lead.tablePriceRecurring > 0
      ? lead.tablePriceRecurring
      : null;

  // Detecta registro legado que tenha copiado o preço inicial para o recorrente sem tabela recorrente própria
  const engineHasDistinctInitialAndRecurring =
    referenceCalc === null ||
    referenceCalc.recurringTablePrice !== referenceCalc.primaryTablePrice;

  const looksLikeCopiedInitialInFinal =
    storedFinalRecurring !== null &&
    storedTableRecurring === null &&
    storedFinalRecurring === initialPrice &&
    engineHasDistinctInitialAndRecurring;

  const looksLikeCopiedInitialInTable =
    storedTableRecurring !== null &&
    storedTableRecurring === tableInitialPrice &&
    engineHasDistinctInitialAndRecurring;

  if (
    storedFinalRecurring !== null &&
    !looksLikeCopiedInitialInFinal &&
    !looksLikeCopiedInitialInTable
  ) {
    return {
      isRecurring: true,
      initialPrice,
      tableInitialPrice,
      recurringPrice: storedFinalRecurring,
      tableRecurringPrice:
        storedTableRecurring ??
        derivedCalc?.recurringTablePrice ??
        storedFinalRecurring,
      recurringStatus: 'confirmed',
      frequencyLabelPt,
      biweeklyTablePrice: referenceCalc?.biweeklyTablePrice ?? null,
    };
  }

  if (storedTableRecurring !== null && !looksLikeCopiedInitialInTable) {
    return {
      isRecurring: true,
      initialPrice,
      tableInitialPrice,
      recurringPrice: storedTableRecurring,
      tableRecurringPrice: storedTableRecurring,
      recurringStatus: 'confirmed',
      frequencyLabelPt,
      biweeklyTablePrice: referenceCalc?.biweeklyTablePrice ?? null,
    };
  }

  // Registro legado sem preço recorrente confiável salvo: só deriva se TODOS os parâmetros
  // necessários existirem. Nunca trata o preço inicial legado como recorrente nem inventa valor.
  if (
    derivedCalc &&
    derivedCalc.recurringTablePrice !== null &&
    derivedCalc.recurringTablePrice > 0
  ) {
    return {
      isRecurring: true,
      initialPrice,
      tableInitialPrice,
      recurringPrice: derivedCalc.recurringTablePrice,
      tableRecurringPrice: derivedCalc.recurringTablePrice,
      recurringStatus: 'derived',
      frequencyLabelPt,
      biweeklyTablePrice: derivedCalc.biweeklyTablePrice,
    };
  }

  return {
    isRecurring: true,
    initialPrice,
    tableInitialPrice,
    recurringPrice: null,
    tableRecurringPrice: null,
    recurringStatus: 'needs_confirmation',
    frequencyLabelPt,
    biweeklyTablePrice: null,
  };
}

export interface ResolvedLeadPricing {
  isRecurring: boolean;
  initialFinalPrice: number;
  initialTablePrice: number;
  recurringFinalPrice: number | null;
  recurringTablePrice: number | null;
  recurringStatus: 'not_applicable' | 'available' | 'needs_confirmation';
  derivedFromEngine: boolean;
  frequencyLabelPt: string | null;
  biweeklyTablePrice: number | null;
}

export function resolveLeadPricingFromEngine(
  lead: Pick<
    LeadQuoteRecord,
    | 'serviceType'
    | 'frequency'
    | 'houseLabel'
    | 'effectiveHouseLabel'
    | 'squareFeet'
    | 'houseCondition'
    | 'petsOption'
    | 'tablePricePrimary'
    | 'finalPricePrimary'
    | 'tablePriceRecurring'
    | 'finalPriceRecurring'
    | 'promoPercent'
    | 'promoName'
  >,
  config: PricingConfig
): ResolvedLeadPricing {
  const summary = resolveLeadPricingSummary(lead, config);
  const status: ResolvedLeadPricing['recurringStatus'] =
    summary.recurringStatus === 'confirmed' ||
    summary.recurringStatus === 'derived'
      ? 'available'
      : summary.recurringStatus;

  return {
    isRecurring: summary.isRecurring,
    initialFinalPrice: summary.initialPrice,
    initialTablePrice: summary.tableInitialPrice,
    recurringFinalPrice: summary.recurringPrice,
    recurringTablePrice: summary.tableRecurringPrice,
    recurringStatus: status,
    derivedFromEngine: summary.recurringStatus === 'derived',
    frequencyLabelPt: summary.frequencyLabelPt,
    biweeklyTablePrice: summary.biweeklyTablePrice,
  };
}


