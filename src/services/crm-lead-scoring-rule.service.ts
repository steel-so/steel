import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  isLeadEventRuleField,
  matchesLeadEventRule,
} from '@/src/lib/crm-lead-rules'
import { ok, type Result } from '@/src/lib/result'
import { toCrmLeadScoringRuleDTO } from '@/src/mappers/crm-lead.mapper'
import { CrmLeadScoringRuleRepository } from '@/src/repositories/crm-lead-scoring-rule.repository'
import { CrmNewsletterBridgeRepository } from '@/src/repositories/crm-newsletter-bridge.repository'
import type {
  CreateCrmLeadScoringRuleDTO,
  CrmLeadEventRuleField,
  UpdateCrmLeadScoringRuleDTO,
} from '@/src/schemas/crm-lead.schema'
import type { CrmLeadScoringRuleDTO } from '@/types/crm-lead'
import { assertModuleMember } from './authz'

type RuleShape = Pick<CreateCrmLeadScoringRuleDTO, 'field' | 'operator'> & {
  value?: string
}

/**
 * Event rules have no operator of their own: they always store `contains`,
 * and only `newsletter_clicked` keeps a value (the "URL contains" filter).
 */
function normalizeEventRule<T extends Partial<RuleShape>>(dto: T): T {
  if (!dto.field || !isLeadEventRuleField(dto.field)) return dto
  return {
    ...dto,
    operator: 'contains',
    value: dto.field === 'newsletter_clicked' ? (dto.value ?? '') : '',
  } as T
}

/** An engagement event that may score the leads of a contact. */
export type LeadEngagementEvent = {
  workspaceId: string
  personId: string | null
  email: string
  field: CrmLeadEventRuleField
  /** Idempotency key: `newsletter:<id>` or `issue:<id>`. */
  eventKey: string
  url?: string | null
}

export const CrmLeadScoringRuleService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmLeadScoringRuleDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result =
      await CrmLeadScoringRuleRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmLeadScoringRuleDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmLeadScoringRuleDTO,
  ): Promise<Result<CrmLeadScoringRuleDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const rule = normalizeEventRule(dto)
    const result = await CrmLeadScoringRuleRepository.create({
      workspaceId,
      field: rule.field,
      operator: rule.operator,
      value: rule.value,
      points: rule.points,
      active: rule.active,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_lead_scoring_rule',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_lead_scoring_rule',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    return ok(toCrmLeadScoringRuleDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    ruleId: string,
    dto: UpdateCrmLeadScoringRuleDTO,
  ): Promise<Result<CrmLeadScoringRuleDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmLeadScoringRuleRepository.findById(
      ruleId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmLeadScoringRuleRepository.update(
      ruleId,
      normalizeEventRule(dto),
    )
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_lead_scoring_rule',
      action: 'update',
      actorId,
      targetId: ruleId,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toCrmLeadScoringRuleDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    ruleId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmLeadScoringRuleRepository.findById(
      ruleId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmLeadScoringRuleRepository.delete(ruleId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_lead_scoring_rule',
      action: 'delete',
      actorId,
      targetId: ruleId,
    })

    return ok(undefined)
  },
  /**
   * Newsletter bridge (ADR 0054 phase 2): awards the active event rules that
   * match `event` to every live lead linked to the person or e-mail, once
   * per rule × lead × `eventKey`. System path (no actor). Returns how many
   * awards were made now.
   */
  async applyEngagementEvent(
    event: LeadEngagementEvent,
  ): Promise<Result<number>> {
    const rules = await CrmLeadScoringRuleRepository.listActiveByWorkspace(
      event.workspaceId,
    )
    if (!rules.ok) return rules
    const matching = rules.value.filter((rule) =>
      matchesLeadEventRule(rule, { field: event.field, url: event.url }),
    )
    if (matching.length === 0) return ok(0)

    const leads = await CrmNewsletterBridgeRepository.findLinkedLeadIds(
      event.workspaceId,
      event.personId,
      event.email,
    )
    if (!leads.ok) return leads

    let awarded = 0
    for (const leadId of leads.value) {
      for (const rule of matching) {
        const result = await CrmNewsletterBridgeRepository.awardScoreEvent({
          workspaceId: event.workspaceId,
          leadId,
          ruleId: rule.id,
          eventKey: event.eventKey,
          points: rule.points,
        })
        if (!result.ok) return result
        if (result.value) awarded++
      }
    }
    if (awarded > 0) {
      logger.info('crm.lead.engagement_scored', {
        component: 'CrmLeadScoringRuleService',
        workspaceId: event.workspaceId,
        field: event.field,
        eventKey: event.eventKey,
        awarded,
      })
    }
    return ok(awarded)
  },
}
