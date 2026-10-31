import { describe, expect, it } from 'vitest'
import { buildMetaFlowJson } from '@/src/lib/whatsapp/flows/meta-json'
import {
  flowPrefillData,
  isPrefillable,
  prefillFields,
} from '@/src/lib/whatsapp/flows/prefill'
import {
  type FlowDefinition,
  FlowDefinitionSchema,
} from '@/src/schemas/whatsapp-flow.schema'

function definition(): FlowDefinition {
  return FlowDefinitionSchema.parse({
    screens: [
      {
        title: 'Dados',
        fields: [
          {
            key: 'nome',
            label: 'Nome',
            type: 'text',
            mapping: { target: 'contact', attribute: 'name' },
          },
          {
            key: 'telefone',
            label: 'Telefone',
            type: 'phone',
            mapping: { target: 'lead', attribute: 'phone' },
          },
          { key: 'zap', label: 'WhatsApp', type: 'phone' },
          {
            key: 'empresa',
            label: 'Empresa',
            type: 'text',
            mapping: { target: 'company', attribute: 'name' },
          },
          { key: 'email', label: 'E-mail', type: 'email' },
          {
            key: 'porte',
            label: 'Porte',
            type: 'select',
            options: [{ id: 'p', title: 'Pequeno' }],
          },
        ],
      },
      {
        title: 'Mais',
        fields: [{ key: 'obs', label: 'Observação', type: 'textarea' }],
      },
    ],
  })
}

describe('flow prefill', () => {
  it('only offers text-like fields of the first screen', () => {
    expect(prefillFields(definition()).map((f) => f.key)).toEqual([
      'nome',
      'telefone',
      'zap',
      'empresa',
      'email',
    ])
    expect(isPrefillable(definition().screens[0].fields[5])).toBe(false)
  })

  it('fills name and phone from the contact and leaves the rest empty', () => {
    expect(
      flowPrefillData(definition(), {
        name: '  Maria Silva ',
        waId: '5511999990000',
      }),
    ).toEqual({
      nome: 'Maria Silva',
      telefone: '5511999990000',
      zap: '5511999990000',
      empresa: '',
      email: '',
    })
  })

  it('has no phone for a business-scoped id and no name when unknown', () => {
    expect(
      flowPrefillData(definition(), { name: null, waId: 'BR.123' }),
    ).toEqual({ nome: '', telefone: '', zap: '', empresa: '', email: '' })
  })

  it('caps a long name', () => {
    const long = 'a'.repeat(500)
    expect(
      flowPrefillData(definition(), { name: long, waId: '5511999990000' }).nome,
    ).toHaveLength(200)
  })

  it('is empty when nothing is prefillable', () => {
    const only = FlowDefinitionSchema.parse({
      screens: [
        {
          title: 'Escolha',
          fields: [
            {
              key: 'a',
              label: 'A',
              type: 'radio',
              options: [{ id: 'x', title: 'X' }],
            },
          ],
        },
      ],
    })
    expect(flowPrefillData(only, { name: 'M', waId: '5511999990000' })).toEqual(
      {},
    )
  })
})

describe('Flow JSON prefill wiring', () => {
  it('reads the first screen data through init-value', () => {
    const json = buildMetaFlowJson(definition()) as {
      screens: Array<{
        data?: Record<string, unknown>
        layout: {
          children: Array<{ children?: Array<Record<string, unknown>> }>
        }
      }>
    }
    const [first, second] = json.screens
    expect(Object.keys(first.data ?? {})).toEqual([
      'nome',
      'telefone',
      'zap',
      'empresa',
      'email',
    ])
    const fields = first.layout.children.find((c) => c.children)?.children ?? []
    expect(fields.find((f) => f.name === 'nome')?.['init-value']).toBe(
      '$' + '{data.nome}',
    )
    // A dropdown cannot take a text init-value.
    expect(fields.find((f) => f.name === 'porte')).not.toHaveProperty(
      'init-value',
    )
    // Later screens only carry the earlier answers, never an init-value.
    expect(Object.keys(second.data ?? {})).not.toContain('obs')
    const later = second.layout.children.find((c) => c.children)?.children ?? []
    expect(later.find((f) => f.name === 'obs')).not.toHaveProperty('init-value')
  })

  it('puts init-value on a first-screen textarea too', () => {
    const json = buildMetaFlowJson(
      FlowDefinitionSchema.parse({
        screens: [
          {
            title: 'T',
            fields: [{ key: 'msg', label: 'Mensagem', type: 'textarea' }],
          },
        ],
      }),
    ) as {
      screens: Array<{
        layout: {
          children: Array<{ children?: Array<Record<string, unknown>> }>
        }
      }>
    }
    const form = json.screens[0].layout.children.find((c) => c.children)
    expect(form?.children?.[0]['init-value']).toBe('$' + '{data.msg}')
  })
})
