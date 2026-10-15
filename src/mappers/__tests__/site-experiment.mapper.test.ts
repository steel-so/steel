import { describe, expect, it } from 'vitest'
import { createFakeSiteExperiment } from '@/src/__tests__/factories/site-experiment.factory'
import {
  experimentFingerprintsOf,
  experimentGoalOf,
  experimentVariantsOf,
  toRuntimeExperiment,
  toSiteExperimentDTO,
} from '../site-experiment.mapper'

const NOW = new Date('2026-10-15T12:00:00Z')

describe('site experiment mapper', () => {
  it('reads stored variants, goal and fingerprints defensively', () => {
    const experiment = createFakeSiteExperiment()
    expect(experimentVariantsOf(experiment)).toHaveLength(2)
    expect(experimentVariantsOf({ variants: 'oops' })).toEqual([])
    expect(experimentGoalOf({ goal: { type: 'CLICK', nodeId: 'b1' } })).toEqual(
      { type: 'CLICK', nodeId: 'b1' },
    )
    expect(experimentGoalOf({ goal: null })).toEqual({ type: 'FORM' })
    expect(
      experimentFingerprintsOf({ fingerprints: { A: 'x', B: 2 } }),
    ).toEqual({ A: 'x' })
    expect(experimentFingerprintsOf({ fingerprints: [] })).toEqual({})
    expect(experimentFingerprintsOf({ fingerprints: null })).toEqual({})
  })

  it('maps the runtime shape with ISO dates', () => {
    const runtime = toRuntimeExperiment(
      createFakeSiteExperiment({
        id: 'e1',
        status: 'RUNNING',
        startsAt: new Date('2026-10-01T00:00:00Z'),
      }),
    )
    expect(runtime).toMatchObject({
      id: 'e1',
      status: 'RUNNING',
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: null,
      goal: { type: 'FORM' },
    })
  })

  it('maps the DTO with results of the current run', () => {
    const experiment = createFakeSiteExperiment({
      id: 'e1',
      status: 'RUNNING',
      run: 2,
      startedAt: NOW,
      endedAt: NOW,
      endsAt: new Date('2026-10-14T00:00:00Z'),
      winnerKey: 'B',
    })
    const dto = toSiteExperimentDTO(experiment, {
      counts: [
        { variantKey: 'A', kind: 'EXPOSURE', count: 200 },
        { variantKey: 'A', kind: 'CONVERSION', count: 10 },
        { variantKey: 'B', kind: 'EXPOSURE', count: 200 },
        { variantKey: 'B', kind: 'CONVERSION', count: 30 },
      ],
      unpublishedVariants: ['B'],
      now: NOW,
    })
    expect(dto).toMatchObject({
      id: 'e1',
      state: 'ENDED',
      run: 2,
      startedAt: NOW.toISOString(),
      endedAt: NOW.toISOString(),
      endsAt: '2026-10-14T00:00:00.000Z',
      winnerKey: 'B',
      unpublishedVariants: ['B'],
    })
    expect(dto.results).toMatchObject({
      run: 2,
      enoughData: true,
      winner: 'B',
      totals: { visitors: 400, conversions: 40 },
      minVisitorsPerVariant: 100,
      minConversions: 10,
    })
    expect(dto.results.variants[0]).toMatchObject({
      key: 'A',
      name: 'Original',
      visitors: 200,
      conversions: 10,
      rate: 0.05,
    })
    expect(dto.results.variants[1].uplift).toBeCloseTo(2, 6)
  })

  it('maps an empty draft', () => {
    const dto = toSiteExperimentDTO(createFakeSiteExperiment(), {
      counts: [],
      unpublishedVariants: [],
      now: NOW,
    })
    expect(dto.state).toBe('DRAFT')
    expect(dto.winnerKey).toBeNull()
    expect(dto.startedAt).toBeNull()
    expect(dto.results.enoughData).toBe(false)
    expect(dto.results.variants.map((variant) => variant.visitors)).toEqual([
      0, 0,
    ])
  })
})
