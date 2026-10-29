import { describe, expect, it } from 'vitest'
import { SD_SWARM_MAX_MEMBERS } from '@/src/lib/servicedesk/swarm'
import {
  CloseSdSwarmSchema,
  InviteSdSwarmSchema,
  RespondSdSwarmSchema,
  StartSdSwarmSchema,
} from '../sd-swarm.schema'

describe('StartSdSwarmSchema', () => {
  it('accepts a reason and specialists, Slack off by default', () => {
    const parsed = StartSdSwarmSchema.parse({
      reason: '  Rede caiu  ',
      userIds: ['u1'],
    })
    expect(parsed).toEqual({
      reason: 'Rede caiu',
      userIds: ['u1'],
      openSlackChannel: false,
    })
  })

  it('rejects a short reason, no specialists and too many', () => {
    expect(
      StartSdSwarmSchema.safeParse({ reason: 'ab', userIds: ['u'] }).success,
    ).toBe(false)
    expect(
      StartSdSwarmSchema.safeParse({ reason: 'abc', userIds: [] }).success,
    ).toBe(false)
    const many = Array.from({ length: SD_SWARM_MAX_MEMBERS + 1 }, (_, i) =>
      String(i + 1),
    )
    expect(
      StartSdSwarmSchema.safeParse({ reason: 'abc', userIds: many }).success,
    ).toBe(false)
  })
})

describe('other swarm schemas', () => {
  it('validates invite, respond and close', () => {
    expect(InviteSdSwarmSchema.safeParse({ userIds: ['u'] }).success).toBe(true)
    expect(InviteSdSwarmSchema.safeParse({ userIds: [] }).success).toBe(false)
    expect(RespondSdSwarmSchema.safeParse({ response: 'JOIN' }).success).toBe(
      true,
    )
    expect(RespondSdSwarmSchema.safeParse({ response: 'MAYBE' }).success).toBe(
      false,
    )
    expect(CloseSdSwarmSchema.parse({})).toEqual({})
    expect(CloseSdSwarmSchema.parse({ outcome: ' ok ' })).toEqual({
      outcome: 'ok',
    })
    expect(
      CloseSdSwarmSchema.safeParse({ outcome: 'x'.repeat(2001) }).success,
    ).toBe(false)
  })
})
