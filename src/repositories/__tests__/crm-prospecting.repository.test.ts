import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmProspectDraft,
  seedCrmProspectDraft,
} from '@/src/__tests__/factories/nov-prospecting-agent.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  CrmProspectDraftRepository as Drafts,
  CrmProspectingSettingsRepository as Settings,
  CrmProspectUsageRepository as Usage,
} from '../crm-prospecting.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function seed() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

describe('CrmProspectingSettingsRepository', () => {
  it('should find nothing, then create with both channels and update', async () => {
    const { workspace, user } = await seed()
    expect(expectOk(await Settings.find(workspace.id))).toBeNull()

    const created = expectOk(
      await Settings.upsert(workspace.id, { enabled: true }, user.id),
    )
    expect(created.enabled).toBe(true)
    expect(created.allowedChannels).toEqual(['EMAIL', 'WHATSAPP'])
    expect(created.monthlyWebLimit).toBe(300)
    expect(created.updatedById).toBe(user.id)

    const updated = expectOk(
      await Settings.upsert(
        workspace.id,
        {
          monthlyWebLimit: 10,
          allowedChannels: ['EMAIL'],
          signalKeywords: ['pabx'],
          valueProposition: null,
        },
        user.id,
      ),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.enabled).toBe(true)
    expect(updated.monthlyWebLimit).toBe(10)
    expect(updated.allowedChannels).toEqual(['EMAIL'])
    expect(updated.signalKeywords).toEqual(['pabx'])
  })

  it('should be off in a workspace that never saved anything', async () => {
    const { workspace, user } = await seed()
    await Settings.upsert(workspace.id, { enabled: true }, user.id)
    const other = await seedWorkspace()
    expect(expectOk(await Settings.find(other.id))).toBeNull()
  })

  it('should wrap database failures', async () => {
    vi.spyOn(prisma.crmProspectingSettings, 'findUnique').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Settings.find('ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProspectingSettings, 'upsert').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Settings.upsert('ws', {}, 'u'), 'DATABASE_ERROR')
  })
})

describe('CrmProspectUsageRepository', () => {
  const period = new Date(Date.UTC(2026, 10, 1))

  it('should create the month row and keep counting each field', async () => {
    const { workspace } = await seed()
    expect(expectOk(await Usage.find(workspace.id, period))).toBeNull()

    await Usage.increment(workspace.id, period, 'searches')
    await Usage.increment(workspace.id, period, 'searches')
    await Usage.increment(workspace.id, period, 'fetches')
    const row = expectOk(await Usage.increment(workspace.id, period, 'drafts'))
    expect(row).toMatchObject({ searches: 2, fetches: 1, drafts: 1 })

    const found = expectOk(await Usage.find(workspace.id, period))
    expect(found?.searches).toBe(2)
  })

  it('should keep one row per month', async () => {
    const { workspace } = await seed()
    await Usage.increment(workspace.id, period, 'fetches')
    const next = new Date(Date.UTC(2026, 11, 1))
    const row = expectOk(await Usage.increment(workspace.id, next, 'fetches'))
    expect(row.fetches).toBe(1)
    expect(await prisma.crmProspectUsage.count({ where: { workspaceId: workspace.id } })).toBe(2)
  })

  it('should wrap database failures', async () => {
    vi.spyOn(prisma.crmProspectUsage, 'findUnique').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Usage.find('ws', period), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProspectUsage, 'upsert').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Usage.increment('ws', period, 'drafts'), 'DATABASE_ERROR')
  })
})

describe('CrmProspectDraftRepository', () => {
  it('should list the workspace drafts and filter by status, lead and company', async () => {
    const { workspace, user } = await seed()
    const first = await seedCrmProspectDraft(workspace.id, user.id, {
      leadId: 'lead-a',
    })
    const second = await seedCrmProspectDraft(workspace.id, user.id, {
      leadId: null,
      companyId: 'co-1',
      status: 'APPROVED',
    })
    await seedCrmProspectDraft(workspace.id, user.id, {
      workspaceId: (await seedWorkspace()).id,
    })

    const all = expectOk(await Drafts.list(workspace.id, { limit: 10 }))
    expect(all.map((d) => d.id).sort()).toEqual([first.id, second.id].sort())

    expect(
      expectOk(await Drafts.list(workspace.id, { limit: 10, status: 'APPROVED' })),
    ).toHaveLength(1)
    expect(
      expectOk(await Drafts.list(workspace.id, { limit: 10, leadId: 'lead-a' }))[0].id,
    ).toBe(first.id)
    expect(
      expectOk(await Drafts.list(workspace.id, { limit: 10, companyId: 'co-1' }))[0].id,
    ).toBe(second.id)
    expect(expectOk(await Drafts.list(workspace.id, { limit: 1 }))).toHaveLength(1)
  })

  it('should create through the repository', async () => {
    const { workspace, user } = await seed()
    const fake = createFakeCrmProspectDraft()
    const created = expectOk(
      await Drafts.create({
        workspaceId: workspace.id,
        leadId: 'lead-1',
        companyId: null,
        personId: null,
        targetName: fake.targetName,
        channel: 'EMAIL',
        subject: 'Oi',
        body: fake.body,
        toEmail: 'a@b.com',
        toPhone: null,
        summary: null,
        signals: [],
        sources: [],
        agentId: null,
        createdById: user.id,
      }),
    )
    expect(created.status).toBe('PENDING')
  })

  it('should find by id only inside the workspace', async () => {
    const { workspace, user } = await seed()
    const draft = await seedCrmProspectDraft(workspace.id, user.id)
    expect(expectOk(await Drafts.findById(draft.id, workspace.id)).id).toBe(draft.id)
    const stranger = await seedWorkspace()
    expectErr(
      await Drafts.findById(draft.id, stranger.id),
      'CRM_PROSPECT_DRAFT_NOT_FOUND',
    )
  })

  it('should find a pending draft for the same lead or company and channel', async () => {
    const { workspace, user } = await seed()
    await seedCrmProspectDraft(workspace.id, user.id, { leadId: 'lead-a' })
    await seedCrmProspectDraft(workspace.id, user.id, {
      leadId: null,
      companyId: 'co-1',
    })

    const byLead = { leadId: 'lead-a', companyId: null }
    expect(expectOk(await Drafts.findPendingFor(workspace.id, byLead, 'EMAIL'))).not.toBeNull()
    expect(expectOk(await Drafts.findPendingFor(workspace.id, byLead, 'WHATSAPP'))).toBeNull()
    expect(
      expectOk(
        await Drafts.findPendingFor(workspace.id, { leadId: null, companyId: 'co-1' }, 'EMAIL'),
      ),
    ).not.toBeNull()
    // With a lead, the company is not enough on its own.
    expect(
      expectOk(
        await Drafts.findPendingFor(workspace.id, { leadId: 'lead-b', companyId: 'co-1' }, 'EMAIL'),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await Drafts.findPendingFor(workspace.id, { leadId: null, companyId: null }, 'EMAIL'),
      ),
    ).toBeNull()
  })

  it('should not see decided drafts as pending', async () => {
    const { workspace, user } = await seed()
    await seedCrmProspectDraft(workspace.id, user.id, {
      leadId: 'lead-a',
      status: 'REJECTED',
    })
    expect(
      expectOk(
        await Drafts.findPendingFor(workspace.id, { leadId: 'lead-a', companyId: null }, 'EMAIL'),
      ),
    ).toBeNull()
  })

  it('should update only a pending draft', async () => {
    const { workspace, user } = await seed()
    const draft = await seedCrmProspectDraft(workspace.id, user.id)

    const edited = expectOk(
      await Drafts.updatePending(draft.id, workspace.id, { body: 'Novo texto' }),
    )
    expect(edited?.body).toBe('Novo texto')

    const approved = expectOk(
      await Drafts.updatePending(draft.id, workspace.id, {
        status: 'APPROVED',
        decidedById: user.id,
        decidedAt: new Date(),
      }),
    )
    expect(approved?.status).toBe('APPROVED')

    expect(
      expectOk(await Drafts.updatePending(draft.id, workspace.id, { body: 'Tarde demais' })),
    ).toBeNull()
    const stranger = await seedWorkspace()
    expect(
      expectOk(await Drafts.updatePending(draft.id, stranger.id, { body: 'x' })),
    ).toBeNull()
  })

  it('should mark SENT only from APPROVED, once', async () => {
    const { workspace, user } = await seed()
    const pending = await seedCrmProspectDraft(workspace.id, user.id)
    expect(expectOk(await Drafts.markSent(pending.id, workspace.id, user.id))).toBeNull()

    const approved = await seedCrmProspectDraft(workspace.id, user.id, {
      leadId: 'lead-z',
      status: 'APPROVED',
    })
    const sent = expectOk(await Drafts.markSent(approved.id, workspace.id, user.id))
    expect(sent?.status).toBe('SENT')
    expect(sent?.decidedById).toBe(user.id)
    expect(expectOk(await Drafts.markSent(approved.id, workspace.id, user.id))).toBeNull()
  })

  it('should wrap database failures', async () => {
    const boom = new Error('down')
    vi.spyOn(prisma.crmProspectDraft, 'findMany').mockRejectedValue(boom)
    expectErr(await Drafts.list('ws', { limit: 1 }), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProspectDraft, 'findFirst').mockRejectedValue(boom)
    expectErr(await Drafts.findById('d', 'ws'), 'DATABASE_ERROR')
    expectErr(
      await Drafts.findPendingFor('ws', { leadId: 'l', companyId: null }, 'EMAIL'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmProspectDraft, 'create').mockRejectedValue(boom)
    expectErr(
      await Drafts.create({
        workspaceId: 'ws',
        leadId: 'l',
        companyId: null,
        personId: null,
        targetName: 'x',
        channel: 'EMAIL',
        subject: null,
        body: 'x',
        toEmail: null,
        toPhone: null,
        summary: null,
        signals: [],
        sources: [],
        agentId: null,
        createdById: 'u',
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmProspectDraft, 'updateMany').mockRejectedValue(boom)
    expectErr(await Drafts.updatePending('d', 'ws', {}), 'DATABASE_ERROR')
    expectErr(await Drafts.markSent('d', 'ws', 'u'), 'DATABASE_ERROR')
  })
})
