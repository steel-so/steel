import type { WhatsAppAutoOutreach } from '@prisma/client'
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
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-auto-outreach.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-ai-config.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppAutoOutreachRepository } from '@/src/repositories/whatsapp-auto-outreach.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppAutoOutreachService } from '../whatsapp-auto-outreach.service'
import { WhatsAppUsageService } from '../whatsapp-usage.service'

const repo = vi.mocked(WhatsAppAutoOutreachRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const aiConfigRepo = vi.mocked(WhatsAppAiConfigRepository)
const send = vi.mocked(WhatsAppSend)

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
  name: 'oferta',
  language: 'pt_BR',
  components: [{ type: 'BODY', text: 'Oi {{1}}, temos novidades' }],
})
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: 'ws1',
  waId: '5511999990000',
  name: 'Maria Souza',
})

function outreach(
  overrides: Partial<WhatsAppAutoOutreach> = {},
): WhatsAppAutoOutreach {
  return {
    id: 'o1',
    workspaceId: 'ws1',
    connectionId: 'c1',
    templateId: 't1',
    status: 'RUNNING',
    runToken: 'tok',
    lastSentAt: null,
    lastError: null,
    updatedById: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function asRole(role: 'MEMBER' | 'VIEWER' | 'ADMIN') {
  vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const counts = { PENDING: 2, SENT: 0, FAILED: 0, SKIPPED: 0 }

beforeEach(() => {
  connectionRepo.findById.mockResolvedValue(ok(connection))
  templateRepo.findById.mockResolvedValue(ok(template))
  repo.countRecipients.mockResolvedValue(ok(counts))
  repo.stopRun.mockResolvedValue(ok(true))
  repo.update.mockImplementation(async (_id, data) =>
    ok(outreach(data as Partial<WhatsAppAutoOutreach>)),
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
  aiConfigRepo.findByWorkspace.mockResolvedValue(ok({ active: true } as never))
})

describe('WhatsAppAutoOutreachService.play()/pause()', () => {
  it('should start a new run and enqueue the first step', async () => {
    asRole('ADMIN')
    repo.findByWorkspace.mockResolvedValue(
      ok(outreach({ status: 'PAUSED', runToken: null })),
    )

    const dto = expectOk(await WhatsAppAutoOutreachService.play('u1', 'ws1'))

    expect(dto.status).toBe('RUNNING')
    expect(repo.update).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({
        status: 'RUNNING',
        runToken: expect.any(String),
      }),
    )
    expect(queueAdd).toHaveBeenCalledWith(
      'send-auto-outreach-next',
      { workspaceId: 'ws1', runToken: expect.any(String) },
      expect.objectContaining({ delay: 0 }),
    )
  })

  it('should refuse to play with an empty queue', async () => {
    asRole('ADMIN')
    repo.findByWorkspace.mockResolvedValue(
      ok(outreach({ status: 'IDLE', runToken: null })),
    )
    repo.countRecipients.mockResolvedValue(ok({ ...counts, PENDING: 0 }))

    expectErr(
      await WhatsAppAutoOutreachService.play('u1', 'ws1'),
      'WHATSAPP_AUTO_OUTREACH_NOT_READY',
    )
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('should forbid a viewer', async () => {
    asRole('VIEWER')
    expectErr(await WhatsAppAutoOutreachService.play('u1', 'ws1'), 'FORBIDDEN')
  })

  it('should pause and drop the run token', async () => {
    asRole('ADMIN')
    repo.findByWorkspace.mockResolvedValue(ok(outreach()))

    const dto = expectOk(await WhatsAppAutoOutreachService.pause('u1', 'ws1'))

    expect(dto.status).toBe('PAUSED')
    expect(repo.update).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ status: 'PAUSED', runToken: null }),
    )
  })
})

describe('WhatsAppAutoOutreachService.configure()', () => {
  it('should refuse while running', async () => {
    asRole('ADMIN')
    repo.findByWorkspace.mockResolvedValue(ok(outreach()))

    expectErr(
      await WhatsAppAutoOutreachService.configure('u1', 'ws1', {
        connectionId: 'c1',
        templateId: 't1',
      }),
      'WHATSAPP_AUTO_OUTREACH_RUNNING',
    )
  })

  it('should refuse a template of a Z-API connection', async () => {
    asRole('ADMIN')
    repo.findByWorkspace.mockResolvedValue(ok(null))
    connectionRepo.findById.mockResolvedValue(
      ok({ ...connection, provider: 'ZAPI' }),
    )

    expectErr(
      await WhatsAppAutoOutreachService.configure('u1', 'ws1', {
        connectionId: 'c1',
        templateId: 't1',
      }),
      'WHATSAPP_AUTO_OUTREACH_NOT_READY',
    )
  })
})

describe('WhatsAppAutoOutreachService.sendNext()', () => {
  it('should stop silently on a stale run token', async () => {
    repo.findByWorkspace.mockResolvedValue(ok(outreach({ runToken: 'other' })))

    expect(
      expectOk(await WhatsAppAutoOutreachService.sendNext('ws1', 'tok')),
    ).toEqual({ status: 'stopped' })
    expect(send.template).not.toHaveBeenCalled()
  })

  it('should send the template, open the conversation with the AI and chain the next step', async () => {
    repo.findByWorkspace.mockResolvedValue(ok(outreach()))
    repo.findNextPending.mockResolvedValue(
      ok({
        id: 'r1',
        outreachId: 'o1',
        contactId: 'ct1',
        status: 'PENDING',
        providerMessageId: null,
        errorMessage: null,
        sentAt: null,
        createdAt: new Date(),
        contact,
      }),
    )
    send.template.mockResolvedValue(ok({ providerMessageId: 'wamid.1' }))

    const outcome = expectOk(
      await WhatsAppAutoOutreachService.sendNext('ws1', 'tok'),
    )

    expect(outcome).toEqual({ status: 'sent', nextDelayMs: 30_000 })
    expect(send.template).toHaveBeenCalledWith(connection, {
      to: '5511999990000',
      templateName: 'oferta',
      language: 'pt_BR',
      components: [
        { type: 'body', parameters: [{ type: 'text', text: 'Maria' }] },
      ],
    })
    expect(conversationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'ct1', aiActive: true }),
    )
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUT',
        type: 'TEMPLATE',
        sentByAi: true,
        text: 'Oi Maria, temos novidades',
        providerMessageId: 'wamid.1',
      }),
    )
    expect(repo.updateRecipient).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'SENT' }),
    )
    expect(queueAdd).toHaveBeenCalledWith(
      'send-auto-outreach-next',
      { workspaceId: 'ws1', runToken: 'tok' },
      expect.objectContaining({ delay: 30_000 }),
    )
  })

  it('should skip a contact already in service', async () => {
    repo.findByWorkspace.mockResolvedValue(ok(outreach()))
    repo.findNextPending.mockResolvedValue(
      ok({
        id: 'r1',
        outreachId: 'o1',
        contactId: 'ct1',
        status: 'PENDING',
        providerMessageId: null,
        errorMessage: null,
        sentAt: null,
        createdAt: new Date(),
        contact,
      }),
    )
    conversationRepo.findActiveByContact.mockResolvedValue(
      ok(createFakeWhatsAppConversation({ status: 'IN_PROGRESS' })),
    )

    expect(
      expectOk(await WhatsAppAutoOutreachService.sendNext('ws1', 'tok')),
    ).toEqual({ status: 'skipped', nextDelayMs: 1000 })
    expect(send.template).not.toHaveBeenCalled()
    expect(repo.updateRecipient).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'SKIPPED' }),
    )
  })

  it('should finish when the queue is empty', async () => {
    repo.findByWorkspace.mockResolvedValue(ok(outreach()))
    repo.findNextPending.mockResolvedValue(ok(null))

    expect(
      expectOk(await WhatsAppAutoOutreachService.sendNext('ws1', 'tok')),
    ).toEqual({ status: 'done' })
    expect(repo.stopRun).toHaveBeenCalledWith('o1', 'tok', {
      status: 'DONE',
      lastError: null,
    })
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('should pause when the monthly limit is reached', async () => {
    repo.findByWorkspace.mockResolvedValue(ok(outreach()))
    repo.findNextPending.mockResolvedValue(
      ok({
        id: 'r1',
        outreachId: 'o1',
        contactId: 'ct1',
        status: 'PENDING',
        providerMessageId: null,
        errorMessage: null,
        sentAt: null,
        createdAt: new Date(),
        contact,
      }),
    )
    vi.mocked(WhatsAppUsageService.assertCanSend).mockResolvedValueOnce(
      err(appError('WHATSAPP_CONVERSATION_LIMIT_REACHED', 'Limite atingido')),
    )

    expect(
      expectOk(await WhatsAppAutoOutreachService.sendNext('ws1', 'tok')),
    ).toEqual({ status: 'paused', reason: 'Limite atingido' })
    expect(repo.stopRun).toHaveBeenCalledWith('o1', 'tok', {
      status: 'PAUSED',
      lastError: 'Limite atingido',
    })
  })

  it('should mark a provider failure and keep going', async () => {
    repo.findByWorkspace.mockResolvedValue(ok(outreach()))
    repo.findNextPending.mockResolvedValue(
      ok({
        id: 'r1',
        outreachId: 'o1',
        contactId: 'ct1',
        status: 'PENDING',
        providerMessageId: null,
        errorMessage: null,
        sentAt: null,
        createdAt: new Date(),
        contact,
      }),
    )
    send.template.mockResolvedValue(
      err(appError('WHATSAPP_PROVIDER_ERROR', 'Número inválido')),
    )

    expect(
      expectOk(await WhatsAppAutoOutreachService.sendNext('ws1', 'tok')),
    ).toEqual({ status: 'failed', nextDelayMs: 30_000 })
    expect(repo.updateRecipient).toHaveBeenCalledWith('r1', {
      status: 'FAILED',
      errorMessage: 'Número inválido',
    })
    expect(queueAdd).toHaveBeenCalled()
  })
})

describe('WhatsAppAutoOutreachService.queue()', () => {
  it('should queue every contact and reopen a finished run', async () => {
    asRole('ADMIN')
    repo.findByWorkspace.mockResolvedValue(
      ok(outreach({ status: 'DONE', runToken: null })),
    )
    repo.listQueueableContactIds.mockResolvedValue(ok(['ct1', 'ct2']))
    repo.addRecipients.mockResolvedValue(ok(2))

    const dto = expectOk(
      await WhatsAppAutoOutreachService.queue('u1', 'ws1', { all: true }),
    )

    expect(repo.listQueueableContactIds).toHaveBeenCalledWith(
      'ws1',
      null,
      expect.any(Number),
    )
    expect(dto.added).toBe(2)
    expect(dto.status).toBe('PAUSED')
  })
})
