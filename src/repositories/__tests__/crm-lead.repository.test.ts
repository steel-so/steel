import { describe, expect, it, vi } from 'vitest'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { seedCrmProduct } from '@/src/__tests__/factories/crm-product.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmLeadRepository } from '../crm-lead.repository'

describe('CrmLeadRepository', () => {
  describe('create()', () => {
    it('should assign the next position within the workspace', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      await seedCrmLead(workspace.id, user.id)

      const result = await CrmLeadRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Second',
        score: 0,
      })

      const lead = expectOk(result)
      expect(lead.position).toBe(1)
    })
  })

  describe('findOpenByContacts()', () => {
    it('should match an open lead by e-mail ignoring case', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const seeded = await seedCrmLead(workspace.id, user.id, {
        emails: ['Jane@Acme.com'],
      })

      const found = expectOk(
        await CrmLeadRepository.findOpenByContacts(workspace.id, {
          emails: ['jane@acme.com'],
          phones: [],
        }),
      )
      expect(found?.id).toBe(seeded.id)
    })

    it('should match by phone digits regardless of formatting', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const seeded = await seedCrmLead(workspace.id, user.id, {
        phones: ['(81) 99999-0000'],
      })

      const found = expectOk(
        await CrmLeadRepository.findOpenByContacts(workspace.id, {
          emails: [],
          phones: ['81999990000'],
        }),
      )
      expect(found?.id).toBe(seeded.id)
    })

    it('should ignore closed, deleted and other-workspace leads', async () => {
      const [workspace, other, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      const emails = ['jane@acme.com']
      await seedCrmLead(workspace.id, user.id, { emails, stage: 'CLOSED' })
      await seedCrmLead(workspace.id, user.id, {
        emails,
        deletedAt: new Date(),
      })
      await seedCrmLead(other.id, user.id, { emails })

      const found = expectOk(
        await CrmLeadRepository.findOpenByContacts(workspace.id, {
          emails,
          phones: [],
        }),
      )
      expect(found).toBeNull()
    })

    it('should return null without contacts', async () => {
      const workspace = await seedWorkspace()
      const found = expectOk(
        await CrmLeadRepository.findOpenByContacts(workspace.id, {
          emails: [],
          phones: [],
        }),
      )
      expect(found).toBeNull()
    })
  })

  describe('listByWorkspace()', () => {
    it('should filter by stage when provided', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const qualified = await seedCrmLead(workspace.id, user.id, {
        stage: 'QUALIFIED',
      })
      await seedCrmLead(workspace.id, user.id, { stage: 'RECEIVED' })

      const list = expectOk(
        await CrmLeadRepository.listByWorkspace(workspace.id, {
          stage: 'QUALIFIED',
        }),
      )
      expect(list.map((l) => l.id)).toEqual([qualified.id])
    })

    it('should exclude soft-deleted leads', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const kept = await seedCrmLead(workspace.id, user.id)
      await seedCrmLead(workspace.id, user.id, { deletedAt: new Date() })

      const list = expectOk(
        await CrmLeadRepository.listByWorkspace(workspace.id),
      )
      expect(list.map((l) => l.id)).toEqual([kept.id])
    })
  })

  describe('findById()', () => {
    it('should return RESOURCE_NOT_FOUND for another workspace', async () => {
      const [workspaceA, workspaceB, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      const seeded = await seedCrmLead(workspaceA.id, user.id)

      expectErr(
        await CrmLeadRepository.findById(seeded.id, workspaceB.id),
        'RESOURCE_NOT_FOUND',
      )
    })
  })

  describe('createContactAttempt() / listContactAttempts()', () => {
    it('should list attempts newest first', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const lead = await seedCrmLead(workspace.id, user.id)

      const first = expectOk(
        await CrmLeadRepository.createContactAttempt({
          leadId: lead.id,
          workspaceId: workspace.id,
          createdById: user.id,
          contactedWith: 'Maria',
          channel: 'PHONE',
          outcome: 'ATTEMPTED',
          occurredAt: new Date('2026-01-01'),
        }),
      )
      const second = expectOk(
        await CrmLeadRepository.createContactAttempt({
          leadId: lead.id,
          workspaceId: workspace.id,
          createdById: user.id,
          contactedWith: 'Maria',
          channel: 'WHATSAPP',
          outcome: 'REACHED',
          occurredAt: new Date('2026-01-02'),
        }),
      )

      const list = expectOk(
        await CrmLeadRepository.listContactAttempts(lead.id),
      )
      expect(list.map((a) => a.id)).toEqual([second.id, first.id])
    })
  })

  describe('setInterestProducts()', () => {
    it('should replace the previous set of interest products', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const lead = await seedCrmLead(workspace.id, user.id)
      const [productA, productB] = await Promise.all([
        seedCrmProduct(workspace.id, user.id),
        seedCrmProduct(workspace.id, user.id),
      ])

      expectOk(
        await CrmLeadRepository.setInterestProducts(lead.id, [productA.id]),
      )
      expectOk(
        await CrmLeadRepository.setInterestProducts(lead.id, [productB.id]),
      )

      const remaining = await prisma.crmLeadInterestProduct.findMany({
        where: { leadId: lead.id },
      })
      expect(remaining.map((r) => r.productId)).toEqual([productB.id])
    })
  })

  describe('upsertQualification() / findQualification()', () => {
    it('should create then update the single qualification record', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const lead = await seedCrmLead(workspace.id, user.id)

      await CrmLeadRepository.upsertQualification({
        leadId: lead.id,
        qualifiedById: user.id,
        decisionMakerName: 'Carlos',
        decisionMakerRole: 'CTO',
      })
      await CrmLeadRepository.upsertQualification({
        leadId: lead.id,
        qualifiedById: user.id,
        decisionMakerName: 'Carla',
        decisionMakerRole: 'CEO',
      })

      const found = expectOk(await CrmLeadRepository.findQualification(lead.id))
      expect(found?.decisionMakerName).toBe('Carla')
    })

    it('should return null when no qualification exists yet', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const lead = await seedCrmLead(workspace.id, user.id)

      const found = expectOk(await CrmLeadRepository.findQualification(lead.id))
      expect(found).toBeNull()
    })
  })

  describe('createMeeting() / listMeetings()', () => {
    it('should list meetings for the lead', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const lead = await seedCrmLead(workspace.id, user.id)

      await CrmLeadRepository.createMeeting({
        leadId: lead.id,
        workspaceId: workspace.id,
        createdById: user.id,
        scheduledAt: new Date(),
        format: 'ONLINE',
        interestDetails: 'Quer automatizar o funil',
        identifiedNeed: 'Falta de visibilidade',
      })

      const list = expectOk(await CrmLeadRepository.listMeetings(lead.id))
      expect(list).toHaveLength(1)
    })
  })

  describe('createProposalPresentation() / listProposalPresentations()', () => {
    it('should list presentations for the lead', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const lead = await seedCrmLead(workspace.id, user.id)

      await CrmLeadRepository.createProposalPresentation({
        leadId: lead.id,
        documentId: 'doc-1',
        createdById: user.id,
        presentedAt: new Date(),
        format: 'ONLINE',
        amount: 1500,
        interestLevel: 'HIGH',
        interactionsCount: 3,
      })

      const list = expectOk(
        await CrmLeadRepository.listProposalPresentations(lead.id),
      )
      expect(list).toHaveLength(1)
      expect(Number(list[0]?.amount)).toBe(1500)
    })

    it('should list only the given proposal document presentations', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const lead = await seedCrmLead(workspace.id, user.id)
      for (const documentId of ['doc-a', 'doc-b']) {
        await CrmLeadRepository.createProposalPresentation({
          leadId: lead.id,
          documentId,
          createdById: user.id,
          presentedAt: new Date(),
          format: 'ONLINE',
          amount: 1500,
          interestLevel: 'HIGH',
          interactionsCount: 3,
        })
      }

      const list = expectOk(
        await CrmLeadRepository.listProposalPresentations(lead.id, 'doc-a'),
      )
      expect(list.map((p) => p.documentId)).toEqual(['doc-a'])
      expect(list[0]?.proposalId).toBeNull()
    })
  })

  describe('reopen()', () => {
    it('should move a lost lead back, clear the loss and keep a snapshot', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const closedAt = new Date('2026-09-01T12:00:00.000Z')
      const retryAt = new Date('2026-12-01T12:00:00.000Z')
      const lead = await seedCrmLead(workspace.id, user.id, {
        stage: 'CLOSED',
        closeResult: 'LOST',
        closedAt,
        lostReason: 'Preço',
        lostNote: 'Achou caro',
        retryAt,
      })

      const reopened = expectOk(
        await CrmLeadRepository.reopen(lead.id, {
          workspaceId: workspace.id,
          toStage: 'IN_CONTACT',
          reason: 'Cliente pediu nova proposta',
          reopenedById: user.id,
        }),
      )

      expect(reopened.stage).toBe('IN_CONTACT')
      expect(reopened.closeResult).toBeNull()
      expect(reopened.closedAt).toBeNull()
      expect(reopened.lostReason).toBeNull()
      expect(reopened.lostNote).toBeNull()
      expect(reopened.retryAt).toBeNull()
      expect(reopened.updatedById).toBe(user.id)

      const history = expectOk(await CrmLeadRepository.listReopenings(lead.id))
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        toStage: 'IN_CONTACT',
        reason: 'Cliente pediu nova proposta',
        previousLostReason: 'Preço',
        previousLostNote: 'Achou caro',
        previousClosedAt: closedAt,
        previousRetryAt: retryAt,
        reopenedById: user.id,
      })
    })

    it('should refuse a lead that is not lost (won or already reopened)', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const won = await seedCrmLead(workspace.id, user.id, {
        stage: 'CLOSED',
        closeResult: 'WON',
      })

      expectErr(
        await CrmLeadRepository.reopen(won.id, {
          workspaceId: workspace.id,
          toStage: 'RECEIVED',
          reason: 'x',
          reopenedById: user.id,
        }),
        'CRM_LEAD_REOPEN_NOT_ALLOWED',
      )
      expect(
        expectOk(await CrmLeadRepository.listReopenings(won.id)),
      ).toHaveLength(0)
    })

    it('should not reopen a lead of another workspace', async () => {
      const [workspace, other, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      const lead = await seedCrmLead(other.id, user.id, {
        stage: 'CLOSED',
        closeResult: 'LOST',
      })

      expectErr(
        await CrmLeadRepository.reopen(lead.id, {
          workspaceId: workspace.id,
          toStage: 'RECEIVED',
          reason: 'x',
          reopenedById: user.id,
        }),
        'CRM_LEAD_REOPEN_NOT_ALLOWED',
      )
    })
  })

  describe('listReopenings()', () => {
    it('should list the history newest first', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const lead = await seedCrmLead(workspace.id, user.id)
      await prisma.crmLeadReopening.createMany({
        data: [
          {
            leadId: lead.id,
            workspaceId: workspace.id,
            toStage: 'RECEIVED',
            reason: 'primeira',
            reopenedById: user.id,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            leadId: lead.id,
            workspaceId: workspace.id,
            toStage: 'RECEIVED',
            reason: 'segunda',
            reopenedById: user.id,
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
          },
        ],
      })

      const history = expectOk(await CrmLeadRepository.listReopenings(lead.id))
      expect(history.map((r) => r.reason)).toEqual(['segunda', 'primeira'])
    })
  })
})

describe('CrmLeadRepository (lifecycle and failures)', () => {
  it('should find a lead of the workspace by id', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const lead = await seedCrmLead(workspace.id, user.id)

    expect(
      expectOk(await CrmLeadRepository.findById(lead.id, workspace.id)).id,
    ).toBe(lead.id)
  })

  it('should update a lead and soft delete it', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const lead = await seedCrmLead(workspace.id, user.id)

    const updated = expectOk(
      await CrmLeadRepository.update(lead.id, {
        stage: 'QUALIFIED',
        score: 40,
        emails: ['novo@example.com'],
        updatedById: user.id,
      }),
    )
    expect(updated).toMatchObject({
      stage: 'QUALIFIED',
      score: 40,
      emails: ['novo@example.com'],
    })

    expectOk(await CrmLeadRepository.softDelete(lead.id))
    expectErr(
      await CrmLeadRepository.findById(lead.id, workspace.id),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should reorder leads of the workspace', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const a = await seedCrmLead(workspace.id, user.id, { position: 0 })
    const b = await seedCrmLead(workspace.id, user.id, { position: 1 })

    expectOk(await CrmLeadRepository.reorder(workspace.id, [b.id, a.id]))

    const list = expectOk(await CrmLeadRepository.listByWorkspace(workspace.id))
    expect(list.map((l) => l.id)).toEqual([b.id, a.id])
  })

  it('should refuse to reorder a lead from another workspace', async () => {
    const [workspace, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const foreign = await seedCrmLead(other.id, user.id, { position: 5 })

    expectErr(
      await CrmLeadRepository.reorder(workspace.id, [foreign.id]),
      'DATABASE_ERROR',
    )
    const stored = await prisma.crmLead.findUniqueOrThrow({
      where: { id: foreign.id },
    })
    expect(stored.position).toBe(5)
  })

  it('should return DATABASE_ERROR when writes hit missing rows or FKs', async () => {
    const user = await seedUser()

    expectErr(
      await CrmLeadRepository.create({
        workspaceId: 'missing',
        createdById: user.id,
        name: 'X',
        score: 0,
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmLeadRepository.update('missing', { name: 'x' }),
      'DATABASE_ERROR',
    )
    expectErr(await CrmLeadRepository.softDelete('missing'), 'DATABASE_ERROR')
    expectErr(
      await CrmLeadRepository.createContactAttempt({
        leadId: 'missing',
        workspaceId: 'missing',
        createdById: user.id,
        contactedWith: 'x',
        channel: 'PHONE',
        outcome: 'ATTEMPTED',
        occurredAt: new Date(),
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmLeadRepository.setInterestProducts('missing', ['missing']),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmLeadRepository.upsertQualification({
        leadId: 'missing',
        qualifiedById: user.id,
        decisionMakerName: 'x',
        decisionMakerRole: 'y',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmLeadRepository.createMeeting({
        leadId: 'missing',
        workspaceId: 'missing',
        createdById: user.id,
        scheduledAt: new Date(),
        format: 'ONLINE',
        interestDetails: 'x',
        identifiedNeed: 'y',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmLeadRepository.createProposalPresentation({
        leadId: 'missing',
        documentId: 'missing',
        createdById: user.id,
        presentedAt: new Date(),
        format: 'ONLINE',
        amount: 1,
        interestLevel: 'LOW',
        interactionsCount: 0,
      }),
      'DATABASE_ERROR',
    )
  })

  it('should keep the previous interest products when the replacement fails', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const lead = await seedCrmLead(workspace.id, user.id)
    const product = await seedCrmProduct(workspace.id, user.id)
    expectOk(await CrmLeadRepository.setInterestProducts(lead.id, [product.id]))

    expectErr(
      await CrmLeadRepository.setInterestProducts(lead.id, ['missing']),
      'DATABASE_ERROR',
    )
    expect(
      await prisma.crmLeadInterestProduct.count({ where: { leadId: lead.id } }),
    ).toBe(1)
  })

  it('should return DATABASE_ERROR when reads throw', async () => {
    vi.spyOn(prisma.crmLead, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    vi.spyOn(prisma.crmLead, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(prisma.crmLeadContactAttempt, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    vi.spyOn(prisma.crmLeadQualification, 'findUnique').mockRejectedValueOnce(
      new Error('boom'),
    )
    vi.spyOn(prisma.crmLeadMeeting, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    vi.spyOn(
      prisma.crmLeadProposalPresentation,
      'findMany',
    ).mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(prisma.crmLeadReopening, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )

    expectErr(await CrmLeadRepository.listByWorkspace('w'), 'DATABASE_ERROR')
    expectErr(await CrmLeadRepository.findById('l', 'w'), 'DATABASE_ERROR')
    expectErr(
      await CrmLeadRepository.findOpenByContacts('w', {
        emails: ['a@example.com'],
        phones: [],
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmLeadRepository.listContactAttempts('l'),
      'DATABASE_ERROR',
    )
    expectErr(await CrmLeadRepository.findQualification('l'), 'DATABASE_ERROR')
    expectErr(await CrmLeadRepository.listMeetings('l'), 'DATABASE_ERROR')
    expectErr(
      await CrmLeadRepository.listProposalPresentations('l'),
      'DATABASE_ERROR',
    )
    expectErr(await CrmLeadRepository.listReopenings('l'), 'DATABASE_ERROR')
  })

  it('should return DATABASE_ERROR when the reopen transaction fails', async () => {
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await CrmLeadRepository.reopen('l', {
        workspaceId: 'w',
        toStage: 'IN_CONTACT',
        reason: 'x',
        reopenedById: 'u',
      }),
      'DATABASE_ERROR',
    )
  })
})
