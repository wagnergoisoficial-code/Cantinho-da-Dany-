// Token mantido apenas em memória React/JS (nunca em localStorage/sessionStorage).
// O cookie HttpOnly assinado pelo servidor persiste no dispositivo entre recarregamentos.
let memoryBearerToken: string | null = null;
let onUnauthorizedCallback: (() => void) | null = null;

export function setMemoryAuthToken(token: string | null): void {
  memoryBearerToken = token;
}

export function setOnUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorizedCallback = handler;
}

export async function apiFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', 'DanyCleanPro');
  if (memoryBearerToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${memoryBearerToken}`);
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && onUnauthorizedCallback) {
    onUnauthorizedCallback();
  }

  return response;
}
