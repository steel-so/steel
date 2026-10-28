import 'server-only'
import type { CreateBatchEmailOptions } from 'resend'
import { logger } from '@/lib/axiom/logger'
import { NODE_ENV } from '@/lib/env/env'
import { MAIL_DRY_RUN } from '@/lib/env/server'
import { resend } from '@/src/lib/mail/client'

/**
 * Bulk sending through the Resend batch API (up to 100 e-mails per call),
 * used by the CRM newsletter (ADR 0054). Same dry-run rules as `sendEmail`:
 * `MAIL_DRY_RUN=true`, `NODE_ENV=test` and test recipients (`@example.*`,
 * `*.test`) never leave — they get a fake id so the caller's bookkeeping
 * stays the same. No per-recipient rate limit here: a batch goes to
 * distinct subscribers, and Resend's own account limit applies.
 */

/** Resend accepts at most this many e-mails per batch call. */
export const RESEND_BATCH_MAX = 100

export type BatchEmail = Omit<CreateBatchEmailOptions, 'to'> & {
  from: string
  /** One recipient per e-mail (each one is personalized). */
  to: string
}

const TEST_RECIPIENT = /@(example\.(com|org|net)|[^@]*\.test)$/i

function forceDryRun(): boolean {
  return MAIL_DRY_RUN === 'true' || NODE_ENV === 'test'
}

export function isDryRunRecipient(recipient: string): boolean {
  return forceDryRun() || TEST_RECIPIENT.test(recipient.trim())
}

/**
 * Sends the e-mails and returns the provider id of each one, in the same
 * order. Throws when Resend refuses the call (the whole chunk failed);
 * `idempotencyKey` (suffixed per chunk) makes a retry of the same batch
 * return the ids of the first attempt instead of sending again.
 */
export async function sendEmailBatch(
  emails: BatchEmail[],
  options: { idempotencyKey?: string } = {},
): Promise<string[]> {
  const ids: string[] = new Array(emails.length)
  const live: { index: number; email: BatchEmail }[] = []
  const stamp = Date.now()

  emails.forEach((email, index) => {
    if (isDryRunRecipient(email.to)) {
      ids[index] = `dry-run-${stamp}-${index}`
    } else {
      live.push({ index, email })
    }
  })
  const dryRun = emails.length - live.length
  if (dryRun > 0) {
    logger.info('email_batch_dry_run', { count: dryRun })
  }

  for (let start = 0; start < live.length; start += RESEND_BATCH_MAX) {
    const chunk = live.slice(start, start + RESEND_BATCH_MAX)
    const key = options.idempotencyKey
      ? `${options.idempotencyKey}-${start / RESEND_BATCH_MAX}`
      : undefined
    const { data, error } = await resend.batch.send(
      chunk.map((item) => item.email),
      key ? { idempotencyKey: key } : undefined,
    )
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to send e-mail batch')
    }
    chunk.forEach((item, position) => {
      const sent = data.data[position]
      if (!sent?.id) throw new Error('Resend batch answered without an id')
      ids[item.index] = sent.id
    })
  }
  return ids
}
