import {
  BreakdownLine,
  HouseCondition,
  HouseTier,
  LeadInputState,
  PetsOption,
  PriceCalculationResult,
  PricingConfig,
} from '../types/pricing';
import {
  FREQUENCY_LABELS,
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
