import { describe, expect, it } from 'vitest'
import { CreateWhatsAppTemplateSchema } from '../whatsapp-template.schema'

describe('CreateWhatsAppTemplateSchema', () => {
  const base = {
    connectionId: 'conn1',
    name: 'confirmacao_exame',
    language: 'pt_BR',
    category: 'UTILITY' as const,
    body: 'Olá {{1}}, confirmando seu exame de {{2}}.',
  }

  it('should accept a minimal valid template (body only)', () => {
    const result = CreateWhatsAppTemplateSchema.safeParse(base)

    expect(result.success).toBe(true)
  })

  it('should accept header, footer and buttons', () => {
    const result = CreateWhatsAppTemplateSchema.safeParse({
      ...base,
      headerText: 'Confirmação de exame',
      footer: 'Responda em até 24h',
      buttons: [
        {
          id: 'b1',
          type: 'REPLY',
          label: 'Confirmar',
          actions: [{ kind: 'REPLY', text: 'Obrigado!' }],
        },
        { id: 'b2', type: 'URL', label: 'Remarcar', url: 'https://x.test' },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('should reject a name with uppercase letters or spaces', () => {
    const result = CreateWhatsAppTemplateSchema.safeParse({
      ...base,
      name: 'Confirmação Exame',
    })

    expect(result.success).toBe(false)
  })

  it('should reject an unknown category', () => {
    const result = CreateWhatsAppTemplateSchema.safeParse({
      ...base,
      category: 'BILLING',
    })

    expect(result.success).toBe(false)
  })

  it('should reject an empty body', () => {
    const result = CreateWhatsAppTemplateSchema.safeParse({ ...base, body: '' })

    expect(result.success).toBe(false)
  })

  it('should reject a URL button without a valid url', () => {
    const result = CreateWhatsAppTemplateSchema.safeParse({
      ...base,
      buttons: [{ id: 'b1', type: 'URL', label: 'Ver mais', url: 'not-a-url' }],
    })

    expect(result.success).toBe(false)
  })

  it('should reject more than 2 buttons', () => {
    const result = CreateWhatsAppTemplateSchema.safeParse({
      ...base,
      buttons: [
        { id: 'a', type: 'REPLY', label: 'A' },
        { id: 'b', type: 'REPLY', label: 'B' },
        { id: 'c', type: 'REPLY', label: 'C' },
      ],
    })

    expect(result.success).toBe(false)
  })
})
