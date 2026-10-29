import { emitNotification } from './notification-emitter'

/**
 * Inbox notices of the newsletter digest (newsletter2 nl2-digest-ai).
 * Fire-and-forget like the other `notify*` helpers: they never fail the
 * worker run. They go to the member who set the digest up.
 */

/** A digest draft is waiting for review in the issue editor. */
export function notifyDigestReady(input: {
  workspaceId: string
  newsletterId: string
  newsletterName: string
  issueId: string
  recipientId: string
  items: number
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.recipientId],
    kind: 'CRM_NEWSLETTER_DIGEST_READY',
    title: `Resumo pronto para revisar: ${input.newsletterName}`,
    body: `${input.items} ${input.items === 1 ? 'post novo entrou' : 'posts novos entraram'} no rascunho. Revise e envie quando quiser.`,
    path: `/crm/newsletters/${input.newsletterId}/issues/${input.issueId}`,
    dedupeKey: `crm-newsletter-digest:${input.issueId}:ready`,
  })
}

/** The run produced nothing to send, or the automatic send was refused. */
export function notifyDigestSkipped(input: {
  workspaceId: string
  newsletterId: string
  newsletterName: string
  recipientId: string
  reason: string
  /** Draft left behind when the send was refused. */
  issueId: string | null
  /** Unique per run (dedupe). */
  runKey: string
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.recipientId],
    kind: 'CRM_NEWSLETTER_DIGEST_SKIPPED',
    title: input.issueId
      ? `Resumo não enviado: ${input.newsletterName}`
      : `Resumo pulado: ${input.newsletterName}`,
    body: input.issueId
      ? `${input.reason} O rascunho ficou salvo para você revisar.`
      : input.reason,
    path: input.issueId
      ? `/crm/newsletters/${input.newsletterId}/issues/${input.issueId}`
      : `/crm/newsletters/${input.newsletterId}?aba=resumo`,
    dedupeKey: `crm-newsletter-digest:${input.runKey}:skipped`,
  })
}
