import { describe, expect, it } from 'vitest'
import { SetCrmNewsletterAbTestSchema } from '../crm-newsletter-ab.schema'
import {
  CrmNewsletterAiDraftSchema,
  CrmNewsletterAiSubjectsOutputSchema,
  CrmNewsletterAiSubjectsSchema,
} from '../crm-newsletter-ai.schema'
import {
  PreviewCrmNewsletterDigestSchema,
  UpsertCrmNewsletterDigestSchema,
} from '../crm-newsletter-digest.schema'

const messages = (result: {
  success: boolean
  error?: { issues: { message: string }[] }
}) =>
  result.success
    ? []
    : (result.error?.issues ?? []).map((issue) => issue.message)

describe('UpsertCrmNewsletterDigestSchema', () => {
  it('fills the defaults around a source', () => {
    const parsed = UpsertCrmNewsletterDigestSchema.parse({ siteId: 'site1' })
    expect(parsed).toEqual({
      enabled: true,
      siteId: 'site1',
      rssUrl: null,
      cadence: 'WEEKLY',
      weekday: 1,
      monthDay: null,
      hour: 9,
      mode: 'DRAFT',
      maxItems: 5,
      subject: 'Resumo de {data}',
      intro: null,
    })
  })

  it('needs a source, an https feed and the day of the cadence', () => {
    expect(messages(UpsertCrmNewsletterDigestSchema.safeParse({}))).toContain(
      'Escolha um blog do Sites, um feed RSS ou os dois',
    )
    expect(
      messages(
        UpsertCrmNewsletterDigestSchema.safeParse({
          rssUrl: 'http://x.com/feed',
        }),
      ),
    ).toContain('Informe o endereço https:// do feed RSS ou Atom')
    expect(
      UpsertCrmNewsletterDigestSchema.safeParse({ rssUrl: 'nada' }).success,
    ).toBe(false)
    expect(
      messages(
        UpsertCrmNewsletterDigestSchema.safeParse({
          siteId: 's',
          cadence: 'WEEKLY',
          weekday: null,
        }),
      ),
    ).toContain('Escolha o dia da semana')
    expect(
      messages(
        UpsertCrmNewsletterDigestSchema.safeParse({
          siteId: 's',
          cadence: 'MONTHLY',
        }),
      ),
    ).toContain('Escolha o dia do mês (1 a 28)')
    expect(
      UpsertCrmNewsletterDigestSchema.safeParse({
        rssUrl: 'https://blog.acme.com.br/feed',
        cadence: 'MONTHLY',
        monthDay: 28,
        hour: 23,
        maxItems: 12,
        mode: 'AUTO_SEND',
      }).success,
    ).toBe(true)
    expect(
      UpsertCrmNewsletterDigestSchema.safeParse({ siteId: 's', maxItems: 13 })
        .success,
    ).toBe(false)
  })
})

describe('PreviewCrmNewsletterDigestSchema', () => {
  it('needs a source', () => {
    expect(PreviewCrmNewsletterDigestSchema.safeParse({}).success).toBe(false)
    expect(
      PreviewCrmNewsletterDigestSchema.parse({ siteId: 'site1' }).maxItems,
    ).toBe(5)
  })
})

describe('AI schemas', () => {
  it('asks for a real brief and caps the sources', () => {
    expect(
      messages(CrmNewsletterAiDraftSchema.safeParse({ brief: 'curto' })),
    ).toContain('Descreva em uma ou duas frases o que a edição deve dizer')
    const parsed = CrmNewsletterAiDraftSchema.parse({
      brief: 'Novidades de novembro e o webinar',
    })
    expect(parsed).toMatchObject({
      tone: 'friendly',
      postIds: [],
      kbArticleIds: [],
      productIds: [],
    })
    expect(
      CrmNewsletterAiDraftSchema.safeParse({
        brief: 'Novidades de novembro e o webinar',
        postIds: ['1', '2', '3', '4', '5', '6', '7'],
      }).success,
    ).toBe(false)
    expect(CrmNewsletterAiSubjectsSchema.parse({})).toEqual({})
    expect(
      CrmNewsletterAiSubjectsOutputSchema.safeParse({ suggestions: [] })
        .success,
    ).toBe(false)
  })
})

describe('SetCrmNewsletterAbTestSchema', () => {
  it('defaults and bounds', () => {
    expect(SetCrmNewsletterAbTestSchema.parse({ subjectB: ' B ' })).toEqual({
      subjectB: 'B',
      testPercent: 20,
      metric: 'OPENS',
      waitHours: 4,
    })
    expect(
      messages(SetCrmNewsletterAbTestSchema.safeParse({ subjectB: ' ' })),
    ).toContain('Informe o assunto da variante B')
    expect(
      SetCrmNewsletterAbTestSchema.safeParse({ subjectB: 'B', testPercent: 60 })
        .success,
    ).toBe(false)
    expect(
      SetCrmNewsletterAbTestSchema.safeParse({ subjectB: 'B', waitHours: 0 })
        .success,
    ).toBe(false)
  })
})
