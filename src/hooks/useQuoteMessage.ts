import {
  CityFixedDayRule,
  LeadInputState,
  PriceCalculationResult,
} from '../types/pricing';
import { buildQuoteMessages, countWords } from '../utils/messageBuilder';
import {
  validateNegotiationCompliance,
  validateSimplePunctuation,
} from '../utils/negotiationEngine';

interface UseQuoteMessageArgs {
  input: LeadInputState;
  calc: PriceCalculationResult;
  finalPrimaryPrice: number;
  finalRecurringPrice: number | null;
  deepCleanRangeMarginPercent: number;
  servedCities: string[];
  cityFixedDays: CityFixedDayRule[];
}

/**
 * Gera a mensagem pronta e as checagens antes de enviar.
 * Usado pela tela rápida e pela Camada 4, para as duas mostrarem
 * exatamente o mesmo texto e as mesmas regras de bloqueio.
 */
export function useQuoteMessage({
  input,
  calc,
  finalPrimaryPrice,
  finalRecurringPrice,
  deepCleanRangeMarginPercent,
  servedCities,
  cityFixedDays,
}: UseQuoteMessageArgs) {
  const missingName = !input.clientName.trim();
  const missingOrigin = !input.origin;
  const missingCity = !input.city.trim();

  const { english, portuguese } = buildQuoteMessages(
    input,
    calc,
    finalPrimaryPrice,
    finalRecurringPrice,
    deepCleanRangeMarginPercent,
    servedCities,
    new Date(),
    cityFixedDays
  );

  const wordCount = countWords(english);
  const compliance = validateNegotiationCompliance(english);
  const ptPunctuationIssues = validateSimplePunctuation(portuguese);
  const allViolations = Array.from(
    new Set([...compliance.violations, ...ptPunctuationIssues])
  );

  const missingFieldAlerts: string[] = [];
  if (missingName) missingFieldAlerts.push('Preencha o nome');
  if (missingOrigin) missingFieldAlerts.push('Preencha a origem');
  if (missingCity) missingFieldAlerts.push('Preencha a cidade');

  const copyBlocked =
    missingName || missingOrigin || missingCity || allViolations.length > 0;

  return {
    english,
    portuguese,
    wordCount,
    allViolations,
    missingName,
    missingOrigin,
    missingCity,
    missingFieldAlerts,
    copyBlocked,
  };
}

/** Copia texto com fallback para navegadores sem Clipboard API. */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * Converte o telefone do lead para o formato internacional só com dígitos.
 * Números de 10 dígitos são tratados como EUA/Canadá (+1).
 */
export function toInternationalDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

export function buildWhatsAppLink(phone: string, text: string): string {
  const number = toInternationalDigits(phone);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function buildSmsLink(phone: string, text: string): string {
  const number = toInternationalDigits(phone);
  // "?&body=" funciona tanto no iPhone quanto no Android
  return `sms:${number ? `+${number}` : ''}?&body=${encodeURIComponent(text)}`;
}
