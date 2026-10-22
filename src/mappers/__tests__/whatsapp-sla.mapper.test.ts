import { describe, expect, it } from 'vitest'
import {
  createFakeWhatsAppSlaCycle,
  createFakeWhatsAppSlaPolicy,
} from '@/src/__tests__/factories/whatsapp-sla.factory'
import {
  toWhatsAppSlaOpenCycleDTO,
  toWhatsAppSlaPolicyDTO,
} from '../whatsapp-sla.mapper'

describe('toWhatsAppSlaPolicyDTO()', () => {
  it('should map the default policy', () => {
    const policy = createFakeWhatsAppSlaPolicy({
      id: 'p1',
      supervisorIds: ['u1'],
    })
    expect(toWhatsAppSlaPolicyDTO(policy)).toMatchObject({
      id: 'p1',
      teamId: null,
      teamName: null,
      enabled: true,
      firstResponseMinutes: 15,
      resolutionMinutes: 240,
      supervisorIds: ['u1'],
      createdAt: policy.createdAt.toISOString(),
    })
  })

  it('should carry the team name of an override', () => {
    const policy = createFakeWhatsAppSlaPolicy({
      teamId: 't1',
      team: { id: 't1', name: 'Suporte' },
    })
    expect(toWhatsAppSlaPolicyDTO(policy)).toMatchObject({
      teamId: 't1',
      teamName: 'Suporte',
    })
  })
})

describe('toWhatsAppSlaOpenCycleDTO()', () => {
  const startedAt = new Date('2026-10-22T12:00:00Z')
  const cycle = createFakeWhatsAppSlaCycle({ startedAt })

  it('should be OK before the warning point', () => {
    const dto = toWhatsAppSlaOpenCycleDTO(
      cycle,
      new Date('2026-10-22T12:05:00Z'),
    )
    expect(dto.state).toBe('OK')
    expect(dto.firstResponse).toMatchObject({ state: 'OK', doneAt: null })
    expect(dto.resolution?.state).toBe('OK')
    expect(dto.startedAt).toBe(startedAt.toISOString())
  })

  it('should be AT_RISK after the warning point and BREACHED after the deadline', () => {
    expect(
      toWhatsAppSlaOpenCycleDTO(cycle, new Date('2026-10-22T12:13:00Z')).state,
    ).toBe('AT_RISK')
    expect(
      toWhatsAppSlaOpenCycleDTO(cycle, new Date('2026-10-22T12:16:00Z')).state,
    ).toBe('BREACHED')
  })

  it('should stop counting the first response once answered', () => {
    const answered = createFakeWhatsAppSlaCycle({
      startedAt,
      firstResponseAt: new Date('2026-10-22T12:03:00Z'),
    })
    const dto = toWhatsAppSlaOpenCycleDTO(
      answered,
      new Date('2026-10-22T12:20:00Z'),
    )
    expect(dto.firstResponse).toMatchObject({
      state: 'OK',
      doneAt: '2026-10-22T12:03:00.000Z',
    })
    expect(dto.state).toBe('OK')
  })

  it('should take the worst of the targets and allow no resolution target', () => {
    const noResolution = createFakeWhatsAppSlaCycle({
      startedAt,
      resolutionMinutes: null,
      resolutionDueAt: null,
      resolutionWarnAt: null,
    })
    expect(
      toWhatsAppSlaOpenCycleDTO(noResolution, new Date('2026-10-22T12:01:00Z'))
        .resolution,
    ).toBeNull()

    const late = createFakeWhatsAppSlaCycle({
      startedAt,
      firstResponseAt: new Date('2026-10-22T12:03:00Z'),
    })
    expect(
      toWhatsAppSlaOpenCycleDTO(late, new Date('2026-10-22T16:30:00Z')).state,
    ).toBe('BREACHED')
  })
})
