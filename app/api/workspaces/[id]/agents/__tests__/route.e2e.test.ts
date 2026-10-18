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

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/agents`

const agentBody = (ownerId: string, extra: Record<string, unknown> = {}) => ({
  name: 'Triagem de tarefas',
  instructions: 'Crie uma tarefa de acompanhamento para cada lead novo.',
  triggerType: 'MANUAL',
  ownerId,
  tools: [
    { toolName: 'crm_create_task', mode: 'AUTO' },
    { toolName: 'crm_delete_task', mode: 'AUTO' },
    { toolName: 'ws_overview' },
  ],
  ...extra,
})

async function seedPendingRun(workspaceId: string, ownerId: string) {
  const agent = await prisma.steelAgent.create({
    data: {
      workspaceId,
      name: 'Agente',
      instructions: 'x',
      triggerType: 'MANUAL',
      ownerId,
      tools: {
        create: [
          { toolName: 'crm_create_task', mode: 'APPROVAL' },
          { toolName: 'crm_delete_task', mode: 'APPROVAL' },
        ],
      },
    },
  })
  const run = await prisma.steelAgentRun.create({
    data: {
      workspaceId,
      agentId: agent.id,
      triggerType: 'MANUAL',
      status: 'WAITING_APPROVAL',
    },
  })
  const action = (data: { toolName: string; kind: 'CREATE' | 'DELETE' }) =>
    prisma.aiPendingAction.create({
      data: {
        workspaceId,
        agentRunId: run.id,
        toolName: data.toolName,
        kind: data.kind,
        module: 'CRM',
        args:
          data.kind === 'CREATE'
            ? { title: 'Ligar para o cliente' }
            : { taskId: 'missing-task' },
        // What crm_create_task shows for these args: approval rebuilds the
        // preview and refuses (409) when it no longer matches.
        preview:
          data.kind === 'CREATE'
            ? {
                title: 'Criar a tarefa “Ligar para o cliente”',
                summary: 'Uma nova tarefa entra no CRM.',
                fields: [
                  { label: 'Título', after: 'Ligar para o cliente' },
                  { label: 'Status', after: 'A fazer' },
                ],
                target: { type: 'crm_task', label: 'Ligar para o cliente' },
              }
            : { title: 'Ação do agente', summary: '' },
        requiresDoubleConfirm: data.kind === 'DELETE',
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    })
  return { agent, run, action }
}

describe('Steel Agents routes — authentication', () => {
  it.each([
    ['GET', ''],
    ['POST', ''],
    ['GET', '/catalog'],
    ['GET', '/a1'],
    ['POST', '/a1/run'],
    ['POST', '/a1/test'],
    ['GET', '/a1/runs'],
    ['POST', '/runs/r1/actions/x/approve'],
    ['POST', '/runs/r1/actions/x/reject'],
  ])('should return 401 for %s %s without a session', async (method, path) => {
    const res = await fetch(`${BASE_URL}${base('ws')}${path}`, {
      method,
      headers: defaultHeaders,
      ...(method === 'POST' && { body: '{}' }),
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 for a non-member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    for (const path of ['', '/catalog']) {
      const res = await getJson(`${base(workspace.id)}${path}`, stranger.cookie)
      expect(res.status).toBe(403)
    }
  })
})

describe('Steel Agents CRUD', () => {
  it('should create, list, read, update and delete an agent', async () => {
    const { user, workspace } = await authenticatedOwner()

    const created = await postJson(
      base(workspace.id),
      agentBody(user.id),
      user.cookie,
    )
    expect(created.status).toBe(201)
    const agent = (await created.json()).data
    expect(agent.tools).toEqual(
      expect.arrayContaining([
        { toolName: 'crm_create_task', mode: 'AUTO' },
        { toolName: 'crm_delete_task', mode: 'APPROVAL' },
        { toolName: 'ws_overview', mode: 'APPROVAL' },
      ]),
    )
    expect(agent.owner.id).toBe(user.id)

    const list = await getJson(base(workspace.id), user.cookie)
    expect((await list.json()).data.map((a: { id: string }) => a.id)).toEqual([
      agent.id,
    ])

    const patched = await patchJson(
      `${base(workspace.id)}/${agent.id}`,
      { triggerType: 'SCHEDULE', cron: '0 8 * * 1-5', enabled: false },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    const patchedBody = (await patched.json()).data
    expect(patchedBody.cron).toBe('0 8 * * 1-5')
    expect(patchedBody.nextRunAt).not.toBeNull()
    expect(patchedBody.enabled).toBe(false)

    const paused = await postJson(
      `${base(workspace.id)}/${agent.id}/run`,
      {},
      user.cookie,
    )
    expect(paused.status).toBe(409)

    const deleted = await deleteJson(
      `${base(workspace.id)}/${agent.id}`,
      user.cookie,
    )
    expect(deleted.status).toBe(200)
    const gone = await getJson(`${base(workspace.id)}/${agent.id}`, user.cookie)
    expect(gone.status).toBe(404)
  })

  it('should validate the body and the trigger', async () => {
    const { user, workspace } = await authenticatedOwner()
    const noCron = await postJson(
      base(workspace.id),
      agentBody(user.id, { triggerType: 'SCHEDULE' }),
      user.cookie,
    )
    expect(noCron.status).toBe(422)

    const badTool = await postJson(
      base(workspace.id),
      agentBody(user.id, { tools: [{ toolName: 'nope_tool' }] }),
      user.cookie,
    )
    expect(badTool.status).toBe(422)
    expect((await badTool.json()).error.code).toBe('STEEL_AGENT_INVALID_TOOL')

    const stranger = await createAuthenticatedUser()
    const badOwner = await postJson(
      base(workspace.id),
      agentBody(stranger.id),
      user.cookie,
    )
    expect((await badOwner.json()).error.code).toBe('STEEL_AGENT_INVALID_OWNER')
  })

  it('should let members view but not manage', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id)
    const created = await postJson(
      base(workspace.id),
      agentBody(user.id),
      user.cookie,
    )
    const agent = (await created.json()).data

    expect((await getJson(base(workspace.id), member.cookie)).status).toBe(200)
    const catalog = await getJson(
      `${base(workspace.id)}/catalog`,
      member.cookie,
    )
    const catalogBody = (await catalog.json()).data
    expect(catalogBody.canManage).toBe(false)
    expect(catalogBody.tools.length).toBeGreaterThan(0)

    expect(
      (await postJson(base(workspace.id), agentBody(member.id), member.cookie))
        .status,
    ).toBe(403)
    expect(
      (
        await patchJson(
          `${base(workspace.id)}/${agent.id}`,
          { name: 'x' },
          member.cookie,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await postJson(
          `${base(workspace.id)}/${agent.id}/run`,
          {},
          member.cookie,
        )
      ).status,
    ).toBe(403)
  })

  it('should 404 an agent of another workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const created = await postJson(
      base(other.workspace.id),
      agentBody(other.user.id),
      other.user.cookie,
    )
    const agent = (await created.json()).data
    const res = await getJson(`${base(workspace.id)}/${agent.id}`, user.cookie)
    expect(res.status).toBe(404)
  })
})

describe('Steel Agents runs', () => {
  it('should queue a manual run and show it in the history', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = await postJson(
      base(workspace.id),
      agentBody(user.id),
      user.cookie,
    )
    const agent = (await created.json()).data

    const run = await postJson(
      `${base(workspace.id)}/${agent.id}/run`,
      {},
      user.cookie,
    )
    expect(run.status).toBe(202)
    const runBody = (await run.json()).data
    expect(runBody.triggerType).toBe('MANUAL')

    const list = await getJson(
      `${base(workspace.id)}/${agent.id}/runs?limit=5`,
      user.cookie,
    )
    expect((await list.json()).data.map((r: { id: string }) => r.id)).toContain(
      runBody.id,
    )

    const detail = await getJson(
      `${base(workspace.id)}/${agent.id}/runs/${runBody.id}`,
      user.cookie,
    )
    expect(detail.status).toBe(200)
    expect((await detail.json()).data.canApprove).toBe(true)

    const badQuery = await getJson(
      `${base(workspace.id)}/${agent.id}/runs?limit=0`,
      user.cookie,
    )
    expect(badQuery.status).toBe(422)
  })
})

describe('Steel Agents test runs', () => {
  it('should queue a test run, also for a paused agent, and keep it out of the last run', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = await postJson(
      base(workspace.id),
      { ...agentBody(user.id), enabled: false },
      user.cookie,
    )
    const agent = (await created.json()).data

    const run = await postJson(
      `${base(workspace.id)}/${agent.id}/test`,
      {},
      user.cookie,
    )
    expect(run.status).toBe(202)
    const runBody = (await run.json()).data
    expect(runBody.isTest).toBe(true)
    expect(runBody.triggerType).toBe('MANUAL')

    // "Executar agora" still refuses the paused agent.
    const real = await postJson(
      `${base(workspace.id)}/${agent.id}/run`,
      {},
      user.cookie,
    )
    expect(real.status).not.toBe(202)

    const list = await getJson(
      `${base(workspace.id)}/${agent.id}/runs?limit=5`,
      user.cookie,
    )
    const runs = (await list.json()).data as { id: string; isTest: boolean }[]
    expect(runs.find((r) => r.id === runBody.id)?.isTest).toBe(true)

    const detail = await getJson(
      `${base(workspace.id)}/${agent.id}`,
      user.cookie,
    )
    expect((await detail.json()).data.lastRun).toBeNull()
  })

  it('should 404 an agent of another workspace', async () => {
    const { user } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const created = await postJson(
      base(other.workspace.id),
      agentBody(other.user.id),
      other.user.cookie,
    )
    const agent = (await created.json()).data
    const run = await postJson(
      `${base(other.workspace.id)}/${agent.id}/test`,
      {},
      user.cookie,
    )
    expect([403, 404]).toContain(run.status)
  })
})

describe('Steel Agents approvals', () => {
  it('should approve as the owner and execute with the owner permissions', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { run, action } = await seedPendingRun(workspace.id, user.id)
    const pending = await action({
      toolName: 'crm_create_task',
      kind: 'CREATE',
    })

    const res = await postJson(
      `${base(workspace.id)}/runs/${run.id}/actions/${pending.id}/approve`,
      {},
      user.cookie,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()).data
    expect(body.status).toBe('EXECUTED')
    expect(
      await prisma.crmTask.count({
        where: { workspaceId: workspace.id, title: 'Ligar para o cliente' },
      }),
    ).toBe(1)
    const log = await prisma.aiActionLog.findUnique({
      where: { pendingActionId: pending.id },
    })
    expect(log?.source).toBe('AGENT')

    const again = await postJson(
      `${base(workspace.id)}/runs/${run.id}/actions/${pending.id}/approve`,
      {},
      user.cookie,
    )
    expect((await again.json()).data.status).toBe('EXECUTED')
  })

  it('should require double confirmation for DELETE and allow rejecting', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { run, action } = await seedPendingRun(workspace.id, user.id)
    const del = await action({ toolName: 'crm_delete_task', kind: 'DELETE' })

    const single = await postJson(
      `${base(workspace.id)}/runs/${run.id}/actions/${del.id}/approve`,
      {},
      user.cookie,
    )
    expect(single.status).toBe(422)
    expect((await single.json()).error.code).toBe(
      'AI_DOUBLE_CONFIRMATION_REQUIRED',
    )

    const rejected = await postJson(
      `${base(workspace.id)}/runs/${run.id}/actions/${del.id}/reject`,
      {},
      user.cookie,
    )
    expect(rejected.status).toBe(200)
    expect((await rejected.json()).data.status).toBe('CANCELED')

    const twice = await postJson(
      `${base(workspace.id)}/runs/${run.id}/actions/${del.id}/reject`,
      {},
      user.cookie,
    )
    expect(twice.status).toBe(409)
  })

  it('should forbid members who are neither owner nor admin', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id)
    const { run, action } = await seedPendingRun(workspace.id, user.id)
    const pending = await action({
      toolName: 'crm_create_task',
      kind: 'CREATE',
    })
    const res = await postJson(
      `${base(workspace.id)}/runs/${run.id}/actions/${pending.id}/approve`,
      {},
      member.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should keep the assistant confirm route away from agent actions', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { action } = await seedPendingRun(workspace.id, user.id)
    const pending = await action({
      toolName: 'crm_create_task',
      kind: 'CREATE',
    })
    const res = await postJson(
      `/api/workspaces/${workspace.id}/ai/actions/${pending.id}/confirm`,
      {},
      user.cookie,
    )
    expect(res.status).toBe(404)
  })

  it('should 404 an action from another run', async () => {
    const { user, workspace } = await authenticatedOwner()
    const first = await seedPendingRun(workspace.id, user.id)
    const second = await seedPendingRun(workspace.id, user.id)
    const pending = await first.action({
      toolName: 'crm_create_task',
      kind: 'CREATE',
    })
    const res = await postJson(
      `${base(workspace.id)}/runs/${second.run.id}/actions/${pending.id}/approve`,
      {},
      user.cookie,
    )
    expect(res.status).toBe(404)
  })
})
