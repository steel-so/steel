import type { ModuleKind } from '@prisma/client'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createFakeKnowledgeHit } from '@/src/__tests__/factories/ai-knowledge.factory'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { createFakeWorkspaceModuleAccess } from '@/src/__tests__/factories/workspace-module-access.factory'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/ai-knowledge-chunk.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/wiki-page.repository')
vi.mock('@/src/repositories/wiki-settings.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/services/ai-knowledge-search.service')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { WikiPageRepository } from '@/src/repositories/wiki-page.repository'
import { WikiSettingsRepository } from '@/src/repositories/wiki-settings.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { AiKnowledgeSearchService } from '../ai-knowledge-search.service'
import { WhatsAppReplyKnowledgeService } from '../whatsapp-reply-knowledge.service'

const chunks = vi.mocked(AiKnowledgeChunkRepository)
const aiSettings = vi.mocked(WorkspaceAiSettingsRepository)
const wikiPages = vi.mocked(WikiPageRepository)
const wikiSettings = vi.mocked(WikiSettingsRepository)
const modules = vi.mocked(WorkspaceModuleAccessRepository)
const search = vi.mocked(AiKnowledgeSearchService)

const WS = 'ws1'

function enable(...kinds: ModuleKind[]) {
  modules.listByWorkspace.mockResolvedValue(
    ok(
      kinds.map((module) =>
        createFakeWorkspaceModuleAccess({ workspaceId: WS, module }),
      ),
    ),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  aiSettings.findByWorkspace.mockResolvedValue(ok(null))
  enable('SERVICE_DESK')
  wikiSettings.isEnabled.mockResolvedValue(ok(true))
  chunks.searchText.mockResolvedValue(ok([]))
  wikiPages.listPublishedIds.mockResolvedValue(ok(new Set()))
})

describe('WhatsAppReplyKnowledgeService.forCustomerReply', () => {
  it('should skip very short queries without touching the index', async () => {
    expect(
      await WhatsAppReplyKnowledgeService.forCustomerReply(WS, ' a '),
    ).toEqual([])
    expect(chunks.searchText).not.toHaveBeenCalled()
  })

  it('should return nothing when Steel AI is off', async () => {
    aiSettings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ aiEnabled: false })),
    )
    expect(
      await WhatsAppReplyKnowledgeService.forCustomerReply(WS, 'horário'),
    ).toEqual([])
    expect(chunks.searchText).not.toHaveBeenCalled()
  })

  it('should search public chunks only, as no user and not as an agent', async () => {
    chunks.searchText.mockResolvedValue(
      ok([
        createFakeKnowledgeHit({
          sourceType: 'sd-kb-article',
          sourceId: 'kb1',
          title: 'Horário de atendimento',
          content: 'Atendemos de segunda a sexta.',
        }),
      ]),
    )

    const entries = await WhatsAppReplyKnowledgeService.forCustomerReply(
      WS,
      'qual o horário',
    )

    expect(chunks.searchText).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: '',
      types: ['sd-kb-article', 'wiki-page'],
      isSdAgent: false,
      limit: 20,
      text: 'qual o horário',
    })
    expect(entries).toEqual([
      {
        sourceLabel: 'Artigo da base de conhecimento',
        title: 'Horário de atendimento',
        text: 'Atendemos de segunda a sexta.',
      },
    ])
  })

  it('should keep only published Wiki pages', async () => {
    chunks.searchText.mockResolvedValue(
      ok([
        createFakeKnowledgeHit({ sourceId: 'internal', title: 'Interna' }),
        createFakeKnowledgeHit({ sourceId: 'public', title: 'Pública' }),
      ]),
    )
    wikiPages.listPublishedIds.mockResolvedValue(ok(new Set(['public'])))

    const entries = await WhatsAppReplyKnowledgeService.forCustomerReply(
      WS,
      'política de troca',
    )

    expect(wikiPages.listPublishedIds).toHaveBeenCalledWith(WS, [
      'internal',
      'public',
    ])
    expect(entries.map((e) => e.title)).toEqual(['Pública'])
  })

  it('should drop KB when ServiceDesk is off and Wiki when it is off', async () => {
    enable('CRM')
    wikiSettings.isEnabled.mockResolvedValue(ok(false))

    expect(
      await WhatsAppReplyKnowledgeService.forCustomerReply(WS, 'horário'),
    ).toEqual([])
    expect(chunks.searchText).not.toHaveBeenCalled()
  })

  it('should search only the Wiki when ServiceDesk is off', async () => {
    enable('CRM')
    await WhatsAppReplyKnowledgeService.forCustomerReply(WS, 'horário')
    expect(chunks.searchText).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['wiki-page'] }),
    )
  })

  it('should return nothing when there are no hits', async () => {
    expect(
      await WhatsAppReplyKnowledgeService.forCustomerReply(WS, 'horário'),
    ).toEqual([])
    expect(wikiPages.listPublishedIds).not.toHaveBeenCalled()
  })

  it.each([
    ['settings', () => aiSettings.findByWorkspace as unknown as Mock],
    ['modules', () => modules.listByWorkspace as unknown as Mock],
    ['wiki', () => wikiSettings.isEnabled as unknown as Mock],
    ['search', () => chunks.searchText as unknown as Mock],
    ['published', () => wikiPages.listPublishedIds as unknown as Mock],
  ])('should degrade to no entries when %s fails', async (_name, mock) => {
    chunks.searchText.mockResolvedValue(ok([createFakeKnowledgeHit()]))
    mock().mockResolvedValue(err(databaseError('x')))

    expect(
      await WhatsAppReplyKnowledgeService.forCustomerReply(WS, 'horário'),
    ).toEqual([])
  })

  it('should log and return nothing when something throws', async () => {
    chunks.searchText.mockRejectedValue(new Error('boom'))
    expect(
      await WhatsAppReplyKnowledgeService.forCustomerReply(WS, 'horário'),
    ).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.reply_knowledge.failed',
      expect.objectContaining({ audience: 'customer', reason: 'boom' }),
    )
  })

  it('should log non-Error failures too', async () => {
    chunks.searchText.mockRejectedValue('boom')
    await WhatsAppReplyKnowledgeService.forCustomerReply(WS, 'horário')
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.reply_knowledge.failed',
      expect.objectContaining({ reason: 'boom' }),
    )
  })
})

describe('WhatsAppReplyKnowledgeService.forAgent', () => {
  it('should skip very short queries', async () => {
    expect(await WhatsAppReplyKnowledgeService.forAgent('u1', WS, '')).toEqual(
      [],
    )
    expect(search.search).not.toHaveBeenCalled()
  })

  it('should search KB and Wiki as the agent and map the snippets', async () => {
    search.search.mockResolvedValue(
      ok({
        query: 'reagendar',
        mode: 'text',
        tookMs: 1,
        results: [
          {
            sourceType: 'wiki-page',
            sourceLabel: 'Página da Wiki',
            sourceId: 'p1',
            title: 'Reagendamento',
            snippet: 'Reagende com 24h.',
            href: '/demo/wiki/p1',
            updatedAt: '2026-10-01T12:00:00.000Z',
            score: 1,
            matchedBy: ['text'],
          },
        ],
      }),
    )

    const entries = await WhatsAppReplyKnowledgeService.forAgent(
      'u1',
      WS,
      'reagendar',
    )

    expect(search.search).toHaveBeenCalledWith('u1', WS, {
      q: 'reagendar',
      sources: ['sd-kb-article', 'wiki-page'],
      limit: 3,
    })
    expect(entries).toEqual([
      {
        sourceLabel: 'Página da Wiki',
        title: 'Reagendamento',
        text: 'Reagende com 24h.',
      },
    ])
  })

  it('should return nothing when the search is refused', async () => {
    search.search.mockResolvedValue(err(databaseError('x')))
    expect(
      await WhatsAppReplyKnowledgeService.forAgent('u1', WS, 'reagendar'),
    ).toEqual([])
  })

  it('should log and return nothing when the search throws', async () => {
    search.search.mockRejectedValue(new Error('boom'))
    expect(
      await WhatsAppReplyKnowledgeService.forAgent('u1', WS, 'reagendar'),
    ).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.reply_knowledge.failed',
      expect.objectContaining({ audience: 'agent' }),
    )
  })

  it('should log non-Error failures too', async () => {
    search.search.mockRejectedValue('boom')
    await WhatsAppReplyKnowledgeService.forAgent('u1', WS, 'reagendar')
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.reply_knowledge.failed',
      expect.objectContaining({ reason: 'boom' }),
    )
  })
})
