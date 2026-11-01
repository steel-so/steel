import { describe, expect, it } from 'vitest'
import {
  CRM_COMPETITOR_IDEAS_JSON_SCHEMA,
  CRM_SOCIAL_POST_FORMATS,
  CreateCrmCompetitorSchema,
  CrmCompetitorIdeasOutputSchema,
  GenerateCrmCompetitorIdeasSchema,
  PreviewCrmCompetitorSchema,
  UpdateCrmCompetitorSchema,
} from '../crm-competitor.schema'

describe('CreateCrmCompetitorSchema', () => {
  it('should reject an empty handle', () => {
    expect(
      CreateCrmCompetitorSchema.safeParse({ platform: 'INSTAGRAM', handle: '' })
        .success,
    ).toBe(false)
  })

  it('should accept a valid competitor', () => {
    const result = CreateCrmCompetitorSchema.safeParse({
      platform: 'INSTAGRAM',
      handle: '@concorrente',
      profileUrl: 'https://instagram.com/concorrente',
    })
    expect(result.success).toBe(true)
  })

  it('should reject an invalid profileUrl', () => {
    expect(
      CreateCrmCompetitorSchema.safeParse({
        platform: 'INSTAGRAM',
        handle: '@concorrente',
        profileUrl: 'not-a-url',
      }).success,
    ).toBe(false)
  })

  it('should require a platform', () => {
    expect(
      CreateCrmCompetitorSchema.safeParse({ handle: '@concorrente' }).success,
    ).toBe(false)
  })

  it('should reject a platform without discovery support', () => {
    expect(
      CreateCrmCompetitorSchema.safeParse({
        platform: 'FACEBOOK',
        handle: '@concorrente',
      }).success,
    ).toBe(false)
  })
})

describe('UpdateCrmCompetitorSchema', () => {
  it('should reject an empty payload', () => {
    expect(UpdateCrmCompetitorSchema.safeParse({}).success).toBe(false)
  })

  it('should accept a partial payload', () => {
    expect(
      UpdateCrmCompetitorSchema.safeParse({ followersCount: 1000 }).success,
    ).toBe(true)
  })
})

describe('PreviewCrmCompetitorSchema', () => {
  it('should accept a syncable platform + handle', () => {
    expect(
      PreviewCrmCompetitorSchema.safeParse({
        platform: 'YOUTUBE',
        handle: '@concorrente',
      }).success,
    ).toBe(true)
  })

  it('should reject a non-syncable platform', () => {
    expect(
      PreviewCrmCompetitorSchema.safeParse({
        platform: 'GOOGLE_ADS',
        handle: '@concorrente',
      }).success,
    ).toBe(false)
  })
})

describe('GenerateCrmCompetitorIdeasSchema', () => {
  it('should default the range to 30d', () => {
    expect(GenerateCrmCompetitorIdeasSchema.parse({})).toEqual({ range: '30d' })
  })

  it('should reject an unknown range', () => {
    expect(
      GenerateCrmCompetitorIdeasSchema.safeParse({ range: '1y' }).success,
    ).toBe(false)
  })
})

describe('CrmCompetitorIdeasOutputSchema', () => {
  const idea = {
    title: 'Bastidores',
    format: 'REELS',
    hook: 'Gancho',
    caption: 'Legenda',
    rationale: 'Motivo',
    hashtags: ['fibra'],
  }

  it('should accept a valid model output', () => {
    expect(
      CrmCompetitorIdeasOutputSchema.safeParse({ ideas: [idea] }).success,
    ).toBe(true)
  })

  it('should reject an empty list and unknown formats', () => {
    expect(
      CrmCompetitorIdeasOutputSchema.safeParse({ ideas: [] }).success,
    ).toBe(false)
    expect(
      CrmCompetitorIdeasOutputSchema.safeParse({
        ideas: [{ ...idea, format: 'STORY' }],
      }).success,
    ).toBe(false)
  })

  it('should keep the JSON Schema formats in sync with the Zod enum', () => {
    const items = (
      CRM_COMPETITOR_IDEAS_JSON_SCHEMA.properties as {
        ideas: { items: { properties: { format: { enum: string[] } } } }
      }
    ).ideas.items.properties.format.enum
    expect(items).toEqual([...CRM_SOCIAL_POST_FORMATS])
  })
})
