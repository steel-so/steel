import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { crmNewsletterIssueLocked, validationError } from '@/src/errors'
import { pickAbWinner } from '@/src/lib/crm-newsletter/ab-test'
import { CrmNewsletterJob } from '@/src/lib/queue/jobs'
import { getCrmNewsletterQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmNewsletterAbTestDTO,
  toCrmNewsletterAbVariantStatsDTO,
} from '@/src/mappers/crm-newsletter-ab.mapper'
import { CrmNewsletterAbRepository } from '@/src/repositories/crm-newsletter-ab.repository'
import { EDITABLE_ISSUE_STATUSES } from '@/src/repositories/crm-newsletter-issue.repository'
import type {
  CrmNewsletterAbReportDTO,
  CrmNewsletterAbTestDTO,
  SetCrmNewsletterAbTestDTO,
} from '@/src/schemas/crm-newsletter-ab.schema'
import { loadIssue, loadNewsletterScope } from './crm-newsletter-issue.service'

/**
 * Subject A/B test of a newsletter issue (newsletter2 nl2-digest-ai):
 * settings while the issue is editable, the variant report, and the
 * worker decision — after the wait, the variant with the better open (or
 * click) rate wins and the held rest of the audience is released to the
 * normal dispatch with the winning subject. Resource `email` of the CRM.
 */

export const AB_DECISIONS_PER_TICK = 50

export const CrmNewsletterAbService = {
  async report(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
  ): Promise<Result<CrmNewsletterAbReportDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    const abTest = toCrmNewsletterAbTestDTO(issue.value)
    if (
      !abTest ||
      issue.value.status === 'DRAFT' ||
      issue.value.status === 'SCHEDULED'
    ) {
      return ok({
        subjectA: issue.value.subject,
        abTest,
        variants: [],
        held: 0,
      })
    }
    const [counts, held] = await Promise.all([
      CrmNewsletterAbRepository.variantCounts(issueId),
      CrmNewsletterAbRepository.countHeld(issueId),
    ])
    if (!counts.ok) return counts
    if (!held.ok) return held
    return ok({
      subjectA: issue.value.subject,
      abTest,
      variants: toCrmNewsletterAbVariantStatsDTO(counts.value, {
        A: issue.value.subject,
        B: abTest.subjectB,
      }),
      held: held.value,
    })
  },

  /** Turns the test on (or changes it) while the issue is editable. */
  async set(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    dto: SetCrmNewsletterAbTestDTO,
  ): Promise<Result<CrmNewsletterAbTestDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    if (!EDITABLE_ISSUE_STATUSES.includes(issue.value.status)) {
      return err(crmNewsletterIssueLocked())
    }
    if (dto.subjectB.trim() === issue.value.subject.trim()) {
      return err(
        validationError('O assunto B precisa ser diferente do assunto atual'),
      )
    }
    const saved = await CrmNewsletterAbRepository.setSettings(issueId, {
      abSubjectB: dto.subjectB,
      abTestPercent: dto.testPercent,
      abMetric: dto.metric,
      abWaitHours: dto.waitHours,
      updatedById: actorId,
    })
    if (!saved.ok) return saved
    const result = saved.value && toCrmNewsletterAbTestDTO(saved.value)
    if (!result) return err(crmNewsletterIssueLocked())
    auditMutation({
      entity: 'crm_newsletter_issue',
      action: 'update',
      actorId,
      targetId: issueId,
      meta: {
        workspaceId,
        newsletterId,
        abTest: true,
        testPercent: dto.testPercent,
        metric: dto.metric,
        waitHours: dto.waitHours,
      },
    })
    return ok(result)
  },

  async clear(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
  ): Promise<Result<void>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    if (!EDITABLE_ISSUE_STATUSES.includes(issue.value.status)) {
      return err(crmNewsletterIssueLocked())
    }
    const saved = await CrmNewsletterAbRepository.setSettings(issueId, {
      abSubjectB: null,
      abTestPercent: null,
      abMetric: null,
      abWaitHours: null,
      updatedById: actorId,
    })
    if (!saved.ok) return saved
    if (!saved.value) return err(crmNewsletterIssueLocked())
    auditMutation({
      entity: 'crm_newsletter_issue',
      action: 'update',
      actorId,
      targetId: issueId,
      meta: { workspaceId, newsletterId, abTest: false },
    })
    return ok(undefined)
  },

  /**
   * Worker: picks the winner of every test whose wait is over, releases
   * the held rows and queues their dispatch right away.
   */
  async decideDue(
    now: Date,
  ): Promise<Result<{ decided: number; released: number }>> {
    const due = await CrmNewsletterAbRepository.listDueDecisions(
      now,
      AB_DECISIONS_PER_TICK,
    )
    if (!due.ok) return due
    let decided = 0
    let released = 0
    for (const issue of due.value) {
      const counts = await CrmNewsletterAbRepository.variantCounts(issue.id)
      if (!counts.ok) return counts
      const metric = issue.abMetric ?? 'OPENS'
      const winner = pickAbWinner(counts.value, metric)
      const result = await CrmNewsletterAbRepository.decide(
        issue.id,
        winner,
        now,
      )
      if (!result.ok) return result
      if (!result.value) continue
      decided++
      released += result.value.released
      logger.info('crm.newsletter.ab_decided', {
        component: 'CrmNewsletterAbService',
        workspaceId: issue.workspaceId,
        issueId: issue.id,
        winner,
        metric,
        released: result.value.released,
      })
      auditMutation({
        entity: 'crm_newsletter_issue',
        action: 'apply_winner',
        actorId: null,
        targetId: issue.id,
        meta: {
          workspaceId: issue.workspaceId,
          winner,
          metric,
          released: result.value.released,
          actor: 'system',
        },
      })
      await getCrmNewsletterQueue().add(
        CrmNewsletterJob.Dispatch,
        { issueId: issue.id },
        { jobId: `crm-newsletter-dispatch-${issue.id}-ab-${now.getTime()}` },
      )
    }
    return ok({ decided, released })
  },
}
