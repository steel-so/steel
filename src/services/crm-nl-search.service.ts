import type { z } from 'zod'
import { logger } from '@/lib/axiom/logger'
import { crmNlSearchFailed } from '@/src/errors'
import {
  buildNlSearchSystem,
  buildOpportunityOrderBy,
  buildOpportunityWhere,
  describeNlFilter,
} from '@/src/lib/crm-nl-search'
import {
  buildCompanyNlSearchSystem,
  buildCompanyOrderBy,
  buildCompanyWhere,
  buildLeadNlSearchSystem,
  buildLeadOrderBy,
  buildLeadWhere,
  buildPersonNlSearchSystem,
  buildPersonOrderBy,
  buildPersonWhere,
  describeCompanyFilter,
  describeLeadFilter,
  describePersonFilter,
} from '@/src/lib/crm-nl-search-entities'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmCompanyDTO } from '@/src/mappers/crm-company.mapper'
import { toCrmLeadDTO } from '@/src/mappers/crm-lead.mapper'
import { toCrmOpportunityDTO } from '@/src/mappers/crm-opportunity.mapper'
import { toCrmPersonDTO } from '@/src/mappers/crm-person.mapper'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import {
  CRM_NL_COMPANY_JSON_SCHEMA,
  CRM_NL_LEAD_JSON_SCHEMA,
  CRM_NL_PERSON_JSON_SCHEMA,
  CRM_NL_SEARCH_JSON_SCHEMA,
  CrmNlCompanyFilterSchema,
  CrmNlLeadFilterSchema,
  CrmNlPersonFilterSchema,
  type CrmNlSearchDTO,
  CrmNlSearchFilterSchema,
} from '@/src/schemas/crm-nl-search.schema'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import type {
  CrmNlCompanySearchResultDTO,
  CrmNlLeadSearchResultDTO,
  CrmNlPersonSearchResultDTO,
  CrmNlSearchResultDTO,
} from '@/types/crm-nl-search'
import { AiUsageService } from './ai-usage.service'
import { assertModuleMember } from './authz'
import { withCustomFieldsList } from './crm-custom-field-sync'
import { assertFeature } from './feature-flag.service'

/** The filter is a small JSON: a short completion is enough. */
const SEARCH_MAX_TOKENS = 500

/** Rows returned per question; `truncated` tells the UI there were more. */
export const CRM_NL_SEARCH_LIMIT = 200

type SearchResource = 'opportunities' | 'leads' | 'people' | 'companies'

/**
 * The gate and the model step shared by every entity: module access to the
 * resource, the CRM AI feature flag and quota, then one completion that only
 * sees the question and the date. Returns the validated filter. Only the
 * size of the question is logged: it may carry client names.
 */
async function interpretQuestion<T extends z.ZodType>(input: {
  actorId: string
  workspaceId: string
  resource: SearchResource
  query: string
  system: string
  jsonSchemaName: string
  jsonSchema: Record<string, unknown>
  filterSchema: T
}): Promise<Result<{ filter: z.infer<T>; model: string }>> {
  const { actorId, workspaceId } = input
  const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: input.resource,
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
      system: input.system,
      messages: [{ role: 'user', content: input.query }],
      jsonSchema: { name: input.jsonSchemaName, schema: input.jsonSchema },
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
      resource: input.resource,
      provider: call.value.model.provider,
      model: call.value.model.model,
      message: error instanceof Error ? error.message : String(error),
    })
    return err(crmNlSearchFailed())
  }

  const filter = parseSdAiJson(input.filterSchema, text)
  if (!filter) {
    logger.warn('crm_nl_search.invalid_output', {
      component: 'CrmNlSearchService',
      workspaceId,
      resource: input.resource,
      model: call.value.model.key,
    })
    return err(crmNlSearchFailed())
  }
  return ok({ filter, model: call.value.model.key })
}

function logSearch(input: {
  workspaceId: string
  resource: SearchResource
  model: string
  query: string
  results: number
  truncated: boolean
}) {
  logger.info('crm_nl_search.search', {
    component: 'CrmNlSearchService',
    workspaceId: input.workspaceId,
    resource: input.resource,
    model: input.model,
    queryLength: input.query.length,
    results: input.results,
    truncated: input.truncated,
  })
}

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
    const asked = await interpretQuestion({
      actorId,
      workspaceId,
      resource: 'opportunities',
      query: dto.query,
      system: buildNlSearchSystem(now),
      jsonSchemaName: 'crm_opportunity_filter',
      jsonSchema: CRM_NL_SEARCH_JSON_SCHEMA,
      filterSchema: CrmNlSearchFilterSchema,
    })
    if (!asked.ok) return asked
    const { filter, model } = asked.value

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

    logSearch({
      workspaceId,
      resource: 'opportunities',
      model,
      query: dto.query,
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

  /** Lead search by free question: same validated-filter design as above. */
  async searchLeads(
    actorId: string,
    workspaceId: string,
    dto: CrmNlSearchDTO,
    now: Date = new Date(),
  ): Promise<Result<CrmNlLeadSearchResultDTO>> {
    const asked = await interpretQuestion({
      actorId,
      workspaceId,
      resource: 'leads',
      query: dto.query,
      system: buildLeadNlSearchSystem(now),
      jsonSchemaName: 'crm_lead_filter',
      jsonSchema: CRM_NL_LEAD_JSON_SCHEMA,
      filterSchema: CrmNlLeadFilterSchema,
    })
    if (!asked.ok) return asked
    const { filter, model } = asked.value

    const rows = await CrmLeadRepository.search(
      buildLeadWhere(workspaceId, filter, { now, actorId }),
      buildLeadOrderBy(filter),
      CRM_NL_SEARCH_LIMIT + 1,
    )
    if (!rows.ok) return rows

    const truncated = rows.value.length > CRM_NL_SEARCH_LIMIT
    const items = rows.value.slice(0, CRM_NL_SEARCH_LIMIT).map(toCrmLeadDTO)
    logSearch({
      workspaceId,
      resource: 'leads',
      model,
      query: dto.query,
      results: items.length,
      truncated,
    })
    return ok({
      query: dto.query,
      interpretation: describeLeadFilter(filter),
      filter,
      items,
      truncated,
    })
  },

  /** People search by free question: same validated-filter design as above. */
  async searchPeople(
    actorId: string,
    workspaceId: string,
    dto: CrmNlSearchDTO,
    now: Date = new Date(),
  ): Promise<Result<CrmNlPersonSearchResultDTO>> {
    const asked = await interpretQuestion({
      actorId,
      workspaceId,
      resource: 'people',
      query: dto.query,
      system: buildPersonNlSearchSystem(now),
      jsonSchemaName: 'crm_person_filter',
      jsonSchema: CRM_NL_PERSON_JSON_SCHEMA,
      filterSchema: CrmNlPersonFilterSchema,
    })
    if (!asked.ok) return asked
    const { filter, model } = asked.value

    const rows = await CrmPersonRepository.search(
      buildPersonWhere(workspaceId, filter, { now, actorId }),
      buildPersonOrderBy(filter),
      CRM_NL_SEARCH_LIMIT + 1,
    )
    if (!rows.ok) return rows

    const truncated = rows.value.length > CRM_NL_SEARCH_LIMIT
    const items = await withCustomFieldsList(
      rows.value.slice(0, CRM_NL_SEARCH_LIMIT).map(toCrmPersonDTO),
    )
    if (!items.ok) return items
    logSearch({
      workspaceId,
      resource: 'people',
      model,
      query: dto.query,
      results: items.value.length,
      truncated,
    })
    return ok({
      query: dto.query,
      interpretation: describePersonFilter(filter),
      filter,
      items: items.value,
      truncated,
    })
  },

  /** Company search by free question: same validated-filter design as above. */
  async searchCompanies(
    actorId: string,
    workspaceId: string,
    dto: CrmNlSearchDTO,
    now: Date = new Date(),
  ): Promise<Result<CrmNlCompanySearchResultDTO>> {
    const asked = await interpretQuestion({
      actorId,
      workspaceId,
      resource: 'companies',
      query: dto.query,
      system: buildCompanyNlSearchSystem(now),
      jsonSchemaName: 'crm_company_filter',
      jsonSchema: CRM_NL_COMPANY_JSON_SCHEMA,
      filterSchema: CrmNlCompanyFilterSchema,
    })
    if (!asked.ok) return asked
    const { filter, model } = asked.value

    const rows = await CrmCompanyRepository.search(
      buildCompanyWhere(workspaceId, filter, { now, actorId }),
      buildCompanyOrderBy(filter),
      CRM_NL_SEARCH_LIMIT + 1,
    )
    if (!rows.ok) return rows

    const truncated = rows.value.length > CRM_NL_SEARCH_LIMIT
    const items = await withCustomFieldsList(
      rows.value.slice(0, CRM_NL_SEARCH_LIMIT).map(toCrmCompanyDTO),
    )
    if (!items.ok) return items
    logSearch({
      workspaceId,
      resource: 'companies',
      model,
      query: dto.query,
      results: items.value.length,
      truncated,
    })
    return ok({
      query: dto.query,
      interpretation: describeCompanyFilter(filter),
      filter,
      items: items.value,
      truncated,
    })
  },
}
