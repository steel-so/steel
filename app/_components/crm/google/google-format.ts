const numberFormat = new Intl.NumberFormat('pt-BR')
const decimalFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatInt = (value: number) => numberFormat.format(value)
export const formatRating = (value: number) => decimalFormat.format(value)
export const formatDate = (iso: string) => dateFormat.format(new Date(iso))
export const formatDateTime = (iso: string) =>
  dateTimeFormat.format(new Date(iso))

/** Variation in % against the previous window; `null` when it has no base. */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

/** Messages for the `?google=error&reason=<code>` the OAuth callback adds. */
export const GOOGLE_CALLBACK_ERRORS: Record<string, string> = {
  access_denied: 'Você cancelou a autorização no Google.',
  missing_params:
    'O Google não devolveu os dados da autorização. Tente de novo.',
  CRM_SOCIAL_STATE_INVALID:
    'A autorização expirou ou é inválida. Comece a conexão de novo.',
  CRM_SOCIAL_SCOPE_MISSING:
    'A permissão do Google Meu Negócio não foi concedida. Marque todas as caixas na tela do Google e tente de novo.',
  CRM_SOCIAL_NOT_CONFIGURED:
    'A integração com o Google ainda não está configurada neste ambiente.',
  CRM_SOCIAL_OAUTH_FAILED: 'Não foi possível concluir a conexão com o Google.',
  FORBIDDEN: 'Você não tem permissão para conectar o Google neste workspace.',
}

export function connectUrl(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/crm/google/connect`
}
