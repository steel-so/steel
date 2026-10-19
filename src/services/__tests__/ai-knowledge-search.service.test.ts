import type { ModuleKind, Profile } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeKnowledgeHit } from '@/src/__tests__/factories/ai-knowledge.factory'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { createFakeWorkspaceModuleAccess } from '@/src/__tests__/factories/workspace-module-access.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/wiki-settings.repository')
vi.mock('@/src/repositories/ai-knowledge-chunk.repository')
vi.mock('@/src/repositories/search-source.repository')
vi.mock('@/src/services/sd-access')
vi.mock('@/src/services/ai-knowledge-embedding.service')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  type SdTicketSearchRow,
  SearchSourceRepository,
} from '@/src/repositories/search-source.repository'
import { WikiSettingsRepository } from '@/src/repositories/wiki-settings.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { AiKnowledgeEmbeddingService } from '@/src/services/ai-knowledge-embedding.service'
import { SdAccess, type SdAccessContext } from '@/src/services/sd-access'
import {
  AiKnowledgeSearchService,
  KNOWLEDGE_MIN_SIMILARITY,
} from '../ai-knowledge-search.service'

const memberships = vi.mocked(MembershipRepository)
const workspaces = vi.mocked(WorkspaceRepository)
const modules = vi.mocked(WorkspaceModuleAccessRepository)
const aiSettings = vi.mocked(WorkspaceAiSettingsRepository)
const wiki = vi.mocked(WikiSettingsRepository)
const chunks = vi.mocked(AiKnowledgeChunkRepository)
const sources = vi.mocked(SearchSourceRepository)
const embeddings = vi.mocked(AiKnowledgeEmbeddingService)
const sd = vi.mocked(SdAccess)

const WS = 'ws1'
const USER = 'u1'

function member(
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER',
  profile?: Profile,
) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(
      createFakeMembership({
        userId: USER,
        workspaceId: WS,
        role,
        profile: profile ?? null,
      }),
    ),
  )
}

function enable(...kinds: ModuleKind[]) {
  modules.listByWorkspace.mockResolvedValue(
    ok(
      kinds.map((module) =>
        createFakeWorkspaceModuleAccess({ workspaceId: WS, module }),
      ),
    ),
  )
}

function sdAgent(isAgent: boolean) {
  sd.resolve.mockResolvedValue(ok({ isAgent } as unknown as SdAccessContext))
}

function customProfile(permissions: Record<string, string[]>): Profile {
  return {
    id: 'p1',
    workspaceId: WS,
    name: 'Perfil',
    isSystem: false,
    systemKey: null,
    permissions,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Profile
}

function ticketRow(id: string, requesterId: string | null): SdTicketSearchRow {
  return {
    id,
    requesterId,
    participants: [{ userId: 'participant' }],
    contact: { name: 'Contato', userId: 'contact-user' },
  } as unknown as SdTicketSearchRow
}

beforeEach(() => {
  member('OWNER')
  enable('SERVICE_DESK', 'CRM', 'COMMUNICATION')
  sdAgent(true)
  workspaces.findById.mockResolvedValue(
    ok(createFakeWorkspace({ id: WS, slug: 'demo' })),
  )
  aiSettings.findByWorkspace.mockResolvedValue(ok(null))
  wiki.isEnabled.mockResolvedValue(ok(true))
  chunks.searchText.mockResolvedValue(ok([]))
  chunks.searchVector.mockResolvedValue(ok([]))
  embeddings.embedQuery.mockResolvedValue({
    vector: null,
    reason: 'no_vector_index',
  })
  sources.sdTickets.mockResolvedValue(ok([]))
})

describe('AiKnowledgeSearchService.resolveAccess', () => {
  it('should give an owner every source', async () => {
    const access = expectOk(
      await AiKnowledgeSearchService.resolveAccess(USER, WS),
    )
    expect(access).toEqual({
      types: [
        'sd-kb-article',
        'wiki-page',
        'sd-ticket',
        'zap-knowledge-doc',
        'crm-note',
        'crm-proposal',
      ],
      isSdAgent: true,
      slug: 'demo',
    })
  })

  it('should refuse a non-member and a workspace with Steel AI off', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await AiKnowledgeSearchService.resolveAccess(USER, WS),
      'FORBIDDEN',
    )
    member('MEMBER')
    aiSettings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ workspaceId: WS, aiEnabled: false })),
    )
    expectErr(
      await AiKnowledgeSearchService.resolveAccess(USER, WS),
      'AI_DISABLED',
    )
  })

  it('should drop the sources of disabled modules and of a disabled wiki', async () => {
    enable('CRM')
    wiki.isEnabled.mockResolvedValue(ok(false))
    const access = expectOk(
      await AiKnowledgeSearchService.resolveAccess(USER, WS),
    )
    expect(access.types).toEqual(['crm-note', 'crm-proposal'])
    expect(access.isSdAgent).toBe(false)
    expect(sd.resolve).not.toHaveBeenCalled()
  })

  it('should keep the WhatsApp AI documents for OWNER/ADMIN only', async () => {
    member('MEMBER')
    const access = expectOk(
      await AiKnowledgeSearchService.resolveAccess(USER, WS),
    )
    expect(access.types).not.toContain('zap-knowledge-doc')
    expect(access.types).toContain('crm-note')
    member('ADMIN')
    expect(
      expectOk(await AiKnowledgeSearchService.resolveAccess(USER, WS)).types,
    ).toContain('zap-knowledge-doc')
  })

  it('should apply the RBAC VIEW of a custom profile', async () => {
    member('MEMBER', customProfile({ notes: ['VIEW'], 'sd-knowledge': [] }))
    expect(
      expectOk(await AiKnowledgeSearchService.resolveAccess(USER, WS)).types,
    ).toEqual(['wiki-page', 'crm-note'])
    member('MEMBER', { ...customProfile({}), permissions: null } as never)
    expect(
      expectOk(await AiKnowledgeSearchService.resolveAccess(USER, WS)).types,
    ).toEqual(['wiki-page'])
  })

  it('should mark a ServiceDesk requester and propagate lookup failures', async () => {
    member('MEMBER')
    sdAgent(false)
    expect(
      expectOk(await AiKnowledgeSearchService.resolveAccess(USER, WS)),
    ).toMatchObject({ isSdAgent: false })

    sd.resolve.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiKnowledgeSearchService.resolveAccess(USER, WS),
      'DATABASE_ERROR',
    )
    for (const fail of [
      () =>
        aiSettings.findByWorkspace.mockResolvedValueOnce(err(databaseError())),
      () => workspaces.findById.mockResolvedValueOnce(err(databaseError())),
      () => modules.listByWorkspace.mockResolvedValueOnce(err(databaseError())),
      () => wiki.isEnabled.mockResolvedValueOnce(err(databaseError())),
    ]) {
      sdAgent(true)
      fail()
      expectErr(
        await AiKnowledgeSearchService.resolveAccess(USER, WS),
        'DATABASE_ERROR',
      )
    }
  })
})

describe('AiKnowledgeSearchService.search', () => {
  it('should answer from text only when no query embedding is available', async () => {
    chunks.searchText.mockResolvedValue(
      ok([
        createFakeKnowledgeHit({ id: 'c1', sourceId: 'w1' }),
        createFakeKnowledgeHit({ id: 'c2', sourceId: 'w1', chunkIndex: 1 }),
        createFakeKnowledgeHit({
          id: 'c3',
          sourceType: 'crm-note',
          sourceId: 'n1',
          path: '/crm',
        }),
      ]),
    )
    const result = expectOk(
      await AiKnowledgeSearchService.search(USER, WS, {
        q: 'senha do wifi',
        limit: 5,
      }),
    )
    expect(result.mode).toBe('text')
    // One result per source, best chunk first.
    expect(result.results.map((r) => r.sourceId)).toEqual(['w1', 'n1'])
    expect(result.results[0]).toMatchObject({
      href: '/demo/wiki/page1',
      matchedBy: ['text'],
    })
    expect(chunks.searchVector).not.toHaveBeenCalled()
    expect(chunks.searchText).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        userId: USER,
        isSdAgent: true,
        text: 'senha do wifi',
      }),
    )
    expect(logger.info).toHaveBeenCalledWith(
      'ai.knowledge.search',
      expect.objectContaining({ mode: 'text', fallback: 'no_vector_index' }),
    )
    // The query itself is never logged.
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(
      'senha do wifi',
    )
  })

  it('should fuse text and vector hits, dropping weak vector matches', async () => {
    embeddings.embedQuery.mockResolvedValue({ vector: '[1]', reason: null })
    chunks.searchText.mockResolvedValue(
      ok([createFakeKnowledgeHit({ id: 'c1', sourceId: 'a' })]),
    )
    chunks.searchVector.mockResolvedValue(
      ok([
        createFakeKnowledgeHit({ id: 'c2', sourceId: 'b', score: 0.8 }),
        createFakeKnowledgeHit({ id: 'c1', sourceId: 'a', score: 0.7 }),
        createFakeKnowledgeHit({
          id: 'c3',
          sourceId: 'noise',
          score: KNOWLEDGE_MIN_SIMILARITY - 0.01,
        }),
      ]),
    )
    const result = expectOk(
      await AiKnowledgeSearchService.search(USER, WS, { q: 'vpn' }),
    )
    expect(result.mode).toBe('hybrid')
    expect(result.results.map((r) => r.sourceId)).toEqual(['a', 'b'])
    expect(result.results[0].matchedBy).toEqual(['text', 'vector'])
    expect(chunks.searchVector).toHaveBeenCalledWith(
      expect.objectContaining({
        vector: '[1]',
        model: 'text-embedding-3-small',
      }),
    )
  })

  it('should degrade to text when the vector query fails', async () => {
    embeddings.embedQuery.mockResolvedValue({ vector: '[1]', reason: null })
    chunks.searchText.mockResolvedValue(
      ok([createFakeKnowledgeHit({ sourceId: 'a' })]),
    )
    chunks.searchVector.mockResolvedValue(err(databaseError()))
    const result = expectOk(
      await AiKnowledgeSearchService.search(USER, WS, { q: 'vpn' }),
    )
    expect(result.mode).toBe('text')
    expect(result.results).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.knowledge.vector_search_failed',
      expect.objectContaining({ code: 'DATABASE_ERROR' }),
    )
  })

  it('should restrict to the requested sources the user may see', async () => {
    member('MEMBER')
    await AiKnowledgeSearchService.search(USER, WS, {
      q: 'vpn',
      sources: ['zap-knowledge-doc', 'crm-note'],
    })
    expect(chunks.searchText).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['crm-note'] }),
    )
  })

  it('should return nothing without allowed sources or with a too-short query', async () => {
    enable()
    wiki.isEnabled.mockResolvedValue(ok(false))
    const empty = expectOk(
      await AiKnowledgeSearchService.search(USER, WS, { q: 'vpn' }),
    )
    expect(empty).toMatchObject({ mode: 'text', results: [] })
    enable('CRM')
    expect(
      expectOk(await AiKnowledgeSearchService.search(USER, WS, { q: ' a ' }))
        .results,
    ).toEqual([])
    expect(chunks.searchText).not.toHaveBeenCalled()
    expect(embeddings.embedQuery).not.toHaveBeenCalled()
  })

  it('should propagate access and text-search errors', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await AiKnowledgeSearchService.search(USER, WS, { q: 'vpn' }),
      'FORBIDDEN',
    )
    member('OWNER')
    chunks.searchText.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiKnowledgeSearchService.search(USER, WS, { q: 'vpn' }),
      'DATABASE_ERROR',
    )
  })

  it('should re-check requester tickets against the live rows', async () => {
    member('MEMBER')
    sdAgent(false)
    chunks.searchText.mockResolvedValue(
      ok([
        createFakeKnowledgeHit({
          id: 'c1',
          sourceType: 'sd-ticket',
          sourceId: 'mine',
        }),
        createFakeKnowledgeHit({
          id: 'c2',
          sourceType: 'sd-ticket',
          sourceId: 'gone',
        }),
        createFakeKnowledgeHit({
          id: 'c3',
          sourceType: 'sd-ticket',
          sourceId: 'participant',
        }),
        createFakeKnowledgeHit({ id: 'c4', sourceId: 'wiki' }),
      ]),
    )
    sources.sdTickets.mockResolvedValue(
      ok([
        ticketRow('mine', USER),
        ticketRow('gone', 'someone-else'),
        { ...ticketRow('participant', null), participants: [{ userId: USER }] },
      ]),
    )
    const result = expectOk(
      await AiKnowledgeSearchService.search(USER, WS, { q: 'impressora' }),
    )
    expect(result.results.map((r) => r.sourceId).sort()).toEqual([
      'mine',
      'participant',
      'wiki',
    ])
    expect(sources.sdTickets).toHaveBeenCalledWith(WS, {
      ids: ['mine', 'gone', 'participant'],
      take: 3,
    })

    sources.sdTickets.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiKnowledgeSearchService.search(USER, WS, { q: 'impressora' }),
      'DATABASE_ERROR',
    )
  })

  it('should let a requester see a ticket through the linked contact', async () => {
    sdAgent(false)
    member('MEMBER')
    chunks.searchText.mockResolvedValue(
      ok([createFakeKnowledgeHit({ sourceType: 'sd-ticket', sourceId: 't' })]),
    )
    sources.sdTickets.mockResolvedValue(ok([ticketRow('t', 'x')]))
    expect(
      expectOk(
        await AiKnowledgeSearchService.search('contact-user', WS, {
          q: 'impressora',
        }),
      ).results,
    ).toHaveLength(1)
  })

  it('should not re-check tickets for agents', async () => {
    chunks.searchText.mockResolvedValue(
      ok([createFakeKnowledgeHit({ sourceType: 'sd-ticket', sourceId: 't' })]),
    )
    await AiKnowledgeSearchService.search(USER, WS, { q: 'impressora' })
    expect(sources.sdTickets).not.toHaveBeenCalled()
  })
})
