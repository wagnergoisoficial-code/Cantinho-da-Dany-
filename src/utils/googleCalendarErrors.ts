/**
 * Traduz erros técnicos do Firebase / Google Calendar em mensagens que
 * explicam o que aconteceu e o que fazer.
 */

export class GoogleCalendarUserError extends Error {
  /** true quando o usuário só fechou a janela: não precisa mostrar nada. */
  readonly silent: boolean;
  readonly code: string;

  constructor(message: string, code: string, silent = false) {
    super(message);
    this.name = 'GoogleCalendarUserError';
    this.code = code;
    this.silent = silent;
  }
}

function currentHost(): string {
  try {
    return window.location.hostname || 'este endereço';
  } catch {
    return 'este endereço';
  }
}

function extractCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  const message = error instanceof Error ? error.message : String(error || '');
  const match = message.match(/auth\/[a-z-]+/i);
  return match ? match[0] : '';
}

export function friendlyGoogleAuthError(error: unknown): GoogleCalendarUserError {
  if (error instanceof GoogleCalendarUserError) return error;
  const code = extractCode(error);

  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return new GoogleCalendarUserError(
        'A conexão com a agenda foi cancelada.',
        code,
        true
      );
    case 'auth/unauthorized-domain':
      return new GoogleCalendarUserError(
        `Este endereço do app (${currentHost()}) ainda não está liberado para entrar com o Google. ` +
          'Quem administra o app precisa adicioná-lo no Firebase em Authentication > Configurações > Domínios autorizados.',
        code
      );
    case 'auth/popup-blocked':
      return new GoogleCalendarUserError(
        'O navegador bloqueou a janela do Google. Permita pop-ups para este site e toque em Conectar de novo.',
        code
      );
    case 'auth/operation-not-supported-in-this-environment':
    case 'auth/web-storage-unsupported':
      return new GoogleCalendarUserError(
        'Este navegador não permite entrar com o Google. Abra o app direto no Chrome ou no Safari (não pelo navegador do WhatsApp ou Instagram) e tente de novo.',
        code
      );
    case 'auth/network-request-failed':
      return new GoogleCalendarUserError(
        'Sem conexão com a internet. Verifique o Wi-Fi ou os dados móveis e tente de novo.',
        code
      );
    case 'auth/user-mismatch':
      return new GoogleCalendarUserError(
        'Você escolheu outra conta do Google. Use a mesma conta conectada antes, ou toque em Sair e conecte a conta nova.',
        code
      );
    case 'auth/operation-not-allowed':
      return new GoogleCalendarUserError(
        'O login com Google está desligado no Firebase. Quem administra o app precisa ativá-lo em Authentication > Método de login > Google.',
        code
      );
    case 'auth/too-many-requests':
      return new GoogleCalendarUserError(
        'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
        code
      );
    case 'auth/internal-error':
      return new GoogleCalendarUserError(
        'O Google recusou a conexão. Se apareceu "Acesso bloqueado", a conta precisa estar na lista de usuários de teste do app no Google Cloud.',
        code
      );
    default: {
      const message = error instanceof Error ? error.message : '';
      return new GoogleCalendarUserError(
        message && !/firebase|auth\//i.test(message)
          ? message
          : 'Não foi possível conectar ao Google Agenda. Tente de novo em instantes.',
        code || 'unknown'
      );
    }
  }
}

interface GoogleApiErrorBody {
  error?: {
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

export function friendlyCalendarApiError(
  status: number,
  body: GoogleApiErrorBody
): Error {
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  const raw = body?.error?.message || '';

  if (status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(raw)) {
      return new GoogleCalendarUserError(
        'A API do Google Agenda está desligada no projeto do app. Quem administra precisa ativá-la no Google Cloud (APIs e serviços > Google Calendar API > Ativar).',
        'calendar/api-disabled'
      );
    }
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/i.test(reason) || /insufficient/i.test(raw)) {
      return new GoogleCalendarUserError(
        'Faltou permissão para a agenda. Toque em Sair, conecte de novo e deixe marcadas as opções do Google Agenda.',
        'calendar/insufficient-scope'
      );
    }
    if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reason)) {
      return new GoogleCalendarUserError(
        'O Google Agenda pediu para ir mais devagar. Espere um minuto e tente de novo.',
        'calendar/rate-limit'
      );
    }
    return new GoogleCalendarUserError(
      'Esta conta não tem permissão para mexer nesta agenda. Escolha outra agenda ou peça acesso de edição ao dono.',
      'calendar/forbidden'
    );
  }
  if (status === 404) {
    return new GoogleCalendarUserError(
      'Agenda ou evento não encontrado. Ele pode ter sido apagado. Toque em Atualizar.',
      'calendar/not-found'
    );
  }
  if (status === 429) {
    return new GoogleCalendarUserError(
      'Muitas ações seguidas na agenda. Espere um minuto e tente de novo.',
      'calendar/rate-limit'
    );
  }
  if (status >= 500) {
    return new GoogleCalendarUserError(
      'O Google Agenda está instável agora. Tente de novo em alguns minutos.',
      'calendar/server-error'
    );
  }
  return new GoogleCalendarUserError(
    'Não foi possível salvar na agenda. Confira data e horário e tente de novo.',
    `calendar/http-${status}`
  );
}

export function friendlyNetworkError(): GoogleCalendarUserError {
  return new GoogleCalendarUserError(
    'Sem conexão com o Google Agenda. Verifique a internet e tente de novo.',
    'calendar/network'
  );
}
