/**
 * Client side of `POST /api/newsletters/subscribe` (owned by nl-core, body
 * `PublicNewsletterSubscribeSchema`), shared by the archive's subscribe
 * form. Pure: no fetch here, so it is unit-tested on its own. The Sites
 * runtime script (`SITE_NEWSLETTER_SCRIPT`) mirrors the same rules.
 */

export const NEWSLETTER_SUBSCRIBE_ENDPOINT = '/api/newsletters/subscribe'

export type NewsletterSubscribeOutcome =
  | { ok: true; pending: boolean }
  | { ok: false; message: string }

const GENERIC_ERROR = 'Não foi possível concluir a inscrição. Tente novamente.'
const RATE_LIMITED =
  'Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.'

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Reads the `{ success, data | error }` envelope. "Confira seu e-mail"
 * (`pending`) comes from the answer when it says so — `requiresConfirmation`
 * or `status: 'PENDING' | 'ACTIVE'` — and otherwise from the newsletter's
 * double opt-in setting. The public answer is the same for addresses that
 * cannot be subscribed, so the form never reveals anything either.
 */
export function parseSubscribeResponse(
  status: number,
  body: unknown,
  doubleOptIn: boolean,
): NewsletterSubscribeOutcome {
  const json = record(body)
  if (status >= 200 && status < 300 && json?.success === true) {
    const data = record(json.data)
    if (typeof data?.requiresConfirmation === 'boolean') {
      return { ok: true, pending: data.requiresConfirmation }
    }
    if (data?.status === 'PENDING' || data?.status === 'ACTIVE') {
      return { ok: true, pending: data.status === 'PENDING' }
    }
    return { ok: true, pending: doubleOptIn }
  }
  if (status === 429) return { ok: false, message: RATE_LIMITED }
  const error = record(json?.error)
  const message =
    (typeof error?.message === 'string' && error.message) ||
    (typeof json?.message === 'string' && json.message) ||
    ''
  // Validation messages are pt-BR and safe to show; anything else is not.
  return {
    ok: false,
    message: status === 400 && message ? message : GENERIC_ERROR,
  }
}

export const NEWSLETTER_SUCCESS_COPY = {
  pending: {
    title: 'Confira seu e-mail',
    body: 'Enviamos um link para confirmar a inscrição. Se não aparecer em alguns minutos, olhe o spam ou as promoções.',
  },
  active: {
    title: 'Inscrição feita',
    body: 'Pronto! As próximas edições chegam no seu e-mail.',
  },
} as const
