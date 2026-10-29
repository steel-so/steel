import { emitNotification } from './notification-emitter'

/**
 * Inbox notices of the newsletter automation (slice nl2-automation).
 * Fire-and-forget like the other `notify*` helpers.
 */

const count = (value: number) => value.toLocaleString('pt-BR')
const plural = (value: number, one: string, many: string) =>
  `${count(value)} ${value === 1 ? one : many}`

/**
 * Re-engagement summary for the newsletter creator: after the monthly
 * e-mails went out (`sent`) or after a grace period ended (`resolved`).
 */
export function notifyNewsletterReengagementSummary(input: {
  workspaceId: string
  newsletterId: string
  newsletterName: string
  createdById: string
  /** Distinguishes runs (cycle `YYYY-MM` or the day `YYYY-MM-DD`). */
  runKey: string
  phase: 'sent' | 'resolved'
  sent?: number
  reengaged?: number
  unsubscribed?: number
  flagged?: number
}): Promise<number> {
  let title: string
  let body: string
  if (input.phase === 'sent') {
    title = `Reengajamento enviado: ${input.newsletterName}`
    body = `${plural(input.sent ?? 0, 'assinante inativo recebeu', 'assinantes inativos receberam')} o e-mail "Quero continuar recebendo".`
  } else {
    title = `Resultado do reengajamento: ${input.newsletterName}`
    const parts = [
      `${plural(input.reengaged ?? 0, 'assinante voltou', 'assinantes voltaram')} a interagir`,
    ]
    if (input.unsubscribed) {
      parts.push(
        `${plural(input.unsubscribed, 'foi descadastrado', 'foram descadastrados')} por inatividade`,
      )
    }
    if (input.flagged) {
      parts.push(
        `${plural(input.flagged, 'foi marcado', 'foram marcados')} como inativo${input.flagged === 1 ? '' : 's'}`,
      )
    }
    body = `${parts.join('; ')}.`
  }
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.createdById],
    kind: 'CRM_NEWSLETTER_REENGAGEMENT_SUMMARY',
    title,
    body,
    path: `/crm/newsletters/${input.newsletterId}?aba=configuracoes`,
    dedupeKey: `crm-newsletter-reengagement:${input.newsletterId}:${input.phase}:${input.runKey}`,
  })
}
