import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeInboundAdReferral,
  createFakeWhatsAppAdReferral,
  createFakeWhatsAppAdSettings,
  createFakeWhatsAppAdSpend,
} from '@/src/__tests__/factories/nov-z4-ctwa-attribution.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/whatsapp-ad.repository')
vi.mock('@/src/repositories/crm-lead.repository', () => ({
  CrmLeadRepository: { update: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../crm-lead.service', () => ({
  CrmLeadService: { intake: vi.fn() },
}))
vi.mock('../crm-notifications', () => ({
  notifyCrmLeadAssigned: vi.fn(async () => 1),
}))
vi.mock('../whatsapp-conversation.service', () => ({
  WhatsAppConversationService: { get: vi.fn() },
}))
vi.mock('../whatsapp-notify', () => ({
  whatsAppAdminIds: vi.fn(async () => ['admin1']),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppAdRepository } from '@/src/repositories/whatsapp-ad.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmLeadService } from '../crm-lead.service'
import { notifyCrmLeadAssigned } from '../crm-notifications'
import { WhatsAppAdAttributionService } from '../whatsapp-ad-attribution.service'
import { WhatsAppConversationService } from '../whatsapp-conversation.service'
import { whatsAppAdminIds } from '../whatsapp-notify'

const memberships = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const repo = vi.mocked(WhatsAppAdRepository)
const leadRepo = vi.mocked(CrmLeadRepository)
const intake = vi.mocked(CrmLeadService.intake)
const conversations = vi.mocked(WhatsAppConversationService)
const adminIds = vi.mocked(whatsAppAdminIds)
const notifyAssigned = vi.mocked(notifyCrmLeadAssigned)

const WS = 'ws1'

function asRole(role: 'VIEWER' | 'MEMBER' | 'ADMIN' | 'OWNER') {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole('ADMIN')
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  adminIds.mockResolvedValue(['admin1'])
})

describe('settings', () => {
  it('returns the defaults (everything off) before the first save', async () => {
    repo.findSettings.mockResolvedValue(ok(null))
    const value = expectOk(
      await WhatsAppAdAttributionService.getSettings('u1', WS),
    )
    expect(value).toEqual({
      enabled: false,
      createLeads: false,
      leadOwnerId: null,
      leadSource: 'Anúncio Click-to-WhatsApp',
    })
  })

  it('returns the stored settings', async () => {
    repo.findSettings.mockResolvedValue(
      ok(
        createFakeWhatsAppAdSettings({
          enabled: true,
          createLeads: true,
          leadOwnerId: 'u2',
          leadSource: 'Meta',
        }),
      ),
    )
    expect(
      expectOk(await WhatsAppAdAttributionService.getSettings('u1', WS)),
    ).toEqual({
      enabled: true,
      createLeads: true,
      leadOwnerId: 'u2',
      leadSource: 'Meta',
    })
  })

  it('refuses a plain member', async () => {
    asRole('MEMBER')
    expectErr(await WhatsAppAdAttributionService.getSettings('u1', WS))
    expect(repo.findSettings).not.toHaveBeenCalled()
  })

  it('refuses when the module is off', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    const error = expectErr(
      await WhatsAppAdAttributionService.getSettings('u1', WS),
    )
    expect(error.code).toBe('MODULE_DISABLED')
  })

  it('propagates a database error on read', async () => {
    repo.findSettings.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppAdAttributionService.getSettings('u1', WS))
  })

  it('merges a partial update with the stored value and audits it', async () => {
    repo.findSettings.mockResolvedValue(
      ok(createFakeWhatsAppAdSettings({ enabled: true, leadSource: 'Meta' })),
    )
    repo.upsertSettings.mockImplementation(async (workspaceId, data) =>
      ok(createFakeWhatsAppAdSettings({ workspaceId, ...data } as never)),
    )

    const value = expectOk(
      await WhatsAppAdAttributionService.updateSettings('u1', WS, {
        createLeads: true,
      }),
    )

    expect(value).toMatchObject({
      enabled: true,
      createLeads: true,
      leadSource: 'Meta',
      leadOwnerId: null,
    })
    expect(repo.upsertSettings).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ updatedById: 'u1', createLeads: true }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_ad_settings',
        action: 'update',
        actorId: 'u1',
      }),
    )
  })

  it('sets and clears the lead owner', async () => {
    repo.findSettings.mockResolvedValue(
      ok(createFakeWhatsAppAdSettings({ leadOwnerId: 'u2' })),
    )
    repo.upsertSettings.mockImplementation(async (workspaceId, data) =>
      ok(createFakeWhatsAppAdSettings({ workspaceId, ...data } as never)),
    )

    const cleared = expectOk(
      await WhatsAppAdAttributionService.updateSettings('u1', WS, {
        leadOwnerId: null,
      }),
    )
    expect(cleared.leadOwnerId).toBeNull()

    const set = expectOk(
      await WhatsAppAdAttributionService.updateSettings('u1', WS, {
        leadOwnerId: 'u3',
        leadSource: 'Novo',
      }),
    )
    expect(set).toMatchObject({ leadOwnerId: 'u3', leadSource: 'Novo' })
  })

  it('refuses an owner that is not a member of the workspace', async () => {
    memberships.findByUserAndWorkspace
      .mockResolvedValueOnce(ok(createFakeMembership({ role: 'ADMIN' })))
      .mockResolvedValueOnce(ok(null))
    const error = expectErr(
      await WhatsAppAdAttributionService.updateSettings('u1', WS, {
        leadOwnerId: 'stranger',
      }),
    )
    expect(error.code).toBe('FORBIDDEN')
    expect(repo.upsertSettings).not.toHaveBeenCalled()
  })

  it('propagates errors while checking the owner, reading and saving', async () => {
    memberships.findByUserAndWorkspace
      .mockResolvedValueOnce(ok(createFakeMembership({ role: 'ADMIN' })))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppAdAttributionService.updateSettings('u1', WS, {
        leadOwnerId: 'u2',
      }),
    )

    asRole('ADMIN')
    repo.findSettings.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppAdAttributionService.updateSettings('u1', WS, {
        enabled: true,
      }),
    )

    repo.findSettings.mockResolvedValueOnce(ok(null))
    repo.upsertSettings.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppAdAttributionService.updateSettings('u1', WS, {
        enabled: true,
      }),
    )
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('refuses a member on update', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppAdAttributionService.updateSettings('u1', WS, {
        enabled: true,
      }),
    )
  })
})

describe('onInboundReferral', () => {
  const contact = { id: 'ct1', name: 'Maria', waId: '5511988887777' }
  const input = {
    workspaceId: WS,
    contact,
    conversationId: 'cv1',
    providerMessageId: 'wamid.1',
    referral: createFakeInboundAdReferral(),
  }
  const stored = createFakeWhatsAppAdReferral({ id: 'ref1', workspaceId: WS })
  const leadDto = (overrides: Record<string, unknown> = {}) =>
    ({ id: 'lead1', name: 'Maria', ownerId: null, ...overrides }) as never

  beforeEach(() => {
    repo.findSettings.mockResolvedValue(
      ok(createFakeWhatsAppAdSettings({ workspaceId: WS, enabled: true })),
    )
    repo.createReferral.mockResolvedValue(ok(stored))
    repo.linkLead.mockResolvedValue(ok(stored))
    repo.leadHasReferral.mockResolvedValue(ok(false))
    leadRepo.update.mockResolvedValue(ok({} as never))
  })

  const withLeads = (overrides = {}) =>
    repo.findSettings.mockResolvedValue(
      ok(
        createFakeWhatsAppAdSettings({
          workspaceId: WS,
          enabled: true,
          createLeads: true,
          ...overrides,
        }),
      ),
    )

  it('does nothing while the attribution is off', async () => {
    repo.findSettings.mockResolvedValueOnce(ok(null))
    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    repo.findSettings.mockResolvedValueOnce(
      ok(createFakeWhatsAppAdSettings({ enabled: false })),
    )
    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    expect(repo.createReferral).not.toHaveBeenCalled()
  })

  it('stores the referral without opening a lead when leads are off', async () => {
    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    expect(repo.createReferral).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        contactId: 'ct1',
        conversationId: 'cv1',
        providerMessageId: 'wamid.1',
        sourceId: '120210000000001',
        headline: 'Promoção de verão',
        ctwaClid: 'clid-1',
      }),
    )
    expect(intake).not.toHaveBeenCalled()
  })

  it('propagates database errors from settings and storage', async () => {
    repo.findSettings.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppAdAttributionService.onInboundReferral(input))
    repo.createReferral.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppAdAttributionService.onInboundReferral(input))
  })

  it('treats a webhook retry (already stored) as done', async () => {
    withLeads()
    repo.createReferral.mockResolvedValue(ok(null))
    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    expect(intake).not.toHaveBeenCalled()
  })

  it('opens the lead with the ad as origin and links the referral', async () => {
    withLeads({ leadSource: 'Meta Ads' })
    intake.mockResolvedValue(
      ok({ lead: leadDto({ ownerId: 'routed' }), created: true }),
    )

    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))

    expect(intake).toHaveBeenCalledWith(
      WS,
      {
        kind: 'system',
        createdById: 'admin1',
        via: 'whatsapp_ad',
        refId: 'ref1',
      },
      {
        name: 'Maria',
        phones: ['5511988887777'],
        source: 'Meta Ads · Promoção de verão',
        channel: 'WhatsApp',
      },
    )
    expect(repo.linkLead).toHaveBeenCalledWith('ref1', 'lead1')
    expect(leadRepo.update).not.toHaveBeenCalled()
  })

  it('names a nameless contact by the phone and uses the owner as creator', async () => {
    withLeads({ leadOwnerId: 'owner1' })
    intake.mockResolvedValue(
      ok({ lead: leadDto({ ownerId: 'owner1' }), created: true }),
    )

    expectOk(
      await WhatsAppAdAttributionService.onInboundReferral({
        ...input,
        contact: { ...contact, name: null },
      }),
    )

    expect(intake).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ createdById: 'owner1' }),
      expect.objectContaining({ name: '5511988887777' }),
    )
    expect(adminIds).not.toHaveBeenCalled()
  })

  it('assigns the configured owner when the routing rules left it empty', async () => {
    withLeads({ leadOwnerId: 'owner1' })
    intake.mockResolvedValue(ok({ lead: leadDto(), created: true }))

    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))

    expect(leadRepo.update).toHaveBeenCalledWith('lead1', {
      ownerId: 'owner1',
    })
    expect(notifyAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner1', workspaceId: WS }),
    )
    expect(repo.linkLead).toHaveBeenCalled()
  })

  it('still links the lead when assigning the owner fails', async () => {
    withLeads({ leadOwnerId: 'owner1' })
    intake.mockResolvedValue(ok({ lead: leadDto(), created: true }))
    leadRepo.update.mockResolvedValue(err(databaseError()))

    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))

    expect(notifyAssigned).not.toHaveBeenCalled()
    expect(repo.linkLead).toHaveBeenCalledWith('ref1', 'lead1')
  })

  it('skips contacts that only have a BSUID (no phone for the lead)', async () => {
    withLeads()
    expectOk(
      await WhatsAppAdAttributionService.onInboundReferral({
        ...input,
        contact: { ...contact, waId: 'BR.123456' },
      }),
    )
    expect(intake).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      'whatsapp.ad.lead_skipped_no_phone',
      expect.anything(),
    )
  })

  it('skips the lead when nobody can be the creator', async () => {
    withLeads()
    adminIds.mockResolvedValue([])
    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    expect(intake).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.ad.lead_skipped_no_creator',
      expect.anything(),
    )
  })

  it('logs and goes on when the CRM refuses the lead', async () => {
    withLeads()
    intake.mockResolvedValue(err(databaseError()))
    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    expect(repo.linkLead).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.ad.lead_failed',
      expect.anything(),
    )
  })

  it('links a deduplicated lead only when no ad owns it yet (first touch)', async () => {
    withLeads()
    intake.mockResolvedValue(ok({ lead: leadDto(), created: false }))

    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    expect(repo.linkLead).toHaveBeenCalledWith('ref1', 'lead1')
    expect(leadRepo.update).not.toHaveBeenCalled()

    repo.linkLead.mockClear()
    repo.leadHasReferral.mockResolvedValue(ok(true))
    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    expect(repo.linkLead).not.toHaveBeenCalled()

    repo.leadHasReferral.mockResolvedValue(err(databaseError()))
    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    expect(repo.linkLead).not.toHaveBeenCalled()
  })

  it('logs a failed link without failing the webhook', async () => {
    withLeads()
    intake.mockResolvedValue(ok({ lead: leadDto(), created: true }))
    repo.linkLead.mockResolvedValue(err(databaseError()))
    expectOk(await WhatsAppAdAttributionService.onInboundReferral(input))
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.ad.lead_link_failed',
      expect.anything(),
    )
  })
})

describe('getConversationReferral', () => {
  it('delegates visibility to the conversation service', async () => {
    conversations.get.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppAdAttributionService.getConversationReferral(
        'u1',
        WS,
        'cv1',
      ),
    )
    expect(repo.findLatestByConversation).not.toHaveBeenCalled()
  })

  it('returns null for an ordinary conversation and the DTO for an ad one', async () => {
    conversations.get.mockResolvedValue(ok({} as never))
    repo.findLatestByConversation.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(
        await WhatsAppAdAttributionService.getConversationReferral(
          'u1',
          WS,
          'cv1',
        ),
      ),
    ).toBeNull()

    repo.findLatestByConversation.mockResolvedValueOnce(
      ok(
        createFakeWhatsAppAdReferral({
          id: 'ref1',
          conversationId: 'cv1',
          leadId: 'lead1',
        }),
      ),
    )
    expect(
      expectOk(
        await WhatsAppAdAttributionService.getConversationReferral(
          'u1',
          WS,
          'cv1',
        ),
      ),
    ).toMatchObject({
      id: 'ref1',
      conversationId: 'cv1',
      headline: 'Promoção de verão',
      leadId: 'lead1',
      receivedAt: '2026-10-10T15:00:00.000Z',
    })

    repo.findLatestByConversation.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppAdAttributionService.getConversationReferral(
        'u1',
        WS,
        'cv1',
      ),
    )
  })
})

describe('report', () => {
  const query = { from: '2026-10-01', to: '2026-10-31' }

  it('refuses a member (it shows money)', async () => {
    asRole('MEMBER')
    expectErr(await WhatsAppAdAttributionService.report('u1', WS, query))
  })

  it('joins referrals, lead outcomes and prorated spend', async () => {
    repo.listReferralsInRange.mockResolvedValue(
      ok([
        createFakeWhatsAppAdReferral({
          conversationId: 'cv1',
          contactId: 'ct1',
          leadId: 'lead1',
        }),
        createFakeWhatsAppAdReferral({
          conversationId: 'cv2',
          contactId: 'ct2',
          leadId: 'lead1',
        }),
        createFakeWhatsAppAdReferral({ conversationId: 'cv3', leadId: null }),
      ]),
    )
    repo.listLeadOutcomes.mockResolvedValue(
      ok([{ id: 'lead1', closeResult: 'WON', closedAmount: 2000 }]),
    )
    repo.listSpendsOverlapping.mockResolvedValue(
      ok([createFakeWhatsAppAdSpend({ amount: 1000 as never })]),
    )

    const report = expectOk(
      await WhatsAppAdAttributionService.report('u1', WS, query),
    )

    // One lead id, even though two referrals point to it.
    expect(repo.listLeadOutcomes).toHaveBeenCalledWith(WS, ['lead1'])
    expect(repo.listSpendsOverlapping).toHaveBeenCalledWith(
      WS,
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-31T00:00:00Z'),
    )
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      conversations: 3,
      leads: 1,
      leadsWon: 1,
      revenue: 2000,
      spend: 1000,
      roi: 1,
    })
  })

  it('propagates each repository failure', async () => {
    repo.listReferralsInRange.mockResolvedValue(ok([]))
    repo.listLeadOutcomes.mockResolvedValue(ok([]))
    repo.listSpendsOverlapping.mockResolvedValue(ok([]))

    repo.listReferralsInRange.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppAdAttributionService.report('u1', WS, query))
    repo.listLeadOutcomes.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppAdAttributionService.report('u1', WS, query))
    repo.listSpendsOverlapping.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppAdAttributionService.report('u1', WS, query))
  })
})

describe('exportCsv', () => {
  const query = { from: '2026-10-01', to: '2026-10-31' }

  it('writes the header and one line per ad', async () => {
    repo.listReferralsInRange.mockResolvedValue(
      ok([createFakeWhatsAppAdReferral({ sourceId: 'ad-9' })]),
    )
    repo.listLeadOutcomes.mockResolvedValue(ok([]))
    repo.listSpendsOverlapping.mockResolvedValue(ok([]))

    const csv = expectOk(
      await WhatsAppAdAttributionService.exportCsv('u1', WS, query),
    )
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      '﻿Id do anúncio,Anúncio,Tipo,Cliques,Conversas,Leads,Leads ganhos,Gasto,Receita,Custo por conversa,Custo por lead,ROI',
    )
    expect(lines[1]).toBe('ad-9,Promoção de verão,ad,1,1,0,0,0,0,,,')
  })

  it('propagates a report failure', async () => {
    asRole('MEMBER')
    expectErr(await WhatsAppAdAttributionService.exportCsv('u1', WS, query))
  })
})

describe('spends', () => {
  const dto = {
    sourceId: 'ad1',
    label: '',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-10',
    amount: 100,
    note: '',
  }

  it('lists the spends as DTOs', async () => {
    repo.listSpends.mockResolvedValue(
      ok([createFakeWhatsAppAdSpend({ id: 's1', amount: 150.5 as never })]),
    )
    expect(
      expectOk(await WhatsAppAdAttributionService.listSpends('u1', WS)),
    ).toEqual([
      {
        id: 's1',
        sourceId: '120210000000001',
        label: 'Promoção de verão',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-10',
        amount: 150.5,
        note: null,
        createdAt: '2026-10-11T12:00:00.000Z',
      },
    ])
  })

  it('refuses members and propagates errors when listing', async () => {
    asRole('MEMBER')
    expectErr(await WhatsAppAdAttributionService.listSpends('u1', WS))
    asRole('ADMIN')
    repo.listSpends.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppAdAttributionService.listSpends('u1', WS))
  })

  it('creates a spend turning blank texts into null and audits it', async () => {
    repo.createSpend.mockImplementation(async (data) =>
      ok(
        createFakeWhatsAppAdSpend({
          ...data,
          amount: data.amount as never,
        } as never),
      ),
    )

    const value = expectOk(
      await WhatsAppAdAttributionService.createSpend('u1', WS, dto),
    )

    expect(repo.createSpend).toHaveBeenCalledWith({
      workspaceId: WS,
      sourceId: 'ad1',
      label: null,
      periodStart: new Date('2026-10-01T00:00:00Z'),
      periodEnd: new Date('2026-10-10T00:00:00Z'),
      amount: 100,
      note: null,
      createdById: 'u1',
    })
    expect(value.amount).toBe(100)
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_ad_spend',
        action: 'create',
        actorId: 'u1',
      }),
    )
  })

  it('refuses members and propagates errors when creating', async () => {
    asRole('MEMBER')
    expectErr(await WhatsAppAdAttributionService.createSpend('u1', WS, dto))
    asRole('ADMIN')
    repo.createSpend.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppAdAttributionService.createSpend('u1', WS, dto))
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('deletes a spend of the workspace and audits it', async () => {
    repo.deleteSpend.mockResolvedValue(ok(true))
    expectOk(await WhatsAppAdAttributionService.deleteSpend('u1', WS, 's1'))
    expect(repo.deleteSpend).toHaveBeenCalledWith(WS, 's1')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_ad_spend',
        action: 'delete',
      }),
    )
  })

  it('answers not found for a spend of another workspace', async () => {
    repo.deleteSpend.mockResolvedValue(ok(false))
    const error = expectErr(
      await WhatsAppAdAttributionService.deleteSpend('u1', WS, 'other'),
    )
    expect(error.code).toBe('WHATSAPP_AD_SPEND_NOT_FOUND')
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('refuses members and propagates errors when deleting', async () => {
    asRole('MEMBER')
    expectErr(await WhatsAppAdAttributionService.deleteSpend('u1', WS, 's1'))
    asRole('ADMIN')
    repo.deleteSpend.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppAdAttributionService.deleteSpend('u1', WS, 's1'))
  })
})
