import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { toWhatsAppTemplateDTO } from '../whatsapp-template.mapper'

describe('toWhatsAppTemplateDTO()', () => {
  it('should map all fields correctly', () => {
    const template = createFakeWhatsAppTemplate({
      id: 't1',
      name: 'boas_vindas',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Bem-vindo!' }],
    })

    const dto = toWhatsAppTemplateDTO(template)

    expect(dto.id).toBe('t1')
    expect(dto.name).toBe('boas_vindas')
    expect(dto.status).toBe('APPROVED')
    expect(dto.components).toEqual([{ type: 'BODY', text: 'Bem-vindo!' }])
  })

  it('should default components to an empty array when malformed', () => {
    const template = createFakeWhatsAppTemplate({
      components: 'not-an-array' as unknown as never,
    })

    const dto = toWhatsAppTemplateDTO(template)

    expect(dto.components).toEqual([])
  })

  describe('quality (worse of template and number)', () => {
    type Quality = 'UNKNOWN' | 'GREEN' | 'YELLOW' | 'RED'
    const ranks: Quality[] = ['UNKNOWN', 'GREEN', 'YELLOW', 'RED']
    const cases = ranks.flatMap((templateQuality, t) =>
      ranks.map((numberQuality, n) => ({
        templateQuality,
        numberQuality,
        quality: n > t ? numberQuality : templateQuality,
        source: n > t ? 'NUMBER' : 'TEMPLATE',
      })),
    )

    it.each(cases)(
      'template $templateQuality x number $numberQuality -> $quality from $source',
      ({ templateQuality, numberQuality, quality, source }) => {
        const dto = toWhatsAppTemplateDTO(
          createFakeWhatsAppTemplate({ quality: templateQuality }),
          numberQuality,
        )

        expect(dto.quality).toBe(quality)
        expect(dto.qualitySource).toBe(source)
        expect(dto.templateQuality).toBe(templateQuality)
        expect(dto.numberQuality).toBe(numberQuality)
      },
    )

    it('should have 16 combinations', () => {
      expect(cases).toHaveLength(16)
    })

    it('should default the number quality to UNKNOWN', () => {
      const dto = toWhatsAppTemplateDTO(
        createFakeWhatsAppTemplate({ quality: 'YELLOW' }),
      )

      expect(dto).toMatchObject({
        quality: 'YELLOW',
        qualitySource: 'TEMPLATE',
        templateQuality: 'YELLOW',
        numberQuality: 'UNKNOWN',
      })
    })
  })
})
