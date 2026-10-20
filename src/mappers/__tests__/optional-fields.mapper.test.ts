import type {
  AdminAuditLog,
  AdminOperation,
  CrmProposalView,
  CrmScheduledPostMedia,
} from '@prisma/client'
import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeCrmEmailCampaign,
  createFakeCrmEmailCampaignRecipient,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { createFakeCrmEmailAccount } from '@/src/__tests__/factories/crm-email-sync.factory'
import { createFakeCrmForm } from '@/src/__tests__/factories/crm-form.factory'
import { createFakeCrmIntegrationKey } from '@/src/__tests__/factories/crm-integration-key.factory'
import {
  createFakeCrmLead,
  createFakeCrmLeadReopening,
} from '@/src/__tests__/factories/crm-lead.factory'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { createFakeCrmProposal } from '@/src/__tests__/factories/crm-proposal.factory'
import { createFakeCrmProposalTemplateSection } from '@/src/__tests__/factories/crm-proposal-template.factory'
import { createFakeCrmReport } from '@/src/__tests__/factories/crm-report.factory'
import {
  createFakeCrmScheduledPost,
  createFakeCrmScheduledPostTarget,
} from '@/src/__tests__/factories/crm-social.factory'
import {
  createFakeCrmWorkflow,
  createFakeCrmWorkflowRun,
  createFakeCrmWorkflowRunStep,
} from '@/src/__tests__/factories/crm-workflow.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import {
  toAdminAuditEntryDTO,
  toAdminOperationDTO,
} from '../admin-workspace.mapper'
import {
  toCrmEmailCampaignDTO,
  toCrmEmailCampaignRecipientDTO,
} from '../crm-email-marketing.mapper'
import { toCrmEmailAccountDTO } from '../crm-email-sync.mapper'
import { toCrmFormDTO } from '../crm-form.mapper'
import { toCrmIntegrationKeyDTO } from '../crm-integration-key.mapper'
import { toCrmLeadDTO, toCrmLeadReopeningDTO } from '../crm-lead.mapper'
import { toCrmOpportunityDTO } from '../crm-opportunity.mapper'
import {
  toCrmProposalDTO,
  toCrmProposalMetricsDTO,
  toCrmProposalViewDTO,
} from '../crm-proposal.mapper'
import { toCrmProposalTemplateSectionDTO } from '../crm-proposal-template.mapper'
import { legacyToQuery, toCrmReportDTO } from '../crm-report.mapper'
import {
  toCrmScheduledPostDTO,
  toCrmScheduledPostMediaDTO,
  toCrmScheduledPostTargetDTO,
} from '../crm-social.mapper'
import {
  toCrmWorkflowDTO,
  toCrmWorkflowRunDTO,
  toCrmWorkflowRunStepDTO,
} from '../crm-workflow.mapper'
import { toWhatsAppContactDTO } from '../whatsapp-contact.mapper'
import { toWhatsAppConversationEventDTO } from '../whatsapp-conversation-event.mapper'

const AT = new Date('2026-09-01T12:00:00.000Z')
const ISO = AT.toISOString()

describe('admin mappers — meta edge cases', () => {
  const operation: AdminOperation = {
    id: 'op1',
    kind: 'WORKSPACE_RESTORE',
    status: 'COMPLETED',
    step: 'done',
    workspaceId: 'ws1',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    backupId: 'b1',
    requestedById: 'admin1',
    requestedByEmail: 'admin@stratustelecom.com.br',
    reason: 'restauração',
    error: null,
    meta: null,
    createdAt: AT,
    updatedAt: AT,
    completedAt: null,
  }

  it('exposes files error, safety backup and plan-less subscriptions', () => {
    const dto = toAdminOperationDTO({
      ...operation,
      meta: {
        filesError: 'bucket locked',
        safetyBackupId: 'safe1',
        subscriptionsToCancel: [{ billId: 'bill_2' }, null, 'bill_3'],
      },
    })

    expect(dto).toMatchObject({
      filesError: 'bucket locked',
      safetyBackupId: 'safe1',
      subscriptionsToCancel: [{ billId: 'bill_2', plan: '' }],
      completedAt: null,
    })
  })

  it('does not flag audit entries without meta as failures', () => {
    const entry: AdminAuditLog = {
      id: 'a1',
      actorId: 'admin1',
      actorEmail: 'admin@stratustelecom.com.br',
      action: 'workspace.suspended',
      targetType: 'workspace',
      targetId: 'ws1',
      targetLabel: 'acme',
      reason: null,
      meta: null,
      createdAt: AT,
    }

    expect(toAdminAuditEntryDTO(entry).failed).toBe(false)
  })
})

describe('CRM mappers — dates that are set', () => {
  it('serializes e-mail campaign and recipient timestamps', () => {
    const campaign = createFakeCrmEmailCampaign({
      scheduledAt: AT,
      sentAt: AT,
    })
    const recipient = createFakeCrmEmailCampaignRecipient({ sentAt: AT })

    expect(toCrmEmailCampaignDTO(campaign)).toMatchObject({
      scheduledAt: ISO,
      sentAt: ISO,
    })
    expect(toCrmEmailCampaignRecipientDTO(recipient).sentAt).toBe(ISO)
  })

  it('serializes e-mail account, form, integration key and opportunity dates', () => {
    expect(
      toCrmEmailAccountDTO(createFakeCrmEmailAccount({ lastSyncedAt: AT }))
        .lastSyncedAt,
    ).toBe(ISO)
    expect(
      toCrmFormDTO(createFakeCrmForm({ publishedAt: AT })).publishedAt,
    ).toBe(ISO)
    expect(
      toCrmIntegrationKeyDTO(
        createFakeCrmIntegrationKey({ lastUsedAt: AT, revokedAt: AT }),
      ),
    ).toMatchObject({ lastUsedAt: ISO, revokedAt: ISO })
    expect(
      toCrmOpportunityDTO(createFakeCrmOpportunity({ closeDate: AT }))
        .closeDate,
    ).toBe(ISO)
  })

  it('converts the closed amount of a won lead and reopenings without a previous close', () => {
    expect(
      toCrmLeadDTO(
        createFakeCrmLead({ closedAmount: new Prisma.Decimal('1500.50') }),
      ).closedAmount,
    ).toBe(1500.5)
    expect(
      toCrmLeadReopeningDTO(
        createFakeCrmLeadReopening({ previousClosedAt: null }),
      ).previousClosedAt,
    ).toBeNull()
  })

  it('serializes an expired proposal and template section default content', () => {
    expect(
      toCrmProposalDTO(createFakeCrmProposal({ expiredAt: AT })).expiredAt,
    ).toBe(ISO)
    const content = { type: 'TEXT', html: '<p>Olá</p>' }
    expect(
      toCrmProposalTemplateSectionDTO(
        createFakeCrmProposalTemplateSection({
          defaultContent: content as Prisma.JsonValue,
        }),
      ).defaultContent,
    ).toEqual(content)
  })

  it('maps proposal views and derives the completion rate', () => {
    const view: CrmProposalView = {
      id: 'v1',
      proposalId: 'p1',
      viewId: 'visitor-1',
      ipHash: 'hash',
      durationMs: 3000,
      reachedEnd: true,
      scrolledPct: 100,
      referrer: null,
      createdAt: AT,
      updatedAt: AT,
    }

    expect(toCrmProposalViewDTO(view)).toEqual({
      id: 'v1',
      durationMs: 3000,
      reachedEnd: true,
      scrolledPct: 100,
      referrer: null,
      createdAt: ISO,
      updatedAt: ISO,
    })
    expect(
      toCrmProposalMetricsDTO({
        totalViews: 4,
        uniqueVisitors: 2,
        completed: 1,
        avgDurationMs: 1000,
        views: [view],
      }),
    ).toMatchObject({ completionRate: 0.25, views: [{ id: 'v1' }] })
    expect(
      toCrmProposalMetricsDTO({
        totalViews: 0,
        uniqueVisitors: 0,
        completed: 0,
        avgDurationMs: 0,
        views: [],
      }).completionRate,
    ).toBe(0)
  })
})

describe('CRM report mapper — legacy fields', () => {
  it('defaults missing legacy columns/filters and keeps the count sort alias', () => {
    const report = createFakeCrmReport({
      source: 'lead',
      columns: null as unknown as Prisma.JsonValue,
      filters: null as unknown as Prisma.JsonValue,
      groupBy: 'status',
      sort: { field: 'count', direction: 'desc' },
      query: null,
    })

    expect(legacyToQuery(report)).toMatchObject({
      columns: [],
      datasets: [{ alias: 'lead', source: 'lead', filters: [] }],
      sort: { field: 'count', direction: 'desc' },
    })
    expect(toCrmReportDTO(report)).toMatchObject({ columns: [], filters: [] })
  })
})

describe('CRM social mapper — published posts and media', () => {
  it('serializes publish dates of posts and targets', () => {
    expect(
      toCrmScheduledPostTargetDTO(
        createFakeCrmScheduledPostTarget({ publishedAt: AT }),
      ).publishedAt,
    ).toBe(ISO)
    expect(
      toCrmScheduledPostDTO(createFakeCrmScheduledPost({ publishedAt: AT }))
        .publishedAt,
    ).toBe(ISO)
  })

  it('maps attached media without exposing the storage key', () => {
    const media: CrmScheduledPostMedia = {
      id: 'm1',
      postId: 'p1',
      kind: 'VIDEO',
      storageKey: 'crm/p1/m1.mp4',
      contentType: 'video/mp4',
      sizeBytes: 2048,
      order: 1,
      createdAt: AT,
    }

    expect(toCrmScheduledPostMediaDTO(media)).toEqual({
      id: 'm1',
      kind: 'VIDEO',
      contentType: 'video/mp4',
      sizeBytes: 2048,
      order: 1,
    })
  })
})

describe('CRM workflow mapper — finished runs', () => {
  it('serializes run, step and workflow timestamps when set', () => {
    expect(
      toCrmWorkflowDTO(createFakeCrmWorkflow({ lastRunAt: AT, deletedAt: AT })),
    ).toMatchObject({ lastRunAt: ISO, deletedAt: ISO })
    expect(
      toCrmWorkflowRunStepDTO(
        createFakeCrmWorkflowRunStep({ startedAt: AT, finishedAt: AT }),
      ),
    ).toMatchObject({ startedAt: ISO, finishedAt: ISO })
    expect(
      toCrmWorkflowRunDTO(
        createFakeCrmWorkflowRun({
          startedAt: AT,
          finishedAt: AT,
          triggerPayload: { leadId: 'l1' },
        }),
      ),
    ).toMatchObject({
      startedAt: ISO,
      finishedAt: ISO,
      triggerPayload: { leadId: 'l1' },
    })
  })

  it('normalizes a missing trigger payload to null', () => {
    const run = createFakeCrmWorkflowRun({
      triggerPayload: undefined as unknown as Prisma.JsonValue,
    })
    expect(toCrmWorkflowRunDTO(run).triggerPayload).toBeNull()
  })
})

describe('WhatsApp mappers — relation counts and actors', () => {
  it('reads the conversation count from _count', () => {
    const contact = {
      ...createFakeWhatsAppContact(),
      _count: { conversations: 3 },
    }
    expect(toWhatsAppContactDTO(contact).conversationCount).toBe(3)
  })

  it('exposes the actor name of agent events and null for system events', () => {
    const base = {
      id: 'e1',
      workspaceId: 'ws1',
      conversationId: 'c1',
      kind: 'CLOSED' as const,
      source: 'AGENT' as const,
      actorUserId: 'u1',
      reason: 'resolvido',
      closeOutcome: null,
      closeStatusLabels: [],
      createdAt: AT,
    }

    expect(
      toWhatsAppConversationEventDTO({
        ...base,
        actorUser: { id: 'u1', name: 'Ana' },
      }).actorName,
    ).toBe('Ana')
    expect(
      toWhatsAppConversationEventDTO({
        ...base,
        source: 'INACTIVITY',
        actorUserId: null,
        actorUser: null,
      }),
    ).toMatchObject({ actorName: null, actorUserId: null, createdAt: ISO })
  })
})
