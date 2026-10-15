import { describe, expect, it } from 'vitest'
import {
  ApplySiteExperimentWinnerSchema,
  CreateSiteExperimentSchema,
  RecordSiteExperimentEventsSchema,
  SiteExperimentActionSchema,
  SiteExperimentGoalSchema,
  UpdateSiteExperimentSchema,
} from '../site-experiment.schema'

const messages = (result: {
  success: boolean
  error?: { issues: Array<{ message: string }> }
}) => result.error?.issues.map((issue) => issue.message) ?? []

describe('CreateSiteExperimentSchema', () => {
  it('accepts a section test and defaults the goal and count', () => {
    const parsed = CreateSiteExperimentSchema.parse({
      name: ' Hero ',
      kind: 'SECTION',
      pageId: 'home',
      controlNodeId: 's1',
      variantNodeIds: ['s1b'],
    })
    expect(parsed).toMatchObject({
      name: 'Hero',
      goal: { type: 'FORM' },
      variantCount: 1,
    })
  })

  it('requires the section and its variants, all different', () => {
    const result = CreateSiteExperimentSchema.safeParse({
      name: 'x',
      kind: 'SECTION',
      pageId: 'home',
    })
    expect(messages(result)).toEqual([
      'Escolha a seção a testar',
      'Crie pelo menos uma variante da seção',
    ])
    expect(
      messages(
        CreateSiteExperimentSchema.safeParse({
          name: 'x',
          kind: 'SECTION',
          pageId: 'home',
          controlNodeId: 's1',
          variantNodeIds: ['s1'],
        }),
      ),
    ).toEqual(['Cada variante precisa ser uma seção diferente'])
  })

  it('checks the split, the goal page and the schedule', () => {
    const base = { name: 'x', kind: 'PAGE', pageId: 'home', variantCount: 2 }
    expect(
      CreateSiteExperimentSchema.safeParse({ ...base, weights: [40, 30, 30] })
        .success,
    ).toBe(true)
    expect(
      messages(
        CreateSiteExperimentSchema.safeParse({ ...base, weights: [50, 50] }),
      ),
    ).toEqual(['Informe a divisão de cada variante'])
    expect(
      messages(
        CreateSiteExperimentSchema.safeParse({
          ...base,
          weights: [50, 30, 30],
        }),
      ),
    ).toEqual(['A divisão do tráfego precisa somar 100%'])
    expect(
      messages(
        CreateSiteExperimentSchema.safeParse({
          ...base,
          goal: { type: 'PAGE', pageId: 'home' },
        }),
      ),
    ).toEqual(['A página da meta precisa ser outra, não a testada'])
    expect(
      messages(
        CreateSiteExperimentSchema.safeParse({
          ...base,
          startsAt: '2026-10-20T00:00:00Z',
          endsAt: '2026-10-19T00:00:00Z',
        }),
      ),
    ).toEqual(['O fim precisa ser depois do início'])
    expect(
      CreateSiteExperimentSchema.safeParse({
        ...base,
        startsAt: '2026-10-20T00:00:00-03:00',
        endsAt: null,
      }).success,
    ).toBe(true)
  })
})

describe('SiteExperimentGoalSchema', () => {
  it('accepts the three goal kinds', () => {
    expect(
      SiteExperimentGoalSchema.parse({ type: 'FORM', formToken: 't' }),
    ).toEqual({
      type: 'FORM',
      formToken: 't',
    })
    expect(
      SiteExperimentGoalSchema.safeParse({ type: 'CLICK', nodeId: 'b1' })
        .success,
    ).toBe(true)
    expect(SiteExperimentGoalSchema.safeParse({ type: 'CLICK' }).success).toBe(
      false,
    )
    expect(
      SiteExperimentGoalSchema.safeParse({ type: 'PAGE', pageId: 'p' }).success,
    ).toBe(true)
  })
})

describe('UpdateSiteExperimentSchema', () => {
  const variants = [
    { key: 'A', name: 'Original', weight: 60, nodeId: 's1' },
    { key: 'B', name: 'Variante B', weight: 40, nodeId: 's1b' },
  ]

  it('accepts variants that start with A and sum to 100', () => {
    expect(
      UpdateSiteExperimentSchema.safeParse({ variants, restart: true }).success,
    ).toBe(true)
    expect(
      messages(
        UpdateSiteExperimentSchema.safeParse({
          variants: [variants[1], variants[0]],
        }),
      ),
    ).toEqual(['As variantes são A (original), B e C, sem repetir'])
    expect(
      messages(
        UpdateSiteExperimentSchema.safeParse({
          variants: [variants[0], { ...variants[1], weight: 10 }],
        }),
      ),
    ).toEqual(['A divisão do tráfego precisa somar 100%'])
  })

  it('needs something besides restart and a valid schedule', () => {
    expect(
      messages(UpdateSiteExperimentSchema.safeParse({ restart: true })),
    ).toEqual(['Nada para atualizar'])
    expect(UpdateSiteExperimentSchema.safeParse({ name: 'Novo' }).success).toBe(
      true,
    )
    expect(
      UpdateSiteExperimentSchema.safeParse({ startsAt: null }).success,
    ).toBe(true)
    expect(
      messages(
        UpdateSiteExperimentSchema.safeParse({
          startsAt: '2026-10-20T00:00:00Z',
          endsAt: '2026-10-10T00:00:00Z',
        }),
      ),
    ).toEqual(['O fim precisa ser depois do início'])
  })
})

describe('action, winner and beacon schemas', () => {
  it('validates each payload', () => {
    expect(
      SiteExperimentActionSchema.safeParse({ action: 'pause' }).success,
    ).toBe(true)
    expect(SiteExperimentActionSchema.safeParse({ action: 'go' }).success).toBe(
      false,
    )
    expect(
      ApplySiteExperimentWinnerSchema.safeParse({ variantKey: 'C' }).success,
    ).toBe(true)
    expect(
      ApplySiteExperimentWinnerSchema.safeParse({ variantKey: 'D' }).success,
    ).toBe(false)
    expect(
      RecordSiteExperimentEventsSchema.safeParse({
        events: [{ experimentId: 'e', kind: 'EXPOSURE' }],
      }).success,
    ).toBe(true)
    expect(
      RecordSiteExperimentEventsSchema.safeParse({ events: [] }).success,
    ).toBe(false)
  })
})
