import { describe, expect, it } from 'vitest'
import { toWhatsAppNumberValidationDTO } from '../whatsapp-number-validation.mapper'

const base = {
  id: 'run1',
  workspaceId: 'ws1',
  connectionId: 'conn1',
  requestedById: 'u1',
  scope: 'CONTACTS' as const,
  scopeId: null,
  status: 'QUEUED' as const,
  contactIds: ['c1', 'c2'],
  force: false,
  total: 2,
  processed: 0,
  withWhatsapp: 0,
  withoutWhatsapp: 0,
  failed: 0,
  cached: 0,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  createdAt: new Date('2026-10-22T12:00:00.000Z'),
}

describe('toWhatsAppNumberValidationDTO()', () => {
  it('maps the counters and never exposes contact ids or phones', () => {
    const dto = toWhatsAppNumberValidationDTO(base)

    expect(dto).toEqual({
      id: 'run1',
      workspaceId: 'ws1',
      connectionId: 'conn1',
      scope: 'CONTACTS',
      scopeId: null,
      status: 'QUEUED',
      total: 2,
      processed: 0,
      withWhatsapp: 0,
      withoutWhatsapp: 0,
      failed: 0,
      cached: 0,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: '2026-10-22T12:00:00.000Z',
    })
    expect(dto).not.toHaveProperty('contactIds')
  })

  it('serializes the start and finish dates', () => {
    const dto = toWhatsAppNumberValidationDTO({
      ...base,
      status: 'DONE',
      startedAt: new Date('2026-10-22T12:01:00.000Z'),
      finishedAt: new Date('2026-10-22T12:02:00.000Z'),
    })

    expect(dto.startedAt).toBe('2026-10-22T12:01:00.000Z')
    expect(dto.finishedAt).toBe('2026-10-22T12:02:00.000Z')
  })
})
