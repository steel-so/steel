import { describe, expect, it } from 'vitest'
import {
  aiCampaignTemplateProblem,
  buildAiCampaignMessage,
  estimateAiCampaignDuration,
  formatDuration,
  missingVariableSlots,
  resolveTemplateValues,
  templateFields,
  templateVariableSlots,
  variableColumns,
} from '@/src/lib/whatsapp/ai-campaign'

const components = [
  { type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}' },
  { type: 'BODY', text: '{{1}}, sua fatura de {{2}} vence em {{3}}.' },
  {
    type: 'BUTTONS',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Já paguei' },
      { type: 'URL', text: 'Pagar', url: 'https://pay.example.com/{{1}}' },
    ],
  },
]
const fields = templateFields(components)

const context = {
  contactName: 'Maria Souza',
  waId: '5511999990000',
  description: null,
  values: { valor: 'R$ 120,00', vencimento: '25/10', codigo: 'ABC123' },
}

describe('templateVariableSlots()', () => {
  it('should list header, body and dynamic link variables in order', () => {
    expect(templateVariableSlots(fields)).toEqual([
      { group: 'header', key: '1', label: 'Cabeçalho {{1}}' },
      { group: 'body', key: '1', label: 'Variável {{1}}' },
      { group: 'body', key: '2', label: 'Variável {{2}}' },
      { group: 'body', key: '3', label: 'Variável {{3}}' },
      { group: 'buttons', key: '1', label: 'Link do botão "Pagar"' },
    ])
  })

  it('should have nothing to fill on a template without variables', () => {
    expect(
      templateVariableSlots(
        templateFields([{ type: 'BODY', text: 'Bem-vindo!' }]),
      ),
    ).toEqual([])
  })
})

describe('resolveTemplateValues()', () => {
  const variables = {
    header: {
      '1': { source: 'CONTACT' as const, field: 'FIRST_NAME' as const },
    },
    body: {
      '1': { source: 'CONTACT' as const, field: 'NAME' as const },
      '2': { source: 'COLUMN' as const, column: 'valor' },
      '3': { source: 'FIXED' as const, value: 'amanhã' },
    },
    buttons: { '1': { source: 'COLUMN' as const, column: 'codigo' } },
  }

  it('should fill every slot from its source', () => {
    const resolved = resolveTemplateValues(fields, variables, context)

    expect(resolved).toEqual({
      ok: true,
      values: {
        header: { 1: 'Maria' },
        body: { 1: 'Maria Souza', 2: 'R$ 120,00', 3: 'amanhã' },
        buttons: { 1: 'ABC123' },
      },
    })
    if (!resolved.ok) return
    expect(buildAiCampaignMessage(fields, resolved.values).text).toBe(
      'Maria Souza, sua fatura de R$ 120,00 vence em amanhã.',
    )
  })

  it('should use the fallback when the contact has no value', () => {
    const resolved = resolveTemplateValues(
      fields,
      {
        ...variables,
        header: {
          '1': { source: 'CONTACT', field: 'FIRST_NAME', fallback: 'cliente' },
        },
        body: {
          ...variables.body,
          '1': { source: 'CONTACT', field: 'NAME', fallback: 'cliente' },
        },
      },
      { ...context, contactName: null },
    )
    expect(resolved.ok && resolved.values.body[1]).toBe('cliente')
  })

  it('should report the first empty slot instead of sending a broken message', () => {
    const resolved = resolveTemplateValues(fields, variables, {
      ...context,
      values: {},
    })
    expect(resolved).toEqual({
      ok: false,
      missing: { group: 'body', key: '2', label: 'Variável {{2}}' },
    })
  })

  it('should list the unmapped slots and the columns read', () => {
    expect(
      missingVariableSlots(fields, {
        header: {},
        body: variables.body,
        buttons: {},
      }).map((slot) => slot.label),
    ).toEqual(['Cabeçalho {{1}}', 'Link do botão "Pagar"'])
    expect(variableColumns(variables)).toEqual(['valor', 'codigo'])
  })
})

describe('aiCampaignTemplateProblem()', () => {
  it('should accept an approved template on a Meta connection', () => {
    expect(
      aiCampaignTemplateProblem(
        { provider: 'META', module: 'COMMUNICATION' },
        { status: 'APPROVED' },
      ),
    ).toBeNull()
  })

  it('should refuse Z-API, ServiceDesk and templates not approved', () => {
    expect(
      aiCampaignTemplateProblem(
        { provider: 'ZAPI', module: 'COMMUNICATION' },
        { status: 'APPROVED' },
      ),
    ).toContain('Meta')
    expect(
      aiCampaignTemplateProblem(
        { provider: 'META', module: 'SERVICE_DESK' },
        { status: 'APPROVED' },
      ),
    ).toContain('Meta')
    expect(
      aiCampaignTemplateProblem(
        { provider: 'META', module: 'COMMUNICATION' },
        { status: 'PENDING' },
      ),
    ).toContain('aprovado')
  })
})

describe('duration estimate', () => {
  it('should count the gaps between sends and format them', () => {
    expect(estimateAiCampaignDuration(300, 30)).toBe(8970)
    expect(formatDuration(8970)).toBe('2 h 30 min')
    expect(formatDuration(45)).toBe('45 s')
    expect(formatDuration(600)).toBe('10 min')
    expect(formatDuration(7200)).toBe('2 h')
    expect(estimateAiCampaignDuration(0, 30)).toBe(0)
  })
})
