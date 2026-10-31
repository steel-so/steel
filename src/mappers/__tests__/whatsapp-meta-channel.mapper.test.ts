import { describe, expect, it } from 'vitest'
import {
  createFakeCoexistenceConnection,
  createFakeCoexistenceSync,
  createFakeMetaChannelSettings,
} from '@/src/__tests__/factories/nov-meta-channels.factory'
import {
  toCoexistenceSyncDTO,
  toMetaChannelConnectionDTO,
  toMetaChannelSettingsDTO,
} from '../whatsapp-meta-channel.mapper'

describe('toMetaChannelSettingsDTO', () => {
  it('defaults everything to off when nothing was saved', () => {
    expect(toMetaChannelSettingsDTO('ws1', null)).toEqual({
      workspaceId: 'ws1',
      coexistenceEnabled: false,
    })
  })

  it('exposes the saved switches', () => {
    const row = createFakeMetaChannelSettings({ coexistenceEnabled: true })
    expect(toMetaChannelSettingsDTO('ws1', row)).toMatchObject({
      coexistenceEnabled: true,
    })
  })
})

describe('toMetaChannelConnectionDTO', () => {
  it('maps a coexistence connection without leaking tokens', () => {
    const dto = toMetaChannelConnectionDTO(
      createFakeCoexistenceConnection({ id: 'c1' }),
    )
    expect(dto).toMatchObject({ id: 'c1', coexistence: true })
    expect(JSON.stringify(dto)).not.toContain('enc:')
  })
})

describe('toCoexistenceSyncDTO', () => {
  it('maps the progress with ISO dates', () => {
    const started = new Date('2026-10-30T10:00:00Z')
    const finished = new Date('2026-10-30T10:05:00Z')
    expect(
      toCoexistenceSyncDTO(
        createFakeCoexistenceSync({
          connectionId: 'c1',
          status: 'COMPLETED',
          progress: 100,
          messagesImported: 12,
          startedAt: started,
          finishedAt: finished,
        }),
      ),
    ).toMatchObject({
      connectionId: 'c1',
      status: 'COMPLETED',
      progress: 100,
      messagesImported: 12,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
    })
  })

  it('keeps an unfinished import open', () => {
    expect(
      toCoexistenceSyncDTO(createFakeCoexistenceSync()).finishedAt,
    ).toBeNull()
  })
})
