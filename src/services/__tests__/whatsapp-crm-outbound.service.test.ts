import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'
import { WhatsAppCrmOutboundRepository } from '@/src/repositories/whatsapp-crm-outbound.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  fileCrmOutboundInConversation,
  recordCrmOutbound,
} from '../whatsapp-crm-outbound.service'

vi.mock('@/src/repositories/whatsapp-crm-outbound.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const repo = vi.mocked(WhatsAppCrmOutboundRepository)
const messages = vi.mocked(WhatsAppMessageRepository)

beforeEach(() => vi.resetAllMocks())

describe('recordCrmOutbound()', () => {
  it('logs the rendered text of a send', async () => {
    repo.create.mockResolvedValue(ok({} as never))

    await recordCrmOutbound({
      workspaceId: 'ws1',
      waId: '5511988887777',
      source: 'campaign',
      type: 'TEMPLATE',
      text: '  Olá, Ana!  ',
      providerMessageId: 'wamid-1',
    })

    expect(repo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      waId: '5511988887777',
      source: 'campaign',
      type: 'TEMPLATE',
      text: 'Olá, Ana!',
      providerMessageId: 'wamid-1',
    })
  })

  it('skips an empty text', async () => {
    await recordCrmOutbound({
      workspaceId: 'ws1',
      waId: '5511988887777',
      source: 'cadence',
      text: '   ',
    })

    expect(repo.create).not.toHaveBeenCalled()
  })

  it('never fails the send when the log cannot be written', async () => {
    repo.create.mockResolvedValue(err(databaseError()))

    await expect(
      recordCrmOutbound({
        workspaceId: 'ws1',
        waId: '5511988887777',
        source: 'workflow',
        text: 'Oi',
      }),
    ).resolves.toBeUndefined()
  })
})

describe('fileCrmOutboundInConversation()', () => {
  const NOW = new Date('2026-11-24T12:00:00.000Z')
  const sentAt = new Date('2026-11-24T10:00:00.000Z')

  it('files the pending messages as outbound, at the time they were sent', async () => {
    repo.listPending.mockResolvedValue(
      ok([
        {
          id: 'o1',
          workspaceId: 'ws1',
          waId: '5511988887777',
          source: 'campaign',
          type: 'TEMPLATE',
          text: 'Posso enviar o portfólio?',
          providerMessageId: 'wamid-1',
          sentAt,
          importedAt: null,
        },
      ]),
    )
    messages.create.mockResolvedValue(ok(createFakeWhatsAppMessage()))
    repo.markImported.mockResolvedValue(ok(undefined))

    const filed = expectOk(
      await fileCrmOutboundInConversation({
        workspaceId: 'ws1',
        waId: '5511988887777',
        conversationId: 'conv1',
        now: NOW,
      }),
    )

    expect(filed).toBe(1)
    expect(messages.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      conversationId: 'conv1',
      direction: 'OUT',
      type: 'TEMPLATE',
      text: 'Posso enviar o portfólio?',
      providerMessageId: 'wamid-1',
      status: 'SENT',
      createdAt: sentAt,
    })
    expect(repo.markImported).toHaveBeenCalledWith(['o1'], NOW)
  })

  it('only looks at the last 14 days', async () => {
    repo.listPending.mockResolvedValue(ok([]))

    await fileCrmOutboundInConversation({
      workspaceId: 'ws1',
      waId: '5511988887777',
      conversationId: 'conv1',
      now: NOW,
    })

    const since: Date = repo.listPending.mock.calls[0][2]
    expect((NOW.getTime() - since.getTime()) / 86_400_000).toBe(14)
  })

  it('does nothing when nothing is waiting', async () => {
    repo.listPending.mockResolvedValue(ok([]))

    expect(
      expectOk(
        await fileCrmOutboundInConversation({
          workspaceId: 'ws1',
          waId: '5511988887777',
          conversationId: 'conv1',
        }),
      ),
    ).toBe(0)
    expect(messages.create).not.toHaveBeenCalled()
    expect(repo.markImported).not.toHaveBeenCalled()
  })

  it('leaves a message pending when it could not be filed', async () => {
    repo.listPending.mockResolvedValue(
      ok([
        {
          id: 'o1',
          workspaceId: 'ws1',
          waId: '5511988887777',
          source: 'cadence',
          type: 'TEXT',
          text: 'Oi',
          providerMessageId: null,
          sentAt,
          importedAt: null,
        },
      ]),
    )
    messages.create.mockResolvedValue(err(databaseError()))

    expect(
      expectOk(
        await fileCrmOutboundInConversation({
          workspaceId: 'ws1',
          waId: '5511988887777',
          conversationId: 'conv1',
          now: NOW,
        }),
      ),
    ).toBe(0)
    expect(repo.markImported).not.toHaveBeenCalled()
  })
})
