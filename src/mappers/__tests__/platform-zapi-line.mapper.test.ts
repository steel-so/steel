import type { PlatformZapiLine } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  maskInstanceId,
  NOT_CONFIGURED_LINE,
  toPlatformZapiLineDTO,
} from '../platform-zapi-line.mapper'

const now = new Date('2026-11-18T12:00:00.000Z')

function row(overrides: Partial<PlatformZapiLine> = {}): PlatformZapiLine {
  return {
    id: 'default',
    instanceId: '3C4A5B6C7D8E9F00',
    encryptedToken: 'enc:token',
    encryptedClientToken: null,
    label: null,
    phone: '5511999990000',
    status: 'CONNECTED',
    statusError: null,
    connectedAt: now,
    statusCheckedAt: now,
    updatedById: 'admin1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('maskInstanceId()', () => {
  it('keeps the edges of a long id and hides the middle', () => {
    expect(maskInstanceId('3C4A5B6C7D8E9F00')).toBe('3C4A****9F00')
  })

  it('hides almost everything of a short id', () => {
    expect(maskInstanceId('ABCDEFGH')).toBe('AB****')
  })
})

describe('toPlatformZapiLineDTO()', () => {
  it('is the not configured state without a row', () => {
    expect(toPlatformZapiLineDTO(null)).toEqual(NOT_CONFIGURED_LINE)
    expect(NOT_CONFIGURED_LINE.configured).toBe(false)
  })

  it('maps the state and never carries a token or the full instance id', () => {
    const dto = toPlatformZapiLineDTO(
      row({ encryptedClientToken: 'enc:client' }),
    )
    expect(dto).toEqual({
      configured: true,
      instanceIdMasked: '3C4A****9F00',
      hasClientToken: true,
      label: null,
      phone: '5511999990000',
      status: 'CONNECTED',
      statusError: null,
      connectedAt: now.toISOString(),
      statusCheckedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    const json = JSON.stringify(dto)
    expect(json).not.toContain('enc:')
    expect(json).not.toContain('3C4A5B6C7D8E9F00')
  })

  it('keeps empty dates as null', () => {
    const dto = toPlatformZapiLineDTO(
      row({ connectedAt: null, statusCheckedAt: null, status: 'ERROR' }),
    )
    expect(dto.connectedAt).toBeNull()
    expect(dto.statusCheckedAt).toBeNull()
    expect(dto.hasClientToken).toBe(false)
  })
})
