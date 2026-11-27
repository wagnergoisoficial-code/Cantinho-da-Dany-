/**
 * Tempo e distância de carro pelo Google Maps (Routes API), via servidor.
 *
 * Para gastar o mínimo:
 * - só é chamado quando a cidade/endereço do cliente já foi reconhecido;
 * - só para os poucos dias sugeridos + a casa (no máximo 8 origens);
 * - cada par "origem → cliente" fica guardado neste aparelho por 30 dias,
 *   e o servidor também guarda, então o mesmo par não é cobrado de novo.
 * A chave do Maps fica só no servidor.
 */
import { apiFetch } from './apiClient';

export interface DriveLeg {
  ok: boolean;
  miles: number | null;
  minutes: number | null;
}

export type DriveTimesStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'sem-chave'
  | 'erro-maps';

const STORAGE_KEY = 'danyclean_drive_times_v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

type StoredLeg = DriveLeg & { at: number };

function normalize(address: string): string {
  return address.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function driveKey(origin: string, destination: string): string {
  return `${normalize(origin).toLowerCase()}|${normalize(destination).toLowerCase()}`;
}

/** "Norwalk" vira "Norwalk, CT" para o Maps não achar outra cidade. */
export function withRegion(address: string): string {
  const clean = normalize(address);
  if (!clean) return '';
  if (/\b(CT|NY|Connecticut|New York)\b/i.test(clean) || /\b\d{5}\b/.test(clean)) {
    return clean;
  }
  return `${clean}, CT`;
}

export function buildLeadAddress(input: {
  streetAddress?: string | null;
  city?: string | null;
  zipCode?: string | null;
}): string {
  const parts = [input.streetAddress, input.city, input.zipCode]
    .map((p) => (p || '').trim())
    .filter(Boolean);
  return parts.length ? withRegion(parts.join(', ')) : '';
}

function readStore(): Record<string, StoredLeg> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, StoredLeg>): void {
  try {
    const entries = Object.entries(store)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Sem espaço: segue sem cache local.
  }
}

export function getCachedDriveLeg(origin: string, destination: string): DriveLeg | null {
  const hit = readStore()[driveKey(origin, destination)];
  if (!hit || Date.now() - hit.at > TTL_MS) return null;
  return { ok: hit.ok, miles: hit.miles, minutes: hit.minutes };
}

/**
 * Busca no servidor só os pares que ainda não estão no cache local.
 * Devolve o mapa "chave do par → resultado" e o estado do Maps.
 */
export async function fetchDriveTimes(
  origins: string[],
  destination: string
): Promise<{ status: DriveTimesStatus; legs: Map<string, DriveLeg> }> {
  const legs = new Map<string, DriveLeg>();
  const dest = normalize(destination);
  const unique = Array.from(new Set(origins.map(normalize).filter(Boolean)));
  const missing: string[] = [];
  for (const origin of unique) {
    const cached = getCachedDriveLeg(origin, dest);
    if (cached) legs.set(driveKey(origin, dest), cached);
    else missing.push(origin);
  }
  if (!dest || missing.length === 0) return { status: 'ok', legs };

  try {
    const resp = await apiFetch('/api/maps/drive-times', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origins: missing.slice(0, 8), destination: dest }),
    });
    if (!resp.ok) return { status: 'erro-maps', legs };
    const data = (await resp.json()) as {
      mapsAvailable?: boolean;
      reason?: string;
      results?: Array<DriveLeg & { origin: string; destination: string }>;
    };
    const store = readStore();
    const now = Date.now();
    for (const r of data.results || []) {
      const key = driveKey(r.origin, dest);
      const leg = { ok: !!r.ok, miles: r.miles ?? null, minutes: r.minutes ?? null };
      legs.set(key, leg);
      store[key] = { ...leg, at: now };
    }
    writeStore(store);
    if (!data.mapsAvailable) {
      return { status: data.reason === 'sem-chave' ? 'sem-chave' : 'erro-maps', legs };
    }
    return { status: 'ok', legs };
  } catch {
    return { status: 'erro-maps', legs };
  }
}

/** "12,4 milhas, 22 min" */
export function formatDriveLeg(leg: DriveLeg): string {
  if (!leg.ok || leg.miles === null || leg.minutes === null) return '';
  const miles = leg.miles.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const unit = leg.miles === 1 ? 'milha' : 'milhas';
  const h = Math.floor(leg.minutes / 60);
  const m = leg.minutes % 60;
  const time = h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${leg.minutes} min`;
  return `${miles} ${unit}, ${time} de carro`;
}
