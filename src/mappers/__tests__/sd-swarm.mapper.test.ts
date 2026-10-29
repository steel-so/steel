import { describe, expect, it } from 'vitest'
import { createFakeSdSwarm } from '@/src/__tests__/factories/nov-s6-swarming.factory'
import { toSdSwarmDTO } from '../sd-swarm.mapper'

describe('toSdSwarmDTO', () => {
  it('maps an open swarm with no Slack channel', () => {
    const dto = toSdSwarmDTO(createFakeSdSwarm({ id: 's' }))
    expect(dto).toMatchObject({
      id: 's',
      status: 'OPEN',
      closedAt: null,
      slack: { status: 'NONE', channelName: null, error: null },
    })
    expect(dto.startedAt).toBe('2026-10-29T12:00:00.000Z')
    expect(dto.members[0]).toMatchObject({
      status: 'INVITED',
      respondedAt: null,
      user: { name: 'Rui Rede' },
    })
  })

  it('reports the Slack channel as active, archived or failed', () => {
    const active = toSdSwarmDTO(
      createFakeSdSwarm({ slackChannelId: 'C1', slackChannelName: 'swarm-x' }),
    )
    expect(active.slack).toEqual({
      status: 'ACTIVE',
      channelName: 'swarm-x',
      error: null,
    })
    const archived = toSdSwarmDTO(
      createFakeSdSwarm({
        slackChannelId: 'C1',
        slackArchivedAt: new Date('2026-10-29T15:00:00Z'),
      }),
    )
    expect(archived.slack.status).toBe('ARCHIVED')
    const failed = toSdSwarmDTO(createFakeSdSwarm({ slackError: 'sem token' }))
    expect(failed.slack).toMatchObject({ status: 'FAILED', error: 'sem token' })
  })

  it('serializes the closing data', () => {
    const closedAt = new Date('2026-10-29T16:00:00Z')
    const dto = toSdSwarmDTO(
      createFakeSdSwarm({
        status: 'CLOSED',
        closedAt,
        outcome: 'Resolvido',
        members: [
          {
            ...createFakeSdSwarm().members[0],
            status: 'JOINED',
            respondedAt: closedAt,
          },
        ],
      }),
    )
    expect(dto).toMatchObject({
      status: 'CLOSED',
      outcome: 'Resolvido',
      closedAt: closedAt.toISOString(),
    })
    expect(dto.members[0].respondedAt).toBe(closedAt.toISOString())
  })
})
