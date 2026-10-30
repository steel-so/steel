import type { CrmHealthLevel } from '@prisma/client'
import { HEALTH_LEVEL_LABEL } from '@/src/lib/crm-health/core'
import type {
  CrmCustomerHealthWithCompany,
  CrmOpportunityHealthWithDeal,
} from '@/src/repositories/crm-health.repository'
import type {
  CrmCustomerHealthDTO,
  CrmHealthFactorDTO,
  CrmHealthNextActionDTO,
  CrmOpportunityHealthDTO,
} from '@/types/crm-health'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** The JSON columns are written by us, but a bad row must not break a screen. */
export function parseFactors(value: unknown): CrmHealthFactorDTO[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): CrmHealthFactorDTO[] => {
    if (!isRecord(item)) return []
    const { key, label, points, max, detail } = item
    if (
      typeof key !== 'string' ||
      typeof label !== 'string' ||
      typeof points !== 'number' ||
      typeof max !== 'number' ||
      typeof detail !== 'string'
    ) {
      return []
    }
    return [{ key, label, points, max, detail }]
  })
}

export function parseNextAction(value: unknown): CrmHealthNextActionDTO {
  if (isRecord(value)) {
    const { key, label, detail } = value
    if (
      typeof key === 'string' &&
      typeof label === 'string' &&
      typeof detail === 'string'
    ) {
      return { key, label, detail }
    }
  }
  return { key: 'none', label: 'Sem ação sugerida', detail: '' }
}

function parseStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function base(row: {
  riskScore: number
  level: CrmHealthLevel
  factors: unknown
  nextAction: unknown
  previousScore: number | null
  computedAt: Date
}) {
  return {
    riskScore: row.riskScore,
    level: row.level,
    levelLabel: HEALTH_LEVEL_LABEL[row.level],
    factors: parseFactors(row.factors),
    nextAction: parseNextAction(row.nextAction),
    riskDelta:
      row.previousScore === null ? null : row.riskScore - row.previousScore,
    computedAt: row.computedAt.toISOString(),
  }
}

export function toCrmCustomerHealthDTO(
  row: CrmCustomerHealthWithCompany,
): CrmCustomerHealthDTO {
  return {
    ...base(row),
    companyId: row.companyId,
    companyName: row.company.name,
    healthScore: 100 - row.riskScore,
    missing: parseStrings(row.missing),
  }
}

export function toCrmOpportunityHealthDTO(
  row: CrmOpportunityHealthWithDeal,
): CrmOpportunityHealthDTO {
  return {
    ...base(row),
    opportunityId: row.opportunityId,
    opportunityName: row.opportunity.name,
  }
}
