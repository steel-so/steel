import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppFlowSchema,
  CreateWhatsAppFlowTemplateSchema,
  FlowDefinitionSchema,
  FlowFieldSchema,
  ListWhatsAppFlowResponsesSchema,
  PublishWhatsAppFlowSchema,
  SendWhatsAppFlowSchema,
  UpdateWhatsAppFlowSchema,
} from '../whatsapp-flow.schema'

const field = (overrides: Record<string, unknown> = {}) => ({
  key: 'nome',
  label: 'Nome',
  type: 'text',
  ...overrides,
})

const screen = (fields: unknown[] = [field()]) => ({
  title: 'Cadastro',
  fields,
})

describe('FlowFieldSchema', () => {
  it('defaults required to false', () => {
    const parsed = FlowFieldSchema.parse(field())
    expect(parsed.required).toBe(false)
  })

  it('rejects keys that are not snake_case', () => {
    expect(
      FlowFieldSchema.safeParse(field({ key: 'Nome Completo' })).success,
    ).toBe(false)
  })

  it('enforces the per-type label limit of Meta', () => {
    const long = 'x'.repeat(21)
    expect(FlowFieldSchema.safeParse(field({ label: long })).success).toBe(
      false,
    )
    expect(
      FlowFieldSchema.safeParse(field({ type: 'checkbox', label: long }))
        .success,
    ).toBe(true)
  })

  it('requires options on choice fields and unique option ids', () => {
    expect(FlowFieldSchema.safeParse(field({ type: 'select' })).success).toBe(
      false,
    )
    const duplicated = FlowFieldSchema.safeParse(
      field({
        type: 'radio',
        options: [
          { id: 'a', title: 'A' },
          { id: 'a', title: 'B' },
        ],
      }),
    )
    expect(duplicated.success).toBe(false)
    expect(
      FlowFieldSchema.safeParse(
        field({
          type: 'multiselect',
          options: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
          ],
        }),
      ).success,
    ).toBe(true)
  })

  it('validates the mapping against the allowed attributes', () => {
    expect(
      FlowFieldSchema.safeParse(
        field({ mapping: { target: 'contact', attribute: 'name' } }),
      ).success,
    ).toBe(true)
    expect(
      FlowFieldSchema.safeParse(
        field({ mapping: { target: 'contact', attribute: 'email' } }),
      ).success,
    ).toBe(false)
    expect(
      FlowFieldSchema.safeParse(
        field({ mapping: { target: 'lead', attribute: 'email' } }),
      ).success,
    ).toBe(true)
  })
})

describe('FlowDefinitionSchema', () => {
  it('needs at least one screen with one field', () => {
    expect(FlowDefinitionSchema.safeParse({ screens: [] }).success).toBe(false)
    expect(
      FlowDefinitionSchema.safeParse({ screens: [screen([])] }).success,
    ).toBe(false)
    expect(
      FlowDefinitionSchema.safeParse({ screens: [screen()] }).success,
    ).toBe(true)
  })

  it('rejects a key repeated across screens', () => {
    const result = FlowDefinitionSchema.safeParse({
      screens: [screen(), screen()],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('Chave duplicada')
  })

  it('caps the total number of fields', () => {
    const many = (offset: number) =>
      Array.from({ length: 8 }, (_, i) =>
        field({ key: `campo_${offset + i}`, label: `Campo ${offset + i}` }),
      )
    const result = FlowDefinitionSchema.safeParse({
      screens: [
        screen(many(0)),
        screen(many(8)),
        screen(many(16)),
        screen(many(24)),
      ],
    })
    expect(result.success).toBe(false)
    expect(
      result.error?.issues.some((i) => i.message.includes('No máximo 30')),
    ).toBe(true)
  })

  it('caps the number of screens', () => {
    const screens = Array.from({ length: 9 }, (_, i) =>
      screen([field({ key: `campo_${i}` })]),
    )
    expect(FlowDefinitionSchema.safeParse({ screens }).success).toBe(false)
  })
})

describe('request schemas', () => {
  it('fills the create defaults', () => {
    const parsed = CreateWhatsAppFlowSchema.parse({
      name: ' Cadastro ',
      connectionId: 'c1',
    })
    expect(parsed).toMatchObject({
      name: 'Cadastro',
      category: 'OTHER',
      preset: 'BLANK',
    })
  })

  it('accepts partial updates and validates the definition', () => {
    expect(UpdateWhatsAppFlowSchema.safeParse({ name: 'Novo' }).success).toBe(
      true,
    )
    expect(UpdateWhatsAppFlowSchema.safeParse({}).success).toBe(true)
    expect(
      UpdateWhatsAppFlowSchema.safeParse({ definition: { screens: [] } })
        .success,
    ).toBe(false)
    expect(
      UpdateWhatsAppFlowSchema.safeParse({ ctaLabel: 'x'.repeat(31) }).success,
    ).toBe(false)
  })

  it('publishes by default', () => {
    expect(PublishWhatsAppFlowSchema.parse({}).publish).toBe(true)
    expect(PublishWhatsAppFlowSchema.parse({ publish: false }).publish).toBe(
      false,
    )
  })

  it('needs the language when sending by template', () => {
    expect(
      SendWhatsAppFlowSchema.safeParse({
        conversationId: 'c',
        templateName: 't',
      }).success,
    ).toBe(false)
    expect(
      SendWhatsAppFlowSchema.safeParse({
        conversationId: 'c',
        templateName: 't',
        language: 'pt_BR',
      }).success,
    ).toBe(true)
    expect(
      SendWhatsAppFlowSchema.safeParse({ conversationId: 'c' }).success,
    ).toBe(true)
  })

  it('validates the template request', () => {
    expect(
      CreateWhatsAppFlowTemplateSchema.safeParse({
        name: 'Bad Name',
        body: 'x',
      }).success,
    ).toBe(false)
    const ok = CreateWhatsAppFlowTemplateSchema.parse({
      name: 'cadastro',
      body: 'Olá',
    })
    expect(ok).toMatchObject({
      language: 'pt_BR',
      category: 'UTILITY',
      buttonText: 'Preencher',
    })
  })

  it('coerces the list query', () => {
    expect(ListWhatsAppFlowResponsesSchema.parse({ limit: '10' }).limit).toBe(
      10,
    )
    expect(ListWhatsAppFlowResponsesSchema.parse({}).limit).toBe(30)
    expect(
      ListWhatsAppFlowResponsesSchema.safeParse({ limit: '500' }).success,
    ).toBe(false)
  })
})
