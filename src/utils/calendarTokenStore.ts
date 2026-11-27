import { GoogleAuthProvider, type UserCredential } from 'firebase/auth';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

// In-memory only OAuth access token storage (never persisted to localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

function notifyTokenListeners(token: string | null): void {
  for (const listener of tokenListeners) {
    try {
      listener(token);
    } catch {
      // Ignore individual subscriber errors
    }
  }
}

export function getGoogleCalendarAccessToken(): string | null {
  return cachedAccessToken;
}

export function setGoogleCalendarAccessToken(token: string | null): void {
  const normalized = token && token.trim() ? token.trim() : null;
  if (cachedAccessToken === normalized) return;
  cachedAccessToken = normalized;
  notifyTokenListeners(cachedAccessToken);
}

export function clearGoogleCalendarAccessToken(): void {
  setGoogleCalendarAccessToken(null);
}

export function subscribeGoogleCalendarAccessToken(
  listener: (token: string | null) => void
): () => void {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

export function extractGoogleOAuthAccessToken(
  result: UserCredential
): string | null {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const fallbackToken =
    typeof result === 'object' &&
    result !== null &&
    '_tokenResponse' in result
      ? (
          result as {
            _tokenResponse?: { oauthAccessToken?: string };
          }
        )._tokenResponse?.oauthAccessToken
      : undefined;

  const token = credential?.accessToken || fallbackToken || null;
  return token && token.trim() ? token.trim() : null;
}
