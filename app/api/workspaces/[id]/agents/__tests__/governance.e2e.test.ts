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
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/agents`

const rule = { mode: 'NONE', tools: [] }
const policy = {
  restrictCreators: true,
  creatorRoles: ['MEMBER'],
  restrictAuto: true,
  autoRules: { ADMIN: rule, MEMBER: rule, VIEWER: rule },
}

describe('Agent governance routes — authentication', () => {
  it.each([
    ['GET', '/governance'],
    ['GET', '/governance/export'],
    ['POST', '/governance/kill'],
    ['POST', '/governance/resume'],
    ['PUT', '/governance/policy'],
    ['GET', '/mcp-servers'],
    ['POST', '/mcp-servers'],
    ['PATCH', '/mcp-servers/s1'],
    ['DELETE', '/mcp-servers/s1'],
    ['POST', '/mcp-servers/s1/refresh'],
  ])('should return 401 for %s %s without a session', async (method, path) => {
    const res = await fetch(`${BASE_URL}${base('ws')}${path}`, {
      method,
      headers: defaultHeaders,
      ...(method !== 'GET' && method !== 'DELETE' && { body: '{}' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('Agent governance routes', () => {
  it('should show the panel to the owner and keep members out', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const panel = await getJson(`${base(workspace.id)}/governance`, user.cookie)
    expect(panel.status).toBe(200)
    const body = (await panel.json()).data
    expect(body.killSwitch.active).toBe(false)
    expect(body.agents).toEqual([])

    const denied = await getJson(
      `${base(workspace.id)}/governance`,
      member.cookie,
    )
    expect(denied.status).toBe(403)
    expect(
      (await getJson(`${base(workspace.id)}/governance?days=0`, user.cookie))
        .status,
    ).toBe(422)

    const csv = await fetch(
      `${BASE_URL}${base(workspace.id)}/governance/export`,
      { headers: { ...defaultHeaders, Cookie: user.cookie } },
    )
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
  })

  it('should pause and resume the agents, owner/admin only', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const path = `${base(workspace.id)}/governance`

    expect((await postJson(`${path}/kill`, {}, member.cookie)).status).toBe(403)
    const killed = await postJson(
      `${path}/kill`,
      { reason: 'Teste' },
      user.cookie,
    )
    expect(killed.status).toBe(200)
    expect((await killed.json()).data.killSwitch).toEqual(
      expect.objectContaining({ active: true, reason: 'Teste' }),
    )
    const panel = await (await getJson(path, user.cookie)).json()
    expect(panel.data.killSwitch.active).toBe(true)

    expect((await postJson(`${path}/resume`, {}, member.cookie)).status).toBe(
      403,
    )
    const resumed = await postJson(`${path}/resume`, {}, user.cookie)
    expect(resumed.status).toBe(200)
    expect((await resumed.json()).data.active).toBe(false)
  })

  it('should save the creators and AUTO policy', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const path = `${base(workspace.id)}/governance/policy`

    expect((await putJson(path, policy, member.cookie)).status).toBe(403)
    expect(
      (await putJson(path, { ...policy, creatorRoles: ['ROOT'] }, user.cookie))
        .status,
    ).toBe(422)
    const saved = await putJson(path, policy, user.cookie)
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toEqual(
      expect.objectContaining({
        restrictCreators: true,
        creatorRoles: ['MEMBER'],
      }),
    )
    const catalog = await getJson(
      `${base(workspace.id)}/catalog`,
      member.cookie,
    )
    expect((await catalog.json()).data).toEqual(
      expect.objectContaining({ canCreate: true, autoRestricted: true }),
    )
  })
})

describe('MCP server routes', () => {
  it('should refuse private and non-HTTPS URLs and keep members out', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const path = `${base(workspace.id)}/mcp-servers`

    expect((await getJson(path, member.cookie)).status).toBe(403)
    expect((await getJson(path, user.cookie)).status).toBe(200)
    for (const url of [
      'http://mcp.example.com/mcp',
      'https://127.0.0.1/mcp',
      'https://169.254.169.254/latest',
      'https://localhost/mcp',
    ]) {
      const res = await postJson(path, { name: 'X', url }, user.cookie)
      expect(res.status).toBe(422)
      expect((await res.json()).error.code).toBe('STEEL_MCP_SERVER_INVALID')
    }
    expect((await postJson(path, { name: 'X' }, user.cookie)).status).toBe(422)
  })

  it('should 404 an unknown server', async () => {
    const { user, workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const path = `${base(workspace.id)}/mcp-servers/missing`
    expect((await patchJson(path, { name: 'Y' }, user.cookie)).status).toBe(404)
    expect((await deleteJson(path, user.cookie)).status).toBe(404)
    expect((await postJson(`${path}/refresh`, {}, user.cookie)).status).toBe(
      404,
    )
    expect(
      (await getJson(path.replace('/missing', ''), stranger.cookie)).status,
    ).toBe(403)
  })
})
