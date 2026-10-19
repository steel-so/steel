import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/ai`

/** An assistant answer (and the question before it) in the user's chat. */
async function seedTurn(workspaceId: string, userId: string) {
  const conversation = await prisma.aiConversation.create({
    data: { workspaceId, userId, title: 'SLA' },
  })
  await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'USER',
      content: 'Qual o SLA de um incidente crítico?',
      createdAt: new Date(Date.now() - 1000),
    },
  })
  return prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: 'Quatro horas úteis.',
      modelKey: 'openai:gpt-4o-mini',
    },
  })
}

describe('POST/GET/DELETE /ai/feedback', () => {
  it('rates an answer, lists it, re-rates it and undoes it', async () => {
    const { user, workspace } = await authenticatedOwner()
    const message = await seedTurn(workspace.id, user.id)

    const created = await postJson(
      `${base(workspace.id)}/feedback`,
      { surface: 'STEEL_AI_MESSAGE', targetId: message.id, rating: 'UP' },
      user.cookie,
    )
    expect(created.status).toBe(200)
    const first = (await created.json()).data
    expect(first).toMatchObject({
      rating: 'UP',
      modelKey: 'openai:gpt-4o-mini',
    })

    const again = await postJson(
      `${base(workspace.id)}/feedback`,
      {
        surface: 'STEEL_AI_MESSAGE',
        targetId: message.id,
        rating: 'DOWN',
        reason: 'incomplete',
        comment: 'Faltou citar o calendário.',
      },
      user.cookie,
    )
    expect((await again.json()).data.id).toBe(first.id)

    const list = await getJson(
      `${base(workspace.id)}/feedback?surface=STEEL_AI_MESSAGE&targetIds=${message.id},other`,
      user.cookie,
    )
    const rows = (await list.json()).data
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rating: 'DOWN', reason: 'incomplete' })

    const removed = await deleteJson(
      `${base(workspace.id)}/feedback/${first.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
    expect(await prisma.aiFeedback.count({ where: { id: first.id } })).toBe(0)
  })

  it('refuses an answer from someone else chat and invalid bodies', async () => {
    const { user, workspace } = await authenticatedOwner()
    const message = await seedTurn(workspace.id, user.id)
    const member = await addMember(workspace.id, 'MEMBER')

    const foreign = await postJson(
      `${base(workspace.id)}/feedback`,
      { surface: 'STEEL_AI_MESSAGE', targetId: message.id, rating: 'UP' },
      member.cookie,
    )
    expect(foreign.status).toBe(404)
    expect((await foreign.json()).error.code).toBe(
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )

    const invalid = await postJson(
      `${base(workspace.id)}/feedback`,
      { surface: 'SD_COPILOT', targetId: 't1', rating: 'UP' },
      user.cookie,
    )
    expect(invalid.status).toBe(400)
  })

  it('needs a session', async () => {
    const { workspace } = await authenticatedOwner()
    const res = await getJson(
      `${base(workspace.id)}/feedback?surface=STEEL_AI_MESSAGE&targetIds=x`,
    )
    expect(res.status).toBe(401)
  })
})

describe('GET /ai/quality', () => {
  it('shows the personal view to members and the workspace view to admins', async () => {
    const { user, workspace } = await authenticatedOwner()
    const message = await seedTurn(workspace.id, user.id)
    await postJson(
      `${base(workspace.id)}/feedback`,
      { surface: 'STEEL_AI_MESSAGE', targetId: message.id, rating: 'DOWN' },
      user.cookie,
    )

    const res = await getJson(
      `${base(workspace.id)}/quality?scope=workspace&period=last_7_days`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.totals).toMatchObject({ down: 1, total: 1, approvalRate: 0 })
    expect(data.resolution).not.toBeNull()
    expect(data.worst[0].link).toMatchObject({ kind: 'chat' })

    const member = await addMember(workspace.id, 'MEMBER')
    const denied = await getJson(
      `${base(workspace.id)}/quality?scope=workspace`,
      member.cookie,
    )
    expect(denied.status).toBe(403)
    const personal = await getJson(
      `${base(workspace.id)}/quality?scope=personal`,
      member.cookie,
    )
    expect((await personal.json()).data.totals.total).toBe(0)
  })

  it('exports a CSV', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `${base(workspace.id)}/quality/export?scope=workspace&view=surface`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(await res.text()).toContain('aprovacao_percentual')
  })
})

describe('/ai/evals', () => {
  it('lets an admin build a set, add cases and queue a run', async () => {
    const { user, workspace } = await authenticatedOwner()
    const message = await seedTurn(workspace.id, user.id)

    const created = await postJson(
      `${base(workspace.id)}/evals`,
      { name: 'Suporte', target: 'STEEL_ASSISTANT' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const set = (await created.json()).data

    const empty = await postJson(
      `${base(workspace.id)}/evals/${set.id}/runs`,
      {},
      user.cookie,
    )
    expect((await empty.json()).error.code).toBe('AI_EVAL_SET_EMPTY')

    const added = await postJson(
      `${base(workspace.id)}/evals/${set.id}/cases`,
      { input: 'Qual o SLA?', mustContain: ['horas'] },
      user.cookie,
    )
    expect(added.status).toBe(201)
    const testCase = (await added.json()).data

    const fromChat = await postJson(
      `${base(workspace.id)}/evals/cases/from-message`,
      { setId: set.id, messageId: message.id },
      user.cookie,
    )
    expect(fromChat.status).toBe(201)
    expect((await fromChat.json()).data).toMatchObject({
      input: 'Qual o SLA de um incidente crítico?',
      expected: 'Quatro horas úteis.',
    })

    const edited = await patchJson(
      `${base(workspace.id)}/evals/${set.id}/cases/${testCase.id}`,
      { criteria: 'Citar o prazo' },
      user.cookie,
    )
    expect(edited.status).toBe(200)

    const detail = await getJson(
      `${base(workspace.id)}/evals/${set.id}`,
      user.cookie,
    )
    expect((await detail.json()).data.cases).toHaveLength(2)

    const run = await postJson(
      `${base(workspace.id)}/evals/${set.id}/runs`,
      { reason: 'manual' },
      user.cookie,
    )
    expect(run.status).toBe(202)
    const queued = (await run.json()).data
    expect(queued).toMatchObject({ status: 'QUEUED', caseCount: 2 })

    const busy = await postJson(
      `${base(workspace.id)}/evals/${set.id}/runs`,
      {},
      user.cookie,
    )
    expect((await busy.json()).error.code).toBe('AI_EVAL_RUN_IN_PROGRESS')

    const runs = await getJson(
      `${base(workspace.id)}/evals/${set.id}/runs`,
      user.cookie,
    )
    expect((await runs.json()).data[0].id).toBe(queued.id)
    const one = await getJson(
      `${base(workspace.id)}/evals/${set.id}/runs/${queued.id}`,
      user.cookie,
    )
    expect(one.status).toBe(200)

    const latest = await getJson(
      `${base(workspace.id)}/evals/latest?target=STEEL_ASSISTANT`,
      user.cookie,
    )
    expect((await latest.json()).data[0].id).toBe(set.id)

    const removedCase = await deleteJson(
      `${base(workspace.id)}/evals/${set.id}/cases/${testCase.id}`,
      user.cookie,
    )
    expect(removedCase.status).toBe(200)
    const renamed = await patchJson(
      `${base(workspace.id)}/evals/${set.id}`,
      { name: 'FAQ' },
      user.cookie,
    )
    expect((await renamed.json()).data.name).toBe('FAQ')
    const removed = await deleteJson(
      `${base(workspace.id)}/evals/${set.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
    expect(await prisma.aiEvalRun.count({ where: { setId: set.id } })).toBe(0)
  })

  it('keeps eval sets away from members', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const res = await getJson(`${base(workspace.id)}/evals`, member.cookie)
    expect(res.status).toBe(403)
    const create = await postJson(
      `${base(workspace.id)}/evals`,
      { name: 'x', target: 'STEEL_ASSISTANT' },
      member.cookie,
    )
    expect(create.status).toBe(403)
  })
})
