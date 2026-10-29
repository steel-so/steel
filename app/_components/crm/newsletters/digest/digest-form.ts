import type {
  CrmNewsletterDigestDTO,
  CrmNewsletterDigestOutcome,
  UpsertCrmNewsletterDigestDTO,
} from '@/src/schemas/crm-newsletter-digest.schema'
import { CRM_NEWSLETTER_DIGEST_DEFAULT_SUBJECT } from '@/src/schemas/crm-newsletter-digest.schema'

/** Form state of the "Resumo automático" tab (strings for the inputs). */
export type DigestForm = {
  enabled: boolean
  siteId: string
  rssUrl: string
  cadence: 'WEEKLY' | 'MONTHLY'
  weekday: string
  monthDay: string
  hour: string
  mode: 'DRAFT' | 'AUTO_SEND'
  maxItems: string
  subject: string
  intro: string
}

export const NO_SITE = 'NONE'

export const WEEKDAY_LABELS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]

export const OUTCOME_LABEL: Record<CrmNewsletterDigestOutcome, string> = {
  DRAFT_CREATED: 'Rascunho criado',
  SENT: 'Enviado',
  SKIPPED: 'Pulado',
  FAILED: 'Não enviado',
}

export function digestFormOf(
  digest: CrmNewsletterDigestDTO | null,
): DigestForm {
  return {
    enabled: digest?.enabled ?? true,
    siteId: digest?.siteId ?? NO_SITE,
    rssUrl: digest?.rssUrl ?? '',
    cadence: digest?.cadence ?? 'WEEKLY',
    weekday: String(digest?.weekday ?? 1),
    monthDay: String(digest?.monthDay ?? 1),
    hour: String(digest?.hour ?? 9),
    mode: digest?.mode ?? 'DRAFT',
    maxItems: String(digest?.maxItems ?? 5),
    subject: digest?.subject ?? CRM_NEWSLETTER_DIGEST_DEFAULT_SUBJECT,
    intro: digest?.intro ?? '',
  }
}

/** Form → PUT body (validated again by the API). */
export function digestPayloadOf(
  form: DigestForm,
): UpsertCrmNewsletterDigestDTO {
  const weekly = form.cadence === 'WEEKLY'
  return {
    enabled: form.enabled,
    siteId: form.siteId === NO_SITE ? null : form.siteId,
    rssUrl: form.rssUrl.trim() || null,
    cadence: form.cadence,
    weekday: weekly ? Number(form.weekday) : null,
    monthDay: weekly ? null : Number(form.monthDay),
    hour: Number(form.hour),
    mode: form.mode,
    maxItems: Number(form.maxItems),
    subject: form.subject.trim(),
    intro: form.intro.trim() || null,
  }
}

/** "Toda segunda-feira às 9h" / "Todo dia 1 às 9h" (São Paulo). */
export function cadenceSummary(form: DigestForm): string {
  const hour = `${Number(form.hour)}h`
  if (form.cadence === 'WEEKLY') {
    const day = WEEKDAY_LABELS[Number(form.weekday)] ?? ''
    const article =
      Number(form.weekday) === 0 || Number(form.weekday) === 6 ? 'Todo' : 'Toda'
    return `${article} ${day.toLowerCase()} às ${hour} (horário de Brasília)`
  }
  return `Todo dia ${Number(form.monthDay)} do mês às ${hour} (horário de Brasília)`
}
