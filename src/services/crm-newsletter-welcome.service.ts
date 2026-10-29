import type { CrmNewsletterWelcomeStep, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  crmEmailCanvasHtmlForbidden,
  crmNewsletterArchived,
  crmNewsletterWelcomeStepLimitReached,
  crmNewsletterWelcomeStepNotFound,
  validationError,
} from '@/src/errors'
import { openEmailDocument } from '@/src/lib/canvas-email/convert-v1'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { changesHtmlBlocks } from '@/src/lib/canvas-email/validate'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmNewsletterWelcomeStepDTO } from '@/src/mappers/crm-newsletter-automation.mapper'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import type { NewsletterWithWorkspace } from '@/src/repositories/crm-newsletter-issue.repository'
import { CrmNewsletterWelcomeRepository } from '@/src/repositories/crm-newsletter-welcome.repository'
import {
  CRM_NEWSLETTER_WELCOME_MAX_STEPS,
  type CreateCrmNewsletterWelcomeStepDTO,
  type CrmNewsletterWelcomeStepDTO,
  type ReorderCrmNewsletterWelcomeStepsDTO,
  type UpdateCrmNewsletterWelcomeStepDTO,
} from '@/src/schemas/crm-newsletter-automation.schema'
import { loadNewsletterScope } from './crm-newsletter-issue.service'
import { validateIssueDocument } from './crm-newsletter-render'

/**
 * Welcome series of a newsletter (slice nl2-automation): ordered e-mails
 * sent `delay` after each subscriber's confirmation. Member side only —
 * the sending runs in `crm-newsletter-welcome-send.service.ts`.
 * Permissions: CRM module, resource `email` (same as the issues).
 */

/** Root preheader of a canvas document (`''` when absent). */
export function documentPreheader(doc: unknown): string {
  const opened = openEmailDocument(doc)
  if (!opened) return ''
  const root = opened.nodes[opened.rootId]
  const value = (root?.props as { preheader?: unknown } | undefined)?.preheader
  return typeof value === 'string' ? value : ''
}

/** The document with the root preheader replaced. */
export function withPreheader(doc: unknown, preheader: string): unknown {
  const opened = openEmailDocument(doc)
  if (!opened) return doc
  const root = opened.nodes[opened.rootId]
  return {
    ...opened,
    nodes: {
      ...opened.nodes,
      [opened.rootId]: { ...root, props: { ...root.props, preheader } },
    },
  }
}

/** Newsletter template (v2) when it still exists, else a blank e-mail. */
async function startingDocument(
  workspaceId: string,
  newsletter: NewsletterWithWorkspace,
): Promise<unknown> {
  if (newsletter.templateId) {
    const template = await CrmEmailTemplateRepository.findById(
      newsletter.templateId,
      workspaceId,
    )
    const doc = template.ok
      ? openEmailDocument(template.value.builderDocument)
      : null
    if (doc) return doc
  }
  return createBlankEmailDocument()
}

async function loadStep(
  newsletterId: string,
  stepId: string,
): Promise<Result<CrmNewsletterWelcomeStep>> {
  const step = await CrmNewsletterWelcomeRepository.findStep(
    newsletterId,
    stepId,
  )
  if (!step.ok) return step
  if (!step.value) return err(crmNewsletterWelcomeStepNotFound())
  return ok(step.value)
}

export const CrmNewsletterWelcomeService = {
  /** Steps in order, with sent / opened / clicked of each. */
  async list(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<CrmNewsletterWelcomeStepDTO[]>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const steps = await CrmNewsletterWelcomeRepository.listSteps(newsletterId)
    if (!steps.ok) return steps
    const stats = await CrmNewsletterWelcomeRepository.statsFor(
      steps.value.map((step) => step.id),
    )
    if (!stats.ok) return stats
    return ok(
      steps.value.map((step) =>
        toCrmNewsletterWelcomeStepDTO(step, {
          stats: stats.value.get(step.id) ?? null,
        }),
      ),
    )
  },

  /** One step with its canvas document (editor). */
  async get(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    stepId: string,
  ): Promise<Result<CrmNewsletterWelcomeStepDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const step = await loadStep(newsletterId, stepId)
    if (!step.ok) return step
    const stats = await CrmNewsletterWelcomeRepository.statsFor([stepId])
    if (!stats.ok) return stats
    return ok(
      toCrmNewsletterWelcomeStepDTO(step.value, {
        stats: stats.value.get(stepId) ?? null,
        includeDocument: true,
      }),
    )
  },

  /** New step at the end, from the newsletter template (or blank). */
  async create(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: CreateCrmNewsletterWelcomeStepDTO,
  ): Promise<Result<CrmNewsletterWelcomeStepDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'CREATE',
    )
    if (!scope.ok) return scope
    const { newsletter } = scope.value
    if (newsletter.status !== 'ACTIVE') return err(crmNewsletterArchived())

    const count = await CrmNewsletterWelcomeRepository.countSteps(newsletterId)
    if (!count.ok) return count
    if (count.value >= CRM_NEWSLETTER_WELCOME_MAX_STEPS) {
      return err(
        crmNewsletterWelcomeStepLimitReached(CRM_NEWSLETTER_WELCOME_MAX_STEPS),
      )
    }

    const start = await startingDocument(workspaceId, newsletter)
    const document = dto.preheader ? withPreheader(start, dto.preheader) : start
    const created = await CrmNewsletterWelcomeRepository.createStep({
      newsletterId,
      workspaceId,
      subject: dto.subject,
      preheader: dto.preheader || documentPreheader(document) || null,
      delayValue: dto.delayValue,
      delayUnit: dto.delayUnit,
      builderDocument: document as Prisma.InputJsonValue,
      createdById: actorId,
    })
    if (!created.ok) return created
    logger.info('crm.newsletter.welcome_step_created', {
      component: 'CrmNewsletterWelcomeService',
      workspaceId,
      newsletterId,
      stepId: created.value.id,
      position: created.value.position,
    })
    auditMutation({
      entity: 'crm_newsletter',
      action: 'update',
      actorId,
      targetId: newsletterId,
      meta: { workspaceId, welcomeStep: created.value.id, op: 'create' },
    })
    return ok(
      toCrmNewsletterWelcomeStepDTO(created.value, { includeDocument: true }),
    )
  },

  /**
   * Editor autosave and the list controls (switch, delay). HTML blocks
   * follow the template rule (OWNER/ADMIN only); the root preheader of the
   * document and the `preheader` column stay in sync.
   */
  async update(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    stepId: string,
    dto: UpdateCrmNewsletterWelcomeStepDTO,
  ): Promise<Result<CrmNewsletterWelcomeStepDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const step = await loadStep(newsletterId, stepId)
    if (!step.ok) return step

    let builderDocument: Prisma.InputJsonValue | undefined
    let preheader: string | null | undefined = dto.preheader
    if (dto.builderDocument !== undefined) {
      const doc = validateIssueDocument(dto.builderDocument)
      if (!doc.ok) return doc
      if (
        !scope.value.membership.isPrivileged &&
        changesHtmlBlocks(
          openEmailDocument(step.value.builderDocument),
          doc.value,
        )
      ) {
        return err(crmEmailCanvasHtmlForbidden())
      }
      const next =
        dto.preheader !== undefined
          ? withPreheader(doc.value, dto.preheader ?? '')
          : doc.value
      builderDocument = next as Prisma.InputJsonValue
      preheader = documentPreheader(next) || null
    } else if (dto.preheader !== undefined) {
      builderDocument = withPreheader(
        step.value.builderDocument,
        dto.preheader ?? '',
      ) as Prisma.InputJsonValue
    }

    const updated = await CrmNewsletterWelcomeRepository.updateStep(stepId, {
      ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
      ...(dto.delayValue !== undefined ? { delayValue: dto.delayValue } : {}),
      ...(dto.delayUnit !== undefined ? { delayUnit: dto.delayUnit } : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(preheader !== undefined ? { preheader } : {}),
      ...(builderDocument !== undefined ? { builderDocument } : {}),
      updatedById: actorId,
    })
    if (!updated.ok) return updated
    if (dto.enabled !== undefined && dto.enabled !== step.value.enabled) {
      auditMutation({
        entity: 'crm_newsletter',
        action: 'update',
        actorId,
        targetId: newsletterId,
        meta: {
          workspaceId,
          welcomeStep: stepId,
          op: dto.enabled ? 'enable' : 'disable',
        },
      })
    }
    return ok(
      toCrmNewsletterWelcomeStepDTO(updated.value, { includeDocument: true }),
    )
  },

  async remove(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    stepId: string,
  ): Promise<Result<void>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'DELETE',
    )
    if (!scope.ok) return scope
    const step = await loadStep(newsletterId, stepId)
    if (!step.ok) return step
    const deleted = await CrmNewsletterWelcomeRepository.deleteStep(
      newsletterId,
      stepId,
    )
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'crm_newsletter',
      action: 'update',
      actorId,
      targetId: newsletterId,
      meta: { workspaceId, welcomeStep: stepId, op: 'delete' },
    })
    return ok(undefined)
  },

  /** New order: every step of the newsletter, each once. */
  async reorder(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: ReorderCrmNewsletterWelcomeStepsDTO,
  ): Promise<Result<CrmNewsletterWelcomeStepDTO[]>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const steps = await CrmNewsletterWelcomeRepository.listSteps(newsletterId)
    if (!steps.ok) return steps
    const current = new Set(steps.value.map((step) => step.id))
    if (
      dto.ids.length !== current.size ||
      dto.ids.some((id) => !current.has(id))
    ) {
      return err(
        validationError('Informe todas as etapas da série, cada uma uma vez'),
      )
    }
    const reordered = await CrmNewsletterWelcomeRepository.reorderSteps(dto.ids)
    if (!reordered.ok) return reordered
    return CrmNewsletterWelcomeService.list(actorId, workspaceId, newsletterId)
  },
}
