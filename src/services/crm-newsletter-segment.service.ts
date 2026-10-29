import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  crmNewsletterIssueLocked,
  crmNewsletterSegmentInvalid,
  crmNewsletterSegmentLimitReached,
  crmNewsletterSegmentNotFound,
} from '@/src/errors'
import { parseStoredSegment } from '@/src/lib/crm-newsletter/segment-where'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmNewsletterIssueSegmentDTO,
  toCrmNewsletterSegmentDTO,
} from '@/src/mappers/crm-newsletter-segment.mapper'
import { EDITABLE_ISSUE_STATUSES } from '@/src/repositories/crm-newsletter-issue.repository'
import { CrmNewsletterSegmentRepository } from '@/src/repositories/crm-newsletter-segment.repository'
import {
  type AudiencePreviewDTO,
  CRM_NEWSLETTER_AUDIENCE_SAMPLE_SIZE,
  CRM_NEWSLETTER_SEGMENTS_PER_NEWSLETTER,
  type CreateCrmNewsletterSegmentDTO,
  type CrmNewsletterAudiencePreviewDTO,
  type CrmNewsletterIssueSegmentDTO,
  type CrmNewsletterSegmentDTO,
  type CrmNewsletterSegmentOptionsDTO,
  isEmptySegment,
  type NewsletterSegment,
  type SetIssueSegmentDTO,
  type UpdateCrmNewsletterSegmentDTO,
} from '@/src/schemas/crm-newsletter-segment.schema'
import { resolveSegmentWhere } from './crm-newsletter-audience'
import { loadIssue, loadNewsletterScope } from './crm-newsletter-issue.service'

/**
 * Audience segments of newsletter issues (newsletter2, slice nl2-segments):
 * saved segments per newsletter, the "Público" of an issue, the live
 * audience preview and the compiled filter the send snapshot uses.
 * Permissions follow the issues: CRM module, resource `email`.
 */

/** Companies returned by the options endpoint per search. */
export const SEGMENT_COMPANY_OPTIONS = 30

export const CrmNewsletterSegmentService = {
  async list(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<CrmNewsletterSegmentDTO[]>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const rows = await CrmNewsletterSegmentRepository.list(
      workspaceId,
      newsletterId,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toCrmNewsletterSegmentDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: CreateCrmNewsletterSegmentDTO,
  ): Promise<Result<CrmNewsletterSegmentDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'CREATE',
    )
    if (!scope.ok) return scope
    const count = await CrmNewsletterSegmentRepository.count(newsletterId)
    if (!count.ok) return count
    if (count.value >= CRM_NEWSLETTER_SEGMENTS_PER_NEWSLETTER) {
      return err(
        crmNewsletterSegmentLimitReached(
          CRM_NEWSLETTER_SEGMENTS_PER_NEWSLETTER,
        ),
      )
    }
    const valid = await resolveSegmentWhere(
      workspaceId,
      newsletterId,
      dto.definition,
    )
    if (!valid.ok) return valid

    const created = await CrmNewsletterSegmentRepository.create({
      workspaceId,
      newsletterId,
      name: dto.name,
      definition: dto.definition as Prisma.InputJsonValue,
      createdById: actorId,
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'crm_newsletter_segment',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: {
        workspaceId,
        newsletterId,
        conditions: countConditions(dto.definition),
      },
    })
    return ok(toCrmNewsletterSegmentDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    segmentId: string,
    dto: UpdateCrmNewsletterSegmentDTO,
  ): Promise<Result<CrmNewsletterSegmentDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const found = await CrmNewsletterSegmentRepository.findById(
      workspaceId,
      newsletterId,
      segmentId,
    )
    if (!found.ok) return found
    if (!found.value) return err(crmNewsletterSegmentNotFound())
    if (dto.definition) {
      const valid = await resolveSegmentWhere(
        workspaceId,
        newsletterId,
        dto.definition,
      )
      if (!valid.ok) return valid
    }

    const updated = await CrmNewsletterSegmentRepository.update(segmentId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.definition !== undefined
        ? { definition: dto.definition as Prisma.InputJsonValue }
        : {}),
      updatedById: actorId,
    })
    if (!updated.ok) return updated
    auditMutation({
      entity: 'crm_newsletter_segment',
      action: 'update',
      actorId,
      targetId: segmentId,
      meta: {
        workspaceId,
        newsletterId,
        fields: Object.keys(dto),
      },
    })
    return ok(toCrmNewsletterSegmentDTO(updated.value))
  },

  /** Issues that used it keep their copy of the conditions. */
  async remove(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    segmentId: string,
  ): Promise<Result<void>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'DELETE',
    )
    if (!scope.ok) return scope
    const found = await CrmNewsletterSegmentRepository.findById(
      workspaceId,
      newsletterId,
      segmentId,
    )
    if (!found.ok) return found
    if (!found.value) return err(crmNewsletterSegmentNotFound())
    const deleted = await CrmNewsletterSegmentRepository.delete(segmentId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'crm_newsletter_segment',
      action: 'delete',
      actorId,
      targetId: segmentId,
      meta: { workspaceId, newsletterId, name: found.value.name },
    })
    return ok(undefined)
  },

  /** The issue's "Público". */
  async getIssueSegment(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
  ): Promise<Result<CrmNewsletterIssueSegmentDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    const stored = parseStoredSegment(issue.value.segment)
    if (!stored) return err(crmNewsletterSegmentInvalid())

    let savedName: string | null = null
    if (stored.savedSegmentId) {
      const saved = await CrmNewsletterSegmentRepository.findById(
        workspaceId,
        newsletterId,
        stored.savedSegmentId,
      )
      if (!saved.ok) return saved
      savedName = saved.value?.name ?? null
    }
    return ok(toCrmNewsletterIssueSegmentDTO(stored, savedName))
  },

  /** Sets the issue's audience (DRAFT/SCHEDULED only). */
  async setIssueSegment(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    dto: SetIssueSegmentDTO,
  ): Promise<Result<CrmNewsletterIssueSegmentDTO>> {
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

    let savedName: string | null = null
    if (dto.savedSegmentId) {
      const saved = await CrmNewsletterSegmentRepository.findById(
        workspaceId,
        newsletterId,
        dto.savedSegmentId,
      )
      if (!saved.ok) return saved
      if (!saved.value) return err(crmNewsletterSegmentNotFound())
      savedName = saved.value.name
    }
    const valid = await resolveSegmentWhere(
      workspaceId,
      newsletterId,
      dto.segment,
    )
    if (!valid.ok) return valid

    const stored = {
      conditions: dto.segment.conditions,
      groups: dto.segment.groups,
      savedSegmentId: dto.savedSegmentId ?? null,
    }
    const updated = await CrmNewsletterSegmentRepository.setIssueSegment(
      issueId,
      (isEmptySegment(dto.segment) ? {} : stored) as Prisma.InputJsonValue,
      actorId,
    )
    if (!updated.ok) return updated
    if (!updated.value) return err(crmNewsletterIssueLocked())
    auditMutation({
      entity: 'crm_newsletter_issue',
      action: 'update',
      actorId,
      targetId: issueId,
      meta: {
        workspaceId,
        newsletterId,
        audience: 'segment',
        conditions: countConditions(dto.segment),
        savedSegmentId: stored.savedSegmentId,
      },
    })
    return ok(toCrmNewsletterIssueSegmentDTO(stored, savedName))
  },

  /**
   * Live count + sample for the segment builder: the posted (unsaved)
   * segment, or the issue's stored one when the body has none.
   */
  async previewAudience(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    dto: AudiencePreviewDTO,
  ): Promise<Result<CrmNewsletterAudiencePreviewDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue

    let segment = dto.segment
    if (!segment) {
      const stored = parseStoredSegment(issue.value.segment)
      if (!stored) return err(crmNewsletterSegmentInvalid())
      segment = stored
    }
    const where = await resolveSegmentWhere(workspaceId, newsletterId, segment)
    if (!where.ok) return where
    return CrmNewsletterSegmentRepository.previewAudience(
      workspaceId,
      newsletterId,
      where.value,
      CRM_NEWSLETTER_AUDIENCE_SAMPLE_SIZE,
    )
  },

  /** Choices of the builder: companies (searchable) and PERSON fields. */
  async options(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    query: { companyQuery?: string; companyIds?: string[] },
  ): Promise<Result<CrmNewsletterSegmentOptionsDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const [companies, fields] = await Promise.all([
      CrmNewsletterSegmentRepository.companies(
        workspaceId,
        query.companyQuery,
        SEGMENT_COMPANY_OPTIONS,
        query.companyIds ?? [],
      ),
      CrmNewsletterSegmentRepository.personCustomFields(workspaceId),
    ])
    if (!companies.ok) return companies
    if (!fields.ok) return fields
    return ok({
      companies: companies.value,
      customFields: fields.value.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        options: field.options,
      })),
    })
  },
}

function countConditions(segment: NewsletterSegment): number {
  return (
    segment.conditions.length +
    segment.groups.reduce((sum, group) => sum + group.conditions.length, 0)
  )
}
