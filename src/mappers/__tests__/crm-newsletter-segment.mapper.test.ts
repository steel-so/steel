import { describe, expect, it } from 'vitest'
import {
  createFakeNewsletterSegment,
  SAMPLE_SEGMENT,
} from '@/src/__tests__/factories/newsletter2-segments.factory'
import {
  toCrmNewsletterIssueSegmentDTO,
  toCrmNewsletterSegmentDTO,
} from '../crm-newsletter-segment.mapper'

describe('crm-newsletter-segment mapper', () => {
  it('maps a saved segment with its parsed definition', () => {
    expect(toCrmNewsletterSegmentDTO(createFakeNewsletterSegment())).toEqual({
      id: 'seg1',
      newsletterId: 'nl1',
      name: 'Engajados',
      definition: SAMPLE_SEGMENT,
      valid: true,
      createdAt: '2026-10-28T13:00:00.000Z',
      updatedAt: '2026-10-28T13:00:00.000Z',
    })
  })

  it('shows an unreadable definition as empty and invalid', () => {
    const dto = toCrmNewsletterSegmentDTO(
      createFakeNewsletterSegment({
        definition: { conditions: [{ type: 'gone' }] },
      }),
    )
    expect(dto.valid).toBe(false)
    expect(dto.definition).toEqual({ conditions: [], groups: [] })
    expect(
      toCrmNewsletterSegmentDTO(
        createFakeNewsletterSegment({ definition: null }),
      ).valid,
    ).toBe(true)
  })

  it('maps the issue audience', () => {
    expect(
      toCrmNewsletterIssueSegmentDTO(
        { ...SAMPLE_SEGMENT, savedSegmentId: 'seg1' },
        'Engajados',
      ),
    ).toEqual({
      segment: SAMPLE_SEGMENT,
      savedSegmentId: 'seg1',
      savedSegmentName: 'Engajados',
      everyone: false,
    })
    expect(
      toCrmNewsletterIssueSegmentDTO({ conditions: [], groups: [] }, null),
    ).toMatchObject({ everyone: true, savedSegmentId: null })
  })
})
