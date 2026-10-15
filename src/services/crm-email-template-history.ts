import { createHash } from 'node:crypto'
import type {
  CrmEmailTemplate,
  CrmEmailTemplateVersionReason,
  Prisma,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { isEmailCanvasDocument } from '@/src/lib/canvas-email/convert-v1'
import { ok, type Result } from '@/src/lib/result'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import {
  type CrmEmailTemplateVersionListItem,
  CrmEmailTemplateVersionRepository,
} from '@/src/repositories/crm-email-template-version.repository'

/**
 * Recording of v2 e-mail template versions — shared by the version
 * service ("Salvar versão", restore), the test send and campaign creation.
 * Kept apart from the services so none of them imports another in a cycle.
 */

/** Same document + subject → same hash (key order is stable: the stored
 * JSON comes from the same normalization). */
export function templateContentHash(
  document: unknown,
  subject: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ document, subject }))
    .digest('hex')
}

export type RecordVersionInput = {
  reason: CrmEmailTemplateVersionReason
  actorId: string
  label?: string | null
  restoredFromId?: string | null
}

/**
 * Records the template's current document as a version. Only v2 (Steel
 * Canvas) templates have history; an unchanged template (same hash as the
 * newest version) records nothing — except a restore, which always marks
 * the point in history. `ok(null)` when nothing was recorded.
 */
export async function recordTemplateVersion(
  template: CrmEmailTemplate,
  input: RecordVersionInput,
): Promise<Result<CrmEmailTemplateVersionListItem | null>> {
  if (!isEmailCanvasDocument(template.builderDocument)) return ok(null)
  const contentHash = templateContentHash(
    template.builderDocument,
    template.subject,
  )
  if (input.reason !== 'RESTORE') {
    const latest = await CrmEmailTemplateVersionRepository.latestHash(
      template.id,
    )
    if (!latest.ok) return latest
    if (latest.value === contentHash) return ok(null)
  }
  const created = await CrmEmailTemplateVersionRepository.create({
    templateId: template.id,
    workspaceId: template.workspaceId,
    reason: input.reason,
    label: input.label ?? null,
    subject: template.subject,
    document: template.builderDocument as Prisma.InputJsonValue,
    contentHash,
    restoredFromId: input.restoredFromId ?? null,
    createdById: input.actorId,
  })
  if (!created.ok) return created
  auditMutation({
    entity: 'crm_email_template_version',
    action: 'create',
    actorId: input.actorId,
    targetId: created.value.id,
    meta: {
      workspaceId: template.workspaceId,
      templateId: template.id,
      reason: input.reason,
    },
  })
  return ok(created.value)
}

/**
 * Best-effort snapshot when a template is used (test send, campaign): a
 * failure is logged and never blocks the send.
 */
export async function snapshotTemplateVersion(
  templateId: string,
  workspaceId: string,
  actorId: string,
  reason: Extract<CrmEmailTemplateVersionReason, 'TEST_SEND' | 'CAMPAIGN'>,
): Promise<void> {
  const template = await CrmEmailTemplateRepository.findById(
    templateId,
    workspaceId,
  )
  const recorded = template.ok
    ? await recordTemplateVersion(template.value, { reason, actorId })
    : template
  if (!recorded.ok) {
    logger.warn('crm_email_template.version_snapshot_failed', {
      component: 'CrmEmailTemplateHistory',
      workspaceId,
      templateId,
      reason,
      code: recorded.error.code,
    })
  }
}
