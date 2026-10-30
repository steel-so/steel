import { describe, expect, it } from 'vitest'
import {
  createFakeCrmCadence,
  createFakeCrmCadenceEnrollment,
  createFakeCrmCadenceStep,
} from '@/src/__tests__/factories/nov-c1-sales-cadences.factory'
import {
  buildCadenceStats,
  EMPTY_CADENCE_STATS,
  toCrmCadenceDTO,
  toCrmCadenceEnrollmentDTO,
  toCrmCadenceRunDTO,
  toCrmCadenceStepDTO,
} from '../crm-cadence.mapper'

describe('crm-cadence mapper', () => {
  it('should map a step', () => {
    const step = createFakeCrmCadenceStep({
      id: 's1',
      position: 2,
      templateVariables: ['{{nome}}'],
    })
    expect(toCrmCadenceStepDTO(step)).toMatchObject({
      id: 's1',
      position: 2,
      type: 'EMAIL',
      templateVariables: ['{{nome}}'],
    })
  })

  it('should map a cadence with its steps and stats', () => {
    const cadence = createFakeCrmCadence({ name: 'Outbound' })
    const dto = toCrmCadenceDTO(cadence, EMPTY_CADENCE_STATS)
    expect(dto.name).toBe('Outbound')
    expect(dto.steps).toHaveLength(1)
    expect(dto.stats).toBe(EMPTY_CADENCE_STATS)
    expect(dto.createdAt).toBe(cadence.createdAt.toISOString())
  })

  it('should map runs and enrollments to ISO strings', () => {
    const now = new Date('2026-10-29T12:00:00Z')
    const run = toCrmCadenceRunDTO({
      id: 'r1',
      workspaceId: 'w',
      cadenceId: 'c',
      enrollmentId: 'e',
      stepId: 's',
      position: 0,
      type: 'TASK',
      status: 'SENT',
      detail: 'ok',
      providerMessageId: null,
      idempotencyKey: null,
      openedAt: now,
      clickedAt: null,
      openCount: 2,
      clickCount: 0,
      createdAt: now,
    })
    expect(run.createdAt).toBe(now.toISOString())
    expect(run).toMatchObject({
      openedAt: now.toISOString(),
      clickedAt: null,
      openCount: 2,
      clickCount: 0,
    })

    const enrollment = createFakeCrmCadenceEnrollment({
      nextRunAt: now,
      finishedAt: null,
    })
    const dto = toCrmCadenceEnrollmentDTO({
      ...enrollment,
      cadence: { name: 'Outbound', _count: { steps: 3 } },
      lead: { name: 'Ana' },
      runs: [],
    })
    expect(dto).toMatchObject({
      cadenceName: 'Outbound',
      leadName: 'Ana',
      totalSteps: 3,
      nextRunAt: now.toISOString(),
      finishedAt: null,
    })
  })

  it('should fold counts into stats', () => {
    const stats = buildCadenceStats(
      [
        { status: 'ACTIVE', n: 2 },
        { status: 'REPLIED', n: 1 },
        { status: 'COMPLETED', n: 1 },
        { status: 'PAUSED', n: 1 },
        { status: 'STOPPED', stopReason: 'CLICKED', n: 1 },
      ],
      [
        { position: 0, status: 'SENT', n: 5 },
        { position: 0, status: 'FAILED', n: 1 },
        { position: 1, status: 'SENT', n: 2 },
        { position: 1, status: 'SKIPPED', n: 1 },
      ],
      2,
      [
        { position: 0, opened: 3, clicked: 1 },
        { position: 1, opened: 1, clicked: 0 },
      ],
    )
    expect(stats).toMatchObject({
      enrolled: 6,
      stoppedByClick: 1,
      active: 2,
      paused: 1,
      replied: 1,
      completed: 1,
      stopped: 1,
    })
    expect(stats.replyRate).toBeCloseTo(1 / 6)
    expect(stats.sentByStep).toEqual([
      {
        position: 0,
        sent: 5,
        skipped: 0,
        failed: 1,
        opened: 3,
        clicked: 1,
        reached: 6,
      },
      {
        position: 1,
        sent: 2,
        skipped: 1,
        failed: 0,
        opened: 1,
        clicked: 0,
        reached: 3,
      },
    ])
  })

  it('should give a zero reply rate without enrollments', () => {
    expect(buildCadenceStats([], [], 1)).toMatchObject({
      enrolled: 0,
      replyRate: 0,
      sentByStep: [
        {
          position: 0,
          sent: 0,
          skipped: 0,
          failed: 0,
          opened: 0,
          clicked: 0,
          reached: 0,
        },
      ],
    })
  })
})
