import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../notification-emitter', () => ({
  emitNotification: vi.fn(),
}))

import {
  notifyCrmCampaignFinished,
  notifyCrmCompetitorSyncFailed,
  notifyCrmDealClosed,
  notifyCrmFormSubmitted,
  notifyCrmLeadAssigned,
  notifyCrmOpportunityAssigned,
  notifyCrmProposalAccepted,
  notifyCrmProposalExpired,
  notifyCrmProposalViewed,
  notifyCrmSocialPostFailed,
  notifyCrmTaskAssigned,
  notifyCrmTaskDue,
  notifyCrmWorkflowFailed,
  notifyCrmWorkflowWaiting,
} from '../crm-notifications'
import { emitNotification } from '../notification-emitter'

const mockedEmit = vi.mocked(emitNotification)

function lastCall() {
  return mockedEmit.mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedEmit.mockResolvedValue(1)
})

describe('CRM notifications', () => {
  it('lead assigned: owner, actor, link to the record, routed copy', async () => {
    await notifyCrmLeadAssigned({
      workspaceId: 'ws1',
      lead: { id: 'l1', name: 'Jane' },
      ownerId: 'u2',
      actorId: null,
      routed: true,
    })
    expect(lastCall()).toEqual({
      workspaceId: 'ws1',
      recipients: ['u2'],
      actorId: null,
      kind: 'CRM_LEAD_ASSIGNED',
      title: 'Lead atribuído a você: Jane',
      body: expect.stringContaining('roteamento'),
      path: '/crm/leads?record=l1',
    })

    await notifyCrmLeadAssigned({
      workspaceId: 'ws1',
      lead: { id: 'l1', name: 'Jane' },
      ownerId: 'u2',
      actorId: 'u1',
    })
    expect(lastCall()?.body).toBe('Você agora é o responsável por este lead.')
  })

  it('opportunity assigned', async () => {
    await notifyCrmOpportunityAssigned({
      workspaceId: 'ws1',
      opportunity: { id: 'o1', name: 'ERP' },
      ownerId: 'u2',
      actorId: 'u1',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_OPPORTUNITY_ASSIGNED',
        recipients: ['u2'],
        actorId: 'u1',
        path: '/crm/opportunities?record=o1',
      }),
    )
  })

  it('deal closed: won and lost copy', async () => {
    const lead = { id: 'l1', name: 'Jane', ownerId: 'u2' }
    await notifyCrmDealClosed({
      workspaceId: 'ws1',
      lead,
      result: 'WON',
      actorId: 'u1',
    })
    expect(lastCall()?.title).toBe('Negócio ganho: Jane')
    await notifyCrmDealClosed({
      workspaceId: 'ws1',
      lead,
      result: 'LOST',
      actorId: 'u1',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_DEAL_CLOSED',
        title: 'Negócio perdido: Jane',
        recipients: ['u2'],
      }),
    )
  })

  it('task assigned and task due (soon/overdue, date-scoped dedupe)', async () => {
    await notifyCrmTaskAssigned({
      workspaceId: 'ws1',
      task: { id: 't1', title: 'Ligar' },
      assigneeId: 'u2',
      actorId: 'u1',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_TASK_ASSIGNED',
        path: '/crm/tasks?record=t1',
      }),
    )

    const task = {
      id: 't1',
      title: 'Ligar',
      assigneeId: 'u2',
      dueDate: new Date('2026-10-06T15:00:00.000Z'),
    }
    await notifyCrmTaskDue({ workspaceId: 'ws1', task, overdue: false })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_TASK_DUE',
        title: 'Tarefa vence em breve: Ligar',
        dedupeKey: 'crm-task-due:t1:2026-10-06T15:00:00.000Z:soon',
      }),
    )
    await notifyCrmTaskDue({ workspaceId: 'ws1', task, overdue: true })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        title: 'Tarefa atrasada: Ligar',
        dedupeKey: 'crm-task-due:t1:2026-10-06T15:00:00.000Z:overdue',
      }),
    )
  })

  it('proposal viewed / accepted / expired go to the responsible, once each', async () => {
    const proposal = { id: 'p1', name: 'Proposta ERP', responsibleId: 'u2' }
    await notifyCrmProposalViewed({ workspaceId: 'ws1', proposal })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_PROPOSAL_VIEWED',
        recipients: ['u2'],
        path: '/crm/proposals/p1',
        dedupeKey: 'crm-proposal-viewed:p1',
      }),
    )
    await notifyCrmProposalAccepted({
      workspaceId: 'ws1',
      proposal,
      acceptedByName: 'Maria',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_PROPOSAL_ACCEPTED',
        body: 'Maria aceitou a proposta.',
      }),
    )
    await notifyCrmProposalExpired({ workspaceId: 'ws1', proposal })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_PROPOSAL_EXPIRED',
        dedupeKey: 'crm-proposal-expired:p1',
      }),
    )
  })

  it('form submitted goes to the form owner', async () => {
    await notifyCrmFormSubmitted({
      workspaceId: 'ws1',
      form: { id: 'f1', name: 'Contato', createdById: 'u2' },
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_FORM_SUBMITTED',
        recipients: ['u2'],
        title: 'Nova resposta: Contato',
        path: '/crm/forms/f1',
      }),
    )
  })

  it('campaign finished: sent (with and without failures) and failed', async () => {
    const campaign = { id: 'c1', subject: 'Outubro', createdById: 'u2' }
    await notifyCrmCampaignFinished({
      workspaceId: 'ws1',
      campaign,
      status: 'SENT',
      sent: 10,
      failed: 0,
      actorId: null,
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_CAMPAIGN_FINISHED',
        title: 'Campanha enviada: Outubro',
        body: '10 e-mail(s) enviado(s).',
        dedupeKey: 'crm-campaign-finished:c1',
      }),
    )
    await notifyCrmCampaignFinished({
      workspaceId: 'ws1',
      campaign,
      status: 'SENT',
      sent: 8,
      failed: 2,
      actorId: null,
    })
    expect(lastCall()?.body).toBe('8 e-mail(s) enviado(s), 2 com falha.')
    await notifyCrmCampaignFinished({
      workspaceId: 'ws1',
      campaign,
      status: 'FAILED',
      sent: 0,
      failed: 10,
      actorId: 'u1',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        title: 'Falha no envio da campanha: Outubro',
        actorId: 'u1',
      }),
    )
  })

  it('workflow failed: excerpt of the error, or a generic body', async () => {
    const workflow = { id: 'w1', name: 'Boas-vindas', createdById: 'u2' }
    await notifyCrmWorkflowFailed({
      workspaceId: 'ws1',
      workflow,
      runId: 'r1',
      error: `x${'a'.repeat(300)}`,
      actorId: null,
    })
    const body = lastCall()?.body ?? ''
    expect(body.startsWith('Uma execução falhou: x')).toBe(true)
    expect(body.endsWith('…')).toBe(true)
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_WORKFLOW_FAILED',
        dedupeKey: 'crm-workflow-failed:r1',
        path: '/crm/workflows/w1',
      }),
    )
    await notifyCrmWorkflowFailed({
      workspaceId: 'ws1',
      workflow,
      runId: 'r1',
      error: null,
      actorId: null,
    })
    expect(lastCall()?.body).toBe('Uma execução falhou.')
  })

  it('workflow waiting: the assignee, falling back to the owner', async () => {
    const workflow = { id: 'w1', name: 'Desconto', createdById: 'owner' }
    const input = {
      workspaceId: 'ws1',
      workflow,
      stepId: 's1',
      formTitle: 'Aprovar',
      actorId: null,
    }

    expect(
      await notifyCrmWorkflowWaiting({ ...input, assigneeId: 'seller' }),
    ).toBe(1)
    expect(mockedEmit).toHaveBeenCalledTimes(1)
    expect(lastCall()).toEqual(
      expect.objectContaining({
        recipients: ['seller'],
        kind: 'CRM_WORKFLOW_WAITING',
        dedupeKey: 'crm-workflow-waiting:s1',
      }),
    )

    mockedEmit.mockClear()
    mockedEmit.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    await notifyCrmWorkflowWaiting({ ...input, assigneeId: 'not-member' })
    expect(mockedEmit).toHaveBeenCalledTimes(2)
    expect(lastCall()?.recipients).toEqual(['owner'])

    mockedEmit.mockClear()
    await notifyCrmWorkflowWaiting({ ...input, assigneeId: null })
    expect(mockedEmit).toHaveBeenCalledTimes(1)
    expect(lastCall()?.recipients).toEqual(['owner'])
  })

  it('social post failed: title, content excerpt or fallback label', async () => {
    const post = {
      id: 'sp1',
      title: 'Lançamento',
      content: 'texto',
      createdById: 'u2',
    }
    await notifyCrmSocialPostFailed({
      workspaceId: 'ws1',
      post,
      partial: false,
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_SOCIAL_POST_FAILED',
        title: 'Falha na publicação: Lançamento',
        recipients: ['u2'],
        dedupeKey: 'crm-social-post-failed:sp1',
      }),
    )
    await notifyCrmSocialPostFailed({
      workspaceId: 'ws1',
      post: { ...post, title: null, content: '  Olá   mundo ' },
      partial: true,
    })
    expect(lastCall()?.title).toBe('Publicação parcial: Olá mundo')
    await notifyCrmSocialPostFailed({
      workspaceId: 'ws1',
      post: { ...post, title: null, content: '' },
      partial: false,
    })
    expect(lastCall()?.title).toBe('Falha na publicação: post')
  })

  it('competitor sync failed: admins, once per day per workspace', async () => {
    await notifyCrmCompetitorSyncFailed({
      workspaceId: 'ws1',
      adminIds: ['a1', 'a2'],
      failed: 3,
      day: '2026-10-06',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_COMPETITOR_SYNC_FAILED',
        recipients: ['a1', 'a2'],
        dedupeKey: 'crm-competitor-sync-failed:ws1:2026-10-06',
      }),
    )
  })
})

describe('notifyCrmApolloImportDone', () => {
  it('sends one summary to the creator with a per-import dedupe key', async () => {
    const { notifyCrmApolloImportDone } = await import('../crm-notifications')
    await notifyCrmApolloImportDone({
      workspaceId: 'ws1',
      importId: 'i1',
      recipientId: 'u1',
      created: 1,
      skipped: 2,
      failed: 0,
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'CRM_APOLLO_IMPORT_DONE',
        recipients: ['u1'],
        dedupeKey: 'crm-apollo-import:i1',
        title: 'Importação da Apollo concluída: 1 lead criado',
      }),
    )
    await notifyCrmApolloImportDone({
      workspaceId: 'ws1',
      importId: 'i2',
      recipientId: 'u1',
      created: 3,
      skipped: 0,
      failed: 0,
    })
    expect(lastCall()?.title).toContain('3 leads criados')
  })
})
