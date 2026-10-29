import type {
  CrmLeadRuleField,
  CrmLeadRuleOperator,
  CrmLeadScoringRule,
} from '@prisma/client'
import { notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const CrmLeadScoringRuleRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<CrmLeadScoringRule[]>> {
    try {
      const rules = await prisma.crmLeadScoringRule.findMany({
        where: { workspaceId },
        orderBy: { position: 'asc' },
      })
      return ok(rules)
    } catch (error) {
      return err(dbError('Failed to list CRM lead scoring rules', error))
    }
  },

  async listActiveByWorkspace(
    workspaceId: string,
  ): Promise<Result<CrmLeadScoringRule[]>> {
    try {
      const rules = await prisma.crmLeadScoringRule.findMany({
        where: { workspaceId, active: true },
        orderBy: { position: 'asc' },
      })
      return ok(rules)
    } catch (error) {
      return err(dbError('Failed to list active CRM lead scoring rules', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmLeadScoringRule>> {
    try {
      const rule = await prisma.crmLeadScoringRule.findFirst({
        where: { id, workspaceId },
      })
      if (!rule) return err(notFound('CrmLeadScoringRule'))
      return ok(rule)
    } catch (error) {
      return err(dbError('Failed to find CRM lead scoring rule by id', error))
    }
  },

  async create(data: {
    workspaceId: string
    field: CrmLeadRuleField
    operator: CrmLeadRuleOperator
    value?: string
    points?: number
    active?: boolean
    includeWelcome?: boolean
  }): Promise<Result<CrmLeadScoringRule>> {
    try {
      const position = await prisma.crmLeadScoringRule.count({
        where: { workspaceId: data.workspaceId },
      })
      const rule = await prisma.crmLeadScoringRule.create({
        data: { ...data, position },
      })
      return ok(rule)
    } catch (error) {
      return err(dbError('Failed to create CRM lead scoring rule', error))
    }
  },

  async update(
    id: string,
    data: {
      field?: CrmLeadRuleField
      operator?: CrmLeadRuleOperator
      value?: string
      points?: number
      active?: boolean
      includeWelcome?: boolean
    },
  ): Promise<Result<CrmLeadScoringRule>> {
    try {
      const rule = await prisma.crmLeadScoringRule.update({
        where: { id },
        data,
      })
      return ok(rule)
    } catch (error) {
      return err(dbError('Failed to update CRM lead scoring rule', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmLeadScoringRule.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM lead scoring rule', error))
    }
  },
}
