import { describe, expect, it } from 'vitest'
import { createFakeTourProgress } from '@/src/__tests__/factories/tour-progress.factory'
import { toTourProgressDTO } from '../tour-progress.mapper'

describe('toTourProgressDTO', () => {
  it('should expose only the key, version, status and when it was seen', () => {
    const dto = toTourProgressDTO(
      createFakeTourProgress({
        tourKey: 'crm.sites.editor',
        version: 3,
        status: 'SKIPPED',
        seenAt: new Date('2026-11-13T15:30:00.000Z'),
      }),
    )

    expect(dto).toEqual({
      key: 'crm.sites.editor',
      version: 3,
      status: 'SKIPPED',
      seenAt: '2026-11-13T15:30:00.000Z',
    })
  })
})
