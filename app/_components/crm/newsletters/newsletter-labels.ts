import type {
  CrmNewsletterSubscriberSourceValue,
  CrmNewsletterSubscriberStatusValue,
} from '@/src/schemas/crm-newsletter.schema'

/** Every date of the newsletter screens is shown in São Paulo time. */
export const NEWSLETTER_TIMEZONE = 'America/Sao_Paulo'

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: NEWSLETTER_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: NEWSLETTER_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatNewsletterDate(value: string | null): string {
  return value ? dateFormat.format(new Date(value)) : '—'
}

export function formatNewsletterDateTime(value: string | null): string {
  return value ? dateTimeFormat.format(new Date(value)) : '—'
}

export const SUBSCRIBER_STATUS_LABEL: Record<
  CrmNewsletterSubscriberStatusValue,
  string
> = {
  PENDING: 'Aguardando confirmação',
  ACTIVE: 'Ativo',
  UNSUBSCRIBED: 'Descadastrado',
  BOUNCED: 'Retorno permanente',
  COMPLAINED: 'Marcou como spam',
}

export const SUBSCRIBER_STATUS_VARIANT: Record<
  CrmNewsletterSubscriberStatusValue,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING: 'outline',
  ACTIVE: 'secondary',
  UNSUBSCRIBED: 'outline',
  BOUNCED: 'destructive',
  COMPLAINED: 'destructive',
}

export const SUBSCRIBER_SOURCE_LABEL: Record<
  CrmNewsletterSubscriberSourceValue,
  string
> = {
  FORM: 'Formulário',
  SITE: 'Site',
  PUBLIC_PAGE: 'Página pública',
  API: 'API',
  IMPORT: 'Importação',
  MANUAL: 'Manual',
}

export const NEWSLETTER_LEGAL_BASIS_LABEL = {
  CONSENT: 'Consentimento do titular',
  LEGITIMATE_INTEREST: 'Legítimo interesse',
  CONTRACT: 'Execução de contrato',
} as const
