import { getCurrentFirebaseIdToken } from './firebaseClient';

let onUnauthorizedCallback: (() => void) | null = null;

export function setOnUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorizedCallback = handler;
}

export async function apiFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const buildHeaders = async (tokenOverride?: string | null) => {
    const headers = new Headers(init.headers);
    headers.set('X-Requested-With', 'DanyCleanPro');
    if (!headers.has('Authorization')) {
      const token =
        tokenOverride !== undefined
          ? tokenOverride
          : await getCurrentFirebaseIdToken(false);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }
    return headers;
  };

  let response = await fetch(input, {
    ...init,
    headers: await buildHeaders(),
  });

  if (response.status === 401) {
    const refreshedToken = await getCurrentFirebaseIdToken(true);
    if (refreshedToken) {
      response = await fetch(input, {
        ...init,
        headers: await buildHeaders(refreshedToken),
      });
    }
  }

  if (response.status === 401 && onUnauthorizedCallback) {
    onUnauthorizedCallback();
  }

  return response;
}
