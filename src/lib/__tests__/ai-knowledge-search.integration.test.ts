import type { ModuleKind, Role } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { fakeEmbedding } from '@/src/__tests__/factories/ai-knowledge.factory'
import { seedCrmNote } from '@/src/__tests__/factories/crm-note.factory'
import {
  seedSdKbArticle,
  seedSdTicket,
} from '@/src/__tests__/factories/sd-kb.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWhatsAppAiKnowledgeDocument } from '@/src/__tests__/factories/whatsapp-ai-knowledge-document.factory'
import { seedWikiPage } from '@/src/__tests__/factories/wiki-page.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

/*
 * End to end over the real database: the real loaders write the chunks, the
 * real search applies every permission rule. Only the embedding provider is
 * faked (deterministic vectors, no network): with pgvector present (CI) the
 * hybrid path runs; without it (a dev box on the old image) the text path
 * runs and the permission assertions are the same.
 */
vi.mock('@/src/lib/ai/knowledge/embeddings', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/ai/knowledge/embeddings')>()
  return {
    ...actual,
    isEmbeddingProviderConfigured: () => true,
    embedTexts: vi.fn(async (texts: readonly string[]) =>
      ok({
        vectors: texts.map((t) =>
          fakeEmbedding(/senha|wi-?fi/i.test(t) ? 1 : 7),
        ),
        inputTokens: texts.length,
      }),
    ),
  }
})

import { prisma } from '@/src/lib/prisma'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import { AiKnowledgeIndexService } from '@/src/services/ai-knowledge-index.service'
import { AiKnowledgeSearchService } from '@/src/services/ai-knowledge-search.service'
import { PlatformAiSettingsService } from '@/src/services/platform-ai-settings.service'

const MODULES: ModuleKind[] = ['SERVICE_DESK', 'CRM', 'COMMUNICATION']

async function join(workspaceId: string, role: Role) {
  const user = await seedUser()
  await prisma.membership.create({
    data: { userId: user.id, workspaceId, role },
  })
  return user
}

/** Workspace with every module and the Wiki on, plus its OWNER. */
async function workspaceWithModules() {
  const ws = await seedWorkspace()
  const owner = await join(ws.id, 'OWNER')
  await prisma.workspace.update({
    where: { id: ws.id },
    data: { wikiEnabled: true },
  })
  await prisma.workspaceModuleAccess.createMany({
    data: MODULES.map((module) => ({
      workspaceId: ws.id,
      module,
      enabled: true,
      grantedById: owner.id,
    })),
  })
  return { ws, owner }
}

async function found(actorId: string, workspaceId: string, q: string) {
  const result = expectOk(
    await AiKnowledgeSearchService.search(actorId, workspaceId, { q }),
  )
  // Ticket titles carry their code (INC-000123 · …): compare without it.
  return result.results.map((r) => r.title.replace(/^[A-Z]+-\d+ · /, '')).sort()
}

describe('knowledge search over the real database', () => {
  it('should index every source and show each user only what they may open', async () => {
    PlatformAiSettingsService.clearCache()
    const { ws, owner } = await workspaceWithModules()
    const requester = await join(ws.id, 'MEMBER')
    const otherRequester = await join(ws.id, 'MEMBER')

    await seedSdKbArticle(ws.id, {
      title: 'Senha do Wi-Fi (portal)',
      status: 'PUBLISHED',
      visibility: 'PORTAL',
      plainText: 'Para trocar a senha do Wi-Fi, abra o portal do roteador.',
    })
    await seedSdKbArticle(ws.id, {
      title: 'Senha do Wi-Fi (interno)',
      status: 'PUBLISHED',
      visibility: 'INTERNAL',
      plainText: 'Senha mestra do roteador fica no cofre.',
    })
    await seedSdKbArticle(ws.id, {
      title: 'Senha do Wi-Fi (rascunho)',
      status: 'DRAFT',
      plainText: 'Senha do roteador em revisão.',
    })
    const ticket = await seedSdTicket(ws.id, {
      title: 'Wi-Fi sem senha',
      requesterId: requester.id,
    })
    await prisma.sdTicket.update({
      where: { id: ticket.id },
      data: {
        resolvedAt: new Date(),
        solution: 'Senha do roteador redefinida',
      },
    })
    await seedWikiPage(ws.id, owner.id, {
      title: 'Política de senha do Wi-Fi',
      content: [
        { type: 'p', children: [{ text: 'A senha do Wi-Fi muda todo mês.' }] },
      ],
    })
    await seedCrmNote(ws.id, owner.id, {
      title: 'Senha do Wi-Fi do cliente',
      body: 'Cliente pediu a senha do roteador.',
    })
    await seedWhatsAppAiKnowledgeDocument(ws.id, owner.id, {
      filename: 'senha-wifi.pdf',
      extractedText: 'Como informar a senha do Wi-Fi ao cliente.',
    })

    // Another workspace with the same words must never leak in.
    const { ws: other, owner: outsider } = await workspaceWithModules()
    await seedWikiPage(other.id, outsider.id, {
      title: 'Senha do Wi-Fi de outra empresa',
      content: [{ type: 'p', children: [{ text: 'Senha do Wi-Fi alheia.' }] }],
    })

    const stats = expectOk(
      await AiKnowledgeIndexService.reindexWorkspace(ws.id),
    )
    expect(stats.indexed).toBe(6)
    expectOk(await AiKnowledgeIndexService.reindexWorkspace(other.id))

    const q = 'como troco a senha do wifi?'
    expect(await found(owner.id, ws.id, q)).toEqual([
      'Política de senha do Wi-Fi',
      'Senha do Wi-Fi (interno)',
      'Senha do Wi-Fi (portal)',
      'Senha do Wi-Fi do cliente',
      'Wi-Fi sem senha',
      'senha-wifi.pdf',
    ])
    // With pgvector (CI) the semantic half ran too.
    const vectorReady = expectOk(
      await AiKnowledgeChunkRepository.vectorEnabled(),
    )
    const hybrid = expectOk(
      await AiKnowledgeSearchService.search(owner.id, ws.id, { q }),
    )
    expect(hybrid.mode).toBe(vectorReady ? 'hybrid' : 'text')
    if (vectorReady) {
      expect(hybrid.results.some((r) => r.matchedBy.includes('vector'))).toBe(
        true,
      )
    }

    // Requester: portal article, own ticket, wiki and CRM (member profile),
    // never the internal article, never the WhatsApp AI document.
    expect(await found(requester.id, ws.id, q)).toEqual([
      'Política de senha do Wi-Fi',
      'Senha do Wi-Fi (portal)',
      'Senha do Wi-Fi do cliente',
      'Wi-Fi sem senha',
    ])
    expect(await found(otherRequester.id, ws.id, q)).toEqual([
      'Política de senha do Wi-Fi',
      'Senha do Wi-Fi (portal)',
      'Senha do Wi-Fi do cliente',
    ])
    expectErr(
      await AiKnowledgeSearchService.search(outsider.id, ws.id, { q }),
      'FORBIDDEN',
    )
    expect(await found(outsider.id, other.id, q)).toEqual([
      'Senha do Wi-Fi de outra empresa',
    ])

    // Module off: its sources disappear from the search at once.
    await prisma.workspaceModuleAccess.updateMany({
      where: { workspaceId: ws.id, module: 'CRM' },
      data: { enabled: false },
    })
    expect(await found(owner.id, ws.id, q)).not.toContain(
      'Senha do Wi-Fi do cliente',
    )

    // Steel AI off: the workspace index is purged on the next pass.
    await prisma.workspaceAiSettings.create({
      data: {
        workspaceId: ws.id,
        enabledModels: [],
        crmAssistantModel: 'openai:gpt-4o-mini',
        whatsappReplyModel: 'openai:gpt-4o-mini',
        whatsappSentimentModel: 'openai:gpt-4o-mini',
        aiEnabled: false,
      },
    })
    expect(
      expectOk(await AiKnowledgeIndexService.reindexWorkspace(ws.id)).purged,
    ).toBe(true)
    expect(
      await prisma.aiKnowledgeChunk.count({ where: { workspaceId: ws.id } }),
    ).toBe(0)
    expectErr(
      await AiKnowledgeSearchService.search(owner.id, ws.id, { q }),
      'AI_DISABLED',
    )
  })
})
