import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/ai`

describe('Steel AI routes — authentication', () => {
  it.each([
    ['GET', 'capabilities'],
    ['GET', 'conversations'],
    ['POST', 'conversations'],
    ['GET', 'actions'],
    ['POST', 'conversations/c1/messages'],
    ['POST', 'actions/a1/confirm'],
  ])('should return 401 for %s %s without a session', async (method, path) => {
    const res = await fetch(`${BASE_URL}${base('ws')}/${path}`, {
      method,
      headers: defaultHeaders,
      ...(method === 'POST' && { body: '{}' }),
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 for a non-member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    for (const path of ['capabilities', 'conversations', 'actions']) {
      const res = await getJson(
        `${base(workspace.id)}/${path}`,
        stranger.cookie,
      )
      expect(res.status).toBe(403)
    }
  })
})

describe('GET /ai/capabilities', () => {
  it('should describe agent mode, modules and quota', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(`${base(workspace.id)}/capabilities`, user.cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual(
      expect.objectContaining({
        agentModeEnabled: true,
        modules: expect.any(Array),
        quota: expect.objectContaining({ quotaUsd: 50 }),
      }),
    )
  })
})

describe('Steel AI conversations', () => {
  it('should create, list, rename, pin and delete a private conversation', async () => {
    const { user, workspace } = await authenticatedOwner()

    const created = await postJson(
      `${base(workspace.id)}/conversations`,
      { title: 'Chamados da semana' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const conversation = (await created.json()).data
    expect(conversation.mode).toBe('EXPLORE')

    const list = await getJson(
      `${base(workspace.id)}/conversations?q=chamados`,
      user.cookie,
    )
    expect((await list.json()).data.map((c: { id: string }) => c.id)).toEqual([
      conversation.id,
    ])

    const patched = await patchJson(
      `${base(workspace.id)}/conversations/${conversation.id}`,
      { title: 'Renomeada', pinned: true },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    const patchedBody = (await patched.json()).data
    expect(patchedBody.title).toBe('Renomeada')
    expect(patchedBody.pinnedAt).not.toBeNull()

    const messages = await getJson(
      `${base(workspace.id)}/conversations/${conversation.id}/messages`,
      user.cookie,
    )
    expect(messages.status).toBe(200)
    expect((await messages.json()).data).toEqual([])

    const deleted = await deleteJson(
      `${base(workspace.id)}/conversations/${conversation.id}`,
      user.cookie,
    )
    expect(deleted.status).toBe(200)

    const gone = await getJson(
      `${base(workspace.id)}/conversations/${conversation.id}`,
      user.cookie,
    )
    expect(gone.status).toBe(404)
  })

  it('should hide a conversation from other members (404)', async () => {
    const { user, workspace } = await authenticatedOwner()
    const colleague = await addMember(workspace.id)
    const created = await postJson(
      `${base(workspace.id)}/conversations`,
      {},
      user.cookie,
    )
    const { id } = (await created.json()).data

    for (const res of [
      await getJson(
        `${base(workspace.id)}/conversations/${id}`,
        colleague.cookie,
      ),
      await getJson(
        `${base(workspace.id)}/conversations/${id}/messages`,
        colleague.cookie,
      ),
      await postJson(
        `${base(workspace.id)}/conversations/${id}/messages`,
        { content: 'Oi' },
        colleague.cookie,
      ),
    ]) {
      expect(res.status).toBe(404)
    }
  })

  it('should validate bodies and query strings', async () => {
    const { user, workspace } = await authenticatedOwner()
    expect(
      (
        await postJson(
          `${base(workspace.id)}/conversations`,
          { mode: 'TURBO' },
          user.cookie,
        )
      ).status,
    ).toBe(422)

    const created = await postJson(
      `${base(workspace.id)}/conversations`,
      {},
      user.cookie,
    )
    const { id } = (await created.json()).data
    expect(
      (
        await patchJson(
          `${base(workspace.id)}/conversations/${id}`,
          {},
          user.cookie,
        )
      ).status,
    ).toBe(422)
    expect(
      (
        await postJson(
          `${base(workspace.id)}/conversations/${id}/messages`,
          { content: '   ' },
          user.cookie,
        )
      ).status,
    ).toBe(422)
    expect(
      (await getJson(`${base(workspace.id)}/actions?status=DONE`, user.cookie))
        .status,
    ).toBe(422)
  })

  it('should refuse the agent mode when an admin switched it off', async () => {
    const { user, workspace } = await authenticatedOwner()
    const off = await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { agentModeEnabled: false },
      user.cookie,
    )
    expect(off.status).toBe(200)
    expect((await off.json()).data.agentModeEnabled).toBe(false)

    const res = await postJson(
      `${base(workspace.id)}/conversations`,
      { mode: 'AGENT' },
      user.cookie,
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('AI_AGENT_MODE_DISABLED')
  })
})

describe('Steel AI pending actions', () => {
  async function seedAction(
    workspaceId: string,
    userId: string,
    overrides = {},
  ) {
    return prisma.aiPendingAction.create({
      data: {
        workspaceId,
        requestedById: userId,
        toolName: 'crm_create_task',
        kind: 'CREATE',
        module: 'CRM',
        args: {},
        preview: { title: 'Criar tarefa', summary: 'x' },
        expiresAt: new Date(Date.now() + 30 * 60_000),
        ...overrides,
      },
    })
  }

  it('should list own actions and cancel them once', async () => {
    const { user, workspace } = await authenticatedOwner()
    const action = await seedAction(workspace.id, user.id)

    const list = await getJson(
      `${base(workspace.id)}/actions?status=PENDING`,
      user.cookie,
    )
    expect((await list.json()).data.map((a: { id: string }) => a.id)).toEqual([
      action.id,
    ])

    const canceled = await postJson(
      `${base(workspace.id)}/actions/${action.id}/cancel`,
      {},
      user.cookie,
    )
    expect(canceled.status).toBe(200)
    expect((await canceled.json()).data.status).toBe('CANCELED')

    const again = await postJson(
      `${base(workspace.id)}/actions/${action.id}/cancel`,
      {},
      user.cookie,
    )
    expect(again.status).toBe(409)
  })

  it('should never let another member confirm or cancel', async () => {
    const { user, workspace } = await authenticatedOwner()
    const colleague = await addMember(workspace.id, 'ADMIN')
    const action = await seedAction(workspace.id, user.id)

    for (const verb of ['confirm', 'cancel']) {
      const res = await postJson(
        `${base(workspace.id)}/actions/${action.id}/${verb}`,
        {},
        colleague.cookie,
      )
      expect(res.status).toBe(404)
    }
  })

  it('should refuse expired actions and validate the confirm body', async () => {
    const { user, workspace } = await authenticatedOwner()
    const expired = await seedAction(workspace.id, user.id, {
      expiresAt: new Date(Date.now() - 1_000),
    })

    const res = await postJson(
      `${base(workspace.id)}/actions/${expired.id}/confirm`,
      {},
      user.cookie,
    )
    expect(res.status).toBe(410)

    const invalid = await postJson(
      `${base(workspace.id)}/actions/${expired.id}/confirm`,
      { doubleConfirmed: 'sim' },
      user.cookie,
    )
    expect(invalid.status).toBe(422)
  })
})

describe('POST /ai/actions/[actionId]/confirm — stale preview', () => {
  it('should refuse when the record changed after the preview, then run the fresh one', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = await postJson(
      `/api/workspaces/${workspace.id}/crm/tasks`,
      { title: 'Ligar' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const task = (await created.json()).data

    // What the user was shown when the AI proposed to finish the task.
    const action = await prisma.aiPendingAction.create({
      data: {
        workspaceId: workspace.id,
        requestedById: user.id,
        toolName: 'crm_update_task',
        kind: 'UPDATE',
        module: 'CRM',
        args: { taskId: task.id, status: 'DONE' },
        preview: {
          title: 'Concluir a tarefa “Ligar”',
          summary: '1 campo(s) alterado(s).',
          fields: [{ label: 'Status', before: 'A fazer', after: 'Concluída' }],
        },
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    })

    // Someone else edits the task before the click.
    const edited = await patchJson(
      `/api/workspaces/${workspace.id}/crm/tasks/${task.id}`,
      { title: 'Ligar para a Acme' },
      user.cookie,
    )
    expect(edited.status).toBe(200)

    const refused = await postJson(
      `${base(workspace.id)}/actions/${action.id}/confirm`,
      {},
      user.cookie,
    )
    expect(refused.status).toBe(409)
    const refusedBody = await refused.json()
    expect(refusedBody.error.code).toBe('AI_PENDING_ACTION_CHANGED')
    expect(refusedBody.message).toBe(
      'O registro mudou desde a prévia. Revise e confirme de novo.',
    )
    expect(refusedBody.error.details.action.status).toBe('PENDING')
    expect(refusedBody.error.details.action.preview.title).toContain(
      'Ligar para a Acme',
    )
    const untouched = await prisma.crmTask.findUnique({
      where: { id: task.id },
    })
    expect(untouched?.status).toBe('TODO')

    // The second click confirms the preview the user now sees.
    const confirmed = await postJson(
      `${base(workspace.id)}/actions/${action.id}/confirm`,
      {},
      user.cookie,
    )
    expect(confirmed.status).toBe(200)
    expect((await confirmed.json()).data.status).toBe('EXECUTED')
    const done = await prisma.crmTask.findUnique({ where: { id: task.id } })
    expect(done?.status).toBe('DONE')
  })
})
