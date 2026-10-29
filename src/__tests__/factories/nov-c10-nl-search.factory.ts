import type { CrmOpportunity } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

/** Opportunity with the extra columns the NL search filters on. */
export async function seedSearchableOpportunity(
  workspaceId: string,
  createdById: string,
  pipelineId: string,
  stageId: string,
  overrides: Partial<
    Pick<
      CrmOpportunity,
      | 'name'
      | 'amount'
      | 'probability'
      | 'closeDate'
      | 'ownerId'
      | 'source'
      | 'deletedAt'
      | 'position'
    >
  > & { updatedAt?: Date; createdAt?: Date } = {},
) {
  const { updatedAt, createdAt, ...rest } = overrides
  const created = await prisma.crmOpportunity.create({
    data: {
      name: 'Seed Opportunity',
      workspaceId,
      createdById,
      pipelineId,
      stageId,
      ...(createdAt ? { createdAt } : {}),
      ...rest,
    },
  })
  if (!updatedAt) return created
  // `@updatedAt` ignores explicit values on create/update through Prisma.
  await prisma.$executeRaw`UPDATE crm_opportunities SET updated_at = ${updatedAt} WHERE id = ${created.id}`
  return { ...created, updatedAt }
}
