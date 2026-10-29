import { emitNotification, workspaceAdminIds } from './notification-emitter'

/**
 * Inbox notices of the CRM newsletter (ADR 0054). Fire-and-forget like the
 * other `notify*` helpers: they never fail the send flow.
 */

const count = (value: number) => value.toLocaleString('pt-BR')

/** The issue finished: tells its creator how it went. */
export function notifyNewsletterIssueFinished(input: {
  workspaceId: string
  newsletterId: string
  issueId: string
  createdById: string
  subject: string
  status: 'SENT' | 'FAILED' | 'CANCELED'
  sent: number
  failed: number
}): Promise<number> {
  const title =
    input.status === 'SENT'
      ? `Edição enviada: ${input.subject}`
      : input.status === 'FAILED'
        ? `Falha no envio da edição: ${input.subject}`
        : `Envio interrompido: ${input.subject}`
  const body =
    input.status === 'FAILED'
      ? `Nenhum e-mail saiu (${count(input.failed)} com erro). Abra o relatório para ver o motivo.`
      : `${count(input.sent)} e-mails enviados${input.failed > 0 ? `, ${count(input.failed)} com erro` : ''}. Acompanhe aberturas e cliques no relatório.`
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.createdById],
    kind: 'CRM_NEWSLETTER_ISSUE_FINISHED',
    title,
    body,
    path: `/crm/newsletters/${input.newsletterId}/issues/${input.issueId}/report`,
    dedupeKey: `crm-newsletter-issue:${input.issueId}:finished`,
  })
}

/** Monthly quota crossed 50/80/100 % — once per month and threshold. */
export async function notifyNewsletterUsage(input: {
  workspaceId: string
  /** `YYYY-MM` (São Paulo). */
  month: string
  threshold: number
  used: number
  limit: number
}): Promise<number> {
  const reached = input.threshold >= 100
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: await workspaceAdminIds(input.workspaceId),
    kind: reached
      ? 'CRM_NEWSLETTER_USAGE_LIMIT_REACHED'
      : 'CRM_NEWSLETTER_USAGE_WARNING',
    title: reached
      ? 'Newsletter: limite mensal de e-mails atingido'
      : `Newsletter: ${input.threshold}% do limite mensal de e-mails`,
    body: reached
      ? `${count(input.used)} de ${count(input.limit)} e-mails enviados neste mês. Novos envios ficam bloqueados até o próximo mês ou até o limite ser ajustado.`
      : `${count(input.used)} de ${count(input.limit)} e-mails de newsletter enviados neste mês.`,
    path: '/crm/newsletters',
    dedupeKey: `crm-newsletter-usage:${input.workspaceId}:${input.month}:${input.threshold}`,
  })
}
