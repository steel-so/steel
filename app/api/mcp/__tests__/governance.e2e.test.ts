import type { ModuleKind } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  seedIntegrationGrant,
  seedOauthAccessToken,
  seedOauthClient,
} from '@/src/__tests__/factories/integration-grant.factory'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

/**
 * MCP writes (mcp-governance), end to end without a real OAuth client: the
 * grant and the access token are seeded the way the provider stores them.
 */

const URL_MCP = `${BASE_URL}/api/mcp`
let nextId = 1

async function mcp(
  token: string,
  method: string,
  params?: Record<string, unknown>,
) {
  const res = await fetch(URL_MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
  return { status: res.status, body: await res.json() }
}

async function setMcpWrite(workspaceId: string, mcpWriteEnabled: boolean) {
  await prisma.workspaceAiSettings.upsert({
    where: { workspaceId },
    update: { mcpWriteEnabled },
    create: {
      workspaceId,
      enabledModels: ['openai:gpt-4o-mini'],
      crmAssistantModel: 'openai:gpt-4o-mini',
      whatsappReplyModel: 'openai:gpt-4o-mini',
      whatsappSentimentModel: 'openai:gpt-4o-mini',
      mcpWriteEnabled,
    },
  })
}

async function connectedApp(opts: {
  scopes: string[]
  modules?: ModuleKind[]
}) {
  const { user, workspace } = await authenticatedOwner()
  const client = await seedOauthClient({ name: 'Claude' })
  const grant = await seedIntegrationGrant({
    userId: user.id,
    workspaceId: workspace.id,
    clientId: client.clientId,
    scopes: opts.scopes,
    modules: opts.modules ?? ['CRM', 'COMMUNICATION'],
  })
  const token = await seedOauthAccessToken({
    clientId: client.clientId,
    userId: user.id,
    referenceId: grant.id,
    scopes: opts.scopes,
  })
  return { user, workspace, client, grant, token: token.raw }
}

const toolNames = (body: { result: { tools: { name: string }[] } }) =>
  body.result.tools.map((tool) => tool.name)

describe('MCP writes', () => {
  it('should offer writes only after the admin switch, never a DELETE', async () => {
    const { workspace, token } = await connectedApp({
      scopes: ['mcp:read', 'mcp:write'],
    })

    const before = await mcp(token, 'tools/list')
    expect(before.status).toBe(200)
    expect(toolNames(before.body)).not.toContain('crm_create_task')

    // A hidden write answers like an unknown tool.
    const hidden = await mcp(token, 'tools/call', {
      name: 'crm_create_task',
      arguments: { title: 'Ligar' },
    })
    expect(hidden.body.error.code).toBe(-32602)

    await setMcpWrite(workspace.id, true)
    const after = await mcp(token, 'tools/list')
    const names = toolNames(after.body)
    expect(names).toContain('crm_create_task')
    expect(names).toContain('zap_message_send_text')
    expect(names.some((name) => /_delete_/.test(name))).toBe(false)
  })

  it('should keep a read-only grant read-only with the switch on', async () => {
    const { workspace, token } = await connectedApp({ scopes: ['mcp:read'] })
    await setMcpWrite(workspace.id, true)

    const list = await mcp(token, 'tools/list')
    expect(list.status).toBe(200)
    expect(
      list.body.result.tools.every(
        (tool: { annotations: { readOnlyHint: boolean } }) =>
          tool.annotations.readOnlyHint,
      ),
    ).toBe(true)
  })

  it('should run a non customer-facing write once per idempotency key and log it as MCP', async () => {
    const { workspace, client, token } = await connectedApp({
      scopes: ['mcp:read', 'mcp:write'],
    })
    await setMcpWrite(workspace.id, true)
    const title = `Ligar ${nextId}`
    const call = () =>
      mcp(token, 'tools/call', {
        name: 'crm_create_task',
        arguments: { title, idempotencyKey: `e2e-${workspace.id}` },
      })

    const first = await call()
    expect(first.status).toBe(200)
    const structured = first.body.result.structuredContent
    expect(structured.status).toBe('executed')
    expect(structured.target.href).toMatch(/^https?:\/\/[^/]+\//)

    const second = await call()
    expect(second.body.result.structuredContent.actionId).toBe(
      structured.actionId,
    )

    expect(
      await prisma.crmTask.count({
        where: { workspaceId: workspace.id, title },
      }),
    ).toBe(1)
    const logs = await prisma.aiActionLog.findMany({
      where: { workspaceId: workspace.id },
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      source: 'MCP',
      oauthClientId: client.clientId,
      toolName: 'crm_create_task',
      outcome: 'success',
    })
  })
})

describe('Confirming a write an MCP client proposed', () => {
  async function proposed() {
    const app = await connectedApp({ scopes: ['mcp:read', 'mcp:write'] })
    const action = await prisma.aiPendingAction.create({
      data: {
        workspaceId: app.workspace.id,
        requestedById: app.user.id,
        integrationGrantId: app.grant.id,
        toolName: 'zap_message_send_text',
        kind: 'ACTION',
        module: 'COMMUNICATION',
        args: { conversationId: 'missing', text: 'Olá' },
        preview: { title: 'Enviar mensagem', summary: 'Olá' },
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    })
    return { ...app, action }
  }

  const confirmPath = (workspaceId: string, actionId: string) =>
    `/api/workspaces/${workspaceId}/ai/actions/${actionId}/confirm`

  it('should list it in the inbox with the connected app', async () => {
    const { user, workspace, client, action } = await proposed()

    const res = await getJson(
      `/api/workspaces/${workspace.id}/notifications/ai-pending`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const item = (await res.json()).data.items.find(
      (i: { action: { id: string } }) => i.action.id === action.id,
    )
    expect(item).toMatchObject({
      source: 'ASSISTANT',
      path: '/inbox?view=ai',
      client: { id: client.clientId, name: 'Claude' },
    })
  })

  it('should refuse while MCP writes are off and for someone else', async () => {
    const { user, workspace, action } = await proposed()

    const off = await postJson(
      confirmPath(workspace.id, action.id),
      {},
      user.cookie,
    )
    expect(off.status).toBe(403)
    expect((await off.json()).error.code).toBe('MCP_WRITE_DISABLED')

    await setMcpWrite(workspace.id, true)
    const colleague = await addMember(workspace.id, 'ADMIN')
    const other = await postJson(
      confirmPath(workspace.id, action.id),
      {},
      colleague.cookie,
    )
    expect(other.status).toBe(404)
  })

  it('should cancel it when the user revokes the app', async () => {
    const { user, workspace, grant, action } = await proposed()
    await setMcpWrite(workspace.id, true)

    const revoked = await deleteJson(
      `/api/users/me/integration-grants/${grant.id}`,
      user.cookie,
    )
    expect(revoked.status).toBeLessThan(300)
    expect(
      (await prisma.aiPendingAction.findUnique({ where: { id: action.id } }))
        ?.status,
    ).toBe('CANCELED')

    const res = await postJson(
      confirmPath(workspace.id, action.id),
      {},
      user.cookie,
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('AI_PENDING_ACTION_NOT_PENDING')
  })
})

describe('MCP writes without a valid token', () => {
  it('should answer 401 before looking at the write arguments', async () => {
    const res = await fetch(URL_MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer stl_at_revoked',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'crm_create_task',
          arguments: { title: 'x', idempotencyKey: 'k' },
        },
      }),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('invalid_token')
  })

  it('should answer 401 once the grant was revoked', async () => {
    const { user, grant, token } = await connectedApp({
      scopes: ['mcp:read', 'mcp:write'],
    })
    const ok = await mcp(token, 'tools/list')
    expect(ok.status).toBe(200)

    await deleteJson(
      `/api/users/me/integration-grants/${grant.id}`,
      user.cookie,
    )
    const after = await mcp(token, 'tools/list')
    expect(after.status).toBe(401)
  })
})
