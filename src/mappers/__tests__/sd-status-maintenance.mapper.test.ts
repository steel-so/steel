import { describe, expect, it } from 'vitest'
import {
  createFakeSdStatusComponent,
  createFakeSdStatusMaintenance,
} from '@/src/__tests__/factories/nov-sd-followups.factory'
import {
  toSdPublicComponentDTO,
  toSdPublicMaintenanceDTO,
  toSdStatusComponentDTO,
  toSdStatusMaintenanceDTO,
} from '../sd-status-maintenance.mapper'

const before = new Date('2026-11-01T00:00:00.000Z')
const during = new Date('2026-11-11T00:00:00.000Z')

describe('component mappers', () => {
  it('maps the agent view and the public view', () => {
    const row = createFakeSdStatusComponent({
      state: 'DEGRADED',
      serviceId: 's1',
    })
    expect(toSdStatusComponentDTO(row)).toEqual({
      id: 'cmp1',
      pageId: 'p1',
      name: 'Telefonia',
      serviceId: 's1',
      state: 'DEGRADED',
      position: 0,
      stateChangedAt: '2026-10-01T12:00:00.000Z',
    })
    expect(toSdPublicComponentDTO(row)).toEqual({
      name: 'Telefonia',
      state: 'DEGRADED',
    })
  })
})

describe('toSdStatusMaintenanceDTO', () => {
  it('maps the window, its pages, items and notice state', () => {
    const row = createFakeSdStatusMaintenance({
      configItemIds: ['ci1', 'gone'],
      suppressMonitoring: true,
      announcedAt: new Date('2026-10-02T10:00:00.000Z'),
      notifyTotal: 3,
      notifySent: 2,
      notifyFailed: 1,
    })
    const dto = toSdStatusMaintenanceDTO(
      row,
      new Map([['ci1', 'SRV-01']]),
      before,
    )
    expect(dto).toMatchObject({
      id: 'mw1',
      phase: 'SCHEDULED',
      suppressMonitoring: true,
      startsAt: '2026-11-10T22:00:00.000Z',
      configItems: [
        { id: 'ci1', name: 'SRV-01' },
        { id: 'gone', name: 'Item removido' },
      ],
      pages: [{ id: 'p1', name: 'Acme', slug: 'acme-abc123' }],
      notify: { done: true, total: 3, sent: 2, failed: 1 },
      canceledAt: null,
    })
    expect(dto.announcedAt).toBe('2026-10-02T10:00:00.000Z')
  })

  it('reports the phase for the given time and the cancellation', () => {
    const row = createFakeSdStatusMaintenance()
    expect(toSdStatusMaintenanceDTO(row, new Map(), during).phase).toBe(
      'IN_PROGRESS',
    )
    const canceled = toSdStatusMaintenanceDTO(
      createFakeSdStatusMaintenance({
        canceledAt: new Date('2026-11-02T00:00:00.000Z'),
      }),
      new Map(),
      before,
    )
    expect(canceled.phase).toBe('CANCELED')
    expect(canceled.canceledAt).toBe('2026-11-02T00:00:00.000Z')
    expect(canceled.notify.done).toBe(false)
  })
})

describe('toSdPublicMaintenanceDTO', () => {
  it('only exposes customer-safe fields and whether it is running', () => {
    const row = createFakeSdStatusMaintenance({ suppressMonitoring: true })
    const dto = toSdPublicMaintenanceDTO(row, before)
    expect(dto).toEqual({
      id: 'mw1',
      title: 'Troca do switch',
      description: 'Queda curta.',
      startsAt: '2026-11-10T22:00:00.000Z',
      endsAt: '2026-11-11T02:00:00.000Z',
      inProgress: false,
    })
    expect(toSdPublicMaintenanceDTO(row, during).inProgress).toBe(true)
  })
})
