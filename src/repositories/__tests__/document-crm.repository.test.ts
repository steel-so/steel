import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { seedDocument } from '@/src/__tests__/factories/document-migration.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { DocumentCrmRepository as Repo } from '../document-crm.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DocumentCrmRepository', () => {
  it('creates a proposal document', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const doc = expectOk(
      await Repo.create({
        workspaceId: workspace.id,
        kind: 'PROPOSAL',
        title: 'Proposta X',
        templateId: null,
        source: 'BLANK',
        content: { version: 1, rootId: 'root', nodes: {} },
        theme: {},
        settings: { layout: 'web' },
        companyId: null,
        personId: null,
        opportunityId: null,
        leadId: null,
        ownerId: user.id,
        createdById: user.id,
        validUntil: null,
        publicToken: 'tok-x',
        totalValue: 99.9,
      }),
    )
    expect(doc).toMatchObject({ title: 'Proposta X', status: 'DRAFT' })
    expect(Number(doc.totalValue)).toBe(99.9)
  })

  it('finds live documents of the workspace only', async () => {
    const [workspace, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const doc = await seedDocument(workspace.id, user.id)
    const gone = await seedDocument(workspace.id, user.id, {
      deletedAt: new Date(),
    })

    expect(expectOk(await Repo.findById(doc.id, workspace.id))?.id).toBe(doc.id)
    expect(expectOk(await Repo.findById(doc.id, other.id))).toBeNull()
    expect(expectOk(await Repo.findById(gone.id, workspace.id))).toBeNull()
  })

  it('returns the newest live proposal of a lead', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const lead = await seedCrmLead(workspace.id, user.id)
    await seedDocument(workspace.id, user.id, {
      leadId: lead.id,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    const newest = await seedDocument(workspace.id, user.id, {
      leadId: lead.id,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    })
    await seedDocument(workspace.id, user.id, {
      leadId: lead.id,
      kind: 'CONTRACT',
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    })
    await seedDocument(workspace.id, user.id, {
      leadId: lead.id,
      isTemplate: true,
      createdAt: new Date('2026-11-02T00:00:00.000Z'),
    })

    expect(
      expectOk(await Repo.latestProposalByLead(lead.id, workspace.id))?.id,
    ).toBe(newest.id)
    expect(
      expectOk(await Repo.latestProposalByLead('nope', workspace.id)),
    ).toBeNull()
  })

  it('lists documents with the filters, newest update first', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const lead = await seedCrmLead(workspace.id, user.id)
    const sent = await seedDocument(workspace.id, user.id, {
      status: 'SENT',
      leadId: lead.id,
    })
    const draft = await seedDocument(workspace.id, user.id)
    const template = await seedDocument(workspace.id, user.id, {
      isTemplate: true,
    })
    await seedDocument(workspace.id, user.id, { kind: 'CONTRACT' })

    const proposals = expectOk(
      await Repo.list(workspace.id, { kind: 'PROPOSAL', take: 10 }),
    )
    expect(proposals.map((d) => d.id).sort()).toEqual(
      [sent.id, draft.id].sort(),
    )
    expect(
      expectOk(
        await Repo.list(workspace.id, {
          kind: 'PROPOSAL',
          status: 'SENT',
          leadId: lead.id,
          take: 10,
        }),
      ).map((d) => d.id),
    ).toEqual([sent.id])
    expect(
      expectOk(
        await Repo.list(workspace.id, { isTemplate: true, take: 10 }),
      ).map((d) => d.id),
    ).toEqual([template.id])
    expect(
      expectOk(
        await Repo.list(workspace.id, { opportunityId: 'nope', take: 10 }),
      ),
    ).toEqual([])
  })

  it('maps failures to DATABASE_ERROR', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.document, 'create').mockRejectedValueOnce(boom)
    expectErr(await Repo.create({} as never), 'DATABASE_ERROR')
    vi.spyOn(prisma.document, 'findFirst').mockRejectedValueOnce(boom)
    expectErr(await Repo.findById('x', 'ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.document, 'findFirst').mockRejectedValueOnce(boom)
    expectErr(await Repo.latestProposalByLead('x', 'ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.document, 'findMany').mockRejectedValueOnce(boom)
    expectErr(await Repo.list('ws', { take: 1 }), 'DATABASE_ERROR')
  })
})
