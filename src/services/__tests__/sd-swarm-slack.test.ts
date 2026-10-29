import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/workspace-integration.repository')
vi.mock('@/src/lib/servicedesk/slack-client', () => ({
  SlackClient: {
    createChannel: vi.fn(),
    lookupByEmail: vi.fn(),
    inviteToChannel: vi.fn(),
    postMessage: vi.fn(),
    archiveChannel: vi.fn(),
  },
}))
vi.mock('../sd-integration-credentials', () => ({
  decryptSdIntegrationToken: vi.fn(),
}))

import { SlackClient } from '@/src/lib/servicedesk/slack-client'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import { decryptSdIntegrationToken } from '../sd-integration-credentials'
import { SdSwarmSlack } from '../sd-swarm-slack'

const slack = vi.mocked(SlackClient)
const repo = vi.mocked(WorkspaceIntegrationRepository)
const decrypt = vi.mocked(decryptSdIntegrationToken)

const input = {
  workspaceId: 'ws1',
  ticketCode: 'INC-000007',
  ticketTitle: 'Link fora',
  ticketUrl: 'https://steel.test/demo/servicedesk/tickets/7',
  reason: 'Rede caiu',
  emails: ['a@x', 'b@x'],
}
const failure = (message: string) =>
  err({ code: 'SD_INTEGRATION_REQUEST_FAILED', message } as never)

beforeEach(() => {
  vi.clearAllMocks()
  repo.findByKind.mockResolvedValue(ok({ status: 'ACTIVE' } as never))
  decrypt.mockResolvedValue(ok('xoxb-token'))
  slack.createChannel.mockResolvedValue(
    ok({ id: 'C1', name: 'swarm-inc-000007', isPrivate: true }),
  )
  slack.lookupByEmail.mockImplementation(async (_t, email) =>
    email === 'a@x' ? 'U1' : null,
  )
  slack.inviteToChannel.mockResolvedValue(ok(true))
  slack.postMessage.mockResolvedValue(ok({ channel: 'C1', ts: '1' }))
  slack.archiveChannel.mockResolvedValue(ok(true))
})

describe('SdSwarmSlack.open', () => {
  it('creates the channel, invites who has a Slack account and posts', async () => {
    const out = expectOk(await SdSwarmSlack.open(input))
    expect(out).toEqual({ channelId: 'C1', channelName: 'swarm-inc-000007' })
    expect(slack.createChannel).toHaveBeenCalledWith('xoxb-token', {
      name: 'swarm-inc-000007',
      isPrivate: true,
    })
    expect(slack.inviteToChannel).toHaveBeenCalledWith('xoxb-token', {
      channel: 'C1',
      userIds: ['U1'],
    })
    expect(slack.postMessage.mock.calls[0][1].text).toContain(input.ticketUrl)
  })

  it('retries once with a salt when the name is taken', async () => {
    slack.createChannel
      .mockResolvedValueOnce(failure('O Slack recusou a chamada (name_taken)'))
      .mockResolvedValueOnce(
        ok({ id: 'C2', name: 'swarm-inc-000007-ab12', isPrivate: true }),
      )
    expect(expectOk(await SdSwarmSlack.open(input)).channelId).toBe('C2')
    expect(slack.createChannel.mock.calls[1][1].name).toMatch(
      /^swarm-inc-000007-[a-z0-9]+$/,
    )
  })

  it('fails on other Slack errors without retrying', async () => {
    slack.createChannel.mockResolvedValue(failure('missing_scope'))
    expectErr(await SdSwarmSlack.open(input), 'SD_INTEGRATION_REQUEST_FAILED')
    expect(slack.createChannel).toHaveBeenCalledTimes(1)
  })

  it('keeps going when invite and post fail, and skips invite with no Slack users', async () => {
    slack.inviteToChannel.mockResolvedValue(failure('not_in_channel'))
    slack.postMessage.mockResolvedValue(failure('channel_not_found'))
    expectOk(await SdSwarmSlack.open(input))
    slack.inviteToChannel.mockClear()
    slack.lookupByEmail.mockResolvedValue(null)
    expectOk(await SdSwarmSlack.open(input))
    expect(slack.inviteToChannel).not.toHaveBeenCalled()
  })

  it('explains when Slack is not connected', async () => {
    repo.findByKind.mockResolvedValue(ok(null))
    expectErr(await SdSwarmSlack.open(input), 'SD_INTEGRATION_NOT_CONFIGURED')
    repo.findByKind.mockResolvedValue(ok({ status: 'DISCONNECTED' } as never))
    expectErr(await SdSwarmSlack.open(input), 'SD_INTEGRATION_NOT_CONFIGURED')
    repo.findByKind.mockResolvedValue(err(databaseError()))
    expectErr(await SdSwarmSlack.open(input), 'DATABASE_ERROR')
    repo.findByKind.mockResolvedValue(ok({ status: 'ACTIVE' } as never))
    decrypt.mockResolvedValue(err(databaseError()))
    expectErr(await SdSwarmSlack.open(input), 'DATABASE_ERROR')
  })
})

describe('SdSwarmSlack.invite', () => {
  it('invites the Slack users of the e-mails', async () => {
    expect(
      expectOk(await SdSwarmSlack.invite('ws1', 'C1', ['a@x', 'b@x'])),
    ).toBe(1)
    expect(slack.inviteToChannel).toHaveBeenCalledWith('xoxb-token', {
      channel: 'C1',
      userIds: ['U1'],
    })
  })

  it('returns 0 without calling Slack when nobody matches, and propagates errors', async () => {
    expect(expectOk(await SdSwarmSlack.invite('ws1', 'C1', ['b@x']))).toBe(0)
    expect(slack.inviteToChannel).not.toHaveBeenCalled()
    slack.inviteToChannel.mockResolvedValue(failure('x'))
    expectErr(await SdSwarmSlack.invite('ws1', 'C1', ['a@x']))
    repo.findByKind.mockResolvedValue(ok(null))
    expectErr(await SdSwarmSlack.invite('ws1', 'C1', ['a@x']))
  })
})

describe('SdSwarmSlack.close', () => {
  it('posts the outcome and archives', async () => {
    expect(await SdSwarmSlack.close('ws1', 'C1', 'Trocado o switch')).toBe(true)
    expect(slack.postMessage.mock.calls[0][1].text).toContain(
      'Trocado o switch',
    )
    expect(slack.archiveChannel).toHaveBeenCalledWith('xoxb-token', 'C1')
  })

  it('says so when there is no outcome and reports archive failures', async () => {
    slack.archiveChannel.mockResolvedValue(failure('already_archived'))
    expect(await SdSwarmSlack.close('ws1', 'C1', null)).toBe(false)
    expect(slack.postMessage.mock.calls[0][1].text).toContain('Sem resumo')
  })

  it('returns false when Slack is gone', async () => {
    repo.findByKind.mockResolvedValue(ok(null))
    expect(await SdSwarmSlack.close('ws1', 'C1', null)).toBe(false)
    expect(slack.archiveChannel).not.toHaveBeenCalled()
  })
})

describe('SdSwarmSlack.available', () => {
  it('is true only with a live connection', async () => {
    expect(await SdSwarmSlack.available('ws1')).toBe(true)
    repo.findByKind.mockResolvedValue(ok({ status: 'DISCONNECTED' } as never))
    expect(await SdSwarmSlack.available('ws1')).toBe(false)
    repo.findByKind.mockResolvedValue(ok(null))
    expect(await SdSwarmSlack.available('ws1')).toBe(false)
    repo.findByKind.mockResolvedValue(err(databaseError()))
    expect(await SdSwarmSlack.available('ws1')).toBe(false)
  })
})
