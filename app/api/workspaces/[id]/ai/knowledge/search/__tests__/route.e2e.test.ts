import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { knowledgeContentHash } from '@/src/lib/ai/knowledge/chunking'
import type { KnowledgeSourceType } from '@/src/lib/ai/knowledge/sources'
import type { KnowledgeChunkInput } from '@/src/lib/ai/knowledge/types'
import { prisma } from '@/src/lib/prisma'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'

const url = (ws: string, qs: string) =>
  `/api/workspaces/${ws}/ai/knowledge/search?${qs}`

function chunk(
  workspaceId: string,
  sourceType: KnowledgeSourceType,
  sourceId: string,
  content: string,
  overrides: Partial<KnowledgeChunkInput> = {},
): KnowledgeChunkInput {
  const title = overrides.title ?? `Fonte ${sourceId}`
  return {
    workspaceId,
    sourceType,
    sourceId,
    chunkIndex: 0,
    module: null,
    audience: 'PUBLIC',
    userIds: [],
    path: `/x/${sourceId}`,
    sourceUpdatedAt: new Date(),
    ...overrides,
    title,
    content,
    contentHash: knowledgeContentHash(title, content),
  }
}

async function seed(
  workspaceId: string,
  sourceType: KnowledgeSourceType,
  sourceId: string,
  content: string,
  overrides: Partial<KnowledgeChunkInput> = {},
) {
  const result = await AiKnowledgeChunkRepository.replaceSources(
    workspaceId,
    sourceType,
    [
      {
        sourceId,
        chunks: [chunk(workspaceId, sourceType, sourceId, content, overrides)],
      },
    ],
  )
  if (!result.ok) throw new Error(result.error.message)
}

async function sourceIds(path: string, cookie: string): Promise<string[]> {
  const res = await getJson(path, cookie)
  expect(res.status).toBe(200)
  const body = await res.json()
  return body.data.results.map((r: { sourceId: string }) => r.sourceId).sort()
}

describe('GET /api/workspaces/[id]/ai/knowledge/search', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/x/ai/knowledge/search?q=vpn`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('should return 403 for a non-member and 422 for bad params', async () => {
    const { user, workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    expect(
      (await getJson(url(workspace.id, 'q=vpn'), stranger.cookie)).status,
    ).toBe(403)
    expect((await getJson(url(workspace.id, 'q=a'), user.cookie)).status).toBe(
      422,
    )
    expect(
      (await getJson(url(workspace.id, 'q=vpn&sources=crm-lead'), user.cookie))
        .status,
    ).toBe(422)
  })

  it('should answer with citations and only the sources each user may see', async () => {
    const { user: owner, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const other = await authenticatedOwner()

    await seed(
      workspace.id,
      'crm-note',
      'note',
      'Roteador da filial: senha trocada',
      {
        module: 'CRM',
        path: '/crm/companies?record=c1',
      },
    )
    await seed(
      workspace.id,
      'zap-knowledge-doc',
      'doc',
      'Senha do roteador no manual',
      {
        module: 'COMMUNICATION',
      },
    )
    await seed(
      other.workspace.id,
      'crm-note',
      'theirs',
      'Senha do roteador deles',
      {
        module: 'CRM',
      },
    )

    const q = 'q=como%20trocar%20a%20senha%20do%20roteador'
    expect(await sourceIds(url(workspace.id, q), owner.cookie)).toEqual([
      'doc',
      'note',
    ])
    // WhatsApp AI documents are for OWNER/ADMIN only.
    expect(await sourceIds(url(workspace.id, q), member.cookie)).toEqual([
      'note',
    ])

    const body = await (
      await getJson(url(workspace.id, `${q}&sources=crm-note`), owner.cookie)
    ).json()
    expect(body.data.results).toHaveLength(1)
    expect(body.data.results[0]).toMatchObject({
      sourceType: 'crm-note',
      sourceLabel: 'Nota do CRM',
      href: `/${workspace.slug}/crm/companies?record=c1`,
      matchedBy: ['text'],
    })
    expect(['text', 'hybrid']).toContain(body.data.mode)
  })

  it('should refuse when Steel AI is off in the workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    await prisma.workspaceAiSettings.create({
      data: {
        workspaceId: workspace.id,
        enabledModels: [],
        crmAssistantModel: 'openai:gpt-4o-mini',
        whatsappReplyModel: 'openai:gpt-4o-mini',
        whatsappSentimentModel: 'openai:gpt-4o-mini',
        aiEnabled: false,
      },
    })
    const res = await getJson(url(workspace.id, 'q=vpn'), user.cookie)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('AI_DISABLED')
  })
})
