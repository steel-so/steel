import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  seedCrmPipeline,
  seedCrmPipelineStage,
} from '@/src/__tests__/factories/crm-pipeline.factory'
import { seedSearchableOpportunity } from '@/src/__tests__/factories/nov-c10-nl-search.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  buildOpportunityOrderBy,
  buildOpportunityWhere,
} from '@/src/lib/crm-nl-search'
import { prisma } from '@/src/lib/prisma'
import { CrmNlSearchFilterSchema } from '@/src/schemas/crm-nl-search.schema'
import { CrmOpportunityRepository } from '../crm-opportunity.repository'

const NOW = new Date('2026-10-29T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const pipeline = await seedCrmPipeline(workspace.id, user.id)
  const open = await seedCrmPipelineStage(pipeline.id, {
    name: 'Negociação',
    category: 'OPEN',
  })
  const won = await seedCrmPipelineStage(pipeline.id, {
    name: 'Ganho',
    category: 'WON',
  })
  return { workspace, user, pipeline, open, won }
}

function run(
  workspaceId: string,
  actorId: string,
  raw: Record<string, unknown>,
) {
  const filter = CrmNlSearchFilterSchema.parse(raw)
  return CrmOpportunityRepository.search(
    buildOpportunityWhere(workspaceId, filter, { now: NOW, actorId }),
    buildOpportunityOrderBy(filter),
    50,
  )
}

describe('CrmOpportunityRepository.search()', () => {
  afterEach(() => vi.restoreAllMocks())

  it('finds open deals stalled for 15 days above 10k, not the others', async () => {
    const { workspace, user, pipeline, open, won } = await setup()
    const hit = await seedSearchableOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      { name: 'Hit', amount: 25000 as never, updatedAt: daysAgo(20) },
    )
    await seedSearchableOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      {
        name: 'Fresh',
        amount: 25000 as never,
        updatedAt: daysAgo(2),
      },
    )
    await seedSearchableOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      {
        name: 'Small',
        amount: 500 as never,
        updatedAt: daysAgo(30),
      },
    )
    await seedSearchableOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      won.id,
      {
        name: 'Won',
        amount: 25000 as never,
        updatedAt: daysAgo(30),
      },
    )

    const rows = expectOk(
      await run(workspace.id, user.id, {
        status: 'OPEN',
        amountMin: 10000,
        stalledForDays: 15,
      }),
    )
    expect(rows.map((r) => r.id)).toEqual([hit.id])
  })

  it('never returns deleted rows nor other workspaces', async () => {
    const { workspace, user, pipeline, open } = await setup()
    const other = await setup()
    await seedSearchableOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      {
        deletedAt: new Date(),
      },
    )
    await seedSearchableOpportunity(
      other.workspace.id,
      other.user.id,
      other.pipeline.id,
      other.open.id,
    )

    const rows = expectOk(await run(workspace.id, user.id, { status: 'ANY' }))
    expect(rows).toEqual([])
  })

  it('filters by owner, stage name, text and close date, and sorts by amount', async () => {
    const { workspace, user, pipeline, open } = await setup()
    const mine = await seedSearchableOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      {
        name: 'Contrato Acme',
        amount: 100 as never,
        ownerId: user.id,
        closeDate: new Date(NOW.getTime() + 5 * 86_400_000),
      },
    )
    const mineBig = await seedSearchableOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      {
        name: 'Acme grande',
        amount: 900 as never,
        ownerId: user.id,
        closeDate: new Date(NOW.getTime() + 6 * 86_400_000),
        source: 'indicação',
      },
    )
    await seedSearchableOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      {
        name: 'Sem dono',
        closeDate: new Date(NOW.getTime() - 86_400_000),
      },
    )

    const sorted = expectOk(
      await run(workspace.id, user.id, {
        ownedByMe: true,
        stageContains: 'negoc',
        textContains: 'acme',
        closingWithinDays: 10,
        sort: 'AMOUNT_DESC',
      }),
    )
    expect(sorted.map((r) => r.id)).toEqual([mineBig.id, mine.id])

    const unassigned = expectOk(
      await run(workspace.id, user.id, {
        unassigned: true,
        closeDateOverdue: true,
      }),
    )
    expect(unassigned.map((r) => r.name)).toEqual(['Sem dono'])

    const bySource = expectOk(
      await run(workspace.id, user.id, { textContains: 'indica' }),
    )
    expect(bySource.map((r) => r.id)).toEqual([mineBig.id])
  })

  it('caps the rows with take', async () => {
    const { workspace, user, pipeline, open } = await setup()
    for (let i = 0; i < 3; i++) {
      await seedSearchableOpportunity(
        workspace.id,
        user.id,
        pipeline.id,
        open.id,
        {
          position: i,
        },
      )
    }
    const filter = CrmNlSearchFilterSchema.parse({ status: 'ANY' })
    const rows = expectOk(
      await CrmOpportunityRepository.search(
        buildOpportunityWhere(workspace.id, filter, {
          now: NOW,
          actorId: user.id,
        }),
        buildOpportunityOrderBy(filter),
        2,
      ),
    )
    expect(rows).toHaveLength(2)
  })

  it('returns a database error when the query fails', async () => {
    vi.spyOn(prisma.crmOpportunity, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    const result = await CrmOpportunityRepository.search({}, [], 5)
    expect(expectErr(result).code).toBe('DATABASE_ERROR')
  })
})
