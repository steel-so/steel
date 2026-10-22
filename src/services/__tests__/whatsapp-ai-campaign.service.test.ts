import type { WhatsAppAiCampaign } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversation } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

const { queueAdd } = vi.hoisted(() => ({ queueAdd: vi.fn() }))

vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: () => ({ add: queueAdd }),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { template: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/services/whatsapp-usage.service', () => ({
  WhatsAppUsageService: {
    assertCanSend: vi.fn(async () => ({ ok: true, value: undefined })),
    record: vi.fn(async () => undefined),
  },
}))
vi.mock('@/src/services/whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: {
    check: vi.fn(async () => ({
      ok: true,
      value: { open: true, nextOpeningAt: null, hours: {} },
    })),
  },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock(
  '@/src/repositories/whatsapp-ai-campaign.repository',
  async (original) => {
    const actual =
      await original<
        typeof import('@/src/repositories/whatsapp-ai-campaign.repository')
      >()
    const mocked = Object.fromEntries(
      Object.keys(actual.WhatsAppAiCampaignRepository).map((key) => [
        key,
        vi.fn(),
      ]),
    )
    return { ...actual, WhatsAppAiCampaignRepository: mocked }
  },
)
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-team.repository')
vi.mock('@/src/repositories/whatsapp-close-status.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  emptyAiCampaignStats,
  WhatsAppAiCampaignRepository,
  type WhatsAppAiCampaignWithTemplate,
} from '@/src/repositories/whatsapp-ai-campaign.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppAiCampaignService } from '../whatsapp-ai-campaign.service'
import { WhatsAppBusinessHoursService } from '../whatsapp-business-hours.service'
import { WhatsAppUsageService } from '../whatsapp-usage.service'

const repo = vi.mocked(WhatsAppAiCampaignRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const send = vi.mocked(WhatsAppSend)

const components = [
  { type: 'BODY', text: 'Oi {{1}}, sua fatura de {{2}} vence amanhã.' },
]
const connection = createFakeWhatsAppConnection({
  id: 'c1',
  workspaceId: 'ws1',
  provider: 'META',
  module: 'COMMUNICATION',
})
const template = createFakeWhatsAppTemplate({
  id: 't1',
  workspaceId: 'ws1',
  connectionId: 'c1',
  name: 'cobranca',
  language: 'pt_BR',
  components,
})
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: 'ws1',
  waId: '5511999990000',
  name: 'Maria Souza',
})
const variables = {
  header: {},
  body: {
    '1': { source: 'CONTACT', field: 'FIRST_NAME' },
    '2': { source: 'COLUMN', column: 'valor' },
  },
  buttons: {},
}

function campaign(
  overrides: Partial<WhatsAppAiCampaign> = {},
): WhatsAppAiCampaign {
  return {
    id: 'cp1',
    workspaceId: 'ws1',
    name: 'Cobrança',
    objective: null,
    connectionId: 'c1',
    templateId: 't1',
    variables,
    headerMediaUrl: null,
    instructions: '',
    actions: [],
    intervalSeconds: 30,
    aiReplies: true,
    status: 'RUNNING',
    runToken: 'tok',
    lastSentAt: null,
    lastError: null,
    startedAt: null,
    finishedAt: null,
    createdById: 'u1',
    updatedById: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function withTemplate(
  overrides: Partial<WhatsAppAiCampaign> = {},
): WhatsAppAiCampaignWithTemplate {
  return {
    ...campaign(overrides),
    connection: { id: 'c1', provider: 'META', module: 'COMMUNICATION' },
    template: {
      id: 't1',
      name: 'cobranca',
      language: 'pt_BR',
      status: 'APPROVED',
      components,
      connectionId: 'c1',
    },
  }
}

function pendingRecipient(values: Record<string, string> = { valor: 'R$ 99' }) {
  return {
    id: 'r1',
    campaignId: 'cp1',
    contactId: 'ct1',
    status: 'PENDING' as const,
    values,
    conversationId: null,
    providerMessageId: null,
    errorMessage: null,
    sentAt: null,
    repliedAt: null,
    createdAt: new Date(),
    contact,
  }
}

function asRole(role: 'MEMBER' | 'VIEWER' | 'ADMIN') {
  vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  connectionRepo.findById.mockResolvedValue(ok(connection))
  templateRepo.findById.mockResolvedValue(ok(template))
  repo.statsFor.mockImplementation(async (ids) =>
    ok(
      new Map(ids.map((id) => [id, { ...emptyAiCampaignStats(), pending: 2 }])),
    ),
  )
  repo.countPending.mockResolvedValue(ok(2))
  repo.stopRun.mockResolvedValue(ok(true))
  repo.update.mockImplementation(async (_id, data) =>
    ok(withTemplate(data as Partial<WhatsAppAiCampaign>)),
  )
  repo.updateRecipient.mockResolvedValue(ok({} as never))
  conversationRepo.findActiveByContact.mockResolvedValue(ok(null))
  conversationRepo.findLatestClosedByContact.mockResolvedValue(ok(null))
  conversationRepo.create.mockResolvedValue(
    ok(createFakeWhatsAppConversation({ id: 'conv1', workspaceId: 'ws1' })),
  )
  conversationRepo.update.mockResolvedValue(
    ok(createFakeWhatsAppConversation({ id: 'conv1' })),
  )
  conversationRepo.findById.mockResolvedValue(ok(null))
  messageRepo.create.mockResolvedValue(ok(createFakeWhatsAppMessage()))
})

describe('WhatsAppAiCampaignService — management', () => {
  it('should list campaigns with their funnel and what blocks the play', async () => {
    asRole('ADMIN')
    repo.listByWorkspace.mockResolvedValue(
      ok([withTemplate({ status: 'DRAFT', variables: {} })]),
    )

    const [dto] = expectOk(await WhatsAppAiCampaignService.list('u1', 'ws1'))

    expect(dto.stats.pending).toBe(2)
    expect(dto.problems).toEqual([
      'Preencha as variáveis: Variável {{1}}, Variável {{2}}',
    ])
  })

  it('should create a draft and forbid a viewer', async () => {
    asRole('ADMIN')
    repo.create.mockResolvedValue(ok(withTemplate({ status: 'DRAFT' })))

    expectOk(
      await WhatsAppAiCampaignService.create('u1', 'ws1', { name: 'Cobrança' }),
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', name: 'Cobrança' }),
    )

    asRole('VIEWER')
    expectErr(
      await WhatsAppAiCampaignService.create('u1', 'ws1', { name: 'X' }),
      'FORBIDDEN',
    )
  })

  it('should refuse to change the template while running, but not the pace', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(ok(withTemplate()))

    expectErr(
      await WhatsAppAiCampaignService.update('u1', 'ws1', 'cp1', {
        templateId: 't2',
      }),
      'WHATSAPP_AI_CAMPAIGN_RUNNING',
    )
    expectOk(
      await WhatsAppAiCampaignService.update('u1', 'ws1', 'cp1', {
        intervalSeconds: 20,
      }),
    )
    expect(repo.update).toHaveBeenLastCalledWith(
      'cp1',
      expect.objectContaining({ intervalSeconds: 20 }),
    )
  })

  it('should reset the variables when the template changes', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(ok(withTemplate({ status: 'PAUSED' })))
    templateRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTemplate({ id: 't2', connectionId: 'c1' })),
    )

    expectOk(
      await WhatsAppAiCampaignService.update('u1', 'ws1', 'cp1', {
        templateId: 't2',
      }),
    )
    expect(repo.update).toHaveBeenLastCalledWith(
      'cp1',
      expect.objectContaining({ templateId: 't2', variables: {} }),
    )
  })

  it('should refuse a template of another connection', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(ok(withTemplate({ status: 'PAUSED' })))
    templateRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTemplate({ id: 't2', connectionId: 'other' })),
    )

    expectErr(
      await WhatsAppAiCampaignService.update('u1', 'ws1', 'cp1', {
        templateId: 't2',
      }),
      'VALIDATION_ERROR',
    )
  })

  it('should refuse an action pointing to a team that does not exist', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(ok(withTemplate({ status: 'PAUSED' })))
    vi.mocked(WhatsAppTeamRepository.findById).mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppAiCampaignService.update('u1', 'ws1', 'cp1', {
        actions: [
          {
            id: 'a1',
            kind: 'TRANSFER_TEAM',
            label: 'Financeiro',
            when: 'Quer negociar',
            teamId: 'gone',
          },
        ],
      }),
      'VALIDATION_ERROR',
    )
  })

  it('should answer not found for an archived campaign', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(ok(withTemplate({ status: 'ARCHIVED' })))

    expectErr(
      await WhatsAppAiCampaignService.get('u1', 'ws1', 'cp1'),
      'WHATSAPP_AI_CAMPAIGN_NOT_FOUND',
    )
  })

  it('should import spreadsheet rows, leaving out bad phones and opt-outs', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(ok(withTemplate({ status: 'DONE' })))
    repo.ensureContacts.mockResolvedValue(
      ok(
        new Map([
          ['5511999990000', { id: 'ct1', optedOut: false }],
          ['5511888880000', { id: 'ct2', optedOut: true }],
        ]),
      ),
    )
    repo.addRecipients.mockResolvedValue(ok(1))

    const dto = expectOk(
      await WhatsAppAiCampaignService.queue('u1', 'ws1', 'cp1', {
        rows: [
          { phone: '+55 (11) 99999-0000', values: { valor: 'R$ 99' } },
          { phone: '5511888880000', values: {} },
          { phone: '123', values: {} },
        ],
      }),
    )

    expect(repo.addRecipients).toHaveBeenCalledWith('cp1', [
      { contactId: 'ct1', values: { valor: 'R$ 99' } },
    ])
    expect(dto).toEqual(
      expect.objectContaining({
        added: 1,
        rejected: 1,
        optedOut: 1,
        status: 'PAUSED',
      }),
    )
  })

  it('should not clear the contacts of a running campaign', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(ok(withTemplate()))

    expectErr(
      await WhatsAppAiCampaignService.clear('u1', 'ws1', 'cp1', false),
      'WHATSAPP_AI_CAMPAIGN_RUNNING',
    )
  })
})

describe('WhatsAppAiCampaignService.play()/pause()', () => {
  it('should start a new run and enqueue the first step', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(
      ok(withTemplate({ status: 'PAUSED', runToken: null })),
    )

    const dto = expectOk(
      await WhatsAppAiCampaignService.play('u1', 'ws1', 'cp1'),
    )

    expect(dto.status).toBe('RUNNING')
    expect(queueAdd).toHaveBeenCalledWith(
      'send-ai-campaign-next',
      { campaignId: 'cp1', runToken: expect.any(String) },
      expect.objectContaining({ delay: 0 }),
    )
  })

  it('should list what is missing instead of playing', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(
      ok(withTemplate({ status: 'DRAFT', runToken: null, variables: {} })),
    )
    repo.countPending.mockResolvedValue(ok(0))

    const error = expectErr(
      await WhatsAppAiCampaignService.play('u1', 'ws1', 'cp1'),
      'WHATSAPP_AI_CAMPAIGN_NOT_READY',
    )
    expect(error.message).toContain('Preencha as variáveis')
    expect(error.message).toContain('Adicione contatos')
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('should pause and drop the run token', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(ok(withTemplate()))

    const dto = expectOk(
      await WhatsAppAiCampaignService.pause('u1', 'ws1', 'cp1'),
    )

    expect(dto.status).toBe('PAUSED')
    expect(repo.update).toHaveBeenCalledWith(
      'cp1',
      expect.objectContaining({ status: 'PAUSED', runToken: null }),
    )
  })
})

describe('WhatsAppAiCampaignService.sendNext()', () => {
  it('should stop silently on a stale run token', async () => {
    repo.findByIdRaw.mockResolvedValue(ok(campaign({ runToken: 'other' })))

    expect(
      expectOk(await WhatsAppAiCampaignService.sendNext('cp1', 'tok')),
    ).toEqual({ status: 'stopped' })
    expect(send.template).not.toHaveBeenCalled()
  })

  it('should fill the variables per contact, open the conversation with the AI and chain', async () => {
    repo.findByIdRaw.mockResolvedValue(ok(campaign({ intervalSeconds: 45 })))
    repo.findNextPending.mockResolvedValue(ok(pendingRecipient()))
    send.template.mockResolvedValue(ok({ providerMessageId: 'wamid.1' }))

    expect(
      expectOk(await WhatsAppAiCampaignService.sendNext('cp1', 'tok')),
    ).toEqual({ status: 'sent', nextDelayMs: 45_000 })
    expect(send.template).toHaveBeenCalledWith(
      connection,
      {
        to: '5511999990000',
        templateName: 'cobranca',
        language: 'pt_BR',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Maria' },
              { type: 'text', text: 'R$ 99' },
            ],
          },
        ],
      },
      {
        cost: expect.objectContaining({
          source: 'AI_CAMPAIGN',
          aiCampaignId: 'cp1',
        }),
      },
    )
    expect(conversationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'ct1',
        connectionId: 'c1',
        aiCampaignId: 'cp1',
        aiActive: true,
      }),
    )
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TEMPLATE',
        sentByAi: true,
        text: 'Oi Maria, sua fatura de R$ 99 vence amanhã.',
      }),
    )
    expect(repo.updateRecipient).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'SENT', conversationId: 'conv1' }),
    )
    expect(queueAdd).toHaveBeenCalledWith(
      'send-ai-campaign-next',
      { campaignId: 'cp1', runToken: 'tok' },
      expect.objectContaining({ delay: 45_000 }),
    )
  })

  it('should send again into an open conversation, keeping a person in charge', async () => {
    repo.findByIdRaw.mockResolvedValue(ok(campaign()))
    repo.findNextPending.mockResolvedValue(ok(pendingRecipient()))
    conversationRepo.findActiveByContact.mockResolvedValue(
      ok(
        createFakeWhatsAppConversation({
          id: 'open1',
          status: 'IN_PROGRESS',
          assignedUserId: 'agent',
        }),
      ),
    )
    send.template.mockResolvedValue(ok({ providerMessageId: 'wamid.2' }))

    expectOk(await WhatsAppAiCampaignService.sendNext('cp1', 'tok'))

    expect(conversationRepo.findActiveByContact).toHaveBeenCalledWith(
      'ws1',
      'ct1',
      { connectionId: 'c1' },
    )
    expect(conversationRepo.update).toHaveBeenCalledWith('open1', {
      aiCampaignId: 'cp1',
    })
    expect(conversationRepo.create).not.toHaveBeenCalled()
    expect(send.template).toHaveBeenCalled()
  })

  it('should skip a contact with no value for a variable', async () => {
    repo.findByIdRaw.mockResolvedValue(ok(campaign()))
    repo.findNextPending.mockResolvedValue(ok(pendingRecipient({})))

    expect(
      expectOk(await WhatsAppAiCampaignService.sendNext('cp1', 'tok')),
    ).toEqual({ status: 'skipped', nextDelayMs: 1000 })
    expect(repo.updateRecipient).toHaveBeenCalledWith('r1', {
      status: 'SKIPPED',
      errorMessage: 'Sem valor para Variável {{2}}',
    })
    expect(send.template).not.toHaveBeenCalled()
  })

  it('should finish when the queue is empty', async () => {
    repo.findByIdRaw.mockResolvedValue(ok(campaign()))
    repo.findNextPending.mockResolvedValue(ok(null))

    expect(
      expectOk(await WhatsAppAiCampaignService.sendNext('cp1', 'tok')),
    ).toEqual({ status: 'done' })
    expect(repo.stopRun).toHaveBeenCalledWith('cp1', 'tok', {
      status: 'DONE',
      lastError: null,
      finishedAt: expect.any(Date),
    })
  })

  it('should sleep until the opening outside business hours', async () => {
    repo.findByIdRaw.mockResolvedValue(ok(campaign()))
    const resumeAt = new Date(Date.now() + 60 * 60 * 1000)
    vi.mocked(WhatsAppBusinessHoursService.check).mockResolvedValueOnce(
      ok({
        open: false,
        nextOpeningAt: resumeAt,
        hours: { enabled: true, start: '08:00', end: '18:00', days: [1] },
      }),
    )

    expect(
      expectOk(await WhatsAppAiCampaignService.sendNext('cp1', 'tok')),
    ).toEqual({ status: 'waiting', resumeAt })
    expect(repo.findNextPending).not.toHaveBeenCalled()
  })

  it('should pause on the monthly limit and record a provider failure otherwise', async () => {
    repo.findByIdRaw.mockResolvedValue(ok(campaign()))
    repo.findNextPending.mockResolvedValue(ok(pendingRecipient()))
    vi.mocked(WhatsAppUsageService.assertCanSend).mockResolvedValueOnce(
      err(appError('WHATSAPP_CONVERSATION_LIMIT_REACHED', 'Limite atingido')),
    )

    expect(
      expectOk(await WhatsAppAiCampaignService.sendNext('cp1', 'tok')),
    ).toEqual({ status: 'paused', reason: 'Limite atingido' })

    send.template.mockResolvedValue(
      err(appError('WHATSAPP_PROVIDER_ERROR', 'Número inválido')),
    )
    expect(
      expectOk(await WhatsAppAiCampaignService.sendNext('cp1', 'tok')),
    ).toEqual({ status: 'failed', nextDelayMs: 30_000 })
    expect(repo.updateRecipient).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'Número inválido',
      }),
    )
  })

  it('should pause when a variable lost its mapping', async () => {
    repo.findByIdRaw.mockResolvedValue(ok(campaign({ variables: {} })))

    const outcome = expectOk(
      await WhatsAppAiCampaignService.sendNext('cp1', 'tok'),
    )
    expect(outcome).toEqual({
      status: 'paused',
      reason: 'Preencha as variáveis: Variável {{1}}, Variável {{2}}',
    })
  })
})
