import { describe, expect, it } from 'vitest'
import {
  createFakeSdAiTriageRecord,
  seedSdAiSuggestion,
} from '@/src/__tests__/factories/nov-s9-ai-vs-technician.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdCategory,
  seedSdDepartment,
  seedSdDepartmentMember,
  seedSdPhaseFlow,
  seedSdSettings,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const url = (workspaceId: string, query = '') =>
  `/api/workspaces/${workspaceId}/servicedesk/ai/comparison${query}`

async function setup() {
  const { user: agent, workspace } = await authenticatedOwner()
  await seedSdSettings(workspace.id)
  const flow = await seedSdPhaseFlow(workspace.id)
  const department = await seedSdDepartment(workspace.id)
  await seedSdDepartmentMember(department.id, agent.id)
  const requester = await addMember(workspace.id)
  return { agent, requester, workspace, flow }
}

describe('ServiceDesk AI vs. technician panel', () => {
  it('returns 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}${url('x')}`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('is agent-only: requester and stranger are refused', async () => {
    const { workspace, requester } = await setup()
    const stranger = await createAuthenticatedUser()

    expect((await getJson(url(workspace.id), stranger.cookie)).status).toBe(403)
    const res = await getJson(url(workspace.id), requester.cookie)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('SD_NOT_AGENT')
  })

  it('rejects a period outside 7, 30 and 90 days', async () => {
    const { workspace, agent } = await setup()
    const res = await getJson(url(workspace.id, '?days=15'), agent.cookie)
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('compares the triage and the copilot with what the technician did', async () => {
    const { workspace, agent, flow } = await setup()
    const category = await seedSdCategory(workspace.id, { name: 'Hardware' })
    const ticket = await seedSdTicket(workspace.id, flow.resolved.id, {
      title: 'Impressora parada',
      categoryId: category.id,
      solution: 'Troquei o toner da impressora',
      aiTriage: createFakeSdAiTriageRecord({
        suggestions: {
          category: { id: 'other', name: 'Rede' },
          subcategory: null,
          service: null,
          impact: null,
          urgency: null,
          priority: null,
          department: null,
          tags: [],
          confidence: 0.9,
          reasoning: '',
        },
      }) as never,
    })
    await seedSdAiSuggestion(workspace.id, ticket.id, {
      userId: agent.id,
      kind: 'SOLUTION',
      text: 'Troquei o toner da impressora',
    })

    const res = await getJson(url(workspace.id, '?days=7'), agent.cookie)
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.periodDays).toBe(7)
    expect(data.summary).toMatchObject({
      triaged: 1,
      settled: 1,
      accuracy: 0,
      corrections: 1,
    })
    expect(data.divergences[0]).toMatchObject({
      title: 'Impressora parada',
      field: 'category',
      suggested: 'Rede',
      final: 'Hardware',
    })
    expect(data.texts[1]).toMatchObject({ kind: 'SOLUTION', adopted: 1 })
    expect(data.agents[0]).toMatchObject({ userId: agent.id, used: 1 })
  })
})
