import { ParsedLeadPayload } from '../types/pricing';
import {
  formatOfficialCityName,
  inferConnecticutCityFromZip,
} from './cityFormatter';

interface QAPair {
  question: string;
  answer: string;
}

function extractQAPairs(rawText: string): {
  pairs: QAPair[];
  unmatchedLines: string[];
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const pairs: QAPair[] = [];
  const unmatchedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Formato "Pergunta?: Resposta" ou "Pergunta: Resposta"
    const colonMatch = line.match(/^([^:\n]+?):\s*(.*)$/);
    if (colonMatch) {
      const question = colonMatch[1].trim();
      let answer = colonMatch[2].trim();

      if (!answer && i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (!/^[^:\n]+?:\s*/.test(nextLine) && !/^.+\?\s+/.test(nextLine)) {
          answer = nextLine.trim();
          i++;
        }
      }

      if (answer) {
        pairs.push({ question, answer });
      }
      continue;
    }

    // Formato "Pergunta? Resposta"
    const qMarkMatch = line.match(/^(.+\?)\s+(.+)$/);
    if (qMarkMatch) {
      pairs.push({
        question: qMarkMatch[1].trim(),
        answer: qMarkMatch[2].trim(),
      });
      continue;
    }

    unmatchedLines.push(line);
  }

  return { pairs, unmatchedLines };
}

function parseRoomCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/4\s*\+/i.test(trimmed)) {
    return 4;
  }

  const numMatch = trimmed.match(/\d+/);
  if (!numMatch) return null;
  const val = parseInt(numMatch[0], 10);
  if (!Number.isFinite(val) || val <= 0) return null;
  return val;
}

function parseFrequencyValue(
  raw: string
): ParsedLeadPayload['frequencia'] {
  const lower = raw.toLowerCase();
  if (
    /\b(bi[-\s]?weekly|every\s*(2|two)\s*weeks|quinzenal)\b/.test(lower)
  ) {
    return 'quinzenal';
  }
  if (/\b(weekly|every\s*week|semanal)\b/.test(lower)) {
    return 'semanal';
  }
  if (/\b(monthly|once\s*a\s*month|every\s*month|mensal)\b/.test(lower)) {
    return 'mensal';
  }
  if (
    /\b(one[-\s]?time|just\s*once|single(\s*visit)?|once|avulsa|unica|única)\b/.test(
      lower
    )
  ) {
    return 'unica';
  }
  return 'nao_informado';
}

function extractPromoDetails(
  question: string,
  answer: string
): { active: boolean; percent: number | null; name: string } {
  const combined = `${question} ${answer}`;
  const lowerAnswer = answer.trim().toLowerCase();

  // Se a resposta for explicitamente negativa, não aplica promoção
  if (/^(no|não|nao|none|n\/a)\b/.test(lowerAnswer)) {
    return { active: false, percent: null, name: '' };
  }

  const pctMatch =
    combined.match(/(\d+(?:[.,]\d+)?)\s*%/) ||
    combined.match(/(\d+(?:[.,]\d+)?)\s*percent/i);
  const percent = pctMatch
    ? Math.min(100, Math.max(0, Number(pctMatch[1].replace(',', '.'))))
    : null;

  const hasPromoKeyword =
    /(offer|discount|promo|promocao|promoção|coupon|cupom|off\b|%)/i.test(
      combined
    );

  if (!hasPromoKeyword && percent === null) {
    return { active: false, percent: null, name: '' };
  }

  const isPositiveAnswer =
    percent !== null ||
    /^(yes|sim|yeah|yep|y|true|sure|claim|interested)/i.test(lowerAnswer) ||
    /(off|discount|offer)/i.test(lowerAnswer);

  if (!isPositiveAnswer) {
    return { active: false, percent: null, name: '' };
  }

  const knownEventMatch = combined.match(
    /\b(Thanksgiving|Black\s*Friday|Cyber\s*Monday|Christmas|Holiday|New\s*Year(?:'s)?|Spring|Summer|Fall|Autumn|Winter|Easter|Halloween|Valentine(?:'s)?|Mother'?s\s*Day|Father'?s\s*Day|Memorial\s*Day|Labor\s*Day|First[-\s]?Time)\b/i
  );

  return {
    active: true,
    percent: Number.isFinite(percent) ? percent : null,
    name: knownEventMatch ? knownEventMatch[1] : '',
  };
}

export function parseLeadLocally(rawText: string): {
  payload: ParsedLeadPayload;
  matchedFieldsCount: number;
} {
  const payload: ParsedLeadPayload = {
    nome: '',
    telefone: '',
    email: '',
    zip_code: '',
    cidade: '',
    data_desejada: '',
    melhor_contato: '',
    quartos: null,
    banheiros: null,
    frequencia: 'nao_informado',
    tipo: 'nao_informado',
    promocao: false,
    promocao_percentual: null,
    promocao_nome: '',
    observacoes: '',
  };

  let matchedFieldsCount = 0;
  const matchedKeys = new Set<string>();
  const notesParts: string[] = [];

  const markMatched = (key: string) => {
    if (!matchedKeys.has(key)) {
      matchedKeys.add(key);
      matchedFieldsCount++;
    }
  };

  const { pairs, unmatchedLines } = extractQAPairs(rawText);

  for (const { question, answer } of pairs) {
    const q = question.toLowerCase();

    if (
      /\bfull\s*name\b|\bfirst\s*name\b|\byour\s*name\b|^name\??$|\bnome\b/.test(
        q
      )
    ) {
      payload.nome = answer;
      markMatched('nome');
      continue;
    }

    if (/\bphone\b|\btelefone\b|\bwhatsapp\b|\bmobile\b|\bcell\b/.test(q)) {
      payload.telefone = answer;
      markMatched('telefone');
      continue;
    }

    if (/\be-?mail\b/.test(q)) {
      payload.email = answer;
      markMatched('email');
      continue;
    }

    if (/\bzip(\s*code)?\b|\bpostal\b|\bcep\b/.test(q)) {
      const zipMatch = answer.match(/\b\d{5}\b/);
      const zip = zipMatch ? zipMatch[0] : answer.trim();
      payload.zip_code = zip;
      markMatched('zip_code');

      if (!payload.cidade) {
        const deduced = inferConnecticutCityFromZip(zip);
        if (deduced) {
          payload.cidade = deduced;
        }
      }
      continue;
    }

    if (/\bcity\b|\btown\b|\bcidade\b/.test(q)) {
      payload.cidade = formatOfficialCityName(answer);
      markMatched('cidade');
      continue;
    }

    if (
      /\bwhen\s+do\s+you\s+need\b|\bwhen\s+would\s+you\b|\bpreferred\s+date\b|\bdata(\s+desejada)?\b|\bwhen\b/.test(
        q
      )
    ) {
      payload.data_desejada = answer;
      markMatched('data_desejada');
      continue;
    }

    if (
      /\bbest\s+way\s+to\s+reach\b|\bpreferred\s+contact\b|\bcontact\s+method\b|\bmelhor\s+(forma\s+de\s+)?contato\b/.test(
        q
      )
    ) {
      payload.melhor_contato = answer;
      markMatched('melhor_contato');
      continue;
    }

    if (/\bbathroom|\bbaths\b|\bbanheiro/.test(q)) {
      const baths = parseRoomCount(answer);
      if (baths !== null) {
        payload.banheiros = baths;
        markMatched('banheiros');
      }
      continue;
    }

    if (/\bbedroom|\bbeds\b|\bquarto/.test(q)) {
      const beds = parseRoomCount(answer);
      if (beds !== null) {
        payload.quartos = beds;
        markMatched('quartos');
      }
      continue;
    }

    if (/\bhow\s+often\b|\bfrequency\b|\bfrequencia|\bfrequência/.test(q)) {
      const freq = parseFrequencyValue(answer);
      if (freq !== 'nao_informado') {
        payload.frequencia = freq;
        markMatched('frequencia');
        if (
          payload.tipo === 'nao_informado' &&
          (freq === 'semanal' || freq === 'quinzenal' || freq === 'mensal')
        ) {
          payload.tipo = 'recorrente';
        }
      }
      continue;
    }

    if (/\bdeep\s*clean(ing)?\b/.test(q)) {
      if (/^(yes|sim|yeah|yep|y|true|sure)\b/i.test(answer)) {
        payload.tipo = 'deep_clean';
        markMatched('tipo');
      } else if (/^(no|não|nao)\b/i.test(answer)) {
        // Explicit "No" still indicates the question was answered
        markMatched('deep_clean_answered');
      }
      continue;
    }

    if (/\bmove[-\s]*(in|out)\b/.test(q)) {
      if (/^(yes|sim|yeah|yep|y|true)\b/i.test(answer)) {
        payload.tipo = 'move_in_out';
        markMatched('tipo');
      }
      continue;
    }

    if (/(offer|discount|promo|cupom|%)/i.test(`${question} ${answer}`)) {
      const promo = extractPromoDetails(question, answer);
      if (promo.active) {
        payload.promocao = true;
        payload.promocao_percentual = promo.percent;
        payload.promocao_nome = promo.name;
        markMatched('promocao');
      } else if (/^(no|não|nao|none)\b/i.test(answer)) {
        markMatched('promocao_answered');
      }
      continue;
    }

    // Outras perguntas/observações da cliente
    notesParts.push(`${question}: ${answer}`);
  }

  // Varredura complementar em texto livre para campos ainda vazios (útil também como alternativa se a IA estiver indisponível)
  const textNorm = rawText.trim();
  if (!payload.email) {
    const emailMatch = textNorm.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      payload.email = emailMatch[0];
      markMatched('email');
    }
  }

  if (!payload.telefone) {
    const phoneMatch = textNorm.match(
      /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/
    );
    if (phoneMatch) {
      payload.telefone = phoneMatch[0].trim();
      markMatched('telefone');
    }
  }

  if (!payload.zip_code) {
    const zipMatch = textNorm.match(/\b(06\d{3})\b/);
    if (zipMatch) {
      payload.zip_code = zipMatch[1];
      markMatched('zip_code');
      if (!payload.cidade) {
        const deduced = inferConnecticutCityFromZip(zipMatch[1]);
        if (deduced) {
          payload.cidade = deduced;
        }
      }
    }
  }

  if (payload.quartos === null) {
    const bedMatch = textNorm.match(
      /\b(\d+\+?)\s*(?:bed(?:room)?s?|bd|br|quartos?)\b/i
    );
    if (bedMatch) {
      const beds = parseRoomCount(bedMatch[1]);
      if (beds !== null) {
        payload.quartos = beds;
        markMatched('quartos');
      }
    }
  }

  if (payload.banheiros === null) {
    const bathMatch = textNorm.match(
      /\b(\d+(?:[.,]5)?\+?)\s*(?:bath(?:room)?s?|ba|banheiros?)\b/i
    );
    if (bathMatch) {
      const baths = parseRoomCount(bathMatch[1]);
      if (baths !== null) {
        payload.banheiros = baths;
        markMatched('banheiros');
      }
    }
  }

  if (payload.tipo === 'nao_informado') {
    if (/\bmove[-\s]*(?:in|out)\b/i.test(textNorm)) {
      payload.tipo = 'move_in_out';
      markMatched('tipo');
    } else if (/\bdeep\s*clean(?:ing)?\b/i.test(textNorm)) {
      payload.tipo = 'deep_clean';
      markMatched('tipo');
    }
  }

  if (payload.frequencia === 'nao_informado') {
    const freeFreq = parseFrequencyValue(textNorm);
    if (freeFreq !== 'nao_informado') {
      payload.frequencia = freeFreq;
      markMatched('frequencia');
      if (
        payload.tipo === 'nao_informado' &&
        (freeFreq === 'semanal' || freeFreq === 'quinzenal' || freeFreq === 'mensal')
      ) {
        payload.tipo = 'recorrente';
      }
    }
  }

  if (!payload.nome) {
    const nameMatch = textNorm.match(
      /(?:my\s+name\s+is|i'?m|meu\s+nome\s+[eé])\s+([A-ZÀ-ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zà-ÿ]+)?)/i
    );
    if (nameMatch) {
      payload.nome = nameMatch[1].trim();
      markMatched('nome');
    }
  }

  // Varredura extra para menção de promoção/desconto em linhas soltas ou se ainda não detectada
  if (!payload.promocao) {
    const promo = extractPromoDetails('', rawText);
    if (promo.active && promo.percent !== null) {
      payload.promocao = true;
      payload.promocao_percentual = promo.percent;
      payload.promocao_nome = promo.name;
      markMatched('promocao');
    }
  }

  if (unmatchedLines.length > 0 && pairs.length > 0) {
    notesParts.push(...unmatchedLines);
  }

  if (notesParts.length > 0) {
    payload.observacoes = notesParts.join(' | ');
  }

  return { payload, matchedFieldsCount };
}
