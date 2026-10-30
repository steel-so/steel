import { describe, expect, it } from 'vitest'
import type { CrmFormFieldDTO } from '@/src/schemas/crm-form.schema'
import {
  type FlowDefinition,
  FlowDefinitionSchema,
} from '@/src/schemas/whatsapp-flow.schema'
import {
  answerText,
  buildFlowToken,
  flowIdFromToken,
  mapAnswers,
  parseFlowReply,
  sanitizeAnswers,
  summarizeAnswers,
} from '../whatsapp/flows/answers'
import {
  addField,
  addScreen,
  allFields,
  categoryOrOther,
  changeFieldType,
  keyFromLabel,
  mappingValue,
  moveField,
  newField,
  parseMappingValue,
  removeField,
  removeScreen,
  updateField,
  updateScreen,
} from '../whatsapp/flows/editor-model'
import {
  flowFieldFromCrm,
  flowFromCrmForm,
} from '../whatsapp/flows/from-crm-form'
import {
  buildMetaFlowJson,
  firstScreenId,
  screenId,
} from '../whatsapp/flows/meta-json'
import { flowFromPreset } from '../whatsapp/flows/templates'
import { flowCrmIssues } from '../whatsapp/flows/validate'
import { buildMetaFlowMessage } from '../whatsapp/meta-client'

const ref = (path: string) => `$${'{'}${path}}`

const signUp = flowFromPreset('SIGN_UP').definition

describe('flow presets', () => {
  it.each(['BLANK', 'SIGN_UP', 'APPOINTMENT', 'SURVEY'] as const)(
    '%s is a valid definition',
    (preset) => {
      const data = flowFromPreset(preset)
      expect(FlowDefinitionSchema.safeParse(data.definition).success).toBe(true)
      expect(data.bodyText.length).toBeGreaterThan(0)
    },
  )

  it('returns an independent copy', () => {
    const a = flowFromPreset('SURVEY')
    a.definition.screens[0].title = 'Mudou'
    expect(flowFromPreset('SURVEY').definition.screens[0].title).toBe(
      'Pesquisa',
    )
  })

  it('the sign-up preset creates a lead', () => {
    const data = flowFromPreset('SIGN_UP')
    expect(data.crmAction).toBe('LEAD')
    expect(flowCrmIssues(data.definition, data.crmAction)).toEqual([])
  })
})

describe('screenId', () => {
  it('uses letters only, growing past Z', () => {
    expect(screenId(0)).toBe('SCREEN_A')
    expect(screenId(25)).toBe('SCREEN_Z')
    expect(screenId(26)).toBe('SCREEN_AA')
    expect(firstScreenId()).toBe('SCREEN_A')
  })
})

describe('buildMetaFlowJson', () => {
  it('builds a terminal screen that completes with the form values', () => {
    const json = buildMetaFlowJson(flowFromPreset('BLANK').definition) as {
      version: string
      screens: Array<{
        id: string
        terminal?: boolean
        success?: boolean
        data?: unknown
        layout: { children: Array<Record<string, unknown>> }
      }>
    }
    expect(json.version).toBe('7.2')
    const [only] = json.screens
    expect(only).toMatchObject({
      id: 'SCREEN_A',
      terminal: true,
      success: true,
    })
    // The first screen declares the data its text fields can be prefilled with.
    expect(Object.keys((only.data ?? {}) as object)).toEqual(['nome'])
    const form = only.layout.children.find((c) => c.type === 'Form') as {
      children: Array<Record<string, unknown>>
    }
    const footer = form.children.at(-1) as {
      label: string
      'on-click-action': { name: string; payload: Record<string, string> }
    }
    expect(footer.label).toBe('Enviar')
    expect(footer['on-click-action']).toEqual({
      name: 'complete',
      payload: { nome: ref('form.nome') },
    })
  })

  it('carries earlier answers forward through navigate payloads', () => {
    const json = buildMetaFlowJson(signUp) as {
      screens: Array<{
        id: string
        terminal?: boolean
        data?: Record<string, { type: string }>
        layout: { children: Array<Record<string, unknown>> }
      }>
    }
    expect(json.screens).toHaveLength(2)
    const [first, second] = json.screens
    expect(first.terminal).toBeUndefined()
    const firstForm = first.layout.children.find((c) => c.type === 'Form') as {
      children: Array<Record<string, unknown>>
    }
    const nav = (firstForm.children.at(-1) as Record<string, unknown>)[
      'on-click-action'
    ] as {
      name: string
      next: { name: string }
      payload: Record<string, string>
    }
    expect(nav.name).toBe('navigate')
    expect(nav.next).toEqual({ type: 'screen', name: 'SCREEN_B' })
    expect(nav.payload).toEqual({
      nome: ref('form.nome'),
      email: ref('form.email'),
      telefone: ref('form.telefone'),
    })
    expect(Object.keys(second.data ?? {})).toEqual([
      'nome',
      'email',
      'telefone',
    ])

    const lastForm = second.layout.children.find((c) => c.type === 'Form') as {
      children: Array<Record<string, unknown>>
    }
    const complete = (lastForm.children.at(-1) as Record<string, unknown>)[
      'on-click-action'
    ] as { name: string; payload: Record<string, string> }
    expect(complete.name).toBe('complete')
    expect(complete.payload.nome).toBe(ref('data.nome'))
    expect(complete.payload.empresa).toBe(ref('form.empresa'))
  })

  it('maps every field type to its Meta component', () => {
    const definition: FlowDefinition = {
      screens: [
        {
          title: 'Tudo',
          heading: 'Topo',
          description: 'Texto',
          submitLabel: 'Fim',
          fields: [
            {
              key: 'a',
              label: 'A',
              type: 'text',
              required: true,
              helperText: 'h',
            },
            { key: 'b', label: 'B', type: 'email', required: false },
            { key: 'c', label: 'C', type: 'phone', required: false },
            { key: 'd', label: 'D', type: 'number', required: false },
            { key: 'e', label: 'E', type: 'textarea', required: false },
            {
              key: 'f',
              label: 'F',
              type: 'select',
              required: false,
              options: [{ id: 'x', title: 'X' }],
            },
            {
              key: 'g',
              label: 'G',
              type: 'radio',
              required: false,
              options: [{ id: 'x', title: 'X' }],
            },
            {
              key: 'h',
              label: 'H',
              type: 'multiselect',
              required: false,
              options: [{ id: 'x', title: 'X' }],
            },
            { key: 'i', label: 'I', type: 'checkbox', required: false },
            { key: 'j', label: 'J', type: 'date', required: false },
          ],
        },
        {
          title: 'Fim',
          fields: [{ key: 'z', label: 'Z', type: 'text', required: false }],
        },
      ],
    }
    const json = buildMetaFlowJson(definition) as {
      screens: Array<{
        data?: Record<string, { type: string; __example__: unknown }>
        layout: { children: Array<Record<string, unknown>> }
      }>
    }
    const children = json.screens[0].layout.children
    expect(children[0]).toEqual({ type: 'TextHeading', text: 'Topo' })
    expect(children[1]).toEqual({ type: 'TextBody', text: 'Texto' })
    const form = children[2] as { children: Array<Record<string, unknown>> }
    expect(form.children.map((c) => c.type)).toEqual([
      'TextInput',
      'TextInput',
      'TextInput',
      'TextInput',
      'TextArea',
      'Dropdown',
      'RadioButtonsGroup',
      'CheckboxGroup',
      'OptIn',
      'DatePicker',
      'Footer',
    ])
    expect(form.children[0]).toMatchObject({
      'input-type': 'text',
      required: true,
      'helper-text': 'h',
    })
    expect(form.children[1]['input-type']).toBe('email')
    expect(form.children[2]['input-type']).toBe('phone')
    expect(form.children[3]['input-type']).toBe('number')
    expect(form.children[5]['data-source']).toEqual([{ id: 'x', title: 'X' }])
    expect((form.children[10] as { label: string }).label).toBe('Fim')

    const carried = json.screens[1].data ?? {}
    expect(carried.i).toEqual({ type: 'boolean', __example__: true })
    expect(carried.h.type).toBe('array')
    expect(carried.f.__example__).toBe('x')
    expect(carried.a.__example__).toBe('exemplo')
  })
})

describe('flow tokens and replies', () => {
  it('round-trips the flow id through the token', () => {
    const token = buildFlowToken('flow1', 'nonce1')
    expect(token).toBe('stlf.flow1.nonce1')
    expect(flowIdFromToken(token)).toBe('flow1')
  })

  it('refuses tokens that are not ours', () => {
    expect(flowIdFromToken(null)).toBeNull()
    expect(flowIdFromToken(undefined)).toBeNull()
    expect(flowIdFromToken('unused')).toBeNull()
    expect(flowIdFromToken('other.flow1.nonce')).toBeNull()
    expect(flowIdFromToken('stlf.flow1')).toBeNull()
    expect(flowIdFromToken('stlf.flow1.n.extra')).toBeNull()
  })

  it('parses the response_json string', () => {
    expect(
      parseFlowReply('{"flow_token":"stlf.a.b","nome":"Ana","aceite":true}'),
    ).toEqual({
      flowToken: 'stlf.a.b',
      answers: { nome: 'Ana', aceite: true },
    })
    expect(parseFlowReply('{"nome":"Ana"}')?.flowToken).toBeNull()
  })

  it('returns null for anything that is not a JSON object', () => {
    expect(parseFlowReply(undefined)).toBeNull()
    expect(parseFlowReply('')).toBeNull()
    expect(parseFlowReply('not json')).toBeNull()
    expect(parseFlowReply('[1,2]')).toBeNull()
    expect(parseFlowReply('"text"')).toBeNull()
    expect(parseFlowReply('null')).toBeNull()
  })
})

describe('answers', () => {
  const survey = flowFromPreset('SURVEY').definition
  const [nota, pontos] = survey.screens[0].fields

  it('shows option titles, booleans and lists as text', () => {
    expect(answerText(nota, '5')).toBe('5 - Excelente')
    expect(answerText(pontos, ['rapidez', 'solucao'])).toBe('Rapidez, Solução')
    expect(answerText(nota, 'outro')).toBe('outro')
    expect(
      answerText(
        { key: 'k', label: 'K', type: 'checkbox', required: false },
        true,
      ),
    ).toBe('Sim')
    expect(
      answerText(
        { key: 'k', label: 'K', type: 'checkbox', required: false },
        false,
      ),
    ).toBe('Não')
    expect(answerText(nota, undefined)).toBe('')
    expect(answerText(nota, null)).toBe('')
    expect(answerText(nota, '')).toBe('')
  })

  it('keeps only declared keys and bounds their size', () => {
    const clean = sanitizeAnswers(survey, {
      nota: '4',
      pontos: ['rapidez', 7],
      comentario: 'x'.repeat(5000),
      intruso: 'no',
      vazio: null,
    })
    expect(Object.keys(clean).sort()).toEqual(['comentario', 'nota', 'pontos'])
    expect((clean.comentario as string).length).toBe(4000)
    expect(clean.pontos).toEqual(['rapidez', '7'])
  })

  it('stringifies numbers, keeps booleans and drops objects', () => {
    const definition = flowFromPreset('SIGN_UP').definition
    const clean = sanitizeAnswers(definition, {
      nome: 12,
      consentimento: true,
      email: { nested: true },
    })
    expect(clean).toEqual({ nome: '12', consentimento: true })
  })

  it('groups answers by mapping target', () => {
    const mapped = mapAnswers(signUp, {
      nome: 'Ana',
      email: 'ana@x.com',
      telefone: '',
      empresa: 'ACME',
      consentimento: true,
    })
    expect(mapped).toEqual({
      lead: { name: 'Ana', email: 'ana@x.com', company: 'ACME' },
    })
  })

  it('summarizes the filled answers one per line', () => {
    expect(summarizeAnswers(survey, { nota: '5', pontos: ['rapidez'] })).toBe(
      'Sua nota: 5 - Excelente\nO que mais gostou?: Rapidez',
    )
  })
})

describe('flowCrmIssues', () => {
  const unmapped = flowFromPreset('SURVEY').definition

  it('has nothing to say without a CRM action', () => {
    expect(flowCrmIssues(unmapped, 'NONE')).toEqual([])
  })

  it.each(['LEAD', 'PERSON', 'COMPANY'] as const)(
    'asks for a mapping when the action is %s',
    (action) => {
      expect(flowCrmIssues(unmapped, action)).toHaveLength(1)
    },
  )

  it('accepts mapped definitions', () => {
    const mapped = (target: string, attribute: string): FlowDefinition => ({
      screens: [
        {
          title: 'T',
          fields: [
            {
              key: 'k',
              label: 'K',
              type: 'text',
              required: false,
              mapping: { target, attribute } as never,
            },
          ],
        },
      ],
    })
    expect(flowCrmIssues(mapped('lead', 'phone'), 'LEAD')).toEqual([])
    expect(flowCrmIssues(mapped('person', 'email'), 'PERSON')).toEqual([])
    expect(flowCrmIssues(mapped('company', 'name'), 'COMPANY')).toEqual([])
    expect(flowCrmIssues(mapped('lead', 'name'), 'LEAD')).toHaveLength(1)
  })
})

describe('flowFromCrmForm', () => {
  const crmField = (
    overrides: Partial<CrmFormFieldDTO> = {},
  ): CrmFormFieldDTO => ({
    key: 'nome',
    label: 'Nome completo da pessoa responsável',
    type: 'text',
    required: true,
    mapping: { target: 'lead', attribute: 'name' },
    ...overrides,
  })

  it('converts types, clips labels and keeps the mapping', () => {
    const field = flowFieldFromCrm(crmField())
    expect(field.type).toBe('text')
    expect(field.label.length).toBeLessThanOrEqual(20)
    expect(field.label.endsWith('…')).toBe(true)
    expect(field.required).toBe(true)
    expect(field.mapping).toEqual({ target: 'lead', attribute: 'name' })
    expect(flowFieldFromCrm(crmField({ type: 'url' })).type).toBe('text')
    expect(flowFieldFromCrm(crmField({ label: 'Curto' })).label).toBe('Curto')
  })

  it('turns options into id/title pairs with unique ids', () => {
    const field = flowFieldFromCrm(
      crmField({
        type: 'select',
        options: [
          { label: 'Sim, quero', value: 'sim quero' },
          { label: 'Sim quero', value: 'sim_quero' },
          { label: 'Vazio', value: '***' },
        ],
      }),
    )
    const ids = field.options?.map((o) => o.id) ?? []
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('sim_quero')
    expect(ids[2]).toBe('_')
  })

  it('splits fields into screens and carries the action', () => {
    const fields = Array.from({ length: 10 }, (_, i) =>
      crmField({ key: `campo_${i}`, label: `Campo ${i}`, required: undefined }),
    )
    const { definition, crmAction } = flowFromCrmForm(fields, 'LEAD')
    expect(crmAction).toBe('LEAD')
    expect(definition.screens.map((s) => s.fields.length)).toEqual([8, 2])
    expect(definition.screens[1].title).toBe('Passo 2')
    expect(definition.screens[0].fields[0].required).toBe(false)
  })
})

describe('editor model', () => {
  const base = flowFromPreset('BLANK').definition

  it('derives keys from labels', () => {
    expect(keyFromLabel('Nome completo')).toBe('nome_completo')
    expect(keyFromLabel('Endereço de e-mail')).toBe('endereco_de_e_mail')
    expect(keyFromLabel('123 abc')).toBe('campo_123_abc')
    expect(keyFromLabel('***')).toBe('campo')
  })

  it('creates fields with unique keys and options for choices', () => {
    const first = newField(base, 'text')
    expect(first.key).toBe('texto_curto')
    const withFirst = addField(base, 0, 'text')
    const second = newField(withFirst, 'text')
    expect(second.key).toBe('texto_curto_2')
    expect(newField(base, 'radio').options).toHaveLength(2)
    expect(newField(base, 'text').options).toBeUndefined()
  })

  it('adds, edits, moves and removes fields', () => {
    let definition = addField(base, 0, 'email')
    expect(allFields(definition)).toHaveLength(2)
    definition = updateField(definition, 0, 1, { label: 'Outro' })
    expect(definition.screens[0].fields[1].label).toBe('Outro')
    definition = moveField(definition, 0, 1, -1)
    expect(definition.screens[0].fields[0].label).toBe('Outro')
    expect(moveField(definition, 0, 0, -1)).toBe(definition)
    expect(moveField(definition, 0, 1, 1)).toBe(definition)
    definition = removeField(definition, 0, 0)
    expect(definition.screens[0].fields).toHaveLength(1)
    expect(removeField(definition, 0, 0)).toBe(definition)
  })

  it('refuses to add past the limits', () => {
    let definition = base
    for (let i = 0; i < 12; i += 1) definition = addField(definition, 0, 'text')
    expect(definition.screens[0].fields).toHaveLength(8)
    expect(addField(base, 5, 'text')).toBe(base)
    let many = base
    for (let i = 0; i < 9; i += 1) many = addScreen(many)
    expect(many.screens).toHaveLength(8)
    expect(updateField(base, 5, 0, { label: 'x' })).toBe(base)
    expect(removeField(base, 5, 0)).toBe(base)
    expect(moveField(base, 5, 0, 1)).toBe(base)
  })

  it('adds, updates and removes screens (never the last one)', () => {
    let definition = addScreen(base)
    expect(definition.screens).toHaveLength(2)
    expect(definition.screens[1].title).toBe('Passo 2')
    definition = updateScreen(definition, 1, { title: 'Final' })
    expect(definition.screens[1].title).toBe('Final')
    definition = removeScreen(definition, 0)
    expect(definition.screens).toHaveLength(1)
    expect(removeScreen(definition, 0)).toBe(definition)
  })

  it('keeps data coherent when the field type changes', () => {
    const text = newField(base, 'text')
    const select = changeFieldType(text, 'select')
    expect(select.options).toHaveLength(2)
    const kept = changeFieldType(
      { ...text, type: 'radio', options: [{ id: 'a', title: 'A' }] },
      'select',
    )
    expect(kept.options).toEqual([{ id: 'a', title: 'A' }])
    expect(changeFieldType(select, 'text').options).toBeUndefined()
    const clipped = changeFieldType(
      { ...text, type: 'checkbox', label: 'x'.repeat(60) },
      'text',
    )
    expect(clipped.label).toHaveLength(20)
  })

  it('reads and writes the mapping select value', () => {
    const field = newField(base, 'text')
    expect(mappingValue(field)).toBe('')
    expect(parseMappingValue('')).toBeUndefined()
    expect(parseMappingValue('lead.email')).toEqual({
      target: 'lead',
      attribute: 'email',
    })
    expect(
      mappingValue({ ...field, mapping: parseMappingValue('person.city') }),
    ).toBe('person.city')
  })

  it('falls back to OTHER for unknown categories', () => {
    expect(categoryOrOther('SURVEY')).toBe('SURVEY')
    expect(categoryOrOther('nope')).toBe('OTHER')
  })
})

describe('buildMetaFlowMessage', () => {
  const input = {
    to: '5511999999999',
    flowId: 'f1',
    flowToken: 'stlf.a.b',
    bodyText: 'Preencha',
    ctaLabel: 'Abrir',
    screen: 'SCREEN_A',
  }

  it('builds the interactive flow message', () => {
    expect(buildMetaFlowMessage(input)).toEqual({
      type: 'flow',
      body: { text: 'Preencha' },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: 'stlf.a.b',
          flow_id: 'f1',
          flow_cta: 'Abrir',
          flow_action: 'navigate',
          flow_action_payload: { screen: 'SCREEN_A' },
        },
      },
    })
  })

  it('marks a draft flow with mode draft', () => {
    const message = buildMetaFlowMessage({ ...input, draft: true }) as {
      action: { parameters: Record<string, unknown> }
    }
    expect(message.action.parameters.mode).toBe('draft')
  })
})
