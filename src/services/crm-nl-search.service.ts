import { logger } from '@/lib/axiom/logger'
import { crmNlSearchFailed } from '@/src/errors'
import {
  buildNlSearchSystem,
  buildOpportunityOrderBy,
  buildOpportunityWhere,
  describeNlFilter,
} from '@/src/lib/crm-nl-search'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmOpportunityDTO } from '@/src/mappers/crm-opportunity.mapper'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import {
  CRM_NL_SEARCH_JSON_SCHEMA,
  type CrmNlSearchDTO,
  CrmNlSearchFilterSchema,
} from '@/src/schemas/crm-nl-search.schema'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import type { CrmNlSearchResultDTO } from '@/types/crm-nl-search'
import { AiUsageService } from './ai-usage.service'
import { assertModuleMember } from './authz'
import { withCustomFieldsList } from './crm-custom-field-sync'
import { assertFeature } from './feature-flag.service'

/** The filter is a small JSON: a short completion is enough. */
const SEARCH_MAX_TOKENS = 500

/** Rows returned per question; `truncated` tells the UI there were more. */
export const CRM_NL_SEARCH_LIMIT = 200

export const CrmNlSearchService = {
  /**
   * Opportunity search by free question (C10). The model only turns the
   * question into a validated filter (no CRM data goes to the provider);
   * the filter then runs through the normal repository, scoped to the
   * workspace, so the result never exceeds what the actor may already see.
   * Same gate and monthly quota as the other CRM AI features (ADR 0007).
   */
  async searchOpportunities(
    actorId: string,
    workspaceId: string,
    dto: CrmNlSearchDTO,
    now: Date = new Date(),
  ): Promise<Result<CrmNlSearchResultDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const feature = await assertFeature(workspaceId, 'crm.aiAssistant')
    if (!feature.ok) return feature

    const call = await AiUsageService.prepare(
      workspaceId,
      'CRM_ASSISTANT',
      actorId,
    )
    if (!call.ok) return call

    let text: string
    try {
      const response = await call.value.provider.chat({
        model: call.value.model.model,
        system: buildNlSearchSystem(now),
        messages: [{ role: 'user', content: dto.query }],
        jsonSchema: {
          name: 'crm_opportunity_filter',
          schema: CRM_NL_SEARCH_JSON_SCHEMA,
        },
        maxTokens: SEARCH_MAX_TOKENS,
      })
      await AiUsageService.record(call.value, {
        workspaceId,
        userId: actorId,
        usage: response.usage,
        scope: { module: 'CRM' },
      })
      text = response.text
    } catch (error) {
      logger.error('crm_nl_search.provider_failed', {
        component: 'CrmNlSearchService',
        workspaceId,
        provider: call.value.model.provider,
        model: call.value.model.model,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(crmNlSearchFailed())
    }

    const filter = parseSdAiJson(CrmNlSearchFilterSchema, text)
    if (!filter) {
      logger.warn('crm_nl_search.invalid_output', {
        component: 'CrmNlSearchService',
        workspaceId,
        model: call.value.model.key,
      })
      return err(crmNlSearchFailed())
    }

    const rows = await CrmOpportunityRepository.search(
      buildOpportunityWhere(workspaceId, filter, { now, actorId }),
      buildOpportunityOrderBy(filter),
      CRM_NL_SEARCH_LIMIT + 1,
    )
    if (!rows.ok) return rows

    const truncated = rows.value.length > CRM_NL_SEARCH_LIMIT
    const opportunities = await withCustomFieldsList(
      rows.value.slice(0, CRM_NL_SEARCH_LIMIT).map(toCrmOpportunityDTO),
    )
    if (!opportunities.ok) return opportunities

    // Only the size of the question is logged: it may carry client names.
    logger.info('crm_nl_search.search', {
      component: 'CrmNlSearchService',
      workspaceId,
      model: call.value.model.key,
      queryLength: dto.query.length,
      results: opportunities.value.length,
      truncated,
    })
    return ok({
      query: dto.query,
      interpretation: describeNlFilter(filter),
      filter,
      opportunities: opportunities.value,
      truncated,
    })
  },
}
