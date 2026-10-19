import { describe, expect, it } from 'vitest'
import { fakeGitlabToken } from '@/src/__tests__/helpers/fake-tokens'
import {
  ConnectGithubSchema,
  ConnectGitlabSchema,
  SlackNotificationRouteSchema,
  UpdateRepoCredentialsSchema,
  UpdateWorkspaceSlackSchema,
  WorkspaceIntegrationKindEnum,
} from '../workspace-integration.schema'

const TOKEN = 'github_pat_11ABCDEFG0123456789'

describe('WorkspaceIntegrationKindEnum', () => {
  it('has the four providers', () => {
    expect(WorkspaceIntegrationKindEnum.options).toEqual([
      'SLACK',
      'GITHUB',
      'GITLAB',
      'APOLLO',
    ])
  })
})

describe('SlackNotificationRouteSchema', () => {
  it('accepts a catalog event with a channel and defaults the name', () => {
    expect(
      SlackNotificationRouteSchema.parse({
        event: 'crm.deal.won',
        channelId: 'C1',
      }),
    ).toEqual({ event: 'crm.deal.won', channelId: 'C1', channelName: null })
  })

  it('allows the team channel only for ServiceDesk events', () => {
    expect(
      SlackNotificationRouteSchema.parse({ event: 'servicedesk.sla.breached' }),
    ).toEqual({
      event: 'servicedesk.sla.breached',
      channelId: null,
      channelName: null,
    })
    const result = SlackNotificationRouteSchema.safeParse({
      event: 'crm.deal.won',
      channelId: null,
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe(
      'Escolha um canal para este evento',
    )
  })

  it('refuses unknown events and odd channels', () => {
    expect(
      SlackNotificationRouteSchema.safeParse({ event: 'x', channelId: 'C1' })
        .success,
    ).toBe(false)
    expect(
      SlackNotificationRouteSchema.safeParse({ event: 'x', channelId: null })
        .success,
    ).toBe(false)
    expect(
      SlackNotificationRouteSchema.safeParse({
        event: 'crm.deal.won',
        channelId: 'C 1',
      }).success,
    ).toBe(false)
  })
})

describe('UpdateWorkspaceSlackSchema', () => {
  it('accepts rules or the waiting threshold, not an empty body', () => {
    expect(UpdateWorkspaceSlackSchema.parse({ waitingMinutes: 30 })).toEqual({
      waitingMinutes: 30,
    })
    expect(UpdateWorkspaceSlackSchema.parse({ routes: [] })).toEqual({
      routes: [],
    })
    expect(UpdateWorkspaceSlackSchema.safeParse({}).success).toBe(false)
  })

  it('refuses duplicated rules and an out-of-range threshold', () => {
    expect(
      UpdateWorkspaceSlackSchema.safeParse({
        routes: [
          { event: 'crm.deal.won', channelId: 'C1' },
          { event: 'crm.deal.won', channelId: 'C1' },
        ],
      }).success,
    ).toBe(false)
    expect(
      UpdateWorkspaceSlackSchema.safeParse({
        routes: [
          { event: 'servicedesk.sla.breached', channelId: null },
          { event: 'servicedesk.sla.breached' },
        ],
      }).success,
    ).toBe(false)
    for (const waitingMinutes of [4, 1441, 10.5]) {
      expect(
        UpdateWorkspaceSlackSchema.safeParse({ waitingMinutes }).success,
      ).toBe(false)
    }
  })
})

describe('ConnectGithubSchema / ConnectGitlabSchema', () => {
  it('accepts repository, token and optional secret', () => {
    expect(ConnectGithubSchema.parse({ repo: 'o/r', token: TOKEN })).toEqual({
      repo: 'o/r',
      token: TOKEN,
    })
    expect(
      ConnectGitlabSchema.parse({
        baseUrl: 'https://git.acme.com',
        project: 'g/p',
        token: fakeGitlabToken('0123456789abcdefghij'),
        webhookSecret: 'segredo-gitlab-123',
      }).webhookSecret,
    ).toBe('segredo-gitlab-123')
  })

  it('refuses short values', () => {
    expect(
      ConnectGithubSchema.safeParse({ repo: 'ab', token: TOKEN }).success,
    ).toBe(false)
    expect(
      ConnectGitlabSchema.safeParse({ project: 'g/p', token: 'curto' }).success,
    ).toBe(false)
    expect(
      ConnectGithubSchema.safeParse({
        repo: 'o/r',
        token: TOKEN,
        webhookSecret: 'curto',
      }).success,
    ).toBe(false)
  })
})

describe('UpdateRepoCredentialsSchema', () => {
  it('rotates the token or the secret, never empty', () => {
    expect(UpdateRepoCredentialsSchema.parse({ token: TOKEN })).toEqual({
      token: TOKEN,
    })
    expect(UpdateRepoCredentialsSchema.parse({ webhookSecret: null })).toEqual({
      webhookSecret: null,
    })
    expect(UpdateRepoCredentialsSchema.safeParse({}).success).toBe(false)
  })
})
