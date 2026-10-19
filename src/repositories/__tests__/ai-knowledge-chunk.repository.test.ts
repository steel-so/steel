import { describe, expect, it, vi } from 'vitest'
import {
  createFakeKnowledgeChunk,
  fakeEmbedding,
} from '@/src/__tests__/factories/ai-knowledge.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { toVectorLiteral } from '@/src/lib/ai/knowledge/embeddings'
import {
  KNOWLEDGE_SOURCE_TYPES,
  type KnowledgeSourceType,
} from '@/src/lib/ai/knowledge/sources'
import type {
  KnowledgeChunkInput,
  KnowledgeChunkQuery,
} from '@/src/lib/ai/knowledge/types'
import { prisma } from '@/src/lib/prisma'
import { AiKnowledgeChunkRepository as repo } from '../ai-knowledge-chunk.repository'

const MODEL = 'text-embedding-3-small'

function chunk(
  workspaceId: string,
  sourceId: string,
  content: string,
  overrides: Partial<KnowledgeChunkInput> = {},
): KnowledgeChunkInput {
  return createFakeKnowledgeChunk({
    workspaceId,
    sourceId,
    content,
    title: overrides.title ?? `Fonte ${sourceId}`,
    path: `/wiki/${sourceId}`,
    ...overrides,
  })
}

function query(
  workspaceId: string,
  overrides: Partial<KnowledgeChunkQuery> = {},
): KnowledgeChunkQuery {
  return {
    workspaceId,
    userId: 'u1',
    types: [...KNOWLEDGE_SOURCE_TYPES],
    isSdAgent: true,
    limit: 20,
    ...overrides,
  }
}

async function write(
  workspaceId: string,
  sourceType: KnowledgeSourceType,
  sources: Array<{ sourceId: string; chunks: KnowledgeChunkInput[] }>,
) {
  return expectOk(await repo.replaceSources(workspaceId, sourceType, sources))
}

async function sources(q: KnowledgeChunkQuery & { text: string }) {
  const hits = expectOk(await repo.searchText(q))
  return hits.map((h) => h.sourceId)
}

describe('AiKnowledgeChunkRepository (text half)', () => {
  it('should write, refresh and shrink the chunks of a source', async () => {
    const ws = await seedWorkspace()
    expect(
      await write(ws.id, 'wiki-page', [
        {
          sourceId: 'p1',
          chunks: [
            chunk(ws.id, 'p1', 'roteador wifi senha'),
            chunk(ws.id, 'p1', 'segunda parte', { chunkIndex: 1 }),
          ],
        },
      ]),
    ).toBe(2)
    const before = await prisma.aiKnowledgeChunk.findMany({
      where: { workspaceId: ws.id },
      orderBy: { chunkIndex: 'asc' },
    })

    // Same source, one chunk now: index 1 is dropped, index 0 keeps its id.
    await write(ws.id, 'wiki-page', [
      { sourceId: 'p1', chunks: [chunk(ws.id, 'p1', 'roteador novo texto')] },
    ])
    const after = await prisma.aiKnowledgeChunk.findMany({
      where: { workspaceId: ws.id },
    })
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before[0].id)
    expect(after[0].content).toBe('roteador novo texto')
    expect(expectOk(await repo.countByWorkspace(ws.id))).toBe(1)

    // A source without text loses every chunk.
    expect(
      await write(ws.id, 'wiki-page', [{ sourceId: 'p1', chunks: [] }]),
    ).toBe(0)
    expect(expectOk(await repo.countByWorkspace(ws.id))).toBe(0)
    expect(expectOk(await repo.replaceSources(ws.id, 'wiki-page', []))).toBe(0)
  })

  it('should find prose questions by any stemmed, unaccented word', async () => {
    const ws = await seedWorkspace()
    await write(ws.id, 'wiki-page', [
      {
        sourceId: 'wifi',
        chunks: [
          chunk(
            ws.id,
            'wifi',
            'Para trocar a senha do Wi-Fi, abra o roteador.',
          ),
        ],
      },
      {
        sourceId: 'vpn',
        chunks: [chunk(ws.id, 'vpn', 'Configuração da VPN no notebook.')],
      },
    ])
    // Not every word is in the chunk: the OR query still finds it.
    expect(
      await sources({
        ...query(ws.id),
        text: 'como eu troco a senha do roteador da filial?',
      }),
    ).toEqual(['wifi'])
    expect(
      await sources({ ...query(ws.id), text: 'configuracao vpn' }),
    ).toEqual(['vpn'])
    expect(await sources({ ...query(ws.id), text: 'de para o' })).toEqual([])
    expect(await sources({ ...query(ws.id), text: '   ' })).toEqual([])
    expect(
      await sources({ ...query(ws.id, { types: [] }), text: 'vpn' }),
    ).toEqual([])
  })

  it('should never leak across workspaces, source types or audiences', async () => {
    const ws = await seedWorkspace()
    const other = await seedWorkspace()
    await write(other.id, 'wiki-page', [
      { sourceId: 'theirs', chunks: [chunk(other.id, 'theirs', 'impressora')] },
    ])
    await write(ws.id, 'sd-kb-article', [
      {
        sourceId: 'internal',
        chunks: [
          chunk(ws.id, 'internal', 'impressora interna', {
            sourceType: 'sd-kb-article',
            audience: 'AGENTS',
          }),
        ],
      },
      {
        sourceId: 'portal',
        chunks: [
          chunk(ws.id, 'portal', 'impressora portal', {
            sourceType: 'sd-kb-article',
          }),
        ],
      },
    ])
    await write(ws.id, 'sd-ticket', [
      {
        sourceId: 'mine',
        chunks: [
          chunk(ws.id, 'mine', 'impressora do meu chamado', {
            sourceType: 'sd-ticket',
            audience: 'PARTIES',
            userIds: ['requester'],
          }),
        ],
      },
    ])

    const text = 'impressora'
    expect((await sources({ ...query(ws.id), text })).sort()).toEqual([
      'internal',
      'mine',
      'portal',
    ])
    // Requester: portal articles and own tickets only.
    expect(
      (
        await sources({
          ...query(ws.id, { isSdAgent: false, userId: 'requester' }),
          text,
        })
      ).sort(),
    ).toEqual(['mine', 'portal'])
    expect(
      await sources({
        ...query(ws.id, { isSdAgent: false, userId: 'someone-else' }),
        text,
      }),
    ).toEqual(['portal'])
    // Type allow-list.
    expect(
      await sources({ ...query(ws.id, { types: ['sd-ticket'] }), text }),
    ).toEqual(['mine'])
    expect(await sources({ ...query(other.id), text })).toEqual(['theirs'])
  })

  it('should remove sources, stale chunks, whole workspaces and AI-off workspaces', async () => {
    const ws = await seedWorkspace()
    const off = await seedWorkspace()
    await prisma.workspaceAiSettings.create({
      data: {
        workspaceId: off.id,
        enabledModels: [],
        crmAssistantModel: 'openai:gpt-4o-mini',
        whatsappReplyModel: 'openai:gpt-4o-mini',
        whatsappSentimentModel: 'openai:gpt-4o-mini',
        aiEnabled: false,
      },
    })
    await write(ws.id, 'crm-note', [
      {
        sourceId: 'n1',
        chunks: [chunk(ws.id, 'n1', 'a', { sourceType: 'crm-note' })],
      },
      {
        sourceId: 'n2',
        chunks: [chunk(ws.id, 'n2', 'b', { sourceType: 'crm-note' })],
      },
    ])
    await write(off.id, 'crm-note', [
      {
        sourceId: 'x',
        chunks: [chunk(off.id, 'x', 'c', { sourceType: 'crm-note' })],
      },
    ])

    expect(expectOk(await repo.removeSources(ws.id, 'crm-note', ['n1']))).toBe(
      1,
    )
    expect(expectOk(await repo.removeSources(ws.id, 'crm-note', []))).toBe(0)
    // Wrong type: nothing.
    expect(expectOk(await repo.removeSources(ws.id, 'wiki-page', ['n2']))).toBe(
      0,
    )

    const cutoff = expectOk(await repo.now())
    await write(ws.id, 'crm-note', [
      {
        sourceId: 'n3',
        chunks: [chunk(ws.id, 'n3', 'd', { sourceType: 'crm-note' })],
      },
    ])
    expect(expectOk(await repo.removeStale(ws.id, 'crm-note', cutoff))).toBe(1)
    expect(expectOk(await repo.countByWorkspace(ws.id))).toBe(1)

    expect(expectOk(await repo.removeAiDisabled())).toBe(1)
    expect(expectOk(await repo.countByWorkspace(off.id))).toBe(0)
    expect(expectOk(await repo.removeWorkspace(ws.id))).toBe(1)
    expect(expectOk(await repo.countByWorkspace(ws.id))).toBe(0)
  })

  it('should drop the chunks with the workspace (LGPD)', async () => {
    const ws = await seedWorkspace()
    await write(ws.id, 'wiki-page', [
      { sourceId: 'p', chunks: [chunk(ws.id, 'p', 'texto')] },
    ])
    await prisma.workspace.delete({ where: { id: ws.id } })
    expect(await prisma.aiKnowledgeChunk.count()).toBe(0)
  })

  it('should return DATABASE_ERROR on failures', async () => {
    expectErr(
      await repo.replaceSources('missing-ws', 'wiki-page', [
        { sourceId: 'p', chunks: [chunk('missing-ws', 'p', 'x')] },
      ]),
      'DATABASE_ERROR',
    )
    const exec = vi
      .spyOn(prisma, '$executeRaw')
      .mockRejectedValue(new Error('x'))
    expectErr(
      await repo.removeSources('w', 'wiki-page', ['p']),
      'DATABASE_ERROR',
    )
    expectErr(await repo.removeWorkspace('w'), 'DATABASE_ERROR')
    expectErr(
      await repo.removeStale('w', 'wiki-page', new Date()),
      'DATABASE_ERROR',
    )
    expectErr(await repo.removeAiDisabled(), 'DATABASE_ERROR')
    expectErr(
      await repo.saveEmbeddings(MODEL, [
        { chunkId: 'c', workspaceId: 'w', contentHash: 'h', vector: '[1]' },
      ]),
      'DATABASE_ERROR',
    )
    exec.mockRestore()

    const raw = vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('x'))
    expectErr(await repo.now(), 'DATABASE_ERROR')
    expectErr(
      await repo.searchText({ ...query('w'), text: 'x' }),
      'DATABASE_ERROR',
    )
    expectErr(await repo.vectorEnabled(), 'DATABASE_ERROR')
    expectErr(await repo.enableVector(), 'DATABASE_ERROR')
    expectErr(await repo.listToEmbed('w', MODEL, 10), 'DATABASE_ERROR')
    raw.mockRestore()

    const tx = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValue(new Error('x'))
    expectErr(
      await repo.searchVector({ ...query('w'), vector: '[1]', model: MODEL }),
      'DATABASE_ERROR',
    )
    tx.mockRestore()

    const count = vi
      .spyOn(prisma.aiKnowledgeChunk, 'count')
      .mockRejectedValue(new Error('x'))
    expectErr(await repo.countByWorkspace('w'), 'DATABASE_ERROR')
    count.mockRestore()
  })

  it('should short-circuit empty inputs', async () => {
    expect(expectOk(await repo.saveEmbeddings(MODEL, []))).toBe(0)
    expect(
      expectOk(
        await repo.searchVector({
          ...query('w', { types: [] }),
          vector: '[1]',
          model: MODEL,
        }),
      ),
    ).toEqual([])
  })
})

/*
 * pgvector half. The local dev image may not have pgvector yet
 * (docs/runbooks/postgres-pgvector.md); CI runs pgvector/pgvector:pg17, so
 * these always run there.
 */
const vectorReady = expectOk(await repo.enableVector())

describe('AiKnowledgeChunkRepository (vector half)', () => {
  it('should report whether the sidecar exists', async () => {
    expect(expectOk(await repo.vectorEnabled())).toBe(vectorReady)
  })

  it.runIf(vectorReady)(
    'should embed what is missing or stale and find the nearest chunks',
    async () => {
      const ws = await seedWorkspace()
      const other = await seedWorkspace()
      await write(ws.id, 'wiki-page', [
        { sourceId: 'a', chunks: [chunk(ws.id, 'a', 'alfa')] },
        { sourceId: 'b', chunks: [chunk(ws.id, 'b', 'beta')] },
      ])
      await write(ws.id, 'sd-ticket', [
        {
          sourceId: 't',
          chunks: [
            chunk(ws.id, 't', 'gama', {
              sourceType: 'sd-ticket',
              audience: 'PARTIES',
              userIds: ['requester'],
            }),
          ],
        },
      ])
      await write(other.id, 'wiki-page', [
        { sourceId: 'o', chunks: [chunk(other.id, 'o', 'alfa')] },
      ])

      const pending = expectOk(await repo.listToEmbed(ws.id, MODEL, 10))
      expect(pending.map((c) => c.content).sort()).toEqual([
        'alfa',
        'beta',
        'gama',
      ])
      const axis: Record<string, number> = { alfa: 1, beta: 2, gama: 3 }
      expect(
        expectOk(
          await repo.saveEmbeddings(
            MODEL,
            pending.map((c) => ({
              chunkId: c.id,
              workspaceId: c.workspaceId,
              contentHash: c.contentHash,
              vector: toVectorLiteral(fakeEmbedding(axis[c.content])),
            })),
          ),
        ),
      ).toBe(3)
      expect(expectOk(await repo.listToEmbed(ws.id, MODEL, 10))).toEqual([])
      // Another model: everything is pending again.
      expect(
        expectOk(await repo.listToEmbed(ws.id, 'other-model', 10)),
      ).toHaveLength(3)

      const near = expectOk(
        await repo.searchVector({
          ...query(ws.id),
          vector: toVectorLiteral(fakeEmbedding(1, 0.1)),
          model: MODEL,
        }),
      )
      expect(near[0].sourceId).toBe('a')
      expect(near[0].score).toBeGreaterThan(0.9)
      expect(near.map((h) => h.sourceId)).not.toContain('o')

      // Requester without the ticket: the PARTIES chunk is filtered in SQL.
      const asStranger = expectOk(
        await repo.searchVector({
          ...query(ws.id, { isSdAgent: false, userId: 'stranger' }),
          vector: toVectorLiteral(fakeEmbedding(3)),
          model: MODEL,
        }),
      )
      expect(asStranger.map((h) => h.sourceId)).not.toContain('t')

      // Edited text: the old embedding no longer matches and is pending.
      await write(ws.id, 'wiki-page', [
        { sourceId: 'a', chunks: [chunk(ws.id, 'a', 'alfa editado')] },
      ])
      const stale = expectOk(await repo.listToEmbed(ws.id, MODEL, 10))
      expect(stale.map((c) => c.content)).toEqual(['alfa editado'])
      const afterEdit = expectOk(
        await repo.searchVector({
          ...query(ws.id),
          vector: toVectorLiteral(fakeEmbedding(1)),
          model: MODEL,
        }),
      )
      expect(afterEdit.map((h) => h.sourceId)).not.toContain('a')

      // A chunk deleted before its embedding is saved is skipped.
      await repo.removeSources(ws.id, 'wiki-page', ['a'])
      expect(
        expectOk(
          await repo.saveEmbeddings(MODEL, [
            {
              chunkId: stale[0].id,
              workspaceId: ws.id,
              contentHash: stale[0].contentHash,
              vector: toVectorLiteral(fakeEmbedding(9)),
            },
          ]),
        ),
      ).toBe(0)
    },
  )
})
