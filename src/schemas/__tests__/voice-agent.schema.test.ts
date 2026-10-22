import { describe, expect, it } from 'vitest'
import { fakeVoiceAgentSecret } from '@/src/__tests__/helpers/fake-tokens'
import {
  CreateVoiceAgentRouteSchema,
  PabxVoiceOutcomeSchema,
  PabxVoiceSessionSchema,
  UpdateVoiceAgentRouteSchema,
  UpdateVoiceAgentSettingsSchema,
  VOICE_AGENT_VOICES,
} from '../voice-agent.schema'

const SECRET = fakeVoiceAgentSecret()

describe('UpdateVoiceAgentSettingsSchema', () => {
  it('accepts a partial update and an empty one', () => {
    expect(UpdateVoiceAgentSettingsSchema.safeParse({}).success).toBe(true)
    const parsed = UpdateVoiceAgentSettingsSchema.parse({
      enabled: true,
      voice: 'marin',
      maxCallSeconds: 600,
      monthlyMinutesCap: 1000,
      silenceTimeoutSeconds: 10,
      runAsUserId: 'user1',
      fallbackTarget: 'suporte',
    })
    expect(parsed.voice).toBe('marin')
  })

  it('turns blank texts into null and trims them', () => {
    const parsed = UpdateVoiceAgentSettingsSchema.parse({
      noticeText: '   ',
      instructions: '  Seja breve  ',
    })
    expect(parsed).toEqual({ noticeText: null, instructions: 'Seja breve' })
  })

  it.each([
    { voice: 'robot' },
    { maxCallSeconds: 10 },
    { maxCallSeconds: 901 },
    { maxCallSeconds: 60.5 },
    { monthlyMinutesCap: 0 },
    { monthlyMinutesCap: 100_001 },
    { silenceTimeoutSeconds: 4 },
    { silenceTimeoutSeconds: 61 },
    { noticeText: 'a'.repeat(501) },
    { instructions: 'a'.repeat(2001) },
    { fallbackTarget: 'rm -rf /' },
    { fallbackTarget: '' },
    { runAsUserId: '' },
    { enabled: 'yes' },
  ])('rejects %o', (input) => {
    expect(UpdateVoiceAgentSettingsSchema.safeParse(input).success).toBe(false)
  })

  it('allows clearing the identity and the destination', () => {
    expect(
      UpdateVoiceAgentSettingsSchema.parse({
        runAsUserId: null,
        fallbackTarget: null,
      }),
    ).toEqual({ runAsUserId: null, fallbackTarget: null })
  })

  it('lists every voice once', () => {
    expect(new Set(VOICE_AGENT_VOICES).size).toBe(VOICE_AGENT_VOICES.length)
  })
})

describe('route schemas', () => {
  it('creates a queue or DID route, trimming the value', () => {
    expect(
      CreateVoiceAgentRouteSchema.parse({ kind: 'QUEUE', value: ' suporte ' }),
    ).toEqual({ kind: 'QUEUE', value: 'suporte' })
    expect(
      CreateVoiceAgentRouteSchema.parse({
        kind: 'DID',
        value: '1140041234',
        label: '',
        enabled: false,
        transferTarget: '300',
      }),
    ).toEqual({
      kind: 'DID',
      value: '1140041234',
      label: null,
      enabled: false,
      transferTarget: '300',
    })
  })

  it.each([
    { kind: 'OTHER', value: 'x' },
    { kind: 'QUEUE', value: '' },
    { kind: 'QUEUE', value: 'has space' },
    { kind: 'QUEUE', value: 'a'.repeat(41) },
    { kind: 'QUEUE', value: 'x', transferTarget: 'a b' },
    { kind: 'QUEUE', value: 'x', label: 'a'.repeat(81) },
  ])('rejects %o', (input) => {
    expect(CreateVoiceAgentRouteSchema.safeParse(input).success).toBe(false)
  })

  it('updates partially', () => {
    expect(UpdateVoiceAgentRouteSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    })
    expect(
      UpdateVoiceAgentRouteSchema.parse({ transferTarget: null, label: ' ' }),
    ).toEqual({ transferTarget: null, label: null })
    expect(
      UpdateVoiceAgentRouteSchema.safeParse({ transferTarget: 'a b' }).success,
    ).toBe(false)
  })
})

describe('PABX form bodies', () => {
  it('parses a session request', () => {
    const parsed = PabxVoiceSessionSchema.parse({
      workspace: 'ws1',
      secret: SECRET,
      caller: ' 11999998888 ',
      queue: 'suporte',
      did: '',
    })
    expect(parsed).toEqual({
      workspace: 'ws1',
      secret: SECRET,
      caller: '11999998888',
      queue: 'suporte',
      did: '',
    })
  })

  it.each([
    { workspace: '', secret: SECRET, caller: '119' },
    { workspace: 'ws1', secret: 'short', caller: '11999998888' },
    { workspace: 'ws1', secret: SECRET, caller: '12' },
    { workspace: 'ws1', secret: SECRET },
    { workspace: 'ws1', secret: SECRET, caller: '119', queue: 'a'.repeat(41) },
  ])('rejects the session request %o', (input) => {
    expect(PabxVoiceSessionSchema.safeParse(input).success).toBe(false)
  })

  it('parses an outcome request and demands a uuid', () => {
    const session = '0b6f6f4e-7a1d-4a58-9a3e-6b5b2f7a9c11'
    expect(
      PabxVoiceOutcomeSchema.parse({
        workspace: 'ws1',
        secret: SECRET,
        session,
      }),
    ).toMatchObject({ session })
    expect(
      PabxVoiceOutcomeSchema.safeParse({
        workspace: 'ws1',
        secret: SECRET,
        session: 'nope',
      }).success,
    ).toBe(false)
  })
})
