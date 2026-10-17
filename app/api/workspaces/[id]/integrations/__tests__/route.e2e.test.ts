import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { fakeGitlabToken } from '@/src/__tests__/helpers/fake-tokens'
import { prisma } from '@/src/lib/prisma'

/**
 * Ajustes > Integrações (ADR 0024). No network in e2e: the Slack app is not
 * configured on the test server (so Slack must show as unavailable) and
 * GitHub/GitLab calls fail with fake tokens. What is checked is the
 * contract: OWNER/ADMIN only, availability, validation, and that **no
 * response returns a token or a secret**.
 */

const api = (ws: string) => `/api/workspaces/${ws}/integrations`
const GH_TOKEN = 'github_pat_token_invalido_de_teste_0001'
const GL_TOKEN = fakeGitlabToken('token-invalido-de-teste-0001')

async function seedConnection(
  workspaceId: string,
  userId: string,
  kind: 'SLACK' | 'GITHUB' | 'GITLAB',
  config: object = {},
) {
  return prisma.workspaceIntegration.create({
    data: {
      workspaceId,
      createdById: userId,
      kind,
      externalId: kind === 'SLACK' ? 'T0001' : 'grupo/projeto',
      externalName: kind === 'SLACK' ? 'Stratus' : 'grupo/projeto',
      baseUrl: kind === 'GITLAB' ? 'https://gitlab.com' : null,
      encryptedToken: 'enc:token-super-secreto',
      encryptedSigningSecret: kind === 'SLACK' ? null : 'enc:segredo-hook',
      config,
    },
  })
}

describe('GET /workspaces/{id}/integrations', () => {
  it('lists the three providers with Slack unavailable on this server', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedConnection(workspace.id, user.id, 'GITLAB')
    const res = await getJson(api(workspace.id), user.cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    const [slack, github, gitlab] = body.data.providers
    expect(slack.kind).toBe('SLACK')
    expect(slack.available).toBe(false)
    expect(slack.unavailableReason).toContain('SLACK_CLIENT_ID')
    expect(github.webhookUrl).toContain('/api/integrations/github/webhook')
    expect(github.connection).toBeNull()
    expect(gitlab.connection.externalId).toBe('grupo/projeto')
    expect(gitlab.connection.hasWebhookSecret).toBe(true)
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('token-super-secreto')
    expect(raw).not.toContain('segredo-hook')
  })

  it('refuses members, non-members and no session', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    expect((await getJson(api(workspace.id), member.cookie)).status).toBe(403)
    const stranger = await createAuthenticatedUser()
    expect((await getJson(api(workspace.id), stranger.cookie)).status).toBe(403)
    expect((await getJson(api(workspace.id))).status).toBe(401)
  })

  it('lets an ADMIN in', async () => {
    const { workspace } = await authenticatedOwner()
    const admin = await addMember(workspace.id, 'ADMIN')
    expect((await getJson(api(workspace.id), admin.cookie)).status).toBe(200)
  })
})

describe('Slack', () => {
  it('connect and test answer 503 explaining the missing app', async () => {
    const { user, workspace } = await authenticatedOwner()
    const connect = await getJson(
      `${api(workspace.id)}/slack/connect`,
      user.cookie,
    )
    expect(connect.status).toBe(503)
    expect((await connect.json()).error.code).toBe(
      'SD_INTEGRATION_NOT_CONFIGURED',
    )
    expect(
      (await postJson(`${api(workspace.id)}/slack/test`, {}, user.cookie))
        .status,
    ).toBe(503)
  })

  it('rules, channels and disconnect without a connection are 404', async () => {
    const { user, workspace } = await authenticatedOwner()
    expect(
      (
        await patchJson(
          `${api(workspace.id)}/slack`,
          { waitingMinutes: 30 },
          user.cookie,
        )
      ).status,
    ).toBe(404)
    expect(
      (await getJson(`${api(workspace.id)}/slack/channels`, user.cookie))
        .status,
    ).toBe(404)
    expect(
      (await deleteJson(`${api(workspace.id)}/slack`, user.cookie)).status,
    ).toBe(404)
  })

  it('saves the rules, keeping the ServiceDesk block, and disconnects', async () => {
    const { user, workspace } = await authenticatedOwner()
    const row = await seedConnection(workspace.id, user.id, 'SLACK', {
      events: ['sla.breached'],
      channels: [{ departmentId: 'dep-1', channelId: 'C-team' }],
    })
    const res = await patchJson(
      `${api(workspace.id)}/slack`,
      {
        routes: [
          { event: 'crm.deal.won', channelId: 'C1', channelName: 'vendas' },
          { event: 'servicedesk.sla.breached', channelId: null },
        ],
        waitingMinutes: 30,
      },
      user.cookie,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.slack.routes).toHaveLength(2)
    expect(body.data.slack.waitingMinutes).toBe(30)
    const saved = await prisma.workspaceIntegration.findUnique({
      where: { id: row.id },
    })
    expect(saved?.config).toMatchObject({
      servicedesk: {
        channels: [{ departmentId: 'dep-1', channelId: 'C-team' }],
      },
    })

    expect(
      (await deleteJson(`${api(workspace.id)}/slack`, user.cookie)).status,
    ).toBe(200)
    const after = await prisma.workspaceIntegration.findUnique({
      where: { id: row.id },
    })
    expect(after?.status).toBe('DISCONNECTED')
    expect(after?.encryptedToken).toBe('')
  })

  it('refuses unknown events, rules without channel and bad thresholds', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedConnection(workspace.id, user.id, 'SLACK')
    for (const body of [
      { routes: [{ event: 'nao.existe', channelId: 'C1' }] },
      { routes: [{ event: 'crm.deal.won', channelId: null }] },
      { waitingMinutes: 1 },
      {},
    ]) {
      expect(
        (await patchJson(`${api(workspace.id)}/slack`, body, user.cookie))
          .status,
      ).toBe(422)
    }
  })
})

describe('GitHub and GitLab', () => {
  it('validates before calling the provider', async () => {
    const { user, workspace } = await authenticatedOwner()
    expect(
      (
        await postJson(
          `${api(workspace.id)}/github`,
          { repo: 'nao-e-um-repo', token: GH_TOKEN },
          user.cookie,
        )
      ).status,
    ).toBe(422)
    expect(
      (
        await postJson(
          `${api(workspace.id)}/gitlab`,
          { baseUrl: 'http://10.0.0.1', project: 'g/p', token: GL_TOKEN },
          user.cookie,
        )
      ).status,
    ).toBe(422)
    expect(
      (
        await postJson(
          `${api(workspace.id)}/gitlab`,
          { project: 'g/p', token: 'curto' },
          user.cookie,
        )
      ).status,
    ).toBe(422)
  })

  it('a token without access becomes SD_INTEGRATION_REQUEST_FAILED, nothing saved', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `${api(workspace.id)}/github`,
      {
        repo: 'steel-so/repositorio-que-nao-existe-aqui',
        token: GH_TOKEN,
        webhookSecret: 'segredo-de-teste-123',
      },
      user.cookie,
    )
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('SD_INTEGRATION_REQUEST_FAILED')
    expect(
      await prisma.workspaceIntegration.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(0)
  })

  it('rotate, test and disconnect without a connection are 404', async () => {
    const { user, workspace } = await authenticatedOwner()
    for (const kind of ['github', 'gitlab']) {
      expect(
        (
          await patchJson(
            `${api(workspace.id)}/${kind}`,
            { webhookSecret: null },
            user.cookie,
          )
        ).status,
      ).toBe(404)
      expect(
        (await postJson(`${api(workspace.id)}/${kind}/test`, {}, user.cookie))
          .status,
      ).toBe(404)
      expect(
        (await deleteJson(`${api(workspace.id)}/${kind}`, user.cookie)).status,
      ).toBe(404)
    }
  })

  it('removes the webhook secret and disconnects GitLab', async () => {
    const { user, workspace } = await authenticatedOwner()
    const row = await seedConnection(workspace.id, user.id, 'GITLAB')
    const res = await patchJson(
      `${api(workspace.id)}/gitlab`,
      { webhookSecret: null },
      user.cookie,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.hasWebhookSecret).toBe(false)
    expect(
      (await deleteJson(`${api(workspace.id)}/gitlab`, user.cookie)).status,
    ).toBe(200)
    const after = await prisma.workspaceIntegration.findUnique({
      where: { id: row.id },
    })
    expect(after?.deletedAt).not.toBeNull()
  })

  it('refuses a member on every mutation', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    expect(
      (
        await postJson(
          `${api(workspace.id)}/gitlab`,
          { project: 'g/p', token: GL_TOKEN },
          member.cookie,
        )
      ).status,
    ).toBe(403)
    expect(
      (await deleteJson(`${api(workspace.id)}/github`, member.cookie)).status,
    ).toBe(403)
  })
})
