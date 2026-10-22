import type { VoiceAgentRoute, VoiceAgentSettings } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE_NOTICE } from '@/src/lib/voice-agent/prompt'
import {
  toVoiceAgentRouteDTO,
  toVoiceAgentSettingsDTO,
  VOICE_AGENT_DEFAULTS,
} from '../voice-agent.mapper'

const NOW = new Date('2026-10-22T12:00:00.000Z')

function row(overrides: Partial<VoiceAgentSettings> = {}): VoiceAgentSettings {
  return {
    workspaceId: 'ws1',
    enabled: true,
    noticeText: 'Aviso próprio',
    instructions: 'Seja breve',
    voice: 'ash',
    maxCallSeconds: 120,
    monthlyMinutesCap: 60,
    silenceTimeoutSeconds: 15,
    runAsUserId: 'user1',
    canOpenTickets: false,
    canLookupTickets: true,
    fallbackTarget: '200',
    pabxSecretHash: 'a'.repeat(64),
    pabxSecretHint: 'wxyz',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('toVoiceAgentSettingsDTO()', () => {
  it('maps a saved row and hides the secret hash', () => {
    const dto = toVoiceAgentSettingsDTO('ws1', row(), true)
    expect(dto).toEqual({
      workspaceId: 'ws1',
      enabled: true,
      noticeText: 'Aviso próprio',
      effectiveNotice: 'Aviso próprio',
      instructions: 'Seja breve',
      voice: 'ash',
      maxCallSeconds: 120,
      monthlyMinutesCap: 60,
      silenceTimeoutSeconds: 15,
      runAsUserId: 'user1',
      canOpenTickets: false,
      canLookupTickets: true,
      fallbackTarget: '200',
      pabxSecretConfigured: true,
      pabxSecretHint: 'wxyz',
      serverReady: true,
    })
    expect(dto).not.toHaveProperty('pabxSecretHash')
  })

  it('is off by default for a workspace that never saved', () => {
    const dto = toVoiceAgentSettingsDTO('ws9', null, false)
    expect(dto).toMatchObject({
      workspaceId: 'ws9',
      enabled: false,
      voice: VOICE_AGENT_DEFAULTS.voice,
      maxCallSeconds: 300,
      monthlyMinutesCap: 300,
      pabxSecretConfigured: false,
      pabxSecretHint: null,
      serverReady: false,
    })
  })

  it('speaks the platform notice when the workspace has none or only blanks', () => {
    expect(
      toVoiceAgentSettingsDTO('ws1', row({ noticeText: null }), true)
        .effectiveNotice,
    ).toBe(DEFAULT_VOICE_NOTICE)
    expect(
      toVoiceAgentSettingsDTO('ws1', row({ noticeText: '   ' }), true)
        .effectiveNotice,
    ).toBe(DEFAULT_VOICE_NOTICE)
  })
})

describe('toVoiceAgentRouteDTO()', () => {
  it('keeps only what the screen needs', () => {
    const route: VoiceAgentRoute = {
      id: 'r1',
      workspaceId: 'ws1',
      kind: 'DID',
      value: '1140041234',
      label: 'Comercial',
      enabled: true,
      transferTarget: '300',
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(toVoiceAgentRouteDTO(route)).toEqual({
      id: 'r1',
      kind: 'DID',
      value: '1140041234',
      label: 'Comercial',
      enabled: true,
      transferTarget: '300',
    })
  })
})
